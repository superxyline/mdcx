from functools import cached_property
from pathlib import Path

from pydantic import Field, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .var import is_server


class Config(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MDCX_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    host: str = Field(default="localhost")
    port: int = Field(default=8000)

    api_key_: str | None = Field(default=None, init_var=True)
    api_key: str = ""
    safe_dirs: str | None = Field(default=None, description="逗号分隔的路径列表, 指定哪些目录可以被访问.")

    dev: bool = Field(default=False)

    @field_validator("dev", mode="before")
    @classmethod
    def validate_dev(cls, v):
        """将环境变量转换为布尔值"""
        if isinstance(v, str):
            return v.lower() in ("true", "1", "yes", "on")
        return bool(v) if v is not None else False

    @model_validator(mode="after")
    def validate_config(self):
        """验证整体配置"""
        # 开发模式下设置默认值
        if self.dev or not is_server:
            if self.host not in ("localhost", "127.0.0.1") and not self.host.startswith("192.168"):
                raise ValueError(
                    f"不允许在开发模式下监听非本地地址 {self.host}:{self.port}"
                    # todo 考虑任何情况下都不允许监听非本地地址, 必须使用 reverse proxy
                )

        # api_key_ 供代码内显式传入(测试等场景), api_key 来自环境变量 MDCX_API_KEY.
        # 这里必须用 or 取其一, 不能直接以 api_key_ 覆盖, 否则会丢掉环境变量里的值.
        self.api_key = self.api_key_ or self.api_key

        if not self.safe_dirs:
            # 默认只放通用户主目录, 保证开箱即用又不至于让接口能读写整块磁盘
            self.safe_dirs = "~"
            print("提示: 未设置 MDCX_SAFE_DIRS, 默认可访问用户主目录; 媒体库位于其它位置时请显式设置.")
        if not self.api_key:
            # 未设置 MDCX_API_KEY 时不启用认证, 打开浏览器即可使用.
            # 一旦设置了该变量, 认证会立即生效(见 dependencies.py).
            print("提示: 未设置 MDCX_API_KEY, 已关闭接口认证, 仅供本机使用.")
            if self.host not in ("localhost", "127.0.0.1", "::1"):
                print(
                    f"警告: 当前监听 {self.host}:{self.port} 且未启用认证, "
                    "局域网内任何设备都可以读写服务器上的文件. 对外提供服务前请设置 MDCX_API_KEY."
                )
        return self

    @cached_property
    def safe_dirs_list(self) -> list[Path]:
        """获取解析后的安全目录列表"""
        if not self.safe_dirs:
            raise ValueError("必须设置环境变量 MDCX_SAFE_DIRS")
        dirs = [Path(p).expanduser().resolve() for p in self.safe_dirs.split(",")]
        if len(dirs) == 0:
            raise ValueError("环境变量 MDCX_SAFE_DIRS 必须包含至少一个路径")
        invalid_dirs = [str(p) for p in dirs if not p.is_dir()]
        if invalid_dirs:
            raise ValueError(f"以下路径不是有效的目录: {', '.join(invalid_dirs)}")
        return dirs


try:
    settings = Config()
    HOST = settings.host
    PORT = settings.port
    IS_DEV = settings.dev
    API_KEY_HEADER = "X-API-KEY"
    API_KEY = settings.api_key
    SAFE_DIRS = settings.safe_dirs_list
    WS_PROTOCOL = "v1.mdcx"
except ValidationError as e:
    print(f"服务器配置验证失败: {e}")
    exit(1)
