# Jade Livestream Stall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the livestream page's single-item timed jobs with persistent public finished-product stalls that real players and AI customers can buy from until sold out.

**Architecture:** Keep one normalized `livestreamRoom` on each player and expose active rooms through the existing per-player world snapshot. Put inventory and purchase rules in a focused server system, keep Socket.IO handlers in `server.js`, and rebuild `public/livestream-module.js` as a state-rendered room owner/public hall UI with a local visual carousel.

**Tech Stack:** Node.js ES modules, Express 5, Socket.IO 4, browser-native DOM/CSS, existing source/smoke test scripts.

## Global Constraints

- Keep the existing livestream permit as the feature unlock.
- Opening inventory must contain 3–20 finished products with one fixed integer price of at least 100 per product.
- A live room may be replenished up to 20 active items.
- Owner logout must not stop the room or AI customer processing.
- Real and AI buyers use the same listed price.
- Likes and preset comments are visual atmosphere only and must not enter purchase probability.
- An owner may close manually; unsold products return to finished inventory.
- Selling the final item closes the room automatically.
- Do not modify or discard unrelated dirty-worktree changes.
- Add no third-party dependencies.

---

### Task 1: Livestream Room Domain System

**Files:**
- Create: `server/systems/livestream-room-system.js`
- Create: `scripts/livestream-room-smoke.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `LIVESTREAM_MIN_ITEMS`, `LIVESTREAM_MAX_ITEMS`, `normalizeLivestreamRoom(player)`, `startLivestreamRoom(player, listings, options)`, `replenishLivestreamRoom(player, listings, options)`, `closeLivestreamRoom(player, options)`, `purchaseLivestreamRoomItem({ seller, buyer, itemId, buyerType, buyerName }, options)`, `processAiLivestreamRooms(players, options)`, and `publicLivestreamRoom(player, options)`.
- Uses injected callbacks for IDs, time, product validation, cash movement, inventory delivery, task progress, sale history, and news so the module remains testable without starting Socket.IO.

- [ ] **Step 1: Write failing domain tests**

Create assertions that call the planned exports:

```js
const tooSmall = startLivestreamRoom(seller, listings.slice(0, 2), deps);
assert.equal(tooSmall.ok, false);
assert.match(tooSmall.message, /至少 3 件/);

const opened = startLivestreamRoom(seller, listings.slice(0, 3), deps);
assert.equal(opened.ok, true);
assert.equal(seller.livestreamRoom.items.length, 3);
assert.equal(seller.bracelets.length, 17);

const sold = purchaseLivestreamRoomItem({
  seller,
  buyer,
  itemId: seller.livestreamRoom.items[0].id,
  buyerType: "player",
  buyerName: buyer.name
}, deps);
assert.equal(sold.ok, true);
assert.equal(buyer.bracelets.length, 1);

const closed = closeLivestreamRoom(seller, deps);
assert.equal(closed.ok, true);
assert.equal(seller.livestreamRoom, null);
assert.equal(seller.bracelets.length, 19);
```

Cover permit gating, 3/20 boundaries, duplicates, invalid prices, atomic validation, replenishment capacity, self-purchase, insufficient funds, stale item IDs, final-item auto-close, AI purchase while the seller is offline, and public-product sanitization.

- [ ] **Step 2: Run the test and verify failure**

Run: `node scripts/livestream-room-smoke.mjs`

Expected: FAIL with module-not-found for `server/systems/livestream-room-system.js`.

- [ ] **Step 3: Implement the domain system**

Use a normalized room:

```js
player.livestreamRoom = {
  id: makeId(),
  status: "live",
  startedAt: now,
  lastActivityAt: now,
  nextAiVisitAt: nextAiVisit(now, rng),
  likes: 0,
  items,
  sales: []
};
```

Validate every listing before removing any product from `player.bracelets`. Route both real-player and AI sales through `purchaseLivestreamRoomItem`; real buyers spend cash and receive the product, while both buyer types pay the seller through `earnCash`. Set `player.livestreamRoom = null` after the last item is removed.

AI purchase chance must use price ratio, product score, and seller reputation only:

```js
const ratio = price / Math.max(1, Number(product.value || product.price || 1));
const priceChance = ratio <= 0.85 ? 0.72
  : ratio <= 1 ? 0.5
  : ratio <= 1.2 ? 0.28
  : ratio <= 1.5 ? 0.1
  : 0.03;
