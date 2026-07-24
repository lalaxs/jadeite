# 翡翠经营模拟手机版与工坊稳定性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变桌面端现有三栏排版的前提下，完成手机版左侧页签、稳定目标与弹窗渲染、独立套件规划、精加工渐进选材与裁切、夜间主题和统一员工详情。

**Architecture:** 保留当前原生 ES Modules 与 Socket.IO 架构，在 `767px` 手机断点内重排现有页面外壳。将精加工草稿规则与员工详情视图拆成两个可直接测试的纯模块；目标卡片、规划弹窗、精加工弹窗和招募详情分别建立稳定 DOM 生命周期，只在数据变化时局部更新。

**Tech Stack:** HTML5、CSS、原生 JavaScript ES Modules、Socket.IO 4、Node.js `assert` 冒烟测试、现有翡翠 SVG 裁切引擎。

## Global Constraints

- 新的手机版外壳仅在 `max-width: 767px` 生效。
- 桌面端现有三栏结构、栏目宽度和总体排版不得变化。
- 每台设备容量永久为 `1`，不允许配置为其他值。
- 忙碌设备不得接收第二个任务，也不得创建待生产队列。
- 不更换前端框架，不进行全站重写。
- 旧存档缺少裁切元数据时必须安全降级，且不得阻止存档加载。
- 所有功能修改遵循 TDD：先写失败测试、确认失败、最小实现、确认通过、再提交。
- 不提交 `.superpowers/brainstorm/` 下的视觉讨论文件。

---

## File Responsibility Map

- `public/index.html`
  - 提供手机资源按钮、现有资源容器、左侧底部“事项/消息”入口和稳定弹窗挂载点。
- `public/styles.css`
  - 保留桌面网格；仅在手机断点重排外壳，并承载夜间主题、规划/精加工/员工弹窗和裁切边界样式。
- `public/main.js`
  - 管理手机内容页签、资源浮层、稳定目标卡片、全局动作路由和统一裁切预览入口。
- `public/workshop-module.js`
  - 管理独立套件规划弹窗、稳定精加工弹窗、工坊员工详情模式和单设备开工入口。
- `public/finish-plan-model.js`（新建）
  - 纯函数：精加工草稿初始化、归一化、报价与库存/现金校验。
- `public/worker-detail-view.js`（新建）
  - 纯函数：九项技能、天赋说明和招募/工坊共用详情 HTML。
- `public/extra-module.js`
  - 渲染招募摘要卡，管理完整招募详情与确认状态。
- `public/jade-opening-engine.js`
  - 仅在复现证明引擎仍有越界时调整局部 viewBox/clipPath；不改变套件算法。
- `server.js`
  - 为开工和招募操作补充 Socket.IO acknowledgement，支持失败时保留弹窗。
- `scripts/*.mjs`
  - 增加稳定渲染、规划流程、精加工模型、共享员工详情和夜间主题回归检查。
- `package.json`
  - 将新增测试接入完整 `npm test`。

---

### Task 1: 手机版左侧页签与紧凑资源栏

**Files:**
- Modify: `public/index.html:13-29, 487-525`
- Modify: `public/main.js:128-205, 1175-1292`
- Modify: `public/styles.css:3692-3790`
- Modify: `scripts/responsive-layout-smoke.mjs`

**Interfaces:**
- Produces: `setMobileContentPane(name: "main" | "side" | "chat"): void`
- Produces: `setMobileResourcesOpen(open: boolean): void`
- Produces: DOM ids `mobileResourcesToggle`, `sidePanelToggle`, `chatDockToggle`
- Preserves: desktop `.shell` grid and existing `#topHud`, `#sidePanel`, `#chatDock`

- [ ] **Step 1: 扩展响应式失败测试**

在 `scripts/responsive-layout-smoke.mjs` 末尾、现有成功日志之前加入：

```js
assert.match(html, /id="mobileResourcesToggle"/);
assert.match(html, /class="mobile-utility-tabs"/);
assert.match(css, /\.shell\[data-mobile-pane="side"\]/);
assert.match(css, /\.shell\[data-mobile-pane="chat"\]/);
assert.match(css, /grid-template-columns:\s*66px\s+minmax\(0,\s*1fr\)/);
assert.match(css, /height:\s*100dvh/);
assert.match(main, /function setMobileContentPane\b/);
assert.match(main, /function setMobileResourcesOpen\b/);
assert.match(main, /mobileResourcesToggle/);
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
npm run test:responsive
```

Expected: FAIL，首个缺失项为 `mobileResourcesToggle`。

- [ ] **Step 3: 添加静态手机入口，不改变桌面 DOM 职责**

将 `public/index.html` 顶栏和侧栏调整为：

```html
<header class="topbar">
  <div class="player-card" id="playerCard" aria-label="掌柜信息"></div>
  <button
    id="mobileResourcesToggle"
    class="mobile-resources-toggle"
    type="button"
    aria-controls="topHud"
    aria-expanded="false"
  >资源</button>
  <div class="top-hud" id="topHud" aria-label="资源信息"></div>
  <div class="topbar-right">
    <button class="theme-toggle" id="themeToggle" type="button" title="切换昼夜模式" aria-label="切换昼夜模式"></button>
  </div>
</header>

<aside class="sidebar">
  <nav class="main-nav" id="mainNav" aria-label="功能导航"></nav>
  <nav class="mobile-utility-tabs" aria-label="移动端事项与消息">
    <button id="sidePanelToggle" class="mobile-panel-toggle" type="button"
      aria-controls="sidePanel" aria-expanded="false">事项</button>
    <button id="chatDockToggle" class="mobile-panel-toggle" type="button"
      aria-controls="chatDock" aria-expanded="false">消息</button>
  </nav>
</aside>
```

删除文件末尾旧的独立 `<nav class="mobile-dock-controls">`，避免出现两套手机入口。

- [ ] **Step 4: 实现手机内容页签与资源浮层状态**

在 `public/main.js` 的 `els` 中增加：

```js
shell: document.querySelector(".shell"),
mobileResourcesToggle: document.querySelector("#mobileResourcesToggle"),
```

用以下函数替换旧 `toggleMobilePanel()`：

```js
let mobileContentPane = "main";

function setMobileResourcesOpen(open) {
  const expanded = Boolean(open) && window.matchMedia("(max-width: 767px)").matches;
  els.topHud?.classList.toggle("is-mobile-open", expanded);
  els.mobileResourcesToggle?.setAttribute("aria-expanded", String(expanded));
}

function setMobileContentPane(name = "main") {
  const next = ["main", "side", "chat"].includes(name) ? name : "main";
  mobileContentPane = next;
  els.shell?.setAttribute("data-mobile-pane", next);
  els.sidePanelToggle?.setAttribute("aria-expanded", String(next === "side"));
  els.chatDockToggle?.setAttribute("aria-expanded", String(next === "chat"));
  setMobileResourcesOpen(false);
}

function toggleMobilePanel(targetName) {
  const next = targetName === "side" ? "side" : "chat";
  setMobileContentPane(mobileContentPane === next ? "main" : next);
}

function closeMobileTransientUi() {
  setMobileResourcesOpen(false);
  setMobileContentPane("main");
}
```

在 `initShell()` 中加入：

```js
els.mobileResourcesToggle?.addEventListener("click", () => {
  const open = els.mobileResourcesToggle.getAttribute("aria-expanded") !== "true";
  setMobileResourcesOpen(open);
});

document.addEventListener("pointerdown", (event) => {
  if (
    els.topHud?.classList.contains("is-mobile-open")
    && !els.topHud.contains(event.target)
    && !els.mobileResourcesToggle?.contains(event.target)
  ) {
    setMobileResourcesOpen(false);
  }
});

window.addEventListener("popstate", closeMobileTransientUi);
```

在 `setView(view)` 开始处加入 `setMobileContentPane("main");`。将键盘处理补为：

```js
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  setMobileResourcesOpen(false);
  if (els.modalRoot && !els.modalRoot.hidden) closeGameModal();
});
```

在 `(min-width: 768px)` 媒体变化处理内调用 `closeMobileTransientUi()`。

- [ ] **Step 5: 添加仅手机生效的两列外壳**

在 `public/styles.css` 的 `@media (max-width: 767px)` 内使用：

```css
.shell {
  display: grid;
  grid-template-columns: 66px minmax(0, 1fr);
  grid-template-rows: 52px minmax(0, 1fr);
  width: 100%;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
}

.sidebar {
  grid-column: 1;
  grid-row: 1 / -1;
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-height: none;
  padding: max(8px, env(safe-area-inset-top)) 5px max(8px, env(safe-area-inset-bottom));
  overflow: hidden;
}

.main-nav {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  flex-wrap: nowrap;
  gap: 3px;
  overflow: auto;
}

.main-nav-item,
.mobile-panel-toggle {
  min-width: 0;
  min-height: 44px;
  padding: 6px 3px;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  font-size: 10px;
  text-align: center;
}

.mobile-utility-tabs {
  display: grid;
  flex: 0 0 auto;
  gap: 4px;
  padding-top: 6px;
  border-top: 1px solid var(--line);
}

.topbar {
  grid-column: 2;
  grid-row: 1;
  position: relative;
  z-index: 30;
  min-width: 0;
  height: 52px;
  padding: 5px 8px;
  gap: 6px;
}

.topbar .player-card {
  min-width: 0;
  flex: 1 1 auto;
  height: 42px;
  padding: 4px 7px;
}

.topbar .player-card .exp {
  display: none;
}

.mobile-resources-toggle {
  display: inline-flex;
  min-height: 40px;
  padding: 0 10px;
}

.topbar .top-hud {
  display: none;
  position: absolute;
  z-index: 40;
  top: calc(100% + 4px);
  left: 8px;
  right: 8px;
  max-height: min(70dvh, 520px);
  padding: 10px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--panel);
  box-shadow: 0 18px 42px rgba(0, 0, 0, .28);
}

.topbar .top-hud.is-mobile-open {
  display: flex;
}

.topbar .top-hud.is-mobile-open .hud-stat {
  flex: 1 1 min(140px, 100%);
  height: 56px;
}

.main-stage,
.sidepanel,
.chatdock {
  grid-column: 2;
  grid-row: 2;
  min-width: 0;
  min-height: 0;
}

.main-stage {
  padding: 12px;
  overflow: auto;
  overscroll-behavior: contain;
}

.sidepanel,
.chatdock {
  display: none;
  position: static;
  width: auto;
  height: auto;
  max-height: none;
  padding: 10px;
  overflow: auto;
}

.shell[data-mobile-pane="side"] .main-stage,
.shell[data-mobile-pane="chat"] .main-stage {
  display: none;
}

.shell[data-mobile-pane="side"] .sidepanel,
.shell[data-mobile-pane="chat"] .chatdock {
  display: block;
}
```

