# 独立库存页签 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除工坊机器详情的阶段库存抽屉，并新增支持背包格、筛选、排序及成品收藏操作的独立库存页签。

**Architecture:** 新建 `public/inventory-module.js`，先用纯函数把所有可用库存桶归一化为稳定背包条目，再在同一模块内保存本地筛选状态并渲染页面。`public/main.js` 只负责注册视图、传入现有预览与格式化帮助函数；收藏继续走现有全局 `collectBracelet` 动作，不修改服务端协议。

**Tech Stack:** 原生 ES Modules、原生 DOM、Socket.IO 现有状态推送、Node.js `assert` smoke tests、CSS Grid。

## Global Constraints

- 库存必须包含 `me.rough`、`me.materials`、`me.slices`、`me.bracelets` 与持有量大于 0 的 `me.externalMaterials`。
- 库存不得包含 `me.collection`、加工任务、直播任务或交易行挂单。
- 默认顺序必须是暗料原石、明料、片料、精雕毛坯、抛光半成品、最终成品、金属、宝石；同组保持源数组或目录顺序。
- 分类必须支持全部、原石、阶段产物、成品、镶嵌材料。
- 排序必须支持背包顺序、价值从高到低、价值从低到高、名称、稀有度。
- 镶嵌材料每种占一个格，只展示正持有量，并显示实际克数或颗数；总价值为单价乘持有量。
- 成品必须保留 `data-action="collectBracelet"` 的“收入藏宝阁”按钮。
- 工坊机器详情不得再渲染“阶段库存”或“阶段库存与成品”抽屉。
- 不修改服务端协议，不新增加工、挂牌、直播或订单快捷入口。
- 所有新 CSS 使用 `inventory-` 或 `inv-` 命名空间，并支持 767px 以下窄屏。
- 保留工作区中与本功能无关的未提交修改。

---

### Task 1: 库存归一化、筛选与排序模型

**Files:**
- Create: `public/inventory-module.js`
- Create: `scripts/inventory-module-smoke.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `state.me`、`state.materialCatalog`，以及 `{ materialStageForClient, materialStageLabel, typeName }` 帮助函数。
- Produces: `buildInventoryItems(state, helpers): InventoryEntry[]`、`filterAndSortInventory(items, filters): InventoryEntry[]`、`summarizeInventory(items): InventorySummary`。

- [ ] **Step 1: 写库存模型失败测试**

创建 `scripts/inventory-module-smoke.mjs`，使用以下固定状态验证归一化、零库存材料隐藏、顺序、分类、搜索及五种排序：

```js
import assert from "node:assert/strict";
import {
  buildInventoryItems,
  filterAndSortInventory,
  summarizeInventory
} from "../public/inventory-module.js";

const stageFor = (item = {}) => item.materialStage
  || (item.type === "rough" ? (item.revealed ? "opened" : "rough") : "unknown");
const stageLabel = (itemOrStage = {}) => ({
  rough: "暗料原石",
  opened: "明料",
  carved: "精雕毛坯",
  polished: "抛光半成品",
  finished: "最终成品"
}[typeof itemOrStage === "string" ? itemOrStage : stageFor(itemOrStage)] || "阶段产物");
const typeName = (type) => ({ rough: "原石", material: "明料", slice: "片料", bracelet: "成品" }[type] || type);

const state = {
  me: {
    rough: [{ id: "r1", name: "木那原石", type: "rough", materialStage: "rough", price: 100, quality: { score: 2 } }],
    materials: [{ id: "m1", name: "开窗明料", type: "material", materialStage: "opened", value: 300 }],
    slices: [{ id: "s1", name: "观音片料", type: "slice", materialStage: "opened", value: 200 }],
    bracelets: [
      { id: "c1", name: "佛公毛坯", type: "bracelet", materialStage: "carved", value: 500, craftGrade: "B" },
      { id: "p1", name: "平安扣半成品", type: "bracelet", materialStage: "polished", value: 600, craftGrade: "A" },
      { id: "f1", name: "福镯", type: "bracelet", materialStage: "finished", value: 1000, craftGrade: "S" }
    ],
    externalMaterials: { gold18k: 5, diamond: 0, ruby: 3 }
  },
  materialCatalog: [
    { id: "gold18k", key: "gold18k", group: "metal", name: "18K金", unitLabel: "克", price: 380, tint: "#e6c200" },
    { id: "diamond", key: "diamond", group: "gem", name: "配石钻石", unitLabel: "颗", price: 120, tint: "#bfe9ff" },
    { id: "ruby", key: "ruby", group: "gem", name: "红宝石", unitLabel: "颗", price: 40, tint: "#e0556b" }
  ]
};
const helpers = { materialStageForClient: stageFor, materialStageLabel: stageLabel, typeName };
const items = buildInventoryItems(state, helpers);

