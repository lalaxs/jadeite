import assert from "node:assert/strict";
import { __testHooks as H } from "../server.js";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";
import { scaleForOpeningKit } from "../shared/domain/jade/jade-opening-engine.js";
import { canonicalizeExtractionKitIntents } from "../server/services/workshop-planning.js";
import {
  canonicalizeFinishPlan,
  quoteFinishPlan
} from "../server/systems/inlay-system.js";

function reset() {
  H.state.players.clear();
  H.state.sockets.clear();
  H.state.roughPool.length = 0;
  H.state.listings.length = 0;
  H.state.blackListings.length = 0;
  H.state.blackStalls ||= [];
  H.state.blackStalls.length = 0;
  H.state.blackServiceOrders ||= [];
  H.state.blackServiceOrders.length = 0;
  H.state.wants.length = 0;
  H.state.news.length = 0;
  H.state.auction = null;
  H.state.latestAuctionResults = [];
  H.state.auctionHistory = [];
}

function installPlayer(id) {
  const player = installOwnedWorkshopFixture(H.makePlayer(id));
  H.normalizePlayer(player);
  player.id = id;
  player.name = `规划测试-${id}`;
  player.cash = 500_000;
  player.achievementPoints = 1_000;
  player.achievementPointsBonus = 1_000;
  H.state.players.set(id, player);
  return player;
}

function openedMaterial(id) {
  return {
    id,
    type: "material",
    name: `测试明料-${id}`,
    materialStage: "opened",
    stage: "material",
    value: 8_000,
    price: 8_000,
    quality: "冰种",
    qualityKey: "icy",
    color: "晴绿",
    score: 4,
    rep: 6,
    visual: { seed: id }
  };
}

const canonicalKits = canonicalizeExtractionKitIntents([{
  id: "authority-kit",
  type: "bangle",
  openingTpl: "bangle",
  x: 40,
  y: 45,
  rot: 181,
  ringSize: 56,
  scale: 99,
  value: 99_999_999
}], { requireIds: true });
assert.equal(canonicalKits.ok, true);
assert.equal(canonicalKits.kits[0].scale, scaleForOpeningKit("bangle", 56));
assert.equal(canonicalKits.kits[0].rot, 1);
assert.equal("value" in canonicalKits.kits[0], false);

assert.equal(canonicalizeExtractionKitIntents([{
  id: "mismatch",
  type: "bangle",
  openingTpl: "egg",
  x: 50,
  y: 50,
  ringSize: 56
}], { requireIds: true }).ok, false, "type/template mismatch must be rejected");
assert.equal(canonicalizeExtractionKitIntents([
  { id: "duplicate", type: "cabochon", openingTpl: "egg", x: 30, y: 30, size: "M" },
  { id: "duplicate", type: "cabochon", openingTpl: "egg", x: 70, y: 70, size: "M" }
], { requireIds: true }).ok, false, "duplicate kit ids must be rejected");

const finishItem = { kind: "cabochon", value: 20_000 };
const canonicalFinish = canonicalizeFinishPlan(finishItem, {
  productType: "ring",
  settingId: "claw",
  metalId: "gold18k",
  gemId: "diamond",
  gemCount: "2",
  polishId: "bright",
  backingId: "open",
  laborFee: -1,
  metalAmount: 0,
  valueMultiplier: 999
});
assert.equal(canonicalFinish.ok, true);
assert.equal(canonicalFinish.plan.gemCount, 2);
assert.deepEqual(Object.keys(canonicalFinish.plan).sort(), [
  "backingId", "gemCount", "gemId", "gemLayout", "metalId", "polishId", "productType", "settingId"
]);
assert.equal(canonicalFinish.plan.gemLayout, "settingSlotsV2");
const finishQuote = quoteFinishPlan(finishItem, canonicalFinish.plan, 120);
assert.equal(finishQuote.laborFee, 0);
assert.ok(finishQuote.metalAmount > 0);
assert.ok(finishQuote.valueMultiplier < 999);

