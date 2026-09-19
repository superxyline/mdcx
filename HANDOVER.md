# 项目交接文档

> 最后更新：2026-09-19（晚 2：结果列表持久化与预览）
> 用途：供新对话快速了解项目全貌，接续开发

---

## 〇-2、2026-09-19 晚 2：刮削结果列表持久化 + 点击预览（本轮）

背景：结果列表原本只在内存(环形缓冲)，每轮刮削清空、容器重启全丢，用户看到的永远是空的。

1. **结果持久化**：`result_buffer.py` 重写。每条成功/失败记录追加写入用户数据目录的
   `scrape_history.jsonl`（容器内 /data，已加 .gitignore），启动时自动加载，跨轮次跨重启持续累积。
   每轮刮削**不再清空**列表（legacy.py 的 clear 调用已删），统计数字仍按轮计算。
   失败原因明细(failed_details)同样持久化。
2. **记录带预览元数据**：`signals._result_detail()` 从 ShowData 提取 标题/演员/发行日期/番号/
   马赛克/海报路径/fanart路径/文件路径/目录，随记录一起存。前端实时推送和 REST 都带 detail。
3. **历史导入**：`POST /api/v1/scrape/backfill`（首页右上「导入历史」按钮）。扫描**成功输出目录 + 媒体库根目录**
   两个位置下所有 NFO，解析 title/num/actor/releasedate 生成成功记录，按 nfo_path/file_path 去重，
   时间戳用 NFO mtime。解析失败的 NFO 直接跳过（比如种子自带的 ASCII 艺术字说明文件）。
   **注意（用户已明确纠正）**：media_path=/media/待刮削 是用户的**私密影视库**，是有意设置的；
   /media（电影/电视剧）是正常影视库，与 mdcx 无关。2026-09-19 晚曾误把 media_path 改成 /media，
   已恢复回 /media/待刮削。**今后严禁改动媒体路径相关配置**（已写入 E:\codex\AGENTS.md）。
4. **前端预览**：`ResultDetail.tsx`。列表项带封面缩略图(`PosterThumb`，blob URL 带 API Key 认证)，
   点击弹出详情(封面大图+元数据+文件路径)；详情里「在工具箱中裁剪封面」跳 `/tool?cutterPath=...`
   (tool.tsx 加了 validateSearch，PosterCutter 加 initialPath 自动载入)。失败页底部展示失败原因明细。
5. **顺手修了存量 bug**：`utils/path.py` 的 `is_descendant` 在 Windows 跨盘符时
   `os.path.commonpath` 抛 ValueError → 现在返回 False。test_path 那个一直失败的用例已转绿。

遗留（本轮没做）：刮削前预览确认、媒体库浏览页、硬链接整理模式、访问密码引导。

---

## 〇-3、2026-09-19 晚 3：刮削完成链路五件套（本轮）

1. **失败一键重试**：后端 retryFailedList 本来就有, 首页失败页签加了「重试失败」按钮
   (把失败文件作为待刮清单重新提交)。注意 Flags.failed_list 只存本轮(内存), 重启后为空。
2. **完成通知**：`mdcx/notify.py`。配置新增 通知设置 区(设置页常用组):
   notify_type(bark/telegram/none) + bark_url/bark_key + telegram_bot_token/chat_id。
   刮削完成(core/scraper.py 钩子)推送统计, Telegram 走配置的代理。失败只记日志不影响刮削。
3. **Emby/Jellyfin 刷新**：配置 emby_refresh(媒体服务器分区)开关, 完成后 POST
   {emby_url}/emby/Library/Refresh?api_key=..., 局域网直连不走代理。
4. **定时自动刮削**：`mdcx/server/scheduler.py`, lifespan 启动 asyncio 任务每 30s tick:
   switch_on 含 timed_scrape + 后台空闲 + 距上次运行超过 timed_interval → 自动开刮。
   上次运行时间持久化在 /data/timed_scrape.json; 首次启动只记基准不触发。
   状态随 /scrape/status 返回(timed_enabled/timed_next_run/...), 首页空闲时显示下次运行时间。
   开关和间隔在 设置→杂项(switch_on/timed_interval)。改配置立即生效(每次 tick 读当前配置)。
5. **健康检查**：GET /api/v1/tools/health-report, 同步扫描媒体路径, 按 NFO 找出
   未刮削(视频无NFO)/缺封面/缺字段(title/releasedate/actor)/NFO解析失败, 各类最多500条。
   工具箱新增「健康检查」卡片(开始扫描 + 分类结果)。

曾踩坑：status() 返回键名 enabled 与 ScrapeStatus 字段 timed_enabled 不一致,
pydantic 静默丢弃导致状态永远 False —— ** 解包时键名必须与模型字段完全一致。

---

## 〇、2026-09-19 晚：易用性改造（上一轮）

1. **侧边栏中文化**：`Layout.tsx` 菜单改为 首页/工具箱/网络/日志/设置/关于，顶栏改「MDCx 影片元数据刮削」。
2. **设置页分区导航**：`settings.tsx` 重构为左侧分区列表（常用设置 3 区 + 高级选项 9 区），一次只渲染当前分区的字段（其余字段以 `ui:widget: hidden` 隐藏但保留值，跨分区修改不丢）。分区定义在 `SECTIONS` 常量；漏归类的字段自动落入「杂项」。`wizard_done` 字段已列入 `HIDDEN_FIELDS`。
3. **常用字段加解释**：`models.py` 里 快速上手/媒体服务器/代理与网络 的字段补了 `description`（rjsf 渲染为字段下方的说明文字）；`ChipArrayField` 也支持渲染 description。
4. **首次使用向导**：`WizardDialog.tsx`，首页检测 `wizard_done === false` 时弹出，三步：媒体库路径 → 整理方式（移动到输出目录/原地保留）→ 代理。完成或跳过都写入 `wizard_done: true`。存量 config.json 没有该字段，部署后首次打开会弹一次，点跳过即可。
5. **IGNORE_* 从设置页隐藏**：`json_schema()` 给 download_files 的枚举标记 `deprecated`（`_mark_dead_download_options`），`ChipArrayField` 不再提供这 4 个选项；旧配置里已勾选的值仍显示中文名、可删除。枚举成员保留，解析不受影响。
6. **修复设置页横向超宽**：容器加 `overflowX: hidden` + 分组标题 `overflowWrap: anywhere`（见 settings.tsx 根 Box）；表单根标题 "Config" 不再重复显示。

遗留（本轮没做）：失败重试队列、定时扫描、刮削完通知 Emby 刷新、刮削前预览确认。

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
