# 佛公第 1 款「圆润素面」接入

后续已按用户意见停用此造型，改为[原版佛公刻线精简](../2026-10-23-buddha-original-lines/README.md)。下文保留本轮历史记录。

2026-10-23

游戏共用成品渲染已采用用户选定的第 1 款：简化笑脸、圆润手部、大面积平滑玉面和少量衣襟刻线。工坊镶嵌预览、成品详情及库存缩略图使用同一套新雕刻明暗层。

- 直接复制已确认的图片，未重新生成或改动像素：[美术稿](../../art/2026-10-23-buddha-simple-concepts/buddha-01-rounded-minimal-v1.png)，1254×1254 RGBA，1,016,585 字节。素材来源为前一轮内置 imagegen；[生成提示词](../../art/2026-10-23-buddha-simple-concepts/generation-prompts.txt)保留。
- `public/inlay-artwork.js` 从新图片提取雕刻明暗，将原图约 0.60 的中间亮度归中。实际玉色、飘花和棉裂仍来自原玉料；原件尺寸与轮廓、金属包边和配石布局沿用现有数据。
- 原貌对照不加载雕刻图片，仅看玉件保留新雕刻；蛋面及其他款式使用原有素材。
- 普通 3000 端口服务无需重启，刷新页面即可加载前端更新。

## 验证

通过 `inlay-artwork-smoke`、`finished-product-design-smoke`、`jade-piece-smoke`、`inlay-preview-tester-smoke`、`inlay-system-smoke`、`jade-renderer-smoke`、`lazy-preview-smoke`。检查涵盖透明图片尺寸及裁切范围、已确认图片一致性、原玉件不被改写、原貌与仅看玉件、随形底座和配石数量。

浏览器使用 `PORT=3012 JADE_WORLD_PERSIST=0` 的独立样本世界，未读写玩家存档。Chrome 检查日夜主题、1440×1000 桌面、390×844 手机、爪镶/包镶/微镶/编绳、亮光/柔光/哑光、60 颗钻石、库存 256 像素位图缓存及库存详情。无页面脚本错误、素材或页面加载失败；手机页面宽度与视口一致。访客会话探测返回的预期 401 单独计数。

- [浏览器检查结果](browser-checks.json)
- [改动前](before-detail.png)
- [改动后（日间）](after-jade-day.png)
- [改动后（夜间）](after-desktop.png)
- [满圈钻石](after-diamond-desktop.png)
- [手机](after-mobile.png)
- [库存缓存](inventory-cached-buddha.png)
- [库存详情](inventory-detail.png)

复验：启动 `scripts/inlay-art-browser-fixture.mjs` 样本服务，再运行 `node docs/reports/2026-10-23-buddha-rounded-minimal/browser-qa.mjs`。
