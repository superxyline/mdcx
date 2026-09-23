"""工具集: 列表管理、缺失检查、文件清理、视频移动与 Cookie 检测.

对应桌面版「工具」与「日志」页上的若干按钮. 业务逻辑复用 base/ 与 tools/ 中的
既有实现, 这里只做参数校验与任务派发.

批量操作统一通过 executor.submit 投递到后台线程执行, 接口立即返回, 进度与结果
经 WebSocket 推给浏览器 —— 与刮削任务同一套机制, 因此关闭浏览器不会中断.
"""

from __future__ import annotations

import asyncio
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel, Field

from mdcx.base.file import check_and_clean_files, move_videos_to_moved_folder, save_success_list
from mdcx.base.image import add_del_extrafanart_copy, cut_poster, get_poster_paths
from mdcx.base.video import add_del_extras, add_del_theme_videos
from mdcx.config.manager import manager
from mdcx.config.models import Website
from mdcx.core.file import get_file_info_v2
from mdcx.core.scraper import start_new_scrape
from mdcx.models.enums import FileMode
from mdcx.models.flags import Flags
from mdcx.server.config import SAFE_DIRS
from mdcx.signals import signal
from mdcx.tools.emby_actor_info import creat_kodi_actors, show_emby_actor_list
from mdcx.tools.missing import check_missing_number
from mdcx.utils import executor

from .utils import check_path_access

router = APIRouter(prefix="/tools", tags=["工具"])


def _ensure_idle() -> None:
    """批量任务共用同一个后台执行器, 同时跑会互相干扰."""
    if executor.busy:
        raise HTTPException(status_code=409, detail="已有任务正在运行, 请等待其结束后再试.")


# ---------------------------------------------------------------- 列表管理


class FileListResponse(BaseModel):
    count: int
    paths: list[str]


class FailedItem(BaseModel):
    path: str
    reason: str


class FailedListResponse(BaseModel):
    count: int
    items: list[FailedItem]


@router.get("/success-list", operation_id="getSuccessList", summary="获取已成功刮削的文件列表")
async def get_success_list() -> FileListResponse:
    """返回本次运行期间已成功刮削的文件, 用于日志页展示与导出."""
    return FileListResponse(count=len(Flags.success_list), paths=sorted(str(p) for p in Flags.success_list))


@router.post("/success-list/save", operation_id="saveSuccessList", summary="保存成功列表")
async def save_success_list_api() -> dict[str, str]:
    """把当前成功列表落盘到 success.txt.

    刮削过程中会自动定期保存, 这个接口供用户手动确认保存一次.
    """
    await save_success_list()
    return {"message": f"已保存 {len(Flags.success_list)} 条记录."}


@router.post("/success-list/clear", operation_id="clearSuccessList", summary="清空成功列表")
async def clear_success_list() -> dict[str, str]:
    """清空成功列表并同步落盘.

    清空后这些文件会被视为未刮削, 下次扫描时会重新处理.
    """
    count = len(Flags.success_list)
    Flags.success_list.clear()
    await save_success_list()
    signal.view_success_file_settext.emit(f"查看 ({len(Flags.success_list)})")
    return {"message": f"已清空 {count} 条记录."}


@router.get("/failed-list", operation_id="getFailedList", summary="获取失败文件列表")
async def get_failed_list() -> FailedListResponse:
    """返回本次刮削中失败的文件及原因."""
    return FailedListResponse(
        count=len(Flags.failed_list),
        items=[FailedItem(path=str(p), reason=reason) for p, reason in Flags.failed_list],
    )


@router.post("/failed-list/retry", operation_id="retryFailedList", summary="重新刮削失败列表")
async def retry_failed_list() -> dict[str, str]:
    """用当前失败列表作为待刮削清单, 重新跑一遍."""
    if not Flags.failed_list:
        raise HTTPException(status_code=400, detail="当前没有失败记录.")
    _ensure_idle()
    # 先取出路径再提交: Scraper 启动后会重置 Flags, 列表会被清空
    movie_list = [p for p, _ in Flags.failed_list]
    start_new_scrape(FileMode.Default, movie_list)
    return {"message": f"已提交 {len(movie_list)} 个文件重新刮削."}


# ---------------------------------------------------------------- 检查类


@router.post("/check-missing", operation_id="checkMissingNumbers", summary="检查缺失番号")
async def check_missing() -> dict[str, str]:
    """按演员作品列表比对本地库, 找出缺失的番号 (需在设置中配置本地库与演员)."""
    _ensure_idle()
    executor.submit(check_missing_number(True))
    return {"message": "已开始检查缺失番号, 结果见日志页."}


class HealthIssue(BaseModel):
    path: str = Field(description="相关文件路径 (视频或 NFO)")
    missing: list[str] = Field(description="缺失的内容: nfo / poster / fanart / title / releasedate / actor / nfo_invalid")


