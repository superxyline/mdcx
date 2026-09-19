"""刮削控制与状态查询.

桌面版把进度直接绘制在 Qt 控件上; 服务端版通过本模块暴露给浏览器.

刮削任务运行在 :class:`AsyncBackgroundExecutor` 的独立后台线程事件循环中,
既不绑定 HTTP 请求也不绑定 WebSocket 连接, 因此浏览器关闭后刮削仍会继续.
重新打开页面时调用 ``GET /scrape/status`` 即可恢复当前进度, 无需依赖
错过的 WebSocket 历史消息.
"""

from __future__ import annotations

import asyncio
import time
import xml.etree.ElementTree as ET
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from mdcx.base.file import save_success_list
from mdcx.models.flags import Flags
from mdcx.server.api.v1.utils import check_path_access
from mdcx.server.config import SAFE_DIRS
from mdcx.server.result_buffer import ResultItem, result_buffer
from mdcx.signals import signal
from mdcx.utils import executor

router = APIRouter(prefix="/scrape", tags=["刮削控制"])

# 历史导入的保护上限, 防止路径配错时扫描整个磁盘
MAX_BACKFILL_SCAN = 20000


def _resolve_output_root(manager) -> Path:
    """成功输出目录的绝对路径; 相对路径优先按工作目录解释, 否则以媒体路径为基准."""
    end_folder_name = Path(manager.config.media_path or ".").name
    out = Path(manager.config.success_output_folder.replace("end_folder_name", end_folder_name))
    if out.is_absolute():
        return out
    if out.exists():  # 开发环境等相对当前工作目录的写法 (如 "./media/JAV_output")
        return out
    movie_path = Path(manager.config.media_path) if manager.config.media_path else Path(manager.data_folder)
    return movie_path / out


