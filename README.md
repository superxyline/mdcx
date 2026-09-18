<div align="center">

# MDCx Web

**影片元数据刮削器 —— 纯 Web 版, 一条命令跑在自己的 NAS 上**

扫描本地媒体库 → 多源抓取元数据 → 下载封面与剧照 → 生成 NFO → 整理目录结构

供 Emby / Jellyfin / Kodi / 飞牛影视等媒体服务器使用

![Python](https://img.shields.io/badge/Python-3.13-3776AB.svg?style=flat&logo=python&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED.svg?style=flat&logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-GPLv3-blue.svg)

</div>

---

## 这是什么

一个跑在服务端的影片刮削器。把片子丢进「待刮削」目录，在浏览器里点一下，
它就会自动识别番号、抓取标题/演员/简介/标签、下载封面海报剧照、生成 NFO 文件，
并把整理好的成品移动到「整理完成」目录。

**和你见过的桌面版刮削器比，最大的区别是它跑在服务器上：**

- 用手机、平板、电脑随便什么设备打开浏览器就能操作
- 关掉浏览器、合上笔记本, **刮削依然在跑**, 回来接着看进度
- 装在 NAS 上长期运行, 配合媒体库实现全自动整理

## 特性

| | |
|---|---|
| 🎯 **开箱即用** | 默认配置已按实测调优, 装完直接刮, 不需要先折腾一堆设置项 |
| 🔌 **多源刮削** | 内置数十个数据源, 每个字段可单独配置来源优先级, 择优采用 |
| 🖼 **完整图片** | 海报裁剪为竖版、背景图、缩略图、剧照, 一次抓全 |
| 📝 **NFO 生成** | 输出媒体服务器通用的 NFO, 元数据语言可设为中文 |
| 🗂 **自动整理** | 自定义文件与目录命名规则, 成功/失败自动分目录 |
| 🌐 **代理支持** | 内置代理配置, 刮削源需要科学上网时开箱可配 |
| 🔄 **后台任务** | 刮削在服务端独立线程运行, 与浏览器会话无关 |
| 🎨 **MD3 界面** | 前端基于 React 19 + MUI, 按 Material Design 3 规范实现 |

## 快速开始

### 方式一: Docker 部署 (推荐, NAS / 服务器)

**1. 拉取代码**

```bash
git clone https://github.com/superxyline/mdcx.git
cd mdcx
```

**2. 改一处配置 —— 你的媒体库路径**

打开 `docker-compose.yml`, 把 `volumes` 里这行左边改成 NAS 上真实的媒体库路径:

```yaml
volumes:
  - ./data:/data
  - /volume1/video:/media      # ← 左边改成你的路径, 右边保持 /media 不动
```

常见示例: 群晖 `/volume1/video`、威联通 `/share/video`、飞牛 `/vol1/1000/影视`

**3. 启动**

```bash
mkdir -p data
sudo docker compose up -d --build
```

首次构建需要几分钟(会编译前端 + 装 Python 依赖)。

**4. 打开浏览器**

```
http://你的NAS地址:8000
```

进「设置」确认**媒体路径**是 `/media`, 然后在首页点「开始刮削」即可。

> 媒体库建议先这样组织: 把待处理的片子放进 `<媒体库>/待刮削/`,
> 刮削完成后成品会移动到 `<媒体库>/整理完成/`。

### 方式二: 本地开发

```bash
uv sync --all-extras --dev
cd ui && pnpm i && pnpm build && cd ..
uv run uvicorn server:app --host 127.0.0.1 --port 8000
```

访问 `http://127.0.0.1:8000`。未设置 `MDCX_API_KEY` 时无需认证;
需要对外提供服务时设置该变量即可启用接口认证。

## 开箱默认配置

这个分支把长期使用中踩坑总结出来的配置直接固化成了默认值, **新装即可获得稳定的刮削效果**：

| 配置项 | 默认行为 | 为什么 |
|---|---|---|
| **来源优先级** | `官网 → JAVBUS → JAV321 → JAVDB → DMM` | 按实测可用性排序; 官网最权威, JAVBUS/JAV321 稳定且提供封面与剧照 |
| **封面裁剪** | 裁剪为竖版海报 | 避免媒体库显示成横版原图 |
| **文件命名** | 纯番号, 不追加后缀 | 目录干净, 也避免 `-破解`、`-中字` 之类影响识别 |
| **分集识别** | `-C` 视为中文字幕标记 | 不再被误判成「第 3 集」 |
| **下载内容** | 海报 / 缩略图 / 背景图 / NFO | 不下载预告片和主题片, 它们在媒体库里会变成多余的独立条目 |
| **标题语言** | 中文 | 日文标题自动翻译 |

> 已有配置文件的老用户不受影响 —— 默认值只在没有 `config.json` 时生效。

## 需要额外配置的两件事

**代理(可选但常见)**。刮削源大多在墙外, 建议配置代理。若用 docker-compose 里编排的
Clash 容器, 代理地址填服务名形式:

```
http://clash:7890
```

注意**不能填 `127.0.0.1`** —— 那是容器自己, 不是代理容器。
本仓库自带 Clash 编排, 细节见 [docker/README.md](docker/README.md)。

**JAVDB Cookie(可选)**。JAVDB 是很优质的源, 但需要登录 Cookie。
不配也能正常刮削, 只是少一路数据来源。

## 部署到 NAS 的完整说明

包含媒体库挂载、Clash 代理编排、面板配置、常见报错处理:

👉 [docker/README.md](docker/README.md)

## 常见问题

**刮削开始后关掉浏览器会中断吗?**
不会。任务跑在服务端的独立线程里, 与浏览器连接无关。

**提示"不在官网番号前缀列表中"?**
说明该番号对应的官网未收录。已内置 S1 等厂商的新番号前缀, 会自动回落到其他源。

**封面显示成横版的?**
检查「设置 - 下载」里是否勾了 `ignore_youma` 之类的选项, 它们会跳过裁剪。

**刮削很慢?**
主要耗时在翻译和源站超时。可在「设置 - 字段配置」里调整来源顺序,
把稳定可用的源排在前面。

## 上游项目与致谢

本项目基于 [sqzw-x/mdcx](https://github.com/sqzw-x/mdcx) 改造, 上游已于 2026-08-23 归档
(作者另有替代项目 [Amane](https://github.com/sqzw-x/amane))。

**本仓库的改造内容:**

- **移除桌面版** —— 不再依赖 PyQt5, 全部 Qt 界面代码已删除
- **纯 Web 应用** —— FastAPI 后端 + 浏览器前端, 支持容器化部署
- **Material Design 3** —— 前端界面按 MD3 规范重做
- **功能对齐** —— 桌面版原有的工具(列表管理、缺失检查、Extras 批量操作、
  Emby 演员、封面裁剪、Cookie 检测等)均已迁移到 Web 界面
- **默认配置调优** —— 见上方「开箱默认配置」

更早的脉络:

- [yoshiko2/Movie_Data_Capture](https://github.com/yoshiko2/Movie_Data_Capture) —— CLI 工具, 开源版本已不活跃
- [moyy996/AVDC](https://github.com/moyy996/AVDC) —— 上述项目早期的 Fork, 用 PyQt 实现图形界面, 已停止维护
- @Hermit/MDCx —— AVDC 的 Fork, 曾在 [anyabc/something](https://github.com/anyabc/something/releases) 分发
- 2023-11-03 @anyabc 销号删库, 最后版本号为 20231014
- [sqzw-x/mdcx](https://github.com/sqzw-x/mdcx) —— 基于 @Hermit/MDCx 大幅重构与拆分, 现已归档

向所有相关开发者致敬。

## 授权许可

本项目在 GPLv3 许可授权下发行。此外，如果使用本项目表明还额外接受以下条款：

- 本项目仅供学习以及技术交流使用
- 请勿在公共社交平台上宣传此项目
- 使用本软件时请遵守当地法律法规
- 法律及使用后果由使用者自己承担
- 禁止将本软件用于任何的商业用途
