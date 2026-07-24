# Jade Mobile Layout Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复移动端顶部信息栏、工坊员工详情弹窗和左侧页签的排版问题，同时保持桌面端布局不变。

**Architecture:** 仅扩展 `max-width: 767px` 的响应式 CSS，不修改员工数据、工坊选择状态或桌面双栏 DOM。现有响应式烟雾测试增加结构契约，真实浏览器使用 360、390、412 和 1440px 四档视口做视觉与溢出复核。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Node.js `assert` 烟雾测试、浏览器 Playwright 控制。

## Global Constraints

- 所有新布局规则必须限定在 `@media (max-width: 767px)`。
- 1440×900 桌面端顶部、侧栏和员工选择双栏布局必须保持不变。
- 移动端主要触控按钮高度不得低于 44px。
- 不修改员工数值、技能、天赋或工坊生产逻辑。
- 保留工作区中已有的未提交改动；不得把无关改动混入本任务提交。

---

### Task 1: 锁定顶部信息栏和左侧页签的移动端契约

**Files:**
- Modify: `scripts/responsive-layout-smoke.mjs:20-55`
- Modify: `public/styles.css:4090-4190`
- Test: `scripts/responsive-layout-smoke.mjs`

**Interfaces:**
- Consumes: 现有 `.shell`、`.topbar`、`.player-card`、`.mobile-resources-toggle`、`.theme-toggle`、`.main-nav-item` 和 `.nav-ico` 类。
- Produces: 72px 移动端侧栏、24px 页签图标、11px 页签文字、44px 顶部控件和长名称省略保护。

- [ ] **Step 1: 写入失败的响应式契约**

在 `mobileShellCss` 创建后加入以下断言，并把原有 66px 侧栏断言改为 72px：

```js
assert.match(mobileShellCss, /grid-template-columns:\s*72px\s+minmax\(0,\s*1fr\)/);
assert.match(mobileShellCss, /#ws-planner-root\s*\{[^}]*left:\s*72px/s);
assert.match(
  mobileShellCss,
  /\.main-nav-item,\s*\.mobile-panel-toggle\s*\{[^}]*font-size:\s*11px/s
);
assert.match(
  mobileShellCss,
  /\.nav-ico,\s*\.nav-ico svg\s*\{[^}]*width:\s*24px[^}]*height:\s*24px/s
);
assert.match(
  mobileShellCss,
  /\.topbar \.player-card \.player-name\s*\{[^}]*white-space:\s*nowrap[^}]*text-overflow:\s*ellipsis/s
);
assert.match(
  mobileShellCss,
  /\.mobile-resources-toggle,\s*\.topbar \.theme-toggle\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s
);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm run test:responsive`

Expected: FAIL，首个错误指出 CSS 中仍为 `66px`，且尚无 24px 图标、11px 文字或顶部省略规则。

- [ ] **Step 3: 实现最小移动端样式**

在现有移动端媒体规则内修改和补充：

```css
#ws-planner-root {
  left: 72px;
}

.shell {
  grid-template-columns: 72px minmax(0, 1fr);
  grid-template-rows: 54px minmax(0, 1fr);
}

.main-nav-item,
.mobile-panel-toggle {
  min-height: 50px;
  gap: 3px;
  font-size: 11px;
}

.nav-ico,
.nav-ico svg {
  width: 24px;
  height: 24px;
}

.topbar {
  height: 54px;
  align-items: center;
}

.topbar .player-card {
  height: 44px;
  overflow: hidden;
  border-radius: var(--r-md);
}

.topbar .player-card .player-id {
  width: 100%;
  min-width: 0;
  gap: 8px;
}

.topbar .player-card .avatar {
  width: 36px;
  height: 36px;
}

.topbar .player-card .player-meta {
  flex: 1 1 auto;
  min-width: 0;
}

.topbar .player-card .player-name {
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.topbar-right {
  flex: 0 0 auto;
  margin-left: 0;
}

.mobile-resources-toggle,
.topbar .theme-toggle {
  width: 44px;
  min-width: 44px;
  height: 44px;
  min-height: 44px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface-strong);
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm run test:responsive`

Expected: PASS，输出 `responsive-layout-smoke: desktop guards ok`。

- [ ] **Step 5: 检查改动边界**

Run: `git diff --check -- public/styles.css scripts/responsive-layout-smoke.mjs`

Expected: 无错误；新增规则只出现在移动端媒体规则中。

---

### Task 2: 将员工选择弹窗改为移动端单栏纵向布局

**Files:**
- Modify: `scripts/responsive-layout-smoke.mjs:35-75`
- Modify: `public/styles.css:4190-4295`
- Test: `scripts/responsive-layout-smoke.mjs`

**Interfaces:**
- Consumes: 现有 `.ws-picker-overlay`、`.ws-picker-modal.kind-worker`、`.ws-picker-content`、`.ws-picker-body`、`.picker-worker` 和 `.wsp-pick-side` DOM。
- Produces: 侧栏右侧的全高员工弹窗、上方可滚动员工列表、下方完整详情和无横向裁切的确认区域。

- [ ] **Step 1: 写入失败的员工弹窗契约**

在 `mobileShellCss` 断言区加入：

