"""定时自动刮削调度器.

桌面版有定时刮削, 转 Web 时逻辑丢了但配置字段留着 (switch_on 里的 timed_scrape
开关 + timed_interval 间隔). 这里用 asyncio 后台任务把功能接回来:

- 每 30 秒检查一次: 开关打开、后台空闲、距上次运行超过设定间隔 → 自动开一轮刮削
- 上次运行时间持久化到用户数据目录, 重启不重置
- 首次启动只记录基准时间, 不立即触发 (避免 NAS 重启就突进刮削)
- 每次循环都读当前配置, 改设置立即生效, 无需重启
"""

import asyncio
import json
import time
from pathlib import Path

from mdcx.config.enums import Switch
from mdcx.server.result_buffer import default_history_file

STATE_FILE_NAME = "timed_scrape.json"
TICK_SECONDS = 30


def _state_file() -> Path:
    return default_history_file().parent / STATE_FILE_NAME


class TimedScraper:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._last_run: float = 0.0
        self._next_run: float = 0.0

    def _load(self) -> None:
        try:
            data = json.loads(_state_file().read_text(encoding="utf-8"))
            self._last_run = float(data.get("last_run", 0.0))
        except Exception:
            self._last_run = 0.0

    def _save(self) -> None:
        try:
            f = _state_file()
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps({"last_run": self._last_run}), encoding="utf-8")
        except Exception:
            pass

    def start(self) -> None:
        if self._task is not None:
            return
        self._load()
        self._task = asyncio.get_running_loop().create_task(self._loop(), name="timed-scraper")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(TICK_SECONDS)
            try:
                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                pass  # 调度器任何异常都不应拖垮服务

    async def _tick(self) -> None:
        from mdcx.config.manager import manager
        from mdcx.signals import signal
        from mdcx.utils import executor

        cfg = manager.config
        if Switch.TIMED_SCRAPE not in cfg.switch_on:
            self._next_run = 0.0
            return
        if executor.busy:  # 手动刮削进行中, 不抢跑
            return
        interval = max(cfg.timed_interval.total_seconds(), 60.0)
        now = time.time()
        if self._last_run <= 0.0:
            # 首次只记录基准, 避免服务一启动就刮
            self._last_run = now
            self._save()
            return
        if now - self._last_run < interval:
            self._next_run = self._last_run + interval
            return

        self._last_run = now
        self._next_run = now + interval
        self._save()
        signal.show_log_text(f" ⏰ 定时刮削触发 ({time.strftime('%H:%M:%S')})")
        errors = manager.load()
        if errors:
            signal.show_log_text(f" ⚠️ 配置加载失败, 本轮定时刮削跳过: {', '.join(errors)}")
            return
        from mdcx.core.scraper import start_new_scrape
        from mdcx.models.enums import FileMode

        start_new_scrape(FileMode.Default)

    def status(self) -> dict:
        """供状态接口展示: 是否开启与下次运行时间."""
        from mdcx.config.manager import manager

        enabled = Switch.TIMED_SCRAPE in manager.config.switch_on
        interval = max(manager.config.timed_interval.total_seconds(), 60.0)
        next_run = self._next_run
        if enabled and next_run <= 0 and self._last_run > 0:
            next_run = self._last_run + interval  # tick 还没跑过时先按上次运行时间推算
        if not enabled or next_run <= 0:
            next_run = 0.0
        return {
            "timed_enabled": enabled,
            "timed_interval_seconds": interval,
            "timed_last_run": self._last_run,
            "timed_next_run": next_run,
        }


timed_scraper = TimedScraper()
