# Inlay Preview Tester Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a workshop-accessible test panel that previews inlay combinations without running rough opening, material planning, kit cutting, workshop jobs, inventory consumption, or server writes.

**Architecture:** Extract the existing temporary finished-product preview construction into a shared front-end model module, then reuse it from both the formal finish-plan preview and the new tester. The tester is a client-only modal owned by `workshop-module.js`, opened through the existing global `data-action` dispatcher, and rendered through the existing `productCanvas()` and component jewelry renderer.

**Tech Stack:** Vanilla browser ES modules, existing Socket.IO app state, existing workshop modal CSS, Node smoke tests, existing `npm test` script chain.

## Global Constraints

- Provide an independent test entry that bypasses dark rough, opened material, kit planning, and workshop start.
- Support switching shape, product type, setting, metal, gem, gem count, and backing.
- Reuse the existing true finished-product render chain; do not create a second jewelry renderer.
- Do not add server gameplay endpoints.
- Do not consume external material inventory.
- Do not create workshop production jobs.
- Do not rework inlay economy or quote rules.
- Do not replace the formal workshop finish-plan modal.
- Keep the tester local to development and visual QA.

---

## File Structure

- Create `public/inlay-preview-tester.js`: shared test-preview state and product-building helpers. It owns preview-only shape fixtures, tester normalization, field updates, setting variants, metal variants, and `buildFinishPreviewProduct(item, draft)`.
- Modify `public/workshop-module.js`: import shared helpers, replace the current internal preview product builder, add tester modal state, modal rendering, event handlers, and the workshop-home entry button.
- Modify `public/main.js`: import `openInlayPreviewTester` and route `data-action="openInlayPreviewTester"` to it.
- Modify `public/styles.css`: add tester modal layout, control grid, main preview surface, preview-card grids, selected states, mobile layout, and night-theme rules.
- Create `scripts/inlay-preview-tester-smoke.mjs`: model and source-level smoke coverage for tester state, variants, preview-product components, entry wiring, and required CSS hooks.
- Modify `scripts/finish-plan-controller-smoke.mjs`: keep existing preview assertions passing after the preview-product builder moves into the shared module.
- Modify `package.json`: add `test:inlay-preview-tester` and include it in the main `test` chain.

---

### Task 1: Shared Preview Tester Model

**Files:**
- Create: `public/inlay-preview-tester.js`
- Create: `scripts/inlay-preview-tester-smoke.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `createFinishPlanDraft(shape, catalog)` and `normalizeFinishPlanDraft(shape, draft, catalog)` from `public/finish-plan-model.js`.
- Produces: `INLAY_PREVIEW_SHAPES: Array<{ id: string, label: string, item: object }>`
- Produces: `createInlayPreviewTesterState(catalog): { shape: string, draft: object }`
- Produces: `normalizeInlayPreviewTesterState(state, catalog): { shape: string, draft: object }`
- Produces: `applyInlayPreviewTesterField(state, field, value, catalog): { shape: string, draft: object }`
- Produces: `buildInlayPreviewBaseItem(shape): object`
- Produces: `buildFinishPreviewProduct(item, draft): object`
- Produces: `settingPreviewVariants(state, catalog): Array<{ id: string, label: string, draft: object, selected: boolean }>`
- Produces: `metalPreviewVariants(state, catalog): Array<{ id: string, label: string, draft: object, selected: boolean }>`

- [ ] **Step 1: Write the failing model smoke test**

Create `scripts/inlay-preview-tester-smoke.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyInlayPreviewTesterField,
  buildFinishPreviewProduct,
  buildInlayPreviewBaseItem,
  createInlayPreviewTesterState,
  metalPreviewVariants,
  settingPreviewVariants
} from "../public/inlay-preview-tester.js";

