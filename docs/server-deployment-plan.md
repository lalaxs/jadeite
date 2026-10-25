# 38.76.197.136 内测部署

服务器为 Ubuntu 24.04 x64、4 核、4GB 内存。单个 Node.js 权威游戏进程处理所有玩家，PostgreSQL 保存世界，Caddy 分发静态资源并代理账号和实时连接。

| 服务 | 内存上限 | CPU 上限 |
| --- | --- | --- |
| 游戏 | 2GB，V8 堆上限 1280MB | 2 核 |
| PostgreSQL | 768MB | 1 核 |
| Caddy | 128MB | 0.5 核 |
| 备份 | 128MB | 0.5 核 |

首轮验收范围为 5～10 名同时在线玩家，承载能力以目标服务器实测为准。

## 发布布局

- `/opt/jade-market/releases/<APP_VERSION>`：发布源码和容器配置。
- `/opt/jade-market/current`：当前版本目录。
- `/opt/jade-market/.env.production`：仅运维账号和 root 可读的生产凭据。
- `/opt/jade-market/static/releases/<APP_VERSION>`：按版本保留的静态资源。
- `/opt/jade-market/backups`：PostgreSQL 自动备份。
- `jade-market_postgres-data`：数据库持久卷，跨发布保留。

`Dockerfile` 的 `runtime` 目标生成游戏镜像，`web` 目标生成静态资源及 Caddy 镜像。发布时先从 web 镜像提取新版本资源到静态目录，再替换入口 HTML。已有版本资源保留，供已打开的页面继续加载。

生产 Node.js 不提供静态文件。Caddy 直接提供入口及版本资源；`/api/*`、`/socket.io/*`、`/health/*`、`/version` 和 `/metrics` 进入游戏进程。入口 HTML 使用 `no-cache`，版本资源使用一年期 `immutable` 缓存，业务响应使用 `no-store`。

## 公网 IP HTTPS

`PUBLIC_DOMAIN=38.76.197.136`，`PUBLIC_ORIGIN=https://38.76.197.136`。证书由 Certbot 5.4 以上版本申请 Let’s Encrypt `shortlived` IP 证书，HTTP 验证目录为 `/var/www/acme`。首次签发时先运行只提供验证目录的 HTTP 服务。

证书申请：

```sh
/opt/certbot/bin/certbot certonly --non-interactive --agree-tos \
  --register-unsafely-without-email --preferred-profile shortlived \
  --webroot --webroot-path /var/www/acme --ip-address 38.76.197.136 \
  --cert-name 38.76.197.136
```

Caddy 读取 `/etc/letsencrypt/live/38.76.197.136/` 中的证书。安装 `ops/renew-ip-certificate.service` 和 `.timer` 到 `/etc/systemd/system/`，并将 `ops/reload-certificate.sh` 安装到 `/etc/letsencrypt/renewal-hooks/deploy/jade-market`。计时器每天检查两次；续期后自动让 Caddy 加载证书。

首次部署后运行一次 `certbot renew --dry-run --run-deploy-hooks`，确认生产 Caddy 的验证目录和证书加载正常。

## 发布门槛

发布源码保留独立归档。执行 `npm ci`、`npm run predeploy:check`，并在独立测试数据库运行 `npm run predeploy:postgres`。首轮持续业务验收使用 10 个连接、100 名存档玩家、每人 30 件库存；不把这个规模视为服务器上限。

数据库、游戏进程和 Caddy 启动后，验证可信 HTTPS、页面及资源加载、账号绑定和登录、实时状态、重复请求、存档及重启恢复。浏览器检查桌面和移动端入口、工坊和交易页面。

数据库只在 Docker 内部网络访问，主机开放 2222/TCP、80/TCP、443/TCP、443/UDP。运维使用 `jadeops`、2222 端口和 SSH 密钥。

## 备份与恢复

备份容器每天生成 PostgreSQL 备份，保留 14 天。备份另复制到运维电脑；定期复制任务依赖该电脑在线。首次开放前在独立数据库完成一次恢复演练。

发布更新保留上一版应用和静态资源。回滚前核对数据库迁移兼容性，使用运行手册中的停服、保存和回滚流程。
