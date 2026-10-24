# 原石开料产物刮开揭晓

- 仅原石开料批次的主要料子产物启用蒙版；规划取件、余料、精加工产物及原有盒子动画保持原流程。
- 蒙版贴合原图轮廓，按有效轮廓内的唯一刮开面积计算，达到 60% 后 300ms 揭晓；支持一键揭晓。
- 未完成刮痕保存在当前浏览器；完整揭晓状态通过原有持久化操作保存到服务器。已打开的旧版批次兼容原有展示。
- 浏览器实测：完整遮挡、手动刮开、关闭恢复、刷新恢复、达到阈值自动揭晓、一键揭晓、揭晓后刷新无需重刮、两条路径正常入包。
- 390×844 布局检查：蒙版与真实预览尺寸一致，无横向溢出；画布使用 Pointer Events 与独立触控区域。
- 其他产物实测：规划取件的 3 件毛坯与余料、精加工成品均无蒙版和一键揭晓按钮。
- 通过检查：workshop-scratch、workshop-delivery、workshop-service、workshop-delivery-socket-e2e（含 SQLite 重连/重启、归属隔离及伪造请求拒绝）、snapshot-service、world-store、socket-event-schema、blackmarket-service、jade-piece、finished-product-design、bangle-finish、ui-overlay、responsive-layout、styles-split、architecture-quality-gate。
- 游戏服务已在原端口 3000 重启，恢复 106 名玩家，readiness 200；重启前已备份 world.json。

截图：covered.jpg、partial.jpg、manual-revealed.jpg、mobile-covered.jpg、mobile-revealed.jpg。
