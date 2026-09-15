# NAS 部署说明

把 mdcx 以容器方式跑在 NAS 上，浏览器从任意设备访问。可选地同时跑一个 Clash 内核容器，
让刮削请求走代理。

## 一、目录准备

在 NAS 上找个位置（例如 `mdcx/`）放这几个文件，然后创建运行期目录：

```
mdcx/
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── docker/
│   ├── entrypoint.sh
│   ├── README.md                  # 本文件
│   └── clash-config.example.yaml  # Clash 配置模板
├── data/            # 配置/数据库/日志，首次启动自动生成
├── clash/
│   ├── config.yaml  # 你自己的 Clash 配置（不用代理则不需要）
│   └── ui/          # 面板静态文件（内核下载失败时手动放这里）
└── media/           # 媒体库，也可以直接挂载 NAS 上的真实路径
```

```bash
mkdir -p data clash media

# 需要代理时, 从模板生成一份 Clash 配置
cp docker/clash-config.example.yaml clash/config.yaml
```

## 二、媒体库挂载

编辑 `docker-compose.yml`，把媒体库那行改成分号左边是你 NAS 上的真实路径：

```yaml
volumes:
  - ./data:/data
  - /volume1/video:/media      # 群晖
  # - /share/video:/media      # 威联通
  # - /mnt/pool/media:/media   # TrueNAS / ZFS
```

如果媒体库分散在多处，多挂几行即可，同时把 `MDCX_SAFE_DIRS` 写成逗号分隔：

```yaml
environment:
  MDCX_SAFE_DIRS: "/media,/downloads"
volumes:
  - /volume1/video:/media
  - /volume1/downloads:/downloads
```

`MDCX_SAFE_DIRS` 是接口的可访问目录白名单，**挂载点和它必须对得上**，否则刮削页选中目录后会被拒绝。

## 三、启动

```bash
docker compose up -d --build
```

首次构建要装 Node 和 Python 两套依赖，视 NAS 性能和网络情况大约 5–15 分钟。
之后改代码只需重新 `--build`，依赖层有缓存会快很多。

构建完成后浏览器访问 `http://NAS的IP:8000`。

如果没有映射 8000 端口或想换端口，改 `ports` 的左边：`- "9000:8000"`。

## 四、配置代理（刮削源需要科学上网时）

mdcx 内置代理支持，**不需要**把 Clash 集成进来，两者作为独立容器通过 Docker 网络通信即可。

1. 准备 Clash 配置：把模板复制过去，按里面的注释填写。

   ```bash
   cp docker/clash-config.example.yaml clash/config.yaml
   ```

   模板里已经配好了 mdcx 需要的两个关键项：`mixed-port: 7890`（mdcx 连这个端口）和
   `external-controller: 0.0.0.0:9090`（面板与 API，见下一节）。你只需要填订阅地址和面板密码。
2. 确认 `docker-compose.yml` 中的 `clash` 服务存在，然后 `docker compose up -d`。
3. 打开 mdcx 的「设置 → 网络」，代理地址填：

   ```
   http://clash:7890
   ```

   并打开代理开关，保存。

**这里必须写服务名 `clash`，不能写 `127.0.0.1`。** 容器里的 `127.0.0.1` 指向 mdcx 自己，
不是宿主机也不是 Clash 容器。Docker Compose 会自动为同一网络里的服务建立 DNS 解析，
所以填服务名就能连通。这也是推荐用 compose 而不是 `docker run` 的主要原因。

代理只影响刮削和翻译这类网络请求，本地文件的读写完全不受影响。

如果你已经有代理跑在路由器或别的设备上，把整个 `clash` 服务删掉，代理地址改填那台设备的
`http://192.168.x.x:7890` 即可。

### 用面板管理节点

不用改配置文件就能切节点、测延迟、看连接情况——mihomo 自带托管面板的能力，
**不需要额外加容器**，面板由内核自己在同一个 9090 端口上提供。

配置模板里已经包含这几行：

```yaml
external-controller: 0.0.0.0:9090
secret: "在这里设置一个密码"
external-ui: ui
external-ui-url: "https://github.com/MetaCubeX/metacubexd/archive/refs/heads/gh-pages.zip"
```

`docker compose up -d` 之后访问：

```
http://NAS的IP:9090/ui
```

输入你设的 `secret` 即可登录。

面板是从内核自己的端口提供的，与 API 同源，不存在跨域问题。

