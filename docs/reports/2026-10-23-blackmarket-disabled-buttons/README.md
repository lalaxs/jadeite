# 黑市现金不足按钮置灰

现金不足时原本已有 `disabled` 和“现金不足”文案，但卡片购买按钮仍被专用样式设置为绿色，仅依靠全局透明度表现禁用，区分不明显。

本次只调整三个样式文件：日间、夜间的现有 `.jm-btn-gold:disabled` 规则同时用于 `.bm-goods-card .jm-buy:disabled`；卡片绿色背景仅用于非禁用购买按钮。直接共用已有购买确认按钮的灰底、字色、描边、透明度、光标和滤镜规则，未新增另一套禁用配色。

验证通过：`styles-split-smoke.mjs`、`night-theme-smoke.mjs`、`market-card-info-smoke.mjs`。没有为该样式变更新增测试脚本，未运行完整测试套件。

按 game-playtest 在独立 3020 测试服验收，禁用持久化。现金刚好等于最便宜商品的售价 ¥662 时，该按钮保持绿色且可购买，其余五件显示灰色禁用；实际支付后现金归零，剩余五个按钮均自动置灰；通过测试服开发工具补足至 ¥5,000 后，五个按钮全部恢复绿色可购。日间灰底为 `rgba(31,50,40,.1)`、夜间灰底为 `rgba(143,181,164,.14)`，均与原有购买确认按钮共享同一 CSS 规则。

- [日间对比](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-blackmarket-disabled-buttons/day.jpg)
- [夜间对比](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-blackmarket-disabled-buttons/night.jpg)

此次为前端样式变更，3000 服务直接提供最新文件，刷新游戏页面即可生效，无需重启。

验收附件：[文件列表](https://github.com/lalaxs/jadeite/tree/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-blackmarket-disabled-buttons)。
