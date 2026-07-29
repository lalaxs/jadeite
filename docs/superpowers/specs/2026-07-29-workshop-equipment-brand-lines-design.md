# Workshop Equipment Brand Lines Design

## Goal

把工坊设备从“少量孤立型号”升级为可经营选择的设备市场：每个品牌都有自己的产品性格，每个品牌覆盖开料、规划、精加工三个阶段，每个阶段提供多个型号。玩家买设备时不是只买一个数值包，而是在品牌、阶段、型号偏重之间做取舍。

## Scope

第一版做 8 个品牌、3 个阶段、每阶段 3 个型号，共 72 个设备型号。

保持不变：

- 设备仍是玩家拥有的独立实例，实例用 `id` 区分。
- 设备固定 `tier: 1`、`capacity: 1`。
- 加工阶段仍是 `opening`、`carving`、`finishing`。
- 任务、维修、耐久、员工绑定继续按设备实例生效。
- 默认设备名继续使用 `品牌牌 + 型号 + 种类`，允许同型号多台同名。

不做：

- 设备升级树。
- 品牌声望/解锁。
- 二手市场。
- 真实品牌授权或现实品牌引用。

## Current Problem

当前 [server/systems/equipment-system.js](/Users/jar/Documents/Codex/2026-07-01/new-chat/outputs/jade-market-prototype/jade-market-prototype/server/systems/equipment-system.js) 只有 9 个型号，并且每个型号临时挂一个品牌。品牌没有产品线，型号也没有形成“同品牌不同阶段、同阶段不同偏重”的结构。

这导致商铺选择像是“买三个按钮中的一个”，不像真实设备市场。

## Brand Profiles

8 个品牌都覆盖三个阶段，但偏重点不同：

- `翠捷`：前期快周转。价格低、速度高、风险偏高、保底低。
- `稳玉`：稳定保守。风险低、保底高、速度慢、价格中高。
- `水衡`：冷却和水切。开料稳定，风险低，维护和价格偏高。
- `工造`：均衡主力。价格、速度、品质、风险都居中。
- `瑞控`：自动化数控。速度和一致性高，价格高，风险中低。
- `墨线`：扫描和规划。规划阶段强，品质和保底高，速度中等。
- `琢光`：出光和精修。精加工强，品质高，风险中等。
- `金工`：镶嵌和成品收口。精加工/镶嵌强，价格最高，速度中低。

## Data Model

设备目录改为品牌优先的源数据，再展开成旧接口兼容的平铺目录。

```js
const BRAND_LINES = [
  {
    brandKey: "cuijie",
    brand: "翠捷",
    code: "CJ",
    profile: "前期快周转",
    bias: { price: -0.16, speed: 0.18, quality: -0.02, risk: 0.12, perfectFloor: -1 },
    stages: {
      opening: [
        { modelKey: "cuijie-opening-1", modelName: "CJ-O1 快切型", category: "打磨机", focus: "speed" }
      ]
    }
  }
];
```

`equipmentCatalog()` 继续返回数组，每条包括：

- `modelKey`
- `brandKey`
- `brand`
- `modelName`
- `category`
- `stage`
- `name`：工位/用途名，例如 `开料基础线`，只用于目录说明。
- `displayName`：默认实例名，例如 `翠捷牌CJ-O1 快切型打磨机`。
- `price`
- `quality`
- `risk`
- `speed`
- `perfectFloor`
- `focus`
- `description`
- `tier: 1`

`createDeviceInstance()` 的实例字段保持：

- `id`
- `stage`
- `modelKey`
- `brandKey`
- `brand`
- `modelName`
- `category`
- `name`：默认等于 `displayName`
- `baseName`
- `basePrice`
- `attrs`
- `condition`
- `capacity`

## Model Matrix

每个品牌每阶段 3 个型号：

- `-1` 入门款：便宜，属性轻。
- `-2` 标准款：稳定主力。
- `-3` 专精款：明显偏科。

阶段与种类：

- `opening`：`打磨机`、`精磨机`、`水床切片机`
- `carving`：`套料机`、`取件机`、`扫描设计台`
- `finishing`：`玉雕机·抛光机`、`镶嵌机`、`高光精雕机`

品牌型号命名：

