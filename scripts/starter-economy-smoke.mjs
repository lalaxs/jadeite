import assert from "node:assert/strict";
import { __testHooks as H } from "../server.js";
import { starterQualityForRoll, createRoughPoolService } from "../server/services/rough-pool-service.js";
import { claimWorkshopOutputs } from "./workshop-test-utils.mjs";
import { claimAllPlayerAchievements } from "../server/services/achievement-rewards.js";
import { evaluateOrderFit } from "../shared/domain/jade/jade-rules.js";
import { INITIAL_PLAYER_CASH, economyDayKey, bookRewardCash, rewardCashQuote } from "../shared/domain/economy/new-player-economy.js";
import { auctionEntryFee, auctionHallForId } from "../shared/domain/auction/jade-auction.js";
import { aiPurchaseChance } from "../server/systems/livestream-room-system.js";
import { hostBonusesFromLevels } from "../shared/domain/livestream/livestream-host-bonuses.js";
import { WORKSHOP_WORKER_DEFS } from "../server/services/workshop-roster.js";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";

assert.equal(INITIAL_PLAYER_CASH, 12_000);
assert.equal(auctionEntryFee(auctionHallForId("novice")), 200);
const draws = Array.from({ length: 10_000 }, (_, i) => starterQualityForRoll((i + 0.5) / 10_000));
assert.equal(draws.filter((key) => key === "glutinous").length, 7_000);
assert.equal(draws.filter((key) => key === "bean").length, 3_000);
assert.equal(starterQualityForRoll(0.699999), "glutinous");
assert.equal(starterQualityForRoll(0.7), "bean");
const generator = createRoughPoolService({ money: (value) => Math.round(value),
  clamp: (v, low, high) => Math.max(low, Math.min(high, v)), pick: (list) => list[0],
  getState: () => ({ roughPool: [] }) });
for (let i = 0; i < 100; i += 1) {
  let qualityDraw = true;
  const rough = generator.makeStarterRough(`bounded-starter-${i}`, { rng: () => {
    if (qualityDraw) { qualityDraw = false; return (i + 0.5) / 100; }
    return 0.5;
  } });
  assert.equal(rough.trueQualityKey, i < 70 ? "glutinous" : "bean");
  assert.ok(rough.mass >= 0.8 && rough.mass <= 1.1 && rough.price >= 1900 && rough.price <= 4700);
}
const day = Date.parse("2026-10-23T08:00:00Z");
const budgetPlayer = { onboarding: { startedAt: day, rewardCash: 0, completedAt: 0 } };
assert.equal(bookRewardCash(budgetPlayer, 800, "achievementReward", day), 800);
assert.equal(bookRewardCash(budgetPlayer, 800, "taskReward", day), 200);
assert.equal(rewardCashQuote(budgetPlayer, 800, "achievementReward", day), 0);
budgetPlayer.onboarding.completedAt = day;
budgetPlayer.rewardCashBudget = { day: economyDayKey(day), taskCash: "1000" };
assert.equal(bookRewardCash(budgetPlayer, 800, "taskReward", day), 0);
assert.equal(bookRewardCash(budgetPlayer, 800, "taskReward", day + 86_400_000), 300);
for (const ratio of [1.5, 1.65, 1.8]) {
  const chance = aiPurchaseChance({ rep: 100_000 }, { price: 10_000 * ratio,
    product: { value: 10_000, score: 6 } }, { hostSnapshot: {
    bonuses: hostBonusesFromLevels({ huashu: 10, kongchang: 10, cuidan: 10 }) } });
  assert.equal(chance, 0, "system customers do not accept quotes above the bounded premium price");
}

const random = Math.random;
const realNow = Date.now;
let clock = Date.parse("2026-10-23T08:00:00Z");
Date.now = () => clock;
const reports = [];
function withRandom(value, fn) { Math.random = () => value; try { return fn(); } finally { Math.random = random; } }
function start(player, stage, payload) {
  const device = H.workshopDevicesForPlayer(player).find((row) => row.stage === stage);
  const result = H.startWorkshopJobForPlayer(player, device.id, payload);
  assert.equal(result.ok, true, result.message);
  return result;
}
function complete(player, result, roll = 0.99) {
  clock = result.job.readyAt + 1;
  withRandom(roll, () => H.processProductionJobs(clock, { onlineOnly: false, broadcast: false }));
  claimWorkshopOutputs(H, player);
}

