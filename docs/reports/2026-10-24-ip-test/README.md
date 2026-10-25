# 公网 IP 内测部署验收

测试入口：**https://38.76.197.136**。发布版本：`2026.10.24-test2`。验收日期：2026-10-24。当前开放规模为 5～10 名同时在线玩家，玩家首次进入后可通过「账号」绑定用户名和密码。

Ubuntu 24.04、4 核、4GB 服务器运行 Node.js 24.20.0、Socket.IO、PostgreSQL 17.11 和 Caddy 2.11.4。游戏规则、交易及存档由服务端处理，数据库和 Node.js 端口仅在容器网络内访问。

## 部署与验证

- 公网 IP 使用浏览器信任的 Let’s Encrypt HTTPS 证书，HTTP 自动跳转 HTTPS。证书每日检查续期两次，续期演练和 Caddy 证书重载通过。
- Caddy 直接分发静态资源，Node.js 处理 API 和实时连接。入口 HTML 使用 `no-cache`；`/releases/<版本>/` 资源使用一年期 `immutable` 缓存。已有资源版本保留。
- 项目主回归、服务端发布检查、生产同源连接检查及真实 PostgreSQL 发布门槛通过。
- 目标服务器持续业务负载：10 个在线连接、100 名存档玩家、每人 30 件库存、45 秒持续业务；完成 50 次采购、10 次交易、30 次加工和 10 次重复请求验证。最高一类业务 P95 为 2.40 秒，进程采样内存峰值 373.1MiB。原始记录见 [负载摘要](load-summary.json)。
- 隔离环境的浏览器完成赠料、公共工位三道加工、首单交付、再次进货和刷新恢复，使用加速加工计时。结果见 [完整新手流程](starter-flow/browser-flow.json)。
- 正式公网环境通过账号绑定和密码登录，使用正常加工计时完成公共工位开料、启匣和领取，赠料加工没有扣款。一个浏览器主角色与九个独立实时客户端同时连接；桌面及 390×844 手机视口无页面脚本错误。见 [浏览器验收](browser-initial.json)。
- 主机于 2026-10-24 10:06 UTC 重启，容器自动启动，原有十个测试角色重新连接；现金、采购材料及主角色已加工材料保持一致。见 [重启恢复](browser-resume.json)。
- `jade-market-20261024T100726Z.dump` 已在独立数据库还原，角色 14 名、现金合计 167,988、库存记录 14，与正式库一致；演练数据库已移除。
- Windows 的 `JadeMarket-Backup` 计划任务实际执行成功，最新备份已复制到运维电脑并通过完整性校验，任务退出码为 0。见 [异地备份记录](backup-verification.json)。

## 运维位置

当前发布：`/opt/jade-market/current`，源码目录：`/opt/jade-market/releases/2026.10.24-test2`。独立源码归档为 `/opt/jade-market/jade-market-20261024-test2.tar.gz`，归档不包含生产凭据。

运维账号为 `jadeops`，SSH 端口为 **2222**，密钥保存在 `C:\Users\666\.ssh\jade-market-deploy`。root 远程登录和密码登录已关闭。公网开放 2222/TCP、80/TCP、443/TCP、443/UDP。

```powershell
ssh -p 2222 -i C:\Users\666\.ssh\jade-market-deploy jadeops@38.76.197.136
```

```sh
cd /opt/jade-market/current
sudo docker compose --env-file .env.production ps
sudo docker compose --env-file .env.production logs --tail=100 app
```

服务器每天生成备份并保留 14 天，目录为 `/opt/jade-market/backups`。运维电脑每天北京时间 03:30 拉取最新备份，保存到 `C:\Users\666\.local\jade-market-ops\backups`；错过时间后补跑。详细操作见 [运行手册](../../operations-runbook.md) 和 [部署布局](../../server-deployment-plan.md)。

## 已知问题与限制

公共工位详情仍显示通用设备的「旗舰价」和品牌定位字段；这些字段不参与公共工位收费，赠料免加工费已实际验证。异地自动备份依赖运维电脑在线并登录当前 Windows 用户。当前并发结论限于本次 10 个自动化客户端测试；长期稳定性、更多真人同时加载资源及长期经济平衡仍需后续内测数据。
