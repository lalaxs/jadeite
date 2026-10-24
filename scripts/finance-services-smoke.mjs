import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { financeSnapshot } from "../shared/domain/economy/finance-book.js";
import { itemCost } from "../shared/domain/economy/item-cost.js";
import { createMemoryWorldStore } from "../server/world-store.js";
import { createSqliteWorldPersister } from "../server/shell/sqlite-world-persist.js";
import { claimWorkshopOutputs } from "./workshop-test-utils.mjs";
import { claimAchievement } from "../shared/domain/progression/player-progression.js";

// The imported server is never started and cannot touch the user's real save.
process.env.JADE_WORLD_PERSIST = "0";
process.env.NODE_ENV = "test";
const { __testHooks: H } = await import("../server.js");
const market = await import("../server/services/market-service.js");
H.world.clear();
assert.equal(H.persister, null, "test import must have persistence disabled");
const results = [];
function make(id) {
  const player = H.makePlayer(id);
  H.normalizePlayer(player);
  player.cash = 200_000; player.level = 9; player.rep = 20;
  player.rough = []; player.materials = []; player.slices = []; player.bracelets = [];
  player.orders = []; player.ledger = []; player.financeBook = undefined;
  player.assets.livestreamPermitOwned = true;
  player.recovery.debt = 0; player.employeePayroll.debt = 0;
  H.state.players.set(player.id, player);
  return player;
}
const finished = (id, value = 2000) => ({ id, name: `验收成品 ${id}`, type: "bracelet", kind: "bracelet", productType: "bracelet",
  materialStage: "finished", value, score: 4, quality: "正冰", qualityKey: "ice", color: "晴水", ringSize: 56, size: "M", rep: 2 });
function acquire(player, item, cost) {
  assert.equal(H.spendCash(player, cost, "验收采购", { source: "market", itemId: item.id }), true);
  assert.equal(H.addItem(player, item, { acquisitionCost: cost }), item);
  return item;
}
const snapshot = (player) => financeSnapshot(player, H.inventoryForReport(player));
const revenue = (player) => snapshot(player).summary.salesRevenue;
const recycle = (player, itemId) => H.recycleInventoryItemForPlayer(player, { kind: "jade", itemId }, {
  earnCash: H.earnCash, money: value => Math.max(0, Math.round(Number(value) || 0))
});
function verifySale(player, before, expectedRevenue, expectedCost, label) {
  const after = snapshot(player);
  assert.equal(after.summary.salesRevenue - before.salesRevenue, expectedRevenue, `${label}: actual receipt is the only recognized sale revenue`);
  assert.equal(after.summary.soldCost - before.soldCost, expectedCost, `${label}: seller's recorded cost is recognized once`);
  assert.equal(after.summary.grossProfitKnown - before.grossProfitKnown, expectedRevenue - expectedCost, `${label}: sale margin`);
  results.push(label);
  return after;
}

// Player-to-player market: buyer tax belongs to the new buyer cost history.
const seller = make("finance-market-seller"), buyer = make("finance-market-buyer");
const marketItem = acquire(seller, finished("finance-market-piece"), 1100);
const oldBatchId = marketItem.financeBatchId;
assert.equal(H.listItemForPlayer(seller, { type: "bracelet", itemId: marketItem.id, price: 2200 }).ok, true);
const listingId = H.state.listings.find(row => row.item.id === marketItem.id).id;
let before = snapshot(seller).summary, cashBefore = seller.cash;
const marketSale = H.buyListingForPlayer(buyer, listingId);
assert.equal(marketSale.ok, true, marketSale.message);
assert.equal(seller.cash - cashBefore, 2200);
verifySale(seller, before, 2200, 1100, "market");
assert.equal(itemCost(buyer.bracelets.find(row => row.id === marketItem.id)).amount, 2244);
assert.equal(marketItem.financeOwnerId, buyer.id);
assert.notEqual(marketItem.financeBatchId, oldBatchId, "new owner starts a separate private batch");
before = snapshot(seller).summary;
assert.equal(H.buyListingForPlayer(buyer, listingId).ok, false);
assert.deepEqual(snapshot(seller).summary, before, "duplicate/stale purchases cannot book revenue twice");

