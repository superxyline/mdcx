"""刮削完成后的通知推送与媒体服务器刷新.

在每轮刮削结束(core/scraper.py)时调用 :func:`notify_scrape_finished`.
设计原则: 通知只是锦上添花, 任何失败都不能影响刮削主流程, 全部吞掉并写日志.
"""

import httpx

from mdcx.config.manager import manager
from mdcx.signals import signal

TIMEOUT = 15.0


def _log(text: str) -> None:
    signal.show_log_text(text)


def _summary_text(total: int, succ: int, failed: int, used_time: str) -> str:
    return f"成功 {succ} / 失败 {failed}, 共 {total} 个, 用时 {used_time}s"


async def _send_bark(summary: str) -> None:
    cfg = manager.config
    from urllib.parse import quote

    base = cfg.bark_url.rstrip("/")
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.get(f"{base}/{cfg.bark_key}/{quote('MDCx 刮削完成')}/{quote(summary)}")
        resp.raise_for_status()
    _log(f" 🔔 Bark 通知已发送: {summary}")


async def _send_telegram(summary: str) -> None:
    cfg = manager.config
    proxy = cfg.proxy if cfg.use_proxy else None
    async with httpx.AsyncClient(timeout=TIMEOUT, proxy=proxy) as client:
        resp = await client.get(
            f"https://api.telegram.org/bot{cfg.telegram_bot_token}/sendMessage",
            params={"chat_id": cfg.telegram_chat_id, "text": f"MDCx 刮削完成\n{summary}"},
        )
        resp.raise_for_status()
    _log(f" 🔔 Telegram 通知已发送: {summary}")


async def _refresh_media_server() -> None:
    """调用 Emby/Jellyfin 的整库刷新接口 (局域网直连, 不走代理)."""
    cfg = manager.config
    base = str(cfg.emby_url).rstrip("/")
    # Emby 与 Jellyfin 都接受 /emby 前缀, 统一用它兼容两种服务器
    refresh_url = f"{base}/emby/Library/Refresh"
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(refresh_url, params={"api_key": cfg.api_key})
        resp.raise_for_status()
    _log(f" 📺 已通知媒体服务器刷新媒体库: {base}")


async def notify_scrape_finished(total: int, succ: int, failed: int, used_time: str) -> None:
    """刮削完成钩子: 按配置推送通知并刷新媒体库, 任何异常只记日志."""
    summary = _summary_text(total, succ, failed, used_time)
    try:
        match manager.config.notify_type:
            case "bark":
                if manager.config.bark_key:
                    await _send_bark(summary)
            case "telegram":
                if manager.config.telegram_bot_token and manager.config.telegram_chat_id:
                    await _send_telegram(summary)
            case _:
                pass
    except Exception as e:
        _log(f" ⚠️ 发送完成通知失败: {e}")

    try:
        if manager.config.emby_refresh and manager.config.api_key:
            await _refresh_media_server()
    except Exception as e:
        _log(f" ⚠️ 通知媒体服务器刷新失败: {e}")
