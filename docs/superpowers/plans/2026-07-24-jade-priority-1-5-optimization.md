# Jade Priority 1–5 Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the jade business simulation, preserve its desktop layout, make the core flow usable on two target mobile sizes, and complete the minimum equipment, employee, and finishing-inlay loops.

**Architecture:** Keep the existing native HTML/CSS/JavaScript, Express, and Socket.IO stack. `server.js` remains the orchestration layer while three focused ES modules own equipment, employee, and inlay rules; the browser submits player intent and renders server snapshots. Work proceeds in strict priority order with a test and review gate after every independently useful change.

**Tech Stack:** Node.js ES modules, Express 5, Socket.IO 4, browser-native HTML/CSS/JavaScript, Node `assert`, existing smoke-test scripts.

## Global Constraints

- Desktop top HUD, left navigation, center content, right affairs panel, and bottom chat keep their existing order, location, visual style, colors, typography, and card language.
- Desktop layout never changes to a new navigation or new global region; only overflow, sizing, and scroll behavior may change.
- Mobile behavior applies only below `768px` and reuses the existing DOM.
- Every device has `capacity === 1` permanently; no model or tier can change it.
- Every device has at most one active job and no waiting queue.
- All cash, inventory, equipment, employee-busy, experience, durability, and completion decisions are server-authoritative.
- Keep the current in-memory state model; do not add accounts, databases, cloud saves, deployment, or new dependencies.
- Preserve unrelated user changes. Do not run broad reset, broad clean, or bulk deletion commands.
- Before Task 2 establishes the safe baseline, work in the current workspace because its dirty state is the object being audited; do not create an isolated worktree that omits those changes.
- Use `apply_patch` for source edits.
- Use TDD: observe or write a failing check, make the smallest implementation, rerun the focused check, then run the broader suite.
- Design reference: `docs/superpowers/specs/2026-07-24-jade-priority-1-5-optimization-design.md`.

---

## File Structure

### Existing files to modify

- `scripts/server-idle-smoke.mjs` — server flow assertions and three-stage workshop regression.
- `scripts/simplified-flow-smoke.mjs` — static page/module/default-view assertions.
- `scripts/ui-overlay-smoke.mjs` — global UI and overlay assertions.
- `package.json` — add focused test commands to the existing test chain.
- `.gitignore` — ignore local style backups, logs, and the exploratory E2E file.
- `README.md` — document the current three-stage flow and verification commands.
- `server.js` — Socket.IO orchestration, player normalization, snapshots, start/complete integration.
- `public/index.html` — existing shop/recruitment content and mobile-only toggles.
- `public/main.js` — view scroll reset, new element references, event routing, responsive panel state.
- `public/styles.css` — desktop overflow fixes and `<768px` responsive rules.
- `public/workshop-module.js` — multi-device selection, worker state, finish-plan modal, request payload.
- `public/extra-module.js` — equipment shop and recruitment rendering/actions.
- `public/market-module.js` — inlay summary on market cards.
- `public/orders-module.js` — inlay summary on order product choices.
- Existing collection renderer in `public/extra-module.js` — inlay summary on collection cards.

### New focused files

- `server/systems/equipment-system.js` — equipment catalog, capacity, durability, purchase, and repair rules.
- `server/systems/employee-system.js` — recruitment, worker normalization, busy checks, experience, and leveling.
- `server/systems/inlay-system.js` — finish-plan compatibility, quote, reserve/refund, and value rules.
- `public/product-meta.js` — shared finished-product metadata formatter for collection, orders, and market.
- `scripts/equipment-system-smoke.mjs` — equipment unit tests.
- `scripts/employee-system-smoke.mjs` — employee unit tests.
- `scripts/inlay-system-smoke.mjs` — inlay unit tests.
- `scripts/responsive-layout-smoke.mjs` — static desktop/mobile guard assertions.
- `scripts/task-smoke.mjs` — retained task-system assertions migrated from the root exploratory test.
- `docs/reports/2026-07-24-worktree-audit.md` — evidence and disposition for every dirty-path group.
- `docs/reports/2026-07-24-desktop-mobile-qa.md` — viewport matrix, screenshots, and final browser results.
- `docs/reports/screenshots/2026-07-24/*.png` — named desktop/mobile comparison captures.

---

### Task 1: Restore a Trustworthy Three-Stage Test Signal

**Files:**
- Modify: `scripts/server-idle-smoke.mjs`
- Modify: `scripts/simplified-flow-smoke.mjs`

**Interfaces:**
- Consumes: current `server.js` exports `workshopDevicesForPlayer`, `workshopProcessableItems`, `startWorkshopJobForPlayer`, `processProductionJobs`, and current `public/main.js` default `activeView = "overview"`.
- Produces: a passing test baseline that asserts exactly `opening → carving → finishing` and `capacity === 1`.

- [ ] **Step 1: Reproduce the two known stale assertions**

Run:

```powershell
npm run test:server-idle
npm run test:flow
```

Expected: the first command fails at the old four-device assertion; the second fails at the old default-workshop assertion.

- [ ] **Step 2: Replace four-device assertions with stage-based three-device assertions**

In `scripts/server-idle-smoke.mjs`, replace ID assumptions with:

```js
const starterDevices = starterSnapshot.me.workshop.devices;
assert.equal(starterDevices.length, 3);
assert.deepEqual(
  starterDevices.map((device) => device.stage),
  ["opening", "carving", "finishing"]
);
assert.equal(starterSnapshot.me.workshop.workers.length, 4);
assert.equal(starterDevices.every((device) => device.capacity === 1), true);
assert.equal(starterDevices.every((device) => device.workerId), true);

const openingDevice = starterDevices.find((device) => device.stage === "opening");
const carvingDevice = starterDevices.find((device) => device.stage === "carving");
const finishingDevice = starterDevices.find((device) => device.stage === "finishing");
assert.ok(openingDevice && carvingDevice && finishingDevice);
assert.equal(workshopProcessableItems(starterPlayer, openingDevice.id).length, 3);
assert.equal(workshopProcessableItems(starterPlayer, carvingDevice.id).length, 0);
```

Update the chain test so the carved product goes directly to the finishing device:

```js
const carvedProduct = chainPlayer.bracelets.find(
  (item) => item.materialStage === "carved"
);
assert.ok(carvedProduct);
const finishingDeviceForChain = workshopDevicesForPlayer(chainPlayer)
  .find((device) => device.stage === "finishing");
assert.ok(finishingDeviceForChain);
assert.equal(
  workshopProcessableItems(chainPlayer, finishingDeviceForChain.id)
    .some((item) => item.id === carvedProduct.id),
  true
);
const finishStart = startWorkshopJobForPlayer(
  chainPlayer,
  finishingDeviceForChain.id,
  { itemId: carvedProduct.id }
);
assert.equal(finishStart.ok, true);
assert.equal(finishStart.job.outputStage, "finished");
```

Remove the obsolete `polishing` device start and `polished` intermediate-stage assertions.

- [ ] **Step 3: Lock the one-job/no-queue rule in the existing server smoke**

Use the real opening device ID:

```js
const busyDevice = workshopDevicesForPlayer(instantOpeningPlayer)
  .find((device) => device.stage === "opening");
const blockedSecondOpening = startWorkshopJobForPlayer(
  instantOpeningPlayer,
  busyDevice.id,
  { itemId: instantOpeningPlayer.rough[0].id }
);
assert.equal(blockedSecondOpening.ok, false);
assert.match(blockedSecondOpening.message, /正在加工|容量|空位/);
assert.equal(
  instantOpeningPlayer.jobs.filter((job) => job.deviceId === busyDevice.id).length,
  1
);
assert.equal(Object.hasOwn(busyDevice, "queue"), false);
```

- [ ] **Step 4: Update the default-view flow assertion**

In `scripts/simplified-flow-smoke.mjs`, assert:

```js
if (!/let activeView = "overview"/.test(main)) {
  throw new Error("main.js should open on overview");
}
if (!/setView\("workshop"\)/.test(main) && !/openLocation/.test(main)) {
  throw new Error("the UI should expose navigation from overview to workshop");
}
```

Delete the assertion that requires `workshop` as the default view.

- [ ] **Step 5: Run the focused tests**

Run:

```powershell
npm run test:server-idle
npm run test:flow
```

Expected: both commands exit `0`.

- [ ] **Step 6: Run the full current suite**

Run:

```powershell
npm test
```

Expected: all ten current test commands exit `0`.

- [ ] **Step 7: Review and commit only the two test migrations**

Run:

```powershell
git diff -- scripts/server-idle-smoke.mjs scripts/simplified-flow-smoke.mjs
git add -- scripts/server-idle-smoke.mjs scripts/simplified-flow-smoke.mjs
git diff --cached --check
git commit -m "test: align smoke coverage with three-stage workshop"
```

Expected: the staged diff contains only current-flow test coverage; commit succeeds.

---

### Task 2: Establish the Evidence-Backed Workspace Baseline

**Files:**
- Create: `docs/reports/2026-07-24-worktree-audit.md`
- Create: `scripts/task-smoke.mjs`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `README.md`
- Restore: deleted historical documents and `.superpowers/sdd` reports
- Retain deletion: obsolete `public/assets/template-icons/*` and `public/assets/templates/*`
- Track: runtime modules and smoke scripts currently required by imports/package scripts

**Interfaces:**
- Consumes: passing Task 1 suite and current `git status --short`.
- Produces: a documented, tested baseline where every dirty path has a disposition and required runtime files are tracked.

- [ ] **Step 1: Record the dirty-path inventory**

Run:

```powershell
git status --short
git diff --name-status
git ls-files --others --exclude-standard
```

Create `docs/reports/2026-07-24-worktree-audit.md` with this exact decision table header:

