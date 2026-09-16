# 项目交接文档

> 最后更新：2026-09-16
> 用途：供新对话快速了解项目全貌，接续开发

---

## 一、项目是什么

把 [sqzw-x/mdcx](https://github.com/sqzw-x/mdcx)（影片元数据刮削器，上游已于 2026-08-23 归档）
改造成**纯 Web 应用**，部署在用户的 NAS 上长期运行。

**改造目标的由来**：用户最初问能否移植到 Flutter，评估后结论是不划算（TLS 指纹伪装、
lxml、图像处理等依赖无法用 Dart 等价替代），最终选择"保留 Python 后端、重做 Web 前端"
这条成本最低、功能可完全保留的路径。

### 三个关键约束

1. **功能必须与桌面版一致** —— 不能因为去掉 Qt 而丢功能
2. **浏览器关闭后后台刮削要继续** —— 这是用户明确强调的需求
3. **需要能通过代理访问刮削源**（Clash）

---

## 二、代码位置与版本

| 项目 | 值 |
|---|---|
| 本地路径 | `E:\codex\mdcx` |
| 远程 | `origin = https://github.com/sqzw-x/mdcx.git`（git 全局有 insteadOf 规则自动走 ghproxy.net 加速） |
| 分支 | `master` |
| 回退点 | **tag `before-qt-removal`**（摘除 Qt 之前的完整状态） |

### 关键提交

```
0940e14  fix(docker): 修复 NAS 上构建失败的两处问题
d08f782  refactor: 摘除 Qt 桌面版, 转为纯 Web 应用
30ed339  feat: Web 版功能补齐与容器化支持
58e3f93  docs: 添加弃用警告并指向新项目 Amane   ← 上游最后一个提交
```

### 环境

- Python **3.13.15**（由 uv 管理，项目要求 >=3.13.4）
- **已移除 PyQt5**（`pyproject.toml` 无 qt extra，环境里也已卸载）
- 前端：React 19 + MUI **9.4.0** + MD3 主题 + TanStack Router
- 工具：uv 0.12.14、Node 24 + pnpm 11（在 `E:\codex\tools`）

---

## 三、已完成的工作

### 阶段 1：Web 版功能补齐

- **解开 3 处 core 层 Qt 耦合**：`scraper.py` 的 QMessageBox、`image.py` 的 QImageReader、
  `config/resources.py` 的 QFontDatabase
- **新增 ask/answer 协议**（`mdcx/server/ask.py`）：Qt 的阻塞式对话框在 Web 下没有等价物，
  改为"后台线程提问 → WebSocket 推给浏览器 → 用户选择 → HTTP 回填答案"
- **新增刮削状态 API**（`mdcx/server/api/v1/scrape.py`）
- **前端升级 MUI 9 + MD3 主题**（`ui/src/theme/md3.ts`：基线色板、形状 token、排版阶梯）
- **刮削主界面**（`ui/src/routes/index.tsx`）
- **修复两个既有缺陷**：SPA 子路由刷新 404、前端 API 客户端配置竞态

### 阶段 2：功能对齐桌面版（四批）

| 批次 | 内容 | 后端模块 |
|---|---|---|
| 一 | 成功/失败列表管理、缺失番号、文件清理、视频移动、Cookie 检测 | `api/v1/tools.py` |
| 二 | Extras 六个批量操作（剧照/剧照副本/主题视频 × 添加删除） | 同上 |
| 三 | Emby 演员（补全信息头像、九种筛选名单、Kodi 演员文件夹） | 同上 |
| 四 | 封面裁剪（沿用 Qt 的固定比例交互） | `base/image.py` + `api/v1/tools.py` |

### 阶段 3：摘除 Qt 层

**净删除 43487 行**（57 个文件）：

- `mdcx/views/`（11509 行，含 Qt Designer 生成的代码和 1.2MB 的 `.ui`）
- `mdcx/controllers/`（5895 行）
- `main.py`、`resources/Img`、`resources/fonts`
- `scripts/build.py`、`scripts/pyuic.sh` 及 GUI 打包相关的 3 个 CI workflow

**代码调整**：
- `signals.py` 简化为单一实现，新增 `ConsoleSignals` 供命令行场景
- `scraper.py` 移除 QMessageBox 分支，非服务端时保守取消
- `pyproject.toml` 移除 qt extra、pyinstaller、pyqt5-stubs

### 阶段 4：容器化与 NAS 部署

产出：`Dockerfile`、`docker-compose.yml`、`docker/entrypoint.sh`、
`docker/deploy-nas.sh`、`docker/README.md`、`docker/clash-config.example.yaml`

**已实际部署到 NAS 并验证通过。**

---

## 四、NAS 部署现状

### 目标设备

| 项目 | 值 |
|---|---|
| 地址 | `192.168.31.26` |
| 系统 | **飞牛 fnOS**（基于 Debian 12，x86_64，7.5GB 内存，4 核） |
| Web 管理 | `http://192.168.31.26:5666/` |
| SSH | 已开启（用户自行开启的），**docker 命令需要 sudo，且 sudo 需要密码** |

> ⚠️ 凭据未记录在文档中。需要操作 NAS 时向用户索取（用户名 `<NAS用户名>`）。

### 部署位置与挂载

```
/vol1/1000/Docker/mdcx/          ← 部署目录
├── data/                        ← 配置与数据(持久化, 备份这个即可)
├── clash/config.yaml            ← Clash 配置(需填订阅)
├── clash/ui/                    ← 面板静态文件(已手动放入)
├── media/                       ← 未使用(compose 里已改成绝对路径)
└── (其余为项目源码)
```

| 容器 | 端口 | 状态 |
|---|---|---|
| `mdcx` | 8000 | 运行中 |
| `mdcx-clash` | 7890（代理）/ 9090（面板+API） | 运行中 |

媒体库挂载：`/vol1/1000/影视` → 容器内 `/media`
Docker 数据目录：`/vol2/docker`

### 访问地址

- mdcx：`http://192.168.31.26:8000`
- Clash 面板：`http://192.168.31.26:9090/ui`

---

## 五、遗留事项（重要）

### 1. Clash 订阅地址未填 ⚠️

`/vol1/1000/Docker/mdcx/clash/config.yaml` 里 `proxy-providers.my-sub.url`
仍是占位文本 `"在这里填你的订阅地址"`。**节点列表为空，代理目前不可用。**

填好后执行：`sudo docker compose restart clash`

### 2. mdcx 里未配置代理与媒体路径

需要在 Web 界面「设置」里配置：
- **代理地址**：`http://clash:7890`（必须写服务名 `clash`，容器里 `127.0.0.1` 指向自己）
- **媒体路径**：`/media`

### 3. is_descendant 的跨盘符缺陷仍未修

`mdcx/utils/path.py:27` 的 `os.path.commonpath` 在 Windows 上遇到不同盘符会抛
`ValueError`，导致 `pytest` 有一个用例持续失败（上游遗留，非本次引入）。

影响：如果 `MDCX_SAFE_DIRS` 配置了多个不同盘符的目录，任何路径校验都会 500。
**在 NAS（Linux）上不会触发**，所以当前不影响使用。修复方式：捕获 `ValueError` 返回 `False`。

### 4. 结果明细刷新后会丢失

成功/失败列表靠 WebSocket 实时推送，浏览器关闭期间的条目不留存。统计数字能通过
`GET /scrape/status` 恢复，但列表是空的。要补齐需在后端做结果环形缓冲。

### 5. 桌面版相关的回退

如需恢复 Qt 版：`git checkout before-qt-removal -- mdcx/views mdcx/controllers main.py`

---

## 六、开发与运维命令

### 本地开发

```bash
cd /e/codex/mdcx
uv sync --all-extras --dev                    # 同步依赖
uv run uvicorn server:app --host 127.0.0.1 --port 8000   # 启动服务
uv run pytest                                  # 测试(61 通过 / 1 失败为已知缺陷)
uv run ruff check mdcx/ server.py              # 代码检查
uv run crawl --help                            # 爬虫调试 CLI

cd ui && pnpm build                            # 构建前端
cd ui && pnpm run ci                           # 前端 lint
cd ui && pnpm run gen:client                   # 重新生成 API 客户端(需后端在 8000 运行)
```

> node 需要先加进 PATH：`export PATH="/e/codex/tools/node-v24.19.0-win-x64:$PATH"`
> pnpm 路径：`/e/codex/tools/pnpm/node_modules/.bin/pnpm.cmd`

### NAS 运维

```bash
cd /vol1/1000/Docker/mdcx
sudo docker compose logs -f mdcx     # 日志
sudo docker compose restart          # 重启
sudo docker compose up -d --build    # 重新构建并启动
sudo docker compose down             # 停止
```

---

## 七、踩过的坑（避免重复）

### 容器化

1. **`# syntax=docker/dockerfile:1` 会让构建失败** —— fnOS 的镜像加速站
   `docker.fnnas.com` 对 `docker/dockerfile` 镜像返回 401。已移除该指令。
2. **Dockerfile 必须 `COPY pyproject.toml uv.lock`** —— `uv sync` 需要依赖清单才能解析，
   且必须放在 `RUN uv sync` 之前。
3. **fnOS 上 buildkit 解析 `FROM` 会 401，但 `docker pull` 正常** —— 两者走的镜像解析
   路径不同。解决办法：先 `docker pull` 好基础镜像，再用 `DOCKER_BUILDKIT=0` 构建。
4. **Clash 的 `GEOIP,CN,DIRECT` 规则会导致内核启动失败** —— mihomo 启动时要下载 MMDB
   数据库，而下载需要访问 GitHub，访问 GitHub 又需要代理（鸡生蛋）。已改成
   `MATCH,节点选择`（不依赖 GeoIP）。
5. **Clash 面板需手动放置** —— 内核从 GitHub 下载面板同样会失败。已把 MetaCubeXD 的
   静态文件放到 `clash/ui/`，内核识别到后跳过下载。
6. **NAS 上 SSH 执行后台任务要用 `setsid` 完全脱离** —— 否则 `nohup ... &` 会让
   paramiko 的 channel 一直挂住。

### 代码

7. **`async_client` 绑定在后台执行器的事件循环上** —— 在请求循环里直接 `await` 会报
   `attached to a different loop`。要用 `asyncio.wrap_future(executor.submit(coro))`。
8. **裁剪时 poster 与原图常是同一个文件** —— 必须先把原图读进内存再写盘，否则
   thumb/fanart 会被错误地裁掉。
9. **Windows 换行符会产生大量假 diff** —— `git status` 显示 M 但 `git diff` 为空时，
   那是 CRLF 问题，不是真实改动。
10. **Starlette 抛的是自己的 HTTPException**，FastAPI 的是其子类，`except` 必须捕获父类。

---

## 八、项目结构（当前）

```
mdcx/
├── Dockerfile / docker-compose.yml / .dockerignore
├── docker/                  # entrypoint.sh, deploy-nas.sh, README.md, clash 配置模板
├── mdcx/
│   ├── base/                # 文件/图片/视频基础操作
│   ├── cmd/                 # 命令行工具(crawl 等)
│   ├── config/              # 配置管理(JSON Schema 驱动前端设置页)
│   ├── core/                # 刮削主流程
│   ├── crawlers/            # 数十个站点爬虫
│   ├── models/              # 数据模型与全局状态(Flags)
│   ├── server/              # Web 服务
│   │   ├── api/v1/          # config / files / legacy / scrape / tools / ask / ws
│   │   ├── ask.py           # 跨线程提问协议
│   │   └── signals.py       # ServerSignals(转 WebSocket)
│   ├── signals.py           # 信号分发入口
│   ├── tools/               # 演员/字幕/缺失检查
│   └── utils/               # 通用工具(含 AsyncBackgroundExecutor)
├── ui/                      # React 前端
│   └── src/
│       ├── routes/          # index(刮削) / tool(工具集) / settings / logs / ...
│       ├── components/      # AskDialog, PosterCutter, FileBrowser ...
│       ├── store/           # scrapeStore, logStore
│       └── theme/md3.ts     # MD3 主题
└── tests/
```

---

## 九、用户偏好（来自 AGENTS.md）

- **写代码前必须先确认**，不要直接开始写
- 优先复用开源项目，不要从头写
- 构建/下载的工具放在 `E:\codex\tools`
- Fork 代码优先用国内加速镜像
- 构建 APK 需先确认，只构建 arm64

---

## 十、下一步建议

按优先级：

1. **填 Clash 订阅地址**，配好 mdcx 的代理与媒体路径 —— 这是让系统真正可用的最后一步
2. 修 `is_descendant` 的跨盘符缺陷（3 行代码，能让 pytest 全绿）
3. 给结果明细做服务端留存（解决刷新丢失）
4. 如有需要，补充其他尚未迁移的细节功能

如有疑问，可查看 `docker/README.md`（部署细节）与 `CONTRIBUTING.md`（开发说明）。
