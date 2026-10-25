import assert from "node:assert/strict";
import { createCommissionService } from "../server/services/commission-service.js";
import { quoteCommission } from "../shared/domain/economy/commission-rules.js";
import { createDeviceInstance, buyEquipment } from "../server/systems/equipment-system.js";
import { WORKSHOP_WORKER_DEFS } from "../server/services/workshop-roster.js";
import { materialEvaluationWeight, partitionMaterialValue } from "../shared/domain/workshop/material-value-pool.js";
import { claimWorkshopOutputs } from "./workshop-test-utils.mjs";

process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
let clock = Date.parse("2026-10-23T04:00:00Z");
const realNow = Date.now;
const realRandom = Math.random;
Date.now = () => clock;
const commissions = createCommissionService({ normalizePlayer: H.normalizePlayer, earnCash: H.earnCash,
  refreshPlayerReport: H.refreshPlayerReport, advanceTask: H.advanceTask });

function finish(p, result) {
  assert.equal(result.ok, true, result.message);
  clock = result.job.readyAt + 1;
  p.jobs = p.jobs.filter((job) => job.id !== result.job.id);
  let first = true;
  Math.random = () => { if (first) { first = false; return .99999; } return realRandom(); };
  const completion = H.completeProductionJob(p, result.job);
  Math.random = realRandom;
  claimWorkshopOutputs(H, p);
  return completion;
}

