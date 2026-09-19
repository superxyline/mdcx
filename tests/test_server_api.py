"""服务端 API 改动的回归测试.

覆盖:
- update_config 重建 manager.computed, 使代理等派生设置立即生效
- 结果缓冲: 信号回调写入 -> REST 快照读出 -> 新一轮清空
"""

import asyncio

from mdcx.config.manager import manager
from mdcx.server import var

var.is_server = True

from mdcx.models.types import ShowData  # noqa: E402
from mdcx.server.api.v1 import config as config_api  # noqa: E402
from mdcx.server.api.v1.scrape import get_scrape_results  # noqa: E402
from mdcx.server.result_buffer import result_buffer  # noqa: E402
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


def test_result_buffer_records_and_clears():
    """show_list_name / logs_failed_show 信号应写入缓冲, 可被快照读出并清空."""
    result_buffer.clear()

    show_data = ShowData.empty()
    show_data.show_name = "1-1.ABP-646"
    signal.show_list_name("succ", show_data, "ABP-646")
    signal.show_list_name("fail", ShowData.empty(), "BAD-001")
    signal.logs_failed_show.emit("🔴 搜索失败: BAD-001")

    snapshot = asyncio.run(get_scrape_results())
    assert [(r.status, r.name, r.real_number) for r in snapshot.results] == [
        ("succ", "1-1.ABP-646", "ABP-646"),
        ("fail", "", "BAD-001"),  # ShowData.empty 的 show_name 为空串
    ]
    assert snapshot.failed_details == ["🔴 搜索失败: BAD-001"]

    # 新一轮刮削开始时清空
    result_buffer.clear()
    results, failed = result_buffer.snapshot()
    assert results == [] and failed == []