在手机媒体查询外保留：

```css
.mobile-resources-toggle,
.mobile-utility-tabs {
  display: none;
}
```

- [ ] **Step 6: 运行响应式回归测试**

Run:

```powershell
npm run test:responsive
```

Expected: PASS，输出 `responsive-layout-smoke: desktop guards ok`。

- [ ] **Step 7: 提交手机版外壳**

```powershell
git add public/index.html public/main.js public/styles.css scripts/responsive-layout-smoke.mjs
git commit -m "feat: add compact mobile navigation shell"
```

---

### Task 2: 当前目标稳定节点与入场动画边界

**Files:**
- Modify: `public/main.js:1476-1543`
- Modify: `public/styles.css`（`.goal-card` 动画规则）
- Create: `scripts/ui-stability-smoke.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `currentGoalViewModel(): { id, title, desc, progressText, pct, done }`
- Produces: `ensureOverviewStatusShell(): { goalSlot, ranksSlot, rowsSlot }`
- Produces: `patchCurrentGoal(goalSlot, model): void`

- [ ] **Step 1: 写目标节点稳定性失败测试**

创建 `scripts/ui-stability-smoke.mjs`：

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync("public/main.js", "utf8");
const styles = readFileSync("public/styles.css", "utf8");

assert.match(main, /function currentGoalViewModel\b/);
assert.match(main, /function ensureOverviewStatusShell\b/);
assert.match(main, /function patchCurrentGoal\b/);
assert.match(main, /data-overview-slot="goal"/);
assert.doesNotMatch(
  main.match(/function renderOverview\(\)[\s\S]*?\n}\n\n\/\/ ===== 目标/)?.[0] || "",
  /homeStatusPane\.innerHTML\s*=/
);
assert.match(styles, /\.goal-card\.is-entering/);
assert.match(styles, /prefers-reduced-motion:\s*reduce/);

console.log("ui-stability-smoke: stable overview guards ok");
```

在 `package.json` 中加入：

```json
"test:ui-stability": "node scripts/ui-stability-smoke.mjs"
```

并在总 `test` 命令的 `test:ui` 后加入 `&& npm run test:ui-stability`。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
npm run test:ui-stability
```

Expected: FAIL，提示缺少 `currentGoalViewModel`。

- [ ] **Step 3: 建立一次性状态页外壳**

在 `public/main.js` 中加入：

```js
function ensureOverviewStatusShell() {
  if (!els.homeStatusPane) return {};
  let goalSlot = els.homeStatusPane.querySelector('[data-overview-slot="goal"]');
  if (!goalSlot) {
    els.homeStatusPane.innerHTML = `
      <div data-overview-slot="goal"></div>
      <h1 class="status-title">状态</h1>
      <div class="rank-pills" data-overview-slot="ranks"></div>
      <div class="status-rows" data-overview-slot="rows"></div>
    `;
    goalSlot = els.homeStatusPane.querySelector('[data-overview-slot="goal"]');
  }
  return {
    goalSlot,
    ranksSlot: els.homeStatusPane.querySelector('[data-overview-slot="ranks"]'),
    rowsSlot: els.homeStatusPane.querySelector('[data-overview-slot="rows"]')
  };
}
```

- [ ] **Step 4: 将目标计算和节点更新分离**

用以下模型与更新函数替代 `currentGoalHtml()` 的直接整卡重建用途：

```js
function currentGoalViewModel() {
  const { me } = state;
  const next = GOALS.find((goal) => Math.min(goal.target, goal.prog(me)) < goal.target);
  if (!next) {
    return {
      id: "all-done",
      title: "全部达成",
      desc: "江湖路远，去公盘再淘块好料吧！",
      progressText: "",
      pct: 100,
      done: true
    };
  }
  const current = Math.min(next.target, next.prog(me));
  const pct = Math.round(current / next.target * 100);
  return {
    id: next.id,
    title: next.title,
    desc: next.desc,
    progressText: `${goalFmt(next, current)} · ${pct}%`,
    pct,
    done: false
  };
}

function goalCardHtml(model) {
  return `
    <div class="goal-card is-entering ${model.done ? "is-done" : ""}">
      <div class="goal-head"><span class="goal-label">当前目标</span><b data-goal-title>${escapeHtml(model.title)}</b></div>
      <div class="goal-desc" data-goal-desc>${escapeHtml(model.desc)}</div>
      <div class="goal-bar" ${model.done ? "hidden" : ""}><i data-goal-bar style="width:${model.pct}%"></i></div>
      <div class="goal-prog" data-goal-progress ${model.done ? "hidden" : ""}>${escapeHtml(model.progressText)}</div>
    </div>
  `;
}

function patchCurrentGoal(goalSlot, model) {
  if (!goalSlot) return;
  const currentId = goalSlot.dataset.goalId;
  if (currentId !== model.id || !goalSlot.querySelector(".goal-card")) {
    goalSlot.dataset.goalId = model.id;
    goalSlot.innerHTML = goalCardHtml(model);
    goalSlot.querySelector(".goal-card")?.addEventListener("animationend", (event) => {
      event.currentTarget.classList.remove("is-entering");
    }, { once: true });
    return;
  }
  const card = goalSlot.querySelector(".goal-card");
  card.classList.toggle("is-done", model.done);
  card.querySelector("[data-goal-title]").textContent = model.title;
  card.querySelector("[data-goal-desc]").textContent = model.desc;
  const bar = card.querySelector(".goal-bar");
  const progress = card.querySelector("[data-goal-progress]");
  bar.hidden = model.done;
  progress.hidden = model.done;
  card.querySelector("[data-goal-bar]").style.width = `${model.pct}%`;
  progress.textContent = model.progressText;
}
```

- [ ] **Step 5: 改写 `renderOverview()` 的状态页部分**

将原 `homeStatusPane.innerHTML = ...` 替换为：

```js
const { goalSlot, ranksSlot, rowsSlot } = ensureOverviewStatusShell();
patchCurrentGoal(goalSlot, currentGoalViewModel());
ranksSlot.innerHTML = rankBoards.map((board) =>
  `<span class="rank-pill">${escapeHtml(board.label)} 第 ${myRankFor(board.id) ?? "—"} 名</span>`
).join("");
rowsSlot.innerHTML = statusRows().join("");
```

任务、委托、账单与消息渲染保持现状。

- [ ] **Step 6: 限制目标动画并支持减少动态效果**

将 `.goal-card` 上的无条件动画移动为：

```css
.goal-card.is-entering {
  animation: cardIn .45s ease both;
}

@media (prefers-reduced-motion: reduce) {
  .goal-card.is-entering,
  .ws-picker-overlay,
  .ws-picker-modal,
  .game-modal {
    animation: none !important;
    transition: none !important;
  }
}
```

- [ ] **Step 7: 运行稳定性与界面测试**

Run:

```powershell
npm run test:ui-stability
npm run test:ui
```

Expected: 两项均 PASS。

- [ ] **Step 8: 提交目标稳定性修复**

```powershell
git add public/main.js public/styles.css scripts/ui-stability-smoke.mjs package.json
git commit -m "fix: keep current goal card stable across state updates"
```

---

### Task 3: 独立套件规划步骤与稳定规划弹窗

**Files:**
- Modify: `public/workshop-module.js:470-729, 914-1000`
- Modify: `public/main.js:1061-1169, 1667-1728, 1880-1945, 2050-2061`
- Modify: `public/styles.css:3295-3590`
- Create: `scripts/workshop-planner-ui-smoke.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `workshopOpenPlanner(payload?: string): void`
- Produces: `workshopClosePlanner(commit?: boolean): void`
- Produces: `workshopRefreshPlanner(roughId: string): void`
- Consumes: existing `roughKits`, `kitsFor`, `roughBoard`, `roughPlannerControls`, `placementAnalysisRows`
- Preserves: `.workshop-recipe-main` 的三个桌面列

- [ ] **Step 1: 写规划步骤失败测试**

创建 `scripts/workshop-planner-ui-smoke.mjs`：

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workshop = readFileSync("public/workshop-module.js", "utf8");
const main = readFileSync("public/main.js", "utf8");
const styles = readFileSync("public/styles.css", "utf8");

assert.match(workshop, /function buildPlannerShell\b/);
assert.match(workshop, /export function workshopOpenPlanner\b/);
assert.match(workshop, /export function workshopClosePlanner\b/);
assert.match(workshop, /export function workshopRefreshPlanner\b/);
assert.match(workshop, /class="wrs-plan-step/);
assert.doesNotMatch(
  workshop.match(/export function workshopRecipeSummary[\s\S]*?\n}\n/)?.[0] || "",
  /roughBoard\(selected\)\s*\+\s*roughPlannerControls/
);
assert.match(main, /openWorkshopPlanner/);
assert.match(styles, /\.ws-planner-modal/);
assert.match(styles, /@media \(max-width: 767px\)[\s\S]*\.ws-planner-modal[\s\S]*100dvh/);

console.log("workshop-planner-ui-smoke: independent planning step ok");
```

将其接入 `package.json`：

```json
"test:workshop-planner-ui": "node scripts/workshop-planner-ui-smoke.mjs"
```

并在总 `test` 的 `test:equipment` 后加入该脚本。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
npm run test:workshop-planner-ui
```

Expected: FAIL，提示缺少 `buildPlannerShell`。

- [ ] **Step 3: 将内嵌画布替换为明确规划步骤**

在 `workshopRecipeSummary(device, selected)` 中计算：

```js
const planReady = device.stage !== "carving" || kits.length > 0;
const planStep = device.stage === "carving" ? `
  <div class="wrs-plan-step ${planReady ? "is-ready" : "is-pending"}">
    <div>
      <span>步骤 2 · 规划套件</span>
      <strong>${planReady ? `已规划 ${kits.length} 件` : "尚未规划"}</strong>
      <p>${planReady ? "点击查看或修改石头与套件布局。" : "先选择石头，再进入规划画布。"}</p>
    </div>
    <button
      class="${planReady ? "secondary" : "primary"}"
      data-action="openWorkshopPlanner"
      data-payload="${device.id}"
      type="button"
    >${planReady ? "查看 / 修改规划" : "规划套件"}</button>
  </div>
` : "";
```

在汇总 HTML 中插入 `${planStep}`，删除：

