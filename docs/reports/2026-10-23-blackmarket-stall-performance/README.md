# 黑市首次进摊性能优化

复杂商品的 SVG 在首次打开货架时集中插入页面，随后再次栅格化；缓存命中之前也会先生成 SVG。普通玩家状态更新还会重新创建整块货架。

## 实现

- 广场只预热视口内最多四个实物摊位的前六件商品，悬停、键盘聚焦和滚动也会触发预热。离开页面或货架被替换后，未开始的旧任务会跳过。
- 预览在空闲时逐件生成，当前可见商品优先；相同商品共享任务。排队与图片缓存均限制为 96 项。
- 黑市卡片从脱离页面的 SVG 直接生成位图，避免先在货架绘制复杂滤镜再重复截图。素材或截图失败时保留原始外观；旧 canvas 商品继续走原渲染流程，避免缓存空白画布。
- 命中图片缓存时跳过 SVG 生成。缓存依据玉件、取件位置、器型、配材、抛光等外观数据区分，单纯价格变化可以复用图片。
- 与货架无关的经验、工坊更新保留现有 DOM。现金、商品、价格、购买门槛、服务单变化以及从其他页面返回时仍会刷新。

## 实测

本机 IAB 浏览器，对同一组六件真实 NPC 成品做单次记录。`readyMs` 是点击后到六张缓存图片均已解码的时间；这不是不同设备上的性能保证。原始数据保存在本目录 JSON 中。

| 场景 | 同步渲染 | 六张图片就绪 | 大于等于 50ms 的任务 |
| --- | ---: | ---: | --- |
| 修改前首次进入 | 23.2 ms | 1130.2 ms | 108 / 169 / 96 ms |
| 修改后直接冷进入 | 22.9 ms | 609.6 ms | 75 ms |
| 修改后广场预热完成再进入 | 4.2 ms | 18.7 ms | 无 |

未经预热直接进入仍可能短暂显示占位图。缓存只在当前页面会话内保留，刷新页面后会重新预热。

`fixture-server.mjs` 在 3020 端口使用固定商品数据和真实前端模块复现测试，不连接玩家或读写存档。单独启动 `node docs/reports/2026-10-23-blackmarket-stall-performance/fixture-server.mjs`，可通过摊位按钮测试冷进入，通过 `Plaza (prewarm)` 测试真实广场预热，通过 `Unrelated update` 验证 DOM 保留。

## 验证

九个相关脚本通过：`lazy-preview-smoke`、`blackmarket-render-smoke`、`market-card-info-smoke`、`canvas-only-smoke`、`finished-product-design-smoke`、`jade-piece-smoke`、`inventory-module-smoke`、`night-theme-smoke`、`architecture-quality-gate`。新增测试覆盖任务去重、优先级、过期任务、捕获失败回退、缓存失效、旧 canvas、现金不足、改价、售空与导航。

独立 3021 测试服禁用持久化验收：六张成品图片均完整解码，货架无待加载节点及 SVG；购买 ¥1323 商品后现金从 ¥10000 变为 ¥8677，在售件数从六变五，库存新增一件。购买弹窗仍使用原始成品预览；昼夜外观均检查，浏览器错误、警告日志为空。`retained-dom.json` 记录无关更新保留节点的结果。本轮未运行全量测试或移动端验收。

这是前端修改，刷新页面生效，不需要重启常驻 3000 服务。

![实际夜间货架](https://raw.githubusercontent.com/lalaxs/jadeite/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-blackmarket-stall-performance/stall-night.png)
![购买后昼间货架](https://raw.githubusercontent.com/lalaxs/jadeite/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-blackmarket-stall-performance/stall-day.png)

验收附件：[文件列表](https://github.com/lalaxs/jadeite/tree/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-blackmarket-stall-performance)。
