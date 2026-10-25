# 服务实例化：公盘、交易行与黑市

本批对应原方案阶段 2 的交易服务实例化，承接工坊前后端拆分。以其他任务完成后的工作树为比较对象，保留交付材料分析、公共工位、掌柜自营、材料价值池、黑市定价和已有兼容路径。运行期间其他任务陆续完成规划草稿、财务、库存详情及黑市详情，并按用户要求关闭新的来料单入口；这些后续变更一起纳入最终集成基线。本批重构负责服务实例化及相应验证。

原重构冻结副本通过 164/164 项回归和 8/8 组界面对比，原始等价证明对应 632 文件的重构快照。后续功能全部完成后，最终集成基线固定为 2026-10-23 20:29:33（Asia/Shanghai）的 655 文件版本，见 [integration-manifest.json](./integration-manifest.json)。没有覆盖其他任务的代码。后续授权的财务功能有意修改部分业务函数，因此保留历史函数体等价证明，另用当前业务规则、服务隔离和完整集成回归验证最新版本。

最终验收完成：最新集成 166/166 项回归全部通过；8/8 组界面对比覆盖 160 个状态、320 张截图；草稿/财务真实服务浏览器 10 项、库存详情 6 种布局、黑市详情 24 个视图均通过。工作区 655 个源码、配置与夹具文件与被测副本逐字节一致，全部 394 个运行时文件通过基线哈希检查。JSON/SQLite 重启、旧状态恢复、跨玩家回滚、幂等、协议、安全与既有发布检查均已执行。代表截图：[黑市详情](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-trading-service-refactor/screenshots/integrated-blackmarket-desktop.png)、[手机成本详情](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-trading-service-refactor/screenshots/integrated-04-cost-detail-mobile.png)、[最新材料分析](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-trading-service-refactor/screenshots/integrated-desktop-material-analysis.png)。

**最新基线**

- 已确认其他同项目任务结束；最近一个任务只输出方案，没有改代码。
- 基线于 2026-10-23 19:15:44（Asia/Shanghai）冻结：607 个源码、配置和夹具文件，364 个运行时代码或资源文件。
- 基线快照：`.refactor-test-results/trading/trading-baseline-2026-10-23-01`；[基线清单](./baseline-manifest.json)记录逐文件 SHA-256、Git 基准和排除项。当前工作树已有大量其他任务改动，本批未重置、暂存或提交它们。
- 最终候选：`.refactor-test-results/trading/trading-final-2026-10-23-01`，共 632 个文件；[候选清单](./candidate-manifest.json)。最终验收在此副本上运行，测试期间不再修改其源码。
- 所有服务测试使用合成玩家及临时端口，持久化关闭或使用测试自行创建的临时数据库；未修改真实存档，也未重启运行中的游戏。复用现有依赖，没有安装新依赖。
- 最终集成副本：`.refactor-test-results/trading/trading-integration-2026-10-23-02`，655 文件，394 个运行时文件。其间的 `trading-integration-2026-10-23-01` 仅作为中间记录；最终验收不修改冻结副本的源码。

**改动后的边界**

| 入口或实现 | 职责 |
| --- | --- |
| `server/services/auction-service.js` | 35 行兼容入口；保留旧导出及显式 `bindAuctionApi`，新增 `createAuctionService` |
| `server/services/auction-instance.js` | 公盘实例；保留入场、开窗、竞价、托管、开标、退款和轮次调度原逻辑 |
| `server/services/market-service.js` | 37 行兼容入口；保留旧导出及显式 `bindMarketApi`，新增 `createMarketService` |
| `server/services/market-instance.js` | 交易行实例；原有挂牌、购买、求购、托管、批发收购和退款逻辑 |
| `server/services/blackmarket-service.js`、`blackmarket/index.js` | 继续兼容既有导出路径；新增 `createBlackmarketService` |
| `server/services/blackmarket/create-service.js` | 273 行显式组装；按依赖顺序创建 13 个内部模块，返回原有 72 个公开成员 |
| `server/services/blackmarket/instances/*` | 原 context、resources、helpers、blind、npc 系列、rating、recovery、service、stall 的实例实现 |
| `server/services/blackmarket/legacy.js` | 只为旧导入与测试保留显式默认绑定；私有实例不从这里读取依赖 |
| `server/services/achievement-rewards-instance.js` | 每个交易实例自己的奖励账本钩子；原奖励入口继续兼容其他领域 |

实现函数按完整源码迁入工厂，没有复制新的业务决策或重新设计数值。`wantBucketName` 作为纯函数从市场实现导出，黑市实例直接引用它，不经旧默认服务取值。黑市内部能力按依赖注入，实例实现没有回导旧全局入口，也没有模块级可变服务槽。

`wire-server.js` 为每个装配结果创建独立交易服务，原依赖和调用顺序保持。四个先注册、后使用的报告/快照回调继续延迟查找。公盘原来隐式使用的奖励账本钩子改为显式传入同一个 `earnCash`，未改变到账、工资和账本语义。

调用方排查还发现 `acceptMarketOffer` 指令直接导入旧全局市场服务。现在通过现有 `wire-server → socket-handlers → commerce-commands` 依赖链传入所属实例。只增加这一项依赖，不改事件名称、请求字段、幂等检查、toast 或广播顺序。完整装配和两处网关的语法树检查会逆转声明过的接线变化，再与冻结原文比较，防止混入其他行为变化。