```js
${device.stage === "carving" ? roughBoard(selected) + roughPlannerControls(selected) + placementAnalysisRows(selected, kits) : ""}
```

三个桌面列仍为：石头卡、员工卡、汇总卡。

- [ ] **Step 4: 建立只挂载一次的规划弹窗**

在 `public/workshop-module.js` 加入：

```js
let activeKitPlanner = null;

function plannerRootEl() {
  let root = document.getElementById("ws-planner-root");
  if (root) return root;
  root = document.createElement("div");
  root.id = "ws-planner-root";
  root.className = "ws-picker-overlay";
  root.addEventListener("click", (event) => {
    if (event.target === root || event.target.closest('[data-planner-action="cancel"]')) {
      workshopClosePlanner(false);
      return;
    }
    if (event.target.closest('[data-planner-action="confirm"]')) {
      workshopClosePlanner(true);
    }
  });
  document.body.appendChild(root);
  return root;
}

function buildPlannerShell(device, item) {
  return `
    <section class="ws-planner-modal" role="dialog" aria-modal="true" aria-label="规划套件">
      <header class="ws-picker-head">
        <div class="wsp-head-text">
          <h3>规划套件</h3>
          <p>${escapeHtml(item.name)} · ${escapeHtml(device.name)}</p>
        </div>
        <button class="ws-picker-close" data-planner-action="cancel" type="button" aria-label="关闭">×</button>
      </header>
      <div class="ws-planner-body" data-planner-body></div>
      <footer class="game-modal-actions">
        <button class="secondary" data-planner-action="cancel" type="button">取消</button>
        <button class="primary" data-planner-action="confirm" type="button">确认规划</button>
      </footer>
    </section>
  `;
}

export function workshopOpenPlanner(payload) {
  const deviceId = payload || activeWorkshopDeviceId;
  const device = workshopDevices().find((entry) => entry.id === deviceId);
  if (!device || device.stage !== "carving") {
    showToast("请先选择需要规划的石头。");
    return;
  }
  const item = workshopProcessableItems(device).find((entry) => entry.id === selectedWorkshopItemId);
  if (!item) {
    showToast("请先选择需要规划的石头。");
    return;
  }
  activeKitPlanner = {
    deviceId,
    itemId: item.id,
    originalKits: structuredClone(kitsFor(item.id))
  };
  const root = plannerRootEl();
  root.innerHTML = buildPlannerShell(device, item);
  workshopRefreshPlanner(item.id);
}

export function workshopRefreshPlanner(roughId) {
  if (!activeKitPlanner || activeKitPlanner.itemId !== roughId) return;
  const item = workshopStageItems().find((entry) => entry.id === roughId);
  const body = document.querySelector("#ws-planner-root [data-planner-body]");
  if (!item) {
    activeKitPlanner = null;
    document.getElementById("ws-planner-root")?.remove();
    return;
  }
  if (!body) return;
  const kits = kitsFor(roughId);
  body.innerHTML = `
    <div class="ws-planner-canvas">${roughBoard(item)}</div>
    <div class="ws-planner-tools">
      ${roughPlannerControls(item)}
      ${placementAnalysisRows(item, kits)}
    </div>
  `;
  paintJades();
}

export function workshopClosePlanner(commit = false) {
  if (!activeKitPlanner) return;
  if (!commit) {
    roughKits.set(activeKitPlanner.itemId, structuredClone(activeKitPlanner.originalKits));
  }
  activeKitPlanner = null;
  document.getElementById("ws-planner-root")?.remove();
  renderWorkshop();
}
```

在 `renderWorkshop()` 的现有工坊页面更新完成后加入：

```js
if (activeKitPlanner) workshopRefreshPlanner(activeKitPlanner.itemId);
```

它只更新 `[data-planner-body]`，不得替换 `#ws-planner-root` 或 `.ws-planner-modal`。

- [ ] **Step 5: 将套件编辑刷新导向规划弹窗**

在 `public/main.js` 的工坊导入列表加入 `workshopRefreshPlanner`、`workshopOpenPlanner`、`workshopClosePlanner`。

添加：

```js
function refreshOpeningPlanUi(roughId) {
  workshopRefreshPlanner(roughId);
  if (!document.getElementById("ws-planner-root")) renderWorkshop();
  paintJades();
}
```

将 `addRoughKit()`、`clearRoughKits()`、`moveRoughKit()` 尾部的：

```js
renderWorkshop();
paintJades();
```

替换为：

```js
refreshOpeningPlanUi(roughId);
```

在动作路由加入：

```js
if (action === "openWorkshopPlanner") { workshopOpenPlanner(payload); return; }
if (action === "closeWorkshopPlanner") { workshopClosePlanner(false); return; }
```

- [ ] **Step 6: 更换石头时使旧规划失效**

在 `workshopSelectItem(payload)` 中，在覆盖 `selectedWorkshopItemId` 前加入：

```js
const previousItemId = selectedWorkshopItemId;
const device = workshopDevices().find((entry) => entry.id === activeWorkshopDeviceId);
if (device?.stage === "carving" && previousItemId && previousItemId !== payload) {
  roughKits.delete(previousItemId);
}
```

不要在员工选择或推荐员工路径中清除 `roughKits`。

- [ ] **Step 7: 添加规划弹窗响应式样式**

```css
.ws-planner-modal {
  width: min(1180px, 100%);
  max-height: 92dvh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line);
  border-top: 3px solid var(--jade);
  border-radius: var(--r-md);
  background: var(--panel);
  overflow: hidden;
  box-shadow: 0 26px 64px rgba(0, 0, 0, .34);
}

.ws-planner-body {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(300px, .75fr);
  gap: 18px;
  min-height: 0;
  padding: 0 22px 18px;
  overflow: auto;
}

.ws-planner-canvas,
.ws-planner-tools {
  min-width: 0;
}

.wrs-plan-step {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--surface-2, var(--panel));
}

@media (max-width: 767px) {
  #ws-planner-root {
    left: 66px;
    padding: 0;
  }

  .ws-planner-modal {
    width: 100%;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
  }

  .ws-planner-body {
    grid-template-columns: 1fr;
    padding: 10px;
  }

  .ws-planner-modal .game-modal-actions {
    padding-bottom: max(12px, env(safe-area-inset-bottom));
  }
}
```

- [ ] **Step 8: 运行规划、设备和流程测试**

Run:

```powershell
npm run test:workshop-planner-ui
npm run test:equipment
npm run test:flow
```

Expected: 三项均 PASS；设备测试继续证明容量为 `1` 且无等待队列。

- [ ] **Step 9: 提交独立规划流程**

```powershell
git add public/workshop-module.js public/main.js public/styles.css scripts/workshop-planner-ui-smoke.mjs package.json
git commit -m "feat: add dedicated workshop kit planning step"
```

---

### Task 4: 可测试的精加工方案草稿模型

**Files:**
- Create: `public/finish-plan-model.js`
- Create: `scripts/finish-plan-model-smoke.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `createFinishPlanDraft(shape, catalog): FinishPlanDraft`
- Produces: `normalizeFinishPlanDraft(shape, draft, catalog): FinishPlanDraft`
- Produces: `quoteFinishPlanDraft(draft, catalog): FinishQuote | null`
- Produces: `validateFinishPlanDraft({ shape, draft, catalog, materials, cash }): FinishValidation`

- [ ] **Step 1: 写精加工模型失败测试**

创建 `scripts/finish-plan-model-smoke.mjs`：

```js
import assert from "node:assert/strict";
import {
  createFinishPlanDraft,
  normalizeFinishPlanDraft,
  quoteFinishPlanDraft,
  validateFinishPlanDraft
} from "../public/finish-plan-model.js";

const catalog = {
  productTypes: { cabochon: ["ring"] },
  shapeSettings: { cabochon: ["claw"] },
  productTypeNames: { ring: "戒指" },
  settings: { claw: { name: "爪镶", metals: ["gold18k", "silver925"], grams: 3, labor: 600 } },
  metals: { gold18k: "18K 金", silver925: "925 银" },
  metalValues: { gold18k: .2, silver925: .08 },
  gems: { diamond: "钻石", ruby: "红宝石" },
  polishes: { bright: { labor: 100, value: .1 } },
  polishNames: { bright: "亮光" },
  backings: { open: { labor: 0, value: 0 } },
  backingNames: { open: "开放底托" }
};

const draft = createFinishPlanDraft("cabochon", catalog);
assert.equal(draft.metalId, null, "metal type must be chosen explicitly");
assert.equal(draft.gemId, null);
assert.equal(draft.gemCount, 0);

draft.gemId = "diamond";
normalizeFinishPlanDraft("cabochon", draft, catalog);
assert.equal(draft.gemId, "diamond", "choosing a gem must not be erased while count is zero");
assert.equal(draft.gemCount, 1, "a selected gem starts at one");

draft.metalId = "gold18k";
const quote = quoteFinishPlanDraft(draft, catalog);
assert.equal(quote.metalAmount, 3.15);
assert.equal(quote.gemCount, 1);

const valid = validateFinishPlanDraft({
  shape: "cabochon",
  draft,
  catalog,
  materials: { gold18k: 10, diamond: 4 },
  cash: 5000
});
assert.equal(valid.canStart, true);
assert.equal(valid.showMetalInventory, true);
assert.equal(valid.showGemInventory, true);

const missingType = validateFinishPlanDraft({
  shape: "cabochon",
  draft: { ...draft, metalId: null },
  catalog,
  materials: {},
  cash: 5000
});
assert.equal(missingType.canStart, false);
assert.ok(missingType.reasons.includes("请选择金属种类"));

console.log("finish-plan-model-smoke: progressive material selection ok");
```

在 `package.json` 加入：

```json
"test:finish-plan-model": "node scripts/finish-plan-model-smoke.mjs"
```

并在总 `test` 的 `test:inlay` 后加入它。

- [ ] **Step 2: 运行测试并确认模块不存在**

Run:

```powershell
npm run test:finish-plan-model
```

Expected: FAIL，`ERR_MODULE_NOT_FOUND` 指向 `public/finish-plan-model.js`。

- [ ] **Step 3: 实现纯草稿模型**

创建 `public/finish-plan-model.js`：

```js
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export function createFinishPlanDraft(shape, catalog) {
  const productType = catalog.productTypes?.[shape]?.[0] || null;
  const settingId = catalog.shapeSettings?.[shape]?.[0] || null;
  return normalizeFinishPlanDraft(shape, {
    productType,
    settingId,
    metalId: null,
    gemId: null,
    gemCount: 0,
    polishId: Object.keys(catalog.polishes || {})[0] || "bright",
    backingId: shape === "cabochon" && productType === "ring" ? "open" : null
  }, catalog);
}

