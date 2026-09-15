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

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from mdcx.base.file import save_success_list
from mdcx.models.flags import Flags
from mdcx.signals import signal
from mdcx.utils import executor

router = APIRouter(prefix="/scrape", tags=["刮削控制"])


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