```markdown
# 2026-07-24 Worktree Audit

| Path group | Evidence | Decision |
|---|---|---|
| Runtime modules imported by `public/main.js` | Direct ES-module imports | Track |
| Smoke scripts named by `package.json` | Required by `npm test` | Track |
| Deleted historical specs/plans/reports | No equivalent archive exists | Restore |
| Deleted template SVG/PNG assets | Current canvas-only test rejects icon assets; no runtime reference | Keep deletion |
| `public/styles.css*.bak` | Local style snapshots, not runtime inputs | Ignore |
| `server.log` | Runtime log | Ignore |
| `test-task.mjs` | Useful task-rule assertions | Migrate to `scripts/task-smoke.mjs` |
| `test-task-e2e.mjs` | Port-bound exploratory runner outside package scripts | Preserve locally and ignore |
```

- [ ] **Step 2: Verify the runtime-module and template evidence**

Run:

```powershell
rg -n 'from "\./.*-module\.js"|from "\./jade-categories\.js"|from "\./jade-opening-engine\.js"' public/main.js
rg -n 'jade-opening-engine-smoke|ui-overlay-smoke' package.json
rg -n 'template-icons|assets/templates' public scripts package.json
```

Expected:

- `public/main.js` imports the untracked runtime modules.
- `package.json` calls the two untracked smoke scripts.
- runtime source has no template asset dependency; only the generator and a negative smoke assertion mention template icons.

Append the command results in summarized form under the audit table.

- [ ] **Step 3: Restore ambiguous historical documents**

Run:

```powershell
git restore -- .superpowers/sdd docs/superpowers/plans docs/superpowers/specs/2026-07-02-jade-realistic-renderer-design.md docs/superpowers/specs/2026-07-02-source-material-product-cutouts-design.md docs/superpowers/specs/2026-07-03-jade-hardcore-idle-loop-design.md docs/superpowers/specs/2026-07-07-location-based-main-interface-design.md docs/superpowers/specs/2026-07-08-10-minute-sealed-auction-design.md docs/superpowers/specs/2026-07-15-workshop-equipment-mvp-design.md docs/翡翠风云_GDD_v2.1.md docs/翡翠风云_UI交互设计文档.md
```

Expected: those paths disappear from the deleted section of `git status`.

- [ ] **Step 4: Keep the obsolete template deletions only after the negative test passes**

Run:

```powershell
npm run test:canvas
npm run test:flow
```

Expected: both exit `0`, including the assertion that runtime rendering does not use `/assets/template-icons/`.

Record in the audit report that the template SVG/PNG deletions are intentional and reproducible through `scripts/generate-template-icons.mjs` if historical output is ever needed.

- [ ] **Step 5: Migrate the useful root task test**

Create `scripts/task-smoke.mjs` from the useful assertions in `test-task.mjs`, using:

```js
import assert from "node:assert/strict";
import { __testHooks as H } from "../server.js";

const player = H.makePlayer("task-smoke-player");
H.normalizePlayer(player);
assert.equal(player.tasks.length, H.TASK_COUNT);
assert.equal(new Set(player.tasks.map((task) => task.uid)).size, H.TASK_COUNT);

const active = player.tasks[0];
H.advanceTask(player, active.type, active.target);
assert.equal(player.tasks.find((task) => task.uid === active.uid).status, "complete");

const cashBeforeClaim = player.cash;
const claim = H.claimTask(player, active.uid);
assert.equal(claim.ok, true);
assert.equal(player.cash, cashBeforeClaim + claim.reward);
assert.equal(H.claimTask(player, active.uid).ok, false);

const resettable = player.tasks.find((task) => task.status === "active");
const cashBeforeReset = player.cash;
const reset = H.resetTask(player, resettable.uid);
assert.equal(reset.ok, true);
assert.equal(player.cash, cashBeforeReset - H.TASK_RESET_COST);

console.log("task-smoke: ok");
```

Add to `package.json`:

```json
"test:tasks": "node scripts/task-smoke.mjs"
```

Insert `npm run test:tasks` into the main `test` chain after `test:server-idle`.

- [ ] **Step 6: Add narrow ignore rules**

Append to `.gitignore`:

```gitignore
server.log
public/*.bak
test-task-e2e.mjs
```

Do not ignore `scripts/*.mjs`, `public/*-module.js`, design documents, or reports.

- [ ] **Step 7: Update README to the verified current flow**

Replace any four-stage description with:

````markdown
## 当前核心流程

公盘竞拍 → 开料（opening）→ 规划取件（carving）→ 精加工（finishing）→ 藏品 / 订单 / 市场 / 直播

每台加工设备容量固定为 1；同一设备没有等待队列。

## 验证

```powershell
npm test
npm start
```
````

Document that state remains in memory and the current project is a prototype.

- [ ] **Step 8: Run baseline verification**

Run:

```powershell
npm test
git status --short
git diff --check
```

Expected:

- all tests pass;
- backup/log/exploratory files no longer appear as untracked;
- all remaining changes match an audit-table decision;
- no whitespace errors.

- [ ] **Step 9: Commit the verified baseline**

Stage only the paths named in the audit report, including required runtime modules, tests, restored documents, intentional asset deletions, README, package metadata, ignore rules, and the audit report:

```powershell
git add -- .gitignore README.md package.json package-lock.json public server.js scripts docs .superpowers
git diff --cached --check
git diff --cached --name-status
git commit -m "chore: establish verified prototype baseline"
```

Expected: commit succeeds and every staged path has a recorded disposition.

---

### Task 3: Fix Desktop Overflow Without Changing Desktop Composition

**Files:**
- Create: `scripts/responsive-layout-smoke.mjs`
- Modify: `package.json`
- Modify: `public/styles.css`
- Modify: `public/main.js`
- Create: `docs/reports/2026-07-24-desktop-mobile-qa.md`

**Interfaces:**
- Consumes: existing `.shell`, `.main-stage`, `.sidepanel`, `.chatdock`, `.workshop-recipe-main`, and `setView(view)` behavior.
- Produces: stable desktop outer regions, internal scrolling, visible workshop columns, and center-scroll reset.

- [ ] **Step 1: Add a failing desktop-layout static guard**

Create `scripts/responsive-layout-smoke.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const main = await readFile(new URL("../public/main.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

assert.match(css, /@media \(min-width: 768px\)/);
assert.match(css, /--desktop-chat-height:\s*270px/);
assert.match(css, /\.main-stage[\s\S]*min-width:\s*0/);
assert.match(css, /\.main-stage[\s\S]*min-height:\s*0/);
assert.match(css, /\.workshop-recipe-main[\s\S]*minmax\(0,\s*1fr\)/);
assert.match(main, /els\.mainStage\.scrollTop\s*=\s*0/);
assert.match(html, /id="mainStage"/);

console.log("responsive-layout-smoke: desktop guards ok");
```

Add `"test:responsive": "node scripts/responsive-layout-smoke.mjs"` to `package.json` and append it to the main test chain.

- [ ] **Step 2: Run the new check and confirm it fails**

Run:

```powershell
npm run test:responsive
```

Expected: failure because the desktop guard block and `#mainStage` reference do not exist.

- [ ] **Step 3: Give the center region a stable DOM reference and reset only its scroll**

In `public/index.html`:

```html
<section class="main-stage" id="mainStage">
```

In the `els` object in `public/main.js`:

```js
mainStage: document.querySelector("#mainStage"),
```

At the end of a successful `setView(view)` transition:

```js
if (els.mainStage) els.mainStage.scrollTop = 0;
```

Do not call `window.scrollTo` and do not reset chat or sidepanel scrolling.

- [ ] **Step 4: Add a desktop-only correction layer at the end of CSS**

Append to `public/styles.css`:

```css
@media (min-width: 768px) {
  :root {
    --desktop-chat-height: 270px;
  }

  .shell {
    height: 100dvh;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr) var(--desktop-chat-height);
    overflow: hidden;
  }

  .sidebar,
  .main-stage,
  .sidepanel,
  .chatdock {
    min-width: 0;
    min-height: 0;
  }

  .main-stage {
    overflow: auto;
    overscroll-behavior: contain;
  }

  .sidepanel {
    align-self: stretch;
    max-height: none;
    overflow: auto;
  }

  .chatdock {
    height: var(--desktop-chat-height);
    max-height: var(--desktop-chat-height);
  }

  .workshop-recipe-main {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
    min-width: 0;
  }

  .workshop-material-column,
  .workshop-recipe-summary,
  .workshop-stage-drawer {
    min-width: 0;
    overflow-wrap: anywhere;
  }
}
```

If the existing desktop grid uses non-equal functional widths, preserve those ratios with `minmax(0, <existing fr value>)`; do not move or reorder columns.

- [ ] **Step 5: Run static and full tests**

Run:

```powershell
npm run test:responsive
npm test
```

Expected: both exit `0`.

- [ ] **Step 6: Capture the desktop comparison**

Use the browser playtest workflow at 1280×720 and 1440×900. Capture:

- overview;
- workshop device list;
- workshop detail showing all three columns;
- a long-scrolled view before and after switching away and back.

Create `docs/reports/2026-07-24-desktop-mobile-qa.md`:

```markdown
# Desktop and Mobile QA

## Desktop

| Viewport | Overview regions unchanged | Chat clear | Workshop third column visible | Center scroll resets | Console |
|---|---|---|---|---|---|
| 1280×720 | Pass | Pass | Pass | Pass | Clean |
| 1440×900 | Pass | Pass | Pass | Pass | Clean |
```

Save and link these captures:

- `docs/reports/screenshots/2026-07-24/desktop-1280-overview.png`
- `docs/reports/screenshots/2026-07-24/desktop-1280-workshop.png`
- `docs/reports/screenshots/2026-07-24/desktop-1440-overview.png`
- `docs/reports/screenshots/2026-07-24/desktop-1440-workshop.png`

- [ ] **Step 7: Commit the desktop fix**

```powershell
git add -- public/index.html public/main.js public/styles.css scripts/responsive-layout-smoke.mjs package.json package-lock.json docs/reports/2026-07-24-desktop-mobile-qa.md docs/reports/screenshots/2026-07-24
git diff --cached --check
git commit -m "fix: preserve desktop layout while resolving overflow"
```

---

### Task 4: Add the Mobile Core Layout on the Same DOM

**Files:**
- Modify: `public/index.html`
- Modify: `public/main.js`
- Modify: `public/styles.css`
- Modify: `scripts/responsive-layout-smoke.mjs`
- Modify: `docs/reports/2026-07-24-desktop-mobile-qa.md`

