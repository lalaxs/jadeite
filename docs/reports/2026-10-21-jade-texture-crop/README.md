# 库存玉件纹理截断修复

截图中的 `6da75309` 手镯来自旧版调试库存。生成器把中心点写成 `x: 50, y: 50`，同时标记 `svgSpace: true`。渲染器因此将其视为 600×600 原料图中的 50px，而不是 50%（300px）。手镯轮廓超出了原料纹理的矩形边界，产生了水平、垂直的截线。

修复包含：

- 调试成品生成器在 SVG 坐标中使用 `(300, 300)`。
- 共用来源坐标解析仅兼容 `roughId: debug-rough`、`svgSpace: true`、`(50, 50)` 的旧记录，不修改存档。
- 原貌裁片与成品材质绘制共用此修正，包括来源仅保存在玉件配件中的成品。正常原石坐标与已有 `jadePiece` 底稿保持原样。

验证通过：`debug-spawn-smoke`、`jade-piece-smoke`、`jade-opening-engine-smoke`、`jade-renderer-smoke`、`finished-product-design-smoke`、`inventory-module-smoke`、`inlay-preview-tester-smoke`、`blackmarket-npc-finish-smoke`。

新增回归覆盖手镯、方牌、叶子，原貌/精加工/玉件配件来源，以及正常 SVG 坐标不被误修正。修复前新增断言失败于 `50 !== 300`，修复后通过。

浏览器使用本地 3000 端口实际提供的前端模块，只读加载玩家物品到独立测试页面；没有创建玩家或注入物品。旧手镯显示与正确中心坐标的显示逐像素一致。390px 视口无横向溢出，隐藏配件控件正常，页面无脚本错误。详见 `browser-checks.json`。

- [before.png](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-21-jade-texture-crop/before.png)：同一物品修复前的矩形截断。
- [after.png](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-21-jade-texture-crop/after.png)：修复后的原貌与加工对照。
- [after-mobile.png](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-21-jade-texture-crop/after-mobile.png)：390px 视口。

前端刷新后即对旧记录生效。生成器的服务端修改在下次启动时加载；仍在运行的旧进程所生成的同类记录也受前端兼容修正覆盖。

验收附件：[文件列表](https://github.com/lalaxs/jadeite/tree/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-21-jade-texture-crop)。