assert.deepEqual(items.map((item) => item.id), ["r1", "m1", "s1", "c1", "p1", "f1", "external:gold18k", "external:ruby"]);
assert.equal(items.find((item) => item.id === "external:gold18k").totalValue, 1900);
assert.equal(items.some((item) => item.id === "external:diamond"), false);
assert.deepEqual(summarizeInventory(items), { slots: 8, rough: 1, stage: 4, finished: 1, external: 2 });

assert.deepEqual(filterAndSortInventory(items, { category: "finished" }).map((item) => item.id), ["f1"]);
assert.deepEqual(filterAndSortInventory(items, { query: "片料" }).map((item) => item.id), ["s1"]);
assert.deepEqual(filterAndSortInventory(items, { sort: "backpack" }).map((item) => item.id), items.map((item) => item.id));
assert.equal(filterAndSortInventory(items, { sort: "valueDesc" })[0].id, "external:gold18k");
assert.equal(filterAndSortInventory(items, { sort: "valueAsc" })[0].id, "r1");
assert.equal(filterAndSortInventory(items, { sort: "name" })[0].name, "18K金");
assert.equal(filterAndSortInventory(items, { sort: "rarity" })[0].id, "f1");

console.log("inventory-module-smoke: normalization, filters and sorting ok");
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `node scripts/inventory-module-smoke.mjs`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`，指向 `public/inventory-module.js`。

- [ ] **Step 3: 实现最小库存模型**

在 `public/inventory-module.js` 实现：

```js
const STAGE_ORDER = { rough: 0, opened: 1, slice: 2, carved: 3, polished: 4, finished: 5 };
const GRADE_SCORE = { S: 500, A: 400, B: 300, C: 200, D: 100 };
const CATEGORY_LABELS = { rough: "原石", stage: "阶段产物", finished: "成品", external: "镶嵌材料" };

function numericValue(item = {}) {
  return Number(item.value ?? item.price ?? 0) || 0;
}

function rarityScore(item = {}) {
  if (GRADE_SCORE[item.craftGrade]) return GRADE_SCORE[item.craftGrade];
  if (Number.isFinite(Number(item.quality?.score))) return Number(item.quality.score) * 50;
  if (Number.isFinite(Number(item.qualityScore))) return Number(item.qualityScore);
  return 0;
}

export function buildInventoryItems(state = {}, helpers = {}) {
  const me = state.me || {};
  const stageFor = helpers.materialStageForClient || ((item) => item.materialStage || "unknown");
  const stageLabelFor = helpers.materialStageLabel || ((stage) => stage);
  const typeLabelFor = helpers.typeName || ((type) => type);
  let backpackIndex = 0;
  const entries = [];
  const pushItem = (item, source, type, forcedStage = null) => {
    const stage = forcedStage || stageFor(item);
    const normalizedStage = source === "slices" ? "slice" : stage;
    const category = stage === "rough" ? "rough" : stage === "finished" ? "finished" : "stage";
    entries.push({
      id: item.id,
      source,
      item,
      name: item.name || "未命名物品",
      category,
      categoryLabel: CATEGORY_LABELS[category],
      stage,
      stageLabel: source === "slices" ? "片料" : stageLabelFor(stage),
      typeLabel: typeLabelFor(type, item),
      quantity: 1,
      unitLabel: "件",
      unitPrice: numericValue(item),
      totalValue: numericValue(item),
      rarityScore: rarityScore(item),
      groupOrder: STAGE_ORDER[normalizedStage] ?? 99,
      backpackIndex: backpackIndex++,
      isFinished: stage === "finished"
    });
  };
  for (const item of me.rough || []) pushItem(item, "rough", "rough");
  for (const item of me.materials || []) pushItem(item, "materials", "material", item.materialStage || "opened");
  for (const item of me.slices || []) pushItem(item, "slices", "slice", item.materialStage || "opened");
  for (const item of me.bracelets || []) pushItem(item, "bracelets", "bracelet");

  const catalog = state.materialCatalog || [];
  for (const material of catalog) {
    const quantity = Number((me.externalMaterials || {})[material.key] || 0);
    if (quantity <= 0) continue;
    entries.push({
      id: `external:${material.key}`,
      source: "externalMaterials",
      item: material,
      name: material.name,
      category: "external",
      categoryLabel: CATEGORY_LABELS.external,
      stage: material.group === "metal" ? "metal" : "gem",
      stageLabel: material.group === "metal" ? "金属" : "宝石",
      typeLabel: "镶嵌材料",
      quantity,
      unitLabel: material.unitLabel,
      unitPrice: Number(material.price || 0),
      totalValue: Number(material.price || 0) * quantity,
      rarityScore: 0,
      groupOrder: material.group === "metal" ? 6 : 7,
      backpackIndex: backpackIndex++,
      isFinished: false
    });
  }
  return entries.sort((a, b) => a.groupOrder - b.groupOrder || a.backpackIndex - b.backpackIndex)
    .map((entry, index) => ({ ...entry, backpackIndex: index }));
}

