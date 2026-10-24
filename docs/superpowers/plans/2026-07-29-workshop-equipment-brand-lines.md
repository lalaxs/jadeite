# Workshop Equipment Brand Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand workshop equipment into 8 brand lines with 72 independently purchasable model instances.

**Architecture:** Keep `server/systems/equipment-system.js` as the single source of truth for equipment data and instance normalization, then expose the same flat `equipmentCatalog()` shape to the existing server snapshot. Update the shop UI to group that flat catalog by brand and stage without changing the existing buy action contract.

**Tech Stack:** Node.js ESM, Express state snapshot, browser vanilla JS modules, smoke tests with `node:assert/strict`.

## Global Constraints

- First version: 8 brands, 3 stages, 3 models per stage, 72 total equipment models.
- Equipment instances remain independent and are differentiated by `id`.
- Equipment stays fixed at `tier: 1` and `capacity: 1`.
- Stages remain `opening`, `carving`, and `finishing`.
- Default equipment instance name is `品牌牌 + 型号 + 种类`; duplicate names are allowed.
- Legacy model keys map to canonical new model keys: `rough`, `refine`, `waterbed`, `carve`, `cnc`, `scan3d`, `polish`, `inlay`, `hiperf`.
- Do not add upgrades, brand reputation unlocks, second-hand market behavior, or real-world brand references.

---

### Task 1: Catalog Regression Smoke

**Files:**
- Modify: `scripts/equipment-system-smoke.mjs`

**Interfaces:**
- Consumes: `equipmentCatalog()`, `createDeviceInstance(stage, modelKey, id, options)`, `normalizeDevice(device)`, `normalizeDevices(devices)`, `buyEquipment(player, modelKey, deps)`
- Produces: failing coverage for 72 model catalog, canonical names, duplicate instance names, and shop grouping source checks.

- [ ] **Step 1: Write the failing test**

```js
const catalog = equipmentCatalog();
assert.equal(catalog.length, 72);
assert.equal(new Set(catalog.map((entry) => entry.brand)).size, 8);
for (const brand of new Set(catalog.map((entry) => entry.brand))) {
  const rows = catalog.filter((entry) => entry.brand === brand);
  assert.deepEqual([...new Set(rows.map((entry) => entry.stage))].sort(), ["carving", "finishing", "opening"]);
  for (const stage of ["opening", "carving", "finishing"]) {
    assert.equal(rows.filter((entry) => entry.stage === stage).length, 3);
  }
}

const device = createDeviceInstance("opening", "cuijie-opening-1", "dev-test");
assert.equal(device.name, "翠捷牌CJ-O1 快切型打磨机");
assert.equal(device.modelKey, "cuijie-opening-1");

const legacy = normalizeDevice({ id: "legacy", stage: "opening", modelKey: "rough", name: "粗加工台" });
assert.equal(legacy.modelKey, "cuijie-opening-1");
assert.equal(legacy.name, "翠捷牌CJ-O1 快切型打磨机");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:equipment`

Expected: FAIL because the current catalog has 9 entries and does not contain `cuijie-opening-1`.

### Task 2: Brand Line Catalog

**Files:**
- Modify: `server/systems/equipment-system.js`

**Interfaces:**
- Consumes: existing route constants and public functions in `equipment-system.js`.
- Produces: `BRAND_LINES`, canonical `equipmentCatalog()`, canonical model-key resolution, and compatibility normalization.

- [ ] **Step 1: Replace the 9-row `MODELS` object with `BRAND_LINES`**

Create 8 brand objects: `cuijie`, `wenyu`, `shuiheng`, `gongzao`, `ruikong`, `moxian`, `zhuoguang`, and `jingong`.

- [ ] **Step 2: Add the 72 model rows**

Each brand has `opening`, `carving`, and `finishing`; each stage has 3 rows. Rows include `modelKey`, `name`, `modelName`, `category`, `price`, `quality`, `risk`, `speed`, `perfectFloor`, `focus`, and `description`.

- [ ] **Step 3: Add canonical model lookup**

Implement:

```js
const LEGACY_MODEL_KEYS = {
  rough: "cuijie-opening-1",
  refine: "wenyu-opening-2",
  waterbed: "shuiheng-opening-3",
  carve: "gongzao-carving-1",
  cnc: "ruikong-carving-2",
  scan3d: "moxian-carving-3",
  polish: "zhuoguang-finishing-1",
  inlay: "jingong-finishing-2",
  hiperf: "zhuoguang-finishing-3"
};
```

Use it in `createDeviceInstance()`, `normalizeDevice()`, `buyEquipment()`, and instance counting.

- [ ] **Step 4: Preserve instance independence**

`createDeviceInstance()` sets canonical `modelKey`, `brandKey`, `brand`, `modelName`, `category`, `displayName`, fixed `tier: 1`, fixed `capacity: 1`, and `name` defaulting to `displayName`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:equipment`

Expected: PASS.

### Task 3: Shop Grouping and Fallback Cards

**Files:**
- Modify: `public/extra-module.js`
- Modify: `public/workshop-module.js`

**Interfaces:**
- Consumes: flat `equipmentCatalog()` rows from the server snapshot.
- Produces: shop grouping by brand and stage, and fallback workshop devices using canonical new names.

- [ ] **Step 1: Update `WORKSHOP_DEVICE_FALLBACKS`**

Use canonical starter equipment names:

```js
name: "翠捷牌CJ-O1 快切型打磨机"
name: "工造牌GZ-C1 基础套料套料机"
name: "琢光牌ZG-F1 亮抛型玉雕机·抛光机"
```

- [ ] **Step 2: Group shop equipment by brand, then stage**

Build brand groups from `equipmentCatalog`, render brand heading with `brand` and `profile`, then render stage subsections for `opening`, `carving`, and `finishing`. Keep purchase buttons using `data-model-key="${item.modelKey}"`.

- [ ] **Step 3: Run test to verify it passes**

Run: `npm run test:equipment`

Expected: PASS with source checks for brand grouping and new fallback names.

### Task 4: Full Verification and Local Server

**Files:**
- Verify only.

**Interfaces:**
- Consumes: all changes from Tasks 1-3.
- Produces: current local browser-server state.

- [ ] **Step 1: Run focused and regression smoke tests**

Run:

```bash
npm run test:equipment
npm run test:server-idle
npm run test:ui-stability
npm run test:responsive
```

Expected: all commands exit 0.

- [ ] **Step 2: Restart localhost server**

Stop the existing `PORT=3001 npm start` session, start it again, then check:

```bash
curl -I http://localhost:3001/
```

Expected: `HTTP/1.1 200 OK`.
