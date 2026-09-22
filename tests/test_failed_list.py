"""失败列表跨重启持久化与预览确认开关的回归测试."""

from pathlib import Path

from mdcx.server import var

var.is_server = True

from mdcx.config.enums import Switch  # noqa: E402
from mdcx.models.flags import Flags  # noqa: E402
from mdcx.server.failed_list import FailedListStore  # noqa: E402
from mdcx.server.signals import signal  # noqa: E402
from mdcx.signals import set_signal  # noqa: E402

set_signal(signal)


def test_failed_list_persists_and_recovers(tmp_path: Path):
    """写入 → 新实例恢复 → reset 后清空磁盘."""
    path = tmp_path / "failed_list.json"
    store = FailedListStore(path=path)
    items = [(Path("/media/failed/a.mp4"), "搜索失败"), (Path("/media/failed/b.mp4"), "超时")]
    store.save(items)

    store2 = FailedListStore(path=path)
    loaded = store2.load()
    assert [(str(p), r) for p, r in loaded] == [(str(p), r) for p, r in items]

    # 新一批刮削: 内存 reset + 磁盘清空
    Flags.failed_list = list(loaded)
    Flags.reset()
    store2.clear()
    assert Flags.failed_list == []
    assert not path.exists()
    assert FailedListStore(path=path).load() == []


def test_preview_confirm_switch_defined():
    assert Switch.PREVIEW_CONFIRM.value == "preview_confirm"
    assert "刮削前预览确认" in Switch.names()
    # 显示名与枚举顺序对齐 (IPV4_ONLY 无显示名, 保持历史行为)
    ordered = [m for m in Switch if m is not Switch.IPV4_ONLY]
    names = Switch.names()
    assert len(names) == len(ordered)
    idx = ordered.index(Switch.PREVIEW_CONFIRM)
    assert names[idx] == "刮削前预览确认"


def test_preview_approve_all_resets():
    Flags.preview_approve_all = True
    Flags.reset()
    assert Flags.preview_approve_all is False
