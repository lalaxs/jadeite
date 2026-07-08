# Location-Based Main Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a location-card homepage and player-status sidebar, with server-authoritative ownership gates for workshop and livestream access.

**Architecture:** Keep the existing Socket.IO game loop and existing feature views. Add a thin server state layer for owned assets and purchasable asset listings, then add a frontend location shell that routes to existing views. Tests stay as smoke scripts because this project currently validates most UI contracts through source-token checks.

**Tech Stack:** Node.js, Express, Socket.IO, native HTML/CSS/JavaScript, existing smoke scripts under `scripts/`.

## Global Constraints

- Do not rewrite the core auction, production, order, livestream, renderer, or jade rules systems.
- Public locked places are visible but do not enter their view until unlocked.
- Private owned places are hidden until owned; `workshop` is private owned content.
- Service-side state is authoritative for asset ownership.
- Use `spendCash`, `earnCash`, and `recordLedger` helpers for money changes.
- Preserve existing `data-view` feature sections and existing socket event names where possible.
- Keep card border radii at 8px or less.
- Do not add new runtime dependencies.
- Verification command for completion is `npm test`.

---

## File Structure

- Modify `server.js`: asset defaults, asset listing helpers, purchase event, server-side gates, test hooks.
- Modify `public/index.html`: replace sidebar tab container with status containers; replace overview command area with location card container; retain existing feature views.
- Modify `public/main.js`: location metadata, sidebar renderer, location renderer, asset listing renderer, click handlers, view title mapping.
- Modify `public/styles.css`: sidebar status, reminders, location card grid, locked/owned visual states, responsive adjustments.
- Modify `scripts/server-idle-smoke.mjs`: state and server behavior tests.
- Modify `scripts/simplified-flow-smoke.mjs`: source-token UI contract tests.

---

### Task 1: Server Asset Ownership And Gates

**Files:**
- Modify: `server.js`
- Test: `scripts/server-idle-smoke.mjs`

**Interfaces:**
- Produces: `player.assets.workshopOwned: boolean`
- Produces: `player.assets.livestreamPermitOwned: boolean`
- Produces: `assetListingsForPlayer(player): Array<{ id, type, name, price, description }>`
- Produces: `buyAssetListingForPlayer(player, listingId): { ok, message, listing? }`
- Produces: `playerOwnsWorkshop(player): boolean`
- Produces: `playerCanLivestream(player): boolean`
- Consumes: existing `spendCash(player, amount, note, meta)` and `broadcast()`

- [ ] **Step 1: Add failing smoke assertions**

In `scripts/server-idle-smoke.mjs`, extend the `__testHooks` destructuring near the top:

```js
  assetListingsForPlayer,
  buyAssetListingForPlayer,
  playerOwnsWorkshop,
  playerCanLivestream,
```

Add this block after the existing `normalizePlayer(existingEmptyPlayer);` checks:

```js
const assetPlayer = makeEmptyPlayer("asset-player");
normalizePlayer(assetPlayer);
assert.equal(assetPlayer.assets.workshopOwned, false);
assert.equal(assetPlayer.assets.livestreamPermitOwned, false);
assert.equal(playerOwnsWorkshop(assetPlayer), false);
assert.equal(playerCanLivestream(assetPlayer), false);
let assetListings = assetListingsForPlayer(assetPlayer);
assert.deepEqual(assetListings.map((listing) => listing.id), ["starter-workshop", "livestream-permit"]);

const cashBeforeWorkshop = assetPlayer.cash;
const workshopPurchase = buyAssetListingForPlayer(assetPlayer, "starter-workshop");
assert.equal(workshopPurchase.ok, true);
assert.equal(assetPlayer.assets.workshopOwned, true);
assert.equal(playerOwnsWorkshop(assetPlayer), true);
assert.equal(assetPlayer.cash, cashBeforeWorkshop - 12000);
assetListings = assetListingsForPlayer(assetPlayer);
assert.deepEqual(assetListings.map((listing) => listing.id), ["livestream-permit"]);

const repeatedWorkshopPurchase = buyAssetListingForPlayer(assetPlayer, "starter-workshop");
assert.equal(repeatedWorkshopPurchase.ok, false);
assert.match(repeatedWorkshopPurchase.message, /已经拥有/);

const cashBeforePermit = assetPlayer.cash;
const permitPurchase = buyAssetListingForPlayer(assetPlayer, "livestream-permit");
assert.equal(permitPurchase.ok, true);
assert.equal(assetPlayer.assets.livestreamPermitOwned, true);
assert.equal(playerCanLivestream(assetPlayer), true);
assert.equal(assetPlayer.cash, cashBeforePermit - 8000);
assert.deepEqual(assetListingsForPlayer(assetPlayer), []);
```

