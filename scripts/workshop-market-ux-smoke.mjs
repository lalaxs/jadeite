import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";
import { openingPlanningValuePreview } from "../public/features/opening/opening-render.js";
import { openingResult } from "../shared/domain/workshop/opening-result.js";
import { createBlackmarketService } from "../server/services/blackmarket/create-service.js";

process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
H.world.clear();
const player = installOwnedWorkshopFixture(H.makePlayer("ux-smoke-seller"));
player.cash = 100_000;
H.state.players.set(player.id, player);
const material = { id: "ux-material", name: "验收明料", type: "material", materialStage: "opened", stage: "material",
  value: 8000, baseValue: 8000, price: 8000, qualityKey: "icy", quality: "冰种", color: "晴绿", score: 4, rep: 4, visual: { seed: 401 } };
player.materials.push(material);
const device = H.workshopDevicesForPlayer(player).find((row) => row.stage === "carving");
const before = structuredClone({ cash: player.cash, materials: player.materials, jobs: player.jobs });
const invalid = H.startWorkshopJobForPlayer(player, device.id, { itemId: material.id, kits: [
  { id: "outside", type: "bangle", openingTpl: "bangle", x: 8, y: 8, ringSize: 56 }
] });
assert.equal(invalid.ok, false);
assert.match(invalid.message, /边缘/);
assert.deepEqual({ cash: player.cash, materials: player.materials, jobs: player.jobs }, before);

const drafts = [
  { id: "a", tpl: "egg", x: 240, y: 300, size: "M", scale: 1, svgSpace: true },
  { id: "b", tpl: "egg", x: 360, y: 300, size: "M", scale: 1, svgSpace: true }
];
const quote = openingPlanningValuePreview(material, drafts).partition;
const moved = openingPlanningValuePreview(material, [drafts[0], { ...drafts[1], y: 360 }]).partition;
assert.equal(moved.pieces[0].value, quote.pieces[0].value, "moving another piece must not reprice this piece");
assert.equal(openingPlanningValuePreview(material, [drafts[0]]).partition.pieces[0].value, quote.pieces[0].value,
  "adding another piece must not reprice this piece");
assert.equal(quote.pieces.reduce((sum, row) => sum + row.value, quote.leftover.value), material.value);
const start = H.startWorkshopJobForPlayer(player, device.id, { itemId: material.id, kits: drafts.map((kit) => ({
  id: kit.id, type: "cabochon", openingTpl: "egg", x: kit.x / 6, y: kit.y / 6, size: "M"
})) });
assert.equal(start.ok, true, start.message);
const realRandom = Math.random;
try { Math.random = () => .999; H.completeProductionJob(player, start.job); } finally { Math.random = realRandom; }
const delivery = player.workshopDeliveries.at(-1);
assert.deepEqual(delivery.items.map((row) => row.baseValue), quote.pieces.map((row) => row.baseValue), "server outputs must match the planner material quote");
assert.equal(delivery.auxiliaryItems[0].baseValue, quote.leftover.baseValue);

for (const [value, cost, title] of [[1500, 1000, "切涨了！"], [500, 1000, "切垮了"], [1000, 1000, "切平了"], [1500, 0, "赠料揭晓"]]) {
  const result = openingResult({ value, costBasis: { amount: cost, complete: true } });
  assert.equal(result.title, title);
  assert.equal(result.difference, value - cost);
}
assert.equal(openingResult({ value: 2000 }).cost, null, "missing cost must not become a fictional profit");

const notices = [];
const bm = createBlackmarketService({ ...H, getState: () => H.state, uiMoney: (amount) => `¥${amount}`,
  randomUUID, addNews: (text) => H.state.news.push({ id: randomUUID(), text }),
  money: (value) => Math.max(0, Math.round(Number(value) || 0)),
  notifyPlayerToast: (seller, message) => notices.push(message) });
const visitor = H.makePlayer("ux-smoke-visitor");
H.state.players.set(visitor.id, visitor);
assert.equal(bm.openBlackStallForPlayer(player, { type: "goods", title: "验收摊" }).ok, true);
const saleItem = { id: "ux-sale", name: "验收平安扣", type: "bracelet", kind: "peacePendant", materialStage: "carved", value: 1000, price: 1000 };
H.addItem(player, saleItem, { type: "bracelet", acquisitionCost: 600 });
assert.equal(bm.addGoodsToStallForPlayer(player, { type: "bracelet", itemId: saleItem.id, price: 1000 }).ok, true);
const stall = H.state.blackStalls.find((row) => row.ownerId === player.id);
assert.equal(bm.visitBlackStallForPlayer(player, stall.id).ok, false);
assert.equal(bm.visitBlackStallForPlayer(visitor, stall.id).ok, true);
assert.equal(bm.publicBlackStall(stall, player.id, H.publicStone).views, 1);
const now = Date.now();
stall.nextCustomerAt = now;
stall.status = "paused";
assert.equal(bm.processBlackmarketCustomers(now, () => 0).purchases.length, 0);
assert.equal(stall.views, 1);
stall.status = "open";
stall.items[0].price = 2000;
assert.equal(bm.processBlackmarketCustomers(now, () => 0).purchases.length, 0, "NPCs must respect the system price cap");
stall.nextCustomerAt = now;
stall.items[0].price = 1000;
const cash = player.cash;
const bought = bm.processBlackmarketCustomers(now, () => 0);
assert.equal(bought.purchases.length, 1);
assert.equal(player.cash, cash + 1000);
assert.equal(player.systemDemandBudget.bySource.blackmarket, 1000);
assert.equal(H.state.blackStalls.some((row) => row.id === stall.id), false, "the sold-out stall must close");
assert.ok(notices.some((text) => text.includes(saleItem.name) && text.includes("¥1000")));
assert.equal(bm.processBlackmarketCustomers(now + 25_000, () => 0).purchases.length, 0, "a sold item cannot be purchased twice");
console.log("workshop-market-ux-smoke: ok (boundary, independent quotes, server values, opening results, visits, NPC settlement)");
