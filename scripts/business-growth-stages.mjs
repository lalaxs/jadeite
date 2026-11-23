import assert from "node:assert/strict";
import { createGame } from "../server/create-game.js";
import { businessProfit, businessCapacity, businessHallAccess, observeBusinessProgress } from "../shared/domain/progression/business-growth.js";
import { createWorkshopCommands } from "../server/services/workshop/commands.js";

const game = createGame({ env: { NODE_ENV: "test", JADE_WORLD_PERSIST: "0", PORT: "3197" } });
const h = game.__testHooks, s = h.businessService;
const realNow = Date.now, realRandom = Math.random;
let now = Date.parse("2026-10-25T04:00:00Z");
Date.now = () => now;
function make(id, option) {
  const p = h.makePlayer(id); h.state.players.set(id, p);
  assert.equal(s.chooseBusinessStart(p, option, now).ok, true);
  return p;
}
function finish(p) {
  now = Math.max(...p.jobs.map(j => j.readyAt)) + 1;
  Math.random = () => .999;
  h.processProductionJobs(now, { onlineOnly: false, broadcast: false });
  Math.random = realRandom;
  for (const d of [...p.workshopDeliveries]) {
    assert.equal(h.revealWorkshopDeliveryForPlayer(p, d.id).ok, true);
    if (d.scratchReveal?.itemIds.length) assert.equal(h.revealWorkshopDeliveryForPlayer(p, d.id, { itemIds: d.scratchReveal.itemIds }).ok, true);
    assert.equal(h.claimWorkshopDeliveryForPlayer(p, d.id).ok, true);
  }
}
try {
  const results = [];
  for (const option of ["trade", "venture"]) {
    const p = make(`timed-${option}`, option);
    let trades = 0, commissions = 0;
    while (p.business.contract.status === "active" && now < p.business.contract.endsAt) {
      let sold = false;
      for (const offer of p.business.supply) {
        if (offer.price > p.cash) continue;
        const buy = s.buyNeighborhoodItem(p, offer.id, now);
        if (!buy.ok) continue;
        assert.equal(s.sellNeighborhoodItem(p, offer.item.id, now).ok, true);
        trades++; sold = true; now += 6000; break;
      }
      for (const id of ["stall", "expanded", "workshop"]) {
        const result = s.buildBusiness(p, id, { now });
        if (result.ok) assert.ok(p.business.built.includes(id));
      }
      if (!sold) {
        assert.ok(p.business.built.includes("workshop"), "需求耗尽前能建设工坊");
        const start = s.startOpeningCommission(p, now);
        assert.equal(start.ok, true, start.message);
        finish(p);
        assert.equal(s.claimOpeningCommission(p, now).ok, true);
        commissions++;
      }
      s.settleBusinessForPlayer(p, now);
    }
    assert.equal(p.business.contract.status, "succeeded", `${option}可在正常加工时长和真实收购限额下达标`);
    assert.equal(p.business.contract.rewardPaid, true);
    results.push({ option, trades, commissions, hours: Number(((now-p.business.chosenAt)/3600000).toFixed(2)) });
  }

  const p = make("stage-pipeline", "ordinary");
  // Qualification fixtures isolate stage permissions from the timed economy above.
  function profitTo(target) {
    h.earnCash(p, target-businessProfit(p), "阶段经营收益夹具", { source: "commission", at: now });
    observeBusinessProgress(p, now);
  }
  function build(id, target, options = {}) {
    profitTo(target);
    const result = s.buildBusiness(p, id, { ...options, now });
    assert.equal(result.ok, true, `${id}: ${result.message}`);
    assert.equal(s.buildBusiness(p, id, { now }).ok, false);
  }
  build("stall", 1000); build("expanded", 3000); build("workshop", 10000);
  const raw = h.makeStarterRoughs(p.id)[0];
  delete raw.starterProtection; delete raw.starterOwnerId;
  h.addItem(p, raw, { type: "rough", acquisitionCost: 1000 });
  assert.equal(h.startWorkshopJobForPlayer(p, p.workshop.devices[0].id, { itemId: raw.id }).ok, true);
  finish(p);
  const opened = p.materials.find(i => i.id === raw.id);
  assert.ok(opened);
  // Sell a second real opened lot, retaining this one for extraction.
  const sale = { ...structuredClone(opened), id: "opened-sale" };
  h.addItem(p, sale, { type: "material", acquisitionCost: 1000 });
  assert.equal(s.sellNeighborhoodItem(p, sale.id, now).ok, true);
  build("auction", 30000);
  assert.equal(businessHallAccess(p, "novice").ok, true);
  assert.equal(businessHallAccess(p, "regular").ok, false);
  build("carving", 50000, { buyEquipment: false });
  assert.equal(p.workshop.devices.some(d => d.stage === "carving"), false);
  const commands = createWorkshopCommands({ normalizePlayer: h.normalizePlayer, playerOwnsWorkshop: h.playerOwnsWorkshop, workshopDeviceForPlayer: h.workshopDeviceForPlayer });
  assert.equal(commands.assignWorkshopWorkerForPlayer(p, { deviceId: "public-carving", workerId: "owner-operator" }).ok, false, "公共工位固定掌柜操作");
  const cash = p.cash;
  const carve = h.startWorkshopJobForPlayer(p, "public-carving", { itemId: opened.id, kits: [
    { type: "peacePendant", x: 30, y: 50, size: "M" }, { type: "peacePendant", x: 70, y: 50, size: "M" }
  ] });
  assert.equal(carve.ok, true, carve.message); assert.equal(p.cash, cash-35);
  finish(p);
  const blanks = p.bracelets.filter(i => i.materialStage === "carved");
  assert.equal(blanks.length, 2);
  assert.equal(s.sellNeighborhoodItem(p, blanks[0].id, now).ok, true);
  assert.equal(p.business.milestones.carvedSold, true);
  build("finishing", 80000);
  assert.equal(businessCapacity(p, "collection"), 5);
  const fin = h.startWorkshopJobForPlayer(p, p.workshop.devices.find(d=>d.stage==="finishing").id, {
    itemId: blanks[1].id, finishPlan: { productType: "pendant", settingId: "cord", metalId: null, gemId: null, gemCount: 0, polishId: "bright", backingId: null }
  });
  assert.equal(fin.ok, true, fin.message); finish(p);
  const product = p.bracelets.find(i=>i.id===blanks[1].id);
  assert.equal(product.craftedByPlayerId, p.id);
  const liveProduct = { ...structuredClone(product), id: "live-product" };
  h.addItem(p, liveProduct, { type: "bracelet", acquisitionCost: 1000 });
  assert.equal(s.sellNeighborhoodItem(p, product.id, now).ok, true);
  build("livestream", 150000);
  const live = h.startLivestreamRoomForPlayer(p, [{ productId: liveProduct.id, price: Math.round(liveProduct.value) }], null, now);
  assert.equal(live.ok, true, live.message);
  assert.equal(p.livestreamRoom.hostSnapshot.id, "owner-operator");
  assert.equal(businessCapacity(p, "live"), 3);
  // A buyer completes the room's actual purchase command.
  const buyer = make("stage-live-buyer", "venture"); buyer.cash = 100000;
  const bought = h.buyLivestreamRoomItemForPlayer(buyer, p.livestreamRoom.id, p.livestreamRoom.items[0].id, now);
  assert.equal(bought.ok, true, bought.message);
  assert.equal(p.business.milestones.liveSold, true);
  build("store", 300000);
  assert.equal(businessCapacity(p, "goods"), 24);
  assert.equal(businessCapacity(p, "collection"), 20);
  assert.equal(businessCapacity(p, "live"), 6);
  build("legendary", 600000);
  assert.equal(businessHallAccess(p, "legendary").ok, true);
  assert.equal(businessCapacity(p, "live"), 12);
  p.financeBook.totals.financeCosts += 900000;
  assert.equal(businessHallAccess(p, "legendary").ok, true, "亏损不收回已建资格");
  console.log(JSON.stringify({ ok: true, timedContracts: results, stages: p.business.built }, null, 2));
} finally {
  Date.now = realNow; Math.random = realRandom;
  await game.shutdown();
}
