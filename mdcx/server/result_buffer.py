"""刮削结果的环形缓冲 + 磁盘持久化.

成功/失败明细原本只靠 WebSocket 实时推送, 浏览器关闭期间的条目会永久丢失;
后来加了服务端内存留存, 但容器一重启照样全丢, 每轮刮削还会清空一次 ——
用户因此永远只能在列表里看到"本轮"的结果.

现在内存缓冲之外, 每条记录还会追加写入用户数据目录的 scrape_history.jsonl,
启动时自动加载. 记录支持单条删除与按列表清空 (同步重写磁盘文件), 跨轮次
只保留同一影片的最新一条 (失败后重试成功, 失败条目自动消失); 每轮完整刮削
(手动开始/定时触发) 开始时清空全部旧记录.

文件每行一个 JSON 对象:
  {"type": "result", "id": ..., "status": ..., "name": ..., "real_number": ...,
   "ts": ..., "detail": {...}}   成功/失败条目, detail 为预览所需的元数据
  {"type": "fail_detail", "text": "...", "ts": ...}   失败原因明细

写入口在 ServerSignals 的信号回调里, 运行在后台刮削线程; 读入口在 API
协程里, 因此加锁保护.
"""

import json
import os
import threading
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path

from mdcx.consts import MARK_FILE

# 与前端 store 的 MAX_RESULTS / MAX_FAILED_DETAILS 保持一致
MAX_RESULTS = 2000
MAX_FAILED_DETAILS = 2000
HISTORY_FILE_NAME = "scrape_history.jsonl"


def default_history_file() -> Path:
    """用户数据目录 = 当前配置文件所在目录 (容器内为 /data)."""
    try:
        config_path = Path(MARK_FILE.read_text(encoding="utf-8").strip())
        return config_path.parent / HISTORY_FILE_NAME
    except Exception:
        return Path(HISTORY_FILE_NAME)


@dataclass
class ResultItem:
    id: int  # 自增唯一 id, 用于单条删除
    status: str  # "succ" | "fail"
    name: str  # 列表显示名, 同 ShowData.show_name
    real_number: str  # 识别出的番号
    ts: float = 0.0  # 记录时间戳 (回填的历史记录用 NFO 修改时间)
    detail: dict | None = None  # 预览所需的元数据, 结构见 signals._result_detail


def _identity(real_number: str, name: str) -> str:
    """影片身份: 番号优先, 无番号退回显示名."""
    return (real_number or name).strip().lower()


