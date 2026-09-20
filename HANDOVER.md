# 项目交接文档

> 最后更新：2026-09-19（深夜，会话结束交接）
> 用途：供新对话快速了解项目全貌，接续开发。**新对话请先通读本文件再动手。**

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
| 本地路径 | `E:\codex\mdcx`（git 工作区干净，与 GitHub 同步） |
| GitHub | `https://github.com/superxyline/mdcx`（公开，分支 `master`，最新提交 `9649de6`） |
| 上游 remote `origin` | `https://ghproxy.net/https://github.com/sqzw-x/mdcx.git`（只读加速） |
| 推送 remote `github` | `https://github.com:443/superxyline/mdcx.git`（带端口绕过 insteadOf 改写） |
| 回退点 | tag `before-qt-removal`（摘除 Qt 前的完整状态） |

**NAS 部署（2026-09-19 深夜已部署至最新提交，实测通过）**

| 项目 | 值 |
|---|---|
| 地址 | `192.168.31.26`，飞牛 fnOS（Debian 12，x86_64） |
| Web | `http://192.168.31.26:8000` |
| 部署目录 | `/vol1/1000/Docker/mdcx/`（源码 + data 数据卷 + clash 配置） |
| 容器 | `mdcx`（8000）、`mdcx-clash`（7890 代理 / 9090 面板） |
| 数据目录 | 容器内 `/data`（= 宿主机 `.../mdcx/data/`），含 config.json、scrape_history.jsonl、timed_scrape.json、番号库 |

**SSH 免交互访问（本轮已配好并验证，直接可用）**

- 用户 `<NAS用户名>`，密码 `<NAS密码>`；docker 需要 `sudo`（密码同上）。
- 辅助脚本：`E:\codex\tools\nas_ssh.py`（paramiko 封装，已装进 `E:\codex\tools\python310`）：
  - `python nas_ssh.py "<shell命令>"` —— 执行远程命令
  - `python nas_ssh.py --put <本地> <远程>` —— 上传并自动 md5 校验 ✅ 已实测可用
    （该 NAS 的 SFTP 被沙箱限制不可用，脚本内部走 exec 通道 `cat >` 流式写入；
    Git Bash 的 MSYS 路径改写也已内置还原，直接传 `/home/...` 即可）
- 部署流程：本地 `tar` 打包源码（排除 node_modules/dist/.git/userdata/media）→
  `nas_ssh.py --put` 上传到 `/home/Aadmin/` → 解压覆盖 `/vol1/1000/Docker/mdcx/`
  → `docker compose up -d --build`（约 3 分钟）→ curl 状态接口验证。

**NAS 当前配置（用户设定，⚠️ 严禁改动，详见「三」）**

| 配置项 | 值 |
|---|---|
| media_path | `/media/待刮削`（**用户的私密影视库**） |
| success_output_folder | `/media/整理完成` |
| failed_output_folder | `/media/刮削失败` |
| 定时刮削 timed_scrape | **关闭**（功能已实现，由用户决定何时在 设置→杂项 开启） |
| 完成通知 | 未配置（notify_type=none，用户没填 Bark/TG） |
| emby_refresh | 关闭 |
| wizard_done | true（向导已跳过，不会再弹） |

---

## 三、⚠️ 用户红线（2026-09-19 用户明确纠正，务必遵守）

1. **严禁修改 NAS 上的媒体路径配置**（media_path / success_output_folder / failed_output_folder）。
   - `/media/待刮削` 是用户的**私密影视库**，刮削就针对这里；
   - `/media`（电影/电视剧）是用户**正常的影视库**，与 mdcx 刮削无关；
   - 不要以"目录不存在/里面是普通影视"为由改动配置或移动文件。
   - 本次会话曾两次误把 media_path 改成 `/media`，均已恢复。规则已写入 `E:\codex\AGENTS.md`。
2. **对 mdcx 配置做任何修改前，先征得用户同意**（读取分析可以）。
3. 定时刮削开关默认保持关闭，由用户自行决定何时开启。

---

## 四、功能现状（全部已部署 NAS 并实测）

