# 工坊模块分阶段重构记录

当前状态：阶段 0 和阶段 1 已完成，以 `final-03` 为验收基线。134 项检查全部完成验证（133 项首次通过，1 项旧定位断言调整后复测通过）；8 组浏览器对照、160 个画面状态通过。工作区内 15 个重构生产文件与验收副本一致。

本阶段范围是客户端工坊，保持现有页面排版、交互、请求、数值和存档规则。原有架构方案见 [架构分析与重构计划](../2026-10-23-game-architecture-refactor-plan.md)。

## 基线与并行改动

用户确认有其他任务在同一工作区修改代码，并要求等它们完成后再固定最终基线。因此，准备期间的快照和测试只作为预检，不能视为最终基线。

最终基线需要纳入工坊交付刮开、交易行设备出售、黑市员工与设备交易、登录日工资结算、新手经济和最新佛公素材。重构以这些任务完成后的工作区为准，不恢复旧版本玩法。

基线工具复制当前工作区的源码、资源、配置和测试，记录逐文件 SHA-256、Git HEAD 和工作区状态；它不把旧 HEAD 当作当前成品，也不复制实际玩家数据或环境密钥。快照存放在项目外的 `../jade-market-refactor-baselines/`，已有快照禁止覆盖。

初始验收快照 `../jade-market-refactor-baselines/workshop-2026-10-23-final-01/` 于 2026-10-23 16:17:27（北京时间）采集，随后 128 项完整回归及 8 组浏览器同源对照全部通过，才应用工坊拆分。

应用后，用户又在交付会话要求调整刮料展示。该会话完成后，生成最终对照快照 `../jade-market-refactor-baselines/workshop-2026-10-23-final-02/`，时间为 16:27:46。它保留初始快照中拆分前的工坊入口、动作路由器和测试命令，纳入最新的 `delivery-ui.js` 与 `workshop-delivery.css`，并使用最新测试工具。这一来源关系记录在清单的 `provenance` 字段中，未把重构后的入口当作原件。

随后并行任务继续完成了资源线稿与卖空规则、交付信息与详情弹窗、笔刷调整，以及开料待领取状态的自动同步修复。这些改动完成后，17:12:06 建立最终基线 `../jade-market-refactor-baselines/workshop-2026-10-23-final-03/`，保留拆分前入口与路由器，逐项纳入已完成的并行改动。

最终快照包含 538 个文件、22,800,510 字节，含测试依赖的佛公原图。清单见 [baseline-final-manifest.json](baseline-final-manifest.json)。Git 来源为 `d59caefaf1ea66ae7487bd40430797506f05716d`，实际基线同时包含当时所有未提交改动。快照中的生产文件有 332 个，本次重构只允许改写工坊兼容入口与动作路由器，其他 330 个逐文件校验；新增生产文件限于明确列出的 13 个工坊模块。

最终验收副本为 `../jade-market-refactor-baselines/workshop-2026-10-23-candidate-03/`，由 `final-03` 加上本次 15 个生产文件和测试命令构成，来源与校验值见 [候选文件清单](candidate-application-manifest.json)。回归与截图在隔离副本中运行，确保整轮验收使用同一版本；验收后再核对工作区中的重构文件与候选副本一致。

验收期间，交付会话又开始新增材料分析，修改了 `delivery-details-ui.js`、`workshop-delivery.css`，新增 `delivery-material-analysis.js`。这些是 `final-03` 之后的独立功能改动，已保留，未并入本次验收。工作区全目录的冻结门禁因此会提示差异；候选副本中的 330 个既有生产文件校验通过。本次 15 个生产文件、`package.json` 和 2 个补充定位测试共 18 个文件，与通过验收的副本一致，见 [工作区核验](workspace-verification.json)。

冻结的原工坊模块为 1,928 行，SHA-256 为 `522da3d4f61716c2a682f5145b69e5f31227fd14f832dc4d4ffe6d375d6c95e0`。用于对照的源文件和真实服务端状态保存在 `scripts/fixtures/workshop-baseline/`，不进入线上静态资源目录。

## 客户端模块职责