| 品牌 | opening | carving | finishing |
| --- | --- | --- | --- |
| 翠捷 CJ | CJ-O1 快切型 / CJ-O2 连磨型 / CJ-O3 高速型 | CJ-C1 轻套型 / CJ-C2 快取型 / CJ-C3 批量型 | CJ-F1 快抛型 / CJ-F2 连抛型 / CJ-F3 快收型 |
| 稳玉 WY | WY-O1 稳开型 / WY-O2 净磨型 / WY-O3 低裂型 | WY-C1 稳线型 / WY-C2 精取型 / WY-C3 保料型 | WY-F1 稳抛型 / WY-F2 净光型 / WY-F3 低损型 |
| 水衡 SH | SH-O1 水磨型 / SH-O2 冷切型 / SH-O3 水床型 | SH-C1 冷线型 / SH-C2 水冷取件 / SH-C3 稳温扫描 | SH-F1 冷抛型 / SH-F2 恒温精修 / SH-F3 水润高光 |
| 工造 GZ | GZ-O1 基础型 / GZ-O2 标准型 / GZ-O3 加强型 | GZ-C1 基础套料 / GZ-C2 标准取件 / GZ-C3 精准套取 | GZ-F1 基础抛光 / GZ-F2 标准精修 / GZ-F3 全能收口 |
| 瑞控 RK | RK-O1 自动打磨 / RK-O2 数控开料 / RK-O3 高速联控 | RK-C1 数控套料 / RK-C2 自动取件 / RK-C3 联控规划 | RK-F1 自动抛光 / RK-F2 数控精修 / RK-F3 联控高光 |
| 墨线 MX | MX-O1 标记开料 / MX-O2 影像精磨 / MX-O3 扫描开窗 | MX-C1 线稿套料 / MX-C2 影像取件 / MX-C3 三维扫描 | MX-F1 线控抛光 / MX-F2 影像精修 / MX-F3 曲面高光 |
| 琢光 ZG | ZG-O1 光面预磨 / ZG-O2 细磨开料 / ZG-O3 亮面水磨 | ZG-C1 光线套料 / ZG-C2 细雕取件 / ZG-C3 曲面雕刻 | ZG-F1 亮抛型 / ZG-F2 精光型 / ZG-F3 高光精雕 |
| 金工 JG | JG-O1 包边预磨 / JG-O2 托位开料 / JG-O3 镶前净料 | JG-C1 托位套料 / JG-C2 镶位取件 / JG-C3 微镶规划 | JG-F1 镶嵌基础 / JG-F2 镶嵌一体 / JG-F3 高级收口 |

## Attribute Rules

基础范围沿用当前四个属性：

- `quality`：2 到 10
- `risk`：0.78 到 1.25
- `speed`：2 到 18
- `perfectFloor`：0 到 5

品牌偏重先用手写表，不做动态公式，避免难以调平衡。

型号层偏重：

- 入门款：低价，属性低，部分风险高。
- 标准款：价格和属性居中。
- 专精款：至少一个强项明显高，同时有价格或风险代价。

示例：

```js
{ brand: "翠捷", modelName: "CJ-O3 高速型", category: "水床切片机", quality: 4, risk: 1.22, speed: 18, perfectFloor: 0 }
{ brand: "稳玉", modelName: "WY-O3 低裂型", category: "水床切片机", quality: 6, risk: 0.78, speed: 4, perfectFloor: 4 }
```

## UI

商铺设备页改为：

- 第一层：品牌分组。
- 第二层：阶段分组。
- 第三层：型号列表。

每个型号显示：

- `displayName`
- 价格
- 阶段
- 种类
- 偏重 `focus`
- 属性：品质、风险、速度、保底

工坊首页和设备详情页继续显示玩家拥有的设备实例，不需要显示全部品牌目录。

## Compatibility

旧 `modelKey` 必须保留映射：

- `rough` -> `cuijie-opening-1`
- `refine` -> `wenyu-opening-2`
- `waterbed` -> `shuiheng-opening-3`
- `carve` -> `gongzao-carving-1`
- `cnc` -> `ruikong-carving-2`
- `scan3d` -> `moxian-carving-3`
- `polish` -> `zhuoguang-finishing-1`
- `inlay` -> `jingong-finishing-2`
- `hiperf` -> `zhuoguang-finishing-3`

`normalizeDevice()` 遇到旧型号时自动迁移到新型号，保留设备 `id`、`condition`、`workerId`、`attrs` 中玩家已有覆盖值。

## Testing

新增或更新 smoke 覆盖：

- `equipmentCatalog()` 返回 72 个型号。
- 8 个品牌都存在。
- 每个品牌都有 `opening`、`carving`、`finishing` 三个阶段。
- 每个品牌每个阶段有 3 个型号。
- 默认实例名等于 `品牌牌 + 型号 + 种类`。
- 购买同型号多台允许同名，但 `id` 独立。
- 旧 `modelKey` 能归一化为新型号。
- 商铺源码按品牌和阶段分组展示设备。

## Open Questions

第一版先不引入品牌解锁和维护成本。后续如果设备市场太大，再增加筛选、排序、品牌偏好、价格档位和员工适配。