**Interfaces:**
- Consumes: existing `#sidePanel`, `#chatDock`, `#mainNav`, `#topHud`, modal roots, and Task 3 desktop guard.
- Produces: `#sidePanelToggle`, `#chatDockToggle`, `.is-mobile-open`, accessible collapsed panels below 768px.

- [ ] **Step 1: Extend the static test with failing mobile guards**

Add:

```js
assert.match(css, /@media \(max-width: 767px\)/);
assert.match(css, /min-height:\s*44px/);
assert.match(css, /env\(safe-area-inset-bottom\)/);
assert.match(main, /function toggleMobilePanel/);
assert.match(html, /id="sidePanelToggle"/);
assert.match(html, /id="chatDockToggle"/);
```

Run `npm run test:responsive`.

Expected: failure on the missing mobile rules and toggles.

- [ ] **Step 2: Add one mobile-only dock after the existing chat footer**

Immediately after `</footer>` for `#chatDock`, add:

```html
<nav class="mobile-dock-controls" aria-label="移动端快捷面板">
  <button
    id="sidePanelToggle"
    class="mobile-panel-toggle"
    type="button"
    aria-controls="sidePanel"
    aria-expanded="false"
  >进行事项</button>
  <button
    id="chatDockToggle"
    class="mobile-panel-toggle"
    type="button"
    aria-controls="chatDock"
    aria-expanded="false"
  >消息</button>
</nav>
```

The dock is hidden at desktop widths and does not create a second mobile page or a second content tree.

- [ ] **Step 3: Add responsive state handling**

Add element references:

```js
sidePanel: document.querySelector("#sidePanel"),
sidePanelToggle: document.querySelector("#sidePanelToggle"),
chatDock: document.querySelector("#chatDock"),
chatDockToggle: document.querySelector("#chatDockToggle"),
```

Add:

```js
function toggleMobilePanel(targetName) {
  const target = targetName === "side" ? els.sidePanel : els.chatDock;
  const targetButton = targetName === "side"
    ? els.sidePanelToggle
    : els.chatDockToggle;
  const shouldOpen = !target?.classList.contains("is-mobile-open");

  for (const [panel, button] of [
    [els.sidePanel, els.sidePanelToggle],
    [els.chatDock, els.chatDockToggle]
  ]) {
    panel?.classList.remove("is-mobile-open");
    button?.setAttribute("aria-expanded", "false");
  }

  if (shouldOpen) {
    target?.classList.add("is-mobile-open");
    targetButton?.setAttribute("aria-expanded", "true");
  }
}

els.sidePanelToggle?.addEventListener("click", () => {
  toggleMobilePanel("side");
});

els.chatDockToggle?.addEventListener("click", () => {
  toggleMobilePanel("chat");
});

window.matchMedia("(min-width: 768px)").addEventListener("change", (event) => {
  if (!event.matches) return;
  for (const [panel, button] of [
    [els.sidePanel, els.sidePanelToggle],
    [els.chatDock, els.chatDockToggle]
  ]) {
    panel?.classList.remove("is-mobile-open");
    button?.setAttribute("aria-expanded", "false");
  }
});
```

- [ ] **Step 4: Add the mobile cascade**

Append:

```css
.mobile-dock-controls {
  display: none;
}

@media (max-width: 767px) {
  html,
  body {
    width: 100%;
    min-width: 0;
    overflow-x: hidden;
  }

  .shell {
    width: 100%;
    min-height: 100dvh;
    height: auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr);
    padding-bottom: calc(52px + env(safe-area-inset-bottom));
  }

  .topbar,
  .sidebar,
  .main-stage {
    grid-column: 1;
    width: 100%;
    min-width: 0;
  }

  .topbar {
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }

  .top-hud,
  .main-nav {
    width: max-content;
    min-width: 100%;
    flex-wrap: nowrap;
  }

  .sidebar {
    overflow-x: auto;
  }

  .main-stage {
    padding: 12px;
    overflow: visible;
  }

  .sidepanel,
  .chatdock {
    position: fixed;
    z-index: 80;
    right: 0;
    bottom: calc(52px + env(safe-area-inset-bottom));
    left: 0;
    width: 100%;
    max-height: min(70dvh, 620px);
    transform: translateY(110%);
    transition: transform 160ms ease;
  }

  .sidepanel.is-mobile-open,
  .chatdock.is-mobile-open {
    transform: translateY(0);
  }

  .mobile-dock-controls {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    position: fixed;
    right: 0;
    bottom: env(safe-area-inset-bottom);
    left: 0;
    height: 52px;
    z-index: 81;
    background: var(--panel);
    border-top: 1px solid var(--line);
  }

  .mobile-panel-toggle {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    justify-content: center;
  }

  .workshop-recipe-main,
  .card-grid,
  .report-grid,
  .treasure-grid,
  .jm-shop,
  .jm-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .modal-root > *,
  .jm-modal,
  #shopModal > * {
    width: calc(100vw - 24px);
    max-width: calc(100vw - 24px);
    max-height: calc(100dvh - 24px);
    overflow: auto;
  }

  button,
  input,
  select,
  [role="button"] {
    min-height: 44px;
  }
}
```

Use exactly the selectors above; do not reuse the older `@media (max-width: 980px)` block for the new mobile behavior.

- [ ] **Step 5: Run static and full tests**

```powershell
npm run test:responsive
npm test
```

Expected: all pass.

- [ ] **Step 6: Browser-test both target sizes**

At 390×844 and 430×932 verify:

1. overview and navigation;
2. auction entry and bidding controls;
3. workshop open/plan/finish screens;
4. shop and material modal;
5. collection, order, and market screens;
6. affairs and chat open/close;
7. every modal close and primary action;
8. no inaccessible horizontal content;
9. no console errors.

Update the QA report with one row per viewport and screenshot links.

- [ ] **Step 7: Re-run the desktop comparison**

Repeat 1280×720 overview and workshop screenshots. Expected: desktop region order and visual style match Task 3.

- [ ] **Step 8: Commit mobile behavior**

```powershell
git add -- public/index.html public/main.js public/styles.css scripts/responsive-layout-smoke.mjs docs/reports/2026-07-24-desktop-mobile-qa.md docs/reports/screenshots/2026-07-24
git diff --cached --check
git commit -m "feat: add mobile responsive core layout"
```

---

### Task 5: Build and Integrate the Equipment Loop

**Files:**
- Create: `server/systems/equipment-system.js`
- Create: `scripts/equipment-system-smoke.mjs`
- Modify: `package.json`
- Modify: `server.js`
- Modify: `public/index.html`
- Modify: `public/extra-module.js`
- Modify: `public/workshop-module.js`
- Modify: `public/styles.css`

**Interfaces:**
- Consumes: `player.workshop.devices`, `player.jobs`, `spendCash`, `randomUUID`, current nine device models and base prices.
- Produces:
  - `equipmentCatalog()`
  - `createDeviceInstance(stage, modelKey, id)`
  - `normalizeDevice(device)`
  - `buyEquipment(player, modelKey, deps)`
  - `durabilityLoss(device)`
  - `repairQuote(device)`
  - `repairEquipment(player, deviceId, deps)`
  - snapshot field `equipmentCatalog`
  - Socket events `buyWorkshopDevice` and `repairWorkshopDevice`

- [ ] **Step 1: Write focused failing equipment tests**

Create `scripts/equipment-system-smoke.mjs`:

```js
import assert from "node:assert/strict";
import {
  equipmentCatalog,
  createDeviceInstance,
  normalizeDevice,
  buyEquipment,
  durabilityLoss,
  repairQuote,
  repairEquipment
} from "../server/systems/equipment-system.js";

assert.equal(equipmentCatalog().length, 9);
assert.equal(equipmentCatalog().every((entry) => entry.tier === 1), true);

const device = createDeviceInstance("opening", "rough", "dev-test");
assert.equal(device.capacity, 1);
assert.equal(normalizeDevice({ ...device, capacity: 9 }).capacity, 1);
assert.equal(durabilityLoss({ attrs: { risk: 1.2 } }), 2);
assert.equal(durabilityLoss({ attrs: { risk: 0.85 } }), 1);

const player = { cash: 50000, workshop: { devices: [] } };
const spend = (target, amount) => {
  if (target.cash < amount) return false;
  target.cash -= amount;
  return true;
};
assert.equal(
  buyEquipment(player, "rough", { spendCash: spend, makeId: () => "bought-1" }).ok,
  true
);
assert.equal(player.workshop.devices.length, 1);
assert.equal(player.workshop.devices[0].capacity, 1);

player.workshop.devices[0].condition = 0;
assert.equal(repairQuote(player.workshop.devices[0]), 3150);
assert.equal(
  repairEquipment(player, "bought-1", { spendCash: spend }).ok,
  true
);
assert.equal(player.workshop.devices[0].condition, 100);

console.log("equipment-system-smoke: ok");
```

Add `test:equipment` to `package.json` and the main test chain.

- [ ] **Step 2: Run the equipment test and confirm module-not-found failure**

```powershell
npm run test:equipment
```

Expected: failure because `server/systems/equipment-system.js` does not exist.

- [ ] **Step 3: Create the equipment rule module**

Implement these constants and functions:

```js
const MODELS = {
  opening: [
    { modelKey: "rough", name: "粗加工台", category: "打磨机", model: "角磨机 CJ-1 基础型", price: 9000, quality: 3, risk: 1.20, speed: 12, perfectFloor: 0 },
    { modelKey: "refine", name: "精磨台", category: "精磨机", model: "精磨机 JM-2 稳型", price: 12000, quality: 5, risk: 0.85, speed: 4, perfectFloor: 2 },
    { modelKey: "waterbed", name: "水床切片机", category: "水床机", model: "水床切片 WB-3", price: 11000, quality: 4, risk: 1.00, speed: 8, perfectFloor: 1 }
  ],
  carving: [
    { modelKey: "carve", name: "套件雕刻台", category: "套料机", model: "数控套料机 SK-2", price: 13000, quality: 3, risk: 1.10, speed: 10, perfectFloor: 0 },
    { modelKey: "cnc", name: "数控取件台", category: "取件机", model: "数控取件 NC-4", price: 16000, quality: 5, risk: 0.90, speed: 6, perfectFloor: 1 },
    { modelKey: "scan3d", name: "3D扫描设计台", category: "扫描设计台", model: "3D扫描 SD-5", price: 18000, quality: 6, risk: 0.95, speed: 5, perfectFloor: 2 }
  ],
  finishing: [
    { modelKey: "polish", name: "精加工抛光台", category: "玉雕机·抛光机", model: "精雕抛光一体机 JP-3", price: 12000, quality: 3, risk: 1.10, speed: 8, perfectFloor: 0 },
    { modelKey: "inlay", name: "镶嵌一体机", category: "镶嵌机", model: "镶嵌一体 IJ-6", price: 15000, quality: 5, risk: 1.00, speed: 6, perfectFloor: 1 },
    { modelKey: "hiperf", name: "高光精雕机", category: "高光精雕机", model: "高光精雕 HG-7", price: 20000, quality: 7, risk: 1.15, speed: 4, perfectFloor: 2 }
  ]
};

const ROUTES = {
  opening: {
    inputType: "rough",
    inputStage: "rough",
    outputStage: "opened",
    durationStage: "rough",
    workerId: "worker-opening",
    fee: 620,
    needsKits: false
  },
  carving: {
    inputType: "rough",
    inputStage: "opened",
    outputStage: "carved",
    durationStage: "refine",
    workerId: "worker-polishing",
    fee: 900,
    needsKits: true
  },
  finishing: {
    inputType: "bracelet",
    inputStage: "carved",
    outputStage: "finished",
    durationStage: "inlay",
    workerId: "worker-carving",
    fee: 680,
    needsKits: false
  }
};

export function equipmentCatalog() {
  return Object.entries(MODELS).flatMap(([stage, rows]) =>
    rows.map((row) => ({ ...row, stage, tier: 1 }))
  );
}

export function createDeviceInstance(stage, modelKey, id) {
  const model = equipmentCatalog().find(
    (entry) => entry.stage === stage && entry.modelKey === modelKey
  );
  if (!model) return null;
  return {
    id,
    stage,
    modelKey,
    name: model.name,
    category: model.category,
    model: model.model,
    tier: 1,
    basePrice: model.price,
    attrs: {
      quality: model.quality,
      risk: model.risk,
      speed: model.speed,
      perfectFloor: model.perfectFloor
    },
    ...ROUTES[stage],
    capacity: 1,
    condition: 100
  };
}

export function normalizeDevice(device) {
  const model = equipmentCatalog().find(
    (entry) => entry.stage === device?.stage && entry.modelKey === device?.modelKey
  );
  return {
    ...device,
    basePrice: Number(device?.basePrice || model?.price || 0),
    capacity: 1,
    condition: Math.max(0, Math.min(100, Number(device?.condition ?? 100)))
  };
}

export function durabilityLoss(device) {
  const risk = Number(device?.attrs?.risk ?? 1);
  return Math.max(1, Math.min(3, Math.round(1 + Math.max(0, risk - 1) * 5)));
}

export function repairQuote(device) {
  const missing = 100 - Math.max(0, Math.min(100, Number(device?.condition ?? 100)));
  return Math.ceil(Number(device?.basePrice || 0) * (missing / 100) * 0.35);
}

export function buyEquipment(player, modelKey, { spendCash, makeId }) {
  const model = equipmentCatalog().find((entry) => entry.modelKey === modelKey);
  if (!model) {
    return { ok: false, code: "NOT_FOUND", message: "设备型号不存在。" };
  }
  if (!spendCash(
    player,
    model.price,
    `购入设备：${model.name}`,
    { source: "equipment", itemId: model.modelKey }
  )) {
    return {
      ok: false,
      code: "INSUFFICIENT_CASH",
      message: `购买 ${model.name} 需要 ¥${model.price}。`
    };
  }
  const device = createDeviceInstance(model.stage, model.modelKey, makeId());
  player.workshop ||= {};
  player.workshop.devices ||= [];
  player.workshop.devices.push(device);
  return { ok: true, message: `${model.name} 已加入工坊。`, device };
}

export function repairEquipment(player, deviceId, { spendCash }) {
  const device = player?.workshop?.devices?.find((item) => item.id === deviceId);
  if (!device) {
    return { ok: false, code: "NOT_FOUND", message: "设备不存在。" };
  }
  const cost = repairQuote(device);
  if (cost === 0) {
    return { ok: false, code: "INVALID_QUANTITY", message: "设备无需维修。" };
  }
  if (!spendCash(
    player,
    cost,
    `维修设备：${device.name}`,
    { source: "equipmentRepair", itemId: device.id }
  )) {
    return {
      ok: false,
      code: "INSUFFICIENT_CASH",
      message: `维修需要 ¥${cost}。`
    };
  }
  device.condition = 100;
  return { ok: true, message: `${device.name} 已维修至 100%。`, device, cost };
}
```

- [ ] **Step 4: Run the focused equipment test**

```powershell
npm run test:equipment
```

Expected: `equipment-system-smoke: ok`.

- [ ] **Step 5: Integrate server normalization, snapshots, events, and completion**

In `server.js`:

- import `equipmentCatalog`, `createDeviceInstance`, `normalizeDevice`, `buyEquipment`, `durabilityLoss`, `repairEquipment`;
- delete the local `DEVICE_MODELS`, `DEVICE_SHOP_BASE_PRICE`, and `deviceShopPrice` definitions after their callers use the imported catalog;
- create starter devices with:

```js
function starterDevices() {
  return [
    createDeviceInstance("opening", "rough", randomUUID()),
    createDeviceInstance("carving", "carve", randomUUID()),
    createDeviceInstance("finishing", "polish", randomUUID())
  ];
}
```

- normalize all returning devices with:

```js
player.workshop.devices = (player.workshop.devices || []).length
  ? player.workshop.devices.map(normalizeDevice)
  : starterDevices();
```

- reject start when `condition <= 0`;
- check `workshopJobsForDevice(player, device.id).length >= 1`, never `device.capacity`;
- include `equipmentCatalog: equipmentCatalog()` in `snapshotFor`;
- define request dedupe once for all later economic events:

```js
function consumeRequestId(player, requestId) {
  if (!player || typeof requestId !== "string" || requestId.length < 8) {
    return {
      ok: false,
      code: "DUPLICATE_REQUEST",
      message: "请求标识无效，请重试。"
    };
  }
  player.recentRequestIds ||= [];
  if (player.recentRequestIds.includes(requestId)) {
    return {
      ok: false,
      code: "DUPLICATE_REQUEST",
      message: "该操作已经处理，请勿重复提交。"
    };
  }
  player.recentRequestIds.push(requestId);
  player.recentRequestIds = player.recentRequestIds.slice(-64);
  return null;
}
```

- add request handlers:

```js
socket.on("buyWorkshopDevice", ({ modelKey, requestId } = {}) => {
  const player = getPlayer(socket);
  const duplicate = consumeRequestId(player, requestId);
  if (duplicate) return socket.emit("toast", duplicate.message);
  const result = buyEquipment(player, modelKey, {
    spendCash,
    makeId: () => randomUUID()
  });
  socket.emit("toast", result.message);
  if (result.ok) broadcast();
});

socket.on("repairWorkshopDevice", ({ deviceId, requestId } = {}) => {
  const player = getPlayer(socket);
  const duplicate = consumeRequestId(player, requestId);
  if (duplicate) return socket.emit("toast", duplicate.message);
  const result = repairEquipment(player, deviceId, { spendCash });
  socket.emit("toast", result.message);
  if (result.ok) broadcast();
});

// Replace the existing startWorkshopJob handler with this deduped entry.
socket.on("startWorkshopJob", (payload = {}) => {
  const player = getPlayer(socket);
  const duplicate = consumeRequestId(player, payload.requestId);
  if (duplicate) return socket.emit("toast", duplicate.message);
  const result = startWorkshopJobForPlayer(player, payload.deviceId, payload);
  if (!result.ok) return socket.emit("toast", result.message);
  broadcast();
});
```

After every completed job, including shatter, call:

```js
function applyJobDurability(player, job) {
  const device = workshopDeviceForPlayer(player, job.deviceId);
  if (!device) return 0;
  const loss = durabilityLoss(device);
  device.condition = Math.max(0, Number(device.condition ?? 100) - loss);
  return loss;
}
```

Call `applyJobDurability(player, job)` exactly once from `completeProductionJob`, before any success/failure return.

- [ ] **Step 6: Add shop and workshop UI**

In `public/index.html`, add a `device` shop tab and `#equipmentShop`.

In `public/extra-module.js`, render `state.equipmentCatalog` grouped by stage with price and purchase button. Emit:

```js
socketRef.emit("buyWorkshopDevice", {
  modelKey,
  requestId: crypto.randomUUID()
});
```

In `public/workshop-module.js`:

- group devices by `device.stage`;
- show all owned devices;
- show load as `0/1` or `1/1`;
- disable start at condition 0;
- emit repair with a fresh request ID;
- add `requestId: crypto.randomUUID()` to every opening, carving, and finishing `startWorkshopJob` request;
- “换设备” opens the shop and selects the device tab with the stage filter.

- [ ] **Step 7: Extend server smoke coverage**

Add assertions that:

- buying adds rather than replaces;
- insufficient cash adds nothing;
- two same-stage devices can run independently;
- one device rejects a second job and has no queue;
- completion loses expected durability;
- zero durability rejects start;
- repair restores 100.

- [ ] **Step 8: Verify desktop and mobile UI**

Run:

```powershell
npm run test:equipment
npm run test:server-idle
npm test
```

Browser-check equipment shop and two same-stage devices at 1280×720, 390×844, and 430×932. Expected: desktop global regions unchanged; mobile controls reachable.

- [ ] **Step 9: Commit the equipment loop**