const catalog = {
  productTypes: {
    cabochon: ["ring", "pendant", "earring"],
    carving: ["pendant", "earring"],
    pierced: ["pendant"],
    whole: ["bracelet", "handpiece"]
  },
  shapeSettings: {
    cabochon: ["claw", "bezel", "cord"],
    carving: ["claw", "cord"],
    pierced: ["bezel", "cord"],
    whole: ["cord"]
  },
  productTypeNames: {
    ring: "戒指",
    pendant: "吊坠",
    earring: "耳坠",
    bracelet: "手链",
    handpiece: "把件"
  },
  settings: {
    claw: { name: "爪镶", metals: ["gold18k", "platinum"], grams: 1.5, labor: 200 },
    bezel: { name: "包镶", metals: ["goldPure", "silver925", "gold18k"], grams: 2.5, labor: 300 },
    cord: { name: "编绳/配链", metals: [], grams: 0, labor: 20 }
  },
  metals: {
    goldPure: "足金24K",
    silver925: "925银",
    gold18k: "18K金",
    platinum: "铂金PT950"
  },
  metalValues: { goldPure: 0.15, silver925: 0.03, gold18k: 0.2, platinum: 0.25 },
  gems: { diamond: "配石钻石", ruby: "红宝石", sapphire: "蓝宝石" },
  polishes: { bright: { labor: 50, value: 0.05 } },
  polishNames: { bright: "亮光" },
  backings: { open: { labor: 0, value: 0 }, closed: { labor: 100, value: 0.03 } },
  backingNames: { open: "透底", closed: "封底" }
};

let state = createInlayPreviewTesterState(catalog);
assert.equal(state.shape, "cabochon");
assert.equal(state.draft.productType, "ring");
assert.equal(state.draft.settingId, "claw");
assert.equal(state.draft.metalId, "gold18k", "tester should auto-pick a compatible visible metal");

const settingCards = settingPreviewVariants(state, catalog);
assert.deepEqual(settingCards.map((card) => card.id), ["claw", "bezel", "cord"]);
assert.equal(settingCards.find((card) => card.id === "cord").draft.metalId, null);

const metalCards = metalPreviewVariants(state, catalog);
assert.deepEqual(metalCards.map((card) => card.id), ["gold18k", "platinum"]);

state = applyInlayPreviewTesterField(state, "gemId", "ruby", catalog);
assert.equal(state.draft.gemId, "ruby");
assert.equal(state.draft.gemCount, 1);

const product = buildFinishPreviewProduct(buildInlayPreviewBaseItem(state.shape), state.draft);
assert.equal(product.preview, true);
assert.equal(product.productType, "ring");
assert.deepEqual(product.components.map((component) => component.type), ["jade", "mount", "accentStones"]);
assert.equal(product.components.find((component) => component.type === "mount").metalId, "gold18k");

state = applyInlayPreviewTesterField(state, "settingId", "cord", catalog);
assert.equal(state.draft.metalId, null);
const cordProduct = buildFinishPreviewProduct(buildInlayPreviewBaseItem(state.shape), state.draft);
assert.deepEqual(cordProduct.components.map((component) => component.type), ["jade", "cord", "accentStones"]);

state = applyInlayPreviewTesterField(state, "shape", "whole", catalog);
assert.equal(state.shape, "whole");
assert.equal(state.draft.productType, "bracelet");
assert.equal(state.draft.settingId, "cord");
assert.equal(state.draft.metalId, null);
assert.deepEqual(metalPreviewVariants(state, catalog).map((card) => card.id), [""]);

const packageSource = readFileSync("package.json", "utf8");
assert.match(packageSource, /"test:inlay-preview-tester":\s*"node scripts\/inlay-preview-tester-smoke\.mjs"/);

console.log("inlay-preview-tester-smoke: model ok");
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `node scripts/inlay-preview-tester-smoke.mjs`

Expected: FAIL with `Cannot find module '../public/inlay-preview-tester.js'`.

- [ ] **Step 3: Implement `public/inlay-preview-tester.js`**

Create `public/inlay-preview-tester.js` with these definitions:

