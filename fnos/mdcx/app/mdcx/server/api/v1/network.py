"""Clash 内核管理: 订阅配置读写与状态查询.

配置文件经 compose 挂载进容器(``./clash:/clash-config``), 修改订阅时
按行替换 ``proxy-providers`` 段的 ``url``/``interval``(保留全部注释),
删除内核的订阅缓存后调用 9090 外部控制接口热重载, 全程无需手工编辑文件.
"""

from __future__ import annotations

import os
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/network", tags=["网络"])

# compose 里 mdcx 服务的挂载点, 右边对应 clash 容器的 /root/.config/mihomo.
# 本地开发可用 MDCX_CLASH_CONFIG_DIR 指向一份真实的 clash 配置目录.
CLASH_CONFIG_DIR = Path(os.environ.get("MDCX_CLASH_CONFIG_DIR", "/clash-config"))
CLASH_CONFIG = CLASH_CONFIG_DIR / "config.yaml"
# 用容器名而非服务名: compose 重建过程中服务名别名可能未注入网络,
# 容器名则始终由 Docker DNS 解析(实测 clash 服务名解析失败过).
CLASH_API = os.environ.get("MDCX_CLASH_API", "http://mdcx-clash:9090")
# 保留最近 N 份 config.yaml.bak-*
BACKUP_KEEP = 5

_PROVIDER_SECTION = re.compile(r"^proxy-providers:\s*(?:#.*)?$")
_PROVIDER_ITEM = re.compile(r"^(\s+)([^:\s#][^:]*):\s*(?:#.*)?$")
_PROVIDER_FIELD = re.compile(r"^(\s+)(url|interval|path):\s*(.*?)\s*(?:\s(#.*))?$")


def _strip_value(raw: str) -> str:
    """去掉 YAML 标量两侧的引号."""
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
        return raw[1:-1]
    return raw


def parse_provider(text: str) -> dict[str, Any]:
    """解析 ``proxy-providers`` 下第一个订阅源, 返回名称与字段行号.

    返回::

        {"name": ..., "url": ..., "interval": ..., "path": ...,
         "fields": {"url": 行号, "interval": 行号, "path": 行号}}

    行号以 0 起; 字段缺失时值为 None、行号不出现在 fields 里.
    找不到 ``proxy-providers`` 段或段下没有任何源时抛 ValueError.
    """
    lines = text.splitlines()
    name: str | None = None
    item_start = item_end = -1
    section_start = -1
    for i, line in enumerate(lines):
        if section_start < 0:
            if _PROVIDER_SECTION.match(line):
                section_start = i
            continue
        if not line.strip() or line.lstrip().startswith("#"):
            if item_start >= 0 and item_end < 0:
                item_end = i  # 段内空行不结束, 继续找下一个二级键时再判定
            continue
        # 段遇到顶格新键即结束
        if not line[0].isspace():
            break
        m = _PROVIDER_ITEM.match(line)
        if m:
            if item_start >= 0:
                item_end = i
                break
            name = m.group(2).strip()
            item_start = i
    if section_start < 0:
        raise ValueError("配置中没有 proxy-providers 段")
    if name is None or item_start < 0:
        raise ValueError("proxy-providers 段下没有任何订阅源")
    if item_end < 0:
        item_end = len(lines)

    fields: dict[str, int] = {}
    values: dict[str, str] = {}
    for i in range(item_start + 1, item_end):
        m = _PROVIDER_FIELD.match(lines[i])
        if m and len(m.group(1)) > len(_PROVIDER_ITEM.match(lines[item_start]).group(1)):  # type: ignore[union-attr]
            fields[m.group(2)] = i
            values[m.group(2)] = m.group(3)
    result: dict[str, Any] = {"name": name, "fields": fields}
    for key in ("url", "interval", "path"):
        result[key] = _strip_value(values[key]) if key in values else None
    if "interval" in values:
        try:
            result["interval"] = int(result["interval"])  # type: ignore[arg-type]
        except (TypeError, ValueError):
            result["interval"] = None
    return result