export function normalizeFinishPlanDraft(shape, draft, catalog) {
  const productTypes = catalog.productTypes?.[shape] || [];
  const settings = catalog.shapeSettings?.[shape] || [];
  if (!productTypes.includes(draft.productType)) draft.productType = productTypes[0] || null;
  if (!settings.includes(draft.settingId)) draft.settingId = settings[0] || null;

  const allowedMetals = catalog.settings?.[draft.settingId]?.metals || [];
  if (draft.metalId && !allowedMetals.includes(draft.metalId)) draft.metalId = null;

  if (draft.gemId && !catalog.gems?.[draft.gemId]) draft.gemId = null;
  draft.gemCount = draft.gemId
    ? clamp(Math.round(Number(draft.gemCount) || 1), 1, 12)
    : 0;

  if (!catalog.polishes?.[draft.polishId]) {
    draft.polishId = Object.keys(catalog.polishes || {})[0] || null;
  }

  const backingAllowed = shape === "cabochon" && draft.productType === "ring";
  draft.backingId = backingAllowed && catalog.backings?.[draft.backingId]
    ? draft.backingId
    : backingAllowed ? "open" : null;
  return draft;
}

export function quoteFinishPlanDraft(draft, catalog) {
  const setting = catalog.settings?.[draft.settingId];
  const polish = catalog.polishes?.[draft.polishId];
  const backing = draft.backingId ? catalog.backings?.[draft.backingId] : { labor: 0, value: 0 };
  if (!setting || !polish || !backing) return null;
  const metalAmount = draft.metalId
    ? Number((Number(setting.grams || 0) * (1 + Number(draft.gemCount || 0) * .05)).toFixed(2))
    : 0;
  return {
    metalId: draft.metalId,
    metalAmount,
    gemId: draft.gemId,
    gemCount: Number(draft.gemCount || 0),
    laborFee: Number(setting.labor || 0)
      + Number(draft.gemCount || 0) * 80
      + Number(polish.labor || 0)
      + Number(backing.labor || 0),
    valueMultiplier: Number((
      1
      + Number(draft.metalId ? catalog.metalValues?.[draft.metalId] || 0 : 0)
      + Number(draft.gemCount || 0) * .05
      + Number(polish.value || 0)
      + Number(backing.value || 0)
    ).toFixed(2))
  };
}

export function validateFinishPlanDraft({ shape, draft, catalog, materials = {}, cash = 0 }) {
  normalizeFinishPlanDraft(shape, draft, catalog);
  const quote = quoteFinishPlanDraft(draft, catalog);
  const reasons = [];
  const allowedMetals = catalog.settings?.[draft.settingId]?.metals || [];
  if (allowedMetals.length && !draft.metalId) reasons.push("请选择金属种类");
  if (draft.gemId && draft.gemCount < 1) reasons.push("请选择配石数量");

  const metalHeld = draft.metalId ? Number(materials[draft.metalId] || 0) : 0;
  const gemHeld = draft.gemId ? Number(materials[draft.gemId] || 0) : 0;
  if (quote && draft.metalId && metalHeld < quote.metalAmount) reasons.push("金属库存不足");
  if (quote && draft.gemId && gemHeld < quote.gemCount) reasons.push("配石库存不足");
  if (quote && Number(cash || 0) < quote.laborFee) reasons.push("现金不足");
  if (!quote) reasons.push("当前方案无法报价");

  return {
    quote,
    reasons,
    canStart: reasons.length === 0,
    metalHeld,
    gemHeld,
    showMetalInventory: Boolean(draft.metalId),
    showGemInventory: Boolean(draft.gemId)
  };
}
```

- [ ] **Step 4: 运行模型测试**

Run:

```powershell
npm run test:finish-plan-model
```

Expected: PASS，输出 `finish-plan-model-smoke: progressive material selection ok`。

- [ ] **Step 5: 提交精加工模型**

```powershell
git add public/finish-plan-model.js scripts/finish-plan-model-smoke.mjs package.json
git commit -m "feat: add progressive finishing plan model"
```

---

### Task 5: 稳定精加工弹窗、渐进库存与失败保留

**Files:**
- Modify: `public/workshop-module.js:1-24, 1015-1243`
- Modify: `public/styles.css`（精加工弹窗区域）
- Modify: `server.js:2740-2763`
- Modify: `scripts/ui-stability-smoke.mjs`

**Interfaces:**
- Consumes: Task 4 的四个精加工模型函数
- Produces: `mountFinishPlanShell(): HTMLElement`
- Produces: `patchFinishPlanModal(): void`
- Produces: acknowledgement `{ ok: boolean, message: string, requestId?: string }`

- [ ] **Step 1: 扩展弹窗稳定性失败测试**

在 `scripts/ui-stability-smoke.mjs` 加入：

```js
const workshop = readFileSync("public/workshop-module.js", "utf8");
const server = readFileSync("server.js", "utf8");