Add this block before the current first successful `scheduleLivestream(...)` assertion:

```js
const gatedLivestreamPlayer = makeEmptyPlayer("gated-livestream-player");
normalizePlayer(gatedLivestreamPlayer);
const gatedLiveProduct = testProduct("gated-live-product");
gatedLivestreamPlayer.bracelets.push(gatedLiveProduct);
assert.equal(scheduleLivestream(gatedLivestreamPlayer, gatedLiveProduct.id, "autoBalanced"), null);
assert.equal(gatedLivestreamPlayer.bracelets.length, 1);
gatedLivestreamPlayer.assets.livestreamPermitOwned = true;
```

For each existing player that calls `scheduleLivestream(...)` or `sellLivestreamNow(...)`, set the permit before the call:

```js
livestreamPlayer.assets.livestreamPermitOwned = true;
unsoldLivestreamPlayer.assets.livestreamPermitOwned = true;
offlineLivestreamPlayer.assets.livestreamPermitOwned = true;
manualLivestreamPlayer.assets.livestreamPermitOwned = true;
```

- [ ] **Step 2: Run the focused smoke test and confirm it fails**

Run:

```bash
npm run test:server-idle
```

Expected: fail because `assetListingsForPlayer`, `buyAssetListingForPlayer`, `playerOwnsWorkshop`, `playerCanLivestream`, and `player.assets` do not exist yet.

- [ ] **Step 3: Add asset constants and helper functions**

In `server.js`, after `const STARTER_ROUGH_COUNT = 3;`, add:

```js
const ASSET_LISTINGS = [
  {
    id: "starter-workshop",
    type: "workshop",
    name: "街角小工坊",
    price: 12000,
    description: "解锁自己的打磨与取件工位。"
  },
  {
    id: "livestream-permit",
    type: "livestreamPermit",
    name: "直播经营许可",
    price: 8000,
    description: "解锁直播间和自动直播卖货。"
  }
];
```

After `publicAuctionHalls(player)`, add:

```js
function normalizeAssets(player) {
  player.assets ||= {};
  player.assets.workshopOwned = Boolean(player.assets.workshopOwned);
  player.assets.livestreamPermitOwned = Boolean(player.assets.livestreamPermitOwned);
  return player.assets;
}

function playerOwnsWorkshop(player) {
  normalizePlayer(player);
  return Boolean(player.assets.workshopOwned);
}

function playerCanLivestream(player) {
  normalizePlayer(player);
  return Boolean(player.assets.livestreamPermitOwned);
}

function assetListingsForPlayer(player) {
  normalizePlayer(player);
  return ASSET_LISTINGS.filter((listing) => {
    if (listing.type === "workshop") return !player.assets.workshopOwned;
    if (listing.type === "livestreamPermit") return !player.assets.livestreamPermitOwned;
    return false;
  });
}

function buyAssetListingForPlayer(player, listingId) {
  if (!player) return { ok: false, message: "未找到玩家。" };
  normalizePlayer(player);
  const listing = ASSET_LISTINGS.find((item) => item.id === listingId);
  if (!listing) return { ok: false, message: "资产挂单不存在。" };
  if (listing.type === "workshop" && player.assets.workshopOwned) {
    return { ok: false, message: "你已经拥有自己的工坊。" };
  }
  if (listing.type === "livestreamPermit" && player.assets.livestreamPermitOwned) {
    return { ok: false, message: "你已经拥有直播经营许可。" };
  }
  if (!spendCash(player, listing.price, `购入资产：${listing.name}`, { source: "asset", itemId: listing.id })) {
    return { ok: false, message: `购买 ${listing.name} 需要 ${listing.price}。` };
  }
  if (listing.type === "workshop") player.assets.workshopOwned = true;
  if (listing.type === "livestreamPermit") player.assets.livestreamPermitOwned = true;
  refreshPlayerReport(player);
  return { ok: true, message: `${listing.name} 已归入名下。`, listing };
}
```