```js
import {
  createFinishPlanDraft,
  normalizeFinishPlanDraft
} from "./finish-plan-model.js";

export const INLAY_PREVIEW_SHAPES = [
  {
    id: "cabochon",
    label: "蛋面",
    item: { id: "preview-cabochon", name: "测试蛋面", type: "product", materialStage: "carved", kind: "cabochon", design: "cabochon", value: 8800 }
  },
  {
    id: "carving",
    label: "雕件",
    item: { id: "preview-carving", name: "测试雕件", type: "product", materialStage: "carved", kind: "carving", design: "carving", value: 10800 }
  },
  {
    id: "pierced",
    label: "平安扣",
    item: { id: "preview-pierced", name: "测试平安扣", type: "product", materialStage: "carved", kind: "pierced", design: "pierced", value: 7600 }
  },
  {
    id: "whole",
    label: "整料类",
    item: { id: "preview-whole", name: "测试整料", type: "product", materialStage: "carved", kind: "whole", design: "whole", value: 6800 }
  }
];

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function previewShapeIds(catalog) {
  return INLAY_PREVIEW_SHAPES
    .map((shape) => shape.id)
    .filter((shape) => (catalog.productTypes?.[shape] || []).length && (catalog.shapeSettings?.[shape] || []).length);
}

function firstShape(catalog) {
  return previewShapeIds(catalog)[0] || INLAY_PREVIEW_SHAPES[0].id;
}

function normalizeTesterMetal(draft, catalog) {
  const metals = catalog.settings?.[draft.settingId]?.metals || [];
  if (!metals.length) {
    draft.metalId = null;
  } else if (!draft.metalId || !metals.includes(draft.metalId)) {
    draft.metalId = metals[0];
  }
}

export function buildInlayPreviewBaseItem(shape) {
  const found = INLAY_PREVIEW_SHAPES.find((entry) => entry.id === shape) || INLAY_PREVIEW_SHAPES[0];
  return clone(found.item);
}

export function normalizeInlayPreviewTesterState(state = {}, catalog = {}) {
  const allowedShapes = previewShapeIds(catalog);
  const shape = allowedShapes.includes(state.shape) ? state.shape : firstShape(catalog);
  const baseDraft = createFinishPlanDraft(shape, catalog);
  const draft = { ...baseDraft, ...(state.draft || {}) };
  normalizeFinishPlanDraft(shape, draft, catalog);
  normalizeTesterMetal(draft, catalog);
  return { shape, draft };
}

export function createInlayPreviewTesterState(catalog = {}) {
  return normalizeInlayPreviewTesterState({ shape: firstShape(catalog), draft: {} }, catalog);
}

export function applyInlayPreviewTesterField(state, field, value, catalog = {}) {
  const next = normalizeInlayPreviewTesterState(state, catalog);
  if (field === "shape") {
    next.shape = String(value || "");
    next.draft = {
      ...createFinishPlanDraft(next.shape, catalog),
      polishId: next.draft.polishId,
      gemId: next.draft.gemId,
      gemCount: next.draft.gemCount
    };
  } else if (field === "gemCount") {
    next.draft.gemCount = Number(value || 0);
  } else {
    next.draft[field] = value === "" ? null : value;
    if (field === "gemId" && next.draft.gemId && next.draft.gemCount < 1) next.draft.gemCount = 1;
    if (field === "gemId" && !next.draft.gemId) next.draft.gemCount = 0;
  }
  return normalizeInlayPreviewTesterState(next, catalog);
}

export function buildFinishPreviewProduct(item, draft = null) {
  if (!draft?.productType || !draft?.settingId) return item;
  const jadeKind = item?.kind || item?.design || "cabochon";
  const components = [{
    type: "jade",
    role: "mainStone",
    kind: jadeKind,
    sourceMaterial: item?.sourceMaterial ? clone(item.sourceMaterial) : null,
    templateSize: item?.templateSize || null
  }];

  if (draft.settingId === "cord") {
    components.push({
      type: "cord",
      role: "hanger",
      productType: draft.productType,
      settingId: draft.settingId,
      polishId: draft.polishId
    });
  } else {
    components.push({
      type: "mount",
      role: "setting",
      productType: draft.productType,
      settingId: draft.settingId,
      metalId: draft.metalId,
      backingId: draft.backingId || null
    });
  }

  if (Number(draft.gemCount || 0) > 0 && draft.gemId) {
    components.push({
      type: "accentStones",
      role: draft.settingId === "channel" ? "channel" : "halo",
      gemId: draft.gemId,
      count: Number(draft.gemCount || 0)
    });
  }

  return {
    ...item,
    id: item?.id || "finish-preview",
    productType: draft.productType,
    kind: draft.productType,
    components,
    preview: true
  };
}

function variantDraft(state, catalog, patch) {
  const next = normalizeInlayPreviewTesterState(state, catalog);
  next.draft = { ...next.draft, ...patch };
  normalizeFinishPlanDraft(next.shape, next.draft, catalog);
  normalizeTesterMetal(next.draft, catalog);
  return next.draft;
}

export function settingPreviewVariants(state, catalog = {}) {
  const normalized = normalizeInlayPreviewTesterState(state, catalog);
  return (catalog.shapeSettings?.[normalized.shape] || []).map((settingId) => {
    const draft = variantDraft(normalized, catalog, { settingId });
    return {
      id: settingId,
      label: catalog.settings?.[settingId]?.name || settingId,
      draft,
      selected: settingId === normalized.draft.settingId
    };
  });
}

export function metalPreviewVariants(state, catalog = {}) {
  const normalized = normalizeInlayPreviewTesterState(state, catalog);
  const metals = catalog.settings?.[normalized.draft.settingId]?.metals || [];
  if (!metals.length) {
    return [{
      id: "",
      label: "不使用金属",
      draft: variantDraft(normalized, catalog, { metalId: null }),
      selected: true
    }];
  }
  return metals.map((metalId) => ({
    id: metalId,
    label: catalog.metals?.[metalId] || metalId,
    draft: variantDraft(normalized, catalog, { metalId }),
    selected: metalId === normalized.draft.metalId
  }));
}
```