class HealthReport(BaseModel):
    """媒体库健康检查报告."""

    scanned: int = Field(description="扫描到的影片数量 (按视频文件计)")
    ok: int = Field(description="无问题的影片数量")
    issues: list[HealthIssue] = Field(description="有问题的影片列表 (最多 500 条)")


@router.get("/health-report", operation_id="getHealthReport", summary="媒体库健康检查")
async def health_report() -> HealthReport:
    """扫描媒体库, 找出未刮削、缺封面、NFO 字段缺失的影片.

    同步扫描, 大库可能需要几秒; 刮削进行中时拒绝执行.
    """
    _ensure_idle()
    movie_path = Path(manager.config.media_path) if manager.config.media_path else manager.data_folder
    try:
        check_path_access(movie_path, *SAFE_DIRS)
    except HTTPException:
        raise HTTPException(status_code=400, detail=f"媒体路径不可访问: {movie_path}")
    video_exts = {ext.lower() for ext in manager.config.media_type}

    def _scan() -> HealthReport:
        issues: list[HealthIssue] = []
        scanned = 0
        ok = 0
        for video in sorted(movie_path.rglob("*")):
            if not video.is_file() or video.suffix.lower() not in video_exts:
                continue
            scanned += 1
            missing: list[str] = []
            nfo = next((p for p in video.parent.glob("*.nfo") if p.is_file()), None)
            if nfo is None:
                issues.append(HealthIssue(path=str(video), missing=["nfo"]))
                continue
            missing.extend(_nfo_health_issues(nfo))
            if next((p for p in video.parent.iterdir() if p.name.lower() == "poster.jpg"), None) is None:
                missing.append("poster")
            if next((p for p in video.parent.iterdir() if p.name.lower() == "fanart.jpg"), None) is None:
                missing.append("fanart")
            if missing:
                issues.append(HealthIssue(path=str(nfo), missing=missing))
            else:
                ok += 1
        return HealthReport(scanned=scanned, ok=ok, issues=issues[:500])

    return await asyncio.to_thread(_scan)


def _nfo_health_issues(nfo: Path) -> list[str]:
    """NFO 关键字段缺失检查; 解析失败视为整体缺失."""
    try:
        root = ET.parse(nfo).getroot()
    except Exception:
        return ["nfo_invalid"]
    missing = []
    for tag in ("title", "releasedate"):
        el = root.find(tag)
        if el is None or not (el.text or "").strip():
            missing.append(tag)
    if root.find("actor") is None:
        missing.append("actor")
    return missing


@router.post("/clean-files", operation_id="cleanFiles", summary="检查并清理文件")
async def clean_files() -> dict[str, str]:
    """清理媒体目录中的空目录与残留文件.

    需要在设置中同时勾选清理功能的两项确认开关, 否则拒绝执行 —— 这是原版的
    安全设计, 避免误删.
    """
    if not manager.computed.can_clean:
        raise HTTPException(
            status_code=400,
            detail="未开启清理功能. 请先在设置中勾选清理相关的两项确认开关.",
        )
    _ensure_idle()
    executor.submit(check_and_clean_files())
    return {"message": "已开始检查并清理文件, 结果见日志页."}


@router.post("/move-videos", operation_id="moveVideos", summary="移动视频和字幕")
async def move_videos() -> dict[str, str]:
    """把媒体目录下的视频与字幕移动到底下的 Movie_moved 子目录."""
    _ensure_idle()
    executor.submit(move_videos_to_moved_folder())
    return {"message": "已开始移动视频和字幕, 结果见日志页."}


# ---------------------------------------------------------------- Extras 批量操作


class ExtrasAction(BaseModel):
    action: Literal["add", "del"] = Field(description="add 为添加, del 为删除")


def _action_text(action: str) -> str:
    return "添加" if action == "add" else "删除"


@router.post("/extras", operation_id="manageExtras", summary="批量添加/删除剧照")
async def manage_extras(body: ExtrasAction) -> dict[str, str]:
    """为媒体库中所有影片批量添加或删除 extras 剧照."""
    _ensure_idle()
    executor.submit(add_del_extras(body.action))
    return {"message": f"已开始{_action_text(body.action)}剧照, 结果见日志页."}


@router.post("/extrafanart-copy", operation_id="manageExtrafanartCopy", summary="批量添加/删除剧照副本")
async def manage_extrafanart_copy(body: ExtrasAction) -> dict[str, str]:
    """把剧照复制到独立目录供 Emby 使用, 或删除这些副本."""
    _ensure_idle()
    executor.submit(add_del_extrafanart_copy(body.action))
    return {"message": f"已开始{_action_text(body.action)}剧照副本, 结果见日志页."}


