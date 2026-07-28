# Inlay Component Model Design

## Goal

把精加工镶嵌从“文字摘要 + 价值倍率”升级为真正的组件化成品系统。精加工完成后，成品应由翡翠本体、金属配件、配石、绳链等可渲染组件组成，并在玩法语义上成为最终首饰类型，例如戒指、吊坠、耳坠。

核心体验：

- 蛋面选择戒指成品和爪镶后，完成品就是一枚带戒托的蛋面戒指。
- 平安扣选择吊坠和编绳后，完成品就是带绳结/配链结构的平安扣挂件。
- 金属材料决定配件材质表现，足金、18K金、925银、铂金应有可辨识的颜色和高光差异。
- 配石材料决定点缀石的颜色和数量表现。

## Scope

第一版覆盖精加工最终成品，不做旧数据兼容。游戏尚未上线，现有调试数据不需要保留，后续由新精加工流程重新生成。

包含：

- 精加工完成时生成 `components` 数组。
- 最终成品以 `productType` 和 `kind` 表示首饰语义。
- 订单、交易行、收藏、库存等玩法读取最终首饰类型。
- 统一成品渲染入口支持组件叠层。
- 基础视觉覆盖戒指、吊坠、耳坠、编绳/配链。
- 金属材质覆盖足金、18K金、925银、铂金。
- 配石覆盖钻石、红宝石、蓝宝石。

不包含：

- 多主石、多蛋面复杂设计。
- 可拆卸配件、返工、回收金属。
- 真实 3D 模型或外部位图资产。
- 复杂首饰参数，如戒圈号、耳针类型、链长、工艺熟练度细分。
- 对旧存档和旧成品结构的兼容层。

## Current Context

当前镶嵌系统位于 [server/systems/inlay-system.js](/Users/jar/Documents/Codex/2026-07-01/new-chat/outputs/jade-market-prototype/jade-market-prototype/server/systems/inlay-system.js)。它已经提供：

- 镶嵌方式：爪镶、包镶、微镶、槽镶、无边镶、编绳/配链。
- 成品类型：戒指、吊坠、耳坠、手链、把件。
- 材料校验：不同工艺限制可用金属，编绳不使用金属。
- 报价：金属克重、配石数量、人工费、价值倍率。
- 扣料和退料：精加工开工扣 `externalMaterials`，失败退回。

当前缺口：

- `applyInlay()` 只写 `product.inlay` 摘要字段，没有写最终首饰结构。
- `product.kind` 仍多半代表玉件本体，例如 `cabochon`，而不是最终首饰类型。
- 订单匹配读取 `product.kind`，因此蛋面戒指不会真正作为戒指参与玩法。
- 视觉层只画翡翠裁片，不画戒托、扣头、耳钩、绳结、配石或金属材质。

## Data Model

精加工完成后的最终成品使用组件模型：

```js
{
  id: "product-1",
  type: "bracelet",
  materialStage: "finished",
  kind: "ring",
  productType: "ring",
  name: "冰种蛋面戒指",
  value: 13500,
  components: [
    {
      type: "jade",
      role: "mainStone",
      kind: "cabochon",
      sourceMaterial: { ... },
      templateSize: { w: 22, h: 28 }
    },
    {
      type: "mount",
      role: "setting",
      productType: "ring",
      settingId: "claw",
      metalId: "gold18k",
      backingId: "open"
    },
    {
      type: "accentStones",
      role: "halo",
      gemId: "diamond",
      count: 6
    }
  ],
  inlay: {
    productType: "ring",
    productTypeName: "戒指",
    settingId: "claw",
    settingName: "爪镶",
    metalId: "gold18k",
    metalName: "18K金",
    gemId: "diamond",
    gemName: "配石钻石",
    gemCount: 6,
    polishId: "bright",
    polishName: "亮光",
    backingId: "open",
    backingName: "透底",
    metalAmount: 1.95,
    laborFee: 1210,
    valueMultiplier: 1.55
  }
}
```

Notes:

- `kind` 和 `productType` 都表示最终首饰类型，便于现有玩法逐步收敛。
- 翡翠本体原型只存在于 `components[type="jade"].kind`。
- 金属、配石、底托、镶嵌方式都由组件和 `inlay` 同步表达；`components` 负责渲染，`inlay` 负责摘要和经济信息。
- `type: "bracelet"` 可以暂时保留为旧库存桶名，直到后续把成品桶重命名为 `products`。

## Product Semantics

精加工完成时，服务端根据 `finishPlan.productType` 设置：

- `finished.productType = finishPlan.productType`
- `finished.kind = finishPlan.productType`
- `finished.components = buildInlayComponents(inputItem, finishPlan, quote)`

玩法读取规则：

- 订单匹配优先读取 `product.productType || product.kind`。
- 类型标签优先显示最终首饰类型，例如“最终成品 · 戒指”。
- `inlaySummary()` 继续显示工艺摘要。
- 交易行筛选和搜索应能搜到“戒指”、“吊坠”、“耳坠”等最终类型。

第一版直接让订单、交易行和展示层识别新类型，不保留旧 `cabochon` 作为成品语义。