// Real want escrow, real seller application and expiration settlement.
const wantItem = acquire(seller, finished("finance-want-piece"), 900);
const buyerBeforeWant = buyer.cash;
const wantPost = H.postWantForPlayer(buyer, { title: "财务验收求购", itemType: "bracelet", acceptedKinds: ["bracelet"],
  budget: 2500, minScore: 1, durationKey: "10m", rule: "lowest" });
assert.equal(wantPost.ok, true, wantPost.message);
assert.equal(market.applyWantForPlayer(seller, { wantId: wantPost.want.id, type: "bracelet", itemId: wantItem.id, price: 1800 }).ok, true);
before = snapshot(seller).summary; cashBefore = seller.cash;
wantPost.want.expiresAt = Date.now() - 1;
assert.equal(H.processExpiredWants(), true);
assert.equal(seller.cash - cashBefore, 1800);
assert.equal(buyerBeforeWant - buyer.cash, 1836, "unused escrow is refunded and 2% buyer tax is retained once");
verifySale(seller, before, 1800, 900, "market-want");
assert.equal(itemCost(buyer.bracelets.find(row => row.id === wantItem.id)).amount, 1836);
before = snapshot(seller).summary; H.processExpiredWants();
assert.deepEqual(snapshot(seller).summary, before);

// Wholesale quote is created by the real liquidity service, never invented by the test UI.
const wholesaleItem = acquire(seller, finished("finance-wholesale-piece"), 1800);
assert.equal(H.listItemForPlayer(seller, { type: "bracelet", itemId: wholesaleItem.id, price: 2500 }).ok, true);
const wholesaleListing = H.state.listings.find(row => row.item.id === wholesaleItem.id);
H.processMarketLiquidity(Date.now(), { staleMs: 0 });
assert.equal(wholesaleListing.npcOffer.amount, 1300);
before = snapshot(seller).summary; cashBefore = seller.cash;
const wholesale = market.acceptMarketOfferForPlayer(seller, wholesaleListing.id, wholesaleListing.npcOffer.id);
assert.equal(wholesale.ok, true, wholesale.message);
assert.equal(seller.cash - cashBefore, 1300);
verifySale(seller, before, 1300, 1800, "wholesale-discount-loss");

// A multi-item NPC order spans two independently acquired batches; allocations conserve cash.
const orderSeller = make("finance-order-seller");
const orderA = acquire(orderSeller, finished("finance-order-a", 2000), 1100);
const orderB = acquire(orderSeller, finished("finance-order-b", 3000), 1600);
const orderBatchIds = [orderA.financeBatchId, orderB.financeBatchId];
orderSeller.orders = [{ id: "finance-two-batch-order", client: "验收街坊", pay: 5000, rep: 2, quantity: 2,
  persona: { motive: "喜欢", personality: "宽和", temper: .45 },
  hard: { budgetMax: 6000, budgetUnlimited: false, sizeBand: "M", kind: "bracelet", kindLabel: "手镯" }, requirements: [] }];
before = snapshot(orderSeller).summary; cashBefore = orderSeller.cash;
const orderSale = H.completeOrderForPlayer(orderSeller, { orderId: orderSeller.orders[0].id, braceletIds: [orderA.id, orderB.id] });
assert.equal(orderSale.ok, true, orderSale.message);
assert.equal(orderSeller.cash - cashBefore, orderSale.finalPay);
const orderFinance = verifySale(orderSeller, before, orderSale.finalPay, 2700, "order-two-batches");
assert.equal(orderFinance.batches.filter(batch => orderBatchIds.includes(batch.id)).reduce((sum, batch) => sum + batch.revenue, 0), orderSale.finalPay);
assert.equal(orderFinance.recentSales[0].items.reduce((sum, row) => sum + row.revenue, 0), orderSale.finalPay);
before = snapshot(orderSeller).summary;
assert.equal(H.completeOrderForPlayer(orderSeller, { orderId: orderSale.order.id, braceletIds: [orderA.id, orderB.id] }).ok, false);
assert.deepEqual(snapshot(orderSeller).summary, before);

