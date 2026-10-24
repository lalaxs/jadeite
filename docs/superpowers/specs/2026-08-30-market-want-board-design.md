# 交易行求购板接入设计

**日期：** 2026-08-30  
**状态：** 已确认，Phase 1 已落地  
**范围：** 玩家发布求购、卖家应征报价、价低者得成交、与现有交易行/订单系统对齐

## 1. 目标

把交易行「求购」从前端示例（`MARKET_WANTS_SAMPLE` + toast）接入真实多人循环：

1. 买家发求购（全品类要求 + 预算上限 + 自选征集时长）。
2. 卖家用库存货品应征并报价（报价 ≤ 预算）。
3. 在达标应征中按**价低者得**成交；余额不足时**明确提示最低档所需金额（含税）**，手动结算保留应征，到期则关闭并退货。
4. 结算复用交易行税与卖家 `payouts`，库存/现金只在服务端变更。

不改变挂牌出售（`listings`）主路径；求购是并列的买方发起通道。  
**Phase 1 不**把求购摘要塞进聊天码头（`homeMessageRows`）。

## 2. 已确认语义（相对挂牌 / NPC 订单）

| 通道 | 谁发起 | 竞争方 | 成交规则 | 金钱模式 |
| --- | --- | --- | --- | --- |
| 挂牌出售 | 卖家 | 买家抢货 | 固定价，先到先得 | 买家付价+3%税；卖家进 `payouts` |
| NPC 订单 | 系统 | 玩家交货 | 达标即收，一口价 `pay` | 卖家即时 `earnCash` |
| **求购（本方案）** | 买家 | 卖家报价 | **价低者得**（达标前提下） | 同挂牌：税 + `payouts` |

「价高者得」只属于公盘/拍卖；求购文案与规则一律用价低者得。

## 3. 方案比较（结论）

采用 **应征窗口 + 自动取最低价**：买家发单后征集；卖家锁货报价；买家点「确认成交」或到期自动结算时，在达标应征中按价格升序尝试成交。

- 「手选任意应征」「一口价先到先得」不做进 MVP（后者不是价低者得；前者与文案冲突）。
- 「私聊议价 / 长期收 / 手选」留 Phase 2。

## 4. 玩法规则（Phase 1）

### 4.1 发布求购 · 全品类

玩家发求购时选择**一种主品类**（UI 单选；数据上 `itemTypes` 长度为 1，便于扩展）：

| `itemTypes[0]` | 硬匹配要点 | UI 额外字段 |
| --- | --- | --- |
| `rough` | `minScore`（可见种水/估价档，与挂牌公开信息对齐）；可选 `qualityKey` | 备注：赌石偏好等（仅展示） |
| `material` | `minScore` + 可选 `qualityKey` | 备注 |
| `slice` | 同 material | 备注 |
| `bracelet`（成品） | `minScore` + `acceptedKinds`（必填，至少一个题材） | 备注：圈口、无裂等（仅展示） |

公共字段：

- `title`：短标题（必填，有长度上限）
- `budget`：最高可接受成交价（整数 ≥ 100）
- `note`：可选备注，**仅展示，不参与硬匹配**
- `rule`：固定 `"lowest"` → UI「价低者得」
- `durationKey`：征集时长档（见 4.2）

上限：

- 每人同时进行中求购：**3**
- 全局进行中求购：**30**

- **MVP 不冻结**买家现金（成交时再扣）。Phase 2 可加 `holdDeposit(budget)`。

### 4.1b 预算冻结（已落地）

- 发单时冻结 `escrowAmount = budget + floor(budget * 3%)`。
- 成交时从冻结中划扣 `price + tax(price)`，结余 `releaseDeposit` 退回可用现金。
- 撤销 / 到期无应征：全额退还冻结。

### 4.2 征集时长 · 玩家自选

发单 UI 提供固定档位（服务端只接受白名单，防篡改）：

| `durationKey` | 时长 | 展示文案 |
| --- | --- | --- |
| `10m` | 10 分钟 | 10 分钟 |
| `30m` | 30 分钟 | 半小时 |
| `1h` | 1 小时 | 1 小时 |
| `6h` | 6 小时 | 6 小时 |
| `24h` | 24 小时 | 24 小时 |

