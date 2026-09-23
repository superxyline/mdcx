"""Clash 订阅设置接口测试.

覆盖:
- proxy-providers 段的解析与按行替换(保留注释)
- 订阅设置接口: 写文件、备份、调内核重载
- URL 校验与无配置文件时的状态返回
"""

import asyncio

import pytest
from fastapi import HTTPException
from fastapi.requests import Request

from mdcx.server import dependencies as server_deps
from mdcx.server.api.v1 import network as network_api

TEMPLATE = """\
# ---------- 代理端口 ----------
mixed-port: 7890

# ---------- 面板本体 ----------
external-ui: ui

# ---------- 节点配置(二选一) ----------
proxy-providers:
  my-sub:
    type: http
    url: "在这里填你的订阅地址"
    interval: 3600
    path: ./providers/my-sub.yaml
    health-check:
      enable: true
      url: https://www.gstatic.com/generate_204
      interval: 300

proxy-groups:
  - name: 节点选择
    type: select
    use:
      - my-sub

rules:
  - IP-CIDR,192.168.0.0/16,DIRECT,no-resolve
"""


def test_parse_provider_reads_template():
    info = network_api.parse_provider(TEMPLATE)
    assert info["name"] == "my-sub"
    assert info["url"] == "在这里填你的订阅地址"
    assert info["interval"] == 3600
    assert info["path"] == "./providers/my-sub.yaml"
    assert set(info["fields"]) == {"url", "interval", "path"}


def test_parse_provider_missing_section():
    with pytest.raises(ValueError, match="proxy-providers"):
        network_api.parse_provider("mixed-port: 7890\n")


def test_update_provider_text_replaces_and_keeps_comments():
    new = network_api.update_provider_text(
        TEMPLATE, url="https://example.com/sub?token=x", interval_seconds=7200
    )
    assert 'url: "https://example.com/sub?token=x"' in new
    assert "interval: 7200" in new
    # 注释与无关内容原样保留
    assert "# ---------- 代理端口 ----------" in new
    assert "mixed-port: 7890" in new
    assert "health-check:" in new
    assert "在这里填你的订阅地址" not in new


def test_update_provider_text_only_url_keeps_interval():
    new = network_api.update_provider_text(TEMPLATE, url="https://a.b/c", interval_seconds=None)
    assert 'url: "https://a.b/c"' in new
    assert "interval: 3600" in new


def _point_to_tmp(monkeypatch, tmp_path):
    cfg = tmp_path / "config.yaml"
    cfg.write_text(TEMPLATE, encoding="utf-8")
    monkeypatch.setattr(network_api, "CLASH_CONFIG_DIR", tmp_path)
    monkeypatch.setattr(network_api, "CLASH_CONFIG", cfg)

    async def fake_request(method, path, secret, **kwargs):
        return {"version": "v1.19.0"} if path == "/version" else None

    monkeypatch.setattr(network_api, "_clash_request", fake_request)
    return cfg


def test_get_status_without_config(monkeypatch, tmp_path):
    monkeypatch.setattr(network_api, "CLASH_CONFIG", tmp_path / "missing.yaml")
    status = asyncio.run(network_api.get_clash_status())
    assert status.config_available is False
    assert status.kernel_reachable is False


def test_update_subscription_writes_backs_up_and_reloads(tmp_path, monkeypatch):
    cfg = _point_to_tmp(monkeypatch, tmp_path)
    body = network_api.SubscriptionUpdate(url="https://example.com/sub2", update_interval_hours=2)
    status = asyncio.run(network_api.update_subscription(body))

    text = cfg.read_text(encoding="utf-8")
    assert 'url: "https://example.com/sub2"' in text
    assert "interval: 7200" in text
    assert list(tmp_path.glob("config.yaml.bak-*")), "应生成配置备份"
    assert status.subscription_url == "https://example.com/sub2"
    assert status.update_interval_hours == 2
    assert status.kernel_reachable is True


def test_update_subscription_rejects_non_http_url(monkeypatch, tmp_path):
    _point_to_tmp(monkeypatch, tmp_path)
    with pytest.raises(HTTPException) as e:
        asyncio.run(
            network_api.update_subscription(network_api.SubscriptionUpdate(url="ftp://x", update_interval_hours=1))
        )
    assert e.value.status_code == 400


def test_update_subscription_without_config_400(monkeypatch, tmp_path):
    monkeypatch.setattr(network_api, "CLASH_CONFIG", tmp_path / "missing.yaml")
    body = network_api.SubscriptionUpdate(url="https://example.com/sub", update_interval_hours=1)
    with pytest.raises(HTTPException) as e:
        asyncio.run(network_api.update_subscription(body))
    assert e.value.status_code == 400


def _make_request(path: str, headers: dict[str, str]) -> Request:
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": ("127.0.0.1", 12345),
        "server": ("test", 80),
    }
    return Request(scope)


def test_panel_secret_auth_scoped_to_network(monkeypatch, tmp_path):
    """面板 secret 只放行 /api/v1/network/*, 其余接口仍要求 X-API-KEY."""
    cfg = tmp_path / "config.yaml"
    cfg.write_text('secret: "panelpw"\n' + TEMPLATE, encoding="utf-8")
    monkeypatch.setattr(network_api, "CLASH_CONFIG", cfg)
    monkeypatch.setattr(server_deps, "API_KEY", "mdcxpw")

    header = server_deps.api_key_header

    # 正确的面板 secret -> network 接口放行
    allowed = asyncio.run(header(_make_request("/api/v1/network/clash", {"X-Panel-Secret": "panelpw"})))
    assert allowed == "panelpw"

    # 错误的面板 secret -> 401
    with pytest.raises(HTTPException) as e:
        asyncio.run(header(_make_request("/api/v1/network/clash", {"X-Panel-Secret": "nope"})))
    assert e.value.status_code == 401

    # 面板 secret 不能进其它接口
    with pytest.raises(HTTPException) as e:
        asyncio.run(header(_make_request("/api/v1/scrape/status", {"X-Panel-Secret": "panelpw"})))
    assert e.value.status_code == 401

    # 常规 X-API-KEY 通道不受影响
    assert asyncio.run(header(_make_request("/api/v1/network/clash", {"X-API-KEY": "mdcxpw"}))) == "mdcxpw"