// Live room purchase exercises actual room ownership and buyer transfer.
const host = make("finance-live-seller");
const liveItems = [0, 1, 2].map(index => acquire(host, finished(`finance-live-${index}`), 700 + index * 100));
const liveStart = H.startLivestreamRoomForPlayer(host, liveItems.map(product => ({ productId: product.id, price: 2100 })));
assert.equal(liveStart.ok, true, liveStart.message);
const roomId = host.livestreamRoom.id, liveRowId = host.livestreamRoom.items[0].id;
before = snapshot(host).summary; cashBefore = host.cash;
const liveSale = H.buyLivestreamRoomItemForPlayer(buyer, roomId, liveRowId);
assert.equal(liveSale.ok, true, liveSale.message);
assert.equal(host.cash - cashBefore, 2100);
verifySale(host, before, 2100, 700, "livestream");
assert.equal(itemCost(buyer.bracelets.find(row => row.id === liveItems[0].id)).amount, 2100);
before = snapshot(host).summary;
assert.equal(H.buyLivestreamRoomItemForPlayer(buyer, roomId, liveRowId).ok, false);
assert.deepEqual(snapshot(host).summary, before);
H.closeLivestreamRoomForPlayer(host);

// Blackmarket immediate goods transfer uses the same accounting, with no imaginary seller fee.
const blackSeller = make("finance-black-seller");
const blackItem = acquire(blackSeller, finished("finance-black-piece"), 1200);
assert.equal(H.openBlackStallForPlayer(blackSeller, { type: "goods", title: "财务验收摊", anonymous: false }).ok, true);
assert.equal(H.addGoodsToStallForPlayer(blackSeller, { type: "bracelet", itemId: blackItem.id, price: 1900 }).ok, true);
const stall = H.state.blackStalls.find(row => row.ownerId === blackSeller.id), blackRowId = stall.items[0].id;
before = snapshot(blackSeller).summary; cashBefore = blackSeller.cash;
const blackSale = H.buyGoodsFromStallForPlayer(buyer, stall.id, blackRowId);
assert.equal(blackSale.ok, true, blackSale.message);
assert.equal(blackSeller.cash - cashBefore, 1900);
verifySale(blackSeller, before, 1900, 1200, "blackmarket");
assert.equal(itemCost(buyer.bracelets.find(row => row.id === blackItem.id)).amount, 1900);
before = snapshot(blackSeller).summary;
assert.equal(H.buyGoodsFromStallForPlayer(buyer, stall.id, blackRowId).ok, false);
assert.deepEqual(snapshot(blackSeller).summary, before);

// Real carving partitions one paid material's cost into multiple pieces and offcut.
const maker = make("finance-craft-seller");
const material = acquire(maker, { id: "finance-craft-material", type: "material", materialStage: "opened", stage: "material",
  name: "财务验收明料", qualityKey: "glutinous", quality: "糯种", color: "青白", score: 2, rep: 4,
  mass: 1.5, price: 12500, value: 12500, baseValue: 10000, visual: { seed: 1968 }, craftScores: { open: 85 } }, 9000);
const sourceBatchId = material.financeBatchId;
const carvingDevice = H.workshopDevicesForPlayer(maker).find(device => device.stage === "carving");
const carving = H.startWorkshopJobForPlayer(maker, carvingDevice.id, { itemId: material.id, kits: [
  { type: "peacePendant", x: 35, y: 40, size: "M", rot: 0 }, { type: "cabochon", x: 70, y: 65, size: "M", rot: 0 }
] });
assert.equal(carving.ok, true, carving.message);
const rng = Math.random;
try { Math.random = () => .999; H.processProductionJobs(carving.job.readyAt + 1, { onlineOnly: false, broadcast: false }); }
finally { Math.random = rng; }
claimWorkshopOutputs(H, maker);
assert.equal(maker.bracelets.length, 2);
const outputs = [...maker.bracelets, ...maker.materials];
assert.equal(outputs.reduce((sum, item) => sum + itemCost(item).amount, 0), 9035, "procurement plus real public carving fee is partitioned once");
assert.equal(new Set(outputs.map(item => item.financeBatchId)).size, 1);
assert.equal(outputs[0].financeBatchId, sourceBatchId);
const pieceA = maker.bracelets[0], pieceB = maker.bracelets[1];
const costA = itemCost(pieceA).amount;
before = snapshot(maker).summary; cashBefore = maker.cash;
const recycled = recycle(maker, pieceA.id);
assert.equal(recycled.ok, true, recycled.message);
assert.equal(maker.cash - cashBefore, recycled.payout);
verifySale(maker, before, recycled.payout, costA, "recycle-carved-piece");
assert.equal(H.listItemForPlayer(maker, { type: "bracelet", itemId: pieceB.id, price: 1500 }).ok, true);
const pieceListingId = H.state.listings.find(row => row.item.id === pieceB.id).id;
assert.equal(H.buyListingForPlayer(buyer, pieceListingId).ok, true);
let batch = snapshot(maker).batches.find(row => row.id === sourceBatchId);
assert.equal(batch.status, "open");
assert.equal(batch.directCost, batch.soldCost + batch.heldCost + batch.lossCost, "partial sale preserves the remaining material's cost");
assert.equal(batch.finalProfit, null, "unsold offcut prevents a final batch profit claim");
const offcut = maker.materials[0];
assert.equal(recycle(maker, offcut.id).ok, true);
batch = snapshot(maker).batches.find(row => row.id === sourceBatchId);
assert.equal(batch.status, "closed");
assert.equal(batch.directCost, batch.soldCost + batch.lossCost);
assert.equal(batch.finalProfit, batch.revenue - batch.directCost - batch.salesFees);
results.push("carving-batch-cost-conservation");

