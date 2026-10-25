# 上线前验收清单

## 代码与依赖

- [ ] 当前源码已有可恢复快照。
- [ ] `npm ci` 可从空目录安装。
- [ ] `npm audit --audit-level=moderate` 为零漏洞。
- [ ] 完整测试全部通过。
- [ ] `npm run test:quality` 的模块行数、循环依赖、静态资产和镜像版本门禁通过。
- [ ] `TEST_DATABASE_URL=... npm run predeploy:postgres` 在真实 PostgreSQL 上通过。
- [ ] 真实 Socket 进程下的会话续登、幂等扣款和异常载荷测试通过。
- [ ] 生产镜像可重复构建。
- [ ] Node、PostgreSQL、Caddy 均使用已固定补丁版本的镜像标签，`APP_VERSION` 是本次唯一发布标签。

## 安全

- [ ] `NODE_ENV=production`。
- [ ] `JADE_DEBUG_TOOLS=0`。
- [ ] 启用持久化时 `JADE_WORLD_PERSIST_DRIVER=postgres`。
- [ ] 调试 Socket 事件在生产环境不存在。
- [ ] `PUBLIC_ORIGIN` 只包含实际使用的 HTTPS 来源（域名或持有可信证书的公网 IP）。
- [ ] 数据库密码与管理令牌互不相同。
- [ ] 生产配置中不再含有 `replace_with` / `change_me` 等占位值。
- [ ] `.env.production` 未进入 Git 或镜像。
- [ ] 未授权 `/metrics` 和 `/api/admin/*` 返回 404。
- [ ] HTTP/Socket 限流与单包限制生效。

## 数据一致性

- [ ] 重复请求不会重复扣款。
- [ ] 两名玩家不能同时买到同一件商品。
- [ ] 保存失败时客户端不会收到成功状态。
- [ ] 进程在交易中止后可恢复一致状态。
- [ ] 到期任务重启后仅结算一次。
- [ ] 旧存档迁移前后玩家、现金、库存和托管数量一致。
- [ ] 迁移工具报告完整世界状态摘要一致。
- [ ] 检查点加增量日志重放结果与提交后世界一致。
- [ ] 数据库迁移表中的版本与校验值完整，无手工漂移。

## 运维

- [ ] `/health/live`、`/health/ready` 和 `/version` 正常。
- [ ] 日志中的 Authorization、Cookie 和令牌已遮蔽。
- [ ] 每日备份成功且校验文件存在。
- [ ] 异地备份已配置。
- [ ] 临时数据库恢复演练成功。
- [ ] `JADE_AUDIT_RETENTION_DAYS` 已按合规需求设置，默认 90 天。
- [ ] 上一镜像版本和回滚步骤可用。
- [ ] 服务器防火墙只开放 22、80、443。
- [ ] 静态资源由 Caddy 提供，发布版本路径长期缓存，入口 HTML 重新验证，API 不缓存。
- [ ] IP 证书自动续期及 Caddy 证书加载通过演练。

## 发布门槛

只有以上项目全部完成，才能执行服务器部署。发现任何资产重复、负数余额、托管丢失、重复结算或恢复失败，都必须停止发布。
