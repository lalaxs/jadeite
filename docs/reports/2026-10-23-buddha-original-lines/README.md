# 原版佛公刻线精简

2026-10-23

按照后续意见，停用圆润素面的改版造型，改为基于原版佛公精简重复刻线。保留原版大笑脸、眉眼、耳朵、手部姿态、腹部及头身比例；合并重复眉眼层次、袖口和衣襟刻线，减少手指小刻痕与胸前装饰线。

使用内置 imagegen 编辑原始 `jade-and-mounts-handpainted-v2.png` 中的佛公，输出独立中性灰雕刻图。新图片直接复制接入，未另行修改像素或透明通道；游戏仍用实际玉料提供玉色、飘花及棉裂，沿用原件轮廓、包边和配石数据。

- [生产素材](../../../public/assets/inlay/buddha-original-clean-lines-v1.png)：1278×1230 RGBA，1,231,569 字节。
- [完整编辑提示词](../../art/2026-10-23-buddha-original-lines/generation-prompt.txt)
- 运行时裁切 `[146, 140, 1000, 944]`；明暗基准与旧图亮度对齐。
- 工坊、库存、成品详情等共用入口同步更新；页面刷新生效，无需重启服务。

通过七项现有回归：`inlay-artwork-smoke`、`finished-product-design-smoke`、`jade-piece-smoke`、`inlay-preview-tester-smoke`、`inlay-system-smoke`、`jade-renderer-smoke`、`lazy-preview-smoke`。

独立 `PORT=3012 JADE_WORLD_PERSIST=0` 样本世界完成 Chrome 桌面 1440×1000、手机 390×844、爪镶/包镶/微镶/编绳、三种抛光、60 颗钻石、库存 256 像素位图缓存与库存详情检查。页面脚本及素材加载无错误，手机无横向溢出，未读写玩家存档。访客会话探测的预期 401 单独计数。

- [浏览器结果](browser-checks.json)
- [原版改动前](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-buddha-rounded-minimal/before-detail.png)
- [精简后的实机效果](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-buddha-original-lines/after-jade-day.png)
- [手机效果](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-buddha-original-lines/after-mobile.png)
- [库存缓存](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-buddha-original-lines/inventory-cached-buddha.png)
- [库存详情](https://github.com/lalaxs/jadeite/blob/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-buddha-original-lines/inventory-detail.png)

验收附件：[文件列表](https://github.com/lalaxs/jadeite/tree/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-buddha-original-lines)。