**首次启动内核会去 GitHub 下载面板**（`external-ui-url` 那行），国内网络可能失败。
失败时手动放一份：

```bash
mkdir -p clash/ui
# 从 https://github.com/MetaCubeX/metacubexd/releases 下载压缩包,
# 解压后把里面的文件(注意不是压缩包里的顶层目录)全部放进 clash/ui/
docker compose restart clash
```

`clash/ui/` 里已经有文件时，内核会直接使用，不再尝试下载。

> **`secret` 必须设置。** 9090 端口暴露在局域网上，不设密码的话同一网络内任何设备都能
> 打开面板改你的分流规则。这个密码只用于登录面板，不影响 mdcx——mdcx 连的是 7890 端口。

## 五、数据与持久化

所有状态都落在 `/data`，对应宿主机的 `./data` 目录，包含：

- `config.json` —— 配置文件
- `userdata/` —— 番号映射、剩余任务(`remain.txt`)等
- 分类数据库、日志

**备份时直接打包 `./data` 就行。** 升级镜像不会动它。

容器里之所以能固定用 `/data`，是因为 `docker/entrypoint.sh` 会在首次启动时把 mdcx 的
标记文件 `MDCx.config` 指向 `/data/config.json`——mdcx 通过这个标记文件定位配置文件，
而配置文件所在目录同时就是它的用户数据目录。

## 六、安全

默认 `MDCX_API_KEY` 留空，接口不校验任何凭据。这适合**只在内网访问**的场景。

如果要把服务暴露到公网，务必设置一个 Key：

```yaml
environment:
  MDCX_API_KEY: "换成你自己的随机字符串"
```

设置之后，浏览器首次访问会要求输入这个 Key，接口也会校验 `X-API-KEY` 请求头。

另外注意 **Clash 的 9090 端口**：它是内核的管理接口，能改分流规则、切换节点，权限很大。
务必在 Clash 配置里设置 `secret`，并且不要把这个端口映射到公网。它只影响代理，
不涉及 mdcx 的数据。

## 七、常见问题

**启动日志提示「MDCX_SAFE_DIRS 中的目录不存在」**
卷挂载写错了，或者 `MDCX_SAFE_DIRS` 里的路径和挂载点不一致。注意 `MDCX_SAFE_DIRS` 要写
**容器内**的路径（`/media`），不是 NAS 上的真实路径。

**刮削时提示「服务器禁止访问指定的路径」**
同上，白名单和挂载点没对上。

**媒体文件读写权限错误**
容器默认以 root 运行。如果 NAS 上的共享文件夹对 root 有限制，可以在 `docker-compose.yml`
的 `mdcx` 服务下加一行指定运行用户：

```yaml
user: "1026:100"    # 改成你自己的 uid:gid，群晖常见是 1026:100
```

**拉取基础镜像很慢**
在 NAS 的 Docker 设置里配置镜像加速，或给 `Dockerfile` 的 `FROM` 换成国内 registry 的地址。

**面板打不开（`http://NAS:9090/ui` 连不上）**
按顺序排查：
1. `external-controller` 是否写成了 `0.0.0.0:9090`。默认值是 `127.0.0.1:9090`，
   那样只监听容器内部，端口映射出来也是连不上的。
2. `docker-compose.yml` 里 clash 服务的 `ports` 是否有 `"9090:9090"`。
3. NAS 防火墙是否放行了 9090。

**面板显示"无法连接内核" / 提示输入地址**
内核 API 要求填 `secret`。如果配置里设了 `secret`，面板登录时要用同一个值。
留空则不需要密码——但**不建议留空**，见下面的安全说明。

**面板能打开但一片空白 / 节点下载失败**
`external-ui-url` 从 GitHub 拉取失败是常见情况，按上面「用面板管理节点」一节手动放一份
到 `clash/ui/` 即可。

**代理配置对了但刮削还是失败**
先用面板把模式切到「全局」试一次——能通就说明是分流规则把刮削站点判成直连了，
在规则里调整即可；仍不通则是节点本身的问题，与 mdcx 无关。

**想确认代理是否生效**
进容器测一下：

```bash
docker compose exec mdcx python -c "
import urllib.request
print(urllib.request.urlopen('https://www.google.com', timeout=10).status)
"
```

能返回 200 说明容器网络和代理都通。不过注意这里没走 mdcx 的代理配置，
要验证 mdcx 是否在用代理，看刮削时的日志更直接。
