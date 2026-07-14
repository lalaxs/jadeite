# Workshop Equipment MVP Design

## Goal

把“我的工坊”从库存三栏改成设备驱动的加工流程：玩家先看到工坊设备卡片，进入某台设备后选择可加工物料，查看容量、员工、时间、费用和影响说明，再启动加工任务。第一期只跑通完整链路，不做复杂成长系统。

## Scope

第一期包含四台默认设备：

- 开料机：暗料/原石 -> 明料。
- 精雕台：明料 + 套件规划 -> 精雕毛坯。
- 抛光机：精雕毛坯 -> 抛光半成品。
- 精加工台：抛光半成品 -> 最终成品。

每个阶段产物都进入玩家库存，并可以作为可交易物品进入交易行。最终成品继续支持收藏、订单、直播和挂牌。

第一期不包含：

- 员工招聘、换岗、升级界面。
- 设备购买、升级、维护界面。
- 多设备容量扩容。
- 贵妃/正圆/底托等复杂工艺分支。
- 复杂随机加工参数。

但数据结构要预留 `deviceId`、`workerId`、`capacity`、`stage`、`materialStage`，方便后续接入成长、购买、换人。

## Current Context

现有工坊由 [public/main.js](/Users/jar/Documents/Codex/2026-07-01/new-chat/outputs/jade-market-prototype/public/main.js) 的 `renderWorkshop()` 直接渲染暗料、明料、成品三栏。服务端 [server.js](/Users/jar/Documents/Codex/2026-07-01/new-chat/outputs/jade-market-prototype/server.js) 只有通用 `jobs` 队列，任务以 `stage` 区分粗加工、精加工等，没有真实设备或员工模型。

现有能力需要保留：

- 开料 SVG 表现和明料揭露。
- 明料上的套件规划表现。
- 精雕后的成品必须从原料对应区域裁片。
- 交易行能处理阶段产物。

## Data Model

新增工坊配置以快照形式进入玩家状态：

```js
player.workshop = {
  devices: [
    {
      id: "saw",
      type: "opening",
      name: "开料机",
      stage: "opening",
      capacity: 1,
      workerId: "worker-opening",
      level: 1,
      condition: 100
    }
  ],
  workers: [
    {
      id: "worker-opening",
      name: "阿成",
      role: "开料师",
      level: 1,
      traits: ["稳手"],
      effects: {
        timeMultiplier: 0.98,
        costMultiplier: 1,
        qualityBonus: 0.02,
        lossReduction: 0.02
      }
    }
  ],
  selectedDeviceId: "saw"
};
```

任务继续使用 `player.jobs`，但增加设备字段：

```js
{
  id,
  type: "productionJob",
  stage: "opening" | "carving" | "polishing" | "finishing",
  deviceId,
  workerId,
  item,
  outputPreview,
  fee,
  startedAt,
  readyAt
}
```

阶段产物统一保存在库存中。第一期可以继续复用 `rough` 和 `bracelets`，同时新增轻量字段区分阶段：

- `materialStage: "rough"`：暗料/原石。
- `materialStage: "opened"`：开料后的明料。
- `materialStage: "carved"`：精雕毛坯。
- `materialStage: "polished"`：抛光半成品。
- `materialStage: "finished"`：最终成品。

## Workshop Home UI

工坊首页显示设备卡片，而不是先显示所有库存。

每张设备卡显示：

- 设备名和设备类型。
- 默认员工名、岗位、等级。
- 容量，例如 `0/1` 或 `1/1`。
- 当前加工中的物料名和剩余时间。
- 可加工物料数量。
- 进入按钮。

设备卡排序固定为：

1. 开料机
2. 精雕台
3. 抛光机
4. 精加工台

视觉风格保持当前工坊的实用工具感：紧凑、可扫描、少装饰，不做营销式大卡片。

## Device Detail UI

点击设备卡后进入设备详情台。

上方区域包含：

- 设备显示：名称、等级、状态。
- 容量显示：当前任务数/容量。
- 人员显示：员工姓名、岗位、等级、特性。

下方区域包含：

- 左侧：可加工物料列表。
- 右侧：设备信息、加工说明和选中物料预估。

选择物料后显示：

- 加工费用。
- 加工耗时。
- 预计产物阶段。
- 员工影响：时间、费用、质量、损耗的文字说明。
- 设备影响：容量、稳定性、工序适配的文字说明。

第一期影响说明只展示确定性文案，不需要复杂概率 UI。例如：

```text
阿成：开料耗时 -2%，损耗风险小幅降低。
开料机 Lv.1：容量 1，稳定完成基础开料。
预计：¥620，约 5 分钟，产出明料。
```

## Production Flow

### 开料机

输入：未揭露原石。

输出：明料，`materialStage: "opened"`。

第一期统一走设备任务流程：玩家在开料机详情台选择原石并开工，任务完成后产出明料。测试配置下该任务快速完成，正常配置下使用共享生产时长。

### 精雕台

输入：明料 + 套件规划。

输出：精雕毛坯，`materialStage: "carved"`。

精雕仍使用现有套件规划和原料区域裁片规则。产物不再直接进入最终成品状态，而是进入毛坯库存。

### 抛光机

输入：精雕毛坯。

输出：抛光半成品，`materialStage: "polished"`。

第一期只提升价值和更新阶段标记，不引入新的视觉复杂度。

### 精加工台

输入：抛光半成品。

输出：最终成品，`materialStage: "finished"`。

最终成品进入现有成品系统，可收藏、交订单、直播、挂牌。

## Trading

交易行需要能挂牌每个阶段：

- 原石/暗料。
- 明料。
- 精雕毛坯。
- 抛光半成品。
- 最终成品。

第一期可先复用现有 `rough` 和 `bracelet` 类型展示，但列表文案必须显示阶段，避免玩家误解。

## Error Handling

设备容量满时：

```text
这台设备正在加工，等空位出来再安排。
```

物料阶段不匹配时：

```text
这台设备不能处理当前阶段的物料。
```

费用不足时：

```text
现金不足，无法开工。
```

精雕台未摆套件时：

```text
请先在明料上摆放套件。
```

## Testing

需要覆盖：

- 新玩家拥有默认四台设备和四名默认员工。
- `snapshotFor()` 输出设备、员工、设备任务和容量。
- 每台设备只接受对应阶段物料。
- 容量为 1 时，同设备第二个任务被拒绝。
- 开料机产出明料。
- 精雕台产出毛坯，不再直接产出最终成品。
- 抛光机产出半成品。
- 精加工台产出最终成品。
- 工坊首页渲染设备卡。
- 设备详情台渲染设备、容量、人员、物料列表、费用/时间/影响说明。

## Implementation Preference

第一期优先少改结构、保持可运行：

- 服务端新增工坊设备/员工 helper，而不是立刻拆大模块。
- 前端在 `renderWorkshop()` 下增加设备首页和设备详情状态。
- 现有套件规划、开料 SVG、成品裁片逻辑保持不变。
- 待第一期跑通后，再拆出独立 `workshop-devices.js` 或完整成长系统。
