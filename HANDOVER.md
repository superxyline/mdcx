# 项目交接文档

> 最后更新：2026-09-19
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

## 三、2026-09-19 会话完成的工作

### 1. ABP-646 封面不裁剪（根因确认 + 彻底修复）

上次会话只把 4 个 `IGNORE_*` 从**默认配置**移除，对 NAS 上的**存量 config.json 无效**——
里面勾过的 `ignore_youma` 让有码片在 `core/web.py` 直接复制横版 thumb 跳过裁剪。
本次删除了整个跳过分支：**无论配置怎么勾，封面都走裁剪**（FC2/无码居中、国产右侧不变）。
枚举值保留，旧配置解析不报错。NAS 上无需改 config.json，更新代码即可。

### 2. 改配置需重启容器（已修）

`update_config` 现在重建 `manager.computed`，代理/超时等改完立即生效。
有回归测试 `tests/test_server_api.py`。

### 3. 结果明细刷新丢失（已修）

新增 `mdcx/server/result_buffer.py` 环形缓冲（2000 条），信号写 WS 的同时留存；
`GET /api/v1/scrape/results` 供页面加载时补回；新一轮刮削开始时清空。
前端 `scrapeStore.loadHistory()` 在主页加载时拉取并合并到实时推送之前。

### 4. 设置页配置管理入口（已补）

新增 `GET /config/list`；设置页顶部新增配置栏：切换/新建/删除/重置为默认（均带确认），
切换后重置表单草稿。顺带修了 `create` 写 v1 ini 到 `.json` 导致 switch 静默回落默认配置的问题。
浏览器端到端实测通过（新建→切换→切回→删除）。

### 5. 无官网支持前缀：实测结论是**不能补**

`official.py` 的 xpath 强耦合 FANZA 系官网统一模板（`p-workPage__title` 等类名）。
两轮实测 SOD/MAXING/TMA/CENTER VILLAGE/CRYSTAL/ALICE JAPAN/NaturalHigh/Nagae 等
均非该模板（搜索路径 404 或无结果），模板体系内的官网上游已收录较全。
**盲目补表 = 每次刮削白等一次请求超时**，故不补。验证脚本保留在
`scripts/check_official_sites.py`，将来想复核直接改候选列表重跑。
缺失前缀（STARS/START/MIDA/MXGS 等）由 javbus/jav321 兜底，功能无损失。

---

## 四、上一轮（09-18）完成的工作（摘要）

1. 设置页接上保存接口，保存按钮改右下角悬浮栏
2. 站点优先级改 `official → javbus → jav321 → javdb → dmm`，图片类 `javbus → dmm → theporndb`
3. 官网前缀表补 `sone|snos`
4. `cd_char` 移除 `endc`（`-C` 是中文字幕标记，不再误判成第 3 集）
5. 默认 `download_files` 去掉 4 个 `IGNORE_*`（见本轮第 1 条，当时不彻底）
6. 从 `before-qt-removal` 恢复被误删的 `resources/Img`（水印图标）
7. WS `to_json` 加 `default=str`
8. 调优结果固化进 `config/models.py` 默认值（仅新装生效）
9. README 重写为部署教程

---

## 五、遗留事项

### 1. Clash 规则会导致内网流量绕行

`clash/config.yaml` 的规则是 `MATCH,节点选择`（全部走代理，因为 `GEOIP,CN,DIRECT` 会导致
内核启动时下载 MMDB 失败）。mdcx 走代理后访问内网 Emby/Jellyfin 也会绕道节点。

需要的话在 `rules` 里加内网直连，放在 `MATCH` 之前：

```yaml
- IP-CIDR,192.168.0.0/16,DIRECT,no-resolve
- IP-CIDR,10.0.0.0/8,DIRECT,no-resolve
- IP-CIDR,172.16.0.0/12,DIRECT,no-resolve
```

### 2. 设置页横向超宽（低优先级，上游遗留）

rjsf 表单里 `FieldConfig` 分组的 H5 标题把 `body scrollWidth` 撑到约 1676px（视口 1280），
页面底部出现水平滚动条。与配置栏无关（其宽度正常），修复需调 rjsf 分组标题样式。

### 3. IGNORE_* 选项仍在设置页显示

枚举值保留是为了兼容存量配置解析；这 4 个「忽略有码/无码/FC2/国产」勾选已无任何效果，
但设置页里还在显示。可从 ui_schema 隐藏。

### 4. 其他

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

1. **把本轮改动部署到 NAS**：`sudo docker compose up -d --build` 重建镜像（fnOS 构建坑见「踩过的坑」10），
   前端也可用 `docker cp` 快速部署（见「常用命令」）
2. **重刮历史有码片**：存量 `config.json` 勾过的 `ignore_youma` 让之前刮的有码片封面是横版
   （如 ABP-646），代码修复只对新刮削生效；旧的要用「重新刮削」模式跑一遍才会裁剪
3. Clash 规则加内网直连（见遗留事项 1）
4. 修设置页横向超宽（见遗留事项 2）、隐藏失效的 IGNORE_* 选项（见遗留事项 3）
5. 按需补充 README 截图