- [ ] **Step 4: Initialize and normalize assets**

In `makePlayer()`, add this field after `satisfaction: 72,`:

```js
    assets: {
      workshopOwned: false,
      livestreamPermitOwned: false
    },
```

In `normalizePlayer(player)`, after normalizing `rep`, add:

```js
  normalizeAssets(player);
```

- [ ] **Step 5: Expose asset listings in snapshots**

In `snapshotFor(player, now = Date.now())`, add this property after `listings: state.listings.map(publicListing),`:

```js
    assetListings: assetListingsForPlayer(player),
```

- [ ] **Step 6: Gate workshop and livestream helpers**

At the top of `scheduleLivestream(player, productId, mode = "autoBalanced")`, after `normalizePlayer(player);`, add:

```js
  if (!playerCanLivestream(player)) return null;
```

At the top of `sellLivestreamNow(player, productId, seed = Date.now())`, after `normalizePlayer(player);`, add:

```js
  if (!playerCanLivestream(player)) return null;
```

In the `socket.on("startPolish", ...)` handler, after `normalizePlayer(player);`, add:

```js
    if (!playerOwnsWorkshop(player)) return socket.emit("toast", "先去交易行买下街角小工坊。");
```

In the `socket.on("extractFromRough", ...)` handler, after `normalizePlayer(player);`, add:

```js
    if (!playerOwnsWorkshop(player)) return socket.emit("toast", "先去交易行买下街角小工坊。");
```

In the `socket.on("scheduleLivestream", ...)` handler, change the failure toast to:

```js
    if (!job) return socket.emit("toast", playerCanLivestream(player) ? "找不到可直播的成品。" : "先去交易行购买直播经营许可。");
```

In the `socket.on("livestreamSell", ...)` handler, change the failure branch to:

```js
    if (!sale) return socket.emit("toast", playerCanLivestream(player) ? "找不到可直播的成品。" : "先去交易行购买直播经营许可。");
```

- [ ] **Step 7: Add asset purchase socket event**

Before `socket.on("buyListing", ...)`, add:

```js
  socket.on("buyAssetListing", (listingId) => {
    const player = getPlayer(socket);
    const result = buyAssetListingForPlayer(player, listingId);
    socket.emit("toast", result.message);
    if (result.ok) {
      addNews(`${player.name} 买下 ${result.listing.name}。`, "trade");
      broadcast();
    }
  });
```

- [ ] **Step 8: Export test hooks**

In `export const __testHooks = { ... }`, add:

```js
  assetListingsForPlayer,
  buyAssetListingForPlayer,
  playerOwnsWorkshop,
  playerCanLivestream,
```

- [ ] **Step 9: Run the focused smoke test and commit**

Run:

```bash
npm run test:server-idle
```

Expected: pass.

Commit:

```bash
git add server.js scripts/server-idle-smoke.mjs
git commit -m "feat: add location asset ownership gates"
```

---

### Task 2: Location Homepage And Sidebar State

**Files:**
- Modify: `public/index.html`
- Modify: `public/main.js`
- Test: `scripts/simplified-flow-smoke.mjs`

**Interfaces:**
- Consumes: `state.me.assets`, `state.assetListings`, existing `auctionPhaseMeta()`, `gameClock()`, `productionJobsFor(me)`
- Produces: `renderPlayerSidebar()`
- Produces: `renderLocationCards()`
- Produces: `locationDefinitions`
- Produces: `locationGate(location)`

