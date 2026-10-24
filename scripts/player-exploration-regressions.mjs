import assert from "node:assert/strict";
import { claimWorkshopOutputs } from "./workshop-test-utils.mjs";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";
import { evaluateOrderFit, finishedProductKind } from "../shared/domain/jade/jade-rules.js";
import { itemCost, distributeItemCost } from "../shared/domain/economy/item-cost.js";
import { repFromCashFlow, productionDuration } from "../shared/domain/economy/jade-loop.js";
import { speedTimeScale } from "../shared/domain/workshop/workshop-craft-scoring.js";
import { workerProcessingFee } from "../server/systems/employee-system.js";
import { quoteFinishPlanDraft } from "../shared/domain/workshop/finish-plan-model.js";
import { applyInlay, inlayCatalog, quoteFinishPlan, reserveFinishMaterials, refundFinishMaterials } from "../server/systems/inlay-system.js";
import { acceptMarketOfferForPlayer, collectMarketPayoutForPlayer } from "../server/services/market-service.js";
import { buildLivestreamSettleReport } from "../server/systems/livestream-room-system.js";
import { buildLivestreamSettleModalEvent } from "../shared/domain/livestream/settle-modal.js";
import { applyReputationDecay } from "../server/shell/runtime-ticks.js";

process.env.JADE_WORLD_PERSIST = "0";
process.env.JADE_MINING_APPLICATION_MS = "100";
process.env.JADE_MINING_LEASE_MS = "4000";
const { __testHooks: H } = await import("../server.js");
const player = installOwnedWorkshopFixture(H.makePlayer("exploration-regression"));
player.cash = 200_000;
H.state.players.set(player.id, player);

const plan = { productType: "pendant", settingId: "cord", metalId: null,
  gemId: null, gemCount: 0, polishId: "bright", backingId: null };
const pendant = { kind: "peacePendant", value: 4000, score: 3, size: "M", materialStage: "carved" };
const quote = quoteFinishPlan(pendant, plan, 1000);
assert.equal(quote.workerFee, 0, "finishing no longer charges a worker fee");
assert.equal(quote.laborFee, 0);
assert.equal(quoteFinishPlanDraft(plan, inlayCatalog(), 1000, pendant.value).laborFee, quote.laborFee);
applyInlay(pendant, plan, quote);
assert.equal(pendant.kind, "peacePendant");
assert.equal(pendant.productType, "pendant");
assert.equal(evaluateOrderFit(pendant, { persona: {}, hard: { kind: "peacePendant" }, requirements: [] }).tier, "full");
assert.equal(finishedProductKind({ kind: "pendant", productType: "pendant", sourceMaterial: { placement: { layout: "leafPendant" } } }), "leafPendant");
let seed = 20261011;
const rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
for (let i = 0; i < 2000; i++) {
  const order = H.makeOrder(player, { rng });
  const difficulty = order.requirements.length + (order.hard.budgetUnlimited ? 2 : 0)
    + (order.hard.sizeBand ? 0.5 : 0) + 0.5;
  assert.equal(order.rep, Math.round(Math.max(4, Math.min(order.hard.budgetUnlimited ? 28 : 18,
    4 + difficulty * 3 + order.pay / 8000))), "orders retain the original reward formula");
}

// A real opening -> extraction -> finish path preserves cost and motif.
player.tasks = [{ uid: "workshop-test", type: "workshop_craft", target: 3, progress: 0, status: "active" }];
const savedRandom = Math.random;
Math.random = () => 0.99; // No fracture; validate successful progression separately.
try {
  const device = (stage) => H.workshopDevicesForPlayer(player).find((entry) => entry.stage === stage);
  const opening = H.startWorkshopJobForPlayer(player, device("opening").id, { itemId: player.rough[0].id });
  assert.equal(opening.ok, true, opening.message);
  assert.equal(player.tasks[0].progress, 0, "starting work is not completing work");
  H.processProductionJobs(opening.job.readyAt + 1, { onlineOnly: false });
  claimWorkshopOutputs(H, player);
  assert.equal(player.tasks[0].progress, 1);
  const material = player.materials.find((entry) => entry.id === opening.job.item.id);
  const carving = H.startWorkshopJobForPlayer(player, device("carving").id, { itemId: material.id,
    kits: [{ type: "peacePendant", x: 50, y: 50, size: "M", rot: 0 }] });
  assert.equal(carving.ok, true, carving.message);
  H.processProductionJobs(carving.job.readyAt + 1, { onlineOnly: false });
  claimWorkshopOutputs(H, player);
  const carved = player.bracelets.find((entry) => entry.sourceRoughId === material.id);
  const leftover = player.materials.find((entry) => entry.id === material.id);
  assert.equal(itemCost(carved).amount + itemCost(leftover).amount, opening.fee + carving.fee);
  assert.equal(itemCost(carved).complete, true);
  const beforeFinish = itemCost(carved).amount;
  const finishing = H.startWorkshopJobForPlayer(player, device("finishing").id, { itemId: carved.id, finishPlan: plan });
  assert.equal(finishing.ok, true, finishing.message);
  const finishWorker = finishing.worker;
  const finishDevice = finishing.device;
  const originalQuote = quoteFinishPlan(carved, plan, workerProcessingFee(finishWorker, 0,
    { stage: "finishing", itemValue: carved.value ?? carved.price }));
  assert.equal(finishing.fee, originalQuote.laborFee);
  assert.equal(finishing.job.readyAt - finishing.job.startedAt, Math.max(1, Math.round(
    productionDuration(finishDevice.durationStage || "finishing", process.env.JADE_TIMING_PROFILE || "normal")
      * speedTimeScale(finishWorker) * Math.max(0.2, 1 - Math.min(0.8, Number(finishDevice.attrs.speed || 0) / 100))
  )), "finishing retains the original idle duration");
  H.processProductionJobs(finishing.job.readyAt + 1, { onlineOnly: false });
  claimWorkshopOutputs(H, player);
  const finished = player.bracelets.find((entry) => entry.id === carved.id);
  assert.equal(finishedProductKind(finished), "peacePendant");
  assert.equal(itemCost(finished).amount, beforeFinish + finishing.fee);
  assert.equal(player.tasks[0].progress, 3);
  const report = buildLivestreamSettleReport({ sales: [{ id: "s", price: 2500, costValue: itemCost(finished).amount, costComplete: true }] });
  assert.equal(report.netProfit, 2500 - itemCost(finished).amount);
} finally { Math.random = savedRandom; }

