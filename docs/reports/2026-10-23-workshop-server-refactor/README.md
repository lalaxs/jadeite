# 工坊服务端分阶段重构验收

本阶段承接已完成的工坊前端拆分，只拆分服务端工坊职责。验收比较对象是其他任务完成后的最新工作树，包含新增交付材料分析、公共工位、掌柜自营、来料单、材料价值池和黑市 NPC 定价。上述功能属于本阶段开始前的行为基线。

验收完成：最终 162/162 项回归通过；基线和候选各 8/8 组界面对比通过，每轮覆盖 160 个状态、320 张截图；重构前后真实浏览器流程均通过。工作区 604 个源码、配置和夹具文件与已测试候选逐字节一致，357 个受保护运行时文件与基线逐字节一致。UI 排版、玩法交互、数值公式、事件协议和存档字段均保持最新基线。

**基线与范围**

- 最终基线时间：2026-10-23 18:29:01（Asia/Shanghai）。等待相关代码任务完成，并确认同项目其他活动代码任务已结束后捕获。
- 源码快照：项目内 `.refactor-test-results/server-workshop/phase2-baseline-2026-10-23-02`。596 个文件，358 个运行时代码或资源文件；SHA-256 清单见 [baseline-manifest.json](./baseline-manifest.json)。快照不覆盖已有目录，复制后再次校验源文件与副本。
- 验证副本：相邻的 `phase2-candidate-2026-10-23-02`。从冻结快照复制，只应用本阶段生产代码与测试变更。工作区最终代码须与已测试副本逐文件一致。
- 使用合成玩家，持久化关闭或使用测试自己的临时数据库。没有修改真实玩家存档，也没有重启运行中的游戏服务。依赖通过本机 `node_modules` junction 复用，未安装新依赖。
- 本阶段生产差异只包括原 `server/services/workshop-service.js` 和六个新增文件。前端、共享数值、协议、序列化、持久化、事务协调器和既有 roster/planning/delivery 服务均受基线哈希保护。

**模块与依赖**

原服务从 866 行拆为 144 行的组装入口，公开工厂路径和返回对象保持兼容。新增模块均由入口创建，按所需能力显式注入；没有反向导入入口、引导层或传输层。

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `server/services/workshop-service.js` | 144 | 组装既有 roster/planning/delivery 与新工厂，保留 49 个公开方法/值及顺序 |
| `server/services/workshop/inventory.js` | 39 | 原料、片料和成品恢复到原库存桶；委托元信息继承 |
| `server/services/workshop/queries.js` | 64 | 设备、公共工位、员工、掌柜和待加工物品查询；占用查询 |
| `server/services/workshop/products.js` | 129 | 原料与开料模板适配、产物提取、材质继承和阶段封装 |
| `server/services/workshop/commands.js` | 262 | 开工与员工指派；保留校验、工资、扣费、材料预留和失败恢复顺序 |
| `server/services/workshop/completion.js` | 232 | 耐久、成功/失败结算、价值池、经验、退款和交付批次生成 |
| `server/services/workshop/runtime.js` | 98 | 旧任务兼容、单玩家完工结算、在线/离线调度和广播 |

依赖按 roster/planning → inventory/queries/products → delivery → commands/completion → runtime 组装。原有 26 个函数按完整职责迁移，没有复制规则公式、重写条件分支或加入新的业务分支。返回的 49 个公开成员名称、值引用及枚举顺序不变。

运行调度继续通过 `getState()` 动态读取世界，使用既有 `playersMatching` 参与事务；没有缓存可变玩家根对象。回滚测试实际执行 `createMutationTracking`，验证只纳入待结算玩家，失败后恢复任务、物品、耐久和工资，再次结算读取恢复后的对象。新增工厂可独立创建；其他领域已有的共享服务绑定不在此次改动范围。

**验证方式与证据**

