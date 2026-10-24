import assert from "node:assert/strict";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";
import { createMemoryWorldStore } from "../server/world-store.js";
import { recoveryBlockers } from "../server/services/recovery-service.js";
import { findEscrowItemForOrder, returnEscrowItemToBuyer } from "../server/services/blackmarket/helpers.js";
import { validateSocketEventPayload } from "../server/protocol/socket-event-schemas.js";

process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
const player = installOwnedWorkshopFixture(H.makePlayer("workshop-delivery-test"));
player.rough.push(...H.makeStarterRoughs(player.id, 2)); // Multiple concurrent batches are this test fixture, not the new-player grant.
H.state.players.clear();
H.state.players.set(player.id, player);
const device = (stage) => H.workshopDevicesForPlayer(player).find((row) => row.stage === stage);
const success = (job) => {
  const original = Math.random;
  try { Math.random = () => .99; H.processProductionJobs(job.readyAt + 1, { onlineOnly: false }); }
  finally { Math.random = original; }
  return player.workshopDeliveries.find((row) => row.id === job.id);
};
const claim = (delivery) => {
  assert.equal(H.revealWorkshopDeliveryForPlayer(player, delivery.id).ok, true);
  if (delivery.scratchReveal?.itemIds.length) {
    assert.equal(H.revealWorkshopDeliveryForPlayer(player, delivery.id, { itemIds: delivery.scratchReveal.itemIds }).ok, true);
  }
  assert.equal(H.claimWorkshopDeliveryForPlayer(player, delivery.id).ok, true);
};

const first = H.startWorkshopJobForPlayer(player, device("opening").id, { itemId: player.rough[0].id });
assert.equal(first.ok, true, first.message);
const firstDelivery = success(first.job);
assert.equal(firstDelivery.items.length, 1);
assert.equal(firstDelivery.stage, "opening");
assert.equal(player.jobs.length, 0);
assert.equal(H.isWorkerBusy(player, first.worker.id), false);
assert.equal(H.workshopJobsForDevice(player, first.device.id).length, 0);
assert.equal(player.materials.length, 0, "unclaimed outputs cannot be used or sold");
assert.equal(H.takeItem(player, "material", firstDelivery.items[0].id), null);
assert.equal(H.claimWorkshopDeliveryForPlayer(player, firstDelivery.id).ok, false, "reveal before handover");
assert.equal(H.revealWorkshopDeliveryForPlayer(H.makePlayer("other-player"), firstDelivery.id).ok, false);
assert.ok(recoveryBlockers({ cash: 0, workshopDeliveries: [firstDelivery] }).includes("workshop-deliveries"));
assert.ok(player.reports[0].inventoryValue > 0);
const second = H.startWorkshopJobForPlayer(player, first.device.id, { itemId: player.rough[0].id });
assert.equal(second.ok, true, "unclaimed output never blocks new work");
assert.equal(player.workshopDeliveries.length, 1);

const revealed = H.revealWorkshopDeliveryForPlayer(player, firstDelivery.id);
assert.equal(revealed.ok, true);
assert.equal(H.claimWorkshopDeliveryForPlayer(player, firstDelivery.id).ok, false, "opening the box does not reveal the slice surface");
assert.equal(H.revealWorkshopDeliveryForPlayer(player, firstDelivery.id, { itemIds: ["forged"] }).ok, false);
assert.equal(H.revealWorkshopDeliveryForPlayer(player, firstDelivery.id).revealedAt, revealed.revealedAt);
// Both the pending output and its reveal cursor survive persistence and transport.
const saved = H.world.exportSnapshot();
const restoredStore = createMemoryWorldStore();
restoredStore.importSnapshot(JSON.parse(JSON.stringify(saved)));
const restored = restoredStore.getPlayer(player.id);
assert.deepEqual(restored.workshopDeliveries, player.workshopDeliveries);
const leaked = H.snapshotFor(player).me.workshopDeliveries[0];
assert.equal(leaked.items[0].trueQualityKey, undefined);
leaked.items[0].name = "client mutation";
assert.notEqual(firstDelivery.items[0].name, leaked.items[0].name);
const duplicate = structuredClone(saved);
duplicate.players[0][1].materials.push(structuredClone(firstDelivery.items[0]));
assert.throws(() => createMemoryWorldStore().importSnapshot(duplicate), /duplicate|already owned/i, "pending outputs participate in unique asset ownership");
claim(firstDelivery);
assert.equal(player.materials.length, 1);
assert.equal(player.materials[0].seen, false);
assert.equal(H.claimWorkshopDeliveryForPlayer(player, firstDelivery.id).ok, false);
assert.equal(player.materials.length, 1, "a second claim must never mint a second output");
// Release the second job normally before testing the next workshop stage.
claim(success(second.job));