- [ ] **Step 1: Add failing UI contract checks**

In `scripts/simplified-flow-smoke.mjs`, near the existing auction UI expectations, add:

```js
const locationUiExpectations = [
  [/id="sidebarStatus"/, "index.html should expose a sidebar status container"],
  [/id="locationCards"/, "index.html should expose a location card container"],
  [/const locationDefinitions\s*=/, "main.js should define location cards separately from feature views"],
  [/function renderPlayerSidebar\b/, "main.js should render player status in the left sidebar"],
  [/function renderLocationCards\b/, "main.js should render location cards on the overview"],
  [/function locationGate\b/, "main.js should centralize location lock logic"],
  [/公盘会场/, "location cards should include the public auction place"],
  [/交易行/, "location cards should include the market place"],
  [/客户茶室/, "location cards should include orders as a place"],
  [/经营账房/, "location cards should include reports as a place"],
  [/直播间/, "location cards should include livestream as a locked public place"],
  [/我的工坊/, "location cards should include the owned workshop place"],
  [/workshopOwned/, "main.js should use server-owned workshop state"],
  [/livestreamPermitOwned/, "main.js should use server-owned livestream permit state"],
  [/buyAssetListing/, "main.js should emit asset purchase actions"]
];

for (const [pattern, message] of locationUiExpectations) {
  if (!pattern.test(index) && !pattern.test(main)) throw new Error(message);
}

if (/<nav class="tabs" id="tabs"><\/nav>/.test(index)) {
  throw new Error("left sidebar should no longer expose the old tab navigation container");
}
```

- [ ] **Step 2: Run the focused smoke test and confirm it fails**

Run:

```bash
npm run test:flow
```

Expected: fail because the new sidebar and location contracts do not exist.

- [ ] **Step 3: Update overview and sidebar containers**

In `public/index.html`, replace the `<nav class="tabs" id="tabs"></nav>` line with:

```html
        <section class="sidebar-status panel" id="sidebarStatus" aria-label="掌柜状态"></section>
```

Inside `<section class="view active" data-view="overview">`, replace the existing `command-grid` block with:

```html
          <section class="location-board">
            <div class="section-head">
              <div>
                <p class="eyebrow">翡翠街</p>
                <h3>今天去哪儿</h3>
              </div>
            </div>
            <div id="locationCards" class="location-grid"></div>
          </section>
```

Keep the existing `dashboard-grid` below it.

- [ ] **Step 4: Replace tab metadata with view and location metadata**

In `public/main.js`, replace `const tabs = [...]` with:

```js
const viewLabels = {
  overview: "翡翠街",
  auction: "公盘会场",
  workshop: "我的工坊",
  market: "交易行",
  livestream: "直播间",
  orders: "客户茶室",
  collection: "藏宝阁",
  reports: "经营账房"
};

const locationDefinitions = [
  { id: "auction", view: "auction", label: "公盘会场", icon: "石", type: "public", summary: "暗标拍原石，开窗会公开信息。", cta: "去公盘" },
  { id: "market", view: "market", label: "交易行", icon: "市", type: "public", summary: "买卖原石、成品和经营许可。", cta: "逛交易行" },
  { id: "orders", view: "orders", label: "客户茶室", icon: "单", type: "public", summary: "接定制单，换现金和口碑。", cta: "看订单" },
  { id: "collection", view: "collection", label: "藏宝阁", icon: "誉", type: "public", summary: "收藏精品，提高门面声望。", cta: "看藏品" },
  { id: "reports", view: "reports", label: "经营账房", icon: "报", type: "public", summary: "查看现金流、库存占用和建议。", cta: "看账本" },
  { id: "livestream", view: "livestream", label: "直播间", icon: "播", type: "lockedPublic", summary: "自动直播卖货，适合处理成品库存。", cta: "开直播", purchaseId: "livestream-permit" },
  { id: "workshop", view: "workshop", label: "我的工坊", icon: "作", type: "ownedPrivate", summary: "打磨原石、取件、精加工。", cta: "进工坊", ownershipKey: "workshopOwned" }
];
```

