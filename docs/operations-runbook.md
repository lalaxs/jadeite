# 翡翠街运行手册

## 本地发布候选验证

```bash
npm ci
npm audit --audit-level=moderate
npm test
```

正式部署前还应运行实时连接测试和生产配置检查。任何失败都不能跳过。

推荐直接运行完整发布门槛：

```bash
npm run predeploy:check
```

再使用一个可丢弃的真实 PostgreSQL 数据库运行迁移、增量提交、投影和恢复验证：

```bash
TEST_DATABASE_URL='postgresql://...' npm run predeploy:postgres
```

## 生产环境变量

从 `.env.production.example` 复制为 `.env.production`。以下值必须替换：

- `PUBLIC_DOMAIN`
- `PUBLIC_ORIGIN`
- `POSTGRES_PASSWORD`
- `ADMIN_TOKEN`
- `APP_VERSION`

`JADE_AUDIT_RETENTION_DAYS` 默认 90，允许 7–3650。需要更长审计留存时应同时核对磁盘容量和合规策略。

数据库密码和管理令牌应分别使用至少 32 字节随机值，且不要包含在源码、聊天或日志中。

正式环境若缺少 `PUBLIC_ORIGIN` 或长度不足 32 位的 `ADMIN_TOKEN`，关闭持久化，或未选择 PostgreSQL，应用都会拒绝启动。非本机的正式 `PUBLIC_ORIGIN` 必须使用 HTTPS，且不得带路径、查询参数或锚点。

## 旧存档迁移

第一次启用 PostgreSQL 前，先停止旧服务并备份原存档。JSON 存档迁移：

```bash
DATABASE_URL='postgresql://...' \
JADE_MIGRATION_SOURCE_DRIVER=json \
JADE_MIGRATION_SOURCE_PATH=data/world.json \
npm run migrate:postgres
```

SQLite 存档将来源驱动改为 `sqlite`，并把路径指向 `data/world.sqlite`。迁移工具默认拒绝覆盖已有 PostgreSQL 检查点；确需覆盖时，必须先备份目标库，再显式设置 `JADE_MIGRATION_FORCE=1`。完成后工具会重新读取 PostgreSQL，并校验完整世界状态摘要。

## 启动与状态

当前服务器的运维账号为 `jadeops`，使用 SSH 2222 端口和本机密钥登录。root 远程登录和密码登录已关闭。

服务器部署阶段使用：

```bash
sudo sh ops/prepare-ip-test.sh
sudo sh ops/publish-ip-test.sh
docker compose --env-file .env.production ps
```

首次部署先按 `server-deployment-plan.md` 准备公网 IP 证书和 HTTP 验证服务，再执行上述命令。各发布目录保留自己的 `.env.production`。静态版本资源在构建阶段提取，入口 HTML 在后端健康后切换。

编排文件固定 Node 24.20.0、PostgreSQL 17.11 Alpine 3.24 和 Caddy 2.11.4，并使用 `APP_VERSION` 标记应用镜像；升级基础镜像时应先由 CI 完整验证，再单独提交版本变更。

检查：

```bash
curl -fsS https://38.76.197.136/health/live
curl -fsS https://38.76.197.136/health/ready
curl -fsS https://38.76.197.136/version
```

## 日常版本更新

开发与完整功能测试在本地或隔离测试库进行。正式服务器运行已发布版本，玩家账号、资产及进度保存在 PostgreSQL 持久卷中，正常代码更新沿用该卷。

`prepare-ip-test.sh` 和 `publish-ip-test.sh` 用于首次部署。后续按以下流程发布；现有 GitHub 工作流执行自动测试，正式服构建、切换和验收仍需执行发布操作。

1. 保存本次代码的 Git 提交，分配独立版本号，并将源码放入 `/opt/jade-market/releases/<版本号>`。从当前发布复制生产配置，只按本次需求调整配置和 `APP_VERSION`，保留数据库凭据及持久卷。
2. 使用 Node.js 24 运行发布检查。账号、交易、实时消息、存档或数据库相关改动，还需在可丢弃的 PostgreSQL 数据库验证。压测和功能测试数据与正式玩家数据隔离。
3. 从新版本目录运行 `sh ops/build-release.sh`，提前构建镜像并提取版本资源。每个版本号只发布一次，已有 `immutable` 资源保持原内容。
4. 记录当前版本。后端或存档更新安排短维护窗口，保存当前世界、正常停止游戏进程并备份数据库；纯图片、样式和兼容现有接口的界面更新可沿用运行中的后端。
5. 后端更新从新版本目录启动服务，健康检查通过后切换 `/opt/jade-market/current`、入口 HTML 和主生产配置副本。纯静态更新切换入口 HTML 即可。保留上一版镜像、配置和资源。
6. 核对 `/health/ready`、`/version`、错误日志、连接恢复、存档及受影响功能。正式环境使用的临时验收角色按明确 ID 清理，清理时保留真实玩家数据。将发布记录和备份同步到运维电脑。