const material = player.materials[0];
const carve = H.startWorkshopJobForPlayer(player, device("carving").id, { itemId: material.id, kits: [
  { type: "cabochon", x: 30, y: 40, size: "S", rot: 20 },
  { type: "cabochon", x: 70, y: 65, size: "M", rot: 0 }
] });
assert.equal(carve.ok, true, carve.message);
const multi = success(carve.job);
assert.equal(multi.items.length, 2);
assert.equal(multi.auxiliaryItems.length, 1);
assert.equal(multi.auxiliaryItems[0].leftover, true);
assert.equal(player.bracelets.length, 0);
assert.ok(!player.materials.some((item) => item.id === material.id), "offcuts wait with their output batch");
const pieceIds = multi.items.map((item) => item.id);
claim(multi);
assert.equal(player.bracelets.length, 2);
assert.deepEqual(player.bracelets.map((item) => item.id), pieceIds);
assert.ok(player.materials.some((item) => item.id === material.id && item.leftover));
const blank = player.bracelets[0];
const finish = H.startWorkshopJobForPlayer(player, device("finishing").id, { itemId: blank.id, finishPlan: {
  productType: "pendant", settingId: "cord", metalId: null, gemId: null, gemCount: 0, polishId: "bright", backingId: null
} });
assert.equal(finish.ok, true, finish.message);
const finished = success(finish.job);
assert.equal(finished.items[0].materialStage, "finished");
assert.ok(finished.items[0].components.length);
assert.equal(player.bracelets.some((item) => item.id === blank.id), false);
claim(finished);
assert.equal(player.bracelets.find((item) => item.id === blank.id).materialStage, "finished");

const offline = installOwnedWorkshopFixture(H.makePlayer("workshop-delivery-offline"));
H.state.players.set(offline.id, offline);
const opening = H.workshopDevicesForPlayer(offline).find((row) => row.stage === "opening");
const offlineJob = H.startWorkshopJobForPlayer(offline, opening.id, { itemId: offline.rough[0].id });
offline.lastSeenAt = offlineJob.job.startedAt;
const random = Math.random;
try {
  Math.random = () => .99;
  H.settleOfflinePlayer(offline, offlineJob.job.readyAt + 1);
  H.settleOfflinePlayer(offline, offlineJob.job.readyAt + 2);
} finally { Math.random = random; }
assert.equal(offline.workshopDeliveries.length, 1);
assert.equal(offline.materials.length, 0, "offline completion also waits for handover");

const failedPlayer = installOwnedWorkshopFixture(H.makePlayer("workshop-delivery-failure"));
H.state.players.set(failedPlayer.id, failedPlayer);
const failedDevice = H.workshopDevicesForPlayer(failedPlayer).find((row) => row.stage === "opening");
const failedJob = H.startWorkshopJobForPlayer(failedPlayer, failedDevice.id, { itemId: failedPlayer.rough[0].id });
try { Math.random = () => 0; H.processProductionJobs(failedJob.job.readyAt + 1, { onlineOnly: false }); }
finally { Math.random = random; }
assert.equal(failedPlayer.jobs.length, 0);
assert.equal(failedPlayer.workshopDeliveries.length, 0, "failed work must not create a reward casket");
assert.equal(failedPlayer.materials.length, 0);

// Commission expiry returns all pending commissioned pieces and leaves offcuts claimable.
const buyer = H.makePlayer("delivery-commission-buyer");
H.state.players.set(buyer.id, buyer);
const pending = offline.workshopDeliveries[0];
pending.items[0].escrowOrderId = "delivery-order";
pending.items[0].escrowFromBuyerId = buyer.id;
pending.items.push({ ...structuredClone(pending.items[0]), id: "delivery-second-piece" });
pending.auxiliaryItems.push({ id: "delivery-offcut", type: "material", materialStage: "opened", leftover: true });
const order = { id: "delivery-order", buyerId: buyer.id, sellerId: offline.id, templateId: "open-window" };
const commissionOutputIds = pending.items.map((item) => item.id);
assert.equal(findEscrowItemForOrder(offline, order.id).inDelivery, true);
assert.equal(H.computeOrderFinished(order, offline), false, "claim commission outputs before submitting");
assert.equal(returnEscrowItemToBuyer(order, H.state), true);
assert.equal(buyer.materials.filter((item) => commissionOutputIds.includes(item.id)).length, 2);
assert.equal(offline.workshopDeliveries.length, 1);
assert.equal(offline.workshopDeliveries[0].items.length, 0);
assert.equal(offline.workshopDeliveries[0].auxiliaryItems.length, 1);
assert.ok(buyer.materials.some((item) => item.id === offlineJob.job.item.id && !item.escrowOrderId));

assert.equal(validateSocketEventPayload("claimWorkshopDelivery", { deliveryId: firstDelivery.id, requestId: "delivery-test-id" }, { requireRequestId: true }).success, true);
assert.equal(validateSocketEventPayload("claimWorkshopDelivery", { deliveryId: firstDelivery.id, items: [{ id: "forged" }] }).success, false);
assert.equal(validateSocketEventPayload("revealWorkshopDelivery", {}).success, false);
console.log("workshop-delivery-smoke: three stages, multi-output/offcuts, ownership, persistence, offline, idempotency, worker release and commission expiry ok");
process.exit(0);