| 文件 | 职责 |
| --- | --- |
| `workshop-module.js` | 保留原有 49 个导出接口，作为兼容入口 |
| `create-workshop-feature.js` | 依赖组合、显式回调端口、挂载和销毁 |
| `state.js` | 每个实例自己的 18 项 UI 状态 |
| `scope.js` | 事件注册、Socket 订阅和待处理界面回调的清理 |
| `catalog.js` | 原有展示兜底数据、工序与形状映射 |
| `selectors.js` | 设备、员工、物料筛选与加工估算 |
| `worker-view.js` | 员工品阶、工艺评分与特性展示 |
| `item-preview.js` | 物料预览和延迟绘制策略 |
| `view.js` | 原有页面模板、增量进度与刷新协调 |
| `picker-controller.js` | 选料、选工、搜索、排序和详情弹窗 |
| `planner-controller.js` | 规划草稿、拖拽时刷新、确认与取消 |
| `finish-controller.js` | 精加工方案、材料校验与预览 |
| `inlay-preview-controller.js` | 独立的镶嵌预览调试入口 |
| `actions.js` | 导航、快捷键和工坊命令提交 |

保留现有交付模块、刮开模块和手镯精加工视图。本阶段不拆服务端，也不改动共享领域规则、协议和持久化实现。保留原有客户端兜底数据，避免在结构重构时改变旧状态的兼容行为。

原入口从 1,928 行降至 60 行，组合入口为 228 行，最大的模板模块为 460 行。`public/shell/action-router.js` 只增加带处理器身份校验的 `off(name, handler)`，用于清理工坊自己的动作，不删除后续注册的替代处理器。既有调用方式不变；需要实例控制时，可使用 `createWorkshopFeature(deps).mount()` 和 `.dispose()`。

工坊内部使用工厂函数创建实例，通过组合入口注入状态读取、界面节点、Socket、公共绘制工具及明确的跨模块回调。子模块不反向导入组合入口或兼容入口。实例销毁时注销自己拥有的事件，终结待处理界面请求，恢复未确认的规划草稿；服务端已经收到的权威命令继续由服务端处理。

## 验证方法

- 函数搬移校验：对比冻结原件与拆分代码的语法树，允许 UI 变量变为实例字段，逐项核对原有函数分支、运算、模板字面量及状态初始值。初始化和快捷键注册因增加清理职责，交由独立行为测试覆盖。
- 行为等价校验：使用同一真实服务端快照，比较原件与新实现的设备、员工、估算、模板、动作和请求。覆盖正常、缺钱、忙碌、损坏、资源挂牌、空库存、空员工名册、旧状态兜底、欠薪和余料等 13 个场景。
- 生命周期校验：两个实例状态隔离，重复挂载和销毁幂等，销毁后及重新挂载后旧回调均不提交；清理不得删除新注册的替代处理器。
- 边界校验：所有既有生产文件除工坊原入口、动作路由器外，逐文件哈希不变；新增生产文件只能是列明的工坊模块。同时检查循环依赖、实例状态和模块行数预算。
- 浏览器对照：4 个分辨率 × 明暗主题，共 8 组。原件和新实现分别运行完整操作序列，逐屏比较截图、节点几何和请求载荷，并检查页面错误。覆盖桌面与手机的选择、搜索、排序、拖拽时状态推送、规划取消与确认、手镯方案、失败重试、材料不足时焦点保持和交付刮开。
- 既有回归：完整执行项目测试链；额外检查工坊相关协议、耐久、加工、交付、JSON/SQLite 持久化与崩溃恢复等专项测试。

浏览器对照使用固定时钟、随机源和隔离的模拟传输，以便比较相同状态下的 UI 和请求；真实服务端行为由独立服务测试及 Socket 测试验证。截图不遮罩任何区域，节点几何和请求要求完全相等；对同源对照实测存在的 Chrome 阴影合成舍入，允许单通道最多 3/255 的差异。它不替代全部账号、浏览器和设备的人工验收。

## 验证记录

草稿预检通过后，使用最终原件再次核对 94 个原有函数、18 项 UI 初始值、49 个兼容导出和 13 个行为场景。当前工坊包含 21 个无循环依赖的模块，其中 13 个为本次新增，其余包含并行交付任务新增的独立视图模块。

