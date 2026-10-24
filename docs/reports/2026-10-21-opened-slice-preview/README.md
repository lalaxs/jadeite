# 已开窗片料预览修复

截图中的「豆种灰绿片料」（挂牌 ¥1,769，估值 ¥1,773）数据正确：`type: slice`、`materialStage: opened`、`stage: material`。错误发生在前端预览分流。

- 交易行与黑市共用的 `marketItemVisual`、挂牌选择预览 `mlVisual`，以及库存预览都显式排除了片料，将其送入成品绘制入口。
- 这类片料没有器型和取件位置；共用 `productCanvas` 未识别其原料身份，最终调用画布绘制器，缺少 `kind` 时默认画成圆环。

修复后，原石、明料、片料都沿用工坊规划的原料 SVG 和已取件区域；片料展示已揭露的玉料表面。共用预览入口也增加了原料类型判断。毛坯、成品和规划件保留对应的取件轮廓。无需修改存档或重启服务，刷新页面即可加载前端修复。

验证通过的 8 项检查：

- `market-card-info-smoke`
- `inventory-module-smoke`
- `jade-opening-engine-smoke`
- `jade-piece-smoke`
- `bm-plan-pool-smoke`
- `simplified-flow-smoke`
- `blackmarket-npc-smoke`（包含 240 次购买及存档恢复）
- `jade-renderer-smoke`

新增回归在修复前能复现片料落入成品画布。修复后验证卡片、挂牌预览、库存和共用入口的分流。

浏览器从本地 3000 端口加载实际前端模块，在独立页面只读展示截图中同一物品。黑市卡片、买入详情、库存、挂牌选择、共用预览均使用原料 SVG，轮廓与工坊规划一致，已开窗外皮隐藏。390px 手机视口无横向溢出，浏览器无脚本错误；详见 `browser-checks.json`。

截图：`before.png`、`after-mobile.png`、`after-desktop.png`、`inventory-after.png`。
