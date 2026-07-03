# Jade Hardcore Idle Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the prototype from direct-purchase jade crafting into the first playable hard-core idle loop: offline settlement, sealed public auction, staged production, automatic livestream sales, reputation-linked cash flow, and lightweight reports.

**Architecture:** Keep `server.js` authoritative for money, inventory, auction settlement, work completion, livestream settlement, and reports. Add small browser-safe rule modules under `public/` so timing, auction, and economy calculations can be tested without Socket.IO. Extend the existing smoke-test style instead of introducing a new framework.

**Tech Stack:** Node.js, Express, Socket.IO, native browser JavaScript modules, existing `node` smoke scripts.

---

## File Structure

- Create `public/jade-loop.js`: shared timing, ledger, offline summary, production duration, reputation, livestream, and report helpers.
- Create `public/jade-auction.js`: pure sealed-auction helpers for phases, deposits, bid normalization, deterministic AI bids, proxy settlement, and public snapshots.
- Create `scripts/jade-loop-smoke.mjs`: module-level tests for idle timing, ledger totals, livestream outcomes, and report summaries.
- Create `scripts/jade-auction-smoke.mjs`: module-level tests for sealed bids, proxy winners, AI bidder fill, and public privacy.
- Modify `scripts/simplified-flow-smoke.mjs`: static integration checks that server and client expose the new loop affordances.
- Modify `package.json`: add `test:loop`, `test:auction`, and include both in `test`.
- Modify `server.js`: add player ledger/offline summaries, auction state, production jobs, livestream jobs, and report snapshots.
- Modify `public/main.js`: add seven-page navigation affordances, sealed-auction UI, production job UI, livestream scheduling, report summary, and offline result display.
- Modify `public/styles.css`: add compact styles for countdown banners, bid forms, offline summaries, production stages, livestream cards, and report bars.
- Modify `public/index.html`: add target containers only where needed for new views and state strips.

## Task 1: Shared Idle Loop Rules

**Files:**
- Create: `public/jade-loop.js`
- Create: `scripts/jade-loop-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `scripts/jade-loop-smoke.mjs`:

```js
import assert from "node:assert/strict";
import {
  resolveTiming,
  productionDuration,
  ledgerEntry,
  cashFlowTotals,
  repFromCashFlow,
  makeOfflineSummary,
  livestreamOutcome,
  reportSummary
} from "../public/jade-loop.js";

const testTiming = resolveTiming("test");
assert.equal(testTiming.production.rough, 300);
assert.equal(testTiming.production.refine, 900);
assert.equal(testTiming.production.inlay, 300);
assert.equal(productionDuration("rough", "test"), 300);
assert.equal(productionDuration("refine", "test"), 900);
assert.equal(productionDuration("inlay", "test"), 300);

const income = ledgerEntry("income", 18000, "直播成交", { source: "livestream", at: 1 });
const spend = ledgerEntry("expense", 6200, "公盘保证金", { source: "auction", at: 2 });
assert.equal(income.amount, 18000);
assert.equal(spend.amount, -6200);

const totals = cashFlowTotals([income, spend]);
assert.equal(totals.income, 18000);
assert.equal(totals.expense, 6200);
assert.equal(totals.net, 11800);
assert.equal(repFromCashFlow("expense", 20000), 20);
assert.equal(repFromCashFlow("livestream", 25000), 20);

const summary = makeOfflineSummary([
  { type: "production", text: "粗加工完成", income: 0, expense: 0 },
  { type: "livestream", text: "直播售出一件", income: 12000, expense: 800 }
]);
assert.equal(summary.count, 2);
assert.equal(summary.income, 12000);
assert.equal(summary.expense, 800);
assert.ok(summary.lines.includes("粗加工完成"));

const conservative = livestreamOutcome(
  { id: "p1", value: 10000, score: 4, rep: 32 },
  { mode: "autoConservative", rep: 60, seed: 11 }
);
assert.equal(conservative.sold, true);
assert.ok(conservative.price >= 8000 && conservative.price <= 12000);

const aggressive = livestreamOutcome(
  { id: "p2", value: 10000, score: 2, rep: 8 },
  { mode: "autoAggressive", rep: 0, seed: 3 }
);
assert.equal(typeof aggressive.sold, "boolean");
assert.ok(aggressive.price >= 0);

const report = reportSummary([
  ledgerEntry("income", 20000, "订单", { source: "order", at: 10 }),
  ledgerEntry("income", 8000, "直播", { source: "livestream", at: 11 }),
  ledgerEntry("expense", 5000, "加工", { source: "production", at: 12 })
], [
  { value: 12000, createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000 },
  { price: 3000, createdAt: Date.now() }
]);
assert.equal(report.income, 28000);
assert.equal(report.expense, 5000);
assert.equal(report.net, 23000);
assert.ok(report.sources.order > report.sources.livestream);
assert.equal(report.staleCount, 1);
assert.ok(report.advice.length >= 1);

