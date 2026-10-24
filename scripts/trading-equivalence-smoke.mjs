import { createWorkshopPlanning } from "../server/services/workshop-planning.js";
import { registerCommerceCommands } from "../server/shell/commands/commerce-commands.js";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "acorn";
import { createMemoryWorldStore } from "../server/world-store.js";
import { materialStageFor, takeItem, addItem, markInventoryItemNew } from "../server/services/inventory-service.js";
import { qualityByKey, createRoughPoolService } from "../server/services/rough-pool-service.js";
import { MATERIAL_META } from "../server/services/materials-service.js";
import { resolveTiming } from "../shared/domain/economy/jade-loop.js";
import { createAuctionService, bindAuctionApi } from "../server/services/auction-service.js";
import { createMarketService, bindMarketApi } from "../server/services/market-service.js";
import { createBlackmarketService, bindBlackmarketApi } from "../server/services/blackmarket-service.js";
import { createAchievementRewards, bindAchievementRewards } from "../server/services/achievement-rewards.js";

const sources = JSON.parse(readFileSync("scripts/fixtures/trading-service-baseline/sources.json", "utf8"));
const fixture = JSON.parse(readFileSync("scripts/fixtures/workshop-server-baseline/players.json", "utf8"));
const oracleDir = path.resolve(".refactor-test-results/trading-oracle");
assert.ok(oracleDir.startsWith(process.cwd() + path.sep));
for (const [file, original] of Object.entries(sources)) {
  let source = original;
  for (const node of parse(source, { ecmaVersion: "latest", sourceType: "module" }).body.reverse()) {
    if (!node.source?.value) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), node.source.value));
    const target = sources[resolved] ? path.join(oracleDir, resolved) : path.resolve("server/services", resolved);
    source = source.slice(0, node.source.start) + JSON.stringify(pathToFileURL(target).href) + source.slice(node.source.end);
  }
  const destination = path.join(oracleDir, file);
  mkdirSync(path.dirname(destination), { recursive: true }); writeFileSync(destination, source);
}
const load = file => import(pathToFileURL(path.join(oracleDir, file)).href);
const oracle = { auction: await load("auction-service.js"), market: await load("market-service.js"), blackmarket: await load("blackmarket/index.js"), rewards: await load("achievement-rewards.js") };
const factories = { auction: createAuctionService, market: createMarketService, blackmarket: createBlackmarketService, rewards: createAchievementRewards };
const now = Date.parse("2026-10-23T12:00:00+08:00");
const currentRules = process.argv.includes("--current-rules");
Date.now = () => now;
function harness(original = false) {
  const world = createMemoryWorldStore({ startedAt: now });
  const holder = { world };
  const seller = structuredClone(fixture.owned), buyer = structuredClone(fixture.owned);
  seller.id = "seller"; seller.name = "卖家"; buyer.id = "buyer"; buyer.name = "买家";
  for (const player of [seller, buyer]) { for (const bucket of ["rough", "materials", "slices", "bracelets"]) for (const item of player[bucket]) item.id = `${player.id}-${item.id}`; for (const worker of player.workshop.workers) worker.id = `${player.id}-${worker.id}`; for (const device of player.workshop.devices) { device.id = `${player.id}-${device.id}`; if (device.workerId) device.workerId = `${player.id}-${device.workerId}`; } player.cash = 2_000_000; player.exp = 1_000_000; player.achievementPoints = 1000; player.achievementPointsBonus = 1000; world.setPlayer(player); }
  const trace = [], outputs = [];
  let sequence = 0;
  const c = { holder, seller, buyer, trace, outputs, failAdd: false, failEarn: false, rejectSpend: false };
  const log = (...event) => trace.push(structuredClone(event));
  const money = value => Math.max(0, Math.round(Number(value) || 0));
  const deps = {
    money, uiMoney: value => `¥${money(value)}`, clamp: (n, low, high) => Math.max(low, Math.min(high, n)),
    getState() { log("getState"); return holder.world.raw; },
    randomUUID() { const prefix = ((++sequence * 2654435761) >>> 0).toString(16).padStart(8, "0"); const id = `${prefix}-1111-4111-8111-${sequence.toString(16).padStart(12, "0")}`; log("id", id); return id; },
    spendCash(p, amount, reason, meta) { log("spend", p.id, amount, reason, meta); if (c.rejectSpend || p.cash < amount) return false; p.cash -= amount; return true; },
    holdDeposit(p, amount, reason, meta) { log("hold", p.id, amount, reason, meta); if (p.cash < amount) return false; p.cash -= amount; return true; },
    releaseDeposit(p, amount, reason, meta) { log("release", p.id, amount, reason, meta); p.cash += amount; return amount; },
    earnCash(p, amount, reason, meta) { log("earn", p.id, amount, reason, meta); if (c.failEarn) throw Error("injected earn failure"); p.cash += amount; return amount; },
    takeItem(p, type, id) { log("take", p.id, type, id); return takeItem(p, type, id); },
    addItem(p, item, ...args) { log("add", p.id, item, args); if (c.failAdd) throw Error("injected inventory failure"); return addItem(p, item, ...args); },
    normalizePlayer(p) { log("normalize", p.id); }, markInventoryItemNew,
    materialStageFor, materialMeta: MATERIAL_META, qualityByKey,
    advanceTask(p, event) { log("task", p.id, event); },
    refreshPlayerReport(p, at) { log("report", p.id, at); },
    addNews(text, tone) { log("news", text, tone); holder.world.raw.news.push({ text, tone }); },
    emitUiEventToPlayer(p, event) { log("ui", p.id, event); },
    notifyPlayerToast(p, text) { log("toast", p.id, text); },
    queueOfflineEvent(p, event) { log("offline", p.id, event); },
    isPlayerOnline(p) { log("online", p.id); return true; },
    refreshRoughPool() {}, revealPolishedRough: rough => rough,
    TIMING: resolveTiming("normal"), DEFAULT_AUCTION_HALL_ID: "novice", OPEN_WINDOW_RATE: .04
  };
  const pool = createRoughPoolService({ ...deps, pick: list => list[Math.floor(Math.random() * list.length)] });
  deps.revealPolishedRough = createWorkshopPlanning({ ...deps }).revealPolishedRough;
  deps.makeRoughStone = (...args) => ({ ...pool.makeRoughStone(...args), id: deps.randomUUID() });
  c.deps = deps;
  if (original) {
    oracle.rewards.bindAchievementRewards(deps); oracle.auction.bindAuctionApi(deps); oracle.market.bindMarketApi(deps); oracle.blackmarket.bindBlackmarketApi(deps);
    c.services = oracle;
  } else {
    c.services = Object.fromEntries(Object.entries(factories).map(([key, create]) => [key, create(deps)]));
    for (const domain of ["auction", "market", "blackmarket"]) {
      assert.deepEqual(Object.keys(c.services[domain]).sort(), Object.keys(oracle[domain]).filter(key => !key.startsWith("bind")).sort(), `${domain}: original public members remain available`);
    }
  }
  c.call = (domain, method, ...args) => { const value = c.services[domain][method](...args); outputs.push([domain, method, structuredClone(value)]); return value; };
  c.state = () => holder.world.raw;
  c.snapshot = () => structuredClone({ ...c.state(), players: [...c.state().players], sockets: [...c.state().sockets] });
  return c;
}
const product = (id = "trade-product") => ({ id, type: "bracelet", name: "测试成品", materialStage: "finished", value: 2000, score: 4, qualityKey: "ice" });
const okay = result => { assert.equal(result.ok, true, result.message); return result; };
function marketListing(c) { const item = product("market-product"); c.seller.bracelets.push(item); okay(c.call("market", "listItemForPlayer", c.seller, { type: "bracelet", itemId: item.id, price: 2200 })); return c.state().listings[0]; }
function goods(c, type = "bracelet") {
  okay(c.call("blackmarket", "openBlackStallForPlayer", c.seller, { type: "goods", title: "测试货摊" }));
  const item = type === "bracelet" ? product("goods-product") : c.seller.workshop[type === "equipment" ? "devices" : "workers"][0];
  if (type === "bracelet") c.seller.bracelets.push(item);
  if (type !== "bracelet") item.id = `sold-${item.id}`;
  okay(c.call("blackmarket", "addGoodsBatchToStallForPlayer", c.seller, [{ type, itemId: item.id, price: 2200 }]));
  return c.state().blackStalls.find(stall => stall.ownerId === c.seller.id);
}
const cases = [
  ["achievement-rewards-through-owned-ledger", c => { c.call("rewards", "claimAllPlayerAchievements", c.seller); assert.ok(c.trace.some(event => event[0] === "earn"), "the reward path must actually reach the ledger hook"); }],
  ["auction-escrow-deltas-and-refund", c => { const rough = c.seller.rough[0]; c.call("auction", "applyAuctionBidEscrow", c.buyer, rough, 2500, { id: "round" }); c.call("auction", "applyAuctionBidEscrow", c.buyer, rough, 1700, { id: "round" }); c.call("auction", "refundAuctionEscrow", c.buyer, rough.id, rough.name); c.call("auction", "refundAuctionEscrow", c.buyer, rough.id); }],
  ["auction-stale-escrow-recovery", c => { c.buyer.auctionEscrow = [{ roughId: "old", roundId: "old", amount: 3000 }]; c.call("auction", "reconcileAuctionEscrows"); c.call("auction", "refundStaleAuctionEscrows", "new"); }],
  ["auction-round-enter-bid-window-settle", c => {
    const round = c.call("auction", "ensureAuctionRound", now, "novice");
    okay(c.call("auction", "enterAuctionForPlayer", c.buyer, { hallId: "novice" }, now));
    okay(c.call("auction", "submitAuctionBidForPlayer", c.buyer, { hallId: "novice", roughId: round.roughs[0].id, amount: 100000 }, now));
    okay(c.call("auction", "requestAuctionWindowForPlayer", c.buyer, { hallId: "novice", roughId: round.roughs[0].id, x: .4, y: .4 }, now));
    c.call("auction", "settleAuctionIfDue", round.endsAt + 1, "novice"); c.call("auction", "ackAuctionSettleForPlayer", c.buyer, round.id);
  }],
  ["market-sale-and-no-duplicate", c => { const row = marketListing(c); okay(c.call("market", "buyListingForPlayer", c.buyer, row.id)); assert.equal(c.call("market", "buyListingForPlayer", c.buyer, row.id).ok, false); }],
  ["market-inventory-failure", c => { const row = marketListing(c), saved = c.snapshot(); c.failAdd = true; assert.equal(c.call("market", "buyListingForPlayer", c.buyer, row.id).code, "TRANSACTION_ABORTED"); assert.deepEqual(c.snapshot(), saved); }],
  ["market-insufficient-cash-and-withdraw", c => { const row = marketListing(c); c.buyer.cash = 0; assert.equal(c.call("market", "buyListingForPlayer", c.buyer, row.id).ok, false); okay(c.call("market", "withdrawListingForPlayer", c.seller, row.id)); }],
  ["market-want-cancel", c => { okay(c.call("market", "postWantForPlayer", c.buyer, { title: "求成品", itemType: "bracelet", budget: 3000, duration: "1h", rule: "lowest" })); okay(c.call("market", "cancelWantForPlayer", c.buyer, c.state().wants[0].id)); }],
  ["market-want-offer-settlement", c => { const item = product(); c.seller.bracelets.push(item); okay(c.call("market", "postWantForPlayer", c.buyer, { title: "求成品", itemType: "bracelet", budget: 3000, duration: "1h", rule: "lowest" })); const want = c.state().wants[0]; okay(c.call("market", "applyWantForPlayer", c.seller, { wantId: want.id, type: "bracelet", itemId: item.id, price: 2200 })); okay(c.call("market", "settleWantForPlayer", c.buyer, want.id)); }],
  ["blackmarket-goods-sale-repeat", c => { const stall = goods(c); okay(c.call("blackmarket", "buyGoodsFromStallForPlayer", c.buyer, stall.id, stall.items[0].id, 2200)); assert.equal(c.call("blackmarket", "buyGoodsFromStallForPlayer", c.buyer, stall.id, "missing").ok, false); }],
  ["blackmarket-price-changed", c => { const stall = goods(c); assert.equal(c.call("blackmarket", "buyGoodsFromStallForPlayer", c.buyer, stall.id, stall.items[0].id, 2199).code, "PRICE_CHANGED"); }],
  ["blackmarket-earn-failure", c => { const stall = goods(c), saved = c.snapshot(); c.failEarn = true; assert.equal(c.call("blackmarket", "buyGoodsFromStallForPlayer", c.buyer, stall.id, stall.items[0].id).code, "TRANSACTION_ABORTED"); assert.deepEqual(c.snapshot(), saved); }],
  ["blackmarket-equipment-transfer", c => { const stall = goods(c, "equipment"); okay(c.call("blackmarket", "buyGoodsFromStallForPlayer", c.buyer, stall.id, stall.items[0].id, 2200)); }],
  ["blackmarket-employee-transfer", c => { c.buyer.workshop.workers = []; const stall = goods(c, "employee"); okay(c.call("blackmarket", "buyGoodsFromStallForPlayer", c.buyer, stall.id, stall.items[0].id, 2200)); }],
  ["blackmarket-blind-draw-resume-and-settle", c => {
    okay(c.call("blackmarket", "openBlackStallForPlayer", c.seller, { type: "blindbox", blindPrice: 1000 }));
    const entries = Array.from({ length: 6 }, (_, n) => { const item = product(`blind-${n}`); c.seller.bracelets.push(item); return { type: "bracelet", itemId: item.id }; });
    okay(c.call("blackmarket", "addBlindboxItemsForPlayer", c.seller, entries)); const stall = c.state().blackStalls.find(s => s.ownerId === c.seller.id);
    okay(c.call("blackmarket", "startBlindboxDrawForPlayer", c.buyer, stall.id)); okay(c.call("blackmarket", "startBlindboxDrawForPlayer", c.buyer, stall.id));
    okay(c.call("blackmarket", "settleBlindboxDrawForPlayer", c.buyer, { stallId: stall.id, drawId: stall.blindDraw.id }));
  }],
  ["blackmarket-service-accept-cancel", c => {
    okay(c.call("blackmarket", "openBlackStallForPlayer", c.seller, { type: "service", title: "测试代工" }));
    okay(c.call("blackmarket", "addServiceOfferForPlayer", c.seller, { templateId: "open-window", price: 200, etaMinutes: 20 }));
    const stall = c.state().blackStalls.find(s => s.ownerId === c.seller.id);
    const order = okay(c.call("blackmarket", "orderBlackServiceForPlayer", c.buyer, stall.id, stall.offers[0].id, { itemType: "rough", itemId: c.buyer.rough[0].id })).order;
    okay(c.call("blackmarket", "acceptBlackServiceForPlayer", c.seller, order.id)); okay(c.call("blackmarket", "cancelBlackServiceForPlayer", c.buyer, order.id));
  }],
  ["blackmarket-npc-refill-and-purchase", c => { c.call("blackmarket", "maintainNpcBlackmarket", now); const stall = c.state().blackStalls.find(stall => stall.npc && stall.items.some(row => row.type === "equipment")); const row = stall.items.find(row => row.type === "equipment"); okay(c.call("blackmarket", "buyGoodsFromStallForPlayer", c.buyer, stall.id, row.id, row.price)); c.call("blackmarket", "maintainNpcBlackmarket", now + 60 * 60 * 1000); }],
  ["blackmarket-reference-recovery", c => { const stall = goods(c); c.state().players.delete(c.seller.id); c.call("blackmarket", "reconcileBlackmarketReferences", c.state()); c.call("blackmarket", "sweepEmptyBlackGoodsStalls", c.state()); assert.ok(!c.state().blackStalls.some(s => s.id === stall.id)); }],
  ["legacy-payout-recovery", c => { c.seller.payouts = [{ id: "old-payout", amount: 500, source: "market" }]; c.call("market", "collectMarketPayoutForPlayer", c.seller); c.seller.payouts = [{ id: "old-bm-payout", amount: 600, source: "blackmarket" }]; c.call("blackmarket", "collectBlackmarketPayoutForPlayer", c.seller); }]
];
function run(original, operation) {
  const c = harness(original); let seed = 20261023;
  const random = Math.random; Math.random = () => { const value = ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32); c.trace.push(["random", value]); return value; };
  try { operation(c); return { outputs: c.outputs, trace: c.trace, state: c.snapshot() }; } finally { Math.random = random; }
}
for (const [name, operation] of cases) {
  if (currentRules) run(false, operation);
  else assert.deepEqual(run(false, operation), run(true, operation), `${name}: state, numeric values, random/id consumption or ordered effects changed`);
}

