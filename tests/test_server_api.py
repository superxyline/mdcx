"""服务端 API 改动的回归测试.

覆盖:
- update_config 重建 manager.computed, 使代理等派生设置立即生效
- 结果缓冲: 信号回调写入 -> REST 快照读出; 持久化到历史文件并可恢复
- scrape/status 暴露 auth_enabled
"""

import asyncio

from mdcx.config.manager import manager
from mdcx.server import var

var.is_server = True

from mdcx.models.types import ShowData  # noqa: E402
from mdcx.server.api.v1 import config as config_api  # noqa: E402
from mdcx.server.api.v1 import scrape as scrape_api  # noqa: E402
from mdcx.server.result_buffer import ResultBuffer, result_buffer  # noqa: E402
from mdcx.server.signals import signal  # noqa: E402
from mdcx.signals import set_signal  # noqa: E402

set_signal(signal)


def test_update_config_rebuilds_computed():
    """改配置后 computed 应重建, 代理设置不需要重启才生效."""
    original = manager.config.model_copy(deep=True)
    try:
        new_config = manager.config.model_copy(deep=True)
        new_config.use_proxy = True
        new_config.proxy = "http://127.0.0.1:19999"
        asyncio.run(config_api.update_config(new_config))
        assert manager.config.use_proxy is True
        assert manager.computed.async_client.proxy == "http://127.0.0.1:19999"
    finally:
        asyncio.run(config_api.update_config(original))
    assert manager.computed.async_client.proxy is None


def test_signal_writes_result_with_detail(tmp_path, monkeypatch):
    """信号回调写入的条目应带上预览元数据, 且通过 REST 快照读出."""
    # 历史文件指到临时目录, 测试不污染仓库数据
    monkeypatch.setattr(result_buffer, "_history_file", tmp_path / "h.jsonl")

    show_data = ShowData.empty()
    show_data.show_name = "1-1.ABP-646"
    signal.show_list_name("succ", show_data, "ABP-646")
    signal.logs_failed_show.emit("🔴 搜索失败: BAD-001")

    snapshot = asyncio.run(scrape_api.get_scrape_results())
    last = snapshot.results[-1]
    assert (last.status, last.name, last.real_number) == ("succ", "1-1.ABP-646", "ABP-646")
    assert last.ts > 0
    assert snapshot.failed_details[-1] == "🔴 搜索失败: BAD-001"


def test_result_buffer_persists_and_recovers(tmp_path):
    """结果应写入历史文件, 重启(新实例)后恢复, 且不再按轮清空."""
    hist = tmp_path / "scrape_history.jsonl"
    buf = ResultBuffer(history_file=hist)
    buf.add_result("succ", "1-1.ABP-646", "ABP-646", detail={"title": "t", "file_path": "/media/a.mp4"})
    buf.add_result("fail", "", "BAD-001")
    buf.add_failed_detail("🔴 搜索失败: BAD-001")

    # 模拟重启: 新实例从文件恢复
    buf2 = ResultBuffer(history_file=hist)
    results, failed = buf2.snapshot()
    assert [(r.status, r.name, r.real_number) for r in results] == [
        ("succ", "1-1.ABP-646", "ABP-646"),
        ("fail", "", "BAD-001"),
    ]
    assert results[0].detail["file_path"] == "/media/a.mp4"
    assert results[0].ts > 0
    assert failed == ["🔴 搜索失败: BAD-001"]

    # 历史导入去重键
    assert "/media/a.mp4" in buf2.existing_keys()

    # 继续追加不覆盖旧记录
    buf2.add_result("succ", "x", "X-001")
    assert len(ResultBuffer(history_file=hist).snapshot()[0]) == 3


def test_scrape_status_reports_auth_enabled():
    """auth_enabled 应随 MDCX_API_KEY 是否设置而变化."""
    original = scrape_api.API_KEY
    try:
        scrape_api.API_KEY = ""
        status = asyncio.run(scrape_api.get_scrape_status())
        assert status.auth_enabled is False

        scrape_api.API_KEY = "secret-test-key"
        status = asyncio.run(scrape_api.get_scrape_status())
        assert status.auth_enabled is True
    finally:
        scrape_api.API_KEY = original
