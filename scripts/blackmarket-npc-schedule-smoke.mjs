import assert from "node:assert/strict";
import { __testHooks as H } from "../server.js";
import { maintainNpcBlackmarket } from "../server/services/blackmarket/npc.js";
import { requireApi } from "../server/services/blackmarket/context.js";
import { bindBlackmarketApi, buyGoodsFromStallForPlayer, publicBlackStall, sweepEmptyBlackGoodsStalls } from "../server/services/blackmarket-service.js";
import { publicStone } from "../server/services/snapshot-public.js";
import { createMemoryWorldStore } from "../server/world-store.js";
import {
  NPC_STALLS, NPC_SCHEDULE_VERSION, NPC_MIN_DISPLAY_MS, NPC_STALE_MS,
  NPC_ROTATION_MIN_MS, NPC_ROTATION_MAX_MS, NPC_TRAVELER_ROTATION_MIN_MS,
  NPC_TRAVELER_ROTATION_MAX_MS, NPC_REFILL_MIN_MS, NPC_REFILL_MAX_MS
} from "../shared/domain/blackmarket/npc-rules.js";
import { NPC_PRICING_VERSION } from "../shared/domain/blackmarket/npc-pricing.js";

const realNow = Date.now;
const originalApi = requireApi();
let uuid = 0;
const api = { ...originalApi, randomUUID: () => `npc-schedule-test-${uuid++}` };
let now = realNow();
Date.now = () => now;
const stallFor = (role) => H.state.blackStalls.find((stall) => stall.npcRole === role);
const ids = (stall) => stall.items.map((row) => row.id);
const ordinary = (stall) => stall.items.filter((row) => !row.npcDiscount && !row.npcPremium);
const buy = (buyer, stall, row) => buyGoodsFromStallForPlayer(buyer, stall.id, row.id);
function between(value, min, max, label) {
  assert.ok(value >= min && value <= max, `${label}: ${value} outside ${min}..${max}`);
}
function assertRotation(stall, at) {
  between(stall.npcRotateAt - at,
    stall.npcRole === "traveler" ? NPC_TRAVELER_ROTATION_MIN_MS : NPC_ROTATION_MIN_MS,
    stall.npcRole === "traveler" ? NPC_TRAVELER_ROTATION_MAX_MS : NPC_ROTATION_MAX_MS,
    `${stall.npcRole} rotation`);
}
function assertCoverage(stall) {
  const rule = NPC_STALLS.find((entry) => entry.role === stall.npcRole);
  assert.equal(stall.items.length, rule.stock);
  assert.ok(stall.items.filter((row) => row.npcDiscount).length <= rule.discount);
  assert.ok(stall.items.filter((row) => row.npcPremium).length <= (rule.roaming ? 2 : 0));
  const categories = rule.role === "stone" ? ["rough", "material"]
    : rule.role === "offcut" ? ["material", "slice", "bracelet"] : [];
  for (const type of categories) assert.ok(stall.items.some((row) => row.type === type), `missing ${type}`);
  if (rule.role === "finished") assert.ok(new Set(stall.items.map((row) => row.item.kind)).size >= 3);
}
function reset() {
  bindBlackmarketApi(api);
  H.state.players.clear(); H.state.blackStalls.length = 0; H.state.sockets.clear();
  now += 10 * 60 * 60_000;
  maintainNpcBlackmarket(now);
  const buyer = H.makePlayer("scheduler-buyer");
  H.normalizePlayer(buyer);
  buyer.cash = 1_000_000_000;
  buyer.achievementPoints = buyer.achievementPointsBonus = 680;
  H.state.players.set(buyer.id, buyer);
  return buyer;
}