- [ ] **Step 5: Update element references**

In the `els` object, replace `tabs: document.querySelector("#tabs"),` with:

```js
  sidebarStatus: document.querySelector("#sidebarStatus"),
  locationCards: document.querySelector("#locationCards"),
```

- [ ] **Step 6: Add sidebar and location helpers**

After `function empty(text) { ... }`, add:

```js
function inventoryCounts(me = {}) {
  const productionJobs = productionJobsFor(me);
  return {
    sealed: (me.rough || []).filter((rough) => !rough.revealed).length,
    revealed: (me.rough || []).filter((rough) => rough.revealed).length,
    jobs: productionJobs.length,
    products: (me.bracelets || []).length,
    collection: (me.collection || []).length
  };
}

function reminderRows() {
  if (!state?.me) return [];
  const { me } = state;
  const reminders = [];
  const jobs = productionJobsFor(me);
  const completable = (me.orders || []).filter((order) => matchingBracelets(order).length >= order.quantity);
  if (me.offlineSummary) reminders.push(["离线结算", `${me.offlineSummary.count} 件事已发生`]);
  if (!me.assets?.workshopOwned) reminders.push(["工坊未开", "去交易行买下街角小工坊"]);
  if (!me.assets?.livestreamPermitOwned && (me.bracelets || []).length) reminders.push(["直播未开", "成品可卖，先买直播许可"]);
  if (completable.length) reminders.push(["订单可交", `${completable.length} 个客户能交付`]);
  if (jobs.length) reminders.push(["加工中", `${jobs.length} 个任务等待完成`]);
  if (me.cash < 1000) reminders.push(["现金紧张", "优先回笼库存"]);
  return reminders.slice(0, 5);
}

function renderPlayerSidebar() {
  if (!els.sidebarStatus || !state?.me) return;
  const { me } = state;
  const counts = inventoryCounts(me);
  const auctionMeta = auctionPhaseMeta();
  const reminders = reminderRows();
  els.sidebarStatus.innerHTML = `
    <div class="sidebar-block">
      <p class="eyebrow">掌柜状态</p>
      <div class="status-metric"><span>现金</span><strong>${formatMoney(me.cash)}</strong></div>
      <div class="status-metric"><span>声望</span><strong>${Math.round(me.rep)} · ${repTier(me.rep)}</strong></div>
      <div class="status-metric"><span>满意</span><strong>${Math.round(me.satisfaction)}%</strong></div>
    </div>
    <div class="sidebar-block">
      <p class="eyebrow">库存</p>
      <div class="inventory-mini">
        <span>暗料 ${counts.sealed}</span>
        <span>加工 ${counts.jobs}</span>
        <span>明料 ${counts.revealed}</span>
        <span>成品 ${counts.products}</span>
        <span>藏品 ${counts.collection}</span>
      </div>
    </div>
    <div class="sidebar-block">
      <p class="eyebrow">时间</p>
      <div class="sidebar-clock"><strong>${gameClock()}</strong><span>${auctionMeta.label} · ${formatDuration(auctionMeta.remain)}</span></div>
    </div>
    <div class="sidebar-block">
      <p class="eyebrow">提醒</p>
      <div class="reminder-list">
        ${reminders.map(([title, text]) => `<div class="reminder-row"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></div>`).join("") || `<div class="reminder-row"><strong>暂无急事</strong><span>可以看看公盘或账房</span></div>`}
      </div>
    </div>
  `;
}

function locationGate(location) {
  const me = state?.me || {};
  if (location.type === "ownedPrivate" && !me.assets?.[location.ownershipKey]) {
    return { visible: false, locked: true, reason: "尚未拥有" };
  }
  if (location.id === "livestream" && !me.assets?.livestreamPermitOwned) {
    return { visible: true, locked: true, reason: "需要直播经营许可" };
  }
  return { visible: true, locked: false, reason: "" };
}

function locationMeta(location) {
  const me = state?.me || {};
  if (location.id === "auction") return auctionPhaseMeta().label;
  if (location.id === "market") return `市场挂单 ${(state?.listings || []).length} · 资产 ${(state?.assetListings || []).length}`;
  if (location.id === "orders") return `客户 ${(me.orders || []).length} · 满意 ${Math.round(me.satisfaction || 0)}%`;
  if (location.id === "workshop") return `任务 ${productionJobsFor(me).length} · 原石 ${(me.rough || []).length}`;
  if (location.id === "livestream") return `成品 ${(me.bracelets || []).length} · 许可 ${me.assets?.livestreamPermitOwned ? "已购" : "未购"}`;
  if (location.id === "collection") return `藏品 ${(me.collection || []).length}`;
  if (location.id === "reports") return `净额 ${formatMoney(currentReportSummary().net)}`;
  return "";
}

function renderLocationCards() {
  if (!els.locationCards || !state) return;
  const cards = locationDefinitions.flatMap((location) => {
    const gate = locationGate(location);
    if (!gate.visible) return [];
    return `
      <article class="location-card ${gate.locked ? "locked" : ""} ${activeView === location.view ? "active" : ""}" data-location="${location.id}">
        <div class="location-icon" aria-hidden="true">${location.icon}</div>
        <div>
          <p class="eyebrow">${location.type === "ownedPrivate" ? "名下资产" : "公共地点"}</p>
          <h3>${location.label}</h3>
          <p class="location-summary">${location.summary}</p>
          <p class="location-meta">${gate.locked ? gate.reason : locationMeta(location)}</p>
        </div>
        <button data-action="${gate.locked ? "lockedLocation" : "openLocation"}" data-payload="${location.id}" class="${gate.locked ? "secondary" : ""}">${gate.locked ? "查看条件" : location.cta}</button>
      </article>
    `;
  });
  els.locationCards.innerHTML = cards.join("");
}
```