### 刮削主流程
- 扫描 `/media/待刮削` → 识别番号 → 多站点抓取（official → javbus → jav321 → javdb → dmm）→
  裁剪封面/下载图片/写 NFO → 按模板整理移动。
- 单文件刮削接口必须传 URL（`/api/v1/legacy/scrape/single`）。

### Web 界面（React + MUI，全中文）
- **首页**：进度/统计 + 成功/失败列表（**持久化**，见下）+ 导入历史 + 失败重试 + 首次使用向导。
- **结果持久化与预览**：每条成功/失败记录（含预览元数据与失败原因）写入
  `/data/scrape_history.jsonl`，跨轮次跨重启累积；列表带封面缩略图，点击弹详情
  （封面大图/番号/演员/日期/文件路径），详情可跳工具箱裁剪器自动载入（`/tool?cutterPath=...`）。
- **历史导入**：首页右上「导入历史」→ `POST /api/v1/scrape/backfill`，扫描成功输出目录 +
  media_path 下的 XML NFO 回填成功记录（去重；解析失败的 NFO——如种子自带说明文件——跳过）。
- **设置页**：左侧分区导航（常用：快速上手/媒体服务器/代理与网络/完成通知；高级 9 区），
  一次只渲染当前分区，其余字段隐藏但保留值；常用字段带解释文字。
- **工具箱**：封面裁剪、单文件刮削、成功/失败列表、健康检查（未刮削/缺封面/缺字段分类报告）、
  演员工具、字幕/剧照/主题视频批量处理等。
- **失败重试**：失败页签「重试失败」按钮 → `retryFailedList`（仅对本轮失败记录，
  Flags 在重启后清空）。
- **完成通知**：`mdcx/notify.py`，Bark / Telegram（TG 走配置代理），完成钩子在
  `core/scraper.py` 末尾，任何失败只写日志。
- **Emby/Jellyfin 刷新**：`emby_refresh` 开关，完成后 POST `{emby_url}/emby/Library/Refresh?api_key=...`。
- **定时自动刮削**：`mdcx/server/scheduler.py`，每 30s tick；开关 = switch_on 的 timed_scrape，
  间隔 = 杂项里的 timed_interval；上次运行持久化在 `/data/timed_scrape.json`；重启后先记基准不触发；
  状态随 `GET /scrape/status`（timed_enabled/timed_next_run），首页空闲时显示下次运行时间。
- **网络页**：Clash 面板入口；**日志页**：WebSocket 实时日志。

---

## 五、2026-09-19 会话工作记录（按时间序）

1. **ABP-646 封面不裁剪彻底修复**：删除 `core/web.py` 里 IGNORE_* 跳过裁剪的整个分支，
   无论配置怎么勾封面都裁剪（FC2/无码居中、国产右侧不变）。
2. **改配置即时生效**：`update_config` 重建 `manager.computed`（代理/超时改完不用重启容器）。
3. **设置页配置管理**：切换/新建/删除/重置，带确认。
4. **官网前缀补表结论：不能补**（xpath 强耦合 FANZA 模板），缺失前缀由 javbus/jav321 兜底。
5. **易用性改造**：界面中文化；设置页分区导航 + 字段解释；首次使用向导（`wizard_done`）；
   IGNORE_* 失效选项从表单隐藏（schema 标记 deprecated）；修设置页横向超宽与重复标题。
6. **结果列表持久化 + 点击预览 + 历史导入**（详见「四」）；顺手修了
   `utils/path.py` 在 Windows 跨盘符时 `os.path.commonpath` 抛异常的存量 bug（test_path 转绿）。
7. **完成链路五件套**：失败重试 / 完成通知 / Emby 刷新 / 定时刮削 / 健康检查（详见「四」）。
8. **媒体路径误改与恢复**：曾误把 media_path 改成 /media（两次），已全部恢复为
   `/media/待刮削` 并落盘验证；规则写入 AGENTS.md（见「三」）。

---

## 六、遗留事项（按优先级）

