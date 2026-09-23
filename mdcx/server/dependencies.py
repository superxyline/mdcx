from fastapi import HTTPException, status
from fastapi.openapi.models import APIKey, APIKeyIn
from fastapi.requests import HTTPConnection
from fastapi.security.api_key import APIKeyBase

from .config import API_KEY, API_KEY_HEADER


class APIKeyHeader(APIKeyBase):
    """
    同时支持 HTTP 和 WebSocket 的 API Key 认证.
    """

    def __init__(self, *, name: str, scheme_name: str | None = None, description: str | None = None):
        self.model: APIKey = APIKey(**{"in": APIKeyIn.header}, name=name, description=description)  # type: ignore[arg-type]
        self.scheme_name = scheme_name or self.__class__.__name__

    async def __call__(self, request: HTTPConnection) -> str | None:
        if not API_KEY:
            # 未配置 MDCX_API_KEY, 表示未启用认证(默认的本机使用场景)
            return None
        api_key = request.headers.get(self.model.name)
        if api_key == API_KEY:
            return api_key
        # metacubexd 面板(9090 端口)跨端口调用 /api/v1/network/* 时以 mihomo 自己的
        # 面板 secret 认证: 面板页面天然持有该值, 不必再让用户在面板里输入 MDCX 的 Key.
        # 范围严格限定在 network 路径, 其余接口仍然只认 X-API-KEY.
        if request.url.path.startswith("/api/v1/network/"):
            supplied = request.headers.get("X-Panel-Secret")
            if supplied:
                from .api.v1.network import read_panel_secret  # 局部导入避免环依赖

                panel_secret = read_panel_secret()
                if panel_secret and supplied == panel_secret:
                    return supplied
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API Key")


api_key_header = APIKeyHeader(name=API_KEY_HEADER)
