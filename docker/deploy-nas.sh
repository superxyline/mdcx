#!/bin/bash
# ============================================================
# 在飞牛 fnOS (或任意 Linux NAS) 上部署 mdcx
#
# 用法:
#   bash deploy-nas.sh [部署目录] [媒体库路径]
#
# 示例:
#   bash deploy-nas.sh /vol1/1000/docker/mdcx /vol1/1000/媒体库
#
# 脚本会: 检查环境 -> 解压部署包 -> 生成配置 -> 构建镜像 -> 启动容器
# ============================================================
set -e

DEPLOY_DIR="${1:-/vol1/1000/docker/mdcx}"
MEDIA_PATH="${2:-}"
PACKAGE="/tmp/mdcx-deploy.tar.gz"
MDCX_PORT="${MDCX_PORT:-8000}"

info() { echo -e "\033[32m[信息]\033[0m $*"; }
warn() { echo -e "\033[33m[警告]\033[0m $*"; }
fail() { echo -e "\033[31m[错误]\033[0m $*"; exit 1; }

echo "=========================================="
echo " mdcx 部署脚本"
echo "=========================================="
echo

# ---------- 1. 环境检查 ----------
info "检查运行环境..."

if ! command -v docker >/dev/null 2>&1; then
    fail "未找到 docker 命令。请先在 fnOS 应用中心安装「Docker」应用。"
fi

if docker compose version >/dev/null 2>&1; then
    COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE="docker-compose"
else
    fail "未找到 docker compose。请确认 Docker 应用已正确安装。"
fi

# 检查 docker 服务是否在运行
if ! docker info >/dev/null 2>&1; then
    fail "Docker 服务未运行, 或当前用户无权访问。请尝试用 sudo 执行本脚本。"
fi

info "Docker 可用, Compose 命令: $COMPOSE"
echo

# ---------- 2. 准备部署目录 ----------
info "部署目录: $DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"
cd "$DEPLOY_DIR"

if [ -f "$PACKAGE" ]; then
    info "解压部署包 $PACKAGE ..."
    tar -xzf "$PACKAGE" -C "$DEPLOY_DIR"
else
    if [ ! -f "$DEPLOY_DIR/Dockerfile" ]; then
        fail "未找到部署包 $PACKAGE, 且当前目录也没有 Dockerfile。请先把 mdcx-deploy.tar.gz 上传到 /tmp/"
    fi
    info "未找到部署包, 使用当前目录已有文件继续。"
fi
echo

# ---------- 3. 创建运行期目录 ----------
info "创建数据与配置目录..."
mkdir -p data clash media

if [ ! -f clash/config.yaml ]; then
    cp docker/clash-config.example.yaml clash/config.yaml
    warn "已生成 Clash 配置模板 clash/config.yaml"
    warn "若刮削源需要科学上网, 请编辑它填入订阅地址和面板密码后重启:"
    warn "  $COMPOSE restart clash"
else
    info "已存在 clash/config.yaml, 保留不覆盖。"
fi
echo

# ---------- 4. 媒体库路径 ----------
if [ -n "$MEDIA_PATH" ]; then
    if [ ! -d "$MEDIA_PATH" ]; then
        warn "指定的媒体库路径不存在: $MEDIA_PATH"
        warn "请确认路径正确, 否则容器内将看不到媒体文件。"
    fi
    info "媒体库挂载: $MEDIA_PATH -> /media"
    # 替换 compose 里的媒体库挂载行
    sed -i "s|^\( *\)- ./media:/media|\1- ${MEDIA_PATH}:/media|" docker-compose.yml
else
    warn "未指定媒体库路径, 将使用 ./media (即 $DEPLOY_DIR/media)"
    warn "如需挂载真实媒体库, 可编辑 docker-compose.yml 后重新执行。"
fi
echo

# ---------- 5. 端口 ----------
if [ "$MDCX_PORT" != "8000" ]; then
    info "使用自定义端口: $MDCX_PORT"
    sed -i "s|\"8000:8000\"|\"${MDCX_PORT}:8000\"|" docker-compose.yml
fi
echo

# ---------- 6. 构建并启动 ----------
info "开始构建镜像 (首次约 5-15 分钟, 取决于网络与性能)..."
echo
$COMPOSE up -d --build

echo
# ---------- 7. 结果 ----------
if $COMPOSE ps | grep -q "Up"; then
    NAS_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    echo "=========================================="
    echo " 部署完成"
    echo "=========================================="
    echo
    echo "  mdcx 界面:  http://${NAS_IP:-<NAS_IP>}:${MDCX_PORT}"
    echo "  Clash 面板: http://${NAS_IP:-<NAS_IP>}:9090/ui  (密码见 clash/config.yaml 的 secret)"
    echo
    echo "  下一步: 打开 mdcx 界面, 进入「设置 → 网络」,"
    echo "          把代理地址填成 http://clash:7890 并打开代理开关,"
    echo "          否则刮削不会走代理。"
    echo
    echo "  常用命令:"
    echo "    cd $DEPLOY_DIR"
    echo "    $COMPOSE logs -f mdcx     # 查看日志"
    echo "    $COMPOSE restart          # 重启"
    echo "    $COMPOSE down             # 停止"
    echo "=========================================="
else
    fail "容器未正常启动, 请执行 $COMPOSE logs 查看日志。"
fi
