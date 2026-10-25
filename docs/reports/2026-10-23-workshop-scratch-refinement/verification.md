# 刮料居中、放大和笔刷细化修复

上一版的局限：只把旧预览框高度从 145px 调到固定 290px，保留了 SVG 坐标内的空白；在大屏上视觉焦点不足，轮廓也未按实际边界居中。笔刷直径原为逻辑画布的 25%，几次长划就容易接近揭晓阈值。

本次修改：

- 刮料阶段使用独立的正方形展示区，按可用宽高放大，桌面上限 560px；仅此阶段的弹窗扩为最大 920px，未开盒和其他产物沿用原样式。
- 根据真实料子轮廓边界居中，最大边占展示区 90%。图像和蒙版在同一层同步变换，指针按变换后的画布坐标映射，保留原有刮痕坐标与存档兼容。
- 笔刷半径从 .125 降为 .04，直径从 25% 降为 8%，宽度为原来的 32%。自动揭晓阈值仍为 60%，一键揭晓流程未改。
- 手动刮开、恢复刮痕、已揭晓后重新打开继续大图显示、一键揭晓和收入背包通过浏览器验证。连续三道细笔划后仍保持待揭晓。

布局实测（画布最大边 / 实际轮廓最大边）：

- 1280×720：420px / 378px。
- 2559×1359：560px / 504px。
- 390×844：340px / 306px。
- 320×568：270px / 243px。
- 844×390：150px / 135px。

所有尺寸下，轮廓中心与展示区中心一致，轮廓完整显示，蒙版和 SVG 的位置与尺寸一致，内容区无滚动裁切。详见 geometry.json。

通过检查：三个前端 JS 文件语法检查、workshop-scratch-smoke（含三道细笔划不提前揭晓、继续覆盖达到 60%、重叠去重、存档恢复）、workshop-delivery-smoke、responsive-layout-smoke、styles-split-smoke、ui-overlay-smoke。

3000 正式端口已返回更新后的 CSS、笔刷和居中模块（均为 200）；本次仅前端修改，无需重启服务。刷新游戏即可加载。浏览器验证使用 3013 无存档测试世界，结束后关闭测试服务并恢复默认浏览器尺寸。

截图：before.jpg、desktop-covered.jpg、desktop-three-strokes.jpg、desktop-resumed.jpg、desktop-revealed.jpg、large-desktop-partial.jpg、mobile-partial.jpg。

验收附件：[文件列表](https://github.com/lalaxs/jadeite/tree/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-workshop-scratch-refinement)。