| 验证 | 证据 |
| --- | --- |
| 初始基线完整回归：128/128 | [完整结果](phase0-final-regression.json) |
| 初始基线浏览器同源对照：8/8 | [日志](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-workshop-refactor/phase0-final-browser.log) |
| 最新交付 UI 的原件同源对照：8/8，包含实际入库 | [日志](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-workshop-refactor/phase0-reconciled-browser.log) |
| 最新交付 UI 的基线专项：37 项直接通过，缺少测试原图的 1 项补齐后复测通过 | [首次结果](phase0-reconciled-regression.json)、[单项复测](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-workshop-refactor/phase0-artwork-retest.log) |
| final-03 基线专项：48 项直接通过，1 项因详情模型搬移而更新定位断言后复测通过 | [49 项结果](phase0-final03-regression.json)、[手镯复测](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-workshop-refactor/phase0-final03-bangle-retest.log) |
| final-03 浏览器同源对照：8/8 | [日志](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-workshop-refactor/phase0-final03-browser.log) |
| 拆分后完整回归：134/134，含 1 项修正定位断言后的复测 | [原始结果及复测记录](phase1-final-regression.json)、[复测日志](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-workshop-refactor/phase1-mining-ui-retest.log) |
| 拆分后浏览器对照：8/8，共 160 个画面状态 | [执行日志](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-workshop-refactor/phase1-final-browser.log)、[汇总与逐屏像素结果](verification-summary.json) |

首轮拆分专项的一个旧断言只接受 `let` 全局变量；已改为同时识别实例字段的初始状态。独立语法树校验与行为等价校验继续验证状态值，未放宽玩法或数值断言。隔离快照缺少佛公测试原图导致的单项失败也已补齐测试资源并复测；生产素材没有变化。

交付任务抽出了库存详情模型后，手镯测试仍在旧文件中寻找 `inlaySummary`。已将定位断言跟随至共享详情模型，同时断言库存入口确实调用该模型；6 组真实加工流程、数值、源料不变、存档和失败回滚等原有断言全部保留并通过。冻结的原始基线脚本没有被覆盖，补充复测脚本和日志单独保留；候选副本使用修正后的测试。

同一次详情模型搬移也影响了矿工详情字段的源码定位断言。已同时读取入口与共享模型，保留班组、班长、分工和专精等全部原断言，复测通过。完整回归原始失败记录仍保留在 `results` 中，复测在 `retests` 中，最终有效结果在 `effectiveSummary` 中，未删除历史失败。

已人工检查桌面工坊与手机物品详情截图。对照图：[桌面原件](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-workshop-refactor/screenshots/before-desktop.png)、[桌面拆分后](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-workshop-refactor/screenshots/after-desktop.png)、[手机原件](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-workshop-refactor/screenshots/before-mobile-delivery-details.png)、[手机拆分后](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-workshop-refactor/screenshots/after-mobile-delivery-details.png)。8 组对照的节点几何与请求载荷完全一致，逐屏像素最大单通道差异为 3/255，符合已验证的同源合成舍入范围。

## 复测与回退

```powershell
Set-Location ../jade-market-refactor-baselines/workshop-2026-10-23-candidate-03
node scripts/run-workshop-regressions.mjs --full
node scripts/run-workshop-browser.mjs
```

已增加 `test:workshop-refactor`、`test:workshop:regression`、`test:workshop:browser` 等 npm 命令。通用 `npm test` 新增生命周期测试；冻结原件和全项目文件哈希属于本次结构迁移的验收门禁，放在 `test:workshop-refactor` 中，避免把后续已授权的功能或 UI 变更误判为一般单元测试失败。

上述命令在候选快照目录可重现本轮验收。直接在持续开发的工作区执行冻结门禁，会检查自 `final-03` 后新增的其他功能改动；不要通过删掉差异检查或覆盖别的会话代码来消除提示。

浏览器测试需要 Node、已安装的开发依赖和 Chrome（Windows 默认使用本机 Chrome；其他平台需 Playwright Chromium）。测试服务器仅监听本机临时端口 3137，使用内存资源与模拟传输，不读取或覆盖实际玩家存档。Socket、JSON 和 SQLite 回归使用隔离测试环境。没有针对外部生产 PostgreSQL 执行集成验证；本阶段数据库及存档实现的哈希保持不变。

回退时以 `final-03` 快照中的原工坊入口和原动作路由器为来源，仅撤销本阶段的 13 个新增模块、2 个既有生产文件和对应测试调整。先核对当前文件是否又被其他任务修改，不能用旧 Git HEAD 或整个目录覆盖工作区。保留快照和清单，可逐文件审查与恢复。

## 后续阶段

当前阶段完成后，再按照原计划处理服务端工坊应用服务、仓库与交易等模块。每次继续拆分前，先确认本阶段回归通过，并保留可回退的来源快照；任何新玩法、数值或界面调整应另立变更范围。

验收附件：[文件列表](https://github.com/lalaxs/jadeite/tree/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-workshop-refactor)。