console.log("Jade idle loop rules checks passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/jade-loop-smoke.mjs`

Expected: FAIL with `Cannot find module` for `public/jade-loop.js`.

- [ ] **Step 3: Write minimal implementation**

Create `public/jade-loop.js`:

```js
export const TIMING_PROFILES = {
  normal: {
    production: { rough: 5 * 60 * 1000, refine: 15 * 60 * 1000, inlay: 5 * 60 * 1000 },
    auction: { preview: 10 * 60 * 1000, bidding: 30 * 60 * 1000, cadence: 60 * 60 * 1000 },
    livestream: { min: 10 * 60 * 1000, max: 30 * 60 * 1000 },
    orders: { refresh: 4 * 60 * 60 * 1000 }
  },
  test: {
    production: { rough: 300, refine: 900, inlay: 300 },
    auction: { preview: 600, bidding: 1200, cadence: 2400 },
    livestream: { min: 500, max: 1500 },
    orders: { refresh: 1500 }
  }
};

const MODE_CONFIG = {
  manual: { chance: 0.82, low: 1.0, high: 1.5 },
  autoConservative: { chance: 0.9, low: 0.8, high: 1.1 },
  autoBalanced: { chance: 0.7, low: 0.9, high: 1.2 },
  autoAggressive: { chance: 0.4, low: 1.0, high: 1.8 }
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function money(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function seededRatio(seed = 1) {
  const x = Math.sin(Number(seed) * 999 + 17) * 10000;
  return x - Math.floor(x);
}

export function resolveTiming(profile = "normal") {
  return TIMING_PROFILES[profile] || TIMING_PROFILES.normal;
}

export function productionDuration(stage, profile = "normal") {
  const timing = resolveTiming(profile);
  return timing.production[stage] || timing.production.rough;
}

export function ledgerEntry(kind, amount, note, meta = {}) {
  const rawAmount = money(amount);
  const signed = kind === "expense" ? -rawAmount : rawAmount;
  return {
    id: meta.id || `${kind}-${meta.at || Date.now()}-${Math.abs(signed)}`,
    kind,
    source: meta.source || kind,
    amount: signed,
    note: String(note || kind),
    itemId: meta.itemId,
    at: Number(meta.at || Date.now())
  };
}

export function cashFlowTotals(entries = [], since = 0, until = Infinity) {
  const scoped = entries.filter((entry) => Number(entry.at || 0) >= since && Number(entry.at || 0) <= until);
  const income = scoped.filter((entry) => entry.amount > 0).reduce((sum, entry) => sum + entry.amount, 0);
  const expense = scoped.filter((entry) => entry.amount < 0).reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
  const sources = {};
  for (const entry of scoped) {
    const key = entry.source || entry.kind || "other";
    sources[key] = (sources[key] || 0) + Math.abs(entry.amount || 0);
  }
  return { income, expense, net: income - expense, sources };
}

export function repFromCashFlow(source, amount) {
  if (!["expense", "livestream"].includes(source)) return 0;
  return Math.floor(money(amount) / 10000) * 10;
}

export function makeOfflineSummary(events = []) {
  const lines = events.map((event) => event.text).filter(Boolean);
  return {
    count: events.length,
    income: events.reduce((sum, event) => sum + money(event.income), 0),
    expense: events.reduce((sum, event) => sum + money(event.expense), 0),
    lines: lines.slice(0, 8)
  };
}

export function livestreamOutcome(product = {}, options = {}) {
  const mode = MODE_CONFIG[options.mode] ? options.mode : "autoBalanced";
  const config = MODE_CONFIG[mode];
  const seed = options.seed ?? product.id?.length ?? product.value ?? 1;
  const roll = seededRatio(seed);
  const repBoost = clamp(Number(options.rep || 0) / 900, 0, 0.24);
  const scoreBoost = clamp(Number(product.score || 1) * 0.015, 0, 0.09);
  const sold = roll < clamp(config.chance + repBoost + scoreBoost, 0.05, 0.97);
  const spread = seededRatio(Number(seed) + 41);
  const multiplier = config.low + (config.high - config.low) * spread + repBoost * 0.35;
  const price = sold ? money(Number(product.value || product.price || 0) * multiplier) : 0;
  return { sold, price, mode, multiplier: Number(multiplier.toFixed(3)) };
}

export function reportSummary(entries = [], inventory = [], now = Date.now()) {
  const totals = cashFlowTotals(entries);
  const sources = {};
  for (const entry of entries.filter((item) => item.amount > 0)) {
    sources[entry.source || "income"] = (sources[entry.source || "income"] || 0) + entry.amount;
  }
  const inventoryValue = inventory.reduce((sum, item) => sum + Number(item.value || item.price || 0), 0);
  const staleCount = inventory.filter((item) => Number(item.createdAt || now) <= now - 5 * 24 * 60 * 60 * 1000).length;
  const advice = [];
  if (totals.net < 0) advice.push("净利润为负，优先交付订单或降低公盘出价。");
  if (staleCount > 0) advice.push("存在滞销库存，可安排自动直播或降价挂牌。");
  if (totals.income === 0) advice.push("暂无收入记录，先处理可售成品或等待订单刷新。");
  if (!advice.length) advice.push("现金流健康，可以评估下一轮公盘机会。");
  return { ...totals, sources, inventoryValue: money(inventoryValue), staleCount, advice };
}
```

- [ ] **Step 4: Add package scripts**

Modify `package.json` scripts:

```json
{
  "test:loop": "node scripts/jade-loop-smoke.mjs",
  "test": "npm run test:loop && npm run test:rules && npm run test:renderer && npm run test:volume && npm run test:canvas && npm run test:flow"
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:loop`

Expected: PASS with `Jade idle loop rules checks passed`.

- [ ] **Step 6: Commit**

```bash
git add public/jade-loop.js scripts/jade-loop-smoke.mjs package.json
git commit -m "feat: add shared idle loop rules"
```

## Task 2: Shared Sealed Auction Rules

**Files:**
- Create: `public/jade-auction.js`
- Create: `scripts/jade-auction-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `scripts/jade-auction-smoke.mjs`:

```js
import assert from "node:assert/strict";
import {
  auctionPhase,
  bidDeposit,
  upsertBid,
  aiBidsForRough,
  settleAuctionRound,
  publicAuctionSnapshot
} from "../public/jade-auction.js";

const round = {
  id: "round-1",
  startsAt: 1_000,
  biddingEndsAt: 2_000,
  settlesAt: 2_000,
  roughs: [
    { id: "r1", name: "木那料", price: 10000, value: 18000, trueValue: 18000 },
    { id: "r2", name: "会卡料", price: 6000, value: 9000, trueValue: 9000 }
  ],
  bids: []
};

assert.equal(auctionPhase(round, 500), "preview");
assert.equal(auctionPhase(round, 1500), "bidding");
assert.equal(auctionPhase(round, 2500), "settled");
assert.equal(bidDeposit(10000), 2000);

const first = upsertBid(round, { playerId: "p1", roughId: "r1", amount: 12000, proxyMax: 15000, at: 1200 });
assert.equal(first.depositDelta, 2400);
assert.equal(first.round.bids.length, 1);

const second = upsertBid(first.round, { playerId: "p1", roughId: "r1", amount: 14000, proxyMax: 17000, at: 1300 });
assert.equal(second.depositDelta, 400);
assert.equal(second.round.bids[0].amount, 14000);
assert.equal(second.round.bids[0].proxyMax, 17000);

const third = upsertBid(second.round, { playerId: "p2", roughId: "r1", amount: 16500, at: 1250 });
const ai = aiBidsForRough(round.roughs[0], third.round.bids, 3);
assert.ok(ai.length >= 1);
assert.ok(ai.every((bid) => bid.ai === true));

const settled = settleAuctionRound({ ...third.round, bids: [...third.round.bids, ...ai] }, { minIncrement: 100 });
const r1 = settled.results.find((result) => result.roughId === "r1");
assert.equal(r1.winnerId, "p1");
assert.equal(r1.price, 16600);
assert.equal(r1.depositUsed, 2800);
assert.equal(r1.balanceDue, 13800);

const publicView = publicAuctionSnapshot(third.round, "p1", 1500);
assert.equal(publicView.phase, "bidding");
assert.equal(publicView.myBids.length, 1);
assert.equal(publicView.roughs[0].currentHighest, undefined);
assert.equal(publicView.roughs[0].bidderCount, undefined);

console.log("Jade sealed auction checks passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/jade-auction-smoke.mjs`

Expected: FAIL with `Cannot find module` for `public/jade-auction.js`.

- [ ] **Step 3: Write minimal implementation**

Create `public/jade-auction.js`:

```js
const DEPOSIT_RATE = 0.2;

function money(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function stableNumber(input = "") {
  let hash = 0;
  for (const char of String(input)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

export function auctionPhase(round, now = Date.now()) {
  if (!round) return "empty";
  if (now < Number(round.startsAt || 0)) return "preview";
  if (now < Number(round.biddingEndsAt || 0)) return "bidding";
  return "settled";
}

export function bidDeposit(amount) {
  return money(amount * DEPOSIT_RATE);
}

export function upsertBid(round, bid) {
  const amount = money(bid.amount);
  const proxyMax = Math.max(amount, money(bid.proxyMax || amount));
  const nextRound = {
    ...round,
    bids: (round.bids || []).filter((item) => !(item.playerId === bid.playerId && item.roughId === bid.roughId))
  };
  const previous = (round.bids || []).find((item) => item.playerId === bid.playerId && item.roughId === bid.roughId);
  const nextBid = {
    playerId: bid.playerId,
    roughId: bid.roughId,
    amount,
    proxyMax,
    at: Number(bid.at || Date.now()),
    ai: Boolean(bid.ai)
  };
  nextRound.bids.push(nextBid);
  nextRound.bids.sort((a, b) => a.at - b.at);
  return {
    round: nextRound,
    depositDelta: bidDeposit(amount) - bidDeposit(previous?.amount || 0),
    bid: nextBid
  };
}

export function aiBidsForRough(rough, existingBids = [], minBidderCount = 3) {
  const current = existingBids.filter((bid) => bid.roughId === rough.id).length;
  const needed = Math.max(0, minBidderCount - current);
  return Array.from({ length: needed }, (_, index) => {
    const seed = stableNumber(`${rough.id}-${index}`);
    const ratio = 0.6 + (seed % 36) / 100;
    const amount = money((rough.trueValue || rough.value || rough.price) * ratio);
    return {
      playerId: `ai-${rough.id}-${index}`,
      roughId: rough.id,
      amount,
      proxyMax: amount,
      at: Number(rough.createdAt || 0) + index + 1,
      ai: true
    };
  });
}

export function settleAuctionRound(round, options = {}) {
  const minIncrement = money(options.minIncrement || 100);
  const results = (round.roughs || []).map((rough) => {
    const bids = (round.bids || []).filter((bid) => bid.roughId === rough.id).sort((a, b) => {
      const maxDiff = (b.proxyMax || b.amount) - (a.proxyMax || a.amount);
      return maxDiff || a.at - b.at;
    });
    if (!bids.length) {
      return { roughId: rough.id, status: "passed", price: 0, bids: 0 };
    }
    const winner = bids[0];
    const runnerUp = bids[1];
    const floor = Math.max(rough.price || 0, winner.amount || 0);
    const justWin = runnerUp ? (runnerUp.proxyMax || runnerUp.amount) + minIncrement : floor;
    const price = money(Math.min(winner.proxyMax || winner.amount, Math.max(floor, justWin)));
    const depositUsed = bidDeposit(winner.amount);
    return {
      roughId: rough.id,
      winnerId: winner.playerId,
      ai: Boolean(winner.ai),
      status: winner.ai ? "aiWon" : "won",
      price,
      depositUsed,
      balanceDue: Math.max(0, price - depositUsed),
      bids: bids.length
    };
  });
  return { ...round, status: "settled", settledAt: options.now || Date.now(), results };
}

export function publicAuctionSnapshot(round, playerId, now = Date.now()) {
  const phase = auctionPhase(round, now);
  return {
    id: round?.id,
    phase,
    startsAt: round?.startsAt,
    biddingEndsAt: round?.biddingEndsAt,
    roughs: (round?.roughs || []).map((rough) => ({
      id: rough.id,
      name: rough.name,
      price: rough.price,
      deposit: bidDeposit(rough.price),
      mass: rough.mass,
      hint: rough.hint,
      risk: rough.risk,
      expertClues: rough.expertClues,
      windows: rough.windows,
      visual: rough.visual
    })),
    myBids: (round?.bids || [])
      .filter((bid) => bid.playerId === playerId)
      .map((bid) => ({
        roughId: bid.roughId,
        amount: bid.amount,
        proxyMax: bid.proxyMax,
        deposit: bidDeposit(bid.amount),
        at: bid.at
      })),
    results: phase === "settled" ? (round?.results || []).filter((result) => result.winnerId === playerId || !result.winnerId) : []
  };
}
```

- [ ] **Step 4: Add package scripts**

Modify `package.json` scripts:

```json
{
  "test:auction": "node scripts/jade-auction-smoke.mjs",
  "test": "npm run test:loop && npm run test:auction && npm run test:rules && npm run test:renderer && npm run test:volume && npm run test:canvas && npm run test:flow"
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:auction`

Expected: PASS with `Jade sealed auction checks passed`.

- [ ] **Step 6: Commit**

```bash
git add public/jade-auction.js scripts/jade-auction-smoke.mjs package.json
git commit -m "feat: add sealed auction rules"
```

## Task 3: Server Idle State, Ledger, And Offline Summary

**Files:**
- Modify: `server.js`
- Modify: `scripts/simplified-flow-smoke.mjs`

- [ ] **Step 1: Add integration expectations to the smoke test**

Append these checks to `scripts/simplified-flow-smoke.mjs` before the final `console.log`:

```js
const idleServerExpectations = [
  [/from "\.\/public\/jade-loop\.js"/, "server should import shared idle loop rules"],
  [/ledger\s*:\s*\[\]/, "player state should include a ledger"],
  [/offlineSummary/, "player state should include offline summary data"],
  [/function recordLedger/, "server should record income and expenses through one helper"],
  [/function spendCash/, "server should spend cash through one helper"],
  [/function earnCash/, "server should earn cash through one helper"],
  [/function settleOfflinePlayer/, "server should settle offline progress when players connect"],
  [/lastSeenAt/, "server should track last seen timestamps"],
  [/makeOfflineSummary/, "server should use shared offline summary formatting"],
  [/repFromCashFlow/, "server should award reputation from qualifying cash flow"]
];

for (const [pattern, message] of idleServerExpectations) {
  if (!pattern.test(server)) throw new Error(message);
}

const idleFrontendExpectations = [
  [/offlineSummary/, "main.js should render offline summaries"],
  [/renderOfflineSummary/, "main.js should have a focused offline summary renderer"],
  [/reportSummary/, "main.js should render lightweight report summaries"]
];

for (const [pattern, message] of idleFrontendExpectations) {
  if (!pattern.test(main)) throw new Error(message);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:flow`

Expected: FAIL with `server should import shared idle loop rules`.

- [ ] **Step 3: Add imports and timing profile**

Modify the top of `server.js`:

```js
import {
  resolveTiming,
  productionDuration,
  ledgerEntry,
  repFromCashFlow,
  makeOfflineSummary,
  livestreamOutcome,
  reportSummary
} from "./public/jade-loop.js";
```

Add near constants:

```js
const TIMING_PROFILE = process.env.JADE_TIMING_PROFILE || "normal";
const TIMING = resolveTiming(TIMING_PROFILE);
const POLISH_DURATION_MS = productionDuration("rough", TIMING_PROFILE);
```

Remove the old `const POLISH_DURATION_MS = 12000;` line so there is one duration source.

- [ ] **Step 4: Extend player state**

In `makePlayer`, change starting cash and add ledger fields:

```js
cash: 30000,
rep: 0,
offlineSummary: null,
ledger: [],
lastSeenAt: Date.now(),
reports: [],
```

In `normalizePlayer`, add:

```js
player.ledger ||= [];
player.offlineSummary ||= null;
player.reports ||= [];
player.lastSeenAt ||= Date.now();
```

- [ ] **Step 5: Add cash-flow helpers**

Add below `money(value)`:

```js
function recordLedger(player, kind, amount, note, meta = {}) {
  const entry = ledgerEntry(kind, amount, note, meta);
  player.ledger.unshift(entry);
  player.ledger = player.ledger.slice(0, 200);
  const repSource = entry.kind === "expense" ? "expense" : entry.source;
  const repGain = repFromCashFlow(repSource, Math.abs(entry.amount));
  if (repGain) player.rep += repGain;
  return entry;
}

function spendCash(player, amount, note, meta = {}) {
  const cost = money(amount);
  if (player.cash < cost) return false;
  player.cash -= cost;
  recordLedger(player, "expense", cost, note, meta);
  return true;
}

function earnCash(player, amount, note, meta = {}) {
  const income = money(amount);
  player.cash += income;
  recordLedger(player, "income", income, note, meta);
  return income;
}
```

- [ ] **Step 6: Replace direct cash mutations in existing events**

Replace each direct mutation with the helper:

```js
if (!spendCash(player, rough.price, `公盘成交：${rough.name}`, { source: "auction", itemId: rough.id })) {
  return socket.emit("toast", "资金不足，拍不下这块料。");
}
```

```js
if (!spendCash(player, fee, `开窗：${rough.name}`, { source: "window", itemId: rough.id })) {
  return socket.emit("toast", `开窗费需要 ${fee}。`);
}
```

```js
if (!spendCash(player, POLISH_FEE, `粗加工：${rough.name}`, { source: "production", itemId: rough.id })) {
  player.rough.push(rough);
  return socket.emit("toast", "加工费不够。");
}
```

```js
earnCash(player, finalPrice, `直播成交：${bracelet.name}`, { source: "livestream", itemId: bracelet.id });
```

```js
earnCash(player, finalPay, `订单交付：${order.client}`, { source: "order", itemId: order.id });
```

```js
if (!spendCash(player, 300, "刷新客户", { source: "orderRefresh" })) return socket.emit("toast", "刷新客户需要 300。");
```

- [ ] **Step 7: Add offline settlement**

Add below `processPolishingJobs`:

```js
function settleOfflinePlayer(player, now = Date.now()) {
  normalizePlayer(player);
  const events = [];
  const ready = player.polishingJobs.filter((job) => job.readyAt <= now);
  if (ready.length) {
    player.polishingJobs = player.polishingJobs.filter((job) => job.readyAt > now);
    for (const job of ready) {
      const polished = revealPolishedRough(job.rough);
      player.rough.push(polished);
      player.rep += Math.max(1, Math.round(polished.rep * 0.45));
      events.push({ type: "production", text: `${polished.name} 加工完成`, income: 0, expense: 0 });
      addNews(`${player.name} 完成 ${polished.name} 加工，料性完全揭露。`, polished.score >= 4 ? "great" : "craft");
    }
  }
  player.orders = player.orders.filter((order) => order.expiresAt > now);
  refillOrders(player);
  player.offlineSummary = events.length ? makeOfflineSummary(events) : null;
  player.lastSeenAt = now;
  player.reports = [reportSummary(player.ledger, [...player.rough, ...player.materials, ...player.slices, ...player.bracelets], now)];
  return events;
}
```

Call it after a player is created or fetched in `io.on("connection")`:

```js
const player = state.players.get(playerId);
settleOfflinePlayer(player);
```

- [ ] **Step 8: Include reports in snapshots**

In `privatePlayerSnapshot`, include normalized `ledger`, `offlineSummary`, and `reports` by keeping the existing `...player` spread and ensuring these fields are initialized before the spread. No extra code is needed after `normalizePlayer(player)` is in place.

- [ ] **Step 9: Run test to verify it passes**

Run: `npm run test:flow`

Expected: PASS through the new idle integration expectations.

- [ ] **Step 10: Commit**

```bash
git add server.js scripts/simplified-flow-smoke.mjs
git commit -m "feat: add idle cash flow and offline summaries"
```

## Task 4: Server Sealed Auction Integration

**Files:**
- Modify: `server.js`
- Modify: `scripts/simplified-flow-smoke.mjs`

- [ ] **Step 1: Add integration expectations to the smoke test**

Append these checks to `scripts/simplified-flow-smoke.mjs` before the final `console.log`:

```js
const auctionServerExpectations = [
  [/from "\.\/public\/jade-auction\.js"/, "server should import shared auction rules"],
  [/auction\s*:\s*null/, "state should include current auction"],
  [/function ensureAuctionRound/, "server should create auction rounds"],
  [/function settleAuctionIfDue/, "server should settle due auction rounds"],
  [/submitAuctionBid/, "server should expose submitAuctionBid"],
  [/publicAuctionSnapshot/, "server snapshots should use public auction snapshots"],
  [/aiBidsForRough/, "server settlement should fill missing bidders with AI"],
  [/bidDeposit/, "server should calculate auction deposits through shared rules"],
  [/settleAuctionRound/, "server should settle sealed bids through shared rules"]
];

for (const [pattern, message] of auctionServerExpectations) {
  if (!pattern.test(server)) throw new Error(message);
}

if (/data-action="buyRough"/.test(main)) {
  throw new Error("main.js should no longer expose direct buyRough auction purchase buttons");
}

for (const token of ["submitAuctionBid", "代理上限", "提交暗标", "myBids"]) {
  if (!main.includes(token)) throw new Error(`main.js should expose sealed auction UI token: ${token}`);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:flow`

Expected: FAIL with `server should import shared auction rules`.

- [ ] **Step 3: Import auction rules**

Modify the top of `server.js`:

```js
import {
  publicAuctionSnapshot,
  bidDeposit,
  upsertBid,
  aiBidsForRough,
  settleAuctionRound
} from "./public/jade-auction.js";
```

- [ ] **Step 4: Add auction state**

Change `state`:

```js
const state = {
  players: new Map(),
  sockets: new Map(),
  roughPool: [],
  listings: [],
  news: [],
  auction: null
};
```

- [ ] **Step 5: Add round creation**

Add below `refreshRoughPool()`:

```js
function ensureAuctionRound(now = Date.now()) {
  if (state.auction && !state.auction.settledAt) return state.auction;
  refreshRoughPool();
  const startsAt = now;
  const biddingEndsAt = now + TIMING.auction.bidding;
  state.auction = {
    id: randomUUID(),
    status: "bidding",
    startsAt,
    biddingEndsAt,
    settlesAt: biddingEndsAt,
    roughs: state.roughPool.slice(0, 8),
    bids: [],
    results: []
  };
  addNews("新一轮公盘暗标开启，投标期间不显示最高价。", "info");
  return state.auction;
}
```

- [ ] **Step 6: Add auction settlement**

Add below `ensureAuctionRound`:

```js
function settleAuctionIfDue(now = Date.now()) {
  const round = ensureAuctionRound(now);
  if (round.settledAt || now < round.biddingEndsAt) return false;
  const withAi = {
    ...round,
    bids: [
      ...(round.bids || []),
      ...round.roughs.flatMap((rough) => aiBidsForRough(rough, round.bids, 3))
    ]
  };
  const settled = settleAuctionRound(withAi, { now, minIncrement: 100 });
  state.auction = settled;
  for (const result of settled.results) {
    if (!result.winnerId || result.ai) continue;
    const winner = state.players.get(result.winnerId);
    const rough = settled.roughs.find((item) => item.id === result.roughId);
    if (!winner || !rough) continue;
    if (winner.cash < result.balanceDue) {
      addNews(`${winner.name} 中标 ${rough.name} 后尾款不足，保证金被没收。`, "bad");
      continue;
    }
    spendCash(winner, result.balanceDue, `公盘尾款：${rough.name}`, { source: "auction", itemId: rough.id });
    winner.rough.push({ ...rough, type: "rough", owner: winner.id, revealed: false, polished: false });
    state.roughPool = state.roughPool.filter((item) => item.id !== rough.id);
    addNews(`${winner.name} 暗标中标 ${rough.name}，成交 ${result.price}。`, "trade");
  }
  refreshRoughPool();
  return true;
}
```

- [ ] **Step 7: Add public auction snapshots**

In `snapshotFor(player)`, add:

```js
auction: publicAuctionSnapshot(ensureAuctionRound(), player.id),
```

- [ ] **Step 8: Add bid event**

Replace or supersede `socket.on("buyRough")` with:

```js
socket.on("submitAuctionBid", ({ roughId, amount, proxyMax }) => {
  const player = getPlayer(socket);
  if (!player) return;
  const round = ensureAuctionRound();
  const rough = round.roughs.find((item) => item.id === roughId);
  if (!rough) return socket.emit("toast", "这块原石不在当前公盘。");
  const bidAmount = money(amount);
  if (bidAmount < rough.price) return socket.emit("toast", "暗标不能低于底价。");
  const next = upsertBid(round, { playerId: player.id, roughId, amount: bidAmount, proxyMax, at: Date.now() });
  if (next.depositDelta > 0 && !spendCash(player, next.depositDelta, `公盘保证金：${rough.name}`, { source: "auction", itemId: rough.id })) {
    return socket.emit("toast", `保证金还需 ${next.depositDelta}。`);
  }
  if (next.depositDelta < 0) earnCash(player, Math.abs(next.depositDelta), `退回保证金：${rough.name}`, { source: "auctionRefund", itemId: rough.id });
  state.auction = next.round;
  addNews(`${player.name} 提交了 ${rough.name} 的密封投标。`, "info");
  broadcast();
});
```

- [ ] **Step 9: Tick auction settlement**

In the existing `setInterval`, call:

```js
settleAuctionIfDue();
if (state.auction?.settledAt && Date.now() - state.auction.settledAt > TIMING.auction.preview) {
  state.auction = null;
  ensureAuctionRound();
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npm run test:flow`

Expected: PASS through the auction integration expectations.

- [ ] **Step 11: Commit**

```bash
git add server.js scripts/simplified-flow-smoke.mjs
git commit -m "feat: replace direct purchase with sealed auctions"
```

## Task 5: Frontend Auction And Offline UI

**Files:**
- Modify: `public/main.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Test: `scripts/simplified-flow-smoke.mjs`

- [ ] **Step 1: Add frontend expectations**

Extend the frontend section in `scripts/simplified-flow-smoke.mjs`:

```js
const auctionUiExpectations = [
  [/function renderOfflineSummary/, "main.js should render offline summary cards"],
  [/function renderAuctionBidControls/, "main.js should render sealed bid controls"],
  [/data-bid-amount/, "auction cards should include bid amount inputs"],
  [/data-proxy-max/, "auction cards should include proxy max inputs"],
  [/submitAuctionBid/, "auction controls should emit submitAuctionBid"],
  [/代理上限/, "auction UI should label proxy bidding"],
  [/密封投标/, "auction UI should communicate sealed bidding"],
  [/开标/, "auction UI should show settlement language"]
];

for (const [pattern, message] of auctionUiExpectations) {
  if (!pattern.test(main)) throw new Error(message);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:flow`

Expected: FAIL with `main.js should render offline summary cards`.

- [ ] **Step 3: Import report helper on the client**

Modify `public/main.js` imports:

```js
import { reportSummary } from "./jade-loop.js";
```

- [ ] **Step 4: Add offline summary renderer**

Add below `renderOverview()`:

```js
function renderOfflineSummary() {
  const summary = state.me.offlineSummary;
  if (!summary || !summary.count) return "";
  return `
    <section class="panel offline-summary">
      <div class="panel-head"><h3>离线结算</h3><span>${summary.count} 件事已完成</span></div>
      <div class="offline-totals">
        <span>收入 ${formatMoney(summary.income)}</span>
        <span>支出 ${formatMoney(summary.expense)}</span>
      </div>
      <div class="offline-lines">
        ${summary.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
      </div>
    </section>
  `;
}
```

In `renderOverview()`, prepend it:

```js
els.nextActions.insertAdjacentHTML("beforebegin", renderOfflineSummary());
```

- [ ] **Step 5: Add sealed bid controls**

Add below `auctionStoneBoard`:

```js
function myBidFor(roughId) {
  return (state.auction?.myBids || []).find((bid) => bid.roughId === roughId);
}

function renderAuctionBidControls(rough) {
  const bid = myBidFor(rough.id);
  const amount = bid?.amount || rough.price;
  const proxyMax = bid?.proxyMax || Math.round(rough.price * 1.18);
  return `
    <div class="bid-controls">
      <label>密封投标<input data-bid-amount="${rough.id}" type="number" min="${rough.price}" value="${amount}"></label>
      <label>代理上限<input data-proxy-max="${rough.id}" type="number" min="${rough.price}" value="${proxyMax}"></label>
      <button data-action="submitAuctionBid" data-payload="${rough.id}">${bid ? "修改暗标" : "提交暗标"}</button>
    </div>
  `;
}
```

In `renderAuction()`, replace the direct purchase button block:

```js
${renderAuctionBidControls(rough)}
```

- [ ] **Step 6: Emit sealed bid payload**

In the click handler before generic `socket.emit(action, payload)`:

```js
if (action === "submitAuctionBid") {
  const amount = document.querySelector(`[data-bid-amount="${CSS.escape(payload)}"]`)?.value;
  const proxyMax = document.querySelector(`[data-proxy-max="${CSS.escape(payload)}"]`)?.value;
  socket.emit("submitAuctionBid", { roughId: payload, amount, proxyMax });
  return;
}
```

- [ ] **Step 7: Style the new UI**

Add to `public/styles.css`:

```css
.offline-summary {
  margin-bottom: 16px;
  padding: 14px;
}

.offline-totals,
.offline-lines {
  display: grid;
  gap: 6px;
  margin-top: 10px;
}

.offline-lines p {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

.bid-controls {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.bid-controls label {
  display: grid;
  gap: 4px;
  color: var(--muted);
  font-size: 12px;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test:flow`

Expected: PASS through auction UI expectations.

- [ ] **Step 9: Commit**

```bash
git add public/main.js public/index.html public/styles.css scripts/simplified-flow-smoke.mjs
git commit -m "feat: add sealed auction and offline summary UI"
```

## Task 6: Production Chain Migration

**Files:**
- Modify: `server.js`
- Modify: `public/main.js`
- Modify: `public/styles.css`
- Modify: `scripts/simplified-flow-smoke.mjs`

- [ ] **Step 1: Add production expectations**

Append to `scripts/simplified-flow-smoke.mjs`:

```js
const productionExpectations = [
  [/jobs\s*:\s*\[\]/, "player state should include staged production jobs"],
  [/startProductionJob/, "server should expose startProductionJob"],
  [/completeProductionJob/, "server should complete staged production jobs"],
  [/productionDuration/, "server should use shared production durations"],
  [/粗加工/, "UI should show rough processing stage"],
  [/精加工/, "UI should show refine processing stage"],
  [/镶嵌/, "UI should show inlay processing stage"]
];

for (const [pattern, message] of productionExpectations) {
  if (!pattern.test(server) && !pattern.test(main)) throw new Error(message);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:flow`

Expected: FAIL with `player state should include staged production jobs`.

- [ ] **Step 3: Extend player state**

In `makePlayer`:

```js
jobs: [],
externalMaterials: {
  silverMount: 2,
  goldMount: 0,
  diamondChips: 0
},
```

In `normalizePlayer`:

```js
player.jobs ||= [];
player.externalMaterials ||= { silverMount: 0, goldMount: 0, diamondChips: 0 };
```

- [ ] **Step 4: Add production job creator**

Add below `takeItem`:

```js
function startProductionJob(player, stage, item, options = {}) {
  const stageCost = { rough: 620, refine: 900, inlay: 480 }[stage] || 620;
  if (!spendCash(player, stageCost, `${options.label || stage}：${item.name}`, { source: "production", itemId: item.id })) {
    return null;
  }
  const now = Date.now();
  const job = {
    id: randomUUID(),
    type: "productionJob",
    stage,
    item,
    options,
    fee: stageCost,
    startedAt: now,
    readyAt: now + productionDuration(stage, TIMING_PROFILE)
  };
  player.jobs.push(job);
  return job;
}
```

- [ ] **Step 5: Add production completion**

Add below `startProductionJob`:

```js
function completeProductionJob(player, job) {
  if (job.stage === "rough") {
    const polished = revealPolishedRough(job.item);
    polished.stage = "material";
    player.rough.push(polished);
    player.rep += Math.max(1, Math.round(polished.rep * 0.45));
    return { text: `${polished.name} 粗加工完成`, item: polished };
  }
  if (job.stage === "refine") {
    player.bracelets.push(...extractProductsFromJob(job));
    return { text: `${job.item.name} 精加工完成`, item: job.item };
  }
  const finished = { ...job.item, inlaid: true, value: money((job.item.value || 0) * 1.18), name: `${job.item.name}镶嵌款` };
  player.bracelets.push(finished);
  return { text: `${finished.name} 镶嵌完成`, item: finished };
}
```

Add a focused extraction helper that reuses the current `extractFromRough` product creation body:

```js
function extractProductsFromJob(job) {
  const rough = job.item;
  const normalizedKits = normalizeExtractionKits(job.options.kits || []);
  const placements = expandKitPlacements(normalizedKits);
  const totalSlots = Math.max(1, placements.length);
  const valueBase = Math.max(rough.value || rough.price, rough.price) / Math.max(2, totalSlots + 1);
  return placements.map((placement) => {
    const placementScore = scoreRoughPlacement(rough, placement);
    const productMeta = kitProductMeta(placement);
    return {
      id: randomUUID(),
      type: "bracelet",
      kind: placement.layout,
      name: `${rough.quality}${rough.color}${productMeta.label}`,
      qualityKey: rough.qualityKey,
      quality: rough.quality,
      score: rough.score,
      color: rough.color,
      design: productMeta.label,
      value: money(valueBase * productMeta.mult * placementScore),
      rep: Math.max(1, Math.round((rough.rep * productMeta.rep * 0.35 + rough.score * 2) * clamp(placementScore, 0.72, 1.18))),
      count: productMeta.count,
      sourceRoughId: rough.id,
      plan: placement,
      sourceMaterial: {
        roughId: rough.id,
        roughName: rough.name,
        visual: rough.visual,
        windows: rough.windows || [],
        placement,
        templateSize: { w: placement.templateSize?.w, h: placement.templateSize?.h },
        mass: rough.mass,
        qualityKey: rough.qualityKey,
        color: rough.color
      },
      placementScore: Math.round(placementScore * 100)
    };
  });
}
```

- [ ] **Step 6: Process due jobs**

Add:

```js
function processProductionJobs(now = Date.now()) {
  let changed = false;
  for (const player of state.players.values()) {
    normalizePlayer(player);
    const ready = player.jobs.filter((job) => job.readyAt <= now);
    if (!ready.length) continue;
    player.jobs = player.jobs.filter((job) => job.readyAt > now);
    for (const job of ready) {
      const result = completeProductionJob(player, job);
      addNews(`${player.name} 的 ${result.text}。`, "craft");
    }
    changed = true;
  }
  if (changed) broadcast();
}
```

Call `processProductionJobs()` from the one-second interval.

- [ ] **Step 7: Route existing polish and extraction events through jobs**

Change `startPolish` to:

```js
const job = startProductionJob(player, "rough", rough, { label: "粗加工" });
if (!job) {
  player.rough.push(rough);
  return socket.emit("toast", "粗加工费用不够。");
}
addNews(`${player.name} 将 ${rough.name} 送入粗加工。`, "craft");
broadcast();
```

Change `extractFromRough` after validation to create a refine job:

```js
const job = startProductionJob(player, "refine", rough, { label: "精加工", kits: normalizedKits });
if (!job) {
  player.rough.push(rough);
  return socket.emit("toast", "精加工费用不够。");
}
addNews(`${player.name} 为 ${rough.name} 安排 ${normalizedKits.length} 件精加工。`, "craft");
broadcast();
```

- [ ] **Step 8: Update frontend copy**

In `renderWorkshop`, change copy:

```js
<button class="warn" data-action="startPolish" data-payload="${item.id}">粗加工 ¥620</button>
```

Add job rows from `me.jobs`:

```js
const productionRows = (me.jobs || []).map((job) => {
  const remain = Math.max(0, Math.ceil((job.readyAt - Date.now()) / 1000));
  const progress = Math.min(100, Math.round((Date.now() - job.startedAt) / Math.max(1, job.readyAt - job.startedAt) * 100));
  const label = { rough: "粗加工", refine: "精加工", inlay: "镶嵌" }[job.stage] || "加工";
  return `
    <div class="item-row machine-row">
      <div class="machine-top"><div><strong>${label}</strong><p class="item-meta">${escapeHtml(job.item.name)} · 还需 ${remain} 秒</p></div></div>
      <div class="machine-track"><span style="width:${progress}%"></span></div>
    </div>
  `;
});
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm run test:flow`

Expected: PASS through production expectations.

- [ ] **Step 10: Commit**

```bash
git add server.js public/main.js public/styles.css scripts/simplified-flow-smoke.mjs
git commit -m "feat: add staged production jobs"
```

## Task 7: Automatic Livestream And Lightweight Reports

**Files:**
- Modify: `server.js`
- Modify: `public/main.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `scripts/simplified-flow-smoke.mjs`

- [ ] **Step 1: Add livestream/report expectations**

Append to `scripts/simplified-flow-smoke.mjs`:

```js
const liveReportExpectations = [
  [/livestreamJobs\s*:\s*\[\]/, "player state should track livestream jobs"],
  [/scheduleLivestream/, "server should expose scheduleLivestream"],
  [/processLivestreamJobs/, "server should process due livestream jobs"],
  [/livestreamOutcome/, "server should use shared livestream outcomes"],
  [/reportSummary/, "server and client should use report summaries"],
  [/直播卖货/, "navigation should include livestream page"],
  [/经营报告/, "navigation should include report page"],
  [/autoConservative/, "UI should expose conservative auto livestream mode"],
  [/autoBalanced/, "UI should expose balanced auto livestream mode"],
  [/autoAggressive/, "UI should expose aggressive auto livestream mode"]
];

for (const [pattern, message] of liveReportExpectations) {
  if (!pattern.test(server) && !pattern.test(main)) throw new Error(message);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:flow`

Expected: FAIL with `player state should track livestream jobs`.

- [ ] **Step 3: Extend player state**

In `makePlayer`:

```js
livestreamJobs: [],
livestreamHistory: [],
```

In `normalizePlayer`:

```js
player.livestreamJobs ||= [];
player.livestreamHistory ||= [];
```

- [ ] **Step 4: Add livestream scheduler**

Add below `completeProductionJob`:

```js
function scheduleLivestream(player, productId, mode = "autoBalanced") {
  const product = takeItem(player, "bracelet", productId);
  if (!product) return null;
  const now = Date.now();
  const duration = TIMING.livestream.min;
  const job = {
    id: randomUUID(),
    type: "livestreamJob",
    mode,
    product,
    startedAt: now,
    readyAt: now + duration
  };
  player.livestreamJobs.push(job);
  return job;
}
```

- [ ] **Step 5: Add livestream processor**

Add:

```js
function processLivestreamJobs(now = Date.now()) {
  let changed = false;
  for (const player of state.players.values()) {
    normalizePlayer(player);
    const ready = player.livestreamJobs.filter((job) => job.readyAt <= now);
    if (!ready.length) continue;
    player.livestreamJobs = player.livestreamJobs.filter((job) => job.readyAt > now);
    for (const job of ready) {
      const outcome = livestreamOutcome(job.product, { mode: job.mode, rep: player.rep, seed: job.readyAt });
      if (outcome.sold) {
        earnCash(player, outcome.price, `直播成交：${job.product.name}`, { source: "livestream", itemId: job.product.id });
        player.rep += Math.max(1, Math.round(job.product.rep * 0.18));
        addNews(`${player.name} 自动直播卖出 ${job.product.name}，成交 ${outcome.price}。`, "trade");
      } else {
        player.bracelets.push(job.product);
        addNews(`${player.name} 的 ${job.product.name} 直播未成交，已退回库存。`, "info");
      }
      player.livestreamHistory.unshift({ ...job, outcome, completedAt: now });
      player.livestreamHistory = player.livestreamHistory.slice(0, 20);
    }
    player.reports = [reportSummary(player.ledger, [...player.rough, ...player.materials, ...player.slices, ...player.bracelets], now)];
    changed = true;
  }
  if (changed) broadcast();
}
```

Call `processLivestreamJobs()` from the one-second interval.

- [ ] **Step 6: Add socket event**

Add:

```js
socket.on("scheduleLivestream", ({ productId, mode }) => {
  const player = getPlayer(socket);
  if (!player) return;
  const job = scheduleLivestream(player, productId, mode);
  if (!job) return socket.emit("toast", "找不到可直播的成品。");
  addNews(`${player.name} 安排 ${job.product.name} 自动直播。`, "trade");
  broadcast();
});
```

- [ ] **Step 7: Add seven navigation labels**

Change `tabs` in `public/main.js`:

```js
const tabs = [
  ["overview", "工坊总览", "盘"],
  ["auction", "公盘竞拍", "石"],
  ["workshop", "加工坊", "作"],
  ["market", "库存交易", "市"],
  ["livestream", "直播卖货", "播"],
  ["collection", "声望殿堂", "誉"],
  ["reports", "经营报告", "报"]
];
```

- [ ] **Step 8: Add livestream and report view containers**

In `public/index.html`, add view sections before the collection section:

```html
<section class="view" data-view="livestream">
  <div class="section-head">
    <div><p class="eyebrow">自动模式</p><h3>直播卖货</h3></div>
  </div>
  <div id="livestreamPanel" class="card-grid"></div>
</section>

<section class="view" data-view="reports">
  <div class="section-head">
    <div><p class="eyebrow">现金流</p><h3>经营报告</h3></div>
  </div>
  <div id="reportsPanel" class="report-grid"></div>
</section>
```

Add to `els`:

```js
livestream: document.querySelector("#livestreamPanel"),
reports: document.querySelector("#reportsPanel"),
```

- [ ] **Step 9: Render livestream UI**

Add:

```js
function renderLivestream() {
  const products = state.me.bracelets || [];
  const jobs = state.me.livestreamJobs || [];
  els.livestream.innerHTML = [
    ...jobs.map((job) => `<article class="rough-card"><h3>直播中</h3><p>${escapeHtml(job.product.name)} · ${escapeHtml(job.mode)}</p></article>`),
    ...products.map((item) => `
      <article class="rough-card">
        ${productCanvas(item)}
        <h3>${escapeHtml(item.name)}</h3>
        <p class="card-meta">估值 ${formatMoney(item.value)} · 自动直播可离线完成</p>
        <div class="card-actions">
          <button data-action="scheduleLivestream" data-payload="${item.id}" data-mode="autoConservative">保守</button>
          <button data-action="scheduleLivestream" data-payload="${item.id}" data-mode="autoBalanced">均衡</button>
          <button data-action="scheduleLivestream" data-payload="${item.id}" data-mode="autoAggressive">激进</button>
        </div>
      </article>
    `)
  ].join("") || empty("暂无可直播成品。");
}
```

In click handler:

```js
if (action === "scheduleLivestream") {
  socket.emit("scheduleLivestream", { productId: payload, mode: target.dataset.mode });
  return;
}
```

- [ ] **Step 10: Render report UI**

Add:

```js
function renderReports() {
  const report = state.me.reports?.[0] || reportSummary(state.me.ledger || [], [...state.me.rough, ...state.me.materials, ...state.me.slices, ...state.me.bracelets]);
  els.reports.innerHTML = `
    <section class="panel report-card">
      <div class="panel-head"><h3>核心财务</h3><span>当前周期</span></div>
      <div class="report-metrics">
        <div><span>收入</span><strong>${formatMoney(report.income)}</strong></div>
        <div><span>支出</span><strong>${formatMoney(report.expense)}</strong></div>
        <div><span>净利润</span><strong>${formatMoney(report.net)}</strong></div>
        <div><span>库存占用</span><strong>${formatMoney(report.inventoryValue)}</strong></div>
      </div>
      <div class="fit-list">${report.advice.map((item) => `<div><span>${escapeHtml(item)}</span></div>`).join("")}</div>
    </section>
  `;
}
```

Call `renderLivestream()` and `renderReports()` from `render()`.

- [ ] **Step 11: Style livestream and reports**

Add:

```css
.report-grid,
.report-metrics {
  display: grid;
  gap: 12px;
}

.report-metrics {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.report-metrics div {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px;
  background: #fff;
}

.report-metrics span {
  display: block;
  color: var(--muted);
  font-size: 12px;
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npm run test:flow`

Expected: PASS through livestream/report expectations.

- [ ] **Step 13: Commit**

```bash
git add server.js public/main.js public/index.html public/styles.css scripts/simplified-flow-smoke.mjs
git commit -m "feat: add automatic livestream and reports"
```

## Task 8: Full Verification

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Confirm aggregate test script**

Ensure `package.json` contains:

```json
"test": "npm run test:loop && npm run test:auction && npm run test:rules && npm run test:renderer && npm run test:volume && npm run test:canvas && npm run test:flow"
```

- [ ] **Step 2: Run full automated verification**

Run: `npm test`

Expected: all checks pass, ending with `Simplified rough-to-bracelet flow checks passed`.

- [ ] **Step 3: Run the local server**

Run: `npm start`

Expected: terminal prints `Jade Market Prototype running at http://localhost:3000`.

- [ ] **Step 4: Browser smoke path**

Open `http://localhost:3000/` and verify:

- 工坊总览 shows cash, reputation, inventory, next actions, and offline summary when present.
- 公盘竞拍 shows sealed bid inputs and no direct buy button.
- Submitting an auction bid deducts deposit and updates “我的投标”.
- 加工坊 shows 粗加工、精加工、镶嵌 copy and job progress.
- 直播卖货 can schedule a conservative, balanced, or aggressive automatic stream.
- 经营报告 shows income, expense, net profit, inventory value, and advice.

- [ ] **Step 5: Review diff**

Run:

```bash
git diff -- public/jade-loop.js public/jade-auction.js public/main.js public/styles.css public/index.html server.js scripts/jade-loop-smoke.mjs scripts/jade-auction-smoke.mjs scripts/simplified-flow-smoke.mjs package.json
```

Expected: diff only touches planned files.

- [ ] **Step 6: Commit final verification cleanup**

If Step 5 shows only planned files and Step 2 passes:

```bash
git add public/jade-loop.js public/jade-auction.js public/main.js public/styles.css public/index.html server.js scripts/jade-loop-smoke.mjs scripts/jade-auction-smoke.mjs scripts/simplified-flow-smoke.mjs package.json
git commit -m "test: verify hardcore idle loop"
```

Skip this commit when there are no file changes after the previous task commits.

## Self-Review

Spec coverage:

- Time and offline progression are covered by Tasks 1 and 3.
- Sealed auction, proxy bids, deposits, AI buyers, and result privacy are covered by Tasks 2, 4, and 5.
- Staged production is covered by Task 6.
- Automatic livestream, reputation from livestream revenue, and lightweight reports are covered by Task 7.
- Verification and regression coverage are covered by Task 8.

Scope control:

- Database persistence, real account auth, full lending, complete modal systems, and complex streamer hiring are not in this plan.
- The seven-page UI is introduced as navigable working surfaces, while detailed page polish remains outside this first hard-core loop slice.