- [ ] **Step 4: Add the npm test script**

Modify `package.json`:

```json
"test:inlay-preview-tester": "node scripts/inlay-preview-tester-smoke.mjs"
```

Insert `npm run test:inlay-preview-tester` in the main `test` chain after `npm run test:finish-plan-controller`.

- [ ] **Step 5: Run the model test**

Run: `npm run test:inlay-preview-tester`

Expected: PASS and prints `inlay-preview-tester-smoke: model ok`.

---

### Task 2: Reuse the Shared Preview Product Builder

**Files:**
- Modify: `public/workshop-module.js`
- Modify: `scripts/finish-plan-controller-smoke.mjs`

**Interfaces:**
- Consumes: `buildFinishPreviewProduct(item, draft)` from `public/inlay-preview-tester.js`.
- Produces: `patchFinishPlanPreview(root, item, draft)` continues to render the same temporary product shape as before and preserves its markup cache behavior.

- [ ] **Step 1: Strengthen the existing finish preview test**

In `scripts/finish-plan-controller-smoke.mjs`, keep the existing `patchFinishPlanPreview` behavior assertions and add a source assertion near the bottom:

```js
assert.match(
  workshopSource,
  /buildFinishPreviewProduct\(item,\s*draft\)/,
  "formal finish preview should use the shared preview product builder"
);
```

- [ ] **Step 2: Run the controller test and verify it fails**

Run: `npm run test:finish-plan-controller`

Expected: FAIL because `workshop-module.js` still contains the old local `previewFinishProduct()` helper.

- [ ] **Step 3: Replace the local helper in `workshop-module.js`**

Modify the import block:

```js
import {
  buildFinishPreviewProduct
} from "./inlay-preview-tester.js";
```

Change `patchFinishPlanPreview()` from:

```js
preview.innerHTML = productCanvas(previewFinishProduct(item, draft), "compact");
```

to:

```js
preview.innerHTML = productCanvas(buildFinishPreviewProduct(item, draft), "compact");
```

Delete the local `function previewFinishProduct(item, draft = null) { ... }` block from `workshop-module.js`.

- [ ] **Step 4: Run the controller test**

Run: `npm run test:finish-plan-controller`

Expected: PASS and existing preview-call assertions remain unchanged.

---

### Task 3: Client-Only Tester Modal

**Files:**
- Modify: `public/workshop-module.js`
- Modify: `public/main.js`
- Modify: `scripts/inlay-preview-tester-smoke.mjs`

**Interfaces:**
- Consumes: `createInlayPreviewTesterState`, `normalizeInlayPreviewTesterState`, `applyInlayPreviewTesterField`, `buildInlayPreviewBaseItem`, `buildFinishPreviewProduct`, `settingPreviewVariants`, `metalPreviewVariants`, and `INLAY_PREVIEW_SHAPES`.
- Produces: `openInlayPreviewTester(): void`, exported from `workshop-module.js`.
- Produces: `closeInlayPreviewTester(): void`, exported from `workshop-module.js`.
- Produces: a workshop-home button with `data-action="openInlayPreviewTester"`.

- [ ] **Step 1: Add source-level tester UI assertions**

Extend `scripts/inlay-preview-tester-smoke.mjs` before the final log:

```js
const workshopSource = readFileSync("public/workshop-module.js", "utf8");
assert.match(workshopSource, /export function openInlayPreviewTester\(\)/);
assert.match(workshopSource, /data-action="openInlayPreviewTester"/);
assert.match(workshopSource, /data-inlay-preview-field="shape"/);
assert.match(workshopSource, /data-inlay-preview-action="select-setting"/);
assert.match(workshopSource, /data-inlay-preview-action="select-metal"/);
assert.match(workshopSource, /productCanvas\(buildFinishPreviewProduct\(/);

const mainSource = readFileSync("public/main.js", "utf8");
assert.match(mainSource, /openInlayPreviewTester/);
assert.match(mainSource, /if \(action === "openInlayPreviewTester"\)/);
```

- [ ] **Step 2: Run the tester smoke and verify it fails**