// Technical-service fees follow the customer's material; provider inputs remain operating expenses.
const provider = make("finance-service-provider"), customer = make("finance-service-customer");
assert.equal(H.openBlackStallForPlayer(provider, { type: "service", title: "真实代工验收" }).ok, true);
const openingOffer = H.addServiceOfferForPlayer(provider, { templateId: "open-window", title: "代开料", price: 200, etaMinutes: 20 });
assert.equal(openingOffer.ok, true, openingOffer.message);
const serviceStall = H.state.blackStalls.find(row => row.ownerId === provider.id);
const rough = H.makeStarterRoughs(customer.id, 1)[0];
delete rough.starterProtection; delete rough.starterOwnerId;
rough.id = "finance-service-rough";
acquire(customer, rough, 4000);
const serviceBatchId = rough.financeBatchId;
const ordered = H.orderBlackServiceForPlayer(customer, serviceStall.id, openingOffer.offer.id, { itemType: "rough", itemId: rough.id });
assert.equal(ordered.ok, true, ordered.message);
assert.equal(H.acceptBlackServiceForPlayer(provider, ordered.order.id).ok, true);
function assertEscrowCostPrivacy(item) {
  assert.ok(item, "the provider can inspect the commissioned material");
  for (const field of ["costBasis", "financeBatchId", "financeOwnerId", "financeParentItemId"]) {
    assert.equal(item[field], undefined, `commission provider must not see buyer ${field}`);
  }
  const ownerBatch = H.snapshotFor(customer).me.reports[0].finance.batches.find(batch => batch.id === serviceBatchId);
  assert.ok(ownerBatch?.items.some(row => row.id === rough.id && row.cost === 4000), "the buyer retains its own cost visibility during outsourcing");
}
assertEscrowCostPrivacy(H.snapshotFor(provider).me.rough.find(item => item.id === rough.id));
const openingStation = H.workshopDevicesForPlayer(provider).find(device => device.stage === "opening");
const providerBefore = snapshot(provider).summary, providerCashBefore = provider.cash;
const opening = H.startWorkshopJobForPlayer(provider, openingStation.id, { itemId: rough.id });
assert.equal(opening.ok, true, opening.message);
H.linkWorkshopJobToServiceOrder(ordered.order.id, provider, opening.job.id);
assertEscrowCostPrivacy(H.snapshotFor(provider).me.jobs.find(job => job.id === opening.job.id)?.item);
assert.equal(itemCost(opening.job.item).amount, 4000, "the provider's public station cannot become customer acquisition cost");
assert.equal(snapshot(provider).summary.operatingExpenses - providerBefore.operatingExpenses, 25);
try { Math.random = () => .999; H.processProductionJobs(opening.job.readyAt + 1, { onlineOnly: false, broadcast: false }); }
finally { Math.random = rng; }
assertEscrowCostPrivacy(H.snapshotFor(provider).me.workshopDeliveries.flatMap(delivery => delivery.items).find(item => item.id === rough.id));
claimWorkshopOutputs(H, provider);
assertEscrowCostPrivacy(H.snapshotFor(provider).me.materials.find(item => item.id === rough.id));
assert.equal(H.submitBlackServiceForPlayer(provider, ordered.order.id).ok, true);
const delivered = customer.materials.find(item => item.id === rough.id);
assert.equal(itemCost(delivered).amount, 4200, "delivery includes the agreed fee before the customer can resell");
assert.equal(delivered.financeOwnerId, customer.id);
assert.equal(delivered.financeBatchId, serviceBatchId);
assert.equal(snapshot(provider).summary.serviceNet - providerBefore.serviceNet, 0, "provider revenue waits for acceptance");
before = snapshot(customer).summary;
assert.equal(H.listItemForPlayer(customer, { type: "material", itemId: delivered.id, price: 5000 }).ok, true);
const deliveredListingId = H.state.listings.find(row => row.item.id === delivered.id).id;
assert.equal(H.buyListingForPlayer(buyer, deliveredListingId).ok, true);
verifySale(customer, before, 5000, 4200, "service-delivery-resold-before-confirmation");
assert.equal(H.confirmBlackServiceForPlayer(customer, ordered.order.id).ok, true);
assert.equal(provider.cash - providerCashBefore, 175);
assert.equal(snapshot(provider).summary.serviceNet - providerBefore.serviceNet, 200);
assert.equal(snapshot(provider).summary.operatingNetKnown - providerBefore.operatingNetKnown, 175);
before = snapshot(provider).summary;
assert.equal(H.confirmBlackServiceForPlayer(customer, ordered.order.id).ok, false);
assert.deepEqual(snapshot(provider).summary, before, "duplicate service confirmation cannot repeat the fee or operating income");

