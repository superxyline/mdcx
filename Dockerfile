# syntax=docker/dockerfile:1

# ============================================================
# 阶段 1: 构建前端 (React + rsbuild)
# ============================================================
FROM node:22-alpine AS ui-builder

WORKDIR /build

# 先只拷贝依赖清单, 让依赖层能被缓存复用
COPY ui/package.json ui/pnpm-lock.yaml ui/pnpm-workspace.yaml ./
RUN corepack enable \
    && corepack prepare pnpm@11 --activate \
    && pnpm install --frozen-lockfile

COPY ui/ ./
RUN pnpm build

# ============================================================
# 阶段 2: 运行时
# ============================================================
FROM python:3.13-slim

# 换清华源加速 apt (基础镜像基于 Debian, 使用 deb822 格式)
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true

# 编译工具: zhconv / oshash 等依赖从源码构建, 装完即卸载以免撑大镜像
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple uv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/usr/local \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple \
    TZ=Asia/Shanghai

# 依赖层: 只装依赖, 不装项目自身(项目在 /app 下被直接 import).
# --no-install-project 让这一层完全不依赖源码, 因此改代码不会触发依赖重装.
# 只启用 web extra 而不带 qt: 服务端不加载 PyQt5(见 mdcx/signals.py),
# 省下约 250MB 的 Qt 运行库, 也让镜像不必再装 libGL/libxcb 等系统依赖.
RUN uv sync --frozen --no-install-project --no-dev --extra web

# 应用代码
COPY mdcx/ ./mdcx/
COPY resources/ ./resources/
COPY server.py ./
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# 构建好的前端静态资源, 由 server.py 挂载在 /
COPY --from=ui-builder /build/dist ./ui/dist

# 配置、番号数据库等可写数据都落在 /data, 便于用卷持久化
VOLUME ["/data"]
EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