Run: `npm run test:inlay-preview-tester`

Expected: FAIL because the UI entry and exported modal functions do not exist yet.

- [ ] **Step 3: Add tester imports and state to `workshop-module.js`**

Import the full helper set:

```js
import {
  INLAY_PREVIEW_SHAPES,
  applyInlayPreviewTesterField,
  buildFinishPreviewProduct,
  buildInlayPreviewBaseItem,
  createInlayPreviewTesterState,
  metalPreviewVariants,
  normalizeInlayPreviewTesterState,
  settingPreviewVariants
} from "./inlay-preview-tester.js";
```

Add module state:

```js
let activeInlayPreviewTester = null;
let inlayPreviewTesterLifecycleCleanup = null;
```

- [ ] **Step 4: Add the workshop-home entry**

Modify `workshopRecipeHome(devices)` so the description area includes the test button:

```js
<div class="workshop-step-tools">
  <p class="workshop-step-desc">${escapeHtml(step.desc)}</p>
  <button class="secondary small" data-action="openInlayPreviewTester" type="button">镶嵌预览测试</button>
</div>
```

Keep the recipe grid unchanged.

- [ ] **Step 5: Add tester modal root and events**

Add these functions near the finish-plan modal helpers:

```js
function inlayPreviewTesterRootEl() {
  let root = document.getElementById("inlay-preview-tester-root");
  if (root) return root;
  root = document.createElement("div");
  root.id = "inlay-preview-tester-root";
  root.className = "modal-root";
  root.addEventListener("click", handleInlayPreviewTesterClick);
  root.addEventListener("change", updateInlayPreviewTesterFromControl);
  root.addEventListener("input", updateInlayPreviewTesterFromControl);
  document.body.appendChild(root);
  return root;
}

function handleInlayPreviewTesterClick(event) {
  const actionTarget = event.target.closest("[data-inlay-preview-action]");
  const action = actionTarget?.dataset.inlayPreviewAction;
  if (!action || !activeInlayPreviewTester) return;
  if (action === "close") {
    closeInlayPreviewTester();
    return;
  }
  if (action === "select-setting") {
    activeInlayPreviewTester = applyInlayPreviewTesterField(
      activeInlayPreviewTester,
      "settingId",
      actionTarget.dataset.settingId || "",
      finishCatalog()
    );
    patchInlayPreviewTester();
    return;
  }
  if (action === "select-metal") {
    activeInlayPreviewTester = applyInlayPreviewTesterField(
      activeInlayPreviewTester,
      "metalId",
      actionTarget.dataset.metalId || "",
      finishCatalog()
    );
    patchInlayPreviewTester();
  }
}

function updateInlayPreviewTesterFromControl(event) {
  const field = event.target?.dataset?.inlayPreviewField;
  if (!field || !activeInlayPreviewTester) return;
  activeInlayPreviewTester = applyInlayPreviewTesterField(
    activeInlayPreviewTester,
    field,
    event.target.value,
    finishCatalog()
  );
  patchInlayPreviewTester();
}
```

- [ ] **Step 6: Render and patch the tester modal**

Add:

```js
function inlayPreviewTesterShell() {
  return `
    <section class="game-modal inlay-preview-tester-modal" role="dialog" aria-modal="true" aria-label="镶嵌预览测试">
      <header class="game-modal-head">
        <div class="game-modal-title">
          <h3>镶嵌预览测试</h3>
          <p>跳过工坊流程，直接查看不同配饰和材质的效果。</p>
        </div>
        <button class="modal-close" data-inlay-preview-action="close" type="button" aria-label="关闭">×</button>
      </header>
      <div class="game-modal-body" data-inlay-preview-body></div>
      <footer class="game-modal-actions">
        <button class="secondary" data-inlay-preview-action="close" type="button">关闭</button>
      </footer>
    </section>
  `;
}
```

Add helper renderers:

```js
function inlayPreviewSelectOptions(keys, labels, selected, enabledKeys = keys) {
  return finishOptions(keys, labels, selected, { enabledKeys });
}

function renderInlayPreviewControls(state, catalog) {
  const shapeLabels = Object.fromEntries(INLAY_PREVIEW_SHAPES.map((shape) => [shape.id, shape.label]));
  const settings = catalog.shapeSettings?.[state.shape] || [];
  const metals = catalog.settings?.[state.draft.settingId]?.metals || [];
  const settingNames = Object.fromEntries(
    Object.entries(catalog.settings || {}).map(([key, value]) => [key, value.name])
  );
  const backingAllowed = state.shape === "cabochon" && state.draft.productType === "ring";
  return `
    <div class="inlay-preview-controls">
      <label class="finish-plan-field"><span>原料形态</span><select data-inlay-preview-field="shape">${inlayPreviewSelectOptions(INLAY_PREVIEW_SHAPES.map((shape) => shape.id), shapeLabels, state.shape)}</select></label>
      <label class="finish-plan-field"><span>成品类型</span><select data-inlay-preview-field="productType">${inlayPreviewSelectOptions(Object.keys(catalog.productTypeNames || {}), catalog.productTypeNames, state.draft.productType, catalog.productTypes?.[state.shape] || [])}</select></label>
      <label class="finish-plan-field"><span>镶嵌方式</span><select data-inlay-preview-field="settingId">${inlayPreviewSelectOptions(Object.keys(catalog.settings || {}), settingNames, state.draft.settingId, settings)}</select></label>
      <label class="finish-plan-field"><span>金属材质</span><select data-inlay-preview-field="metalId"><option value="">${metals.length ? "自动选择兼容金属" : "不使用金属"}</option>${inlayPreviewSelectOptions(Object.keys(catalog.metals || {}), catalog.metals, state.draft.metalId, metals)}</select></label>
      <label class="finish-plan-field"><span>配石</span><select data-inlay-preview-field="gemId"><option value="">不使用配石</option>${inlayPreviewSelectOptions(Object.keys(catalog.gems || {}), catalog.gems, state.draft.gemId)}</select></label>
      <label class="finish-plan-field" ${state.draft.gemId ? "" : "hidden"}><span>配石数量</span><input data-inlay-preview-field="gemCount" type="number" min="1" max="12" step="1" value="${Number(state.draft.gemCount || 1)}"></label>
      <label class="finish-plan-field" ${backingAllowed ? "" : "hidden"}><span>底托</span><select data-inlay-preview-field="backingId">${inlayPreviewSelectOptions(Object.keys(catalog.backings || {}), catalog.backingNames, state.draft.backingId)}</select></label>
    </div>
  `;
}
```

Add matrix helpers:

```js
function renderInlayPreviewCard(variant, action, datasetName, item, size = "compact") {
  return `
    <button class="inlay-preview-card ${variant.selected ? "is-active" : ""}" data-inlay-preview-action="${action}" data-${datasetName}="${escapeHtml(variant.id)}" type="button">
      <span class="inlay-preview-card-visual">${productCanvas(buildFinishPreviewProduct(item, variant.draft), size)}</span>
      <span class="inlay-preview-card-label">${escapeHtml(variant.label)}</span>
    </button>
  `;
}

function renderInlayPreviewMatrices(state, catalog, item) {
  const settingCards = settingPreviewVariants(state, catalog)
    .map((variant) => renderInlayPreviewCard(variant, "select-setting", "setting-id", item))
    .join("");
  const metalCards = metalPreviewVariants(state, catalog)
    .map((variant) => renderInlayPreviewCard(variant, "select-metal", "metal-id", item))
    .join("");
  return `
    <section class="inlay-preview-matrix">
      <h4>镶嵌方式</h4>
      <div class="inlay-preview-card-grid">${settingCards || empty("暂无可预览镶嵌方式。")}</div>
      <h4>金属材质</h4>
      <div class="inlay-preview-card-grid">${metalCards || empty("暂无可预览金属材质。")}</div>
    </section>
  `;
}
```

Add `patchInlayPreviewTester()`:

```js
function patchInlayPreviewTester() {
  const root = document.getElementById("inlay-preview-tester-root");
  const body = root?.querySelector("[data-inlay-preview-body]");
  if (!root || !body || !activeInlayPreviewTester) return;
  const catalog = finishCatalog();
  activeInlayPreviewTester = normalizeInlayPreviewTesterState(activeInlayPreviewTester, catalog);
  const item = buildInlayPreviewBaseItem(activeInlayPreviewTester.shape);
  const product = buildFinishPreviewProduct(item, activeInlayPreviewTester.draft);
  body.innerHTML = `
    <div class="inlay-preview-tester-layout">
      ${renderInlayPreviewControls(activeInlayPreviewTester, catalog)}
      <section class="inlay-preview-main">
        <div class="inlay-preview-main-visual">${productCanvas(product, "finished")}</div>
        <div class="inlay-preview-current">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(catalog.productTypeNames?.[activeInlayPreviewTester.draft.productType] || activeInlayPreviewTester.draft.productType)} · ${escapeHtml(catalog.settings?.[activeInlayPreviewTester.draft.settingId]?.name || activeInlayPreviewTester.draft.settingId)}</span>
        </div>
      </section>
    </div>
    ${renderInlayPreviewMatrices(activeInlayPreviewTester, catalog, item)}
  `;
}
```

