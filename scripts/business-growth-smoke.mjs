import assert from "node:assert/strict";
import { createGame } from "../server/create-game.js";
import { businessAccess, businessProfit, businessCapacity, BUSINESS_DAY_MS } from "../shared/domain/progression/business-growth.js";
import { operatingReserveFor } from "../shared/domain/economy/operating-reserve.js";
import { createMemoryWorldStore } from "../server/world-store.js";
import { previewIncomeCash } from "../shared/domain/economy/finance-book.js";

const game = createGame({ env: { NODE_ENV: "test", JADE_WORLD_PERSIST: "0", PORT: "3198" } });
const h = game.__testHooks;
const service = h.businessService;
function player(id, mode) {
  const p = h.makePlayer(id);
  h.state.players.set(p.id, p);
  assert.equal(p.cash, 0);
  assert.equal(p.rough.length, 0);
  assert.equal(p.assets.workshopOwned, false);
  assert.equal(service.chooseBusinessStart(p, mode).ok, true);
  return p;
}
function trade(p) {
  const offer = p.business.supply.find(row => row.price <= p.cash);
  assert.ok(offer, `没有可购货源，余额${p.cash}`);
  const oldProfit = businessProfit(p);
  assert.equal(service.buyNeighborhoodItem(p, offer.id).ok, true);
  assert.equal(businessProfit(p), oldProfit);
  const item = p.bracelets.find(item => item.id === offer.item.id);
  assert.ok(item?.jadePiece, "商品继承真实翡翠切片外观");
  assert.equal(service.sellNeighborhoodItem(p, item.id).ok, true);
  assert.equal(businessProfit(p), oldProfit + offer.buyerPay - offer.price);
}
function completeAndClaim(p) {
  const originalRandom = Math.random;
  const originalNow = Date.now;
  const at = Math.max(...p.jobs.map(job => job.readyAt)) + 1;
  try {
    Math.random = () => .999;
    Date.now = () => at;
    h.processProductionJobs(at, { broadcast: false, onlineOnly: false });
    for (const delivery of [...p.workshopDeliveries]) {
      assert.equal(h.revealWorkshopDeliveryForPlayer(p, delivery.id).ok, true);
      if (delivery.scratchReveal?.itemIds.length) assert.equal(h.revealWorkshopDeliveryForPlayer(p, delivery.id, { itemIds: delivery.scratchReveal.itemIds }).ok, true);
      assert.equal(h.claimWorkshopDeliveryForPlayer(p, delivery.id).ok, true);
    }
  } finally { Math.random = originalRandom; Date.now = originalNow; }
}
try {
  const p = player("business-ordinary", "ordinary");
  assert.equal(p.cash, 500);
  assert.equal(businessProfit(p), 0);
  assert.equal(businessCapacity(p, "goods"), 2);
  assert.equal(businessAccess(p, "workshop").ok, false);
  assert.equal(h.enterAuctionForPlayer(p, { hallId: "novice" }).ok, false);
  assert.equal(service.buildBusiness(p, "workshop").ok, false);
  const before = p.cash;
  trade(p);
  assert.equal(p.cash, before + 15);
  assert.equal(p.business.reservations.length, 0);
  assert.equal(service.chooseBusinessStart(p, "venture").ok, false);
  assert.equal(service.borrowBusinessLoan(p, 500).ok, true);
  assert.equal(businessProfit(p), 10, "贷款本金不算盈利，首期利息扣5元");
  const loan = p.business.loans[0];
  assert.equal(service.repayBusinessLoan(p, 405).ok, true);
  assert.equal(loan.principal, 100);
  const at = loan.nextInterestAt;
  service.settleBusinessForPlayer(p, at);
  assert.equal(loan.interest, 1, "只按剩余100本金计息");
  service.repayBusinessLoan(p, 101, at);
  assert.equal(loan.principal, 0);
  assert.equal(businessProfit(p), 9);

  const forecast = player("business-cash-forecast", "ordinary");
  trade(forecast);
  service.borrowBusinessLoan(forecast, 500);
  const offer = forecast.business.supply.find(row => row.price <= forecast.cash);
  assert.equal(service.buyNeighborhoodItem(forecast, offer.id).ok, true);
  const income = previewIncomeCash(forecast, offer.buyerPay, { source: "neighborhood-sale", profit: offer.buyerPay-offer.price });
  const forecastCash = forecast.cash;
  assert.equal(service.sellNeighborhoodItem(forecast, offer.item.id).ok, true);
  assert.equal(forecast.cash-forecastCash, income.cashIncrease, "预计到账与按利润自动还贷结果一致");
  assert.ok(income.businessLoanRepayment > 0);
  assert.equal(previewIncomeCash(forecast, 1000, { source: "order" }).businessLoanRepayment, 0, "成本未知不按营业额强扣");

  const growth = player("business-growth", "ordinary");
  let count = 0;
  while (businessProfit(growth) < 10_000 && count++ < 250) {
    trade(growth);
    if (businessProfit(growth) >= 1000 && !growth.business.built.includes("stall")) assert.equal(service.buildBusiness(growth, "stall").ok, true);
    if (businessProfit(growth) >= 3000 && !growth.business.built.includes("expanded")) assert.equal(service.buildBusiness(growth, "expanded").ok, true);
  }
  assert.ok(businessProfit(growth) >= 10_000, "正常小额经营可以达到工坊目标");
  const profitBeforeBuild = businessProfit(growth);
  assert.equal(service.buildBusiness(growth, "workshop").ok, true);
  assert.equal(businessProfit(growth), profitBeforeBuild, "建设不倒扣经营利润");
  assert.equal(growth.workshop.devices.filter(row => row.stage === "opening").length, 1);
  assert.equal(service.buildBusiness(growth, "workshop").ok, false);
  assert.equal(businessAccess(growth, "carving").ok, false);
  const publicDeviceIds = h.workshopDevicesForPlayer(growth).map(row => row.id);
  assert.ok(publicDeviceIds.includes("public-opening"));
  assert.ok(!publicDeviceIds.includes("public-carving"));
  const restored = JSON.parse(JSON.stringify(growth));
  h.normalizePlayer(restored);
  assert.equal(restored.business.built.includes("workshop"), true);
  assert.equal(restored.workshop.devices.length, 1, "重连不重复赠机");

  const beforeCommission = businessProfit(growth);
  assert.equal(service.startOpeningCommission(growth).ok, true);
  assert.equal(growth.jobs.length, 1, "来料单实际占用开料工位");
  completeAndClaim(growth);
  const customerItem = growth.materials.find(item => item.customerCommissionId);
  assert.ok(customerItem);
  assert.equal(service.sellNeighborhoodItem(growth, customerItem.id).ok, false);
  assert.equal(h.recycleInventoryItemForPlayer(growth, { type: "material", itemId: customerItem.id }).ok, false);
  assert.equal(service.claimOpeningCommission(growth).ok, true);
  assert.equal(businessProfit(growth), beforeCommission + 200);
  assert.equal(Boolean(growth.business.milestones.openedSold), false, "客户来料不冒充自主开料销售");
  const raw = h.makeStarterRoughs(growth.id)[0];
  delete raw.starterProtection;
  delete raw.starterOriginId;
  delete raw.starterOwnerId;
  h.spendCash(growth, 1000, "购入测试原石", { source: "blackmarket", itemId: raw.id });
  h.addItem(growth, raw, { type: "rough", acquisitionCost: 1000 });
  assert.equal(h.startWorkshopJobForPlayer(growth, growth.workshop.devices[0].id, { itemId: raw.id }).ok, true);
  completeAndClaim(growth);
  const opened = growth.materials.find(item => item.id === raw.id);
  assert.ok(opened?.openedByPlayerId === growth.id);
  assert.equal(service.sellNeighborhoodItem(growth, opened.id).ok, true);
  assert.equal(growth.business.milestones.openedSold, true);

  const winner = player("business-winner", "small");
  let winningTrades = 0;
  while (businessProfit(winner) < 10_000 && winningTrades++ < 250) {
    trade(winner);
    if (businessProfit(winner) >= 1000 && !winner.business.built.includes("stall")) service.buildBusiness(winner, "stall");
    if (businessProfit(winner) >= 3000 && !winner.business.built.includes("expanded")) service.buildBusiness(winner, "expanded");
  }
  assert.equal(winner.business.contract.status, "succeeded");
  assert.equal(winner.business.contract.rewardPaid, true);
  const winningCash = winner.cash;
  service.settleBusinessForPlayer(winner);
  assert.equal(winner.cash, winningCash, "达标奖励只发一次");
  assert.ok(winner.cash - 500 + 800 - businessProfit(winner) === 2000, "奖励到账但不计入经营利润");

  const failed = player("business-failure", "small");
  trade(failed);
  const deadline = failed.business.contract.endsAt;
  const cash = failed.cash;
  const reserve = operatingReserveFor(failed);
  service.settleBusinessForPlayer(failed, deadline);
  assert.equal(failed.business.contract.status, "failed");
  assert.equal(failed.business.contract.initialDebt, 5505);
  assert.equal(failed.cash, Math.min(cash, reserve));
  const debt = failed.business.loans[0];
  const firstDebt = debt.principal + debt.penalty + debt.interest;
  service.settleBusinessForPlayer(failed, deadline);
  assert.equal(failed.business.loans.length, 1);
  assert.equal(debt.principal + debt.penalty + debt.interest, firstDebt, "失败和首期利息只结算一次");
  service.settleBusinessForPlayer(failed, deadline + BUSINESS_DAY_MS);
  assert.equal(debt.principal + debt.penalty + debt.interest, firstDebt + 5, "违约金不滚息");

  const rich = player("business-venture", "venture");
  assert.equal(rich.cash, 10_000);
  assert.equal(businessProfit(rich), 0);
  assert.equal(service.buildBusiness(rich, "workshop").ok, false, "启动金不绕过盈利门槛");
  const old = JSON.parse(JSON.stringify(growth));
  delete old.business;
  old.assets.livestreamPermitOwned = true;
  h.normalizePlayer(old);
  assert.equal(businessAccess(old, "finishing").ok, true);
  assert.equal(businessAccess(old, "livestream").ok, true);
  assert.equal(businessCapacity(old, "goods"), 24);
  const saved = h.world.exportSnapshot();
  const loaded = createMemoryWorldStore();
  loaded.importSnapshot(JSON.parse(JSON.stringify(saved)));
  assert.equal(loaded.getPlayer(failed.id).business.loans[0].penalty, debt.penalty, "正式世界存档保留本金、违约金与利息");
  console.log(`business growth passed: ${count} real trades to workshop, startup, debt, interest, persistence and inherited access`);
} finally {
  await game.shutdown();
}
