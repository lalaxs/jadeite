# 黑市员工、设备卡片与卖空规则验收

已按确认稿落地：员工与设备使用玉绿色粗线条图标，设备图案直接复用交易行原有 SVG，员工头像采用相同圆角线宽。保留现有卡片、配色、价格和购买按钮，卡面只展示两行摘要；完整技能、特质、型号、耐久及维修费用继续在详情和购买确认中展示。适配昼夜主题。

员工与设备均可全部售出，初始赠送资源也可挂牌；最后一台设备仅作提示，一次确认即可提交。忙碌、挂牌锁定、技术委托、员工人数上限和工资规则继续生效。

初始员工原来的编号属于各玩家的本地名册，转聘时会获得独立编号。原雇主记录其离职，工资历史留在原名册；避免不同玩家的初始员工撞号、存档所有权误判或读档后重新赠送。空名册和空工坊保留现有引导，后续可再次购入。

## 验证结果

- 服务端：全部初始资源挂牌与售出、两名卖方同时挂牌同编号初始员工、买方保留自己的初始员工、支付失败完整回滚、撤回解锁、空名册和空工坊存档往返、重新购入，全部通过。
- 黑市回归：玩家员工与设备交易、定价和改价、技能经验与耐久继承、工资交接、离线计薪、容量与忙碌限制、NPC 240 笔交易、货源轮换、补货与工艺、原物品与服务、界面渲染，全部通过。
- 关联回归：员工及工资政策、技能详情、花名册、内存与 JSON/SQLite 存储、交易行设备、共享领域、样式拆分、昼夜主题、响应式与模块结构检查，全部通过。
- Socket：交易行双买家竞购与卖空重启、NPC 购买和补货重启通过。
- 浏览器：Edge 无头模式，1440×900 桌面与 390×844 手机。通过实际点击完成玩家与 NPC 买卖、改价、撤回、全部七件初始资源的一次挂牌与售出，以及 SQLite 服务重启。零员工、零设备状态正确恢复。截图检查通过，无横向溢出，无浏览器脚本错误。

浏览器使用临时 SQLite 数据库，未操作正式玩家存档。本轮执行相关回归与浏览器专项，未运行整个项目的全量测试。

## 复现入口

- `node scripts/blackmarket-empty-roster-smoke.mjs`
- `node scripts/blackmarket-resources-smoke.mjs`
- `node scripts/blackmarket-resources-browser.mjs`
- `node scripts/market-equipment-browser.mjs`

浏览器记录见本目录 `browser-result.json`。[outline-cards-night.png](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-blackmarket-outline-cards/outline-cards-night.png) 与 [outline-cards-day.png](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-blackmarket-outline-cards/outline-cards-day.png) 为实际卡片；[employee-cards-mobile.png](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-blackmarket-outline-cards/employee-cards-mobile.png) 与 [equipment-cards-mobile.png](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-blackmarket-outline-cards/equipment-cards-mobile.png) 为手机货架；[empty-roster-restored-mobile.png](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-blackmarket-outline-cards/empty-roster-restored-mobile.png) 与 [empty-workshop-restored-mobile.png](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-blackmarket-outline-cards/empty-workshop-restored-mobile.png) 为重启后的空状态。

验收附件：[文件列表](https://github.com/lalaxs/jadeite/tree/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-blackmarket-outline-cards)。
