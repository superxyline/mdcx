"""服务端交互式提问.

Qt 版通过 ``QMessageBox.exec()`` 同步阻塞等待用户选择, 服务端模式下没有等价的
同步 UI. 这里把问题通过 WebSocket 推给浏览器, 由前端弹出对话框, 用户选择后调用
HTTP 接口回填答案, 后台刮削线程继续执行.

问题不绑定具体连接: 用户关闭或刷新浏览器不会丢失待答问题, 重连后可通过
``GET /api/v1/ask/pending`` 重新拿到并继续作答.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

from .ws.manager import websocket_manager
from .ws.types import MessageType, WebSocketMessage

# 无人应答时的等待上限, 避免后台任务永久挂起
DEFAULT_ASK_TIMEOUT = 1800.0


@dataclass
class AskOption:
    """问题的一个可选项."""

    value: str
    label: str
    style: Literal["primary", "default", "danger"] = "default"


@dataclass
class PendingAsk:
    """一个等待回答的问题."""

    question_id: str
    question: str
    options: list[AskOption]
    detail: str
    created_at: float
    future: concurrent.futures.Future[str] = field(repr=False)
    image_url: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "question_id": self.question_id,
            "question": self.question,
            "detail": self.detail,
            "options": [{"value": o.value, "label": o.label, "style": o.style} for o in self.options],
            "created_at": self.created_at,
            "image_url": self.image_url,
        }


class AskManager:
    """跨线程的问题/答案中转站.

    ``ask`` 在后台刮削线程中阻塞等待, ``answer`` 由 HTTP 请求线程调用.
    """

    def __init__(self) -> None:
        self._pending: dict[str, PendingAsk] = {}
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """由应用启动时调用, 记录主事件循环以便从后台线程投递广播."""
        self._loop = loop

    def ask(
        self,
        question: str,
        options: list[AskOption],
        detail: str = "",
        timeout: float = DEFAULT_ASK_TIMEOUT,
        image_url: str = "",
    ) -> str | None:
        """提问并阻塞等待回答.

        超时或短时间内无人连接时返回 None, 调用方应视作"取消".
        """
        if not options:
            raise ValueError("options 不能为空")

        pending = PendingAsk(
            question_id=str(uuid.uuid4()),
            question=question,
            options=options,
            detail=detail,
            created_at=time.time(),
            future=concurrent.futures.Future(),
            image_url=image_url,
        )
        with self._lock:
            self._pending[pending.question_id] = pending

        self._broadcast(pending)

        try:
            return pending.future.result(timeout=timeout)
        except concurrent.futures.TimeoutError:
            return None
        finally:
            with self._lock:
                self._pending.pop(pending.question_id, None)

    def answer(self, question_id: str, value: str) -> bool:
        """回填答案, 返回是否命中一个待答问题."""
        with self._lock:
            pending = self._pending.get(question_id)
        if pending is None or pending.future.done():
            return False
        if value not in {o.value for o in pending.options}:
            return False
        pending.future.set_result(value)
        return True

    def list_pending(self) -> list[dict[str, Any]]:
        """列出未回答的问题, 供前端刷新后恢复弹窗."""
        with self._lock:
            items = list(self._pending.values())
        return [p.to_dict() for p in items]

    def _broadcast(self, pending: PendingAsk) -> None:
        loop = self._loop
        if loop is None or not loop.is_running():
            # 事件循环尚未就绪(或已关闭), 问题会一直等到超时
            return
        message = WebSocketMessage(type=MessageType.ASK, data=pending.to_dict())
        asyncio.run_coroutine_threadsafe(websocket_manager.broadcast(message), loop)


ask_manager = AskManager()
