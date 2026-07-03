# Jade Expert Gameplay Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current prototype feel more like a jade expert management game by adding readable appraisal clues, positional windowing, extraction feedback, and customer fit logic.

**Architecture:** Keep the server authoritative for money, inventory, public windows, order completion, and product creation. Add a small browser-safe rules module for shared estimation and UI feedback; it reads only public material data, so it does not reveal hidden quality keys. Extend existing smoke tests instead of adding a new framework.

**Tech Stack:** Node.js, Express, Socket.IO, native browser JavaScript, existing smoke-test scripts.

---

### Task 1: Shared Expert Rules

**Files:**
- Create: `public/jade-rules.js`
- Create: `scripts/jade-rules-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `scripts/jade-rules-smoke.mjs` with assertions for placement analysis, product order matching, and live sale range:

```js
import assert from "node:assert/strict";
import {
  analyzeRoughPlacement,
  productMatchesOrder,
  productOrderFitReasons,
  liveSaleRange,
  routeRecommendation
} from "../public/jade-rules.js";

const rough = {
  visual: {
    belt: true,
    beltAngle: 18,
    crack: true,
    crackAngle: 96
  },
  windows: [{ x: 52, y: 24, r: 12 }],
  score: 4,
  rep: 55
};

const goodPlacement = analyzeRoughPlacement(rough, {
  layout: "bracelet",
  x: 54,
  y: 24,
  ringSize: 58
});
assert.equal(goodPlacement.tone, "profit");
assert.ok(goodPlacement.score >= 100);
assert.ok(goodPlacement.reasons.some((reason) => reason.includes("吃色")));
assert.ok(goodPlacement.reasons.some((reason) => reason.includes("开窗")));

const riskyPlacement = analyzeRoughPlacement(rough, {
  layout: "bracelet",
  x: 50,
  y: 50,
  ringSize: 56
});
assert.equal(riskyPlacement.tone, "danger");
assert.ok(riskyPlacement.reasons.some((reason) => reason.includes("压裂")));

const bangle = { kind: "bracelet", score: 4, value: 12000, rep: 32 };
const pendant = { kind: "leafPendant", score: 3, value: 4200, rep: 12 };
const collectorOrder = {
  minScore: 4,
  acceptedKinds: ["bracelet", "cabochon"],
  preferredKinds: ["bracelet"],
  tasteTags: ["highGrade"]
};
assert.equal(productMatchesOrder(bangle, collectorOrder), true);
assert.equal(productMatchesOrder(pendant, collectorOrder), false);
assert.ok(productOrderFitReasons(bangle, collectorOrder).some((reason) => reason.includes("题材匹配")));

const liveRange = liveSaleRange(bangle, 120);
assert.ok(liveRange.low < liveRange.high);
assert.ok(liveRange.low > bangle.value * 0.7);

assert.equal(routeRecommendation(bangle, [collectorOrder]).route, "order");
assert.equal(routeRecommendation(pendant, []).route, "livestream");

console.log("Jade expert rules checks passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/jade-rules-smoke.mjs`

Expected: FAIL with `Cannot find module` or missing export from `public/jade-rules.js`.

- [ ] **Step 3: Write minimal implementation**

Create `public/jade-rules.js` with these exported functions:

```js
export function analyzeRoughPlacement(rough, placement) { /* shared public placement scoring */ }
export function productMatchesOrder(product, order) { /* kind and score filter */ }
export function productOrderFitReasons(product, order) { /* short readable reasons */ }
export function liveSaleRange(product, rep) { /* expected livestream price range */ }
export function routeRecommendation(product, orders, rep = 0) { /* order, collection, or livestream */ }
```

- [ ] **Step 4: Add package script**

Add `"test:rules": "node scripts/jade-rules-smoke.mjs"` to `package.json`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:rules`

Expected: PASS with `Jade expert rules checks passed`.

### Task 2: Server Appraisal and Order Logic

**Files:**
- Modify: `server.js`
- Test: `scripts/jade-rules-smoke.mjs`
- Test: `scripts/simplified-flow-smoke.mjs`

- [ ] **Step 1: Add server expectations to smoke test**

Extend `scripts/simplified-flow-smoke.mjs` to assert that the server accepts positional window payloads, attaches expert clues to rough stones, and creates order kind preferences.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:flow`

Expected: FAIL because `expertClues`, positional `requestWindow`, or order preference fields are not present yet.

- [ ] **Step 3: Implement server behavior**

Modify `server.js`:

```js
import { productMatchesOrder } from "./public/jade-rules.js";
```

Add expert clues to generated rough stones, let `requestWindow` accept `{ roughId, x, y }`, make window reveal results depend on selected position, add `acceptedKinds`, `preferredKinds`, and `tasteTags` to NPC orders, and use `productMatchesOrder` when completing orders.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:flow`

Expected: PASS with `Simplified rough-to-bracelet flow checks passed`.

### Task 3: Frontend Expert Interaction

**Files:**
- Modify: `public/main.js`
- Modify: `public/styles.css`
- Test: `scripts/simplified-flow-smoke.mjs`

- [ ] **Step 1: Add frontend expectations to smoke test**

Extend `scripts/simplified-flow-smoke.mjs` to assert that `main.js` imports the shared rules, emits positional `requestWindow` payloads, renders expert clue UI, renders extraction analysis, and uses product matching for orders.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:flow`

Expected: FAIL because the frontend still uses button-only windowing and score-only order matching.

- [ ] **Step 3: Implement frontend interaction**

Modify `public/main.js`:

```js
import {
  analyzeRoughPlacement,
  productMatchesOrder,
  productOrderFitReasons,
  liveSaleRange,
  routeRecommendation
} from "./jade-rules.js";
```

Add click-to-select window locations on public rough boards, display expert clue chips, show extraction analysis under the planning board, use all finished products in orders when accepted, and show customer fit reasons before delivery.

- [ ] **Step 4: Add styling**

Modify `public/styles.css` for compact clue chips, window target markers, extraction feedback, and order fit lists.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:flow`

Expected: PASS with `Simplified rough-to-bracelet flow checks passed`.

### Task 4: Full Verification

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add aggregate test script**

Add:

```json
"test": "npm run test:rules && npm run test:renderer && npm run test:volume && npm run test:canvas && npm run test:flow"
```

- [ ] **Step 2: Run full verification**

Run: `npm test`

Expected: all five smoke checks pass.

- [ ] **Step 3: Review diff**

Run: `git diff -- public/jade-rules.js public/main.js public/styles.css server.js scripts/jade-rules-smoke.mjs scripts/simplified-flow-smoke.mjs package.json docs/superpowers/plans/2026-07-03-jade-expert-gameplay-optimization.md`

Expected: only planned files changed.

### Self-Review

Spec coverage: this plan covers appraisal clues, positional windows, extraction planning feedback, customer fit, and verification. It intentionally does not implement long-term accounts, persistent storage, real-time bidding, or a full cutting-chain revival in this batch.

Placeholder scan: no open placeholders are required for execution; implementation details are scoped to named files and functions.

Type consistency: product kind names use the current `bracelet`, `cabochon`, `peacePendant`, `ruyiPendant`, and `leafPendant` values used by client and server extraction kits.
