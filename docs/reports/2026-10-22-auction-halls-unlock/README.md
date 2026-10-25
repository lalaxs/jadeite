# 公盘达到等级后立即开放

## 问题与结果

原服务同一时间只运行一个厅堂，达到经营等级只会解除等级锁，仍要等待世界轮换；已解锁但未轮到的卡片没有入场按钮。界面缓存还缺少厅堂解锁状态，可能在现金和当前场次不变时沿用升级前卡片。

按用户确认的新规则，各公盘独立运行场次：经营 Lv.1～Lv.5 分别开放新手、常规、精品、专场、传奇公盘。达到等级后立即出现对应入口，可以自由进入或返回已付费的公盘。前后端仍以经营经验计算等级，入场费、每轮重复入场保护、最后 10 秒停止入场及各档位原石品质规则继续生效。

## 实现

- 保留 `state.auction` 作为旧存档的主场次，在 `state.auctionRounds` 保存其他厅堂；每个公盘在自己的场次结束后接续同档新场。
- 入场、投标和开窗按厅堂分派；旧投标/开窗请求缺少 `hallId` 时按唯一原石 ID 定位。请求中厅堂与原石不匹配时拒绝，不扣款。
- 保证金核对检查全部在售场次；一个公盘结算不会提前退还其他公盘的有效保证金。多场结算报告排队确认，避免互相覆盖。
- 私有快照增加各厅堂的公开安全视图；未缴费的厅堂不提供原石详情。其他厅堂的原石不进入旧共享原石池。前端按当前选择读取相应场次、出价和开窗状态。
- 缓存指纹包含解锁、开放、已入场及场次时间；升级时无须依赖现金或主公盘换场触发重绘。
- 旧存档中的原有场次、入场记录、出价和保证金保留；世界维护补齐其他厅堂。新增场次字段纳入 JSON、SQLite 和增量持久化，并校验厅堂重复、场次/原石 ID 重复及时间/金额。

## 验证

新增 `auction-halls-unlock-smoke.mjs`：Lv.1～Lv.5 阈值、无人在线时立即开放、两场入场及重复返回、跨场投标/开窗拒绝、保证金隔离、独立结算、多场报告确认、旧存档迁移、读档、升级时真实渲染缓存刷新及各公盘独立停止入场。

新增 `auction-halls-socket-e2e.mjs`：临时 SQLite 服务中提升至 Lv.2，立即进入新手与常规两场并分别投标；验证低等级拒绝、进程重启后的场次 ID/出价/保证金恢复、重复请求和重复返回不扣费。两项新测试已纳入 `test:auction-service`。

共 21 项相关脚本通过；未运行完整 `npm test`：

`auction-service-smoke`、`auction-halls-unlock-smoke`、`auction-halls-socket-e2e`、`auction-settle-modal-smoke`、`world-store-smoke`、`snapshot-service-smoke`、`server-idle-smoke`、`gameplay-rules-smoke`、`player-progression-smoke`、`experience-regressions-smoke`、`offline-service-smoke`、`sqlite-world-persist-smoke`、`world-persist-smoke`、`runtime-ticks-smoke`、`socket-handlers-smoke`、`refactor-contracts-smoke`、`server-optimization-regressions`、`responsive-layout-smoke`、`styles-split-smoke`、`architecture-quality-gate`、`blackmarket-npc-schedule-smoke`。

浏览器按 game-playtest 技能在独立 3017 测试服验收，使用与问题截图一致的 372 总经验（Lv.2、122/550），验证两个公盘同时可选、正常入场、刷新恢复入场状态、切换后不重复收费；浏览器错误日志为空。该测试服禁用持久化，未读取或写入玩家真实存档。

- [Lv.2 两个公盘均可选择](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-22-auction-halls-unlock/lv2-halls.jpg)
- [再次进入常规公盘，现金保持 ¥28,000](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-22-auction-halls-unlock/regular-entered.jpg)

## 生效状态

代码与独立测试服验收完成。原 3000 端口常驻进程需要重启后加载新代码。此前自动审批拒绝了停止并重启该服务进程的操作，原因仅返回 `blocked by policy`；本次没有将测试服验收表述为常驻服务已生效。

验收附件：[文件列表](https://github.com/lalaxs/jadeite/tree/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-22-auction-halls-unlock)。
