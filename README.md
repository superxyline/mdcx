> [!WARNING]
> **关于上游项目**
>
> 本仓库基于 [sqzw-x/mdcx](https://github.com/sqzw-x/mdcx) 改造。上游已于 2026-08-23 归档
> (代码冻结, 不再接受更新), 作者另有替代项目 [Amane](<https://github.com/sqzw-x/amane>)。
>
> **本仓库的改造内容:**
>
> - **移除桌面版** — 不再依赖 PyQt5, 项目的所有 Qt 界面代码已删除
> - **纯 Web 应用** — FastAPI 后端 + 浏览器前端, 支持容器化部署
> - **材质设计 3** — 前端界面按 MD3 规范重做
> - **功能对齐** — 桌面版原有的工具(列表管理、缺失检查、Extras 批量操作、
>   Emby 演员、封面裁剪、Cookie 检测等)均已迁移到 Web 界面

# MDCx

![python](https://img.shields.io/badge/Python-3.13-3776AB.svg?style=flat&logo=python&logoColor=white)

一个影片元数据刮削器: 扫描本地媒体库, 从多个数据源抓取元数据, 下载封面与剧照,
生成 NFO 并整理文件结构, 供 Emby / Jellyfin / Kodi 等媒体服务器使用。

## 特性

- **多源刮削** — 内置数十个数据源, 可按字段配置优先级, 择优采用
- **命名与整理** — 自定义文件与目录命名规则, 自动归类成功/失败文件
- **后台任务** — 刮削在服务端后台运行, **关闭浏览器不会中断**, 重新打开即可看到进度
- **代理支持** — 内置 HTTP/SOCKS5 代理配置, 便于访问需要科学上网的刮削源
- **容器部署** — 提供 Dockerfile 与 docker-compose, 可部署在 NAS 上长期运行

## 部署

见 [docker/README.md](docker/README.md), 包含 NAS 部署、媒体库挂载、
Clash 代理与面板编排的完整说明。

本地快速启动:

```bash
uv sync --all-extras --dev
cd ui && pnpm i && pnpm build && cd ..
uv run uvicorn server:app --host 127.0.0.1 --port 8000
```

浏览器访问 `http://127.0.0.1:8000`。未设置 `MDCX_API_KEY` 时无需认证;
需要对外提供服务时设置该变量即可启用接口认证。

## 上游项目

- [yoshiko2/Movie_Data_Capture](https://github.com/yoshiko2/Movie_Data_Capture): CLI 工具,
  开源版本现已不活跃, 新版本已闭源商业化.
- [moyy996/AVDC](https://github.com/moyy996/AVDC): 上述项目早期的一个 Fork, 使用 PyQt 实现了图形界面, 已停止维护
- @Hermit/MDCx: AVDC 的 Fork, 一度在 [anyabc/something](https://github.com/anyabc/something/releases) 分发源代码及可执行文件.
- 2023-11-3 @anyabc 因未知原因销号删库, 其分发的最后一个版本号为 20231014.
- [sqzw-x/mdcx](https://github.com/sqzw-x/mdcx): 基于 @Hermit/MDCx 做了大幅重构与拆分, 现已归档.

向相关开发者表示敬意.

## 授权许可

本项目在 GPLv3 许可授权下发行。此外，如果使用本项目表明还额外接受以下条款：

- 本项目仅供学习以及技术交流使用
- 请勿在公共社交平台上宣传此项目
- 使用本软件时请遵守当地法律法规
- 法律及使用后果由使用者自己承担
- 禁止将本软件用于任何的商业用途