发布记录分别注明前端资源版本和运行中的后端版本；入口资源路径对应前端版本，`/version` 对应后端版本。

纯静态更新后，已打开的页面通常需要刷新才能加载新版。后端更新期间玩家会短暂断开连接，恢复后继续使用原角色。实时消息结构变动应把已打开旧页面的处理纳入发布计划；已有玩家数据变动应单独说明规则和恢复方法。

发布异常时，先核对数据库兼容性，再切回上一版应用、入口 HTML、配置及 `current` 指向。恢复数据库会回退备份之后的玩家进度，应作为独立的数据恢复操作处理。

日常关注服务就绪状态、保存失败、磁盘空间、证书续期结果和最近一次异地备份时间。服务器备份和证书续期已有自动任务，故障通知及自动发布尚未配置。

## 查看日志

```bash
docker compose --env-file .env.production logs --tail=200 app
docker compose --env-file .env.production logs --tail=200 database
docker compose --env-file .env.production logs --tail=200 caddy
```

日志为结构化 JSON。严禁临时加入密码、Cookie 或完整玩家令牌输出。

## 角色名与排行榜

玩家在「账号」窗口修改「角色名」并保存，名字最多 10 个字符。角色名同步用于头像区和排行榜，登录名保持不变。改名成功回执在存档提交后返回，刷新或重新登录后保留。

排行榜依据正式世界中的玩家角色计算，离线角色仍保留排名。功能和负载测试使用隔离数据；正式库的验收角色须在验收结束后清理，并保留清理前备份。

## 维护模式与关机

计划重启时先确认 `/health/ready` 正常，并触发一次管理保存接口，再执行：

```bash
docker compose --env-file .env.production stop -t 30 app
```

容器收到 SIGTERM 后会停止接受操作、排空耐久写入队列并关闭数据库连接。不要使用 `kill -9`，除非进程已完全失控。

## 备份

`backup` 服务每天在 `/opt/jade-market/backups` 生成，保留 14 天：

```text
jade-market-YYYYMMDDTHHMMSSZ.dump
jade-market-YYYYMMDDTHHMMSSZ.dump.sha256
```

运维电脑的 `JadeMarket-Backup` 计划任务每天北京时间 03:30 通过 SSH 2222 端口拉取最新备份，校验后保存到 `C:\Users\666\.local\jade-market-ops\backups`。任务启用错过后补跑；电脑需在线并登录当前 Windows 用户。

`C:\Users\666\.local\jade-market-ops\backup-status.json` 记录最近成功同步时间，`backup.log` 保存任务日志。手动补跑使用 `Start-ScheduledTask -TaskName JadeMarket-Backup`，并检查任务结果及状态文件。

## 恢复演练

恢复会覆盖当前数据库，只能在明确的维护窗口执行：

1. 停止 `app` 和 `backup` 服务。
2. 再复制一份当前数据库备份。
3. 校验目标 `.sha256`。
4. 在数据库容器内运行 `ops/restore-postgres.sh`。
5. 启动应用并检查 `/health/ready`。
6. 验证玩家数、现金流水、挂单和库存投影。

恢复演练应先在临时数据库完成，确认可用后才允许操作正式库。

## 回滚

每次上线必须保留上一个不可变镜像标签。回滚前核对目标应用与已执行数据库迁移的兼容性。迁移 004 移除了旧索引，依赖旧索引的应用不能直接配合当前数据库运行；数据恢复按维护窗口单独处理。

## 常见告警

- `ready=false`：检查数据库连接、迁移和存档校验。
- `PERSISTENCE_FAILED`：立即停止新交易，检查 PostgreSQL 和磁盘。
- `durable mutation rolled back`：保存失败，玩家操作已回滚；调查数据库延迟或连接中断。
- 检查点校验失败：系统会尝试上一版本，同时应立即保全数据库和日志。
- 磁盘超过 80%：清理过期镜像与已异地保存的旧备份，不删除当前数据库卷。