const unknown = buildLivestreamSettleReport({ sales: [{ price: 2000, productValue: 1500 }] });
assert.equal(unknown.netProfit, null);
assert.ok(!buildLivestreamSettleModalEvent(unknown).stats.some((row) => row.label === "货品毛利"));
assert.equal(buildLivestreamSettleModalEvent(unknown).report.netProfit, null);
const outputs = [{ value: 150 }, { value: 250 }, { value: 600 }];
distributeItemCost({ costBasis: { amount: 997, complete: true } }, outputs);
assert.equal(outputs.reduce((sum, item) => sum + itemCost(item).amount, 0), 997);

// Weighted procurement cost survives consumption and refund.
assert.equal(H.buyMaterialPack(player, "silver925", 100).ok, true);
const stockBefore = structuredClone(player.externalMaterialCosts.silver925);
const reservation = reserveFinishMaterials(player, { metalId: "silver925", metalAmount: 2.5, gemCount: 0 });
assert.equal(reservation.ok, true);
assert.equal(reservation.reservedMaterialCosts.silver925.amount, stockBefore.amount * 2.5 / 100);
refundFinishMaterials(player, reservation.reservedMaterials, reservation.reservedMaterialCosts);
assert.deepEqual(player.externalMaterialCosts.silver925, stockBefore);

// NPC quotes leave goods and cash intact until an explicit, idempotent acceptance.
const listing = { id: "quote-listing", ownerId: player.id, price: 2000, createdAt: 1,
  item: { id: "quote-item", type: "bracelet", name: "平安扣", value: 4000 } };
H.state.listings.push(listing);
const cashBefore = player.cash;
H.processMarketLiquidity(Date.now());
assert.equal(H.state.listings.includes(listing), true);
assert.equal(player.cash, cashBefore);
assert.equal(listing.npcOffer.amount, 2000);
assert.equal(acceptMarketOfferForPlayer(player, listing.id, "stale-offer").ok, false);
const accepted = acceptMarketOfferForPlayer(player, listing.id, listing.npcOffer.id);
assert.equal(accepted.ok, true, accepted.message);
assert.equal(player.cash, cashBefore + 2000);
assert.equal(acceptMarketOfferForPlayer(player, listing.id, listing.npcOffer.id).ok, false);
player.payouts = [{ amount: 500 }];
assert.equal(collectMarketPayoutForPlayer(player).ok, true);
assert.equal(collectMarketPayoutForPlayer(player).ok, false);

assert.equal(repFromCashFlow("expense", 100_000), 100);
assert.equal(repFromCashFlow("livestream", 800), 0);
assert.equal(repFromCashFlow("livestream", 20_000), 20);
const online = { rep: 150, lastRepDecayAt: 1_000_000 };
const offline = structuredClone(online);
const later = 1_000_000 + 35 * 60_000;
applyReputationDecay(online, later);
const offlinePlayer = Object.assign(H.makePlayer("offline-decay-two"), offline);
H.settleOfflinePlayer(offlinePlayer, later);
assert.equal(offlinePlayer.rep, offline.rep, "offline reputation retains its original settlement rule");
assert.equal(offlinePlayer.lastRepDecayAt, later);

const stuck = H.makePlayer("minor-material-recovery");
for (const field of ["rough", "materials", "slices", "bracelets", "collection", "jobs"]) stuck[field] = [];
stuck.cash = 250;
stuck.externalMaterials.silver925 = 1;
stuck.stats.orderCount = 1;
stuck.onboarding.completedAt = later;
assert.equal(H.recoverPlayerIfNeeded(stuck, later).applied, false, "reconnect cannot automatically borrow");
assert.equal(H.recoverPlayerIfNeeded(stuck, later, { requested: true }).applied, true);
stuck.cash = 0;
assert.equal(H.recoverPlayerIfNeeded(stuck, later + 60 * 60_000).applied, false, "unrepaid advances cannot be repeatedly farmed");

// Restore the original 50-player opening gate and the full 30-mine pool.
player.rep = 100;
H.processMiningWorld(Date.now());
const mining = H.snapshotFor(player).mining;
assert.equal(mining.unlocked, false);
assert.equal(mining.requiredPlayers, 50);
for (let i = 0; i < 49; i++) {
  const qualified = H.makePlayer(`qualified-${i}`);
  qualified.rep = 100;
  H.state.players.set(qualified.id, qualified);
}
H.processMiningWorld(Date.now());
const originalMining = H.snapshotFor(player).mining;
assert.equal(originalMining.unlocked, true);
assert.equal(originalMining.effectiveMines.length, 30);

console.log("player-exploration-regressions: free processing, idle duration, 2,000 order rewards, reputation and mining gate restored; cost, motif and payout fixes passed");
process.exit(0);