// Carve-service offcuts belong to the provider after handover, at zero new cost;
// the customer's unrecovered share is an explicit loss in its original batch.
const carveOffer = H.addServiceOfferForPlayer(provider, { templateId: "carve-plan", title: "代取件", price: 200, etaMinutes: 20 });
assert.equal(carveOffer.ok, true, carveOffer.message);
const serviceMaterial = acquire(customer, { id: "finance-service-carving", type: "material", materialStage: "opened", stage: "material",
  name: "委托取件明料", qualityKey: "glutinous", quality: "糯种", color: "青白", score: 2, rep: 4,
  mass: 1.5, price: 12500, value: 12500, baseValue: 10000, visual: { seed: 1968 } }, 6000);
const customerCarveBatch = serviceMaterial.financeBatchId;
const carveOrder = H.orderBlackServiceForPlayer(customer, serviceStall.id, carveOffer.offer.id, { itemType: "material", itemId: serviceMaterial.id });
assert.equal(carveOrder.ok, true, carveOrder.message);
assert.equal(H.acceptBlackServiceForPlayer(provider, carveOrder.order.id).ok, true);
const providerCarving = H.workshopDevicesForPlayer(provider).find(device => device.stage === "carving");
const serviceCarving = H.startWorkshopJobForPlayer(provider, providerCarving.id, { itemId: serviceMaterial.id,
  kits: [{ type: "peacePendant", x: 35, y: 40, size: "M", rot: 0 }] });
assert.equal(serviceCarving.ok, true, serviceCarving.message);
H.linkWorkshopJobToServiceOrder(carveOrder.order.id, provider, serviceCarving.job.id);
try { Math.random = () => .999; H.processProductionJobs(serviceCarving.job.readyAt + 1, { onlineOnly: false, broadcast: false }); }
finally { Math.random = rng; }
claimWorkshopOutputs(H, provider);
const providerOffcut = provider.materials.find(item => item.id === serviceMaterial.id && !item.escrowOrderId);
assert.ok(providerOffcut, "offcut must be available to its receiving provider");
assert.deepEqual(itemCost(providerOffcut), { amount: 0, complete: true });
assert.equal(providerOffcut.financeOwnerId, provider.id);
assert.notEqual(providerOffcut.financeBatchId, customerCarveBatch);
assert.equal(H.submitBlackServiceForPlayer(provider, carveOrder.order.id).ok, true);
const buyerBatch = snapshot(customer).batches.find(batch => batch.id === customerCarveBatch);
assert.ok(buyerBatch.lossCost > 0);
assert.equal(buyerBatch.directCost, 6200);
assert.equal(buyerBatch.directCost, buyerBatch.heldCost + buyerBatch.lossCost + buyerBatch.soldCost,
  "the service buyer keeps full procurement and service cost accounting after giving away the offcut");