def update_provider_text(
    text: str, url: str | None, interval_seconds: int | None, expect_name: str | None = None
) -> str:
    """按行替换订阅源的 url/interval, 返回新配置文本(注释与其余内容原样保留)."""
    info = parse_provider(text)
    if expect_name is not None and info["name"] != expect_name:
        raise ValueError(f"订阅源名称不匹配: {info['name']}")
    lines = text.splitlines()
    fields: dict[str, int] = info["fields"]

    if url is not None:
        if "url" in fields:
            i = fields["url"]
            m = _PROVIDER_FIELD.match(lines[i])
            comment = f" {m.group(4)}" if m and m.group(4) else ""  # type: ignore[union-attr]
            lines[i] = f'{m.group(1)}url: "{url}"{comment}'  # type: ignore[union-attr]
        else:
            # 没有 url 行则插到源块的 key 行之后
            lines.insert(info["fields"] and min(fields.values()) or 0, f'    url: "{url}"')
    if interval_seconds is not None:
        if "interval" in fields:
            i = fields["interval"]
            m = _PROVIDER_FIELD.match(lines[i])
            indent = m.group(1) if m else "    "  # type: ignore[union-attr]
            comment = f" {m.group(4)}" if m and m.group(4) else ""  # type: ignore[union-attr]
            lines[i] = f"{indent}interval: {interval_seconds}{comment}"
        else:
            anchor = fields.get("url")
            if anchor is None:
                raise ValueError("订阅源块内没有可定位的行来插入 interval")
            m = _PROVIDER_FIELD.match(lines[anchor])
            indent = m.group(1) if m else "    "
            lines.insert(anchor + 1, f"{indent}interval: {interval_seconds}")
    return "\n".join(lines) + ("\n" if text.endswith("\n") else "")


def _read_config() -> str:
    if not CLASH_CONFIG.is_file():
        raise HTTPException(
            status_code=400,
            detail="未找到 Clash 配置文件. 请确认 docker-compose.yml 中 mdcx 服务已挂载 ./clash:/clash-config",
        )
    return CLASH_CONFIG.read_text(encoding="utf-8")


def _parse_secret(text: str) -> str | None:
    for line in text.splitlines():
        m = re.match(r"^secret:\s*(.+?)\s*$", line)
        if m:
            val = _strip_value(m.group(1))
            return val or None
    return None


def read_panel_secret() -> str | None:
    """读取 clash 配置里的面板 secret, 供 APIKeyHeader 校验面板来源请求."""
    if not CLASH_CONFIG.is_file():
        return None
    try:
        return _parse_secret(CLASH_CONFIG.read_text(encoding="utf-8"))
    except OSError:
        return None


def _backup_config() -> None:
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(CLASH_CONFIG, CLASH_CONFIG.with_name(f"config.yaml.bak-{ts}"))
    backups = sorted(CLASH_CONFIG.parent.glob("config.yaml.bak-*"))
    for old in backups[:-BACKUP_KEEP]:
        try:
            old.unlink()
        except OSError:
            pass


def _auth_headers(secret: str | None) -> dict[str, str]:
    return {"Authorization": f"Bearer {secret}"} if secret else {}


async def _clash_request(method: str, path: str, secret: str | None, **kwargs: Any) -> Any:
    async with httpx.AsyncClient(timeout=8) as client:
        resp = await client.request(method, f"{CLASH_API}{path}", headers=_auth_headers(secret), **kwargs)
        resp.raise_for_status()
        if resp.headers.get("content-type", "").startswith("application/json"):
            return resp.json()
        return None


class ClashStatus(BaseModel):
    config_available: bool = Field(description="容器内能否读到 clash/config.yaml")
    provider_name: str | None = Field(default=None, description="proxy-providers 下的订阅源名称")
    subscription_url: str | None = Field(default=None, description="当前订阅地址")
    update_interval_hours: float | None = Field(default=None, description="自动更新间隔(小时)")
    panel_secret: str | None = Field(default=None, description="面板(9090)登录密码")
    kernel_reachable: bool = Field(description="能否连上 mihomo 内核")
    kernel_version: str | None = Field(default=None, description="内核版本")
    kernel_error: str | None = Field(default=None, description="内核连接/认证失败原因")
    provider_updated_at: str | None = Field(default=None, description="订阅上次成功更新时间")
    provider_proxies_count: int | None = Field(default=None, description="订阅当前提供的节点数")
    provider_error: str | None = Field(default=None, description="订阅加载失败原因")


