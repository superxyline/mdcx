#!/usr/bin/env bash
# 下载 FPK 打包所需的两个 Linux 运行时二进制(已 gitignore, 打包前执行一次):
#   - uv    -> app/runtime/uv          (首启用它装 Python3.13 与依赖)
#   - mihomo -> app/clash-runtime/mihomo (内核, 随包内嵌的 Clash)
# 国内直连 GitHub release 可能被截断, 这里统一走 ghfast.top 加速镜像。
set -euo pipefail
cd "$(dirname "$0")/mdcx"

UV_VER="0.9.26"
MIHOMO_VER="v1.19.31"
MIRROR="https://ghfast.top/https://github.com"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if [ ! -s app/runtime/uv ]; then
    echo "下载 uv ${UV_VER} (linux x86_64) ..."
    curl -sL --max-time 300 -o "$tmp/uv.tar.gz" \
        "${MIRROR}/astral-sh/uv/releases/download/${UV_VER}/uv-x86_64-unknown-linux-gnu.tar.gz"
    tar xzf "$tmp/uv.tar.gz" -C "$tmp"
    mkdir -p app/runtime
    cp "$tmp/uv-x86_64-unknown-linux-gnu/uv" app/runtime/uv
    chmod +x app/runtime/uv
    echo "  -> app/runtime/uv"
else
    echo "uv 已存在, 跳过"
fi

if [ ! -s app/clash-runtime/mihomo ]; then
    echo "下载 mihomo ${MIHOMO_VER} (linux amd64) ..."
    curl -sL --max-time 300 -o "$tmp/mihomo.gz" \
        "${MIRROR}/MetaCubeX/mihomo/releases/download/${MIHOMO_VER}/mihomo-linux-amd64-compatible-${MIHOMO_VER}.gz"
    gunzip -c "$tmp/mihomo.gz" > app/clash-runtime/mihomo
    chmod +x app/clash-runtime/mihomo
    echo "  -> app/clash-runtime/mihomo"
else
    echo "mihomo 已存在, 跳过"
fi

echo "完成。现在可以: cd fnos && fnpack build --directory mdcx"
