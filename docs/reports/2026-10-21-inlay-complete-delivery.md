# 手绘镶嵌设计补齐

2026-10-21

2026-10-22 更新：[佛公镶嵌边缘重叠修复](2026-10-22-buddha-mount-edge/README.md)。微镶底座合并为一圈，佛公沿实际玉件轮廓贴合手绘金属截面，替代本文初版的完整底框与随形边条叠加方式。

本次补齐本套设计中的蛋面主玉绘画层、佛公雕刻层、金银蛋面包边和佛公空底座，接入工坊预览与共用成品渲染。之前已接入的戒圈、扣头、爪位、石座、连接环、编绳和三种配石继续共用。

## 本次接入

- 新增 [主玉与底座图集](../../public/assets/inlay/jade-and-mounts-handpainted-v2.png)，1774×887 RGBA，872,820 字节。包含蛋面与佛公的中性灰手绘明暗图、金银蛋面完整包边、金银佛公完整底座及两种手绘金属边条。
- 蛋面与佛公使用图片中的笔触、体积、五官、手部、腹部、衣褶。佛公原来的程序圆弧五官已移除，蛋面原来的白色椭圆高光不再用于这两类主玉。
- 主玉以中性明暗图片叠加实际取件材质，沿用原来的颜色、飘花、棉裂、位置和外轮廓；未将所有原料替换为固定绿色图片。
- 包边和佛公底座使用完整手绘底座 PNG。随形部分用手绘边条沿真实轮廓组合，轮廓遮罩用于贴合原件，底座外观不再只用平面金属纹理描线。
- 本套主玉绘画覆盖蛋面和佛公。叶子等其他既有雕件保留原雕刻细节，并共用新的图片随形底座。手镯精修路线保持现有行为。
- 原貌视图保持取件本身；仅看玉件视图保留加工后的手绘绘画层，并隐藏配件。材料用量、配石数量与结算规则保持原规则。

## 代码

- `public/inlay-artwork.js`：第三张图集、八个实测裁切区域、主玉中性明暗合成、完整底座图片。
- `public/inlay-painted-mounts.js`：完整底座、随形图片边条、封底图片组合。
- `public/finished-product-renderer.js`：手绘主玉与底座接入，保留原始材质与手镯分支。
- `scripts/inlay-artwork-smoke.mjs`：新增完整主玉、佛公底座、独立玉件视图及图集引用验证。

## 素材生成

使用内置 ImageGen。输入包括已确认的游戏画风设计板和从游戏实际轮廓生成的约束图。

[完整生成提示词](../art/2026-10-21-inlay-v3/core-generation-prompt.txt) · [实际轮廓约束图](../art/2026-10-21-inlay-v3/native-art-guide.png)

## 验证

相关检查通过：`inlay-artwork-smoke`、`finished-product-design-smoke`、`jade-piece-smoke`、`inlay-system-smoke`、`bangle-finish-smoke`、`finish-plan-model-smoke`、`inlay-preview-tester-smoke`、`jade-renderer-smoke`、`lazy-preview-smoke`、`inventory-module-smoke`、`market-card-info-smoke`、`architecture-quality-gate`。

浏览器验证：正常 3000 端口的工坊预览已显示 `handpainted-v2`，佛公主玉绘画、三层底座图片、60 颗实际钻石均已组合；隔离 3012 测试世界中 6 件库存成品的位图缓存全部加载，佛公表面的原料裂纹仍在；390×844 手机视口未发生横向溢出，控制台无错误和警告。临时视口已恢复，测试服务已关闭。

## 实际截图

- [佛公完整效果](2026-10-21-inlay-complete/buddha-complete-desktop.jpg)
- [蛋面戒指完整效果](2026-10-21-inlay-complete/ring-complete-desktop.jpg)
- [槽镶蓝宝石实际效果](2026-10-21-inlay-complete/channel-complete-desktop.jpg)
- [库存列表](2026-10-21-inlay-complete/inventory-complete-desktop.jpg)
- [库存缓存、原料裂纹与编绳](2026-10-21-inlay-complete/inventory-cached-buddha.jpg)
- [390 宽手机](2026-10-21-inlay-complete/buddha-complete-mobile.jpg)

前端直接使用静态模块与版本化图片，无需重启正常游戏服务，刷新页面即可看到新版。