assert.match(workshop, /function mountFinishPlanShell\b/);
assert.match(workshop, /function patchFinishPlanModal\b/);
assert.doesNotMatch(
  workshop.match(/export function renderWorkshop\(\)[\s\S]*?\n}\n/)?.[0] || "",
  /renderFinishPlanModal/
);
assert.doesNotMatch(
  workshop.match(/function patchFinishPlanModal\(\)[\s\S]*?\n}\n/)?.[0] || "",
  /root\.innerHTML\s*=/
);
assert.match(workshop, /data-finish-stock="metal"/);
assert.match(workshop, /data-finish-stock="gem"/);
assert.match(server, /socket\.on\("startWorkshopJob",\s*\(payload = \{\}, acknowledge\)/);
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
npm run test:ui-stability
npm run test:server-idle
```

Expected: 至少 `test:ui-stability` 因缺少 `mountFinishPlanShell` 失败。

- [ ] **Step 3: 接入纯模型并停止整窗重建**

在 `public/workshop-module.js` 顶部加入：

```js
import {
  createFinishPlanDraft,
  normalizeFinishPlanDraft,
  validateFinishPlanDraft
} from "./finish-plan-model.js";
```

删除本文件旧 `defaultFinishPlan`、`normalizeFinishPlan` 和 `quoteFinishPlanForClient`。将 `openFinishPlanModal()` 改为：

```js
function openFinishPlanModal(device, item, workerId) {
  const shape = finishItemShape(item);
  activeFinishPlanModal = {
    deviceId: device.id,
    itemId: item.id,
    workerId,
    shape,
    draft: createFinishPlanDraft(shape, finishCatalog()),
    submitting: false,
    error: ""
  };
  mountFinishPlanShell();
  patchFinishPlanModal();
}
```

从 `renderWorkshop()` 删除：

```js
if (activeFinishPlanModal) renderFinishPlanModal();
```

改为：

```js
if (activeFinishPlanModal) patchFinishPlanModal();
```

- [ ] **Step 4: 一次创建精加工弹窗外壳**

实现：

```js
function mountFinishPlanShell() {
  const root = finishRootEl();
  root.innerHTML = `
    <section class="game-modal finish-plan-modal" role="dialog" aria-modal="true" aria-label="精加工方案">
      <header class="game-modal-head">
        <div class="game-modal-title">
          <h3>制定精加工方案</h3>
          <p data-finish-item-title></p>
        </div>
        <button class="modal-close" data-finish-action="close" type="button" aria-label="关闭">×</button>
      </header>
      <div class="game-modal-body">
        <div class="finish-plan-grid">
          <label class="finish-plan-field"><span>成品类型</span><select data-finish-field="productType"></select></label>
          <label class="finish-plan-field"><span>镶嵌方式</span><select data-finish-field="settingId"></select></label>
          <label class="finish-plan-field"><span>金属</span><select data-finish-field="metalId"></select></label>
          <div class="finish-plan-stock" data-finish-stock="metal" hidden></div>
          <label class="finish-plan-field"><span>抛光</span><select data-finish-field="polishId"></select></label>
          <label class="finish-plan-field"><span>配石</span><select data-finish-field="gemId"></select></label>
          <label class="finish-plan-field" data-finish-count="gem" hidden>
            <span>配石数量</span>
            <input data-finish-field="gemCount" type="number" min="1" max="12" step="1">
          </label>
          <div class="finish-plan-stock" data-finish-stock="gem" hidden></div>
          <label class="finish-plan-field" data-finish-backing hidden>
            <span>底托</span><select data-finish-field="backingId"></select>
          </label>
        </div>
        <div class="finish-plan-summary">
          <div><span>人工费</span><strong data-finish-summary="labor"></strong></div>
          <div><span>成品价值倍率</span><strong class="pos" data-finish-summary="value"></strong></div>
        </div>
        <p class="finish-plan-warning" data-finish-warning hidden></p>
      </div>
      <footer class="game-modal-actions">
        <button class="secondary" data-finish-action="close" type="button">取消</button>
        <button class="primary" data-finish-action="confirm" type="button"></button>
      </footer>
    </section>
  `;
  return root;
}
```

该函数只由 `openFinishPlanModal()` 调用一次。

- [ ] **Step 5: 局部更新选择器、库存和校验**

加入：

```js
function setSelectOptions(select, html, value) {
  if (!select) return;
  if (select.dataset.optionsHtml !== html) {
    select.innerHTML = html;
    select.dataset.optionsHtml = html;
  }
  select.value = value ?? "";
}

function patchFinishPlanModal() {
  if (!activeFinishPlanModal) return;
  const root = document.getElementById("finish-plan-root");
  const item = workshopStageItems().find((entry) => entry.id === activeFinishPlanModal.itemId);
  if (!root || !item) return closeFinishPlanModal();

  const catalog = finishCatalog();
  const { shape, draft } = activeFinishPlanModal;
  normalizeFinishPlanDraft(shape, draft, catalog);
  const validation = validateFinishPlanDraft({
    shape,
    draft,
    catalog,
    materials: getState().me.externalMaterials || {},
    cash: Number(getState().me.cash || 0)
  });

  root.querySelector("[data-finish-item-title]").textContent =
    `${item.name} · 每台设备容量固定为 1`;

  const fields = Object.fromEntries(
    [...root.querySelectorAll("[data-finish-field]")].map((field) => [field.dataset.finishField, field])
  );
  const settings = catalog.shapeSettings?.[shape] || [];
  const metals = catalog.settings?.[draft.settingId]?.metals || [];
  const settingNames = Object.fromEntries(
    Object.entries(catalog.settings || {}).map(([key, value]) => [key, value.name])
  );

  setSelectOptions(fields.productType,
    finishOptions(Object.keys(catalog.productTypeNames || {}), catalog.productTypeNames, draft.productType, {
      enabledKeys: catalog.productTypes?.[shape] || []
    }), draft.productType);
  setSelectOptions(fields.settingId,
    finishOptions(Object.keys(catalog.settings || {}), settingNames, draft.settingId, { enabledKeys: settings }),
    draft.settingId);
  setSelectOptions(fields.metalId,
    `<option value="">${metals.length ? "请选择金属种类" : "不使用金属"}</option>${finishOptions(Object.keys(catalog.metals || {}), catalog.metals, draft.metalId, { enabledKeys: metals })}`,
    draft.metalId);
  setSelectOptions(fields.polishId,
    finishOptions(Object.keys(catalog.polishes || {}), catalog.polishNames, draft.polishId),
    draft.polishId);
  setSelectOptions(fields.gemId,
    `<option value="">不使用配石</option>${finishOptions(Object.keys(catalog.gems || {}), catalog.gems, draft.gemId)}`,
    draft.gemId);

  fields.gemCount.value = String(draft.gemCount || 1);
  root.querySelector('[data-finish-count="gem"]').hidden = !draft.gemId;
  const backingAllowed = shape === "cabochon" && draft.productType === "ring";
  const backingField = root.querySelector("[data-finish-backing]");
  backingField.hidden = !backingAllowed;
  if (backingAllowed) {
    setSelectOptions(fields.backingId,
      finishOptions(Object.keys(catalog.backings || {}), catalog.backingNames, draft.backingId),
      draft.backingId);
  }

  const metalStock = root.querySelector('[data-finish-stock="metal"]');
  metalStock.hidden = !validation.showMetalInventory;
  metalStock.textContent = draft.metalId
    ? `当前持有 ${validation.metalHeld.toFixed(2)} 克 · 需要 ${Number(validation.quote?.metalAmount || 0).toFixed(2)} 克`
    : "";

  const gemStock = root.querySelector('[data-finish-stock="gem"]');
  gemStock.hidden = !validation.showGemInventory;
  gemStock.textContent = draft.gemId
    ? `当前持有 ${validation.gemHeld} 颗 · 需要 ${Number(validation.quote?.gemCount || 0)} 颗`
    : "";

  root.querySelector('[data-finish-summary="labor"]').textContent = formatMoney(validation.quote?.laborFee || 0);
  root.querySelector('[data-finish-summary="value"]').textContent =
    `×${Number(validation.quote?.valueMultiplier || 1).toFixed(2)}`;

  const warning = root.querySelector("[data-finish-warning]");
  warning.hidden = validation.reasons.length === 0 && !activeFinishPlanModal.error;
  warning.textContent = activeFinishPlanModal.error || validation.reasons.join("；");

  const confirm = root.querySelector('[data-finish-action="confirm"]');
  confirm.disabled = !validation.canStart || activeFinishPlanModal.submitting;
  confirm.textContent = activeFinishPlanModal.submitting
    ? "正在提交…"
    : `确认开工 · ${formatMoney(validation.quote?.laborFee || 0)}`;
}
```

- [ ] **Step 6: 修正配石选择顺序并保留控件**

将 `updateFinishPlanFromControl()` 改为：

```js
function updateFinishPlanFromControl(event) {
  const field = event.target?.dataset?.finishField;
  if (!field || !activeFinishPlanModal || activeFinishPlanModal.submitting) return;
  const draft = activeFinishPlanModal.draft;
  draft[field] = field === "gemCount"
    ? Number(event.target.value)
    : event.target.value === "" ? null : event.target.value;
  if (field === "gemId" && draft.gemId && draft.gemCount < 1) draft.gemCount = 1;
  activeFinishPlanModal.error = "";
  patchFinishPlanModal();
}
```

- [ ] **Step 7: 使用 acknowledgement，失败时保留弹窗**

将 `confirmFinishPlan()` 改为：

```js
function confirmFinishPlan() {
  if (!activeFinishPlanModal || activeFinishPlanModal.submitting) return;
  const modal = activeFinishPlanModal;
  const requestId = globalThis.crypto?.randomUUID?.() || `workshop-${Date.now()}`;
  modal.submitting = true;
  modal.error = "";
  patchFinishPlanModal();
  socketRef.emit("startWorkshopJob", {
    deviceId: modal.deviceId,
    itemId: modal.itemId,
    workerId: modal.workerId,
    finishPlan: structuredClone(modal.draft),
    requestId
  }, (result = {}) => {
    if (!activeFinishPlanModal || activeFinishPlanModal !== modal) return;
    if (result.ok) {
      closeFinishPlanModal();
      return;
    }
    modal.submitting = false;
    modal.error = result.message || "开工失败，请检查方案后重试。";
    patchFinishPlanModal();
  });
}
```

将 `server.js` 开工监听器签名改为：

```js
socket.on("startWorkshopJob", (payload = {}, acknowledge) => {
  const reply = (result) => {
    if (typeof acknowledge === "function") acknowledge(result);
  };
  const player = getPlayer(socket);
  if (!player) {
    reply({ ok: false, message: "玩家状态不可用。" });
    return;
  }
  if (!consumeRequestId(player, payload.requestId)) {
    const message = "该开工请求已处理，请勿重复提交。";
    socket.emit("toast", message);
    reply({ ok: false, message });
    return;
  }
  const result = startWorkshopJobForPlayer(player, payload.deviceId, payload);
  if (!result.ok) {
    socket.emit("toast", result.message);
    reply({ ok: false, message: result.message });
    return;
  }
  addNews(`${player.name} 将 ${result.job.item.name} 安排到${result.device.name}。`, "craft");
  advanceTask(player, "workshop_craft");
  emitUiEvent(socket, {
    type: "modal",
    tone: "craft",
    title: `${result.device.name}已开工`,
    subtitle: result.job.item.name,
    body: "设备和师傅已经按当前工序开始处理，完成后会回到对应阶段库存。",
    stats: [
      { label: "员工", value: result.worker?.name || "默认师傅" },
      { label: "加工费", value: `-${uiMoney(result.fee)}` }
    ],
    floatText: `加工 -${uiMoney(result.fee)}`
  });
  reply({ ok: true, message: "已开工", requestId: payload.requestId });
  broadcast();
});
```

- [ ] **Step 8: 添加深色且稳定的渐进库存样式**

```css
.finish-plan-stock {
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--surface-2, var(--panel));
  color: var(--muted);
  font-size: 12px;
}

.finish-plan-stock[hidden],
.finish-plan-field[hidden] {
  display: none;
}

.finish-plan-modal {
  overflow: hidden;
}