try {
  H.world.clear();
  for (const [key, roll] of [["glutinous", 0.5], ["bean", 0.9]]) {
    const p = withRandom(roll, () => H.makePlayer(`starter-loop-${key}`));
    H.state.players.set(p.id, p);
    assert.equal(p.cash, 12_000);
    assert.equal(p.workshop.devices.length, 0);
    assert.equal(p.workshop.workers.length, 0);
    assert.deepEqual(H.workshopDevicesForPlayer(p), []);
    assert.equal(p.rough.length, 1);
    const gift = structuredClone(p.rough[0]);
    assert.equal(gift.trueQualityKey, key);
    assert.ok(gift.mass >= 0.8 && gift.mass <= 1.1);
    assert.ok(gift.price >= 1900 && gift.price <= 4700);
    H.normalizePlayer(p);
    assert.deepEqual(p.rough[0], gift, "normalization must preserve the random draw");
    installOwnedWorkshopFixture(p);
    p.workshop.workers = [];
    H.normalizePlayer(p);
    const startedAt = clock;

    // Real failure branches must return material, release workers and charge wear once.
    const failureWorker = { ...structuredClone(WORKSHOP_WORKER_DEFS[0]), id: `${p.id}-failure-worker` };
    p.workshop.workers.push(failureWorker);
    const failedOpening = start(p, "opening", { itemId: gift.id, workerId: failureWorker.id });
    complete(p, failedOpening, 0);
    assert.equal(p.rough.length, 1);
    assert.equal(p.materials.length, 0);
    assert.ok(H.workshopDevicesForPlayer(p).find((d) => d.stage === "opening").condition < 100,
      "failed processing consumes owned machine durability");
    complete(p, start(p, "opening", { itemId: gift.id }));
    const material = p.materials.find((item) => item.id === gift.id);
    assert.equal(material.qualityKey, key);
    const plan = [{ type: "peacePendant", x: 50, y: 50, rot: 0, size: "M" }];
    complete(p, start(p, "carving", { itemId: material.id, kits: plan, workerId: failureWorker.id }), 0);
    assert.equal(p.bracelets.length, 0);
    assert.equal((p.materials.find((item) => item.id === gift.id).extractionKits || []).length, 0,
      "failed planning must not consume geometry");
    p.workshop.workers = p.workshop.workers.filter((worker) => worker.id !== failureWorker.id);
    complete(p, start(p, "carving", { itemId: material.id, kits: plan }));
    const blank = p.bracelets.find((item) => item.starterOriginId === gift.id);
    assert.ok(blank?.value > 0);
    complete(p, start(p, "finishing", { itemId: blank.id, finishPlan: {
      productType: "pendant", settingId: "cord", metalId: null, gemId: null,
      gemCount: 0, polishId: "bright", backingId: null
    } }));
    const product = p.bracelets.find((item) => item.id === blank.id);
    assert.equal(product.materialStage, "finished");
    assert.deepEqual(p.externalMaterials, { goldPure: 0, silver925: 0, gold18k: 0, platinum: 0, diamond: 0, ruby: 0, sapphire: 0 });
    assert.equal(p.cash, 12_000, "the starter path must require no extra material cash");
    const trial = p.orders.find((order) => order.starterOrder);
    assert.ok(trial);
    assert.equal(evaluateOrderFit(product, trial).tier, "full");
    const sale = H.completeOrderForPlayer(p, { orderId: trial.id, braceletIds: [product.id] });
    assert.equal(sale.ok, true, sale.message);
    assert.ok(sale.finalPay <= Math.floor(product.value * 1.25));
    assert.ok(p.onboarding.firstSaleAt);
    const saleCash = p.cash;

    // Buy a normal auction lot using only the starter bankroll and actual earned cash.
    withRandom(0.01, () => H.enterAuctionForPlayer(p, { hallId: "novice" }, clock));
    const round = H.state.auction;
    const lot = round.roughs.filter((r) => r.price <= 4000).sort((a, b) => a.price - b.price)[0];
    assert.ok(lot, "test auction must offer an affordable ordinary lot");
    const bid = Math.round(lot.price * 1.45);
    assert.equal(H.submitAuctionBidForPlayer(p, { roughId: lot.id, amount: bid }, clock).ok, true);
    clock = round.endsAt + 1;
    H.settleAuctionIfDue(clock);
    assert.ok(p.rough.some((item) => item.id === lot.id), "replenishment must actually deliver purchased stock");
    assert.ok(!p.rough.find((item) => item.id === lot.id).starterProtection, "purchased stock does not inherit starter insurance");
    assert.ok(p.cash > 4500, "next payroll and another small procurement must remain affordable");
    assert.ok(p.onboarding.completedAt, "sale then real procurement completes onboarding");

    claimAllPlayerAchievements(p, clock);
    for (const task of p.tasks) {
      if (task.status === "complete") H.claimTask(p, task.uid);
    }
    H.earnCash(p, 9_000, "budget regression", { source: "taskReward" });
    H.earnCash(p, 9_000, "budget regression", { source: "achievementReward" });
    const rewards = p.ledger.filter((row) => ["taskReward", "achievementReward"].includes(row.source));
    assert.ok(rewards.reduce((sum, row) => sum + row.amount, 0) <= 1000);
    const reloaded = structuredClone(p);
    const beforeReload = { cash: reloaded.cash, rough: reloaded.rough.map((r) => r.id) };
    H.normalizePlayer(reloaded);
    assert.deepEqual({ cash: reloaded.cash, rough: reloaded.rough.map((r) => r.id) }, beforeReload);
    assert.equal(H.earnCash(reloaded, 800, "reconnect budget", { source: "taskReward" }), 0);
    reports.push({ quality: key, initialCash: 12000, giftReference: gift.price,
      productValue: product.value, sale: sale.finalPay, cashAfterSale: saleCash,
      repurchase: bid, finalCash: p.cash, introRewards: p.onboarding.rewardCash,
      minutesIncludingForcedFailures: Math.round((clock - startedAt) / 6000) / 10 });
  }

  const inexpensiveProduct = { type: "bracelet", kind: "cabochon", materialStage: "finished", value: 659 };
  assert.equal(evaluateOrderFit(inexpensiveProduct, { persona: { motive: "撑场面" },
    hard: { kind: "cabochon", budgetUnlimited: true }, requirements: [], pay: 52000 }).tier, "full");
  const fresh = H.makePlayer("starter-no-recovery");
  fresh.cash = 0; fresh.rough = [];
  assert.equal(H.recoverPlayerIfNeeded(fresh, clock, { requested: true }).applied, false);
  const legacy = H.makePlayer("existing-assets");
  delete legacy.onboarding; delete legacy.starterRoughGranted;
  legacy.cash = 4321; legacy.rough = [];
  H.normalizePlayer(legacy);
  assert.equal(legacy.cash, 4321); assert.equal(legacy.rough.length, 0);
  console.log(JSON.stringify({ ok: true, qualityDraws: { glutinous: 7000, bean: 3000 }, loops: reports }, null, 2));
} finally { Math.random = random; Date.now = realNow; }
process.exit(0);
