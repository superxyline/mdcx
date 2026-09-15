import threading
import time
from typing import TYPE_CHECKING, Literal

from .models.types import ShowData
from .server.var import is_server
from .utils import singleton

if TYPE_CHECKING:
    from .server.signals import ServerSignals

# 信号实现的两种形态:
# - Qt 版: 本模块的 Signals(pyqtSignal), 由 Qt 控制器连接
# - 服务端版: server.signals.ServerSignals, 把信号转成 WebSocket 广播
#
# 服务端模式下刻意不导入 PyQt5: Linux 容器与无图形环境里没有 Qt 运行库, 顶层
# import PyQt5.QtCore 会直接失败. 业务模块统一通过 `from ..signals import signal`
# 取用信号对象, 因此 server.py 必须在业务模块被导入之前调用 set_signal(), 这一点
# 由 create_app() 的执行顺序保证.
signal: "Signals | ServerSignals | None"


def set_signal(signal_instance: "Signals | ServerSignals"):
    global signal
    signal = signal_instance


if is_server:
    signal = None
else:
    from PyQt5.QtCore import QObject, pyqtSignal

    @singleton
    class Signals(QObject):
        # region signal
        log_text = pyqtSignal(str)
        scrape_info = pyqtSignal(str)
        net_info = pyqtSignal(str)
        exec_set_main_info = pyqtSignal(ShowData)  # 主界面更新番号信息
        change_buttons_status = pyqtSignal()
        reset_buttons_status = pyqtSignal()
        set_label_file_path = pyqtSignal(str)
        label_result = pyqtSignal(str)
        logs_failed_settext = pyqtSignal(str)  # 失败面板添加信息日志信号
        view_success_file_settext = pyqtSignal(str)
        exec_set_processbar = pyqtSignal(int)  # 进度条信号量
        exec_exit_app = pyqtSignal()  # 退出信号量
        view_failed_list_settext = pyqtSignal(str)
        exec_show_list_name = pyqtSignal(str, ShowData, str)
        logs_failed_show = pyqtSignal(str)  # 失败面板添加信息日志信号

        # endregion
        def __init__(self):
            super().__init__()
            self.log_lock = threading.Lock()
            self.detail_log_list = []
            self.stop = False

        def add_log(self, *text):
            """打印日志到日志页下方详情框"""
            if self.stop:
                return
            try:
                with self.log_lock:
                    self.detail_log_list.append(f" ⏰ {time.strftime('%H:%M:%S', time.localtime())} {' '.join(text)}")
            except Exception:
                pass

        def get_log(self):
            with self.log_lock:
                text = "\n".join(self.detail_log_list)
                self.detail_log_list = []
            return text

        def show_traceback_log(self, text):
            print(text)
            self.add_log(text)

        def show_log_text(self, text):
            self.log_text.emit(text)

        def show_scrape_info(self, before_info=""):
            self.scrape_info.emit(before_info)

        def show_net_info(self, text):
            self.net_info.emit(text)

        def set_main_info(self, show_data=None):
            if show_data is None:
                show_data = ShowData.empty()
            self.exec_set_main_info.emit(show_data)

        def show_list_name(self, status: Literal["succ", "fail"], show_data: ShowData, real_number=""):
            self.exec_show_list_name.emit(status, show_data, real_number)

    signal_qt = Signals()
    signal = signal_qt
