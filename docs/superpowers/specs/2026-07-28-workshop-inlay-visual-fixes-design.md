# Workshop And Inlay Visual Fixes Design

## Goal

修复两个测试中暴露的视觉问题：

- 工坊套件规划环节选择明料时，预览必须显示真实明料，不得误显示为手镯或成品样式。
- 精加工镶嵌视觉必须回到游戏现有风格：翡翠裁片是主体，镶嵌配件是低对比工艺层，而不是突兀的首饰图标。

## Scope

包含：

- 修正工坊物料预览分流，让 `rough` 和 `opened/material` 都走 `openingStoneSvg()`。
- 保留套件规划时在明料上叠加已有套件位置。
- 保留组件化镶嵌数据、订单语义和材料差异。
- 调整组件化镶嵌 SVG 的比例、颜色、线宽和层次，让戒托、扣头、绳结、配石像工艺细节。
- 补充 smoke tests 覆盖明料预览分流和镶嵌视觉风格标记。
- 用浏览器截图验证工坊规划预览与精加工预览。

不包含：

- 重做镶嵌玩法经济。
- 增加位图首饰素材或 3D 模型。
- 改变材料消耗、订单匹配、员工/设备结算。
- 恢复旧数据兼容。

## Current Root Causes

### 明料预览错误

`public/workshop-module.js` 的 `workshopItemPreview()` 只检查 `item.type === "rough"`。开料后的明料来自 `materials` 桶，并在前端被标记为 `type: "material"`、`materialStage: "opened"`。它没有进入 `openingStoneSvg()` 分支，而是落入 `productCanvas()`，所以在套件规划选择明料时被画成成品/手镯缩略图。

### 镶嵌视觉不贴合游戏风格

`public/inlay-product-renderer.js` 当前组件首饰渲染更接近亮色 UI 图标：戒圈比例过大，金属渐变饱和，配石和爪位抢主体，真实裁片被绝对定位到另一个叠层中。游戏现有视觉强调真实料子轮廓、柔和翡翠纹理、低对比边线和克制工坊界面，因此新首饰层需要降噪并让玉件继续成为视觉中心。

## Design

### 工坊明料预览

新增一个小判断函数：

```js
function isRoughLikeWorkshopItem(item) {
  const stage = materialStageForClient(item);
  return item?.type === "rough" || item?.type === "material" || stage === "rough" || stage === "opened";
}
```

`workshopItemPreview(item, device)` 使用该函数：

- 暗料和明料统一返回 `rough-output-preview compact`。
- `revealed` 由 `materialStageForClient(item) !== "rough"` 决定。
- 仅当设备是 `carving` 时传入 `openingKitsForRender(item)`。
- carved/finished 成品继续走 `productCanvas()`。

### 镶嵌视觉

保留 `componentJewelrySvg(item, size, options)` 入口，但改为“工艺层”风格：

- 容器类名保持 `component-jewelry-product`，新增风格标记 `data-jewelry-style="craft-layer"`。
- 金属色降低饱和与对比：足金、18K、925银、铂金仍可区分，但不再使用强烈图标渐变。
- 戒指戒托缩小并置于主石背后，露出下半部分；吊坠扣头只在上方轻量露出；耳坠耳钩更细。
- 爪镶使用短线和小圆点；包镶使用细包边；微镶/槽镶使用细小点位和浅槽线。
- 编绳使用细暗绳与结点，不使用大面积图形。
- 配石数量仍可见，但点位小于主石，不抢主视觉。
- 有真实裁片时，裁片直接作为主体叠入首饰容器；无裁片时使用柔和翡翠占位主石。

## Tests

新增或更新：

- `scripts/finish-plan-controller-smoke.mjs`: 明料/打开料在工坊预览中调用 `openingStoneSvg()` 而不是 `productCanvas()`。
- `scripts/jade-renderer-smoke.mjs`: 组件镶嵌输出包含 `data-jewelry-style="craft-layer"`，金属/爪/绳/配石仍有语义标记，且不再出现图标式大戒圈标记。
- `scripts/workshop-planner-ui-smoke.mjs` 或现有工坊 smoke: 保证套件规划阶段仍能看到明料开料 SVG。

手动/浏览器验证：

- 开料完成后进入套件规划，选择明料时看到真实明料轮廓和颜色。
- 精加工蛋面戒指预览中，玉件是主体，戒托在背后克制露出。
- 编绳方案不显示金属件。
- 足金、18K、银、铂金有差异，但不会显得像独立 UI 图标。
