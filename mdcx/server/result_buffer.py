"""刮削结果的环形缓冲.

成功/失败明细原本只靠 WebSocket 实时推送, 浏览器关闭期间的条目会永久丢失
(统计数字可通过 GET /scrape/status 恢复, 但列表是空的). 这里在服务端留存
最近若干条, 供页面加载时通过 GET /scrape/results 补回.

写入口在 ServerSignals 的信号回调里, 运行在后台刮削线程; 读入口在 API
协程里, 因此加锁保护.
"""

import threading
from collections import deque
from dataclasses import dataclass

# 与前端 store 的 MAX_RESULTS / MAX_FAILED_DETAILS 保持一致
MAX_RESULTS = 2000
MAX_FAILED_DETAILS = 2000


@dataclass
class ResultItem:
    status: str  # "succ" | "fail"
    name: str  # 列表显示名, 同 ShowData.show_name
    real_number: str  # 识别出的番号


class ResultBuffer:
    def __init__(self):
        self._results: deque[ResultItem] = deque(maxlen=MAX_RESULTS)
        self._failed_details: deque[str] = deque(maxlen=MAX_FAILED_DETAILS)
        self._lock = threading.Lock()

    def clear(self):
        """新一轮刮削开始时清空, 与前端"新一轮结果列表"的语义一致."""
        with self._lock:
            self._results.clear()
            self._failed_details.clear()

    def add_result(self, status: str, name: str, real_number: str):
        with self._lock:
            self._results.append(ResultItem(status=status, name=name, real_number=real_number))

    def add_failed_detail(self, text: str):
        with self._lock:
            self._failed_details.append(text)

    def snapshot(self) -> tuple[list[ResultItem], list[str]]:
        with self._lock:
            return list(self._results), list(self._failed_details)


result_buffer = ResultBuffer()