- [ ] **Step 7: Update view switching and overview rendering**

In `setView(view)`, replace the tab active/title lines with:

```js
  document.querySelectorAll(".location-card").forEach((node) => node.classList.toggle("active", node.dataset.location === view));
  els.title.textContent = viewLabels[view] || "翡翠街";
```

In `render()`, after KPI signal updates and before `renderTimeHud();`, add:

```js
  renderPlayerSidebar();
```

Replace the top of `renderOverview()` so it no longer renders the removed `offlineSummary`, `nextActions`, or `pipelineList` containers. The function should start with:

```js
  renderLocationCards();
```

The rest of `renderOverview()` should keep the existing `els.players.innerHTML = ...` and `els.news.innerHTML = ...` assignments unchanged.

Replace the `initTabs()` function with:

```js
function initShell() {
  setView(activeView);
}
```

Replace the bottom call `initTabs();` with:

```js
initShell();
```

- [ ] **Step 8: Add location and asset click handling**

In the delegated body click handler, before `if (action === "requestWindow")`, add:

```js
  if (action === "openLocation") {
    const location = locationDefinitions.find((item) => item.id === payload);
    if (location) setView(location.view);
    return;
  }

  if (action === "lockedLocation") {
    const location = locationDefinitions.find((item) => item.id === payload);
    if (location?.purchaseId) {
      showToast("去交易行购买对应许可。");
      setView("market");
    } else {
      showToast("条件未满足。");
    }
    return;
  }

  if (action === "buyAssetListing") {
    socket.emit("buyAssetListing", payload);
    return;
  }
```

- [ ] **Step 9: Render asset listings in the market**

At the top of `renderMarket()`, after `const ownListings = ...`, add:

```js
  const assetListings = state.assetListings || [];
```

Change `els.marketBrief.innerHTML` to:

```js
  els.marketBrief.innerHTML = `<span>我的可卖 ${sellables.length}</span><span>我的挂单 ${ownListings.length}</span><span>市场挂单 ${state.listings.length}</span><span>资产 ${assetListings.length}</span>`;
```

