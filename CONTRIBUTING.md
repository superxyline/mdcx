# 开发

> 本项目已移除桌面版(Qt), 现在是一个纯 Web 应用: Python 后端 + 浏览器前端。

## 环境准备

### 依赖

* [uv](https://docs.astral.sh/uv/getting-started/installation/)
* pnpm

### clone

```bash
git clone https://github.com/sqzw-x/mdcx.git
cd mdcx
uv sync --all-extras --dev
uv run pre-commit install
```

## Run

启动 web server

```bash
# 构建前端
cd ui && pnpm i && pnpm build && cd ..

# Windows
$env:MDCX_DEV=1; fastapi dev server.py

# Linux/macOS
MDCX_DEV=1 fastapi dev server.py
```

浏览器打开 `http://127.0.0.1:8000` 即可。未设置 `MDCX_API_KEY` 时无需任何认证,
设置了则会在页面首次访问时要求输入。

前端改动后需要重新 `pnpm build`, 或改用 `pnpm dev` 走 rsbuild 的开发服务器。

## Test

Python 侧使用 pytest

```bash
uv run pytest
```

## 如何添加新配置项

1. 在 `mdcx/config/models.py` 的 `Config` 类中添加配置字段及默认值
2. 通过 `from mdcx.config.manager import manager` 导入配置, 用 `manager.config.<key>` 访问
3. 无需手工编写界面: 设置页由后端返回的 JSON Schema 自动渲染
   (`GET /api/v1/config/schema` 与 `/ui_schema`), 字段标题取自 `Field(title=...)`

## 如何添加新的后端接口

1. 在 `mdcx/server/api/v1/` 下新建或选择模块, 用 `APIRouter` 声明路由
2. 在 `mdcx/server/api/v1/__init__.py` 里 `include_router` 注册
3. 前端执行 `pnpm run gen:client` 重新生成 API 客户端(需要后端在 8000 端口运行)

批量任务应通过 `mdcx.utils.executor` 提交到后台执行器, 接口立即返回,
进度经信号系统推送到浏览器 —— 这样关闭浏览器不会中断任务。

## 代码结构说明

```bash
mdcx
├── mdcx # 源代码目录
│   ├── base # 文件/图片/视频等基础操作
│   ├── cmd # 命令行工具(爬虫调试等)
│   ├── config # 配置管理
│   ├── core # 刮削主流程
│   ├── crawlers # 各网站爬虫
│   ├── models # 数据模型与全局状态
│   ├── server # Web 服务
│   │   ├── api/v1 # HTTP 接口
│   │   └── ws # WebSocket
│   ├── tools # 演员/字幕/缺失检查等工具
│   ├── utils # 通用工具
│   └── signals.py # 信号分发(服务端实现见 server/signals.py)
├── scripts # 开发脚本
├── tests # 测试
└── ui # 前端
    ├── dist # 构建结果
    └── src
```