class ResultBuffer:
    def __init__(self, history_file: Path | None = None):
        self._results: deque[ResultItem] = deque(maxlen=MAX_RESULTS)
        self._failed_details: deque[str] = deque(maxlen=MAX_FAILED_DETAILS)
        self._lock = threading.Lock()
        self._history_file = history_file
        self._next_id = 0
        if history_file is not None:
            self._load()

    @classmethod
    def create_default(cls) -> "ResultBuffer":
        return cls(history_file=default_history_file())

    def _load(self) -> None:
        if self._history_file is None or not self._history_file.is_file():
            return
        try:
            lines = self._history_file.read_text(encoding="utf-8", errors="ignore").splitlines()
        except Exception:
            return
        # 只取尾部, 避免历史文件远超缓冲上限时全量解析
        for line in lines[-(MAX_RESULTS + MAX_FAILED_DETAILS):]:
            try:
                rec = json.loads(line)
            except Exception:
                continue
            if rec.get("type") == "result":
                self._next_id = max(self._next_id, int(rec.get("id") or 0))
                self._results.append(
                    ResultItem(
                        id=int(rec.get("id") or 0),
                        status=rec.get("status", "fail"),
                        name=rec.get("name", ""),
                        real_number=rec.get("real_number", ""),
                        ts=rec.get("ts", 0.0),
                        detail=rec.get("detail"),
                    )
                )
            elif rec.get("type") == "fail_detail":
                self._failed_details.append(rec.get("text", ""))
        # 旧版本文件没有 id 字段, 按行序补号
        for item in self._results:
            if item.id == 0:
                self._next_id += 1
                item.id = self._next_id

    def _append_history(self, record: dict) -> None:
        """追加一条到磁盘; 持久化失败只放弃记录, 不影响刮削主流程."""
        if self._history_file is None:
            return
        try:
            self._history_file.parent.mkdir(parents=True, exist_ok=True)
            with open(self._history_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
        except Exception:
            pass

    def _rewrite_history_locked(self) -> None:
        """按当前内存状态重写历史文件 (临时文件 + 原子替换)."""
        if self._history_file is None:
            return
        try:
            self._history_file.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._history_file.with_suffix(".jsonl.tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                for item in self._results:
                    f.write(json.dumps({"type": "result", **item.__dict__}, ensure_ascii=False, default=str) + "\n")
                for text in self._failed_details:
                    f.write(json.dumps({"type": "fail_detail", "text": text, "ts": 0}, ensure_ascii=False) + "\n")
            os.replace(tmp, self._history_file)
        except Exception:
            pass

    def add_result(
        self,
        status: str,
        name: str,
        real_number: str,
        detail: dict | None = None,
        ts: float | None = None,
    ) -> int:
        """新增一条记录, 返回记录 id.

        同一影片 (番号相同, 无番号则显示名相同) 只保留最新一条:
        新记录入列前移除旧记录, 失败后重试成功时失败条目会自动消失.
        """
        item = ResultItem(
            id=0,
            status=status,
            name=name,
            real_number=real_number,
            ts=time.time() if ts is None else ts,
            detail=detail,
        )
        with self._lock:
            identity = _identity(item.real_number, item.name)
            removed = False
            if identity:
                kept = [r for r in self._results if _identity(r.real_number, r.name) != identity]
                removed = len(kept) != len(self._results)
                if removed:
                    self._results = deque(kept, maxlen=MAX_RESULTS)
            self._next_id += 1
            item.id = self._next_id
            self._results.append(item)
            if removed:
                # 挤掉了旧记录, 追加会让被挤掉的重启后复活, 需全量重写
                self._rewrite_history_locked()
            else:
                self._append_history({"type": "result", **item.__dict__})
        return item.id

    def add_failed_detail(self, text: str) -> None:
        with self._lock:
            self._failed_details.append(text)
            self._append_history({"type": "fail_detail", "text": text, "ts": time.time()})

    def remove_result(self, item_id: int) -> bool:
        """删除单条记录; 失败原因明细与条目无严格对应关系, 不跟随删除."""
        with self._lock:
            before = len(self._results)
            self._results = deque((r for r in self._results if r.id != item_id), maxlen=MAX_RESULTS)
            if len(self._results) == before:
                return False
            self._rewrite_history_locked()
        return True

    def clear(self, status: str | None = None) -> None:
        """清空记录: status=None 清全部; "succ"/"fail" 只清对应列表.

        清空失败列表时失败原因明细一并清空 (两者同为失败产物);
        清空成功列表不动明细.
        """
        with self._lock:
            if status is None:
                self._results.clear()
                self._failed_details.clear()
            elif status == "succ":
                self._results = deque((r for r in self._results if r.status != "succ"), maxlen=MAX_RESULTS)
            elif status == "fail":
                self._results = deque((r for r in self._results if r.status != "fail"), maxlen=MAX_RESULTS)
                self._failed_details.clear()
            else:
                return
            self._rewrite_history_locked()

    def existing_keys(self) -> set[str]:
        """回填去重用: 已有条目的 nfo_path / file_path 集合."""
        with self._lock:
            keys: set[str] = set()
            for r in self._results:
                d = r.detail or {}
                for key in ("nfo_path", "file_path"):
                    if d.get(key):
                        keys.add(str(d[key]))
            return keys

    def snapshot(self) -> tuple[list[ResultItem], list[str]]:
        with self._lock:
            return list(self._results), list(self._failed_details)


result_buffer = ResultBuffer.create_default()