@router.post("/theme-videos", operation_id="manageThemeVideos", summary="批量添加/删除主题视频")
async def manage_theme_videos(body: ExtrasAction) -> dict[str, str]:
    """为媒体库中所有影片批量添加或删除主题视频."""
    _ensure_idle()
    executor.submit(add_del_theme_videos(body.action))
    return {"message": f"已开始{_action_text(body.action)}主题视频, 结果见日志页."}


# ---------------------------------------------------------------- Emby 演员


class KodiActorsAction(BaseModel):
    action: Literal["add", "del"] = Field(description="add 创建 .actors 文件夹并补全图片, del 删除")


class ActorListRequest(BaseModel):
    mode: int = Field(default=0, ge=0, le=8, description="演员筛选模式, 0 表示全部演员")


@router.post("/kodi-actors", operation_id="manageKodiActors", summary="创建/删除 Kodi 演员文件夹")
async def manage_kodi_actors(body: KodiActorsAction) -> dict[str, str]:
    """为待刮削目录中的每个视频创建或删除 .actors 文件夹 (Kodi 风格的演员图目录)."""
    _ensure_idle()
    executor.submit(creat_kodi_actors(body.action == "add"))
    verb = "创建" if body.action == "add" else "删除"
    return {"message": f"已开始{verb} .actors 文件夹, 结果见日志页."}


@router.post("/actor-list", operation_id="listActors", summary="查看媒体服务器演员名单")
async def list_actors(body: ActorListRequest) -> dict[str, str]:
    """按筛选模式列出 Emby/Jellyfin 中的演员, 结果输出到日志页.

    mode 对应桌面版下拉框的九种筛选: 0 为全部演员, 1 为有信息且有头像的演员, 依此类推.
    """
    _ensure_idle()
    executor.submit(show_emby_actor_list(body.mode))
    return {"message": "已开始获取演员名单, 结果见日志页."}


# ---------------------------------------------------------------- Cookie 检测


class CookieCheckRequest(BaseModel):
    site: Literal["javbus", "javdb"] = Field(description="要检测的站点")


class CookieCheckResponse(BaseModel):
    site: str
    ok: bool
    message: str


async def _check_javbus_cookie() -> CookieCheckResponse:
    cookie = manager.config.javbus
    url = f"{manager.config.get_site_url(Website.JAVBUS, 'https://javbus.com')}/FSDSS-660"
    headers = {
        "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6",
        "cookie": cookie,
    }
    text, error = await manager.computed.async_client.get_text(url, headers=headers)

    if text is None:
        return CookieCheckResponse(site="javbus", ok=False, message=f"连接失败, 请检查网络或代理设置. {error}")
    if "lostpasswd" in text:
        if cookie:
            return CookieCheckResponse(site="javbus", ok=False, message="Cookie 无效, 请在设置中重新填写.")
        return CookieCheckResponse(
            site="javbus", ok=False, message="当前节点需要 Cookie 才能刮削, 请填写 Cookie 或更换节点."
        )
    return CookieCheckResponse(site="javbus", ok=True, message="连接正常.")


async def _check_javdb_cookie() -> CookieCheckResponse:
    cookie = manager.config.javdb
    if not cookie:
        return CookieCheckResponse(site="javdb", ok=False, message="未填写 Cookie, 会影响 FC2 刮削.")

    url = f"{manager.config.get_site_url(Website.JAVDB, 'https://javdb.com')}/v/D16Q5?locale=zh"
    text, error = await manager.computed.async_client.get_text(url, headers={"cookie": cookie})

    if text is None:
        if "Cookie" in error:
            return CookieCheckResponse(site="javdb", ok=False, message="Cookie 已过期, 请在设置中重新填写.")
        return CookieCheckResponse(site="javdb", ok=False, message=f"连接失败, 请检查网络或代理设置. {error}")

    if "The owner of this website has banned your access based on your browser's behaving" in text:
        return CookieCheckResponse(site="javdb", ok=False, message="当前 IP 被 JavDb 封禁.")
    if "Due to copyright restrictions" in text or "Access denied" in text:
        return CookieCheckResponse(site="javdb", ok=False, message="当前 IP 被禁止访问, 请更换非日本节点.")
    if "ray-id" in text:
        return CookieCheckResponse(site="javdb", ok=False, message="访问被 CloudFlare 拦截.")
    if "/logout" in text:
        vip = "已开通 VIP" if ("icon-diamond" in text or "/v/D16Q5" in text) else "未开通 VIP"
        return CookieCheckResponse(site="javdb", ok=True, message=f"连接正常. ({vip})")
    return CookieCheckResponse(site="javdb", ok=False, message="Cookie 无效, 请在设置中重新填写.")