def _find_nfo_files(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    found = [p for p in root.rglob("*.nfo") if p.is_file()][:MAX_BACKFILL_SCAN]
    return sorted(found)


def _nfo_to_result(nfo: Path, media_types: list[str]) -> ResultItem | None:
    """从 NFO 文件还原一条成功记录; 解析失败返回 None."""
    try:
        root = ET.parse(nfo).getroot()
    except Exception:
        return None

    def text(tag: str) -> str:
        el = root.find(tag)
        return el.text.strip() if el is not None and el.text else ""

    title = text("title")
    number = text("num") or text("number") or nfo.parent.name
    release = text("releasedate") or text("premiered")
    actors = ",".join(
        name.text.strip() for name in root.findall("actor/name") if name.text and name.text.strip()
    )
    video_exts = {ext.lower() for ext in media_types}
    video = next((p for p in nfo.parent.iterdir() if p.suffix.lower() in video_exts), None)
    poster, fanart = nfo.parent / "poster.jpg", nfo.parent / "fanart.jpg"
    try:
        ts = nfo.stat().st_mtime
    except OSError:
        ts = 0.0
    return ResultItem(
        status="succ",
        name=title or number,
        real_number=number,
        ts=ts,
        detail={
            "title": title,
            "actors": actors,
            "release": release,
            "year": release[:4] if release else "",
            "number": number,
            "mosaic": text("mosaic"),
            "poster_path": str(poster) if poster.is_file() else "",
            "fanart_path": str(fanart) if fanart.is_file() else "",
            "file_path": str(video) if video else "",
            "folder_path": str(nfo.parent),
            "nfo_path": str(nfo),
        },
    )


class ScrapeStatus(BaseModel):
    """当前刮削状态快照."""

    running: bool = Field(description="后台是否仍有刮削任务在运行")
    file_mode: int = Field(description="刮削模式, 对应 FileMode: 0=默认 1=单文件 2=重新刮削")
    total: int = Field(description="任务总数")
    started: int = Field(description="已进入刮削流程的数量")
    done: int = Field(description="已完成数量")
    success: int = Field(description="成功数量")
    failed: int = Field(description="失败数量")
    progress: int = Field(description="进度百分比 (0-100)")
    start_time: float = Field(description="本轮开始时间戳")
    elapsed: float = Field(description="已用时间 (秒)")
    remain: int = Field(description="剩余待刮削文件数量")


class ScrapeResultEntry(BaseModel):
    status: str = Field(description='"succ" 或 "fail"')
    name: str = Field(description="列表显示名")
    real_number: str = Field(description="识别出的番号")
    ts: float = Field(default=0, description="记录时间戳; 历史导入的条目为 NFO 修改时间")
    detail: dict | None = Field(default=None, description="预览元数据 (标题/演员/封面路径等), 可能为空")


class ScrapeResults(BaseModel):
    """刮削结果明细, 服务端留存的部分 (跨重启持久化, 持续累积)."""

    results: list[ScrapeResultEntry]
    failed_details: list[str] = Field(description="失败原因明细, 与 results 中 fail 条目按时间对应")


@router.get("/results", operation_id="getScrapeResults", summary="获取刮削结果明细")
async def get_scrape_results() -> ScrapeResults:
    """返回服务端留存的结果明细, 页面加载时用它补回错过的 WebSocket 推送."""
    results, failed_details = result_buffer.snapshot()
    return ScrapeResults(
        results=[
            ScrapeResultEntry(
                status=r.status, name=r.name, real_number=r.real_number, ts=r.ts, detail=r.detail
            )
            for r in results
        ],
        failed_details=failed_details,
    )


class BackfillResponse(BaseModel):
    """历史导入结果."""

    scanned: int = Field(description="扫描到的 NFO 文件数量")
    imported: int = Field(description="新导入的记录数量 (已存在的自动跳过)")


@router.post("/backfill", operation_id="backfillHistory", summary="从媒体库导入历史刮削记录")
async def backfill_history() -> BackfillResponse:
    """扫描成功输出目录里的 NFO 文件, 把之前刮削好的影片回填成成功记录.

    用于老用户升级后把历史成果找回结果列表; 按 NFO/文件路径去重, 重复导入无害.
    """
    from mdcx.config.manager import manager

    root = _resolve_output_root(manager)
    try:
        check_path_access(root, *SAFE_DIRS)
    except HTTPException:
        raise HTTPException(
            status_code=400,
            detail=f"成功输出目录不在可访问范围内: {root}. 请先在设置里把它配置到媒体库路径之下.",
        )
    nfo_files = await asyncio.to_thread(_find_nfo_files, root)
    existing = result_buffer.existing_keys()
    imported = 0
    for nfo in nfo_files:
        if str(nfo) in existing:
            continue
        item = await asyncio.to_thread(_nfo_to_result, nfo, manager.config.media_type)
        if item is None:
            continue
        result_buffer.add_result(item.status, item.name, item.real_number, detail=item.detail, ts=item.ts)
        imported += 1
    return BackfillResponse(scanned=len(nfo_files), imported=imported)


@router.get("/status", operation_id="getScrapeStatus", summary="获取刮削状态")
async def get_scrape_status() -> ScrapeStatus:
    """返回当前刮削进度与统计."""
    total = Flags.total_count
    started = Flags.scrape_started
    elapsed = time.time() - Flags.start_time if Flags.start_time else 0.0
    return ScrapeStatus(
        running=executor.busy,
        file_mode=Flags.file_mode.value,
        total=total,
        started=started,
        done=Flags.scrape_done,
        success=Flags.succ_count,
        failed=Flags.fail_count,
        progress=int(started / total * 100) if total else 0,
        start_time=Flags.start_time,
        elapsed=round(elapsed, 2),
        remain=len(Flags.remain_list),
    )


@router.post("/stop", operation_id="stopScrape", summary="停止刮削")
async def stop_scrape() -> dict[str, str]:
    """停止正在进行的刮削.

    与桌面版行为一致: 先保存已成功列表, 再取消后台任务.
    """
    if not executor.busy:
        raise HTTPException(status_code=400, detail="当前没有正在进行的刮削任务.")

    # executor.run 会阻塞直到该协程执行完毕, 放到线程中避免阻塞事件循环
    await asyncio.to_thread(executor.run, save_success_list())
    Flags.rest_time_convert_ = Flags.rest_time_convert
    Flags.rest_time_convert = 0
    signal.show_scrape_info("⛔️ 刮削停止中...")
    executor.cancel_async()
    return {"message": "已发送停止指令, 正在停止刮削."}