assert.equal(H.confirmBlackServiceForPlayer(customer, carveOrder.order.id).ok, true);
results.push("technical-service-costs-and-offcut-transfer");

// Exceptional recovery after delivery refunds the already-capitalized fee.
// It adjusts the original customer's held/sold costs, never a later buyer's cost.
for (const sold of [false, true]) {
  const refundProvider = make(`refund-provider-${sold}`), refundCustomer = make(`refund-customer-${sold}`);
  assert.equal(H.openBlackStallForPlayer(refundProvider, { type: "service", title: "退款代工" }).ok, true);
  const offer = H.addServiceOfferForPlayer(refundProvider, { templateId: "open-window", title: "代开料", price: 200, etaMinutes: 20 });
  assert.equal(offer.ok, true);
  const stall = H.state.blackStalls.find(row => row.ownerId === refundProvider.id);
  const input = H.makeStarterRoughs(refundCustomer.id, 1)[0];
  delete input.starterProtection; delete input.starterOwnerId;
  acquire(refundCustomer, input, 4000);
  const order = H.orderBlackServiceForPlayer(refundCustomer, stall.id, offer.offer.id, { itemType: "rough", itemId: input.id });
  assert.equal(order.ok, true);
  assert.equal(H.acceptBlackServiceForPlayer(refundProvider, order.order.id).ok, true);
  const device = H.workshopDevicesForPlayer(refundProvider).find(row => row.stage === "opening");
  const job = H.startWorkshopJobForPlayer(refundProvider, device.id, { itemId: input.id });
  assert.equal(job.ok, true);
  H.linkWorkshopJobToServiceOrder(order.order.id, refundProvider, job.job.id);
  try { Math.random = () => .999; H.processProductionJobs(job.job.readyAt + 1, { onlineOnly: false, broadcast: false }); }
  finally { Math.random = rng; }
  claimWorkshopOutputs(H, refundProvider);
  assert.equal(H.submitBlackServiceForPlayer(refundProvider, order.order.id).ok, true);
  const output = refundCustomer.materials.find(row => row.id === input.id);
  const originalRefundBatchId = output.financeBatchId;
  assert.equal(itemCost(output).amount, 4200);
  if (sold) {
    assert.equal(H.listItemForPlayer(refundCustomer, { type: "material", itemId: output.id, price: 5000 }).ok, true);
    const listing = H.state.listings.find(row => row.item.id === output.id);
    assert.equal(H.buyListingForPlayer(buyer, listing.id).ok, true);
    assert.equal(itemCost(buyer.materials.find(row => row.id === output.id)).amount, 5100);
  }
  const revenueBefore = snapshot(refundCustomer).summary.salesRevenue;
  H.state.players.delete(refundProvider.id);
  const actualNow = Date.now;
  const refundAt = actualNow() + 86_400_000;
  let recovered;
  try {
    Date.now = () => refundAt;
    recovered = H.reconcileBlackmarketReferences(H.state, refundAt);
  } finally { Date.now = actualNow; }
  assert.equal(recovered.refundedFees, 200);
  const after = snapshot(refundCustomer);
  assert.equal(after.summary.salesRevenue, revenueBefore);
  const batch = after.batches.find(row => row.id === originalRefundBatchId);
  assert.equal(batch.directCost, 4000);
  if (sold) {
    assert.equal(after.summary.soldCost, 4000);
    assert.equal(after.summary.grossProfit, 1000);
    assert.equal(itemCost(buyer.materials.find(row => row.id === output.id)).amount, 5100, "successor acquisition cost is unchanged");
    assert.ok(after.daily.some(day => day.soldCost === -200), "a later-day cost correction is a contra cost, not fictional new sales");
  } else assert.equal(itemCost(output).amount, 4000);
  assert.equal(H.reconcileBlackmarketReferences(H.state).refundedFees, 0);
  assert.deepEqual(snapshot(refundCustomer).summary, after.summary);
  results.push(sold ? "delivered-refund-after-resale" : "delivered-refund-held-cost");
}