async def _check_cookie(site: str) -> CookieCheckResponse:
    return await (_check_javbus_cookie() if site == "javbus" else _check_javdb_cookie())


@router.post("/check-cookie", operation_id="checkCookie", summary="检测 Cookie 有效性")
async def check_cookie(body: CookieCheckRequest) -> CookieCheckResponse:
    """用配置里保存的 Cookie 访问测试页面, 判断其是否仍然有效.

    与桌面版不同的是: 这里不会自动清空失效的 Cookie, 只如实报告结果,
    改动配置始终由用户在设置页完成.
    """
    # async_client 是在后台执行器的事件循环里创建的(见 config/computed.py),
    # 直接在请求循环里 await 它会报 "attached to a different loop";
    # 借执行器把它放回原循环执行, 再包装成 asyncio Future 等结果.
    result = await asyncio.wrap_future(executor.submit(_check_cookie(body.site)))
    signal.show_log_text(f"{'✅' if result.ok else '❌'} {body.site}: {result.message}")
    return result


# ---------------------------------------------------------------- 封面裁剪


class PosterInfo(BaseModel):
    path: str = Field(description="被裁剪的图片路径")
    width: int
    height: int
    poster_path: str = Field(description="裁剪结果将写入的位置")
    thumb_path: str
    fanart_path: str
    number: str = Field(description="从文件名或 nfo 识别出的番号, 可能为空")
    has_sub: bool = Field(description="是否有字幕, 用于预勾选水印")
    mosaic: str = Field(description="有码/无码等信息, 用于预勾选水印")
    definition: str = Field(description="分辨率标记, 如 4K/8K")


class CutRequest(BaseModel):
    path: str = Field(description="要裁剪的图片路径")
    box: tuple[int, int, int, int] = Field(
        description="原图坐标系下的裁剪矩形 (左上x, 左上y, 右下x, 右下y)",
    )
    marks: list[str] = Field(default_factory=list, description="要叠加的水印, 如 ['4K', '字幕']")


@router.get("/poster/info", operation_id="getPosterInfo", summary="获取封面裁剪所需信息")
async def get_poster_info(
    path: Annotated[str, Query(description="封面图片路径")],
) -> PosterInfo:
    """返回图片尺寸、推导出的输出路径, 以及从番号信息中预判的水印选项.

    前端据此初始化裁剪框: 尺寸用于等比缩放与坐标换算, 水印字段用于预勾选复选框.
    """
    check_path_access(path, *SAFE_DIRS)
    img_path = Path(path)
    if not img_path.is_file():
        raise HTTPException(status_code=404, detail=f"图片不存在: {path}")

    def _size() -> tuple[int, int]:
        with Image.open(img_path) as img:
            return img.size

    width, height = await asyncio.to_thread(_size)
    poster_path, thumb_path, fanart_path = get_poster_paths(img_path)

    # 番号信息优先从自身文件名取, 拿不到时回退到同目录的 nfo —— 与桌面版一致
    probe_path = img_path
    if "-" not in img_path.stem:
        for sibling in img_path.parent.iterdir():
            if sibling.suffix == ".nfo":
                probe_path = sibling
                break
    info = await get_file_info_v2(probe_path, copy_sub=False)

    return PosterInfo(
        path=str(img_path),
        width=width,
        height=height,
        poster_path=str(poster_path),
        thumb_path=str(thumb_path),
        fanart_path=str(fanart_path),
        number=info.number or "",
        has_sub=bool(info.has_sub),
        mosaic=info.mosaic or "",
        definition=info.definition or "",
    )


@router.get("/poster/image", operation_id="getPosterImage", summary="读取封面原图")
async def get_poster_image(
    path: Annotated[str, Query(description="封面图片路径")],
) -> FileResponse:
    """返回图片二进制.

    前端需要用 fetch 取回再转成 blob URL —— img 标签无法携带 X-API-KEY 请求头,
    直接写 src 会在开启认证时拿到 401.
    """
    check_path_access(path, *SAFE_DIRS)
    img_path = Path(path)
    if not img_path.is_file():
        raise HTTPException(status_code=404, detail=f"图片不存在: {path}")
    return FileResponse(img_path)


@router.post("/poster/cut", operation_id="cutPoster", summary="裁剪封面")
async def cut_poster_api(body: CutRequest) -> dict[str, str]:
    """按给定矩形裁剪封面并写回.

    poster 会被裁剪替换, thumb 与 fanart 保留原图, 与桌面版裁剪窗口的行为一致.
    """
    check_path_access(body.path, *SAFE_DIRS)
    img_path = Path(body.path)
    if not img_path.is_file():
        raise HTTPException(status_code=404, detail=f"图片不存在: {body.path}")

    try:
        result = await cut_poster(img_path, body.box, body.marks)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"message": "裁剪完成", **result}