const a = harness(), b = harness(), untouched = b.snapshot();
goods(a); marketListing(a); a.call("auction", "applyAuctionBidEscrow", a.buyer, a.seller.rough[0], 3000, { id: "a-round" });
assert.deepEqual(b.snapshot(), untouched, "same-id players in separate worlds cannot leak state");
bindAuctionApi(a.deps); bindMarketApi(a.deps); bindBlackmarketApi(a.deps); bindAchievementRewards(a.deps);
const protectedA = a.snapshot(); marketListing(b); goods(b);
b.call("rewards", "claimAllPlayerAchievements", b.seller);
assert.deepEqual(a.snapshot(), protectedA, "rebinding legacy API slots cannot redirect private factory methods");
const replacement = createMemoryWorldStore(); replacement.importSnapshot(a.holder.world.exportSnapshot({ savedAt: now }));
const abandoned = a.holder.world, abandonedSnapshot = a.snapshot(); a.holder.world = replacement;
okay(a.call("market", "buyListingForPlayer", replacement.raw.players.get("buyer"), replacement.raw.listings[0].id));
assert.deepEqual(structuredClone({ ...abandoned.raw, players: [...abandoned.raw.players], sockets: [...abandoned.raw.sockets] }), abandonedSnapshot, "world replacement never mutates abandoned player roots");
for (const domain of ["market", "blackmarket"]) {
  const c = harness();
  const row = domain === "market" ? marketListing(c) : goods(c);
  const itemId = domain === "market" ? row.id : row.items[0].id;
  const saved = c.snapshot(), oldBuyer = c.buyer;
  const transaction = c.holder.world.beginMutation(now);
  const buy = () => domain === "market"
    ? c.services.market.buyListingForPlayer(c.state().players.get("buyer"), row.id)
    : c.services.blackmarket.buyGoodsFromStallForPlayer(c.state().players.get("buyer"), row.id, itemId);
  okay(transaction.run(buy));
  assert.deepEqual(transaction.snapshots().before.players.map(([id]) => id).sort(), ["buyer", "seller"], `${domain}: both asset owners must join the durable transaction`);
  transaction.rollback(); assert.deepEqual(c.snapshot(), saved, `${domain}: durable rollback restores both asset owners and escrow/listing roots`);
  assert.notEqual(c.state().players.get("buyer"), oldBuyer);
  okay(buy());
}
const routed = [];
for (const label of ["first", "second"]) {
  const handlers = new Map(), player = { id: label };
  registerCommerceCommands({ on: (event, handler) => handlers.set(event, handler), emit: (...args) => routed.push([label, "emit", ...args]) }, {
    getPlayer: () => player, acceptMutation: () => true, broadcast: () => routed.push([label, "broadcast"]),
    acceptMarketOfferForPlayer: (actor, listingId, offerId) => { assert.equal(actor, player); routed.push([label, listingId, offerId]); return { ok: true, message: label }; }
  });
  handlers.get("acceptMarketOffer")({ listingId: `${label}-listing`, offerId: `${label}-offer`, requestId: "request" });
}
assert.deepEqual(routed, [["first", "first-listing", "first-offer"], ["first", "emit", "toast", "first"], ["first", "broadcast"], ["second", "second-listing", "second-offer"], ["second", "emit", "toast", "second"], ["second", "broadcast"]], "NPC market offer commands must use their injected instance and retain feedback order");
console.log(`trading-equivalence-smoke: ${cases.length} ${currentRules ? "current-rule behavioral" : "differential"} scenarios, three private services, owned reward hooks, legacy-rebind isolation, two-player rollback/retry and dynamic-world recovery ok`);