export function filterAndSortInventory(items = [], filters = {}) {
  const query = String(filters.query || "").trim().toLocaleLowerCase("zh-CN");
  const category = filters.category || "all";
  const result = items.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (!query) return true;
    return [item.name, item.stageLabel, item.categoryLabel, item.typeLabel]
      .some((value) => String(value || "").toLocaleLowerCase("zh-CN").includes(query));
  });
  const byBackpack = (a, b) => a.backpackIndex - b.backpackIndex;
  const sorters = {
    backpack: byBackpack,
    valueDesc: (a, b) => b.totalValue - a.totalValue || byBackpack(a, b),
    valueAsc: (a, b) => a.totalValue - b.totalValue || byBackpack(a, b),
    name: (a, b) => a.name.localeCompare(b.name, "zh-CN") || byBackpack(a, b),
    rarity: (a, b) => b.rarityScore - a.rarityScore || byBackpack(a, b)
  };
  return result.sort(sorters[filters.sort] || sorters.backpack);
}

export function summarizeInventory(items = []) {
  return items.reduce((summary, item) => {
    summary.slots += 1;
    summary[item.category] += 1;
    return summary;
  }, { slots: 0, rough: 0, stage: 0, finished: 0, external: 0 });
}
```

- [ ] **Step 4: 运行库存模型测试并确认通过**

Run: `node scripts/inventory-module-smoke.mjs`

Expected: PASS，输出 `inventory-module-smoke: normalization, filters and sorting ok`。

- [ ] **Step 5: 接入项目测试链并运行**

在 `package.json` 增加：

```json
"test:inventory": "node scripts/inventory-module-smoke.mjs"
```

并在 `test` 链中加入 `npm run test:inventory`。

Run: `npm run test:inventory`

Expected: PASS，输出库存模型通过信息。

- [ ] **Step 6: 提交 Task 1**

```bash
git add public/inventory-module.js scripts/inventory-module-smoke.mjs package.json
git commit -m "feat: add inventory filtering model"
```

### Task 2: 独立库存视图、工坊删除项与响应式背包格

**Files:**
- Modify: `public/inventory-module.js`
- Modify: `public/main.js`
- Modify: `public/index.html`
- Modify: `public/workshop-module.js`
- Modify: `public/styles.css`
- Modify: `scripts/inventory-module-smoke.mjs`
- Modify: `scripts/simplified-flow-smoke.mjs`
- Modify: `scripts/responsive-layout-smoke.mjs`

**Interfaces:**
- Consumes: Task 1 的 `buildInventoryItems`、`filterAndSortInventory`、`summarizeInventory`。
- Produces: `initInventoryModule(options): void`、`renderInventory(): void`、`inventoryCardHtml(entry): string`；注册 `inventory` 主视图。

- [ ] **Step 1: 写页面契约失败测试**

扩展 `scripts/inventory-module-smoke.mjs`：初始化最小 DOM 引用，验证渲染结果包含搜索、分类、排序、材料数量、收藏动作和重置空状态；读取源码验证独立视图与旧抽屉移除：

```js
import { readFile } from "node:fs/promises";
import { initInventoryModule, renderInventory } from "../public/inventory-module.js";

