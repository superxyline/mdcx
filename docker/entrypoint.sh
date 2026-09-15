#!/bin/sh
set -e

# mdcx 通过 MAIN_PATH 下的标记文件 MDCx.config 定位当前配置文件,
# 而该文件的父目录同时被当作"用户数据目录"(配置、番号库、日志、剩余任务等都在里面).
# 容器里把这个文件固定指向 /data, 这样只需要挂载一个卷就能完整持久化所有状态.
if [ ! -f /app/MDCx.config ]; then
    echo "/data/config.json" > /app/MDCx.config
fi

mkdir -p /data/userdata

# 媒体库目录存在性检查: 挂载没配对时给出明确提示, 而不是等到刮削才报错
if [ -n "$MDCX_SAFE_DIRS" ]; then
    IFS=','
    for dir in $MDCX_SAFE_DIRS; do
        if [ ! -d "$dir" ]; then
            echo "警告: MDCX_SAFE_DIRS 中的目录不存在: $dir"
            echo "      请检查 docker-compose.yml 里的卷挂载是否配置正确."
        fi
    done
    unset IFS
fi

exec "$@"