```js
assert.match(
  mobileShellCss,
  /#ws-picker-root \.ws-picker-overlay\s*\{[^}]*left:\s*72px[^}]*padding:\s*0/s
);
assert.match(
  mobileShellCss,
  /\.ws-picker-modal\.kind-worker\s*\{[^}]*height:\s*100dvh[^}]*max-height:\s*100dvh/s
);
assert.match(
  mobileShellCss,
  /\.ws-picker-modal\.kind-worker \.ws-picker-body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s
);
assert.match(
  mobileShellCss,
  /\.ws-picker-modal\.kind-worker \.wsp-pick-side\s*\{[^}]*max-height:\s*none[^}]*overflow:\s*visible/s
);

const desktopCss = css.slice(0, css.lastIndexOf("@media (max-width: 767px)"));
assert.match(
  desktopCss,
  /\.ws-picker-body\s*\{[^}]*grid-template-columns:\s*minmax\(320px,\s*1fr\)\s+minmax\(360px,\s*1\.05fr\)/s
);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm run test:responsive`

Expected: FAIL，错误指出移动端员工弹窗仍缺少单栏和全高规则。

- [ ] **Step 3: 实现移动端员工弹窗**

在移动端媒体规则内加入：

```css
#ws-picker-root .ws-picker-overlay {
  left: 72px;
  align-items: stretch;
  justify-content: stretch;
  padding: 0;
}

.ws-picker-modal.kind-worker {
  width: 100%;
  max-width: none;
  height: 100dvh;
  max-height: 100dvh;
  border-radius: 0;
}

.ws-picker-modal.kind-worker .ws-picker-head {
  padding: 12px 14px 8px;
}

.ws-picker-modal.kind-worker .wsp-toolbar {
  padding: 0 14px 8px;
}

.ws-picker-modal.kind-worker .wsp-toolbar-extra {
  padding: 4px 14px 8px;
  overflow-x: auto;
  flex-wrap: nowrap;
}

.ws-picker-modal.kind-worker .ws-picker-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}

.ws-picker-modal.kind-worker .ws-picker-body {
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
}

.ws-picker-modal.kind-worker .picker-worker {
  grid-template-columns: minmax(0, 1fr);
  max-height: min(34dvh, 270px);
  padding: 10px;
  border-right: 0;
  border-bottom: 1px solid var(--line);
}

.ws-picker-modal.kind-worker .wsp-pick-side {
  width: 100%;
  max-height: none;
  padding: 14px 14px 0;
  overflow: visible;
}

.ws-picker-modal.kind-worker .wsp-pick-side-foot {
  margin-inline: -14px;
  padding: 12px 14px max(12px, env(safe-area-inset-bottom));
}
```

- [ ] **Step 4: 运行响应式和夜间主题测试**

Run: `npm run test:responsive && npm run test:night-theme`

Expected: 两项均 PASS；员工弹窗的桌面双栏断言仍通过。

- [ ] **Step 5: 检查改动边界**

Run: `git diff --check -- public/styles.css scripts/responsive-layout-smoke.mjs`

Expected: 无空白或语法错误，且未修改 `public/workshop-module.js`。

---

### Task 3: 真实浏览器复测和桌面回归检查

**Files:**
- Verify: `public/styles.css`
- Verify: `scripts/responsive-layout-smoke.mjs`

**Interfaces:**
- Consumes: Task 1 和 Task 2 的移动端 CSS 契约。
- Produces: 手机端无横向溢出、完整员工详情可访问、桌面布局无变化的验证证据。

- [ ] **Step 1: 运行相关自动化测试**

Run: `npm run test:responsive && npm run test:night-theme && npm run test:ui && npm run test:worker-detail-view`

Expected: 四项全部 PASS。

- [ ] **Step 2: 在 360×800 复测顶部和左侧页签**

浏览器检查：

```js
({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  player: document.querySelector(".topbar .player-card").getBoundingClientRect(),
  resource: document.querySelector(".mobile-resources-toggle").getBoundingClientRect(),
  theme: document.querySelector(".theme-toggle").getBoundingClientRect(),
  navIcon: document.querySelector(".nav-ico").getBoundingClientRect(),
  navFont: getComputedStyle(document.querySelector(".main-nav-item")).fontSize
})
```

Expected: `overflow === 0`；三个顶部控件高度均为 44；图标 24×24；页签文字为 11px。

- [ ] **Step 3: 在 360×800 复测员工详情**

打开“工坊 → 打磨机 → 选择员工”，选择任一员工后检查：

```js
({
  bodyWidth: document.querySelector(".ws-picker-body").getBoundingClientRect().width,
  bodyScrollWidth: document.querySelector(".ws-picker-body").scrollWidth,
  sideWidth: document.querySelector(".wsp-pick-side").getBoundingClientRect().width,
  sideRight: document.querySelector(".wsp-pick-side").getBoundingClientRect().right,
  viewportWidth: innerWidth
})
```

Expected: `bodyScrollWidth <= bodyWidth + 1`；详情右边界不超过视口；纵向滚动可到达技能末尾和确认按钮。

- [ ] **Step 4: 复测 390×844 与 412×915**

Expected: 两个尺寸均无页面横向溢出，顶部名称省略稳定，资源按钮和主题按钮对齐，员工详情完整可滚动。

- [ ] **Step 5: 在 1440×900 复测桌面端**

Expected: 侧栏保持桌面宽度；顶部资源条保持现有结构；员工选择弹窗仍为左右双栏，`.ws-picker-body` 计算列宽均不低于 320px 和 360px。

- [ ] **Step 6: 最终差异复核**

Run: `git diff --check && git status --short`

Expected: 无格式错误；最终交付清单仅声明本任务实际改动的两个文件，不覆盖或误报工作区已有的其他改动。