- 默认选中：`10m`（可改，不强制）。
- `expiresAt = createdAt + DURATION_MS[durationKey]`。
- 发单后**不可改时长**；只能撤销重发。
- 卡片展示剩余时间；到期走与 `settleWant` 相同的结算管线。

### 4.3 应征

- 卖家不能应征自己的求购。
- 选择一件自有库存货品 + 报价 `price`（100 ≤ price ≤ want.budget）。
- 货品 `type` 必须落在 `want.itemTypes`；再跑 `wantMatchesItem`。
- 通过则 `takeItem` 锁入应征（自然离开挂牌/直播/交单候选池）。
- 同一求购同一卖家仅 **1** 条进行中应征；可撤应征（库存退回）。
- 每条求购最多 **8** 条进行中应征。

### 4.4 成交（价低者得 + 余额不足降档）

触发：买家手动「确认成交」，或 `expiresAt` 到点由 tick 触发。

**排序候选：**

1. 过滤：`wantMatchesItem` 且 `price ≤ budget`。
2. 排序：`price` 升序，同价 `createdAt` 升序 → `candidates[]`。

**尝试成交（取最低价）：**

```text
取 candidates[0]（最低价，同价取更早）
total = price + floor(price * MARKET_TAX)
if 买家现金 >= total:
  扣款 → addItem → payouts → 退其余应征 → 移除求购
  modal：「已按最低价成交」
else:
  手动 settle → 求购保持 open，应征保留
    modal：列明最低档价/税/总额，引导充值后再成交或撤销
  到期 settle → 关闭求购并退所有应征
    modal：说明所需金额与已关闭
```

说明：在「报价升序 + 比例税」下，付不起最低价时更高报价只会更贵，因此不降档试更高价；「试最低价 + 明显提示」即完整兑现。

### 4.5 明显提示（买家必达）

提示通道：服务端 `toast` + 必要时 `emitUiEvent({ type: "modal", … })`（金额与跳档信息较长时用 modal，短句用 toast）。

| 场景 | 对象 | 提示要点 |
| --- | --- | --- |
| 以最低价成交 | 买家 | modal：「已按最低价 ¥P 成交（含税 ¥T）」 |
| 付不起最低价（手动） | 买家 | **modal**：「当前最低应征需支付 ¥T（价+税），现金不足…」应征保留 |
| 付不起最低价（到期） | 买家 | **modal**：说明所需金额、求购已关闭、应征已退回 |
| 成交成功 | 成交卖家 | 「求购应征成交，货款 ¥P 已进入待领取」 |
| 未中选 / 被跳过（他人成交或关闭） | 其他应征卖家 | 「应征未成交，货品已退回库存」（被跳过且求购仍 open 时**不**退货、不打扰；仅最终离开板子时通知） |

原则：买家必须能看清「为什么不是表面上的最低价」或「为什么没成交」；卖家侧保持短 toast，避免泄露买家余额细节。

### 4.6 撤销

- 买家 `cancelWant`：退所有应征库存，移除求购。
- 卖家 `withdrawWantOffer`：仅退自己的应征。

### 4.7 硬匹配函数

`public/jade-rules.js`，客户端预览与服务端共用：

```js
wantMatchesItem(want, item) {
  // 1) item.type ∈ want.itemTypes
  // 2) bracelet：minScore + acceptedKinds（productMatchesOrder 语义）
  // 3) rough / material / slice：minScore；若 want.qualityKey 有值则与公开种水 key 一致
  // 4) note 永不参与
}
```

原石公开种水推断复用交易行已有 `marketQualityKey` / `publicStone` 逻辑，避免应征方用未公开信息「超配」。

## 5. 数据模型

### `state.wants`（与 `listings` 并列）

```text
Want {
  id, ownerId, ownerName,
  title, note,
  itemTypes,              // 长度 1：rough | material | slice | bracelet
  acceptedKinds,          // 成品必填；其他类型 [] 或省略
  qualityKey,             // 可选，非成品筛选
  minScore,
  budget,
  durationKey,            // 10m | 30m | 1h | 6h | 24h
  rule: "lowest",
  status: "open" | "settling",
  createdAt, expiresAt,
  offers: Offer[]
}

Offer {
  id, sellerId, sellerName,
  type, item, price, createdAt
}
```