Add exported open/close functions:

```js
export function openInlayPreviewTester() {
  activeInlayPreviewTester = createInlayPreviewTesterState(finishCatalog());
  const root = inlayPreviewTesterRootEl();
  root.innerHTML = inlayPreviewTesterShell();
  inlayPreviewTesterLifecycleCleanup?.();
  inlayPreviewTesterLifecycleCleanup = activateModalLifecycle({
    root,
    dialog: root.querySelector('[role="dialog"]'),
    shell: document.querySelector(".shell"),
    onClose: closeInlayPreviewTester
  });
  patchInlayPreviewTester();
}

export function closeInlayPreviewTester() {
  activeInlayPreviewTester = null;
  inlayPreviewTesterLifecycleCleanup?.();
  inlayPreviewTesterLifecycleCleanup = null;
  document.getElementById("inlay-preview-tester-root")?.remove();
}
```

- [ ] **Step 7: Wire `main.js`**

Add `openInlayPreviewTester` to the `workshop-module.js` import list.

Add this action branch near other workshop actions:

```js
if (action === "openInlayPreviewTester") { openInlayPreviewTester(); return; }
```

- [ ] **Step 8: Run the tester smoke**

Run: `npm run test:inlay-preview-tester`

Expected: PASS and prints `inlay-preview-tester-smoke: model ok`.

- [ ] **Step 9: Run the finish controller smoke**

Run: `npm run test:finish-plan-controller`

Expected: PASS.

---

### Task 4: Tester Styling and Responsive Guardrails

**Files:**
- Modify: `public/styles.css`
- Modify: `scripts/inlay-preview-tester-smoke.mjs`

**Interfaces:**
- Consumes: tester markup class names from Task 3.
- Produces: responsive desktop/mobile layout for `.inlay-preview-tester-modal`, `.inlay-preview-tester-layout`, `.inlay-preview-controls`, `.inlay-preview-main`, `.inlay-preview-card-grid`, and `.inlay-preview-card`.

- [ ] **Step 1: Add CSS source assertions**

Extend `scripts/inlay-preview-tester-smoke.mjs`:

```js
const stylesSource = readFileSync("public/styles.css", "utf8");
assert.match(stylesSource, /\.inlay-preview-tester-modal/);
assert.match(stylesSource, /\.inlay-preview-tester-layout/);
assert.match(stylesSource, /\.inlay-preview-card-grid/);
assert.match(stylesSource, /\[data-theme="night"\]\s+\.inlay-preview-card/);
assert.match(stylesSource, /@media\s+\(max-width:\s*760px\)[\s\S]*\.inlay-preview-tester-layout/);
```

- [ ] **Step 2: Run the tester smoke and verify it fails**

Run: `npm run test:inlay-preview-tester`

Expected: FAIL because tester CSS classes do not exist yet.

- [ ] **Step 3: Add desktop styles**

Add near the finish-plan modal CSS:

```css
.workshop-step-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.inlay-preview-tester-modal {
  width: min(980px, 100%);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.inlay-preview-tester-modal .game-modal-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  display: grid;
  gap: 16px;
}

.inlay-preview-tester-layout {
  display: grid;
  grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
  gap: 16px;
  align-items: stretch;
  min-width: 0;
}

.inlay-preview-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  gap: 10px;
  min-width: 0;
}

.inlay-preview-main {
  display: grid;
  grid-template-rows: minmax(220px, 1fr) auto;
  gap: 10px;
  min-width: 0;
}

.inlay-preview-main-visual {
  display: grid;
  place-items: center;
  min-height: 220px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface-2, var(--panel));
  overflow: hidden;
}

.inlay-preview-main-visual .component-jewelry-product,
.inlay-preview-main-visual .jade-opening-product {
  width: min(260px, 86%);
  height: min(260px, 86%);
  min-width: 0;
}

.inlay-preview-current {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--paper);
  color: var(--muted);
  font-size: 12px;
}

.inlay-preview-current strong {
  color: var(--ink);
}

.inlay-preview-matrix {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.inlay-preview-matrix h4 {
  margin: 4px 0 0;
  color: var(--ink);
  font-size: 13px;
}

.inlay-preview-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
  gap: 10px;
  min-width: 0;
}

.inlay-preview-card {
  display: grid;
  grid-template-rows: 88px auto;
  gap: 7px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
  text-align: center;
}

.inlay-preview-card.is-active {
  border-color: rgba(24, 113, 84, .58);
  box-shadow: inset 0 0 0 1px rgba(24, 113, 84, .22);
}

.inlay-preview-card-visual {
  display: grid;
  place-items: center;
  min-width: 0;
  overflow: hidden;
}

.inlay-preview-card-visual .component-jewelry-product,
.inlay-preview-card-visual .jade-opening-product {
  width: 82px;
  height: 82px;
  min-width: 0;
}

.inlay-preview-card-label {
  min-width: 0;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}
```