1. **刮削前预览确认**：识别后先展示番号/封面让用户确认再写文件（防误刮，交互改动较大）。
2. **媒体库浏览页**：按演员/系列/日期浏览已刮影片的墙页（数据在 NFO 里），点开复用结果详情弹窗。
3. **硬链接整理模式**：现有软链接在源路径变化时断，硬链接更适合单独挂媒体服务器的场景。
4. **访问密码引导**：接口认证目前关闭（MDCX_API_KEY=""），局域网内任何设备可读写文件；
   认证页代码已有（/auth），只差引导用户设置 Key。
5. **失败记录跨重启**：Flags.failed_list 只存本轮（内存），重启后「重试失败」不可用；
   可考虑把失败列表也持久化。
6. **Clash 内网直连规则**：`clash/config.yaml` 规则是 `MATCH,节点选择`，mdcx 走代理后访问
   内网 Emby 会绕道节点。需要在 rules 的 MATCH 前加：
   ```yaml
   - IP-CIDR,192.168.0.0/16,DIRECT,no-resolve
   - IP-CIDR,10.0.0.0/8,DIRECT,no-resolve
   - IP-CIDR,172.16.0.0/12,DIRECT,no-resolve
   ```
   （GEOIP,CN,DIRECT 会导致内核启动时下载 MMDB 失败，所以没加。）
7. 单文件刮削接口必须传 URL，小白不友好——可做成"自动猜站点"。

---

## 七、常用命令

### 本地开发

```bash
cd /e/codex/mdcx
uv run uvicorn server:app --host 127.0.0.1 --port 8000   # 启动服务(建议加 MDCX_SAFE_DIRS 指向测试媒体目录)
uv run pytest                                             # 测试(65 passed)
uv run ruff check mdcx/ server.py                         # 代码检查

cd ui && pnpm build        # 构建前端 (rsbuild)
cd ui && pnpm run ci       # 前端 lint (biome)
```

> node 加 PATH：`export PATH="/e/codex/tools/node-v24.19.0-win-x64:$PATH"`
> pnpm：`/e/codex/tools/pnpm/node_modules/.bin/pnpm.cmd`
> 改后端接口后要 `pnpm gen:client` 重新生成前端类型（需本地服务跑在 8000）
> ⚠️ 本地媒体路径 `/media` 不存在是正常的；媒体路径配置**不要改**（见「三」），
> 本地测试用 `MDCX_SAFE_DIRS="E:/codex/mdcx/media"` 环境变量造测试数据。

### NAS 部署（源码同步 + 重建，实测 3 分钟左右）

```bash
# 1. 本地打包
cd /e/codex/mdcx
tar czf /e/codex/tools/mdcx-src.tar.gz --exclude='ui/node_modules' --exclude='ui/dist' \
  --exclude='__pycache__' --exclude='.git' --exclude='userdata' --exclude='*.egg-info' \
  --exclude='.ruff_cache' --exclude='.pytest_cache' --exclude='media' \
  mdcx ui resources docker server.py pyproject.toml uv.lock

# 2. 上传(exec 通道, SFTP 不可用) —— 用 E:\codex\tools\nas_ssh.py
# 3. NAS 上解压覆盖 /vol1/1000/Docker/mdcx/ (先备份到 /home/Aadmin/)
# 4. 重建:
cd /vol1/1000/Docker/mdcx
echo <NAS密码> | sudo -S sh -c 'nohup docker compose up -d --build > /home/Aadmin/mdcx-build.log 2>&1 &'
# 5. 等 3 分钟, tail 日志确认 "Container mdcx Started", curl /api/v1/scrape/status 验证
```

### NAS 运维

```bash
cd /vol1/1000/Docker/mdcx
sudo docker compose logs -f mdcx     # 日志
sudo docker compose restart mdcx     # 重启
sudo docker compose up -d --build    # 重建镜像
```

---

## 八、踩过的坑（重要，先读再写代码）

### 环境

1. **git 全局 `insteadOf`** 把 `github.com` 改写成 `ghproxy.net`（只读）。推送用
   `https://github.com:443/<user>/<repo>.git`。
