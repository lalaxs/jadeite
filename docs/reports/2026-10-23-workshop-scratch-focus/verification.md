# 原石片料独立放大展示

- 实现范围：仅有刮开功能的单件原石开料产物进入独立大图布局。沿用现有弹窗，去掉该阶段的卡片内边距，居中展示。
- 桌面预览高度 145px → 290px；手机以原单件高度 175px 的两倍 350px 为目标，按屏幕宽高等比适配。390×844 实测 340px，320×568 实测 270px，844×390 横屏实测 130px，均无内容区滚动或遮挡。
- 图像、蒙版与刮痕沿用同一坐标映射；蒙版与 SVG 实测位置、尺寸一致。开盒飞出结束后才启用刮开，揭晓后保留相同大图尺寸。
- 浏览器验证：手动刮开、跨尺寸刮痕恢复、刷新后恢复、60% 阈值自动揭晓、一键揭晓、揭晓后大图显示及正常收入背包。
- 其他产物验证：规划取件 3 件毛坯和精加工单件成品仍为 145px，无刮开蒙版和一键揭晓按钮。盒子初始尺寸仍为 240×176px，动画逻辑和时长未修改。
- 通过检查：delivery-ui.js 语法检查、workshop-scratch-smoke、workshop-delivery-smoke、responsive-layout-smoke、styles-split-smoke、ui-overlay-smoke。
- 全局 architecture-quality-gate 未通过：未在本次修改范围内的 server/persistence/player-snapshot-schema.js 当前 853 行，超过现有 850 行预算。本次仅修改 delivery-ui.js 的展示类名和 workshop-delivery.css 的局部布局规则。
- 正式端口 3000 的前端 JS、CSS 均返回 200，包含本次更新；无需重启服务，刷新游戏页面生效。
- 测试运行在 3013 端口的无存档隔离世界，验证后关闭测试服务并恢复浏览器默认尺寸。

截图：desktop-covered.jpg、desktop-partial.jpg、desktop-revealed.jpg、mobile-covered.jpg、mobile-partial.jpg、mobile-revealed.jpg、carving-unchanged.jpg、finishing-unchanged.jpg。布局测量：geometry.json。

验收附件：[文件列表](https://github.com/lalaxs/jadeite/tree/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-workshop-scratch-focus)。