class SubscriptionUpdate(BaseModel):
    url: str = Field(description="订阅地址(http/https)")
    update_interval_hours: float = Field(default=1, gt=0, le=720, description="自动更新间隔(小时)")


async def _collect_status(text: str | None) -> ClashStatus:
    if text is None:
        return ClashStatus(config_available=False, kernel_reachable=False)
    secret = _parse_secret(text)
    status = ClashStatus(config_available=True, panel_secret=secret, kernel_reachable=False)
    try:
        info = parse_provider(text)
        status.provider_name = info["name"]
        status.subscription_url = info["url"]
        if info["interval"]:
            status.update_interval_hours = info["interval"] / 3600
    except ValueError:
        pass

    try:
        version = await _clash_request("GET", "/version", secret)
        status.kernel_reachable = True
        if isinstance(version, dict):
            status.kernel_version = version.get("version")
    except httpx.HTTPStatusError as e:
        # 能收到 HTTP 响应说明内核在线, 401 即密码不对
        status.kernel_reachable = e.response.status_code < 500
        status.kernel_error = (
            "面板密码(secret)不正确" if e.response.status_code == 401 else f"内核返回 {e.response.status_code}"
        )
        return status
    except (httpx.HTTPError, ValueError) as e:
        status.kernel_error = f"无法连接内核(http://{CLASH_API.removeprefix('http://')}): {e.__class__.__name__}"
        return status

    if status.provider_name:
        try:
            data = await _clash_request("GET", "/providers/proxies", secret)
            provider = (data or {}).get("providers", {}).get(status.provider_name)
            if provider is None:
                status.provider_error = "内核未加载该订阅源(检查配置或查看内核日志)"
            else:
                status.provider_updated_at = provider.get("updatedAt")
                proxies = provider.get("proxies")
                if isinstance(proxies, list):
                    status.provider_proxies_count = len(proxies)
        except (httpx.HTTPError, ValueError) as e:
            status.provider_error = f"读取订阅状态失败: {e.__class__.__name__}"
    return status


@router.get("/clash", response_model=ClashStatus, summary="获取 Clash 内核与订阅状态")
async def get_clash_status() -> ClashStatus:
    text = None
    if CLASH_CONFIG.is_file():
        text = CLASH_CONFIG.read_text(encoding="utf-8")
    return await _collect_status(text)


@router.put("/clash/subscription", response_model=ClashStatus, summary="设置订阅地址并重载内核")
async def update_subscription(body: SubscriptionUpdate) -> ClashStatus:
    url = body.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="订阅地址必须以 http:// 或 https:// 开头")
    text = _read_config()
    try:
        interval_seconds = int(round(body.update_interval_hours * 3600))
        new_text = update_provider_text(text, url=url, interval_seconds=interval_seconds)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    _backup_config()
    CLASH_CONFIG.write_text(new_text, encoding="utf-8")

    # 删掉内核缓存的订阅文件, 迫使重载后按新地址重新拉取
    try:
        info = parse_provider(new_text)
        if info.get("path") and str(info["path"]).startswith("./"):
            (CLASH_CONFIG_DIR / str(info["path"])[2:]).unlink(missing_ok=True)
    except ValueError:
        pass

    secret = _parse_secret(new_text)
    try:
        await _clash_request("PUT", "/configs?force=true", secret, json={})
    except httpx.HTTPStatusError as e:
        detail = "面板密码(secret)不正确" if e.response.status_code == 401 else f"内核返回 {e.response.status_code}"
        raise HTTPException(
            status_code=502,
            detail=f"配置已写入文件, 但内核重载失败({detail}). 可稍后重试或重启 mdcx-clash 容器",
        ) from e
    except (httpx.HTTPError, ValueError) as e:
        raise HTTPException(
            status_code=502,
            detail=f"配置已写入文件, 但无法连接内核重载({e.__class__.__name__}). 可重启 mdcx-clash 容器生效",
        ) from e
    return await _collect_status(new_text)