2. **Git Bash 的 `/tmp` 与 Windows python 路径不通用**，传给 Windows 程序用 `E:/...`。
3. **命令行传含中文 JSON 会编码出错**，写文件再 `--data-binary @file`。
4. **fnOS 的 SFTP 沙箱不可用**，paramiko 用 exec 通道 `cat >` 传文件（nas_ssh.py 已实现）。
5. **Git Bash 会改写以 `/` 开头的命令行参数**（MSYS 路径转换）：
   本机 Git 装在 `E:\codex\tools\git`，于是 `/home/Aadmin/x` 会被传成
   `E:/codex/tools/git/home/Aadmin/x`，远端命令自然失败。nas_ssh.py 已内置还原；
   直接用 bash 传参时也可加 `MSYS_NO_PATHCONV=1`。
6. NAS 的 docker 需要 `echo 密码 | sudo -S`。

### 代码

7. **rjsf `**` 解包键名必须与 pydantic 模型字段完全一致**，否则被静默丢弃
   （定时刮削的 status() 曾因键名 enabled ≠ timed_enabled 调试半天）。
8. **测试内部函数要模拟服务端初始化**：
   ```python
   from mdcx.server import var; var.is_server = True
   from mdcx.server.signals import signal
   from mdcx.signals import set_signal; set_signal(signal)
   ```
9. **`async_client` 绑定后台执行器事件循环**，别的 loop 里 await 会报
   `attached to a different loop`；用 `mdcx.utils.executor.run(coro)`。
10. **日志走 WebSocket 不写文件**；WS 必须带子协议 `v1.mdcx`。
11. **Starlette 的 HTTPException 是 FastAPI 的父类**，`except` 必须捕获父类。
12. **Windows CRLF 假 diff**：git status 显示 M 但 diff 为空就是行尾问题；
    ui 目录的文件改动后跑一次 `biome check --write src/` 会顺带统一行尾。
13. **fnOS 构建 Docker**：Dockerfile 不能用 `# syntax=docker/dockerfile:1`（fnOS 镜像加速 401）。
14. **biome ignore 注释要放在被警告的语句正上方**（如 useEffect 调用处，不是依赖数组上方）。

---

## 九、项目结构（当前）

```
mdcx/
├── Dockerfile / docker-compose.yml
├── docker/                  # entrypoint.sh, clash 模板
├── mdcx/
│   ├── base/ core/ crawlers/ models/ tools/ utils/   # 刮削核心(上游结构)
│   ├── config/              # 配置模型(JSON Schema 驱动设置页) + ui_schema
│   ├── notify.py            # 完成通知 + Emby 刷新
│   └── server/
│       ├── api/v1/          # config / scrape / tools / files / legacy / ask / ws
│       ├── result_buffer.py # 结果持久化(scrape_history.jsonl)
│       ├── scheduler.py     # 定时自动刮削
│       └── signals.py       # 信号 → WebSocket
├── ui/src/
│   ├── routes/              # index(首页) / tool / settings / logs / network / about
│   ├── components/          # WizardDialog, ResultDetail, PosterCutter, FileBrowser, form/*
│   └── store/               # scrapeStore(含持久化映射), logStore
└── tests/
```

---

## 十、用户偏好（完整版在 E:\codex\AGENTS.md，务必遵守）

- **写代码前必须先确认**（先给方案 → AskUserQuestion 确认 → 再动手）
- **严禁改 NAS 媒体路径**（见「三」，本轮血的教训）
- 思考过程用中文；优先复用开源代码；构建 APK 先确认只做 arm64
- 工具放 `E:\codex\tools`；GitHub 推送用带端口 remote

---

## 十一、下一步建议

1. 等用户把待刮内容放进 `/media/待刮削` 后实际刮一轮，观察
   结果列表/预览/持久化在真实数据上的表现
2. 想启用自动化时：设置→杂项 勾 timed_scrape + 调 timed_interval；
   通知填 Bark Key（国内最省事）；需要 Emby 自动刷库就开 emby_refresh
3. 按需推进「六、遗留事项」：预览确认 → 媒体库浏览页 → 硬链接 → 访问密码