快照：`snapshotFor` → `wants: state.wants.map(publicWant)`；货品用与挂牌一致的公开视图。

常量建议集中：

```js
const WANT_DURATIONS = {
  "10m": 10 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000
};
```

## 6. Socket API

| 事件 | 载荷 | 权限 / 校验 |
| --- | --- | --- |
| `postWant` | `{ title, itemTypes, acceptedKinds?, qualityKey?, minScore, budget, note?, durationKey }` | 上限、白名单时长、品类字段 |
| `cancelWant` | `wantId` | 仅发布者；退所有应征 |
| `applyWant` | `{ wantId, type, itemId, price }` | 非本人、锁库存、匹配、报价 ≤ 预算 |
| `withdrawWantOffer` | `{ wantId, offerId }` | 仅该应征卖家 |
| `settleWant` | `wantId` | 仅发布者；瀑布价低者得 + 提示 |

Tick：`expiresAt <= now` 且 `open` → 内部 `settleWantExpired(want)`（同上瀑布；失败则关闭退货并强提示买家）。

客户端：

- 移除 `MARKET_WANTS_SAMPLE` 与开发中提示条。
- `renderMarketWants` 读 `state.wants`。
- 求购区顶部「＋ 发求购」：品类 → 条件 → 预算 → **征集时长档** → 提交。
- 应征弹窗：按 `wantMatchesItem` 过滤库存 + 报价。
- 发布者：「按最低价成交」/「撤销」；应征列表升序，标出当前最低档与「若余额不足将尝试下一档」。

## 7. UI 改动要点

- 保留 `.jm-want` 骨架；标签固定「价低者得」。
- 卡片：标题、品类、要求摘要、预算、发布者、应征数、**剩余征集时间**、当前最低报价。
- 发单表单：时长用分段按钮 / select（五档），勿自由输入分钟数。
- 跳档成交后优先 modal，避免 toast 一闪而过看不清。
- **不**改聊天码头。

## 8. 与周边系统边界

- 不写入 `listings`；不走 `buyListing`。
- 不占用 `player.orders`。
- **不**接入 `homeMessageRows` / 聊天码头（已确认）。
- 任务：MVP 可先 `tradeCount` + `addNews`；可选 `market_want_post` / `market_want_fill`。

## 9. 分阶段落地

### Phase 1（本规格）

1. `jade-rules.js`：`wantMatchesItem`（四品类）+ smoke。
2. `server.js`：`state.wants`、时长白名单、五事件、tick 到期、瀑布结算与差异化提示。
3. `market-module.js` / `main.js`：发单（含时长）、列表、应征、成交、撤销；去掉 sample。
4. Smoke：时长白名单、四品类匹配、价低成交、跳档成交文案/字段、超预算拒绝、自己应征拒绝、到期关闭。

### Phase 2（可选）

- ~~发单 `holdDeposit(budget+税)`~~（已做）
- ~~`rule: "manual"` / 长期收~~（已做）
- `note` 结构化（圈口区间等）。
- 求购历史；聊天码头摘要（若以后要开）。

## 10. 测试要点

- 原石 / 明料 / 片料 / 成品均可发单与应征；错品类拒绝。
- `durationKey` 非法拒绝；五档 `expiresAt` 正确。
- 两卖家应征，最低价成交；更高价退库存。
- 买家付不起最低、付得起次低 → 次低成交 + 买家收到跳档说明。
- 全部付不起 + 手动 settle → 应征保留 + modal。
- 全部付不起 + 到期 → 关闭退货 + 买家总结提示。
- 撤销求购 / 撤应征库存归还。
- 回归：`listItem` / `buyListing` / `completeOrder`；聊天码头无求购条目。

## 11. 已确认决策

| # | 决策 |
| --- | --- |
| 1 | 原石 / 明料 / 片料 / 成品 **都做** |
| 2 | 征集时长由玩家在 **10m / 30m / 1h / 6h / 24h** 中选择 |
| 3 | 余额不足时 **只试最低价**；给买家 **明显提示**所需金额；手动保留应征，到期关闭退货 |
| 4 | Phase 1 **不**在聊天码头展示求购 |