Before rendering normal `state.listings`, prepend asset rows:

```js
  const assetRows = assetListings.map((listing) => `
    <div class="item-row asset-listing">
      <div class="item-title"><span>${escapeHtml(listing.name)}</span><span class="pill">${formatMoney(listing.price)}</span></div>
      <p class="item-meta">${escapeHtml(listing.description)}</p>
      <div class="card-actions"><button data-action="buyAssetListing" data-payload="${listing.id}">购买</button></div>
    </div>
  `).join("");
```

Then set:

```js
  els.marketListings.innerHTML = assetRows + (state.listings.map((listing) => {
```

and keep the existing closing:

```js
  }).join("") || empty("交易行还没有挂单。"));
```

- [ ] **Step 10: Run flow smoke and commit**

Run:

```bash
npm run test:flow
```

Expected: pass.

Commit:

```bash
git add public/index.html public/main.js scripts/simplified-flow-smoke.mjs
git commit -m "feat: add location homepage and player sidebar"
```

---

### Task 3: Location And Sidebar Styling

**Files:**
- Modify: `public/styles.css`
- Test: `scripts/simplified-flow-smoke.mjs`

**Interfaces:**
- Consumes: classes from Task 2: `.sidebar-status`, `.sidebar-block`, `.status-metric`, `.inventory-mini`, `.sidebar-clock`, `.reminder-list`, `.reminder-row`, `.location-board`, `.location-grid`, `.location-card`, `.location-icon`, `.location-summary`, `.location-meta`, `.asset-listing`
- Produces: responsive desktop and mobile styles without nested cards.

- [ ] **Step 1: Add failing style token checks**

In `scripts/simplified-flow-smoke.mjs`, after `locationUiExpectations`, add:

```js
const locationStyleExpectations = [
  [/\.sidebar-status/, "styles.css should style the player status sidebar"],
  [/\.status-metric/, "styles.css should style sidebar resource metrics"],
  [/\.reminder-row/, "styles.css should style reminder rows"],
  [/\.location-grid/, "styles.css should style the location card grid"],
  [/\.location-card\.locked/, "styles.css should style locked location cards"],
  [/\.location-icon/, "styles.css should style location icons"],
  [/\.asset-listing/, "styles.css should style purchasable asset listings"]
];

for (const [pattern, message] of locationStyleExpectations) {
  if (!pattern.test(styles)) throw new Error(message);
}
```

- [ ] **Step 2: Run the focused smoke test and confirm it fails**

Run:

```bash
npm run test:flow
```

Expected: fail because the new CSS classes do not exist.

- [ ] **Step 3: Add sidebar styles**

In `public/styles.css`, after `.profile-note strong { ... }`, add:

```css
.sidebar-status {
  display: grid;
  gap: 12px;
  padding: 14px;
}

.sidebar-block {
  display: grid;
  gap: 8px;
}

.status-metric {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 9px 10px;
  background: #fbfdfb;
}

.status-metric span,
.sidebar-clock span,
.reminder-row span {
  color: var(--muted);
  font-size: 12px;
}

.status-metric strong,
.sidebar-clock strong {
  color: var(--jade-dark);
  font-size: 14px;
}

.inventory-mini {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.inventory-mini span {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 7px 8px;
  background: #f4f8f5;
  color: var(--muted);
  font-size: 12px;
}

.sidebar-clock,
.reminder-row {
  display: grid;
  gap: 3px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 9px 10px;
  background: #fff;
}

.reminder-list {
  display: grid;
  gap: 7px;
}
```

- [ ] **Step 4: Add location card styles**

After `.card-grid { ... }`, add:

```css
.location-board {
  margin-bottom: 16px;
}

.location-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}

.location-card {
  display: grid;
  grid-template-columns: 44px 1fr;
  gap: 12px;
  min-height: 190px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: var(--shadow);
}

.location-card h3 {
  margin: 4px 0 0;
  font-size: 20px;
  letter-spacing: 0;
}

.location-card button {
  grid-column: 1 / -1;
  align-self: end;
}

.location-card.active {
  border-color: rgba(31, 155, 114, 0.48);
  background: #edf7f2;
}

.location-card.locked {
  background: #f4f5f2;
  opacity: 0.78;
}

.location-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  color: #fff;
  background: var(--jade-dark);
  font-weight: 800;
}

.location-card.locked .location-icon {
  background: var(--muted);
}

.location-summary {
  margin: 8px 0 0;
  color: var(--ink);
  font-size: 14px;
  line-height: 1.45;
}

.location-meta {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.asset-listing {
  background: linear-gradient(180deg, #fff, var(--amber-soft));
}
```

- [ ] **Step 5: Update responsive rules**

Inside `@media (max-width: 1080px)`, remove `.tabs { grid-template-columns: repeat(3, 1fr); }` and add:

```css
  .location-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
```

Inside `@media (max-width: 680px)`, remove the `.tabs` and `.tab` rules and add:

```css
  .location-grid,
  .inventory-mini {
    grid-template-columns: 1fr;
  }

  .location-card {
    grid-template-columns: 38px 1fr;
  }
```

- [ ] **Step 6: Run flow smoke and commit**

Run:

```bash
npm run test:flow
```

Expected: pass.

Commit:

```bash
git add public/styles.css scripts/simplified-flow-smoke.mjs
git commit -m "style: polish location shell"
```

---

### Task 4: Full Verification And Browser Smoke

**Files:**
- Modify only if verification finds a defect in files from Tasks 1-3.

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: final verified branch with tests passing and a local URL for review.

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

Expected: all smoke scripts pass.

- [ ] **Step 2: Start the local server**

Run:

```bash
npm start
```

Expected: terminal prints `Jade Market Prototype running at http://localhost:3000`.

- [ ] **Step 3: Browser-check the first screen**

Open:

```text
http://localhost:3000
```

Verify:

- Left sidebar shows player name, connection state, rank, resources, inventory, time, and reminders.
- Right overview shows location cards.
- `我的工坊` is absent before buying the workshop.
- `直播间` is visible and locked before buying the permit.
- `交易行` shows `街角小工坊` and `直播经营许可`.

- [ ] **Step 4: Browser-check purchase flow**

In the browser:

- Click locked `直播间`; expected: toast asks the player to buy the permit and view switches to `交易行`.
- Buy `街角小工坊`; expected: toast confirms ownership and `我的工坊` appears on the homepage.
- Buy `直播经营许可`; expected: `直播间` unlocks.
- Enter `我的工坊`; expected: existing workshop view renders.

- [ ] **Step 5: Stop the server and commit any verification fixes**

If Step 3 or Step 4 required fixes, run:

```bash
npm test
git add server.js public/index.html public/main.js public/styles.css scripts/server-idle-smoke.mjs scripts/simplified-flow-smoke.mjs
git commit -m "fix: complete location shell verification"
```

If no fixes were needed, do not create an empty commit.

---

## Subagent Execution Map

- Task 1: assign to one worker subagent because it touches server state and server smoke tests.
- Task 2: assign to one worker subagent after Task 1 lands because it consumes `state.me.assets` and `state.assetListings`.
- Task 3: assign to one worker subagent after Task 2 lands because it consumes the final class names.
- Task 4: run in the controller session for integrated verification, then request a final review subagent.

Do not dispatch Tasks 1-3 in parallel. They share files and depend on each other's interfaces.

## Self-Review Checklist

- Spec coverage: every requirement in the design document maps to Tasks 1-4.
- Placeholder scan: this plan contains concrete file paths, concrete identifiers, concrete commands, and no open-ended implementation instructions.
- Type consistency: `assets.workshopOwned`, `assets.livestreamPermitOwned`, `assetListings`, `buyAssetListing`, `starter-workshop`, and `livestream-permit` are named consistently across server, frontend, and tests.
