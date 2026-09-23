"""业务信号的分发入口.

原先这里同时支持 Qt 与 Web 两套实现, 摘除桌面版后只剩服务端一种:
``server.signals.ServerSignals`` 把业务信号转成 WebSocket 消息推给浏览器.

业务模块统一通过 ``from ..signals import signal`` 取用. 该写法拿到的是模块属性
在导入那一刻的值, 因此 server.py 必须在业务模块被导入之前调用 ``set_signal()``
—— 这一点由 ``create_app()`` 中 ``init()`` 的执行顺序保证.

命令行工具(crawl 等)不走服务端, 默认使用 :class:`ConsoleSignals`, 把日志直接
打到标准输出.
"""

from typing import TYPE_CHECKING, Any

from .models.types import ShowData
from .server.var import is_server

if TYPE_CHECKING:
    from .server.signals import ServerSignals


class _NoopSignal:
    """占位信号: 命令行场景下无人关心的信号直接丢弃."""

    def emit(self, *args: Any, **kwargs: Any) -> None:
        pass


class ConsoleSignals:
    """命令行模式下的信号实现, 把日志写到标准输出."""

    def __init__(self) -> None:
        self.stop = False

    def __getattr__(self, name: str) -> _NoopSignal:
        # 未显式定义的信号(如 exec_set_processbar)一律静默丢弃
        return _NoopSignal()

    def add_log(self, *text: Any) -> None:
        print(" ".join(str(t) for t in text))

    def get_log(self) -> str:
        return ""

    def show_traceback_log(self, text: str) -> None:
        print(text)

    def show_log_text(self, text: str) -> None:
        print(text)

    def show_scrape_info(self, before_info: str = "") -> None:
        if before_info:
            print(before_info)

    def show_net_info(self, text: str) -> None:
        print(text)

    def set_main_info(self, show_data: ShowData | None = None) -> None:
        pass

    def show_list_name(self, status: str, show_data: ShowData, real_number: str = "") -> None:
        print(f"{status}: {real_number or show_data.show_name}")


signal: "ServerSignals | ConsoleSignals | None"

if is_server:
    # 服务端模式下由 server.py 的 init() 注入 ServerSignals
    signal = None
else:
    signal = ConsoleSignals()


def set_signal(signal_instance: "ServerSignals") -> None:
    global signal
    signal = signal_instance