try {
  // Each shelf has its own saved random deadline; the former half-hour boundary does nothing.
  let buyer = reset();
  for (const stall of H.state.blackStalls) { assertRotation(stall, now); assertCoverage(stall); }
  assert.equal(new Set(H.state.blackStalls.map((stall) => stall.npcRotateAt)).size, NPC_STALLS.length);
  const frozen = structuredClone(H.state.blackStalls);
  now += 30 * 60_000;
  assert.equal(maintainNpcBlackmarket(now).changed, false);
  assert.deepEqual(H.state.blackStalls, frozen);
  for (const stall of H.state.blackStalls) {
    const pub = publicBlackStall(stall, buyer.id, publicStone);
    for (const field of ["nextBatchAt", "npcRotateAt", "npcRefillAt", "npcScheduleVersion", "npcPricingVersion"]) assert.equal(pub[field], undefined);
    assert.ok(pub.items.every((row) => row.npcPricingVersion === undefined));
  }

  // A vacancy schedules one delayed refill. Further purchases cannot postpone it or reroll it.
  buyer = reset();
  let stone = stallFor("stone");
  const rotationAt = stone.npcRotateAt;
  assert.equal(buy(buyer, stone, stone.items.find((row) => row.npcDiscount)).ok, true);
  assert.equal(stone.items.length, 5);
  const refillAt = stone.npcRefillAt;
  between(refillAt - now, NPC_REFILL_MIN_MS, NPC_REFILL_MAX_MS, "refill");
  now += 60_000;
  assert.equal(buy(buyer, stone, stone.items[0]).ok, true);
  assert.equal(stone.npcRefillAt, refillAt);
  assert.equal(stone.npcRotateAt, rotationAt);
  const survivors = structuredClone(stone.items);
  now = refillAt - 1;
  maintainNpcBlackmarket(now);
  assert.deepEqual(stone.items, survivors);
  now += 1;
  maintainNpcBlackmarket(now);
  assertCoverage(stone);
  assert.equal(stone.npcRefillAt, null);
  assert.equal(stone.npcDiscountIssued, 1);
  assert.equal(stone.items.filter((row) => row.npcDiscount).length, 0);
  for (const row of survivors) assert.deepEqual(stone.items.find((entry) => entry.id === row.id), row);

  // A failure after reserving a refill must roll back its deadline together with cash and stock.
  const beforeRollback = structuredClone({ buyer, stalls: H.state.blackStalls, news: H.state.news });
  bindBlackmarketApi({ ...api, refreshPlayerReport: () => { throw new Error("injected post-refill failure"); } });
  assert.equal(buy(buyer, stone, stone.items[0]).code, "TRANSACTION_ABORTED");
  assert.deepEqual({ buyer, stalls: H.state.blackStalls, news: H.state.news }, beforeRollback);
  bindBlackmarketApi(api);
  stone = stallFor("stone");

  // Sold-out NPCs remain on the plaza while they wait, without generating free special stock.
  for (const row of [...stone.items]) assert.equal(buy(buyer, stone, row).ok, true);
  assert.equal(stone.items.length, 0);
  assert.equal(sweepEmptyBlackGoodsStalls(H.state), false);
  assert.equal(publicBlackStall(stone, buyer.id, publicStone).summary.count, 0);
  now = Math.min(stone.npcRefillAt, stone.npcRotateAt);
  maintainNpcBlackmarket(now);
  assertCoverage(stone);

  // Removal uses item age, not array order, and protects recently refilled ordinary goods.
  reset(); stone = stallFor("stone");
  const old = ordinary(stone);
  for (let index = 0; index < old.length; index += 1) old[index].createdAt = now - (60 + index) * 60_000;
  old[0].createdAt = now - 5 * 60_000;
  const removed = [...old].sort((a, b) => a.createdAt - b.createdAt).slice(0, 2).map((row) => row.id);
  stone.items.reverse();
  const oldSpecial = stone.items.find((row) => row.npcDiscount).id;
  stone.npcRotateAt = now;
  maintainNpcBlackmarket(now);
  for (const id of [...removed, oldSpecial]) assert.ok(!ids(stone).includes(id));
  assert.ok(ids(stone).includes(old[0].id));
  assert.equal(old.filter((row) => ids(stone).includes(row.id)).length, 3);
  assertCoverage(stone); assertRotation(stone, now);

  // A full shelf of fresh refills is never evicted just to make room for a discount.
  buyer = reset(); stone = stallFor("stone");
  for (const row of [...stone.items]) assert.equal(buy(buyer, stone, row).ok, true);
  now = stone.npcRefillAt;
  maintainNpcBlackmarket(now);
  const fresh = structuredClone(stone.items);
  now += NPC_MIN_DISPLAY_MS - 1;
  stone.npcRotateAt = now;
  maintainNpcBlackmarket(now);
  assert.deepEqual(stone.items, fresh);

  // Every stale item leaves at the next rotation, even if more than two have to go.
  reset();
  const offcut = stallFor("offcut");
  const staleIds = ids(offcut);
  for (const row of offcut.items) row.createdAt = now - NPC_STALE_MS;
  offcut.npcRotateAt = now;
  maintainNpcBlackmarket(now);
  assert.ok(ids(offcut).every((id) => !staleIds.includes(id)));
  assertCoverage(offcut);

  // Rotation takes precedence over a pending refill and supplies only one current batch.
  buyer = reset(); stone = stallFor("stone");
  assert.equal(buy(buyer, stone, stone.items[0]).ok, true);
  const collisionAt = stone.npcRefillAt;
  stone.npcRotateAt = collisionAt;
  const batch = stone.npcBatch;
  now = collisionAt;
  maintainNpcBlackmarket(now);
  assert.equal(stone.npcBatch, batch + 1);
  assert.equal(stone.npcRefillAt, null);
  assert.equal(stone.items.filter((row) => row.npcDiscount).length, 1);
  assertCoverage(stone);

  // A quote that expires at checkout cannot debit the player or add the retired item.
  buyer = reset();
  const traveler = stallFor("traveler");
  const travelerIds = ids(traveler);
  const quote = traveler.items[0];
  const owned = structuredClone(buyer);
  now = traveler.npcRotateAt;
  const stalePurchase = buy(buyer, traveler, quote);
  assert.equal(stalePurchase.ok, false);
  assert.match(stalePurchase.message, /收摊换货/);
  assert.deepEqual(buyer, owned);
  assert.ok(ids(traveler).every((id) => !travelerIds.includes(id)));
  assert.equal(traveler.items.filter((row) => row.npcPremium).length, 2);
  assertRotation(traveler, now); assertCoverage(traveler);

  // A save round trip preserves pending refill/rotation times, stock, prices and batch quotas.
  buyer = reset(); stone = stallFor("stone");
  assert.equal(buy(buyer, stone, stone.items.find((row) => row.npcDiscount)).ok, true);
  const store = createMemoryWorldStore({ players: H.state.players, blackStalls: H.state.blackStalls });
  const saved = store.exportSnapshot({ savedAt: now });
  const restored = createMemoryWorldStore();
  restored.importSnapshot(structuredClone(saved));
  bindBlackmarketApi({ ...api, getState: () => restored.raw });
  now += 1;
  assert.equal(maintainNpcBlackmarket(now).changed, false);
  assert.deepEqual(restored.raw.blackStalls, saved.blackStalls);
  for (const [field, value] of [["npcRefillAt", -1], ["npcRotateAt", 1.5], ["npcScheduleVersion", -1]]) {
    const bad = structuredClone(saved);
    bad.blackStalls[0][field] = value;
    assert.throws(() => createMemoryWorldStore().importSnapshot(bad), /non-negative/);
  }
  const missingDeadline = structuredClone(saved);
  delete missingDeadline.blackStalls[0].npcRotateAt;
  assert.throws(() => createMemoryWorldStore().importSnapshot(missingDeadline), /rotation deadline/);

  // Legacy shelves are migrated once, preserving goods, listing age and sold-out discounts.
  buyer = reset(); stone = stallFor("stone");
  assert.equal(buy(buyer, stone, stone.items.find((row) => row.npcDiscount)).ok, true);
  const legacyItems = structuredClone(stone.items);
  delete stone.npcScheduleVersion;
  delete stone.npcRefillAt;
  stone.npcBatch = Math.floor(now / (30 * 60_000));
  stone.npcRotateAt = now + 15 * 60_000;
  maintainNpcBlackmarket(now);
  assert.equal(stone.npcScheduleVersion, NPC_SCHEDULE_VERSION);
  assert.deepEqual(stone.items, legacyItems);
  assert.equal(stone.npcDiscountIssued, 1);
  assertRotation(stone, now);
  between(stone.npcRefillAt - now, NPC_REFILL_MIN_MS, NPC_REFILL_MAX_MS, "migrated refill");
  const migrated = structuredClone(stone);
  assert.equal(maintainNpcBlackmarket(now).changed, false);
  assert.deepEqual(stone, migrated);

  // Pricing upgrades reprice the same goods without restarting schedules or
  // replenishing a clearance slot already purchased in the current batch.
  buyer = reset();
  stone = stallFor("stone");
  assert.equal(buy(buyer, stone, stone.items.find((row) => row.npcDiscount)).ok, true);
  const untouchedBuyer = structuredClone(buyer);
  for (const stall of H.state.blackStalls) {
    delete stall.npcPricingVersion;
    if (["employee", "equipment", "traveler"].includes(stall.npcRole)) {
      stall.npcDiscountIssued = 0;
      for (const row of stall.items) row.npcDiscount = false;
    }
    for (const row of stall.items) {
      delete row.npcPricingVersion;
      row.price = Math.round(row.referencePrice * 1.2);
    }
  }
  const oldShelves = new Map(H.state.blackStalls.map((stall) => [stall.id, {
    ids: ids(stall), items: structuredClone(stall.items.map((row) => row.item)),
    batch: stall.npcBatch, rotation: stall.npcRotateAt, refill: stall.npcRefillAt, shift: stall.npcShiftAt
  }]));
  assert.equal(maintainNpcBlackmarket(now).changed, true);
  for (const stall of H.state.blackStalls) {
    const previous = oldShelves.get(stall.id);
    assert.deepEqual(ids(stall), previous.ids, "pricing migration cannot replace stock identities");
    assert.deepEqual(stall.items.map((row) => row.item), previous.items, "pricing migration cannot reroll item quality");
    assert.equal(stall.npcBatch, previous.batch);
    assert.equal(stall.npcRotateAt, previous.rotation);
    assert.equal(stall.npcRefillAt, previous.refill);
    assert.equal(stall.npcShiftAt, previous.shift);
    assert.equal(stall.npcPricingVersion, NPC_PRICING_VERSION);
    assert.ok(stall.items.every((row) => row.npcPricingVersion === NPC_PRICING_VERSION && row.price <= row.referencePrice));
    assert.equal(stall.npcDiscountIssued, 1);
    assert.equal(stall.items.filter((row) => row.npcDiscount).length, stall.npcRole === "stone" ? 0 : 1);
  }
  assert.deepEqual(buyer, untouchedBuyer, "repricing cannot change already purchased goods or player cash");
  const repriced = structuredClone(H.state.blackStalls);
  assert.equal(maintainNpcBlackmarket(now).changed, false);
  assert.deepEqual(H.state.blackStalls, repriced, "repeated maintenance does not reroll prices or quotas");

  // Missing a pricing marker must not turn a spent new clearance slot into a
  // second offer, including after ordinary replacement stock has arrived.
  for (const role of ["employee", "equipment", "traveler"]) {
    const stall = stallFor(role);
    const clearance = stall.items.find((row) => row.npcDiscount);
    assert.equal(buy(buyer, stall, clearance).ok, true);
    delete stall.npcPricingVersion;
    const survivingIds = ids(stall);
    maintainNpcBlackmarket(now);
    assert.equal(stall.npcDiscountIssued, 1);
    assert.equal(stall.items.filter((row) => row.npcDiscount).length, 0);
    assert.deepEqual(ids(stall), survivingIds);
  }

  // Long downtime advances each merchant by one batch, without touching player assets or stalls.
  buyer = reset();
  const playerStall = { id: "schedule-player-stall", ownerId: buyer.id, type: "goods", status: "open", items: [], pool: [], offers: [] };
  H.state.blackStalls.push(playerStall);
  const beforePlayer = structuredClone(buyer);
  const beforePlayerStall = structuredClone(playerStall);
  const batches = new Map(H.state.blackStalls.filter((stall) => stall.npc).map((stall) => [stall.id, stall.npcBatch]));
  now += 40 * 60 * 60_000;
  maintainNpcBlackmarket(now);
  for (const stall of H.state.blackStalls.filter((entry) => entry.npc)) {
    assert.equal(stall.npcBatch, batches.get(stall.id) + 1);
    assertRotation(stall, now); assertCoverage(stall);
    assert.ok(stall.items.every((row) => row.createdAt === now));
  }
  assert.deepEqual(buyer, beforePlayer);
  assert.deepEqual(playerStall, beforePlayerStall);

  // Multiple real schedules remain bounded and vary from one batch to the next.
  reset();
  const delays = new Map(NPC_STALLS.map((rule) => [rule.role, new Set()]));
  for (let step = 0; step < 40; step += 1) {
    const previousBatches = new Map(H.state.blackStalls.map((stall) => [stall.id, stall.npcBatch]));
    now = Math.min(...H.state.blackStalls.map((stall) => stall.npcRotateAt));
    maintainNpcBlackmarket(now);
    for (const stall of H.state.blackStalls) {
      assertCoverage(stall);
      assert.ok(stall.items.every((row) => now - row.createdAt <= NPC_STALE_MS + NPC_ROTATION_MAX_MS));
      if (stall.npcBatch !== previousBatches.get(stall.id)) {
        assertRotation(stall, now);
        delays.get(stall.npcRole).add(stall.npcRotateAt - now);
      }
    }
  }
  for (const values of delays.values()) assert.ok(values.size > 2);
  console.log("blackmarket-npc-schedule-smoke: random ranges, delayed refills, age protection, stale retirement, quotas, migration, save/restart, downtime and checkout race ok");
} finally {
  Date.now = realNow;
  bindBlackmarketApi(originalApi);
}
