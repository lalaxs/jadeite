# 手绘镶嵌素材接入

后续已补齐蛋面、佛公主玉与完整底座图片，见[最新接入与验收记录](2026-10-21-inlay-complete-delivery.md)。本文保留首轮配件接入记录。

2026-10-21

已将确认过的柔和手绘配件接入工坊镶嵌预览及共用成品渲染入口。库存、交易、收藏、直播等使用同一入口的成品展示同步生效。

## 实现

- 戒圈、扣头、连接环、爪位、圆/方石座、编绳使用独立透明 PNG 图集。
- 钻石、红宝石、蓝宝石各有圆形与方形画面；材料库存图标使用同一套宝石图。
- 随形包边与槽轨继续使用玉件实际轮廓，并以手绘金属纹理填充，支持不同尺寸和不规则裁片。
- 足金、18K、925 银、铂金分别调整色调；微镶保留实际满圈排石，槽镶、爪镶、无边镶沿用原有石座规则。
- 玉件的来源颜色、飘花、棉裂、尺寸、轮廓和取件位置保持原数据；原貌/仅看玉件对照不加载配件。
- 列表栅格化前将同源图集嵌入 SVG，防止库存与交易缓存后配件消失；图集请求按 URL 共享，失败可重试。
- 未改变镶嵌材料消耗、报价、付费、配石颗数或服务端规则。

## 文件

- `public/inlay-artwork.js`：图集地址、实测裁切坐标、SVG symbol、金属色调和手绘纹理。
- `public/finished-product-renderer.js`：玉件、背部配件、正面爪位/石座/配石分层组合。
- `public/inlay-product-renderer.js`：三种宝石材料图标。
- `public/preview-bitmap-cache.js`：带外链图集的预览安全缓存。
- `scripts/inlay-artwork-smoke.mjs`：透明通道、坐标、六镶法、SVG 引用、原玉件保持、共享图片嵌入与失败重试。
- `scripts/inlay-art-browser-fixture.mjs`：3012 端口、关闭存档持久化的独立试玩样本。
- `package.json`：`test:inlay` 加入手绘素材回归。

## 素材来源

使用内置 ImageGen 生成；未使用 CLI 或 API Key。

- [配件透明图集](../../public/assets/inlay/accessories-handpainted-v1.png)：1,215,392 字节，1254×1254 RGBA。
- [配石透明图集](../../public/assets/inlay/gems-handpainted-v1.png)：1,865,253 字节，1536×1024 RGBA。
- [配件生成提示词](../art/2026-10-21-inlay-v2/production-atlas-generation-prompt.txt)
- [配石生成提示词](../art/2026-10-21-inlay-v2/gem-atlas-generation-prompt.txt)

原始设计板与生成图保留。运行时按图集坐标组合，实际成品的主玉外观由游戏玉件数据决定。

## 验证

通过：`inlay-system-smoke`、`finish-plan-model-smoke`、`finished-product-design-smoke`、`jade-piece-smoke`、`finish-plan-controller-smoke`、`inlay-preview-tester-smoke`、`jade-renderer-smoke`、`lazy-preview-smoke`、`inventory-module-smoke`、`market-card-info-smoke`、`inlay-artwork-smoke`、`architecture-quality-gate`。

真实浏览器检查：桌面、390×844、430×932；日夜主题；红宝石爪镶戒指、方形蓝宝石戒指、佛公满圈钻石、编绳、原貌对照及 6 件库存的已加载位图缓存。浏览器未发现错误或警告；移动端页面宽度与视口一致。

试玩使用关闭持久化的独立世界，未修改原存档。默认 3000 端口服务无需重启，刷新页面即可加载前端改动。

## 实际截图

- [红宝石戒指](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-21-inlay-handpainted/ring-ruby-desktop.jpg)
- [方形蓝宝石戒指](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-21-inlay-handpainted/sapphire-square-desktop.jpg)
- [佛公微镶](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-21-inlay-handpainted/buddha-micro-desktop.jpg)
- [编绳和原貌对照](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-21-inlay-handpainted/cord-desktop.jpg)
- [390 宽手机佛公微镶](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-21-inlay-handpainted/buddha-micro-mobile.jpg)
- [430 宽手机方形配石](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-21-inlay-handpainted/sapphire-square-mobile.jpg)