const panel = {
  innerHTML: "",
  dataset: {},
  addEventListener() {}
};
initInventoryModule({
  getState: () => state,
  els: { inventoryPanel: panel },
  helpers: {
    ...helpers,
    formatMoney: (value) => `¥${value}`,
    formatNumber: (value) => String(value),
    escapeHtml: (value) => String(value),
    productCanvas: (item) => `<div class="product-preview">${item.name}</div>`,
    openingStoneSvg: (item) => `<svg aria-label="${item.name}"></svg>`
  }
});
renderInventory();
assert.match(panel.innerHTML, /id="inventorySearch"/);
assert.match(panel.innerHTML, /id="inventoryCategory"/);
assert.match(panel.innerHTML, /id="inventorySort"/);
assert.match(panel.innerHTML, /18K金/);
assert.match(panel.innerHTML, /5克/);
assert.match(panel.innerHTML, /data-action="collectBracelet"[^>]*data-payload="f1"/);

const [mainSource, htmlSource, workshopSource] = await Promise.all([
  readFile(new URL("../public/main.js", import.meta.url), "utf8"),
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/workshop-module.js", import.meta.url), "utf8")
]);
assert.match(mainSource, /label:\s*"库存"[\s\S]*view:\s*"inventory"/);
assert.match(htmlSource, /data-view="inventory"/);
assert.doesNotMatch(workshopSource, /workshopStageDrawer|阶段库存/);
```

修改 `scripts/simplified-flow-smoke.mjs`，将原本要求 `stageDrawerOpen` 与 `toggle` 监听的断言替换为：

```js
if (/workshopStageDrawer|stageDrawerOpen|阶段库存/.test(workshopModule)) {
  throw new Error("workshop device detail should not render the removed stage inventory drawer");
}
```

扩展 `scripts/responsive-layout-smoke.mjs`：

```js
assert.match(css, /\.inventory-grid\s*\{[^}]*display:\s*grid[^}]*minmax\(min\(100%,\s*180px\),\s*1fr\)/s);
assert.match(
  mobileShellCss,
  /\.inventory-toolbar\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s
);
assert.match(
  mobileShellCss,
  /\.inventory-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s
);
```

- [ ] **Step 2: 运行页面测试并确认按预期失败**

Run: `npm run test:inventory`

Expected: FAIL，首先指出 `initInventoryModule` 或 `renderInventory` 尚未导出。

Run: `npm run test:flow`

Expected: FAIL，指出旧阶段库存抽屉仍存在。

Run: `npm run test:responsive`

Expected: FAIL，指出库存响应式规则不存在。

- [ ] **Step 3: 为库存模块加入视图渲染与事件委托**

在 `public/inventory-module.js` 增加模块状态：

```js
let getState = () => null;
let elsRef = {};
let ui = { query: "", category: "all", sort: "backpack" };
let bound = false;
let helpersRef = {};

export function initInventoryModule(options = {}) {
  getState = options.getState || getState;
  elsRef = options.els || elsRef;
  helpersRef = options.helpers || helpersRef;
  bindInventoryOnce();
}
```

`bindInventoryOnce()` 在 `inventoryPanel` 根节点上委托 `input`、`change` 和重置按钮点击：搜索更新 `ui.query`，分类更新 `ui.category`，排序更新 `ui.sort`，重置恢复默认值；每次都调用 `renderInventory()`。根节点只绑定一次。

`renderInventory()` 必须：

- 调用 Task 1 三个纯函数。
- 渲染四个概览数字、搜索框、分类选择、排序选择和重置按钮。
- 外部材料使用 `--inventory-tint` 色块，普通库存复用 `openingStoneSvg` 或 `productCanvas`。
- 材料显示 `${quantity}${unitLabel}` 与总价值；普通物品显示阶段、类型与价值。
- 最终成品渲染：

```html
<button class="secondary small" data-action="collectBracelet" data-payload="成品ID" type="button">收入藏宝阁</button>
```

- 无任何库存时显示“背包还是空的”。
- 筛选无结果时显示“没有符合条件的库存物品”与 `data-inventory-reset` 按钮。
- `externalMaterials` 有正持有量但 `materialCatalog` 为空时显示“镶嵌材料目录尚未加载”。

- [ ] **Step 4: 注册库存主视图**

在 `public/index.html` 的工坊视图之后增加：

```html
<section class="view" data-view="inventory">
  <div class="section-head">
    <div>
      <p class="eyebrow">背包管理</p>
      <h3>库存</h3>
    </div>
    <span class="view-title-desc">查看所有可用物品</span>
  </div>
  <div id="inventoryPanel" class="inventory-panel"></div>
