# 原石开料揭晓：实际材质分析

- 刮开后的右侧卡片改为开料分析，移除阶段、估值、工分等基础字段。
- 直接读取 `openingStoneFor(item)`，与当前片料 SVG 共用同一个缓存模型；复用现有翡翠开料模拟引擎的 40×40 网格和轮廓内统计，不重新随机生成材质。
- 种水显示实际种水及玉肉内占比。现有引擎每块料只有一个种水，玉肉为该种水 100%，不编造多种种水比例。全废料时显示未检出可用玉肉。
- 颜色分布按整块料面统计，包含废料，排除轮廓外画布。显示精度 0.1%，最大余数法保证合计恰好 100.0%。裂纹覆盖与废料占比采用引擎既有口径：玉肉上的裂纹影响区格数 / 料面总格数，废料格数 / 料面总格数。
- 未调整刮擦画笔、60% 揭晓阈值、单独放大、盒子动画、物品详情弹窗、点击返回原领取弹窗及入包逻辑。

验证：

- `node scripts/workshop-material-analysis-smoke.mjs`：固定四格样本验证轮廓裁剪、已知色区与裂纹面积、废料不重复计裂、全废料边界；40 个真实种子验证渲染模型一致、稳定输出及百分比合计。
- `workshop-delivery-details-smoke`、`workshop-scratch-smoke`、`jade-opening-engine-smoke`、`styles-split-smoke`、`responsive-layout-smoke`、`workshop-delivery-smoke`、`inventory-module-smoke` 通过；新增/编辑 JS 语法检查通过。
- 浏览器：3013 无存档隔离世界，真实开料批次领取→开盒→一键揭晓，右侧出现实际种水与色区、裂纹/废料比例；390×844 手机信息卡可滚动看完分析，返回按钮完整可见；点击后恢复原领取弹窗，物品详情与最终入包正常。测试结束后关闭隔离服务和标签页，恢复视口。
- 主要截图：desktop-analysis.jpg、mobile-analysis.jpg、mobile-analysis-defects.jpg。
