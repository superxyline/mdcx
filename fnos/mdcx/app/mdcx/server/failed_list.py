"""失败列表的磁盘持久化.

``Flags.failed_list`` 原本只在内存里, 容器一重启「重试失败」就不可用.
这里在每次追加/清空时同步写入用户数据目录的 failed_list.json, 服务启动时加载回内存.

语义与桌面版一致: 失败列表属于「本轮刮削」——新一批开始 (``Flags.reset``) 时清空内存与磁盘;
跨重启则恢复上次未开新一轮的列表.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

from mdcx.consts import MARK_FILE

FILE_NAME = "failed_list.json"
_lock = threading.Lock()


def default_failed_list_file() -> Path:
    """用户数据目录 = 当前配置文件所在目录 (容器内为 /data)."""
    try:
        config_path = Path(MARK_FILE.read_text(encoding="utf-8").strip())
        return config_path.parent / FILE_NAME
    except Exception:
        return Path(FILE_NAME)


class FailedListStore:
    def __init__(self, path: Path | None = None):
        self._path = path
        self._loaded = False

    def _file(self) -> Path:
        if self._path is not None:
            return self._path
        return default_failed_list_file()

    def load(self) -> list[tuple[Path, str]]:
        """读取磁盘上的失败列表; 文件不存在或损坏时返回空列表."""
        path = self._file()
        with _lock:
            if not path.is_file():
                self._loaded = True
                return []
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                self._loaded = True
                return []
            items: list[tuple[Path, str]] = []
            if isinstance(raw, list):
                for rec in raw:
                    if isinstance(rec, dict) and rec.get("path"):
                        items.append((Path(rec["path"]), str(rec.get("reason") or "")))
            self._loaded = True
            return items

    def save(self, items: list[tuple[Path, str]]) -> None:
        """整表覆盖写入; 失败只放弃持久化, 不影响刮削主流程."""
        path = self._file()
        with _lock:
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                payload = [{"path": str(p), "reason": reason} for p, reason in items]
                path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception:
                pass

    def clear(self) -> None:
        with _lock:
            try:
                self._file().unlink(missing_ok=True)
            except Exception:
                pass


failed_list_store = FailedListStore()