</section>
```

在 `public/main.js`：

- 导入并初始化 `initInventoryModule`、`renderInventory`。
- `viewLabels` 增加 `inventory: "库存"`。
- `els` 增加 `inventoryPanel: document.querySelector("#inventoryPanel")`。
- `NAV_ICONS` 增加背包图标 `inventory`。
- `renderMainNav()` 在全部地点之后、黑市之前加入 `{ label: "库存", view: "inventory", type: "inventory", icon: "inventory" }`。
- `openLocationByView()` 对 `inventory` 直接调用 `setView("inventory")`。
- `render()` 在 `renderWorkshop()` 后调用 `renderInventory()`。
- `initInventoryModule` 注入：

```js
initInventoryModule({
  getState: () => state,
  els,
  helpers: {
    formatMoney,
    formatNumber,
    escapeHtml,
    typeName,
    materialStageForClient,
    materialStageLabel,
    productCanvas,
    openingStoneSvg
  }
});
```

- [ ] **Step 5: 删除工坊旧抽屉**

在 `public/workshop-module.js`：

- 删除 `stageDrawerOpen`。
- 保留仍供规划器使用的 `workshopStageItems()`。
- 删除 `workshopStageInventory()` 与 `workshopStageDrawer()`。
- 从 `workshopRecipePage()` 删除 `${workshopStageDrawer()}`。
- 从 `renderWorkshop()` 删除 `.workshop-stage-drawer` 查询、`open` 恢复和 `toggle` 监听。

同步按 Step 1 修改 `scripts/simplified-flow-smoke.mjs`。

- [ ] **Step 6: 添加背包格与响应式样式**

在 `public/styles.css` 增加库存命名空间样式，至少包含：

```css
.inventory-panel { display: grid; gap: 16px; min-width: 0; }
.inventory-summary { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.inventory-toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) repeat(2, minmax(150px, 220px)) auto; gap: 10px; }
.inventory-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 180px), 1fr)); gap: 12px; min-width: 0; }
.inventory-slot { display: flex; min-width: 0; flex-direction: column; gap: 9px; border: 1px solid var(--line); border-radius: var(--r-md); padding: 10px; background: var(--panel); }
.inventory-slot-art { display: grid; place-items: center; min-height: 128px; overflow: hidden; border-radius: var(--r-sm); background: var(--surface-2, rgba(48, 166, 105, .08)); }
.inventory-material-art { width: 78px; height: 78px; border-radius: 22px; background: radial-gradient(circle at 35% 30%, #fff, var(--inventory-tint)); box-shadow: inset 0 0 0 1px rgba(255,255,255,.5), 0 10px 24px color-mix(in srgb, var(--inventory-tint), transparent 72%); }
.inventory-empty { grid-column: 1 / -1; display: grid; place-items: center; gap: 8px; min-height: 220px; text-align: center; color: var(--muted); }
```

在现有 `@media (max-width: 767px)` 内增加：

```css
.inventory-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.inventory-toolbar { grid-template-columns: minmax(0, 1fr); }
.inventory-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.inventory-slot { padding: 8px; }
.inventory-slot-art { min-height: 100px; }
```

补充夜间主题表面，使卡片、工具栏和空状态使用现有低亮度变量，不添加全局选择器。

- [ ] **Step 7: 运行三个定向测试并修正**

Run: `npm run test:inventory`

Expected: PASS，输出库存模型与页面契约通过信息。

Run: `npm run test:flow`

Expected: PASS，旧抽屉删除断言通过。

Run: `npm run test:responsive`

Expected: PASS，输出 `responsive-layout-smoke: desktop guards ok`。

- [ ] **Step 8: 运行完整测试**

Run: `npm test`

Expected: 所有脚本退出码为 0，无失败断言。

- [ ] **Step 9: 浏览器验证**

Run: `npm start`

在桌面与 767px 以下视口验证：

1. 左侧“库存”位于工坊之后并可进入。
2. 原石、阶段产物、成品和正持有量镶嵌材料均按格展示。
3. 搜索、五分类和五排序即时生效。
4. 筛选无结果可重置。
5. 成品“收入藏宝阁”触发已有收藏流程。
6. 工坊机器详情不再出现阶段库存抽屉。
7. 页面无横向溢出，昼夜主题可读。

- [ ] **Step 10: 提交 Task 2**

```bash
git add public/inventory-module.js public/main.js public/index.html public/workshop-module.js public/styles.css scripts/inventory-module-smoke.mjs scripts/simplified-flow-smoke.mjs scripts/responsive-layout-smoke.mjs
git commit -m "feat: add standalone inventory tab"
```