reset();
const workshopPlayer = installPlayer("planning-workshop");
const carvingDevice = H.workshopDevicesForPlayer(workshopPlayer)
  .find((device) => device.stage === "carving");
assert.ok(carvingDevice, "the authoritative planning fixture owns a carving device");
const material = openedMaterial("authority-workshop-material");
workshopPlayer.materials.push(material);
const cashBeforeCarving = workshopPlayer.cash;
const carveResult = H.startWorkshopJobForPlayer(workshopPlayer, carvingDevice.id, {
  itemId: material.id,
  workerId: carvingDevice.workerId,
  kits: [{
    id: "service-kit",
    type: "bangle",
    openingTpl: "bangle",
    x: 50,
    y: 50,
    rot: 0,
    ringSize: 58,
    scale: 99,
    productValue: 9_999_999
  }]
});
assert.equal(carveResult.ok, true, carveResult.message);
assert.equal(carveResult.job.options.kits[0].scale, 1);
assert.equal("productValue" in carveResult.job.options.kits[0], false);
assert.equal(workshopPlayer.cash, cashBeforeCarving);

const rejectedMaterial = openedMaterial("authority-rejected-material");
workshopPlayer.materials.push(rejectedMaterial);
const inventoryBeforeReject = workshopPlayer.materials.length;
const cashBeforeReject = workshopPlayer.cash;
const rejectedCarve = H.startWorkshopJobForPlayer(workshopPlayer, carvingDevice.id, {
  itemId: rejectedMaterial.id,
  workerId: carvingDevice.workerId,
  kits: [{
    id: "bad-template",
    type: "bangle",
    openingTpl: "egg",
    x: 50,
    y: 50,
    ringSize: 56
  }]
});
assert.equal(rejectedCarve.ok, false);
assert.equal(workshopPlayer.materials.length, inventoryBeforeReject);
assert.equal(workshopPlayer.materials.some((row) => row.id === rejectedMaterial.id), true);
assert.equal(workshopPlayer.cash, cashBeforeReject);

reset();
const seller = installPlayer("planning-blackmarket");
assert.equal(H.openBlackStallForPlayer(seller, { type: "goods", title: "权威规划摊" }).ok, true);
const blackParent = openedMaterial("authority-black-parent");
seller.materials.push(blackParent);
const blackKit = {
  id: "black-kit",
  type: "bangle",
  openingTpl: "bangle",
  x: 50,
  y: 50,
  rot: 0,
  ringSize: 56,
  scale: 99
};
const listed = H.addGoodsBatchToStallForPlayer(seller, [{
  type: "planned",
  itemId: `planned:${blackParent.id}:${blackKit.id}`,
  parentId: blackParent.id,
  kit: blackKit,
  kits: [blackKit],
  price: 800
}]);
assert.equal(listed.ok, true, listed.message);
const stall = H.state.blackStalls.find((row) => row.ownerId === seller.id);
const plannedListing = stall.items.find((row) => row.item?.sourceRoughId === blackParent.id);
assert.ok(plannedListing, "server-derived planned product should be listed");
assert.equal(
  plannedListing.item.sourceMaterial.placement.scale,
  scaleForOpeningKit("bangle", 56),
  "black-market valuation must ignore forged client scale"
);

const rejectedParent = openedMaterial("authority-black-rejected");
seller.materials.push(rejectedParent);
const stallCountBeforeReject = stall.items.length;
const rejectedPlan = H.addGoodsBatchToStallForPlayer(seller, [{
  type: "planned",
  itemId: `planned:${rejectedParent.id}:black-bad`,
  parentId: rejectedParent.id,
  kit: {
    id: "black-bad",
    type: "bangle",
    openingTpl: "egg",
    x: 50,
    y: 50,
    ringSize: 56
  },
  kits: [],
  price: 800
}]);
assert.equal(rejectedPlan.ok, false);
assert.equal(seller.materials.some((row) => row.id === rejectedParent.id), true);
assert.equal(stall.items.length, stallCountBeforeReject);

console.log("planning-authority-smoke: ok");
process.exit(0);