```powershell
git add -- server/systems/equipment-system.js scripts/equipment-system-smoke.mjs server.js public/index.html public/extra-module.js public/workshop-module.js public/styles.css package.json package-lock.json
git diff --cached --check
git commit -m "feat: complete equipment purchase and durability loop"
```

---

### Task 6: Build and Integrate Recruitment and Skill Growth

**Files:**
- Create: `server/systems/employee-system.js`
- Create: `scripts/employee-system-smoke.mjs`
- Modify: `package.json`
- Modify: `server.js`
- Modify: `public/index.html`
- Modify: `public/main.js`
- Modify: `public/extra-module.js`
- Modify: `public/workshop-module.js`
- Modify: `public/livestream-module.js`
- Modify: `public/styles.css`

**Interfaces:**
- Consumes: current four starter workers, `player.jobs`, `player.livestreamJobs`, `spendCash`, `randomUUID`.
- Produces:
  - `ensureRecruitCandidates(player, deps)`
  - `refreshRecruitCandidates(player, deps)`
  - `recruitWorker(player, candidateId, deps)`
  - `mergeWorkers(starters, existing)`
  - `isWorkerBusy(player, workerId)`
  - `grantActivityExperience(worker, activity)`
  - Socket events `refreshRecruitCandidates` and `recruitWorker`

- [ ] **Step 1: Write failing employee rule tests**

Create `scripts/employee-system-smoke.mjs`:

```js
import assert from "node:assert/strict";
import {
  ensureRecruitCandidates,
  refreshRecruitCandidates,
  recruitWorker,
  isWorkerBusy,
  grantActivityExperience
} from "../server/systems/employee-system.js";

const seq = [0.10, 0.20, 0.30, 0.40, 0.50];
let index = 0;
const rng = () => seq[index++ % seq.length];
const makeId = (() => {
  let n = 0;
  return () => `candidate-${++n}`;
})();
const spendCash = (player, amount) => {
  if (player.cash < amount) return false;
  player.cash -= amount;
  return true;
};

const player = {
  cash: 50000,
  workshop: { workers: [] },
  jobs: [],
  livestreamJobs: []
};

assert.equal(ensureRecruitCandidates(player, { rng, makeId }).length, 3);
assert.equal(player.cash, 50000);
assert.equal(
  refreshRecruitCandidates(player, { rng, makeId, spendCash }).ok,
  true
);
assert.equal(player.cash, 49500);

const candidate = player.recruitCandidates[0];
const hire = recruitWorker(player, candidate.id, { spendCash });
assert.equal(hire.ok, true);
assert.equal(player.workshop.workers.length, 1);

player.jobs.push({ workerId: hire.worker.id });
assert.equal(isWorkerBusy(player, hire.worker.id), true);

const skill = hire.worker.skills.cut.jieliao;
skill.level = 1;
skill.exp = 45;
grantActivityExperience(hire.worker, "opening");
assert.equal(skill.level, 2);
assert.equal(skill.exp, 5);

skill.level = 9;
skill.exp = 445;
grantActivityExperience(hire.worker, "opening");
assert.equal(skill.level, 10);
assert.equal(skill.exp, 0);

const fullPlayer = {
  cash: 50000,
  workshop: {
    workers: Array.from({ length: 8 }, (_, n) => ({ id: `worker-${n}` }))
  },
  recruitCandidates: [structuredClone(player.recruitCandidates[0])]
};
const cashBeforeFullHire = fullPlayer.cash;
assert.equal(
  recruitWorker(fullPlayer, fullPlayer.recruitCandidates[0].id, { spendCash }).code,
  "ROSTER_FULL"
);
assert.equal(fullPlayer.cash, cashBeforeFullHire);

console.log("employee-system-smoke: ok");
```

Add `test:employee` to `package.json` and the main test chain.

- [ ] **Step 2: Run the employee test and confirm module-not-found failure**

```powershell
npm run test:employee
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the recruitment and XP module**

Use constants:

```js
export const MAX_WORKERS = 8;
export const RECRUIT_REFRESH_COST = 500;
export const ACTIVITY_XP = {
  opening: { jieliao: 10, damo: 5 },
  carving: { xiuxing: 10, qieliao: 5 },
  finishing: { diaozhuo: 10, xiangqian: 5 },
  livestream: { huashu: 10, kongchang: 7, cuidan: 5 }
};

const TIER_WEIGHTS = [
  [1, 0.45],
  [2, 0.30],
  [3, 0.15],
  [4, 0.08],
  [5, 0.02]
];

export function recruitPrice(tier) {
  return 1500 + Number(tier) ** 2 * 750;
}

export function isWorkerBusy(player, workerId) {
  return [...(player.jobs || []), ...(player.livestreamJobs || [])]
    .some((job) => job.workerId === workerId);
}

function addSkillExp(skill, amount) {
  if (!skill || skill.level >= 10) return [];
  const levels = [];
  skill.exp += amount;
  while (skill.level < 10 && skill.exp >= 50 * skill.level) {
    skill.exp -= 50 * skill.level;
    skill.level += 1;
    levels.push(skill.level);
  }
  if (skill.level >= 10) skill.exp = 0;
  return levels;
}

const SKILL_DIR = {
  jieliao: "cut",
  damo: "cut",
  qieliao: "set",
  xiuxing: "set",
  diaozhuo: "finish",
  xiangqian: "finish",
  huashu: "speak",
  kongchang: "speak",
  cuidan: "speak"
};

const JOB_SKILLS = {
  cutter: ["jieliao", "damo"],
  planner: ["qieliao", "xiuxing"],
  finisher: ["diaozhuo", "xiangqian"],
  streamer: ["huashu", "kongchang", "cuidan"]
};

const NAMES = ["阿良", "玉芬", "周师傅", "林巧", "陈稳", "许宁", "罗师傅", "小满", "梁玉", "宋师傅", "叶青", "顾成"];
const POSITIVE_TRAITS = ["巧手", "净料", "稳手", "心细"];
const NEGATIVE_TRAITS = ["易裂", "易出绵", "易脏", "手重"];