const chance = Math.min(0.9, priceChance + scoreBoost + repBoost);
```

- [ ] **Step 4: Run domain tests**

Run: `node scripts/livestream-room-smoke.mjs`

Expected: `Livestream room checks passed`.

- [ ] **Step 5: Register the smoke test**

Add:

```json
"test:livestream-room": "node scripts/livestream-room-smoke.mjs"
```

and include `npm run test:livestream-room` in the main `test` script.

- [ ] **Step 6: Commit the domain unit**

```powershell
git add -- server/systems/livestream-room-system.js scripts/livestream-room-smoke.mjs package.json
git commit -m "feat: add persistent livestream room domain"
```

### Task 2: Server State, Snapshots, Socket Actions, and AI Loop

**Files:**
- Modify: `server.js`
- Modify: `scripts/server-idle-smoke.mjs`

**Interfaces:**
- Consumes: all Task 1 domain exports.
- Produces Socket.IO events: `startLivestreamRoom`, `replenishLivestreamRoom`, `closeLivestreamRoom`, `buyLivestreamRoomItem`.
- Produces snapshot field: `livestreamRooms: PublicLivestreamRoom[]`.

- [ ] **Step 1: Add failing server integration assertions**

Extend the existing server smoke test:

```js
const snapshot = snapshotFor(viewer);
assert.equal(snapshot.livestreamRooms.length, 1);
assert.equal(snapshot.livestreamRooms[0].ownerId, seller.id);
assert.equal(Object.hasOwn(snapshot.livestreamRooms[0].items[0].product, "trueValue"), false);

const aiChanged = processLivestreamRooms(10_000, {
  rng: () => 0,
  forceVisit: true
});
assert.equal(aiChanged, true);
assert.equal(seller.livestreamRoom.items.length, 2);
```

Also assert that active room products contribute to inventory reports and public player inventory counts.

- [ ] **Step 2: Run the existing server smoke test**

Run: `node scripts/server-idle-smoke.mjs`

Expected: FAIL because snapshot and processing hooks do not yet expose rooms.

- [ ] **Step 3: Integrate normalized player state and snapshots**

Import the room system, initialize `livestreamRoom: null` in `makePlayer`, call `normalizeLivestreamRoom(player)` from `normalizePlayer`, and expose:

```js
livestreamRooms: [...state.players.values()]
  .map((owner) => publicLivestreamRoom(owner, { publicProduct: publicStone }))
  .filter(Boolean)
```

Override `livestreamRoom` in private snapshots with the same safe projection. Count active room items in `publicPlayer()` and `inventoryForReport()`.

- [ ] **Step 4: Add server transaction adapters**

Create focused wrappers in `server.js`:

```js
function startLivestreamRoomForPlayer(player, listings, now = Date.now()) {
  return startLivestreamRoom(player, listings, livestreamRoomDependencies(now));
}
```

The dependency object must use existing `money`, `spendCash`, `earnCash`, `addItem`, `advanceTask`, `publicStone`, `addNews`, and `randomUUID` helpers. Append each successful sale to `player.livestreamHistory` in the existing history shape.

- [ ] **Step 5: Add idempotent Socket.IO handlers**

Each mutation accepts `requestId` and calls `consumeRequestId`. On success, broadcast the new state. On failure, emit the returned Chinese message. A successful real purchase emits a purchase modal to the buyer and an income notification to the seller.

- [ ] **Step 6: Add offline-capable AI processing**

Run `processLivestreamRooms(Date.now())` in the existing one-second server loop. It must iterate every player, not only online players, and broadcast only when likes, sales, or room closure changed state.

- [ ] **Step 7: Run server and domain tests**

Run:

```powershell
npm run test:livestream-room
npm run test:server-idle
```

Expected: both commands pass.

- [ ] **Step 8: Commit server integration**

```powershell
git add -- server.js scripts/server-idle-smoke.mjs
git commit -m "feat: expose multiplayer livestream stalls"
```

### Task 3: Livestream Owner Controls and Public Room Cards

**Files:**
- Modify: `public/livestream-module.js`
- Modify: `public/main.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Create: `scripts/livestream-ui-smoke.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `state.me.livestreamRoom`, `state.livestreamRooms`, `finishedProducts()`, `productCanvas()`, `paintJadeCanvases()`, `formatMoney()`, `escapeHtml()`.
- Emits: the four Socket.IO mutation events from Task 2.
- Owns local-only selection, price drafts, slide indexes, preset comment rotation, and carousel timers.

- [ ] **Step 1: Write failing UI source assertions**

The smoke script reads the module, HTML, and CSS and asserts:

```js
assert.match(moduleSource, /startLivestreamRoom/);
assert.match(moduleSource, /replenishLivestreamRoom/);
assert.match(moduleSource, /closeLivestreamRoom/);
assert.match(moduleSource, /buyLivestreamRoomItem/);
assert.match(moduleSource, /3–20|3-20|至少 3 件/);
assert.match(moduleSource, /预设弹幕|livestream-comment/);
assert.match(moduleSource, /livestream-room-card/);
assert.match(stylesSource, /@media \(max-width: 700px\)/);
```

- [ ] **Step 2: Run the UI smoke test**

Run: `node scripts/livestream-ui-smoke.mjs`

Expected: FAIL because the new room UI is absent.

- [ ] **Step 3: Update page chrome**

Change the page title from automatic selling to a public hall:

```html
<div>
  <p class="eyebrow">公开营业 · AI 与玩家共逛</p>
  <h3>直播间</h3>