## Component Builder

新增纯函数负责把精加工方案转成组件：

```js
buildInlayComponents(item, plan, quote)
```

输入：

- `item`: 精加工前的抛光半成品或精雕毛坯。
- `plan`: 玩家选择的成品类型、镶嵌方式、金属、配石、底托和抛光。
- `quote`: 服务端权威报价。

输出规则：

- 永远生成一个 `jade` 主石组件。
- 非 `cord` 工艺生成一个 `mount` 组件。
- `gemCount > 0` 时生成一个 `accentStones` 组件。
- `settingId === "cord"` 时生成一个 `cord` 组件，不生成金属 `mount`。
- `backingId` 存在时写入 `mount.backingId`，影响戒指底托表现。

## Visual Rendering

成品视觉统一从 `productCanvas()` 进入。如果产品有 `components`，走组件渲染器；没有 `components` 的最终成品视为无效调试数据，不为其保留旧渲染路径。

渲染顺序：

1. 金属或绳链底层结构。
2. 翡翠主石本体。
3. 爪、包边、槽、封底等镶嵌结构。
4. 配石点缀。
5. 高光和阴影。

### Jade Component

`jade` 组件继续复用现有真实裁切能力：

- 如果有 `sourceMaterial.placement`，使用现有 `renderJadeOpeningProductSvg()` 画真实裁片。
- 如果缺少裁切信息，使用同形态占位路径，但第一版不为旧数据做兼容。

### Metal Materials

金属材质由 `metalId` 映射：

| metalId | 视觉 |
| --- | --- |
| `goldPure` | 暖黄、偏厚重、低白高光 |
| `gold18k` | 亮金、饱和度较高、清晰高光 |
| `silver925` | 冷白银、亮度高、轻微灰边 |
| `platinum` | 灰白铂金、低饱和、高级冷高光 |

实现可以使用 SVG 渐变、描边和半透明高光，不引入外部位图。

### Product Type Layouts

戒指：

- 底层画椭圆戒圈。
- 主石居中偏上。
- `claw` 画 4 或 6 个爪。
- `bezel` 画包边金属圈。
- `micro/channel/invisible` 在主石周围布置细小配石或槽线。
- `backingId === "closed"` 时主石后方加封底金属片。

吊坠：

- 主石为中心。
- 上方画扣头、吊环或链扣。
- `bezel` 包边，`claw` 爪托，`cord` 画绳结和挂绳。

耳坠：

- 主石居中或下垂。
- 上方画耳钩或耳钉结构。
- 配石可沿上方或两侧点缀。

编绳/配链：

- 不使用金属材质。
- 画绳结、绳线和简化链路。
- 颜色第一版固定为深褐/墨绿绳，可后续扩展材料。

手链/把件：

- 第一版保持基础配件结构，重点避免空白或错误。
- 后续可扩展为链节、手把绳、隔珠等组件。

## UI Flow

精加工方案弹窗保持现有字段：

- 成品类型
- 镶嵌方式
- 金属
- 抛光
- 配石
- 配石数量
- 底托

变化：

- 预览区应实时展示组件化结果，而不是只展示未镶嵌玉件。
- 切换成品类型或镶嵌方式时，预览立即显示戒圈、扣头、耳钩或绳结。
- 金属库存提示仍沿用现有逻辑。
- 摘要增加最终类型感知，例如“将产出：18K金爪镶蛋面戒指”。

## Server Flow

精加工开工：

- 继续校验 `finishPlan`。
- 继续报价、扣金属、扣配石和扣人工费。
- 任务保存 `finishPlan`、`inlayQuote` 和 `reservedMaterials`。

精加工完成：

- 先应用员工和设备工分。
- 调用 `applyInlay()`。
- `applyInlay()` 设置最终首饰类型和组件数组。
- 成品进入玩家成品库存。

失败：

- 继续退回翡翠和已扣镶嵌材料。
- 不生成组件成品。

## Testing

新增或更新 smoke tests：

- `inlay-system-smoke`: `applyInlay()` 生成 `productType`、最终 `kind` 和 `components`。
- `finish-plan-model-smoke`: 成品类型和镶嵌方式组合仍能正确报价和校验。
- `jade-renderer-smoke`: 组件模型进入成品渲染签名，金属材质字段会触发不同视觉签名。
- `finish-plan-controller-smoke`: 预览根据草稿变化刷新。
- `jade-rules` 或现有订单测试：蛋面戒指按 `ring` 匹配订单，而不是按 `cabochon`。
- `inventory-module-smoke`: 库存类型标签显示最终首饰类型。

必要的人工/浏览器验证：

- 蛋面戒指能看到戒圈和戒托。
- 足金、18K金、银、铂金外观有明显差别。
- 吊坠和耳坠不出现空白或错位。
- 编绳方案不显示金属件。
- 库存、交易行、订单和藏宝阁使用同一视觉。

## Out Of Scope

本次不处理旧存档兼容、不重命名库存桶、不增加新材料采购品类、不加入 3D 或位图资产、不做复杂多主石设计，也不重做订单系统。订单只需要能识别最终首饰类型。
