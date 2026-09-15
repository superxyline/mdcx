import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# StaticFiles 内部抛出的是 Starlette 的 HTTPException, 而 FastAPI 的 HTTPException
# 是它的子类; 捕获时必须用父类, 否则 except 分支永远不会命中
from starlette.exceptions import HTTPException as StarletteHTTPException


class SPAStaticFiles(StaticFiles):
    """静态文件服务, 未命中时回退到 index.html.

    前端使用客户端路由(TanStack Router), 像 ``/tool`` 这样的路径在磁盘上并没有
    对应文件. 默认的 StaticFiles 会直接返回 404, 导致用户在这些页面上刷新或直接
    输入地址时看到 JSON 错误而不是应用本身. 这里把非 API 的未命中请求交还给
    index.html, 由前端路由接管.
    """

    async def get_response(self, path: str, scope):
        # Starlette 会用 os.path.normpath 规范化路径, 在 Windows 上分隔符会变成
        # 反斜杠, 因此这里先统一成正斜杠再判断, 否则 API 的 404 会被误当成前端路由
        normalized = path.replace("\\", "/")
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404 and not normalized.startswith("api/"):
                return await super().get_response("index.html", scope)
            raise


def init():
    # 设置为服务器模式
    from mdcx.server import var

    var.is_server = True

    # 使用 ServerSignals 替代 Qt Signal
    from mdcx.server.signals import signal
    from mdcx.signals import set_signal

    set_signal(signal)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # 记录主事件循环, 供后台刮削线程把提问广播给浏览器
    from mdcx.server.ask import ask_manager

    ask_manager.bind_loop(asyncio.get_running_loop())
    yield


def create_app() -> FastAPI:
    init()

    from mdcx.server.api.v1 import api
    from mdcx.server.ws.auth import WebSocketProtocolBearerMiddleware

    app = FastAPI(title="MDCx API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Allows all origins
        allow_credentials=True,
        allow_methods=["*"],  # Allows all methods
        allow_headers=["*"],  # Allows all headers
    )
    app.add_middleware(WebSocketProtocolBearerMiddleware)

    app.include_router(api)
    app.mount("/", SPAStaticFiles(directory="ui/dist", html=True), name="ui")

    return app


app = create_app()