try {
  const wastePool = partitionMaterialValue({ value: 1000, baseValue: 900 }, .8, [0, 0]);
  assert.equal(wastePool.pieces.reduce((sum, item) => sum + item.value, 0), 0, "all-waste extraction must not receive an equal-money fallback");
  assert.equal(wastePool.discardedValue, 200);
  const colorBasis = { grade: { water: .6 }, palList: [{ pal: { cv: 1 } }, { pal: { cv: 6 } }, { pal: { cv: 3 } }] };
  const beforeCut = { catCounts: [100, 100, 0], price: 1000 };
  const afterCut = { catCounts: [99, 100, 0], price: 1020 };
  const beforeWeight = materialEvaluationWeight(beforeCut, colorBasis);
  const afterWeight = materialEvaluationWeight(afterCut, colorBasis);
  const positivePool = partitionMaterialValue({ value: 10_000, baseValue: 9000 }, .995, [5], { valueRetainedRatio: afterWeight / beforeWeight });
  assert.ok(afterCut.price > beforeCut.price, "fixture models the whole-object defect discount improving after a cut");
  assert.ok(positivePool.pieces[0].value > 0, "a real jade cell must transfer value even when the leftover's global defect appraisal rises");
  assert.equal(positivePool.pieces[0].value + positivePool.leftover.value, 10_000);
  H.world.clear();
  const p = H.makePlayer("owned-workshop-new");
  H.state.players.set(p.id, p);
  assert.equal(p.cash, 12_000);
  assert.equal(p.workshop.devices.length, 0);
  assert.equal(p.workshop.workers.length, 0);
  assert.equal(p.workshop.owner.isOwner, true);
  assert.deepEqual(H.workshopDevicesForPlayer(p), []);
  H.normalizePlayer(p);
  assert.equal(p.workshop.devices.length, 0);
  assert.equal(p.workshop.workers.length, 0, "normalization must not regrant the old four employees");
  assert.equal(Object.hasOwn(H.snapshotFor(p, 1).me.workshop, "publicStations"), false);
  for (const stage of ["opening", "carving", "finishing"]) {
    const before = structuredClone({ cash: p.cash, rough: p.rough });
    assert.equal(H.startWorkshopJobForPlayer(p, `public-${stage}`, { itemId: p.rough[0].id }).ok, false);
    assert.deepEqual({ cash: p.cash, rough: p.rough }, before, "unowned stations cannot start or consume resources");
  }
  // Established-business bankroll covers all three real catalog purchases.
  p.cash = 20_000;
  for (const stage of ["opening", "carving", "finishing"]) {
    const bought = buyEquipment(p, `used-${stage}-1`, { spendCash: H.spendCash, makeId: () => `owned-${stage}` });
    assert.equal(bought.ok, true, bought.message);
    assert.equal(bought.device.workerId, "owner-operator");
  }
  assert.equal(p.cash, 6000);

  const raw = p.rough[0];
  finish(p, H.startWorkshopJobForPlayer(p, "owned-opening", { itemId: raw.id }));
  const opened = p.materials[0];
  assert.ok(opened.value > 0);
  const beforePool = opened.baseValue;
  const beforeValue = opened.value;
  finish(p, H.startWorkshopJobForPlayer(p, "owned-carving", { itemId: opened.id,
    kits: [{ type: "peacePendant", x: 30, y: 50, rot: 0, size: "M" }, { type: "peacePendant", x: 70, y: 50, rot: 0, size: "M" }] }));
  const leftover = p.materials[0];
  const blanks = [...p.bracelets];
  assert.equal(blanks.length, 2);
  assert.equal(Math.round(blanks.reduce((sum, item) => sum + item.baseValue, leftover.baseValue)), Math.round(beforePool), "extraction must conserve the pure material value pool");
  const newWorkmanship = blanks.reduce((sum, item) => sum + item.craftValueContributions.plan.process + item.craftValueContributions.plan.equipment, 0);
  assert.ok(Math.abs(blanks.reduce((sum, item) => sum + item.value, leftover.value) - beforeValue - newWorkmanship) <= 1, "only the new step may add appraisal value");
  const blank = blanks[0];
  const beforeFinish = blank.value;
  finish(p, H.startWorkshopJobForPlayer(p, "owned-finishing", { itemId: blank.id, finishPlan: {
    productType: "pendant", settingId: "cord", metalId: null, gemId: null, gemCount: 0, polishId: "bright", backingId: null
  } }));
  const product = p.bracelets.find((item) => item.id === blank.id);
  assert.equal(product.craftedByPlayerId, p.id);
  assert.ok(product.value >= beforeFinish, "successful finishing must preserve existing workmanship");
  assert.equal(p.cash, 6000, "self-operated machines charge no station rental");

  const privateRaw = { ...structuredClone(raw), id: "ordinary-station-input", starterProtection: false, starterOriginId: undefined, costBasis: { amount: 1234, complete: true } };
  p.rough.push(privateRaw);
  const paidStart = H.startWorkshopJobForPlayer(p, "owned-opening", { itemId: privateRaw.id });
  assert.equal(paidStart.ok, true, paidStart.message);
  assert.equal(paidStart.fee, 0);
  assert.equal(p.cash, 6000);
  assert.equal(paidStart.job.item.costBasis.amount, 1234);
  assert.equal(commissions.startCommissionForPlayer(p, { offerId: "standard" }, clock).code, "WORKER_BUSY");
  finish(p, paidStart);

  const broken = H.makePlayer("public-workshop-broke");
  H.state.players.set(broken.id, broken);
  broken.cash = 0;
  broken.employeePayroll.status = "stopped";
  broken.employeePayroll.debt = 3000;
  const start = commissions.startCommissionForPlayer(broken, { offerId: "standard" }, clock);
  assert.equal(start.ok, true, start.message);
  assert.equal(start.commission.netPay, 180);
  assert.equal(broken.cash, 0);
  assert.equal(commissions.startCommissionForPlayer(broken, { offerId: "cord" }, clock).code, "BUSY");
  assert.equal(commissions.claimCommissionForPlayer(broken, { commissionId: start.commission.id }, clock).code, "NOT_READY");
  broken.workshop.devices = [createDeviceInstance("opening", "used-opening-1", "busy-opening")];
  assert.equal(H.startWorkshopJobForPlayer(broken, "busy-opening", { itemId: broken.rough[0].id }).code, "WORKER_BUSY");
  clock = start.commission.readyAt + 1;
  const claimed = commissions.claimCommissionForPlayer(broken, { commissionId: start.commission.id }, clock);
  assert.equal(claimed.ok, true, claimed.message);
  assert.ok(broken.cash > 0, "debt must not consume the zero-capital recovery job");
  assert.equal(commissions.claimCommissionForPlayer(broken, { commissionId: start.commission.id }, clock).ok, false);
  assert.equal(broken.commissions.completedCount, 1);
  assert.equal(broken.rough.length, 1, "NPC supplied stock must never be inserted into player inventory");

  const used = ["opening", "carving", "finishing"].map((stage) => createDeviceInstance(stage, `used-${stage}-1`, `used-${stage}`));
  const quote = quoteCommission(used, "standard");
  assert.equal(quote.netPay, 289);
  assert.ok(quote.durationMs < 11 * 60_000);
  const machineTiers = [used, ...[1, 2, 3].map((tier) => ["opening", "carving", "finishing"]
    .map((stage) => createDeviceInstance(stage, `cuijie-${stage}-${tier}`, `cuijie-${stage}-${tier}`)))];
  const incomeTiers = machineTiers.map((devices) => {
    const priced = quoteCommission(devices, "standard");
    return { cost: devices.reduce((sum, device) => sum + device.basePrice, 0), hourly: priced.netPay * 3600000 / priced.normalDurationMs };
  });
  for (let index = 1; index < incomeTiers.length; index += 1) {
    const previous = incomeTiers[index - 1];
    const next = incomeTiers[index];
    assert.ok(next.hourly > previous.hourly, "each machinery tier must improve real net earnings per active hour");
    const roi = next.cost / (next.hourly - previous.hourly);
    assert.ok(roi >= 30 && roi <= 48, `full replacement purchase ROI must stay within 30–48 hours without assuming a sale of the old line; got ${roi}`);
  }
  broken.workshop.devices = used;
  const withMachines = commissions.startCommissionForPlayer(broken, { offerId: "standard" }, clock);
  assert.equal(withMachines.ok, true);
  assert.equal(H.workshopJobsForDevice(broken, used[0].id)[0].type, "commissionJob");
  assert.equal(H.startWorkshopJobForPlayer(broken, used[0].id, { itemId: broken.rough[0].id }).code, "BUSY");

  const old = H.makePlayer("legacy-workshop-preserve");
  old.cash = 4321;
  old.workshop.workers = structuredClone(WORKSHOP_WORKER_DEFS);
  old.workshop.devices = [createDeviceInstance("opening", "cuijie-opening-1", "legacy-device")];
  H.normalizePlayer(old);
  assert.equal(old.cash, 4321);
  assert.equal(old.workshop.devices[0].id, "legacy-device");
  assert.equal(old.workshop.workers.length, 4);
  assert.equal(old.workshop.workers.find((worker) => worker.id === "worker-carving").tier, 8);
  assert.equal(old.workshop.devices[0].workerId, "worker-opening", "valid saved staffing must be preserved");
  const selfRun = H.makePlayer("new-owned-machine-default");
  selfRun.workshop.devices = [createDeviceInstance("opening", "cuijie-opening-1", "new-machine")];
  H.normalizePlayer(selfRun);
  assert.equal(selfRun.workshop.devices[0].workerId, "owner-operator", "unowned legacy default worker ids must fall back to the proprietor");
  console.log(JSON.stringify({ ok: true, ownedWorkshopCash: p.cash, brokenRecoveryCash: broken.cash, usedCommission: quote }, null, 2));
} finally {
  Date.now = realNow;
  Math.random = realRandom;
}
process.exit(0);