## 2026 年 10 月修复版升级

更新前备份数据库。启动时自动执行迁移 004，移除日志和审计的全服请求编号唯一索引，不修改既有快照与日志内容。迁移后的旧版应用仍依赖该索引，不能只回退应用代码；需要停服并使用配套数据库备份或经过验证的兼容版本。

在生产配置中新增 `JADE_MINING_TUNING_REVIEWER_IDS`。留空即禁用正式数值审核；需要开放时填写受信任角色编号，多个编号用逗号分隔。

失效会话和缺少凭据的旧游客不能通过公开编号恢复身份。绑定账号使用密码登录；无凭据游客需由运营核实后处理，不应开放编号自动认领。

`ready=false` 在数据库仅能读取、仍无法保存时会保持为 false，实际写入恢复后才恢复就绪。监控 `jade_mutation_queue_depth`、`jade_event_loop_delay_p99_milliseconds` 和 `jade_process_resident_memory_bytes`，结合操作延迟判断容量；不要把存档玩家数量当作同时在线人数。

发布前运行 `npm run predeploy:check`，并向可丢弃的测试数据库提供 `TEST_DATABASE_URL` 后运行 `npm run predeploy:postgres`。后者覆盖真实数据库迁移、恢复、账号连接撤销和在线负载，各用独立 schema，不读取本地 `data/world.json`。

## 持续业务压测与耗时定位

`predeploy:postgres` 已包含 `test:load:mixed`。默认使用 1,000 个存档玩家、25 个在线连接，每名玩家 100 件成品、100 条历史流水及 200 个历史请求编号；持续业务阶段至少 45 秒，覆盖正常 30 秒检查点与 15 秒矿山巡检。生产和矿山使用加速测试时钟，正式调试接口关闭。测试结束会核对全部直接库存及请求投影，再重启服务器验证会话与现金恢复。

扩大规模或延长测试：

```bash
TEST_DATABASE_URL='postgresql://...' \
LOAD_CLIENTS=50 LOAD_SAVED_PLAYERS=1000 \
LOAD_INVENTORY_ITEMS=100 LOAD_DURATION_MS=180000 \
npm run test:load:mixed
```

连接数范围为 8–100，存档玩家最多 5,000，单人成品库存为 10–500，时长为 35 秒–15 分钟。报告按事件输出客户端可见耗时的 P95/P99、业务完成数量和采样内存。5 秒 P95 是发布测试的失败上限，不是正式服务的体验目标；本机短测不能代替目标服务器上的长时间容量验证。

`/metrics` 新增以下毫秒直方图，均提供 `_bucket`、`_sum`、`_count`：

| 指标 | 含义 |
| --- | --- |
| `jade_operation_phase_milliseconds` | `phase=queue` 为队列等待；`compute` 包含参与者回滚快照、领域执行、校验及差量构建；`commit` 为耐久保存调用 |
| `jade_operation_milliseconds` | 从进入队列到执行结束的总耗时，包含读取、巡检、广播与检查点队列任务 |
| `jade_persistence_transaction_milliseconds` | PostgreSQL 连接获取至提交或失败结束，按 `kind=mutation/checkpoint` 和 `outcome` 区分 |
| `jade_checkpoint_prepare_milliseconds` | 完整检查点复制、校验、序列化和校验值计算 |
| `jade_broadcast_phase_milliseconds` | `shared_snapshot` 为公共组装；`personalize_and_emit` 为个人组装、签名比较与发送排队 |
| `jade_broadcast_milliseconds` | 实际一轮广播总耗时，不包含客户端接收与渲染 |

按事件与阶段查询最近 5 分钟 P95：

```promql
histogram_quantile(0.95,
  sum by (le, event, phase) (rate(jade_operation_phase_milliseconds_bucket[5m]))
)
```

P99 将 `0.95` 改为 `0.99`。广播 P95：

```promql
histogram_quantile(0.95,
  sum by (le) (rate(jade_broadcast_milliseconds_bucket[5m]))
)
```

直方图分位数是桶内插值估算。应先看各阶段耗时，再结合队列深度、事件循环延迟和内存判断瓶颈；不能把各阶段的 P95 直接相加当作总耗时 P95。`jade_ranking_rebuilds_total` 可用于核对排行榜实际重算次数。连接失败、事务失败和回滚同样记录耗时。