// Achievement material grants have real zero acquisition cost, including when mixed with paid stock.
const giftOnly = make("finance-gift-only"), giftMixed = make("finance-gift-mixed");
for (const recipient of [giftOnly, giftMixed]) {
  recipient.externalMaterials = {}; recipient.externalMaterialCosts = {};
  recipient.stats.finishedMade = 1;
}
const paidSilver = H.buyMaterialPack(giftMixed, "silver925", 4);
assert.equal(paidSilver.ok, true, paidSilver.message);
const paidPool = structuredClone(giftMixed.externalMaterialCosts.silver925);
for (const recipient of [giftOnly, giftMixed]) {
  const granted = claimAchievement(recipient, "finished", { earnCash: H.earnCash, markExternalMaterialNew: H.markExternalMaterialNew });
  assert.equal(granted.ok, true, granted.message);
  assert.equal(granted.granted.materials.silver925, 8);
}
assert.deepEqual(giftOnly.externalMaterialCosts.silver925, { quantity: 8, amount: 0, complete: true });
assert.deepEqual(giftMixed.externalMaterialCosts.silver925, { quantity: 12, amount: paidPool.amount, complete: true });
const reserved = H.reserveFinishMaterials(giftMixed, { metalId: "silver925", metalAmount: 2.5, gemId: null, gemCount: 0 });
assert.equal(reserved.ok, true, reserved.message);
assert.equal(giftMixed.externalMaterialCosts.silver925.amount + reserved.reservedMaterialCosts.silver925.amount, paidPool.amount);
H.refundFinishMaterials(giftMixed, reserved.reservedMaterials, reserved.reservedMaterialCosts);
assert.deepEqual(giftMixed.externalMaterialCosts.silver925, { quantity: 12, amount: paidPool.amount, complete: true });
assert.equal(claimAchievement(giftOnly, "finished", { earnCash: H.earnCash }).ok, false, "same achievement grant cannot repeat");
results.push("achievement-free-material-pool-conservation");

// Reconnect, private projection and SQLite checkpoint must retain ledger and asset attribution.
const financeBefore = new Map([...H.state.players.values()].map(player => [player.id, snapshot(player)]));
const buyerItem = buyer.bracelets.find(row => row.id === marketItem.id);
const attribution = { owner: buyerItem.financeOwnerId, batch: buyerItem.financeBatchId, cost: structuredClone(buyerItem.costBasis) };
const dir = mkdtempSync(path.join(tmpdir(), "jade-finance-services-"));
let saver, loader;
try {
  const filePath = path.join(dir, "finance.sqlite");
  const isolated = createMemoryWorldStore(); isolated.importSnapshot(H.world.exportSnapshot());
  saver = createSqliteWorldPersister({ world: isolated, filePath }); saver.flushSync(); saver.close(); saver = null;
  const restoredWorld = createMemoryWorldStore();
  loader = createSqliteWorldPersister({ world: restoredWorld, filePath });
  assert.equal(loader.loadIfPresent().loaded, true);
  assert.equal(loader.integrityCheck(), "ok");
  H.world.importSnapshot(restoredWorld.exportSnapshot());
  for (const player of H.state.players.values()) {
    H.normalizePlayer(player);
    const after = snapshot(player), saved = financeBefore.get(player.id);
    assert.deepEqual(after.summary, saved.summary, `${player.id}: checkpoint/reconnect does not create a second sale`);
    assert.deepEqual(after.recentSales, saved.recentSales);
  }
  const restoredItem = H.state.players.get(buyer.id).bracelets.find(row => row.id === marketItem.id);
  assert.deepEqual({ owner: restoredItem.financeOwnerId, batch: restoredItem.financeBatchId, cost: restoredItem.costBasis }, attribution);
  results.push("sqlite-and-normalization");
} finally {
  saver?.close(); loader?.close();
  const resolved = path.resolve(dir);
  assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep), "cleanup stays in the temporary workspace");
  rmSync(resolved, { recursive: true, force: true });
}
console.log(JSON.stringify({ ok: true, scenarios: results, players: H.state.players.size, permanentPersistence: false }));
