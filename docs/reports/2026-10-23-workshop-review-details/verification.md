# 工坊揭晓信息、返回领取与物品详情

- 原石片料仍单独放大刮开。完整揭晓并保存成功后，右侧显示名称、阶段、估值、种水、花色、原件尺寸（有数据时）和工分；手机改为在料子下方显示信息。
- 揭晓后停留在信息展示阶段。下一次点击任意位置或按继续按钮，片料以 360ms 动画缩回原有 780px 领取弹窗，恢复标题、关闭按钮、物品卡片与收入背包按钮。降低动态效果设置下直接返回。
- 刮擦结束的那次松手以及一键揭晓的首次点击不会误跳过信息展示。手动刮开和一键揭晓两条路径均已实际验证。
- 笔刷半径 .04 → .048，宽度增加 20%。60% 自动揭晓阈值和已有刮痕存档保持一致。
- 领取弹窗中的料子、毛坯、成品卡片均支持点击或 Enter/空格打开独立详情；余料名称也可点击。详情层支持关闭按钮、背景点击和 Escape，关闭后返回原领取弹窗，查看详情不进行领取或库存标记操作。
- 提取并复用库存原有详情字段模型；库存详情内容不变。工坊详情额外展示花色，物品图使用现有实际物品渲染，余料沿用库存的取件轮廓来源。
- 浏览器验证：手动刮开后右侧信息、点击背景返回、原弹窗恢复为 780px/145px 预览、原石详情、键盘打开毛坯详情、成品详情、余料详情、详情层隔离与焦点返回、两条揭晓路径正常入包。
- 手机实测：390×844、320×568 的信息卡和继续按钮均完整可见；844×390 横屏信息在右侧，信息区可滚动。尺寸断言见 review-layouts.json。
- 通过：五个编辑模块的语法检查、workshop-scratch-smoke、workshop-delivery-details-smoke、inventory-module-smoke、workshop-delivery-smoke、responsive-layout-smoke、styles-split-smoke、ui-overlay-smoke、modal-lifecycle-smoke、jade-piece-smoke、finished-product-design-smoke，以及四个视口的实际布局断言。
- 正式端口 3000 的更新文件均返回 200；仅前端改动，无需重启，刷新游戏加载。测试使用 3013 无存档世界，完成后关闭服务并恢复浏览器默认尺寸。

主要截图：desktop-reveal-info.jpg、returned-dialog.jpg、raw-item-detail.jpg、blank-detail.jpg、finished-detail.jpg、offcut-detail.jpg、mobile-reveal-info.jpg、mobile-returned-dialog.jpg、mobile-item-detail.jpg、brush-1.2x.jpg。

验收附件：[文件列表](https://github.com/lalaxs/jadeite/tree/f26a1d5312e9bcf17546f1bae6fce47af7fdaa2e/docs/reports/2026-10-23-workshop-review-details)。