.finish-plan-modal .game-modal-body {
  min-height: 0;
  overflow: auto;
}
```

- [ ] **Step 9: 运行精加工与服务器测试**

Run:

```powershell
npm run test:finish-plan-model
npm run test:ui-stability
npm run test:inlay
npm run test:server-idle
```

Expected: 四项均 PASS。

- [ ] **Step 10: 提交稳定精加工弹窗**

```powershell
git add public/workshop-module.js public/styles.css server.js scripts/ui-stability-smoke.mjs
git commit -m "fix: keep finishing plan modal stable"
```

---

### Task 6: 毛坯真实套件裁切与预览边界

**Files:**
- Modify: `public/main.js:1018-1059`
- Modify: `public/styles.css:1276-1298, 1774-1783, 3420-3429`
- Modify: `scripts/jade-opening-engine-smoke.mjs`
- Modify: `scripts/simplified-flow-smoke.mjs`
- Conditional Modify: `public/jade-opening-engine.js:849-859`（仅当新增引擎测试复现失败）

**Interfaces:**
- Produces: `productCutoutPlaceholder(item, size): string`
- Preserves: `renderJadeOpeningProductSvg(stone, kit, options)`
- Rule: 有 `sourceMaterial` 但元数据不足时不得回退到未裁切完整原图

- [ ] **Step 1: 扩展裁切与旧存档失败测试**

在 `scripts/jade-opening-engine-smoke.mjs` 的成品裁片断言后加入：

```js
assert.match(productCutoutSvg, /clip-path="url\(#.*productClip/);
assert.match(productCutoutSvg, /preserveAspectRatio="xMidYMid meet"/);
assert.doesNotMatch(productCutoutSvg, /overflow="visible"/);
```

在源文件断言部分加入：

```js
assert.match(mainSource, /function productCutoutPlaceholder\b/);
assert.match(mainSource, /sourceMaterial[\s\S]*productCutoutPlaceholder/);
assert.match(stylesSource, /\.workshop-product-preview[\s\S]*overflow:\s*hidden/);
assert.match(stylesSource, /\.jade-opening-product-svg[\s\S]*max-width:\s*100%/);
```

在 `scripts/simplified-flow-smoke.mjs` 的粗加工套件产物断言中增加：

```js
assert.ok(carvedItem.sourceMaterial?.visual, "carved item should preserve source visual data");
assert.ok(carvedItem.sourceMaterial?.placement, "carved item should preserve exact kit placement");
assert.ok(carvedItem.sourceMaterial.placement.openingTpl, "placement should preserve opening template id");
```

- [ ] **Step 2: 运行裁切测试并确认失败点**

Run:

```powershell
npm run test:opening
npm run test:flow
```

Expected: `test:opening` 因缺少 `productCutoutPlaceholder` 或 CSS 边界断言失败；记录是否有引擎级断言失败。

- [ ] **Step 3: 对有来源信息的旧物品使用安全轮廓**

在 `public/main.js` 增加：

```js
function productCutoutPlaceholder(item, size = "finished") {
  const label = escapeHtml(item?.name || "套件");
  return `
    <div class="jade-opening-product ${escapeHtml(size)} is-placeholder" aria-label="${label}裁切数据缺失">
      <svg class="jade-opening-product-svg" viewBox="-80 -80 160 160" preserveAspectRatio="xMidYMid meet" role="img">
        <path d="M0-58C39-58 58-32 58 2C58 39 33 58 0 58C-36 58-58 34-58 0C-58-35-34-58 0-58Z"
          fill="rgba(48,166,105,.16)" stroke="currentColor" stroke-width="4" stroke-dasharray="8 7"/>
      </svg>
      <span class="sr-only">${label}缺少原始裁切数据</span>
    </div>
  `;
}
```

将 `productCanvas()` 改为：

```js
function productCanvas(item, size = "finished") {
  const exactCutout = openingProductSvg(item, size);
  if (exactCutout) return exactCutout;
  const stage = materialStageForClient(item);
  if (item?.sourceMaterial || stage === "carved" || stage === "finished") {
    return productCutoutPlaceholder(item, size);
  }
  return jadeCanvasMarkup("product", item, size);
}
```

- [ ] **Step 4: 统一选择卡、弹窗和预览容器边界**

在 `public/styles.css` 增加：

```css
.workshop-product-preview,
.workshop-product-preview .jade-opening-product,
.ws-pick-material .wsp-thumb,
.jade-opening-product {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.workshop-product-preview .jade-opening-product {
  width: 100%;
  height: 100%;
}

.jade-opening-product .jade-opening-product-svg {
  display: block;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  overflow: hidden;
}

.jade-opening-product.is-placeholder {
  position: relative;
  display: grid;
  place-items: center;
  color: var(--muted);
  background: var(--surface-2, transparent);
}

.workshop-recipe-summary > .workshop-product-preview {
  width: 76px;
  height: 76px;
  margin-bottom: 0;
  overflow: hidden;
  transform: none;
}
```

删除原规则中 `.workshop-recipe-summary > .workshop-product-preview` 的 `transform: scale(1.28)` 命中；粗料预览若仍需放大，只保留在 `.rough-output-preview` 上，不再作用于套件成品预览。

- [ ] **Step 5: 仅在引擎测试失败时修正 SVG**

如果 Step 2 证明 `renderJadeOpeningProductSvg()` 自身输出越界，只在现有 SVG 字符串上增加 `overflow="hidden"`，继续由 `namespaceSvgReferences()` 统一命名所有 id：

```js
const svg = `<svg class="jade-opening-product-svg"
  viewBox="${-pad} ${-pad} ${pad * 2} ${pad * 2}"
  preserveAspectRatio="xMidYMid meet"
  overflow="hidden"
  role="img"
  aria-label="${options.label || tpl.name}">
  <defs>${defsInnerSvg(defs)}<clipPath id="productClip">${tpl.shape}</clipPath></defs>
  <g clip-path="url(#productClip)"><use href="#jadeMaterial" transform="${useTf}"/></g>
  <g class="product-finish" pointer-events="none">${shine}${outline}</g>
</svg>`;
const uid = kit.uid ?? kit.id ?? `${tpl.id}-product`;
const instanceId = options.idPrefix
  || `jop-${sanitizeSvgIdPart(stone.id || stone.seed)}-${sanitizeSvgIdPart(uid)}-${openingSvgInstanceCounter += 1}`;
return namespaceSvgReferences(svg, instanceId);
```

不得绕过 `namespaceSvgReferences()`，也不得直接返回包含全局固定 SVG id 的字符串。

- [ ] **Step 6: 运行裁切与流程测试**

Run:

```powershell
npm run test:opening
npm run test:flow
npm run test:canvas
```

Expected: 三项均 PASS。

- [ ] **Step 7: 提交裁切修复**

```powershell
git add public/main.js public/styles.css public/jade-opening-engine.js scripts/jade-opening-engine-smoke.mjs scripts/simplified-flow-smoke.mjs
git commit -m "fix: contain workshop cutout previews"
```

如果 `public/jade-opening-engine.js` 未修改，不将它加入实际提交。

---

### Task 7: 工坊与招募共用完整员工详情

**Files:**
- Create: `public/worker-detail-view.js`
- Modify: `public/workshop-module.js:83-116, 199-277, 797-909`
- Modify: `public/extra-module.js:1-18, 131-170`
- Modify: `public/main.js:41-70, 1699-1860, 2106-2114`
- Modify: `server.js:2691-2703`
- Create: `scripts/worker-detail-view-smoke.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `WORKER_SKILL_DEFS`
- Produces: `workerJobLabel(job): string`
- Produces: `workerStepForJob(job): "open" | "plan" | "finish" | "speak"`
- Produces: `renderWorkerDetailPanel({ worker, step, mode, summaryHtml, footerHtml }): string`
- Produces: `openRecruitCandidateDetail(candidateId): void`
- Produces: `confirmRecruitCandidate(): void`

- [ ] **Step 1: 写共享详情失败测试**

创建 `scripts/worker-detail-view-smoke.mjs`：

```js
import assert from "node:assert/strict";
import {
  WORKER_SKILL_DEFS,
  renderWorkerDetailPanel,
  workerJobLabel,
  workerStepForJob
} from "../public/worker-detail-view.js";

const skills = {};
for (const [key, def] of Object.entries(WORKER_SKILL_DEFS)) {
  skills[def.dir] ||= {};
  skills[def.dir][key] = { level: 3, exp: 20 };
}

const worker = {
  id: "candidate-1",
  name: "小满",
  tier: 4,
  job: "planner",
  traits: ["净料"],
  flaws: ["手重"],
  skills
};

const workshopHtml = renderWorkerDetailPanel({
  worker,
  step: "plan",
  mode: "workshop",
  summaryHtml: "<div>工分 74</div>",
  footerHtml: "<button>选择</button>"
});
const recruitHtml = renderWorkerDetailPanel({
  worker,
  step: workerStepForJob(worker.job),
  mode: "recruit",
  footerHtml: "<button>确认招募</button>"
});

assert.equal(Object.keys(WORKER_SKILL_DEFS).length, 9);
assert.equal((workshopHtml.match(/class="wsp-skill-card/g) || []).length, 9);
assert.equal((recruitHtml.match(/class="wsp-skill-card/g) || []).length, 9);
assert.match(workshopHtml, /净料/);
assert.match(recruitHtml, /手重/);
assert.match(recruitHtml, /确认招募/);
assert.match(recruitHtml, /规划师傅/);
assert.equal(workerStepForJob("planner"), "plan");
assert.equal(workerStepForJob("streamer"), "speak");
assert.equal(workerJobLabel("finisher"), "精加工师傅");

const server = readFileSync("server.js", "utf8");
assert.match(server, /socket\.on\("recruitWorker",\s*\(payload = \{\}, acknowledge\)/);

console.log("worker-detail-view-smoke: shared nine-skill detail ok");
```

在 `package.json` 加入：

```json
"test:worker-detail-view": "node scripts/worker-detail-view-smoke.mjs"
```

并在总 `test` 的 `test:employee` 后加入它。

- [ ] **Step 2: 运行测试并确认模块不存在**

Run:

```powershell
npm run test:worker-detail-view
```

Expected: FAIL，`ERR_MODULE_NOT_FOUND` 指向 `worker-detail-view.js`。

- [ ] **Step 3: 创建共享详情视图模块**

创建 `public/worker-detail-view.js`，将 `SKILL_DEFS`、`TRAIT_DESC`、技能读取、九项技能卡和天赋行从工坊模块移入。公共入口使用：

```js
export const WORKER_SKILL_DEFS = {
  jieliao:   { name: "解料", attr: "完整度", full: 18, dir: "cut" },
  damo:      { name: "打磨", attr: "光泽度", full: 15, dir: "cut" },
  qieliao:   { name: "切料", attr: "瑕疵控制", full: 12, dir: "set" },
  xiuxing:   { name: "修形", attr: "造型精度", full: 14, dir: "set" },
  diaozhuo:  { name: "雕琢", attr: "雕琢精细度", full: 22, dir: "finish" },
  xiangqian: { name: "镶嵌", attr: "镶嵌贴合度", full: 16, dir: "finish" },
  huashu:    { name: "话术", attr: "溢价力", full: 12, dir: "speak" },
  kongchang: { name: "控场", attr: "控场流速", full: 10, dir: "speak" },
  cuidan:    { name: "催单", attr: "逼单转化", full: 10, dir: "speak" }
};

const STEP_SKILLS = {
  open: ["jieliao", "damo"],
  plan: ["qieliao", "xiuxing"],
  finish: ["diaozhuo", "xiangqian"],
  speak: ["huashu", "kongchang", "cuidan"]
};

const TRAIT_DESCRIPTIONS = {
  稳手: "手感稳健，压裂与崩口风险更低。",
  按线稳: "下刀贴合设计线，取件边界更准。",
  细光: "抛光细腻，表面光感更润。",
  收口准: "镶嵌 / 圈口收口更贴合。",
  巧手: "手法灵巧，降低瑕疵倾向，更易出完美件。",
  心细: "观察细致，降低瑕疵倾向。",
  净料: "净料处理到位，减少脏点 / 棉絮。",
  易裂: "料性偏脆，出裂风险较高。",
  易出绵: "易出棉絮 / 绵，影响净度。",
  易脏: "工序中易带入脏点。",
  手重: "下手偏重，压裂 / 崩口风险略高。"
};

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

export function workerStepForJob(job) {
  return ({ cutter: "open", planner: "plan", finisher: "finish", streamer: "speak" })[job] || "open";
}

export function workerJobLabel(job) {
  return ({
    cutter: "开料师傅",
    planner: "规划师傅",
    finisher: "精加工师傅",
    streamer: "直播掌柜"
  })[job] || "工坊员工";
}

function workerSkill(worker, key) {
  const dir = WORKER_SKILL_DEFS[key].dir;
  return worker.skills?.[dir]?.[key] || { level: 1, exp: 0 };
}

function skillCardsHtml(worker, step) {
  const relevant = new Set(STEP_SKILLS[step] || []);
  return Object.keys(WORKER_SKILL_DEFS)
    .sort((a, b) => Number(relevant.has(b)) - Number(relevant.has(a)))
    .map((key) => {
      const definition = WORKER_SKILL_DEFS[key];
      const skill = workerSkill(worker, key);
      const level = Math.max(1, Math.min(10, Number(skill.level) || 1));
      const maximum = 50 * level;
      const current = Math.max(0, Number(skill.exp) || 0);
      const pct = Math.max(0, Math.min(100, Math.round(current / maximum * 100)));
      return `<div class="wsp-skill-card ${relevant.has(key) ? "is-step" : ""}">
        <div class="wsp-skill-card-head">
          <strong class="wsp-skill-name">${escapeHtml(definition.name)}${relevant.has(key) ? '<span class="wsp-skill-tag">当前岗位</span>' : ""}</strong>
          <span class="wsp-skill-lv">Lv.${level}</span>
        </div>
        <div class="wsp-skill-card-bar"><span class="wsp-bar"><i style="width:${pct}%"></i></span></div>
        <div class="wsp-skill-card-foot"><span class="wsp-skill-exp">${current} / ${maximum}</span></div>
      </div>`;
    }).join("");
}

function traitRowsHtml(worker) {
  const positive = new Set(worker.traits || []);
  const names = [...(worker.traits || []), ...(worker.flaws || [])];
  if (!names.length) {
    return '<div class="wsp-trait-row muted"><strong class="wsp-trait-name">无天赋</strong><span class="wsp-trait-desc">该员工没有特性或缺陷。</span></div>';
  }
  return names.map((name) => `
    <div class="wsp-trait-row ${positive.has(name) ? "pos" : "neg"}">
      <strong class="wsp-trait-name">${escapeHtml(name)}</strong>
      <span class="wsp-trait-desc">${escapeHtml(TRAIT_DESCRIPTIONS[name] || "暂无说明")}</span>
    </div>
  `).join("");
}

export function renderWorkerDetailPanel({
  worker,
  step,
  mode = "workshop",
  summaryHtml = "",
  footerHtml = ""
}) {
  return `<section class="wsp-pick-side worker-detail-panel mode-${escapeHtml(mode)}">
    <div class="wsp-detail-head">
      <span class="worker-avatar">${escapeHtml((worker.name || "?")[0])}</span>
      <div><strong>${escapeHtml(worker.name)}</strong><em>${escapeHtml(workerJobLabel(worker.job))} · ${Number(worker.tier) || 1}阶</em></div>
    </div>
    ${summaryHtml}
    <section class="wsp-detail-section">
      <h4>天赋</h4>
      <div class="wsp-trait-rows">${traitRowsHtml(worker)}</div>
    </section>
    <section class="wsp-detail-section">
      <h4>技能（9）</h4>
      <div class="wsp-skill-grid">${skillCardsHtml(worker, step)}</div>
    </section>
    <footer class="wsp-detail-actions">${footerHtml}</footer>
  </section>`;
}
```

工坊计算仍保留技能满值、工分和速度公式；只将展示常量和 HTML 移到共享模块，避免改变数值。

- [ ] **Step 4: 工坊详情改用共享视图**

在 `workshop-module.js` 导入 `WORKER_SKILL_DEFS` 与 `renderWorkerDetailPanel`。工分公式将旧 `SKILL_DEFS` 引用改为 `WORKER_SKILL_DEFS`：

```js
function workerSkill(worker, key) {
  const dir = WORKER_SKILL_DEFS[key].dir;
  return worker.skills?.[dir]?.[key] || { level: 1, exp: 0 };
}

function skillAttrValue(worker, key) {
  const skill = workerSkill(worker, key);
  return WORKER_SKILL_DEFS[key].full * skillK(skill.level, skill.exp) * workerTierM(worker);
}
```

将 `renderWorkerDetail(worker, device)` 改为：

```js
function renderWorkerDetail(worker, device) {
  const preview = workerStepPreview(worker, deviceStep(device));
  const assigned = worker.id === device.workerId;
  return renderWorkerDetailPanel({
    worker,
    step: deviceStep(device),
    mode: "workshop",
    summaryHtml: renderWorkerMiniScores(worker, deviceStep(device)),
    footerHtml: `
      <button class="primary" data-action="confirmPickerWorker"
        data-payload="${device.id}" data-worker-id="${worker.id}" type="button"
        ${worker.busy ? "disabled" : ""}>
        ${worker.busy ? "正在执行其他任务" : assigned ? "已选择" : `选择 · 工分 ${preview.quality.toFixed(0)}`}
      </button>
    `
  });
}
```

- [ ] **Step 5: 招募卡改为摘要入口并建立详情弹窗**

在 `extra-module.js` 导入：

```js
import {
  renderWorkerDetailPanel,
  workerStepForJob
} from "./worker-detail-view.js";
```

将候选卡按钮改为：

```html
<button data-action="openRecruitCandidateDetail"
  data-payload="${escapeHtml(candidate.id)}" type="button">查看完整详情</button>
```

加入稳定详情状态：

```js
let activeRecruitCandidateId = null;
let recruitSubmitting = false;
let recruitError = "";

function recruitDetailRoot() {
  let root = document.getElementById("recruit-detail-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "recruit-detail-root";
    root.className = "modal-root";
    document.body.appendChild(root);
  }
  return root;
}

export function openRecruitCandidateDetail(candidateId) {
  activeRecruitCandidateId = candidateId;
  recruitSubmitting = false;
  recruitError = "";
  renderRecruitCandidateDetail();
}

export function closeRecruitCandidateDetail() {
  activeRecruitCandidateId = null;
  recruitSubmitting = false;
  recruitError = "";
  document.getElementById("recruit-detail-root")?.remove();
}

function renderRecruitCandidateDetail() {
  if (!activeRecruitCandidateId) return;
  const candidate = (getState().me.recruitCandidates || [])
    .find((entry) => entry.id === activeRecruitCandidateId);
  if (!candidate) return closeRecruitCandidateDetail();
  const workers = getState().me.workshop?.workers || [];
  const cash = Number(getState().me.cash || 0);
  const disabledReason = workers.length >= 8
    ? "员工人数已达到 8 人上限"
    : cash < Number(candidate.price || 0) ? "现金不足" : "";
  const root = recruitDetailRoot();
  if (!root.querySelector(".recruit-detail-modal")) {
    root.innerHTML = `<section class="game-modal recruit-detail-modal" role="dialog" aria-modal="true">
      <button class="modal-close" data-action="closeRecruitCandidateDetail" type="button" aria-label="关闭">×</button>
      <div data-recruit-detail-body></div>
    </section>`;
  }
  const body = root.querySelector("[data-recruit-detail-body]");
  if (body.dataset.candidateId !== candidate.id) {
    body.dataset.candidateId = candidate.id;
    body.innerHTML = renderWorkerDetailPanel({
      worker: candidate,
      step: workerStepForJob(candidate.job),
      mode: "recruit",
      footerHtml: '<div data-recruit-footer></div>'
    });
  }
  const footer = root.querySelector("[data-recruit-footer]");
  footer.innerHTML = `
    ${recruitError ? `<p class="finish-plan-warning">${escapeHtml(recruitError)}</p>` : ""}
    <button class="primary" data-action="confirmRecruitCandidate" type="button"
      ${disabledReason || recruitSubmitting ? "disabled" : ""}>
      ${recruitSubmitting ? "正在招募…" : disabledReason || `确认招募 · ${formatMoney(candidate.price)}`}
    </button>
  `;
}
```

在每次 `renderRecruitCandidates()` 结束后，如果详情已打开，调用 `renderRecruitCandidateDetail()`；候选人不变时只更新 `[data-recruit-footer]`，不得重建外层弹窗或详情正文，因此滚动位置保持不变。

- [ ] **Step 6: 招募确认使用 acknowledgement**

在 `extra-module.js` 加入：

```js
export function confirmRecruitCandidate() {
  if (!activeRecruitCandidateId || recruitSubmitting) return;
  const candidateId = activeRecruitCandidateId;
  const requestId = globalThis.crypto?.randomUUID?.() || `recruit-${Date.now()}`;
  recruitSubmitting = true;
  recruitError = "";
  renderRecruitCandidateDetail();
  socketRef.emit("recruitWorker", { candidateId, requestId }, (result = {}) => {
    if (candidateId !== activeRecruitCandidateId) return;
    if (result.ok) {
      closeRecruitCandidateDetail();
      return;
    }
    recruitSubmitting = false;
    recruitError = result.message || "招募失败，请稍后重试。";
    renderRecruitCandidateDetail();
  });
}
```

将 `server.js` 的招募监听器改为：

```js
socket.on("recruitWorker", (payload = {}, acknowledge) => {
  const reply = (result) => {
    if (typeof acknowledge === "function") acknowledge(result);
  };
  const player = getPlayer(socket);
  if (!player) {
    reply({ ok: false, message: "玩家状态不可用。" });
    return;
  }
  if (!consumeRequestId(player, payload.requestId)) {
    const message = "该招聘请求已处理，请勿重复提交。";
    socket.emit("toast", message);
    reply({ ok: false, message });
    return;
  }
  normalizePlayer(player);
  const result = recruitWorker(player, payload.candidateId, { spendCash });
  socket.emit("toast", result.message);
  if (!result.ok) {
    reply({ ok: false, message: result.message });
    return;
  }
  addNews(`${player.name} 招聘了 ${result.worker.name}。`, "craft");
  reply({ ok: true, message: result.message, requestId: payload.requestId });
  broadcast();
});
```

- [ ] **Step 7: 路由招募详情动作**

在 `main.js` 从 `extra-module.js` 导入：

```js
openRecruitCandidateDetail,
closeRecruitCandidateDetail,
confirmRecruitCandidate
```

在动作路由中，用以下分支替代直接 `recruitWorker` 发射：

```js
if (action === "openRecruitCandidateDetail") { openRecruitCandidateDetail(payload); return; }
if (action === "closeRecruitCandidateDetail") { closeRecruitCandidateDetail(); return; }
if (action === "confirmRecruitCandidate") { confirmRecruitCandidate(); return; }
```

- [ ] **Step 8: 运行员工与服务器测试**

Run:

```powershell
npm run test:worker-detail-view
npm run test:employee
npm run test:server-idle
```

Expected: 三项均 PASS；共享详情测试确认两个模式均显示九项技能。

- [ ] **Step 9: 提交共享员工详情**

```powershell
git add public/worker-detail-view.js public/workshop-module.js public/extra-module.js public/main.js server.js scripts/worker-detail-view-smoke.mjs package.json
git commit -m "feat: share complete worker details with recruitment"
```

---

### Task 8: 夜间主题低亮度表面与员工卡片可读性

**Files:**
- Modify: `public/styles.css:1-140, 1938-1995, 2980-3070, 3295-3590`
- Create: `scripts/night-theme-smoke.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces CSS tokens: `--night-surface-1`, `--night-surface-2`, `--night-surface-3`, `--night-text`, `--night-muted`, `--night-primary`
- Covers: 精加工、规划、招募、员工选择、天赋、摘要块和按钮

- [ ] **Step 1: 写夜间主题失败测试**

创建 `scripts/night-theme-smoke.mjs`：

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("public/styles.css", "utf8");

for (const token of [
  "--night-surface-1",
  "--night-surface-2",
  "--night-surface-3",
  "--night-text",
  "--night-muted",
  "--night-primary"
]) {
  assert.match(css, new RegExp(token));
}

assert.match(css, /\[data-theme="night"\]\s+\.recruit-candidate-card/);
assert.match(css, /\[data-theme="night"\]\s+\.finish-plan-summary\s*>\s*div/);
assert.match(css, /\[data-theme="night"\]\s+\.ws-picker-modal/);
assert.match(css, /\[data-theme="night"\]\s+\.worker-detail-panel/);
assert.match(css, /prefers-reduced-motion:\s*reduce/);

const forbiddenNightBlocks = [
  css.match(/\[data-theme="night"\]\s+\.recruit-candidate-card[\s\S]*?\}/)?.[0] || "",
  css.match(/\[data-theme="night"\]\s+\.finish-plan-summary\s*>\s*div[\s\S]*?\}/)?.[0] || ""
].join("\n");
assert.doesNotMatch(forbiddenNightBlocks, /#fff(?:fff)?\b|#f8fbf8\b|#fbfdfb\b/i);

console.log("night-theme-smoke: low-luminance surfaces ok");
```

在 `package.json` 加入：

```json
"test:night-theme": "node scripts/night-theme-smoke.mjs"
```

并在总 `test` 的 `test:ui-stability` 后加入它。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
npm run test:night-theme
```

Expected: FAIL，提示缺少首个夜间表面 token。

- [ ] **Step 3: 定义夜间颜色层级**

在夜间主题变量块加入：

```css
[data-theme="night"] {
  --night-surface-1: #0c1b16;
  --night-surface-2: #12251e;
  --night-surface-3: #193229;
  --night-text: #d7e4de;
  --night-muted: #91a69c;
  --night-primary: #246b51;
  --panel: var(--night-surface-1);
  --ink: var(--night-text);
  --muted: var(--night-muted);
}
```

- [ ] **Step 4: 覆盖高亮表面、按钮和摘要块**

加入：

```css
[data-theme="night"] .ws-picker-modal,
[data-theme="night"] .ws-planner-modal,
[data-theme="night"] .game-modal,
[data-theme="night"] .worker-detail-panel,
[data-theme="night"] .recruit-candidate-card,
[data-theme="night"] .ws-big-card,
[data-theme="night"] .ws-picker-item,
[data-theme="night"] .finish-plan-summary > div,
[data-theme="night"] .finish-plan-stock {
  color: var(--night-text);
  background: var(--night-surface-2);
  border-color: rgba(142, 178, 160, .24);
  box-shadow: none;
}

[data-theme="night"] .recruit-candidate-card {
  background-image: linear-gradient(160deg, rgba(42, 91, 70, .22), transparent 58%);
}

[data-theme="night"] .recruit-card-head h3,
[data-theme="night"] .wsp-worker-name,
[data-theme="night"] .ws-big-worker-id strong {
  color: var(--night-text);
  text-shadow: 0 1px 1px rgba(0, 0, 0, .5);
}

[data-theme="night"] button.primary,
[data-theme="night"] .main-nav-item.active {
  color: #e4f1eb;
  background: var(--night-primary);
  border-color: #327f61;
}

[data-theme="night"] button.secondary,
[data-theme="night"] .mobile-resources-toggle {
  color: var(--night-text);
  background: var(--night-surface-3);
  border-color: rgba(142, 178, 160, .3);
}

[data-theme="night"] .wsp-trait-row.pos,
[data-theme="night"] .trait-chip {
  color: #a9d9c4;
  background: #153d2e;
  border-color: #2d6c52;
}

[data-theme="night"] .wsp-trait-row.neg,
[data-theme="night"] .flaw-chip.neg {
  color: #e5ad9c;
  background: #3b241e;
  border-color: #78493b;
}

[data-theme="night"] .finish-plan-warning {
  color: #e7bd8e;
  background: #3c2d1c;
  border-color: #72532e;
}
```

删除这些组件在夜间覆盖中的纯白、`#f8fbf8`、`#fbfdfb` 和高亮灰背景。

- [ ] **Step 5: 降低员工预览底图对比并固定姓名衬底**

```css
[data-theme="night"] .ws-pick-worker,
[data-theme="night"] .recruit-candidate-card {
  background-color: var(--night-surface-2);
  background-blend-mode: normal;
}

[data-theme="night"] .wsp-worker-top,
[data-theme="night"] .recruit-card-head,
[data-theme="night"] .ws-big-worker-top {
  padding: 7px 8px;
  border-radius: var(--r-sm);
  background: rgba(4, 13, 10, .58);
}

[data-theme="night"] .worker-avatar {
  color: #b9d8ca;
  background: #24463a;
}
```

- [ ] **Step 6: 运行主题与界面测试**

Run:

```powershell
npm run test:night-theme
npm run test:ui
npm run test:responsive
```

Expected: 三项均 PASS。

- [ ] **Step 7: 提交夜间主题修复**

```powershell
git add public/styles.css scripts/night-theme-smoke.mjs package.json
git commit -m "fix: soften dark theme workshop and recruit surfaces"
```

---

### Task 9: 桌面不变、手机浏览器复审与完整交付验证

**Files:**
- Modify only if verification exposes a defect: files owned by Tasks 1–8
- No new feature files

**Interfaces:**
- Consumes: all preceding tasks
- Produces: verified implementation and final changed-file checklist

- [ ] **Step 1: 运行全部自动测试**

Run:

```powershell
npm test
```

Expected: 所有脚本 PASS，退出码 `0`；特别包括：

- `responsive-layout-smoke`
- `ui-stability-smoke`
- `workshop-planner-ui-smoke`
- `finish-plan-model-smoke`
- `worker-detail-view-smoke`
- `night-theme-smoke`
- `equipment-system-smoke`
- `simplified-flow-smoke`

- [ ] **Step 2: 检查提交与工作区**

Run:

```powershell
git status --short
git log --oneline --max-count=12
git diff --check HEAD~8..HEAD
```

Expected:

- 工作区没有未提交的项目代码。
- 只有本计划对应的独立提交。
- `git diff --check` 没有尾随空格或补丁错误。

- [ ] **Step 3: 使用 game-playtest 技能复审桌面端**

启动项目：

```powershell
npm start
```

在浏览器以 `1440×900` 检查并截图：

1. 状态页
2. 工坊设备页
3. 工坊生产准备页
4. 招募页
5. 精加工方案弹窗

Expected:

- 桌面 `.shell` 仍为原三栏网格。
- 左导航、主内容、右侧事项和底部消息的栏目宽度与位置没有变化。
- 规划画布从右侧汇总中移除，但三列宽度不变；右栏显示规划摘要与按钮。

- [ ] **Step 4: 复审 360px、390px、412px 手机布局**

对每个宽度、至少 `800px` 高度检查：

1. 左侧页签始终可见并可点击。
2. 顶栏约 `52px`，资源浮层不推动内容。
3. 事项和消息在右侧内容区显示。
4. 左栏底部按钮不被浏览器安全区遮挡。
5. 规划弹窗占满右侧可用区域，底部确认可见。
6. 招募详情可滚动，确认按钮可见。

Expected: 无横向页面滚动，无被裁掉的页签和按钮。

- [ ] **Step 5: 验证当前目标节点不闪烁**

在状态页控制台执行：

```js
const firstGoalNode = document.querySelector(".goal-card");
await new Promise((resolve) => setTimeout(resolve, 2500));
({
  sameNode: firstGoalNode === document.querySelector(".goal-card"),
  entering: document.querySelector(".goal-card")?.classList.contains("is-entering")
});
```

Expected:

```js
{ sameNode: true, entering: false }
```

- [ ] **Step 6: 验证精加工弹窗稳定与渐进库存**

在精加工设备选择真实毛坯，打开方案弹窗：

1. 未选择金属时不显示金属库存。
2. 选择 `18K 金` 后仅显示 18K 金库存。
3. 未选择配石时不显示配石库存和数量。
4. 选择一种配石后显示该配石库存，数量默认为 `1`。
5. 等待至少两次服务器状态刷新。

控制台执行：

```js
const firstModalNode = document.querySelector(".finish-plan-modal");
const selectedMetal = document.querySelector('[data-finish-field="metalId"]').value;
await new Promise((resolve) => setTimeout(resolve, 2500));
({
  sameNode: firstModalNode === document.querySelector(".finish-plan-modal"),
  metalPreserved: selectedMetal === document.querySelector('[data-finish-field="metalId"]').value
});
```

Expected:

```js
{ sameNode: true, metalPreserved: true }
```

- [ ] **Step 7: 验证规划、裁切与设备容量**

1. 选择石头，打开规划套件，放置并移动至少两个套件。
2. 取消后确认原规划恢复；再次规划并确认后摘要显示件数。
3. 更换员工，确认规划仍存在。
4. 更换石头，确认旧规划失效。
5. 开始雕刻后确认该设备按钮显示“设备加工中（容量 1）”。
6. 尝试再次开工，确认没有第二个任务或等待队列。
7. 使用产出的毛坯进入精加工选择页。

Expected:

- 规划画布只在弹窗内出现。
- 毛坯图在选择卡、精加工弹窗和后续预览中都被套件轮廓裁切。
- 所有图像均处于父容器边界内。
- 设备任务数始终不超过 `1`。

- [ ] **Step 8: 验证夜间主题和招募详情**

在夜间主题检查：

1. 招募摘要卡没有白色或强烈黑白渐变。
2. 员工姓名始终可读。
3. 正负天赋样式一致且能区分。
4. 点击候选人后显示品阶、天赋说明和全部九项技能。
5. 与工坊选工详情逐项核对同一员工的数据。
6. 模拟余额不足时确认按钮禁用并显示原因。

Expected: 无刺眼纯白大面积表面；招募和工坊详情字段一致。

- [ ] **Step 9: 修复复审发现的问题并重新运行完整测试**

每发现一个问题，先在对应脚本增加可复现断言，再做最小修复。完成后运行：

```powershell
npm test
```

Expected: 退出码 `0`。

- [ ] **Step 10: 请求最终代码复审**

使用 `superpowers:requesting-code-review` 检查：

- 七项用户问题是否全部覆盖。
- 桌面端不变约束是否满足。
- 设备容量 `1` 和无队列是否仍由客户端与服务器共同保护。
- 弹窗 acknowledgement 是否在成功、失败和重复请求中都能结束提交状态。
- 新纯模块与实际界面使用的字段名是否一致。

- [ ] **Step 11: 准备最终交付清单**

最终答复按以下结构列出实际结果：

```text
1. 手机版左侧页签与折叠资源栏
2. 当前目标稳定节点
3. 独立规划套件步骤与弹窗
4. 夜间主题低亮度修复
5. 毛坯按真实套件裁切
6. 精加工弹窗、金属/配石渐进选择
7. 招募与工坊共享完整员工详情
8. 设备容量固定为 1 且无等待队列
9. 自动测试、桌面截图与手机尺寸复审结果
10. 实际修改文件与提交列表
```

只有在自动测试和浏览器复审全部通过后，才能声明交付完成。