- 语法树比对：冻结原服务，逐项比对全部 26 个原函数，包括默认参数、模板文本、分支和操作顺序；公开返回对象、工厂参数以及动态世界代理初始化同时比对。
- 行为差分：原服务与拆分服务使用相同合成玩家、时间、随机序列和 ID 序列，比较方法输出、完整玩家状态、世界消息、钱包/库存/任务/报告/界面事件等有序副作用以及随机数消耗。26 组场景覆盖三类加工、公共工位费用/赠料免租、来料单占用、工资停工、设备故障与上架、旧参数、材料预留失败恢复、失败返料/退款、刮验与幂等领取、旧任务、在线/离线、实例隔离和回滚重试。
- 源码边界：357 个既有运行时文件保持不变，允许新增六个已声明工厂；检查模块导入无环、无模块级可变状态以及职责行数预算。
- 完整回归：展开全部 `npm test` 与 `test:server-release`，去重后逐脚本独立执行，并补充交付材料分析、交付详情和本阶段三个专项检查。保留完整失败和成功输出，不在首次失败后提前退出。
- 浏览器：四种尺寸（1280×720、1440×900、390×844、430×932）×日/夜主题。每组 20 个界面状态，验证命令载荷、元素位置尺寸和截图；覆盖加工选择器、开料、镶嵌、领取、刮验、材料分析及详情返回。基线与候选分别执行。视觉测试使用冻结状态与记录式 Socket；真实后端路径由独立 Chrome 回归补充。
- 真实浏览器：基线与候选分别启动临时游戏服务，经真实 Socket 和事务处理完成来料单领取一次、赠料三阶段加工、出售、补货、购买首台设备和掌柜自营；桌面/手机均检查，无页面异常。仅加速生产计时，不伪造资产、价格或请求响应。随机品质和成交价不用于跨运行截图判等；确定性数值比较由上述差分测试承担。

基线首次完整执行为 159 项，157 项通过。两项失败均为 Windows 下 `kill(SIGTERM)` 直接终止进程，导致退出码 `null`；账户和生产就绪业务断言已通过。随后只修改测试夹具：Windows 使用测试进程 IPC 在进程内触发实际 SIGTERM 监听器，其他平台继续发送系统信号；仍要求实际优雅关闭和退出码 0，没有放宽退出断言。两项在未拆分服务的独立 control 副本上复测通过。冻结基线的全部原文件哈希已再次核对，未覆盖；修正后的测试也用于最终完整回归。

6 个旧测试只调整工坊源码读取入口，随模块迁移读取原有函数；工艺规则导入断言支持新文件层级。旧阶段历史 fixture 和测试保留。上一阶段冻结之后新增的玩法已由本阶段新基线接纳，完整运行入口使用 `--server` 避免把阶段一冻结版本当作最新业务规则。

执行结果以 [baseline-regressions.json](./baseline-regressions.json)、[baseline-windows-retest.log](./baseline-windows-retest.log)、[final-regressions.json](./final-regressions.json) 和最终 `verification-summary.json` 为准。

详细汇总见 [verification-summary.json](./verification-summary.json)，源码一致性证据见 [workspace-verification.json](./workspace-verification.json)。视觉比较不屏蔽像素；Chrome 同源对照的阴影合成噪声基线最大为 3/255，候选最大为 2/255；所有元素坐标、尺寸和命令载荷完全一致。代表截图：[桌面材料分析（前）](./screenshots/before-desktop-material-analysis.png)、[桌面材料分析（后）](./screenshots/after-desktop-material-analysis.png)、[手机材料分析（前）](./screenshots/before-mobile-material-analysis.png)、[手机材料分析（后）](./screenshots/after-mobile-material-analysis.png)。真实流程证据：[重构前](./real-browser-before.json)、[重构后](./real-browser-after.json)。

**复跑与恢复**

```powershell
npm run test:workshop-server-refactor
npm run test:workshop-server:regression
npm run test:workshop-server:browser
```

专项边界检查绑定此次冻结清单；后续有意修改其他玩法时，需要记录新的阶段基线，不能通过删除受保护路径来规避。完整回归在隔离副本运行，结束后再核对工作区的生产与测试源码一致性。PostgreSQL 本轮执行仓库现有 adapter smoke；未配置真实 PostgreSQL 集成环境，不将其描述为线上数据库验收。

需要回退时，仅从冻结快照恢复原 `server/services/workshop-service.js`，移除本阶段新增的六个工厂，再处理本阶段测试入口；先核对文件没有被后续任务改动。没有迁移存档版本或字段，不需要数据迁移。勿重置整个工作树或覆盖其他任务已经完成的交付材料分析、数值和黑市变更。
