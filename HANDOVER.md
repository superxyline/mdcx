# 项目交接文档

> 最后更新：2026-09-18
> 用途：供新对话快速了解项目全貌，接续开发

---

## 一、项目是什么

把 [sqzw-x/mdcx](https://github.com/sqzw-x/mdcx)（影片元数据刮削器，上游 2026-08-23 已归档）
改造成**纯 Web 应用**，部署在用户的 NAS 上长期运行。

关键约束：

1. **功能必须与桌面版一致** —— 不能因为去掉 Qt 而丢功能
2. **浏览器关闭后后台刮削要继续**
3. **需要能通过代理访问刮削源**

---

## 二、位置与状态

| 项目 | 值 |
|---|---|
| 本地路径 | `E:\codex\mdcx` |
| GitHub | `https://github.com/superxyline/mdcx`（公开，分支 `master`） |
| 上游 remote `origin` | `https://ghproxy.net/https://github.com/sqzw-x/mdcx.git`（只读加速） |
| 推送 remote `github` | `https://github.com:443/superxyline/mdcx.git` |
| 回退点 | tag `before-qt-removal`（摘除 Qt 前的完整状态） |

**NAS 部署（已完成，实测通过）**

| 项目 | 值 |
|---|---|
| 地址 | `192.168.31.26`，飞牛 fnOS（Debian 12，x86_64） |
| Web | `http://192.168.31.26:8000` |
| 部署目录 | `/vol1/1000/Docker/mdcx/` |
| 容器 | `mdcx`（8000）、`mdcx-clash`（7890 代理 / 9090 面板） |
| 媒体库 | `/vol1/1000/影视` → 容器内 `/media` |
| 当前成果 | 439 部片子，全部带齐封面/背景图/缩略图/NFO |

> SSH 用户 `<NAS用户名>`，**密码未记录在文档中**，需要时向用户索取。
> docker 命令需要 `sudo`，且 sudo 需要密码。

---

## 三、本次会话完成的工作

### 1. 设置页无法保存（前端）

**根因**：`ui/src/routes/settings.tsx` 的 `onSubmit` 是空函数，整个前端没有一处调用后端的配置保存接口。

**修复**：接上 `updateConfigMutation`；用本地草稿 + 内容比对判断是否有改动；
把保存按钮改为**固定在屏幕右下角的悬浮栏**——因为设置页有 100+ 字段、总高 2 万多像素，
原来的按钮在文档最底部，用户根本找不到（这是"保存不了"的真正原因）。

### 2. 刮削成功率低（配置）

**根因**：默认字段来源优先级是 `theporndb → official → dmm → javdb`，
但这四个源**全部不可用**（theporndb 无 token 且是欧美站、official 前缀表缺新番号、
dmm 需无头浏览器、javdb 无 Cookie）；而实测可用的 **javbus/jav321 根本不在列表里**。

**修复**：优先级改为 `official → javbus → jav321 → javdb → dmm`，
图片类字段（thumb/poster/extrafanart）改为 `javbus → dmm → theporndb`。

### 3. 官网番号前缀表过时（代码）

S1 从 2024 年起主力番号改为 SONE/SNOS，但 `mdcx/manual.py` 的 `OFFICIAL` 表里没有，
导致新片一律报「不在官网番号前缀列表中」。已补 `sone|snos`。

> 仍约有 40 个前缀无官网支持（STARS/START/MIDA/MXGS 等），由 javbus/jav321 兜底。

### 4. 文件名被加上 `-cd3`（配置）

**根因**：`cd_char` 里的 `endc` 让字母 `c` 被当作「第 3 集」，
而 `-C` 本意是**中文字幕标记**（`cnword_char` 里明确定义了 `-C.`）。
`SONE-647-C.mp4` 因此被刮成 `SONE-647-cd3.mp4`。

**修复**：从 `cd_char` 移除 `endc`。

### 5. 封面没有裁剪成竖版（配置）

**根因**：`core/web.py:692` 有段逻辑——若 `download_files` 里勾了 `IGNORE_YOUMA`，
有码片的封面会**直接复制缩略图**而不走裁剪。

**修复**：移除 `ignore_youma` / `ignore_wuma` / `ignore_fc2` / `ignore_guochan`。
现在封面正确裁剪为 `379x538`（与旧桌面版产物的 `379x539` 一致）。

### 6. 加水印抛异常（代码）

**根因**：摘除 Qt 层时**误删了 `resources/Img`**，但加水印的代码仍在，
每次 `Image.open(mark_pic_path)` 都抛异常。

**修复**：`git checkout before-qt-removal -- resources/Img` 恢复。
水印图标会复制到 `/data/userdata/watermark/`。注意该目录还带回了若干 Qt 用的 svg/ico，可清理。

### 7. WebSocket 日志推送失败（代码）

**根因**：`mdcx/server/ws/types.py` 的 `to_json` 用 `json.dumps` 直接序列化，
日志里夹带 `Path` 对象时整条消息推送失败，表现为界面日志时断时续。

**修复**：加 `default=str`。

### 8. 固化开箱默认配置（代码）

把调优结果写进 `mdcx/config/models.py` 的默认值，让新装用户开箱即用：

| 配置项 | 默认值 |
|---|---|
| `media_path` | `/media`（与 docker-compose 挂载一致） |
| `suffix_sort` | `[]`（文件名纯番号） |
| `cd_char` | 不含 `endc` |
| `download_files` | 去掉 预告片/主题片/原始剧照/剧照附加 与 4 个 `IGNORE_*` |
| `keep_files` | 去掉 预告片/主题片 |
| `field_configs` 站点优先级 | 见上文第 2 条 |
| `field_configs` 语言 | title/outline/originaltitle/originalplot → `zh_cn` |

> 这些**只影响全新安装**（无 `config.json` 时）；已有配置和 v1 老配置迁移都不受影响。

### 9. README 重写

从「项目说明」改成「照着做」：一句话简介 + 特性表 + 四步 Docker 部署 + 开箱默认配置说明 +
常见问题。已通过 GitHub API 上线。

---

## 四、遗留事项

### 1. 本地与远端 commit 不一致（低优先级）

推送 README 时 GitHub 直连中断，改用 API 提交（远端 `632c893`），
本地是 `a7a2d1f`——**内容完全相同**（md5 一致），只是 hash 不同。

下次推送前先对齐（网络恢复后）：

```bash
cd /e/codex/mdcx
git fetch github master
git reset --soft github/master
```

### 2. 改配置后需要重启容器（后端设计缺陷）

`mdcx/server/api/v1/config.py` 的 `update_config` 只写文件、**不重建 `manager.computed`**
（只有 `load()` 才会重建，见 `mdcx/config/manager.py:43`）。
所以改代理之类的设置后，**必须重启容器**才生效。

> 注意：字段优先级（`field_configs`）是直接读 `manager.config` 的，改完立即生效，不受影响。

### 3. Clash 规则会导致内网流量绕行

`clash/config.yaml` 的规则是 `MATCH,节点选择`（全部走代理，因为 `GEOIP,CN,DIRECT` 会导致
内核启动时下载 MMDB 失败）。mdcx 走代理后访问内网 Emby/Jellyfin 也会绕道节点。

需要的话在 `rules` 里加内网直连，放在 `MATCH` 之前：

```yaml
- IP-CIDR,192.168.0.0/16,DIRECT,no-resolve
- IP-CIDR,10.0.0.0/8,DIRECT,no-resolve
- IP-CIDR,172.16.0.0/12,DIRECT,no-resolve
```

### 4. 部分配置接口前端无入口

`resetConfig` / `createConfig` / `switchConfig` / `deleteConfig` 四个接口后端有、前端无 UI。
即 Web 版目前只能有一个配置文件，也不能「重置为默认」。

### 5. 结果明细刷新后丢失

成功/失败列表靠 WebSocket 实时推送，浏览器关闭期间的条目不留存。统计数字能恢复，列表是空的。
要补齐需在后端做结果环形缓冲。

### 6. 其他

- 单文件刮削接口（`/api/v1/legacy/scrape/single`）**必须传 URL**，空 URL 会报 Unsupported URL
- 设置页的 媒体路径/软链接路径/输出目录 等字段是**只读**的（`ServerPathField`），
  只能点「选择目录」通过文件浏览器改，不能手输

---

## 五、常用命令

### 本地开发

```bash
cd /e/codex/mdcx
uv sync --all-extras --dev
uv run uvicorn server:app --host 127.0.0.1 --port 8000   # 启动服务
uv run pytest                                             # 测试
uv run ruff check mdcx/ server.py                         # 代码检查

cd ui && pnpm build        # 构建前端
cd ui && pnpm run ci       # 前端 lint
```

> node 需要加进 PATH：`export PATH="/e/codex/tools/node-v24.19.0-win-x64:$PATH"`
> pnpm：`/e/codex/tools/pnpm/node_modules/.bin/pnpm.cmd`

### NAS 运维

```bash
cd /vol1/1000/Docker/mdcx
sudo docker compose logs -f mdcx     # 日志
sudo docker compose restart mdcx     # 重启（改配置后必须）
sudo docker compose up -d --build    # 重建镜像
```

**快速部署（不重建镜像）**：本地构建前端后 `docker cp` 进容器即可，
静态文件是每次请求时读取的，不用重启：

```bash
tar -czf /tmp/ui.tar.gz dist
scp /tmp/ui.tar.gz <NAS用户名>@192.168.31.26:/tmp/
# NAS 上
cd /tmp && tar -xzf ui.tar.gz && sudo docker cp dist/. mdcx:/app/ui/dist/
```

> 这种方式改的是容器可写层，`docker compose up -d --build` 重建后会失效，需要重新拷。

---

## 六、踩过的坑

### 环境相关

1. **git 有全局 `insteadOf` 规则**会把 `github.com` 改写成 `ghproxy.net`（只读加速，**不能推送**）。
   推送时 remote 要用 `https://github.com:443/<user>/<repo>.git` 这种带端口的形式绕过。
2. **Git Bash 的 `/tmp` 与 Windows python 的路径不通用** —— 传给 Windows 程序的文件路径
   要用 `E:\...` 或 `E:/...`。
3. **命令行传含中文的 JSON 会编码出错**，写成文件再用 `--data-binary @file` 才可靠。

### 代码相关

4. **测试 mdcx 内部函数要模拟服务端初始化**，否则会因「开发模式不允许监听 0.0.0.0」
   或「信号未初始化」失败：

   ```python
   from mdcx.server import var; var.is_server = True
   from mdcx.server.signals import signal
   from mdcx.signals import set_signal; set_signal(signal)
   ```

5. **`async_client` 绑定在后台执行器的事件循环上** —— 在别的 loop 里直接 `await` 会报
   `attached to a different loop`。要用 `mdcx.utils.executor.run(coro)`。

6. **mdcx 的日志走 WebSocket，不写文件**（`save_log` 配置项是废弃的）。
   要抓日志需连 `ws://<host>/api/v1/ws/`，且**必须带子协议 `v1.mdcx`**，
   否则 `NegotiationError: no subprotocols supported`。

7. **`LogBuffer` 按协程任务隔离** —— 用 `asyncio.wait_for` 包住会另起 task，读不到错误日志。

8. **Windows 换行符会产生大量假 diff** —— `git status` 显示 M 但 `git diff` 为空时是 CRLF 问题。

9. **Starlette 抛的是自己的 HTTPException**，FastAPI 的是其子类，`except` 必须捕获父类。

10. **fnOS 上构建 Docker 镜像的坑**：buildkit 解析 `FROM` 会 401，需要先 `docker pull`
    基础镜像再用 `DOCKER_BUILDKIT=0` 构建；Dockerfile 里不能用 `# syntax=docker/dockerfile:1`。

---

## 七、项目结构（当前）

```
mdcx/
├── Dockerfile / docker-compose.yml / .dockerignore
├── docker/                  # entrypoint.sh, deploy-nas.sh, README.md, clash 模板
├── mdcx/
│   ├── base/                # 文件/图片/视频基础操作
│   ├── cmd/                 # 命令行工具
│   ├── config/              # 配置管理(JSON Schema 驱动前端设置页)
│   ├── core/                # 刮削主流程 (scraper.py, file_crawler.py, web.py, image.py)
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
│       ├── routes/          # index(刮削) / tool / settings / logs / network / about
│       ├── components/      # AskDialog, PosterCutter, FileBrowser, form/*
│       ├── store/           # scrapeStore, logStore
│       └── theme/md3.ts     # MD3 主题
└── tests/
```

---

## 八、用户偏好（来自 AGENTS.md）

- **写代码前必须先确认**，不要直接开始写
- 优先复用开源项目，不要从头写
- 构建/下载的工具放在 `E:\codex\tools`
- Fork 代码优先用国内加速镜像
- 构建 APK 需先确认，只构建 arm64
- **思考过程用中文**

---

## 九、下一步建议

按优先级：

1. **修 `update_config` 不重建 computed 的问题**（改一行，让配置改完立即生效，不用重启）
2. 给结果明细做服务端留存（解决刷新丢失）
3. 补设置页缺失的配置入口（重置/新建/切换/删除配置）
4. 核实并补充其余无官网支持的前缀（需逐个确认官网域名，补错会让每次刮削白等超时）
5. 按需补充 README 截图