</div>
```

Use a normal livestream root container rather than the old generic card grid.

- [ ] **Step 4: Rebuild the livestream module**

Render these independent sections:

1. Inactive owner stock picker with selectable finished-product cards, price inputs, `X/20` counter, and a disabled start button until 3 valid products are selected.
2. Active owner room card with revenue, likes, stock count, replenishment picker, and close button.
3. Other players' active room cards.
4. Recent sale history.

Bind events once to the livestream root. Mutation payloads must contain fresh request IDs.

- [ ] **Step 5: Add visual carousel behavior**

Keep `Map<roomId, slideIndex>` in the module. Every four seconds, advance only visible room cards, update their hero image/name/price/buy control, rotate three preset comment bubbles, then call the injected canvas paint helper. Add previous/next controls so a 20-item room is browseable without waiting for the full loop.

- [ ] **Step 6: Add responsive styling**

Implement a warm dark broadcast-stage card with:

- red live badge;
- jade artwork stage;
- readable price and buy action;
- floating comment bubbles;
- compact owner metrics;
- two-column desktop owner/public layout;
- single-column layout and full-width controls at 700px and below;
- no horizontal overflow at 390px.

- [ ] **Step 7: Wire the module**

Inject `paintJadeCanvases` through `main.js`, remove the old `scheduleLivestream` click branch from the page-level dispatcher, and let the module own its controls.

- [ ] **Step 8: Run UI and existing flow tests**

Run:

```powershell
node scripts/livestream-ui-smoke.mjs
npm run test:flow
npm run test:responsive
```

Expected: all pass.

- [ ] **Step 9: Commit the UI**

```powershell
git add -- public/livestream-module.js public/main.js public/index.html public/styles.css scripts/livestream-ui-smoke.mjs package.json
git commit -m "feat: build public livestream stall UI"
```

### Task 4: Full Regression and Browser Playtest

**Files:**
- Modify only files required by verified defects found in this task.
- Save screenshots under `docs/reports/screenshots/2026-07-24/` if browser tooling supports local capture.

**Interfaces:**
- Consumes the completed server and browser UI.
- Produces verified desktop/mobile behavior and a clean regression result.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: exit code 0 with every registered smoke suite passing.

- [ ] **Step 2: Start the prototype in test timing mode**

Run: `$env:JADE_TIMING_PROFILE='test'; npm start`

Expected: local server listens on `http://localhost:3000`.

- [ ] **Step 3: Playtest two players**

Use two independent browser sessions:

1. Give seller a livestream permit and at least three finished products through the existing gameplay/test state.
2. Open a room with exactly three products.
3. Verify the public card cycles products and shows likes/comments.
4. Buy one product as the second player and verify money/item transfer.
5. Disconnect the seller and buy another product.
6. Let AI buy or buy the last product and verify automatic closure.
7. Reopen, replenish to 20, and manually close; verify every unsold item returns.

- [ ] **Step 4: Check desktop and mobile layout**

Verify at 1440×900 and 390×844. There must be no clipped price inputs, unreachable start/buy/close buttons, or horizontal page overflow.

- [ ] **Step 5: Fix only observed defects and rerun focused tests**

For each defect, add or tighten a smoke assertion before the fix, rerun the focused test, then rerun `npm test`.

- [ ] **Step 6: Record final evidence**

Capture the commands run, passing result, and screenshots/observations in the delivery response. Do not claim completion without fresh final test output.
