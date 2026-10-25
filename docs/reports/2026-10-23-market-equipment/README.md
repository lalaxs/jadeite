# 交易行设备挂牌、购买与撤单

已接入交易行设备分类与工坊设备详情的挂牌入口，沿用现有挂牌、购买、撤单指令及持久化提交屏障。

- 挂牌从工坊移出设备，由交易行保管；员工留在原玩家工坊。撤单原机退回，耐久、参数与成本记录保留。
- 买入将设备直接加入买家工坊，清除原员工绑定，记录含税采购成本与交易来源。货款即时入账，沿用补薪与还款规则。
- 允许零耐久设备出售，明确提示先维修；参考价为同款新机价的 80% 减修满费用，最低 100 元。设备卡片和购买弹窗展示新机价、修满费用及购买并修满总成本。
- 允许把全部闲置设备挂牌并卖空工坊，包含每道工序的最后一台设备；加工、技术订单占用与黑市挂牌冲突由服务端拦截。设备不参与玉料批发商收购。
- 修正已有空设备列表被再次赠送初始机器的问题；空工坊不再显示前端示例设备。存档检查设备在工坊与交易行之间的唯一归属。

## 验证

设备专项测试覆盖挂牌、撤单、购买、重复提交、余额不足、全部设备售空、占用冲突、零耐久、付款后转移失败及挂牌/撤单失败回滚。

真实 Socket.IO + 临时 SQLite 测试验证：挂牌中重启后撤单、两买家同时购买仅一人成交、税费与双方资金、已售撤单拒绝，以及成交后重启仍保留唯一设备、原耐久和空员工绑定。另验证全部设备挂牌后的空工坊重启、从空工坊撤回一台再挂牌、全部成交后再次重启，均不会重复赠送设备。

首轮实现通过相关市场、设备、工坊、存档、快照、原子事务、持久化提交、Socket 请求、样式、响应式与架构门禁共 20 项检查。取消最后一台限制后，重新通过设备专项、真实 Socket/SQLite、市场服务、卡片、工坊与架构门禁 6 项检查。另按 game-playtest 技能使用 Edge/Playwright 在 1440×900 与 390×844 实际完成挂牌、撤单、重新挂牌、筛选、购买、全部设备挂牌及刷新后的空工坊查验；无浏览器错误，手机筛选与搜索按钮完整可见。

较宽范围预检中发现两条与并行新手规则变更有关的旧测试失败：`player-service-smoke.mjs:10` 仍断言初始现金 30000（当前为 12000），`workshop-delivery-smoke.mjs:41` 假设初始第二块原料存在。本功能未修改初始现金、原料赠送规则或这两条测试。

所有真实交易、重启及页面验收均使用临时存档和独立端口，未重启现有服务、未改动玩家正式存档。后端更新需重启原有服务后加载。

## 截图

- [桌面设备挂牌](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-market-equipment/list-desktop.png)
- [桌面我的设备挂单](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-market-equipment/mine-desktop.png)
- [手机设备筛选](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-market-equipment/market-mobile.png)
- [手机购买费用确认](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-market-equipment/buy-mobile.png)
- [买入后工坊设备](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-market-equipment/purchased-mobile.png)
- [手机可出售全部设备](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-market-equipment/all-devices-mobile.png)
- [全部挂牌后刷新仍为空工坊](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-market-equipment/empty-workshop-mobile.png)
- [浏览器验收结果](browser-result.json)

## 复验

```powershell
node scripts/market-equipment-smoke.mjs
node scripts/market-equipment-socket-e2e.mjs
node scripts/market-card-info-smoke.mjs
node scripts/market-equipment-browser.mjs
```

验收附件：[文件列表](https://github.com/lalaxs/jadeite/tree/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-market-equipment)。