- [ ] **Step 4: Add night theme and mobile styles**

Add near existing night theme finish-plan rules:

```css
[data-theme="night"] .inlay-preview-main-visual,
[data-theme="night"] .inlay-preview-card {
  background: var(--night-surface-3);
  border-color: rgba(142, 178, 160, .24);
}

[data-theme="night"] .inlay-preview-current {
  background: var(--night-surface-2);
  border-color: rgba(142, 178, 160, .22);
}

[data-theme="night"] .inlay-preview-current strong,
[data-theme="night"] .inlay-preview-matrix h4 {
  color: var(--night-text);
}
```

Inside the existing mobile `@media (max-width: 760px)` block:

```css
.workshop-step-tools {
  align-items: stretch;
  flex-direction: column;
}

.inlay-preview-tester-layout {
  grid-template-columns: minmax(0, 1fr);
}

.inlay-preview-main {
  grid-template-rows: minmax(180px, auto) auto;
}

.inlay-preview-main-visual {
  min-height: 180px;
}

.inlay-preview-card-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
```

- [ ] **Step 5: Run the tester smoke**

Run: `npm run test:inlay-preview-tester`

Expected: PASS.

---

### Task 5: Verification and Browser QA

**Files:**
- No new source files beyond Tasks 1-4.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified local feature.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm run test:inlay-preview-tester
npm run test:finish-plan-controller
npm run test:renderer
npm run test:responsive
```

Expected: every command exits `0`.

- [ ] **Step 2: Run full smoke suite**

Run:

```bash
npm test
```

Expected: exits `0`.

- [ ] **Step 3: Restart the server**

If `localhost:3000` is already served by the project, stop the old `node server.js` process for this project and start:

```bash
npm start
```

Confirm:

```bash
curl -I http://localhost:3000
```

Expected: HTTP `200`.

- [ ] **Step 4: Browser visual check**

Use Playwright with system Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`:

```js
const { chromium } = await import("playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
});
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await page.click('[data-action="openLocation"][data-payload="workshop"]');
await page.click('[data-action="openInlayPreviewTester"]');
const desktop = await page.evaluate(() => ({
  modal: Boolean(document.querySelector(".inlay-preview-tester-modal")),
  cards: document.querySelectorAll(".inlay-preview-card").length,
  craftLayers: document.querySelectorAll('[data-jewelry-style="craft-layer"]').length,
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
}));
if (!desktop.modal || desktop.cards < 2 || desktop.craftLayers < 2 || desktop.overflow) {
  throw new Error(JSON.stringify(desktop));
}
await page.setViewportSize({ width: 390, height: 844 });
const mobile = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  modalWidth: Math.round(document.querySelector(".inlay-preview-tester-modal").getBoundingClientRect().width)
}));
if (mobile.overflow || mobile.modalWidth > 390) throw new Error(JSON.stringify(mobile));
await browser.close();
```

Expected: no error. If screenshots are captured for debugging, remove temporary files before final handoff unless the user asks to keep them.

- [ ] **Step 5: Final report**

Report:

- The tester entry location.
- The available controls.
- The focused and full test commands that passed.
- Whether the server was restarted and the URL to try.

---

## Self-Review

- Spec coverage: Task 1 handles preview-only data and compatible variants; Task 2 ensures formal and tester previews share the same product builder; Task 3 adds the independent test entry and client-only modal; Task 4 handles the requested tool-style UI and responsive behavior; Task 5 covers focused, full, and browser visual verification.
- Placeholder scan: no unresolved placeholders or unspecified validation steps remain.
- Type consistency: all generated interfaces use the names defined in Task 1; Task 2 and Task 3 consume the same `buildFinishPreviewProduct(item, draft)` signature; Task 3 exports `openInlayPreviewTester()` for `main.js`.