function pick(list, rng) {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

function randomInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function weightedTier(rng) {
  let roll = rng();
  for (const [tier, weight] of TIER_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return tier;
  }
  return 5;
}

function candidateSkills(job, tier, rng) {
  const skills = { cut: {}, set: {}, finish: {}, speak: {} };
  for (const [key, dir] of Object.entries(SKILL_DIR)) {
    const main = JOB_SKILLS[job].includes(key);
    const level = main
      ? Math.min(7, tier + 1 + randomInt(rng, 0, 1))
      : Math.min(5, 1 + randomInt(rng, 0, Math.min(2, tier - 1)));
    skills[dir][key] = { level, exp: 0 };
  }
  return skills;
}

function makeCandidate({ rng, makeId }) {
  const jobs = Object.keys(JOB_SKILLS);
  const tier = weightedTier(rng);
  const job = pick(jobs, rng);
  return {
    id: makeId(),
    name: pick(NAMES, rng),
    job,
    tier,
    tierLevel: 1,
    traits: [pick(POSITIVE_TRAITS, rng)],
    flaws: [pick(NEGATIVE_TRAITS, rng)],
    skills: candidateSkills(job, tier, rng),
    price: recruitPrice(tier)
  };
}

function newCandidateBatch(deps) {
  return [
    makeCandidate(deps),
    makeCandidate(deps),
    makeCandidate(deps)
  ];
}

export function ensureRecruitCandidates(player, deps) {
  if (!Array.isArray(player.recruitCandidates) || player.recruitCandidates.length === 0) {
    player.recruitCandidates = newCandidateBatch(deps);
  }
  return player.recruitCandidates;
}

export function refreshRecruitCandidates(player, { rng, makeId, spendCash }) {
  if (!spendCash(
    player,
    RECRUIT_REFRESH_COST,
    "刷新招聘候选人",
    { source: "recruitRefresh" }
  )) {
    return {
      ok: false,
      code: "INSUFFICIENT_CASH",
      message: "刷新候选人需要 ¥500。"
    };
  }
  player.recruitCandidates = newCandidateBatch({ rng, makeId });
  return { ok: true, message: "候选人已经刷新。", candidates: player.recruitCandidates };
}

export function recruitWorker(player, candidateId, { spendCash }) {
  player.workshop ||= {};
  player.workshop.workers ||= [];
  if (player.workshop.workers.length >= MAX_WORKERS) {
    return { ok: false, code: "ROSTER_FULL", message: "员工人数已经达到 8 人上限。" };
  }
  const candidate = (player.recruitCandidates || [])
    .find((item) => item.id === candidateId);
  if (!candidate) {
    return { ok: false, code: "NOT_FOUND", message: "候选人不存在。" };
  }
  if (!spendCash(
    player,
    candidate.price,
    `招聘员工：${candidate.name}`,
    { source: "recruit", itemId: candidate.id }
  )) {
    return {
      ok: false,
      code: "INSUFFICIENT_CASH",
      message: `招聘 ${candidate.name} 需要 ¥${candidate.price}。`
    };
  }
  const worker = structuredClone(candidate);
  delete worker.price;
  player.workshop.workers.push(worker);
  player.recruitCandidates = player.recruitCandidates
    .filter((item) => item.id !== candidateId);
  return { ok: true, message: `${worker.name} 已加入工坊。`, worker };
}

export function mergeWorkers(starters, existing) {
  const starterIds = new Set(starters.map((worker) => worker.id));
  const existingById = new Map(existing.map((worker) => [worker.id, worker]));
  const mergedStarters = starters.map((starter) => {
    const saved = existingById.get(starter.id);
    return saved ? { ...structuredClone(starter), ...saved } : structuredClone(starter);
  });
  const recruits = existing.filter((worker) => !starterIds.has(worker.id));
  return [...mergedStarters, ...recruits].slice(0, MAX_WORKERS);
}

export function grantActivityExperience(worker, activity) {
  const grants = ACTIVITY_XP[activity] || {};
  const levelUps = [];
  for (const [key, amount] of Object.entries(grants)) {
    const dir = SKILL_DIR[key];
    const skill = worker?.skills?.[dir]?.[key];
    for (const level of addSkillExp(skill, amount)) {
      levelUps.push({ key, level });
    }
  }
  return { grants, levelUps };
}
```

- [ ] **Step 4: Run focused employee tests**

```powershell
npm run test:employee
```

Expected: `employee-system-smoke: ok`.

- [ ] **Step 5: Preserve recruited workers and add server events**

Replace the current normalization that maps only starter definitions with:

```js
player.workshop.workers = mergeWorkers(
  WORKSHOP_WORKER_DEFS,
  player.workshop.workers || []
);
ensureRecruitCandidates(player, {
  rng: Math.random,
  makeId: () => randomUUID()
});
```

In `snapshotFor`, return:

```js
workshop: {
  ...player.workshop,
  devices: player.workshop.devices,
  workers: player.workshop.workers.map((worker) => ({
    ...worker,
    busy: isWorkerBusy(player, worker.id)
  }))
},
recruitCandidates: structuredClone(player.recruitCandidates)
```

Add:

```js
socket.on("refreshRecruitCandidates", ({ requestId } = {}) => {
  const player = getPlayer(socket);
  const duplicate = consumeRequestId(player, requestId);
  if (duplicate) return socket.emit("toast", duplicate.message);
  const result = refreshRecruitCandidates(player, {
    rng: Math.random,
    makeId: () => randomUUID(),
    spendCash
  });
  socket.emit("toast", result.message);
  if (result.ok) broadcast();
});

socket.on("recruitWorker", ({ candidateId, requestId } = {}) => {
  const player = getPlayer(socket);
  const duplicate = consumeRequestId(player, requestId);
  if (duplicate) return socket.emit("toast", duplicate.message);
  const result = recruitWorker(player, candidateId, { spendCash });
  socket.emit("toast", result.message);
  if (result.ok) broadcast();
});
```

- [ ] **Step 6: Enforce one active task per worker**

Before taking material or charging cash in `startWorkshopJobForPlayer`:

```js
if (!worker) {
  return { ok: false, code: "NOT_FOUND", message: "这位师傅不存在。" };
}
if (isWorkerBusy(player, worker.id)) {
  return { ok: false, code: "WORKER_BUSY", message: "这位师傅正在执行其他任务。" };
}
```

Change scheduling to select a real worker:

```js
function livestreamWorkerForPlayer(player, requestedWorkerId) {
  const workers = player.workshop?.workers || [];
  const requested = workers.find((worker) => worker.id === requestedWorkerId);
  if (requested && !isWorkerBusy(player, requested.id)) return requested;
  return workers.find(
    (worker) => worker.job === "streamer" && !isWorkerBusy(player, worker.id)
  ) || null;
}

function scheduleLivestream(player, productId, mode = "autoBalanced", workerId = null) {
  normalizePlayer(player);
  if (!playerCanLivestream(player)) return null;
  const worker = livestreamWorkerForPlayer(player, workerId);
  if (!worker) return null;
  const product = takeItem(player, "bracelet", productId);
  if (!product) return null;
  if (materialStageFor(product) !== "finished") {
    restoreWorkshopItem(player, product);
    return null;
  }
  const now = Date.now();
  const job = {
    id: randomUUID(),
    type: "livestreamJob",
    mode,
    product,
    workerId: worker.id,
    startedAt: now,
    readyAt: now + TIMING.livestream.min
  };
  player.livestreamJobs.push(job);
  refreshPlayerReport(player, now);
  return job;
}
```

Update the Socket handler and `public/livestream-module.js` payload to include the selected `workerId`. Render all non-busy employees in the existing livestream panel; default to the available employee whose main job is `streamer`. Apply the same worker selection to manual livestream sale.

- [ ] **Step 7: Grant experience on all completion paths**

At production completion, call:

```js
const activity = workshopDeviceForPlayer(player, job.deviceId)?.stage
  || ({ rough: "opening", refine: "carving", inlay: "finishing" }[job.stage])
  || job.stage;
const xpResult = grantActivityExperience(worker, activity);
```

Call it before the shatter return so failure still earns XP. For successful livestream settlement and manual livestream sale, call:

```js
grantActivityExperience(worker, "livestream");
```

Include level-up data in the emitted UI event so the client can show a toast.

- [ ] **Step 8: Replace the currently closed recruitment UI**

In `public/index.html`, replace the unopened recruitment copy with:

```html
<section class="panel hire-panel">
  <div class="panel-head">
    <h3>师傅招募</h3>
    <button id="refreshRecruitBtn" type="button">刷新候选人 ¥500</button>
  </div>
  <div id="recruitCandidateList" class="recruit-candidate-list"></div>
</section>
```

Add element references and render candidate cards in `public/extra-module.js`. Each card displays name, job, tier, main skills, both traits, and price. Emit:

```js
socketRef.emit("recruitWorker", {
  candidateId,
  requestId: crypto.randomUUID()
});
```

Refresh emits `refreshRecruitCandidates` with a fresh request ID.

- [ ] **Step 9: Show busy and XP state in existing worker cards**

In `public/workshop-module.js`:

- render `worker.busy` and disable selecting a busy worker for a new start;
- retain existing nine-skill bars;
- show exact `exp / (50 × level)` values;
- show level-up toasts from server UI events;
- keep desktop card positions and modal composition unchanged.

- [ ] **Step 10: Verify employee behavior**

Run:

```powershell
npm run test:employee
npm run test:server-idle
npm test
```

Browser-check:

- initial four employees;
- three candidates;
- paid refresh;
- successful hire;
- eight-worker cap;
- one employee blocked from two simultaneous devices;
- skill XP and level-up after completion;
- desktop 1280×720 and both mobile target sizes.

- [ ] **Step 11: Commit the employee loop**

```powershell
git add -- server/systems/employee-system.js scripts/employee-system-smoke.mjs server.js public/index.html public/main.js public/extra-module.js public/workshop-module.js public/livestream-module.js public/styles.css package.json package-lock.json
git diff --cached --check
git commit -m "feat: complete employee recruitment and skill growth"
```

---

### Task 7: Build and Integrate the Finishing-Inlay Loop

**Files:**
- Create: `server/systems/inlay-system.js`
- Create: `scripts/inlay-system-smoke.mjs`
- Modify: `package.json`
- Modify: `server.js`
- Modify: `public/extra-module.js`
- Modify: `public/workshop-module.js`
- Modify: `public/styles.css`

**Interfaces:**
- Consumes: `player.externalMaterials`, finishing input item, current material shop, `startWorkshopJobForPlayer`, `completeProductionJob`.
- Produces:
  - `inlayCatalog()`
  - `validateFinishPlan(item, plan)`
  - `quoteFinishPlan(item, plan)`
  - `reserveFinishMaterials(player, quote)`
  - `refundFinishMaterials(player, reservedMaterials)`
  - `applyInlay(product, plan, quote)`
  - job fields `finishPlan` and `reservedMaterials`

- [ ] **Step 1: Write failing inlay rule tests**

Create `scripts/inlay-system-smoke.mjs`:

```js
import assert from "node:assert/strict";
import {
  validateFinishPlan,
  quoteFinishPlan,
  reserveFinishMaterials,
  refundFinishMaterials,
  applyInlay
} from "../server/systems/inlay-system.js";

const cabochon = { id: "jade-1", kind: "cabochon", value: 10000 };
const plan = {
  productType: "ring",
  settingId: "claw",
  metalId: "gold18k",
  gemId: "diamond",
  gemCount: 2,
  polishId: "bright",
  backingId: "open"
};

assert.equal(validateFinishPlan(cabochon, plan).ok, true);
const quote = quoteFinishPlan(cabochon, plan);
assert.equal(quote.metalAmount, 1.65);
assert.equal(quote.laborFee, 410);
assert.equal(quote.valueMultiplier, 1.35);

assert.equal(
  validateFinishPlan(cabochon, { ...plan, metalId: "goldPure" }).ok,
  false
);
assert.equal(
  validateFinishPlan(cabochon, { ...plan, gemCount: 13 }).code,
  "INVALID_QUANTITY"
);

const player = {
  externalMaterials: { gold18k: 2, diamond: 2 }
};
const reserve = reserveFinishMaterials(player, quote);
assert.equal(reserve.ok, true);
assert.equal(player.externalMaterials.gold18k, 0.35);
assert.equal(player.externalMaterials.diamond, 0);
refundFinishMaterials(player, reserve.reservedMaterials);
assert.equal(player.externalMaterials.gold18k, 2);
assert.equal(player.externalMaterials.diamond, 2);

const product = applyInlay({ value: 10000 }, plan, quote);
assert.equal(product.value, 13500);
assert.equal(product.inlay.settingId, "claw");

console.log("inlay-system-smoke: ok");
```

Add `test:inlay` to `package.json` and the main test chain.

- [ ] **Step 2: Run the inlay test and confirm module-not-found failure**

```powershell
npm run test:inlay
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement authoritative inlay tables and validation**

Create the module with:

```js
const SETTINGS = {
  claw: { name: "爪镶", grams: 1.5, labor: 200, metals: ["gold18k", "platinum"] },
  bezel: { name: "包镶", grams: 2.5, labor: 300, metals: ["goldPure", "silver925", "gold18k", "platinum"] },
  micro: { name: "微镶/钉镶", grams: 3.0, labor: 800, metals: ["gold18k", "platinum"] },
  channel: { name: "槽镶", grams: 2.0, labor: 500, metals: ["gold18k", "platinum"] },
  invisible: { name: "无边镶", grams: 3.5, labor: 1200, metals: ["gold18k", "platinum"] },
  cord: { name: "编绳/配链", grams: 0, labor: 20, metals: [] }
};

const METAL_VALUE = {
  goldPure: 0.15,
  silver925: 0.03,
  gold18k: 0.20,
  platinum: 0.25
};

const POLISH = {
  bright: { labor: 50, value: 0.05 },
  soft: { labor: 30, value: 0.02 },
  matte: { labor: 0, value: 0 }
};

const BACKING = {
  open: { labor: 0, value: 0, trust: 0 },
  closed: { labor: 100, value: 0.03, trust: -0.20 }
};

const SHAPE_SETTINGS = {
  cabochon: ["claw", "bezel", "micro", "channel", "invisible", "cord"],
  carving: ["claw", "bezel", "micro", "cord"],
  pierced: ["bezel", "cord"],
  whole: ["cord"]
};

const PRODUCT_TYPES = {
  cabochon: ["ring", "pendant", "earring"],
  carving: ["pendant", "earring"],
  pierced: ["pendant"],
  whole: ["bracelet", "handpiece"]
};

const GEMS = new Set(["diamond", "ruby", "sapphire"]);

function itemShape(item) {
  const key = String(item?.kind || item?.design || "").toLowerCase();
  if (["cabochon", "egg", "saddle", "蛋面"].includes(key)) return "cabochon";
  if (["buddha", "guanyin", "leaf", "gourd", "fubean", "carving", "雕件"].includes(key)) return "carving";
  if (["peacependant", "plaque", "pierced", "平安扣", "无事牌", "山水牌"].includes(key)) return "pierced";
  if (["bangle", "bead", "seal", "whole", "手镯", "珠链", "印章"].includes(key)) return "whole";
  return null;
}

function failure(code, message) {
  return { ok: false, code, message };
}

export function validateFinishPlan(item, plan) {
  const shape = itemShape(item);
  if (!shape || !plan || typeof plan !== "object") {
    return failure("INVALID_COMBINATION", "无法识别该套件的精加工形态。");
  }
  const setting = SETTINGS[plan.settingId];
  if (!PRODUCT_TYPES[shape].includes(plan.productType)) {
    return failure("INVALID_COMBINATION", "该套件不能制作所选成品类型。");
  }
  if (!setting || !SHAPE_SETTINGS[shape].includes(plan.settingId)) {
    return failure("INVALID_COMBINATION", "该套件不支持所选镶嵌方式。");
  }
  const gemCount = Number(plan.gemCount);
  if (!Number.isInteger(gemCount) || gemCount < 0 || gemCount > 12) {
    return failure("INVALID_QUANTITY", "配石数量必须为 0～12 颗。");
  }
  if (gemCount === 0 && plan.gemId != null) {
    return failure("INVALID_COMBINATION", "不配石时不能选择宝石。");
  }
  if (gemCount > 0 && !GEMS.has(plan.gemId)) {
    return failure("INVALID_COMBINATION", "请选择有效的配石材料。");
  }
  if (plan.settingId === "cord") {
    if (plan.metalId != null) {
      return failure("INVALID_COMBINATION", "编绳工艺不使用金属。");
    }
  } else if (!setting.metals.includes(plan.metalId)) {
    return failure("INVALID_COMBINATION", "所选金属不适用于该镶嵌方式。");
  }
  if (!POLISH[plan.polishId]) {
    return failure("INVALID_COMBINATION", "请选择有效的抛光方式。");
  }
  const backingAllowed = shape === "cabochon" && plan.productType === "ring";
  if (backingAllowed && !BACKING[plan.backingId]) {
    return failure("INVALID_COMBINATION", "蛋面戒指必须选择底托方式。");
  }
  if (!backingAllowed && plan.backingId != null) {
    return failure("INVALID_COMBINATION", "当前成品不支持底托选项。");
  }
  return { ok: true, shape };
}
```

- [ ] **Step 4: Implement quote, reserve/refund, and value**

Use:

```js
export function quoteFinishPlan(item, plan) {
  const validation = validateFinishPlan(item, plan);
  if (!validation.ok) return validation;
  const setting = SETTINGS[plan.settingId];
  const polish = POLISH[plan.polishId];
  const backing = plan.backingId ? BACKING[plan.backingId] : BACKING.open;
  const gemCount = Number(plan.gemCount);
  const metalAmount = Number(
    (setting.grams * (1 + gemCount * 0.05)).toFixed(2)
  );
  const laborFee = setting.labor + gemCount * 80 + polish.labor + backing.labor;
  const valueMultiplier = Number((
    1 +
    (plan.metalId ? METAL_VALUE[plan.metalId] : 0) +
    gemCount * 0.05 +
    polish.value +
    backing.value
  ).toFixed(2));
  return {
    metalId: plan.metalId,
    metalAmount,
    gemId: plan.gemId,
    gemCount,
    laborFee,
    valueMultiplier,
    trustModifier: backing.trust
  };
}

function round2(value) {
  return Number(Number(value).toFixed(2));
}

export function reserveFinishMaterials(player, quote) {
  const materials = player?.externalMaterials;
  if (!materials) {
    return failure("INSUFFICIENT_MATERIAL", "镶嵌材料库存不存在。");
  }
  if (quote.metalId && Number(materials[quote.metalId] || 0) < quote.metalAmount) {
    return failure("INSUFFICIENT_MATERIAL", "金属材料不足。");
  }
  if (quote.gemCount > 0 && Number(materials[quote.gemId] || 0) < quote.gemCount) {
    return failure("INSUFFICIENT_MATERIAL", "配石库存不足。");
  }
  const reservedMaterials = {};
  if (quote.metalId) {
    materials[quote.metalId] = round2(
      Number(materials[quote.metalId]) - quote.metalAmount
    );
    reservedMaterials[quote.metalId] = quote.metalAmount;
  }
  if (quote.gemCount > 0) {
    materials[quote.gemId] = Number(materials[quote.gemId]) - quote.gemCount;
    reservedMaterials[quote.gemId] = quote.gemCount;
  }
  return { ok: true, reservedMaterials };
}

export function refundFinishMaterials(player, reservedMaterials = {}) {
  player.externalMaterials ||= {};
  for (const [key, amount] of Object.entries(reservedMaterials)) {
    player.externalMaterials[key] = round2(
      Number(player.externalMaterials[key] || 0) + Number(amount)
    );
  }
}

const LABELS = {
  productType: {
    ring: "戒指",
    pendant: "吊坠",
    earring: "耳坠",
    bracelet: "手链",
    handpiece: "把件"
  },
  metal: {
    goldPure: "足金24K",
    silver925: "925银",
    gold18k: "18K金",
    platinum: "铂金PT950"
  },
  gem: {
    diamond: "配石钻石",
    ruby: "红宝石",
    sapphire: "蓝宝石"
  },
  polish: {
    bright: "亮光",
    soft: "柔光",
    matte: "哑光"
  },
  backing: {
    open: "透底",
    closed: "封底"
  }
};

export function inlayCatalog() {
  return structuredClone({
    settings: SETTINGS,
    metals: LABELS.metal,
    gems: LABELS.gem,
    polishes: POLISH,
    polishNames: LABELS.polish,
    backings: BACKING,
    backingNames: LABELS.backing,
    productTypes: PRODUCT_TYPES,
    productTypeNames: LABELS.productType,
    shapeSettings: SHAPE_SETTINGS
  });
}

export function applyInlay(product, plan, quote) {
  product.value = Math.round(Number(product.value || 0) * quote.valueMultiplier);
  product.inlaid = true;
  product.polished = true;
  product.inlay = {
    ...structuredClone(plan),
    productTypeName: LABELS.productType[plan.productType],
    settingName: SETTINGS[plan.settingId].name,
    metalName: plan.metalId ? LABELS.metal[plan.metalId] : null,
    gemName: plan.gemId ? LABELS.gem[plan.gemId] : null,
    polishName: LABELS.polish[plan.polishId],
    backingName: plan.backingId ? LABELS.backing[plan.backingId] : null,
    metalAmount: quote.metalAmount,
    laborFee: quote.laborFee,
    valueMultiplier: quote.valueMultiplier,
    trustModifier: quote.trustModifier
  };
  return product;
}
```

- [ ] **Step 5: Run focused inlay tests**

```powershell
npm run test:inlay
```

Expected: `inlay-system-smoke: ok`.

- [ ] **Step 6: Make finishing start atomic**

Add a non-mutating item lookup:

```js
function findWorkshopItem(player, device, itemId) {
  const bucket = device.inputType === "rough" ? player.rough : player.bracelets;
  return bucket.find((item) => item.id === itemId) || null;
}
```

First, update the existing material purchase request to carry an ID. In `public/extra-module.js`, emit:

```js
socketRef.emit("buyMaterialPack", {
  materialId,
  amount,
  requestId: crypto.randomUUID()
});
```

Replace the server handler with:

```js
socket.on("buyMaterialPack", ({ materialId, amount, requestId } = {}) => {
  const player = getPlayer(socket);
  const duplicate = consumeRequestId(player, requestId);
  if (duplicate) return socket.emit("toast", duplicate.message);
  if (!player || !materialId || !Number.isFinite(Number(amount))) return;
  const result = buyMaterialPack(player, materialId, Number(amount));
  socket.emit("toast", result.message);
  if (result.ok) broadcast();
});
```

Add an option to `startProductionJob` so a caller that already paid can queue without a second charge:

```js
if (!options.feeAlreadyPaid && !spendCash(
  player,
  stageCost,
  `${options.label || stage}加工`,
  { source: "workshop", itemId: item.id }
)) {
  return null;
}
```

Add `inlayCatalog: inlayCatalog()` to `snapshotFor`. In `startWorkshopJobForPlayer`, run the existing ownership/device/condition/capacity/worker checks first. For the finishing branch, use this exact order:

```js
const previewItem = findWorkshopItem(player, device, itemId);
if (!previewItem) {
  return { ok: false, code: "NOT_FOUND", message: "找不到可加工物料。" };
}
if (materialStageFor(previewItem) !== device.inputStage) {
  return {
    ok: false,
    code: "INVALID_COMBINATION",
    message: "这台设备不能处理当前阶段的物料。"
  };
}

const validation = validateFinishPlan(previewItem, payload.finishPlan);
if (!validation.ok) return validation;
const quote = quoteFinishPlan(previewItem, payload.finishPlan);
if (player.cash < quote.laborFee) {
  return {
    ok: false,
    code: "INSUFFICIENT_CASH",
    message: `精加工人工费需要 ¥${quote.laborFee}。`
  };
}

const item = takeItem(player, device.inputType, itemId);
const reserve = reserveFinishMaterials(player, quote);
if (!reserve.ok) {
  restoreWorkshopItem(player, item);
  return reserve;
}
if (!spendCash(
  player,
  quote.laborFee,
  `精加工：${item.name}`,
  { source: "workshop", itemId: item.id }
)) {
  refundFinishMaterials(player, reserve.reservedMaterials);
  restoreWorkshopItem(player, item);
  return {
    ok: false,
    code: "INSUFFICIENT_CASH",
    message: "现金不足，无法开工。"
  };
}

const job = startProductionJob(player, device.stage, item, {
  label: device.name,
  fee: quote.laborFee,
  feeAlreadyPaid: true,
  durationStage: device.durationStage,
  deviceId: device.id,
  deviceAttrs: device.attrs,
  workerId: worker.id,
  timeScale: wsSpeedTimeScale(worker) * devTimeScale,
  outputStage: device.outputStage,
  outputPreview: { materialStage: device.outputStage }
});
job.finishPlan = structuredClone(payload.finishPlan);
job.inlayQuote = quote;
job.reservedMaterials = reserve.reservedMaterials;
```

The non-finishing branches keep their current fee path. Every rejected finishing request leaves the input item and materials unchanged; the only rollback branch explicitly restores the paid labor.

- [ ] **Step 7: Apply success and confirmed failure semantics**

In `completeProductionJob`:

- grant XP and reduce durability before handling the finishing failure;
- use the existing device/worker shatter probability as the only finishing failure roll;
- on finishing failure:

```js
restoreWorkshopItem(player, job.item);
refundFinishMaterials(player, job.reservedMaterials);
return {
  text: `${job.item.name} 精加工失败，翡翠与镶嵌材料已退回`,
  item: null,
  shattered: true,
  refunded: true
};
```

- on success, replace fixed `1.2096` with `applyInlay` after existing craft adjustment;
- clear `reservedMaterials`;
- store `inlaid: true`, `polished: true`, and complete `inlay` metadata.

Opening and carving shatter behavior remains unchanged.

- [ ] **Step 8: Add the finish-plan modal**

In `public/workshop-module.js`:

- clicking start on a finishing device opens the modal instead of emitting immediately;
- render product type, setting, metal, gem, count, polish, backing, inventory, labor, and estimated multiplier;
- disable incompatible choices using `state.inlayCatalog` from the server snapshot;
- emit:

```js
socketRef.emit("startWorkshopJob", {
  deviceId,
  itemId,
  finishPlan,
  requestId: crypto.randomUUID()
});
```

Keep the desktop modal inside the viewport and use the existing visual language. Under 768px, stack controls vertically.

- [ ] **Step 9: Extend integration tests**

Add server assertions for:

- invalid combination;
- 13 gems;
- insufficient metal;
- insufficient gemstone;
- insufficient cash;
- no side effects for every rejection;
- successful reserve and completed metadata;
- forced finishing failure refunds jade and external materials;
- labor remains spent;
- durability decreases;
- worker receives XP;
- device remains one-job/no-queue.

- [ ] **Step 10: Verify inlay workflow**

Run:

```powershell
npm run test:inlay
npm run test:server-idle
npm test
```

Browser-check material purchase → finish plan → completion at 1280×720, 390×844, and 430×932.

- [ ] **Step 11: Commit the inlay loop**

```powershell
git add -- server/systems/inlay-system.js scripts/inlay-system-smoke.mjs server.js public/extra-module.js public/workshop-module.js public/styles.css package.json package-lock.json
git diff --cached --check
git commit -m "feat: complete finishing inlay inventory loop"
```

---

### Task 8: Surface Inlay Metadata Everywhere It Matters

**Files:**
- Create: `public/product-meta.js`
- Modify: `public/extra-module.js`
- Modify: `public/orders-module.js`
- Modify: `public/market-module.js`
- Modify: `public/styles.css`
- Modify: `scripts/simplified-flow-smoke.mjs`

**Interfaces:**
- Consumes: completed product `inlay` object from Task 7.
- Produces: a shared `inlaySummary(product)` formatter used by collection, order, and market cards.

- [ ] **Step 1: Add a failing static assertion**

In `scripts/simplified-flow-smoke.mjs`, load the three modules and assert each calls `inlaySummary`:

```js
const extraModule = readFileSync("public/extra-module.js", "utf8");
const ordersModule = readFileSync("public/orders-module.js", "utf8");
const marketModule = readFileSync("public/market-module.js", "utf8");

for (const [source, label] of [
  [extraModule, "collection"],
  [ordersModule, "orders"],
  [marketModule, "market"]
]) {
  if (!/inlaySummary\(/.test(source)) {
    throw new Error(`${label} should render finishing inlay metadata`);
  }
}
```

Run `npm run test:flow`.

Expected: failure.

- [ ] **Step 2: Add the shared formatter in its fixed module**

Create `public/product-meta.js`:

```js
export function inlaySummary(product) {
  const inlay = product?.inlay;
  if (!inlay) return "";
  const gem = inlay.gemCount > 0
    ? `${inlay.gemName}×${inlay.gemCount}`
    : "无配石";
  return [
    inlay.productTypeName,
    inlay.settingName,
    inlay.metalName || "无金属",
    gem,
    inlay.polishName,
    inlay.backingName
  ].filter(Boolean).join(" · ");
}
```

Import it in all three consumers with:

```js
import { inlaySummary } from "./product-meta.js";
```

- [ ] **Step 3: Render the summary in collection, orders, and market**

Add:

```html
<p class="inlay-summary">${escapeHtml(inlaySummary(product))}</p>
```

Only render the paragraph when the summary is non-empty. Do not alter existing price, grade, owner, or action controls.

- [ ] **Step 4: Add compact styling**

```css
.inlay-summary {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 5: Verify and commit metadata display**

Run:

```powershell
npm run test:flow
npm test
```

Browser-check a finished inlaid item in collection, an order picker, and a market listing at desktop and mobile widths.

Commit:

```powershell
git add -- public/product-meta.js public/extra-module.js public/orders-module.js public/market-module.js public/styles.css scripts/simplified-flow-smoke.mjs
git diff --cached --check
git commit -m "feat: show inlay details across selling flows"
```

---

### Task 9: Final End-to-End Regression and Handoff

**Files:**
- Modify: `README.md`
- Modify: `docs/reports/2026-07-24-desktop-mobile-qa.md`
- Modify: `docs/reports/2026-07-24-worktree-audit.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified completion evidence and the final actual change/disposition checklist requested by the user.

- [ ] **Step 1: Run the entire automated suite from a clean server state**

Run:

```powershell
npm test
```

Expected: every command exits `0`, including tasks, responsive, equipment, employee, and inlay tests.

- [ ] **Step 2: Run a desktop end-to-end browser pass**

At 1280×720:

1. enter auction and bid;
2. obtain or use a starter rough;
3. opening;
4. carving/plan;
5. buy a finishing material pack;
6. buy a second device;
7. recruit an employee;
8. finish with an inlay plan;
9. inspect collection metadata;
10. open order and market flows;
11. verify chat never covers actions;
12. verify the workshop third column remains visible.

Expected: no console errors or critical request failures.

- [ ] **Step 3: Run both mobile end-to-end passes**

Repeat the core flow at:

- 390×844;
- 430×932.

Expected: no inaccessible content, all primary controls at least 44px, modals fit the viewport, affairs/chat can collapse, and desktop-only composition does not leak into mobile.

- [ ] **Step 4: Reconfirm desktop composition**

Capture final 1280×720 and 1440×900 screenshots matching the Task 3 views. Compare outer-region position, order, typography, colors, and card language.

Expected: only approved overflow fixes and new content inside existing views are visible.

- [ ] **Step 5: Audit runtime and repository cleanliness**

Run:

```powershell
git status --short
git diff --check
rg -n "capacity:\s*[2-9]|capacity\s*=\s*[2-9]|waitingQueue|productionQueue|jobQueue" server public scripts
```

Expected:

- no unexplained paths;
- no whitespace errors;
- no device capacity above 1;
- no production queue implementation.

Update `docs/reports/2026-07-24-worktree-audit.md` with the final actual list:

- modified;
- created;
- restored;
- intentionally deleted;
- ignored local artifacts.

- [ ] **Step 6: Update README feature status**

Document:

- three-stage workshop;
- device capacity 1 and no queue;
- equipment purchase/durability/repair;
- employee recruitment/XP;
- material-backed finishing inlay;
- desktop and mobile supported viewports;
- test command;
- in-memory prototype limitation.

- [ ] **Step 7: Run verification once more after documentation edits**

```powershell
npm test
git diff --check
```

Expected: all tests pass and no formatting errors.

- [ ] **Step 8: Commit final verification evidence**

```powershell
git add -- README.md docs/reports/2026-07-24-desktop-mobile-qa.md docs/reports/2026-07-24-worktree-audit.md
git diff --cached --check
git commit -m "test: document desktop mobile and core-loop verification"
```

- [ ] **Step 9: Perform completion review**

Before claiming completion, use `superpowers:verification-before-completion`, inspect the latest `npm test` output, current `git status`, and both QA reports. Then use `superpowers:requesting-code-review` for the completed batch.

The user handoff must include:

- automated test result;
- desktop and mobile viewport result;
- commit list;
- exact actual file-change list;
- exact restored/deleted/ignored list;
- any remaining production-readiness limitations.

---

## Spec Coverage Map

| Approved design section | Implemented by |
|---|---|
| Test baseline | Task 1 |
| Evidence-backed workspace cleanup | Task 2 |
| Desktop composition unchanged; overflow fixed | Task 3 and Task 9 |
| 390×844 and 430×932 mobile core flow | Task 4 and Task 9 |
| Equipment purchase, capacity 1, no queue, durability, repair | Task 5 |
| Four starters, recruitment, roster 8, worker busy, XP, level 10 | Task 6 |
| Six settings, four metals, three gems, polish, backing | Task 7 |
| Atomic material/cash handling and request dedupe | Tasks 5–7 |
| Finishing failure returns jade and external materials; labor remains spent | Task 7 |
| Collection, orders, and market show inlay metadata | Task 8 |
| Full automated and browser verification | Task 9 |
| Final actual change/disposition checklist | Task 9 |