**兼容与验证**

- 223 个原函数的函数体、参数与默认值，28 个原常量初始化表达式，与冻结源码逐项匹配。三个实例保留各自原公开成员，旧命名导入和 `bind*` 仍可用。
- 19 组确定性新旧实现差分，比较结果、完整玩家/世界状态、扣款/托管/库存/奖励/消息/反馈的顺序、随机数消耗和 ID 引用。覆盖公盘入场与结算、挂单/求购、商品和资源交易、盲盒续抽、技术委托、NPC 轮换补货与旧引用恢复。
- 同进程创建使用相同玩家 ID 的独立世界，验证互不改写；随后重绑全部旧 API，确认既有私有实例继续使用自己的依赖。奖励领取实际调用所属账本。NPC 收购指令的双注册测试验证分别路由及原有提示顺序。
- 通过真实 WorldStore 事务验证市场和黑市买卖双方都进入快照范围；回滚完整恢复资产与挂单，重试使用恢复后的玩家对象。另验证导出/导入存档后替换世界，不再改写旧世界对象。
- 344 个其他运行时文件逐字节保持基线，包括全部前端、共享规则、协议、保存格式、持久化、队列及工坊实现。本批修改 20 个原文件、新增 18 个运行时文件。没有更改存档版本、字段或迁移逻辑。
- 完整回归展开全部 `npm test`、`test:server-release`，继续运行工坊函数与行为等价检查，再加入交易服务三项专项检查，去重后共 164 项。旧阶段的历史边界清单仍保留；当前阶段使用更晚的基线和明确的 20 个修改路径，不用旧阶段“其他文件一概不变”的约束阻止已授权的新阶段。
- 界面对比沿用四种尺寸 × 日/夜主题，共 8 组、160 个状态，每轮 320 张截图；比较命令载荷、元素位置和像素，覆盖工坊、领取及材料分析。所有前端源码和资源另由哈希保护。
- 基线和最终候选均执行真实 Chrome + Socket 流程：来料单领取一次、赠料加工、销售、补货、购机、掌柜自营和手机展示。随机品质与成交价不作跨运行判等；相同随机输入的数值等价由专项差分承担。

基线完整回归为 162/162 通过。首轮候选暴露一处设备交易旧测试仍将全局故障注入应用于私有生产实例；连同预检查中发现的市场/黑市两处，均改为调用其显式绑定的兼容测试服务，保留原有失败、付款及回滚断言。五个源码定位测试随实现移动读取新文件，没有删除业务断言。

中间一次运行期间补接 NPC 收购依赖，启动检查读到了尚未完成的装配文件，因此不作为最终验收。首轮和中间运行记录分别保存在 `first-candidate-regressions.*`、`intermediate-candidate-regressions.*`。最终候选冻结后重新执行全部检查，不以覆盖截图或忽略失败的方式验收。

最终结果见 [final-regressions.json](./final-regressions.json)、[verification-summary.json](./verification-summary.json) 和 [workspace-verification.json](./workspace-verification.json)。真实流程证据与代表截图随验收汇总保存。PostgreSQL 本轮执行现有 adapter smoke，未配置真实 PostgreSQL 集成环境。

最新集成结果单独保存在 [integration-regressions.json](./integration-regressions.json)。集成门禁校验全部当前运行时文件哈希、三个服务的实例化及无旧默认服务回导；执行 19 组当前业务行为场景、双世界隔离、奖励账本隔离、持久化回滚/重试及 NPC 指令路由。历史差分不被改写成“新旧业务必须相同”。

浏览器集成模式通过 `--integration-baseline` 使用新草稿规则：关闭规划器后须保留一件套件及相同拖动坐标，随后确认原布局。中间回放的 8 组失败均是旧测试仍要求“关闭即清空”；只调整了集成测试分支，没有恢复旧玩法或放宽坐标断言。旧模式与历史快照保留。

额外执行最新草稿/财务真实服务 10 项浏览器流程、库存详情 6 种桌面/手机/短屏布局、黑市详情 24 个昼夜/桌面/手机视图。黑市详情检查使用静态传输验证购买确认目标，真实交易另由完整 Socket E2E 覆盖。

**复跑和回退**

```powershell
npm run test:trading-integration
npm run test:trading:regression
npm run test:trading:browser
```

严格历史差分 `test:trading-refactor` 应在原 632 文件冻结副本运行；它继续要求原业务函数逐字一致。当前工作区已经接纳后续业务变更，使用上方集成命令。

回退时须区分重构和后续功能：原始重构对应 20 个修改文件、18 个新增实现，但后续财务功能已在实例文件中继续开发，不能直接删除它们或覆盖旧源码。应在保留最新业务函数的前提下逆转实例装配，并重跑完整集成；也可整体还原最终集成快照用于复现。不要重置整个共享工作树或回退其他任务已确认的玩法与界面。

本批完成交易服务的实例边界。其他领域仍保留历史奖励入口；完整 `create-game` 生命周期、玩家初始化/迁移以及钱包/库存的进一步收敛，继续按原方案分批推进。此次没有把整个应用宣称为已经支持多游戏进程或完成全部阶段 2 工作。

验收附件：[文件列表](https://github.com/lalaxs/jadeite/tree/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-trading-service-refactor)。
