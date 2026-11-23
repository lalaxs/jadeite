import { randomUUID } from "node:crypto";
import { BUSINESS_DAY_MS, STARTUP_OPTIONS, BUSINESS_BUILDINGS, normalizeBusiness, businessProfit, observeBusinessProgress,
  businessAccess, businessCapacity, businessCreditLimit, buildingAccess, BUSINESS_AUTO_REPAY_SOURCES } from "../../shared/domain/progression/business-growth.js";
import { recordFinanceBorrowingFee, recordFinanceSale } from "../../shared/domain/economy/finance-book.js";
import { itemCost } from "../../shared/domain/economy/item-cost.js";
import { operatingReserveFor } from "../../shared/domain/economy/operating-reserve.js";
import { quoteSystemDemand, bookSystemDemand } from "../../shared/domain/economy/system-demand.js";
import { createDeviceInstance } from "../systems/equipment-system.js";
import { inventoryEntries } from "./inventory-items.js";
import { canonicalizeExtractionKitIntents } from "./workshop-planning.js";
import { createNpcJadeFinish } from "./blackmarket/instances/npc-jade-finish.js";
import { payEmployeePayroll } from "../systems/employee-payroll.js";

const fail = message => ({ ok: false, message });
const outstanding = loan => loan.principal + loan.interest + loan.penalty;

export function createBusinessService({ earnCash, spendCash, addItem, takeItem, makeRoughStone, revealPolishedRough,
  startWorkshopJobForPlayer, refreshPlayerReport = () => {}, notifyPlayerToast = () => {}, makeId = randomUUID } = {}) {
  const { completeNpcJadeAppearance } = createNpcJadeFinish({});
  function note(player, text, now) {
    const b = player.business;
    b.history.unshift({ text, at: now });
    b.history = b.history.slice(0, 30);
    notifyPlayerToast(player, text);
  }
  function addDebt(player, { principal, penalty = 0, source, now }) {
    const loan = { id: makeId(), source, principal, penalty, interest: 0, startedAt: now,
      nextInterestAt: now + BUSINESS_DAY_MS, dueAt: now + 7 * BUSINESS_DAY_MS };
    player.business.loans.push(loan);
    const interest = Math.ceil(principal * .01);
    loan.interest = interest;
    recordFinanceBorrowingFee(player, penalty + interest, `business:${loan.id}:first`, now);
    return loan;
  }
  function payDebt(player, amount, { onlyLoan = null, now = Date.now() } = {}) {
    const loans = (player.business?.loans || []).filter(loan => (!onlyLoan || loan.id === onlyLoan) && outstanding(loan) > 0)
      .sort((a, b) => a.dueAt - b.dueAt);
    let remaining = Math.min(Math.max(0, Math.floor(amount)), Math.max(0, player.cash));
    let paid = 0;
    for (const loan of loans) {
      for (const field of ["interest", "penalty", "principal"]) {
        const part = Math.min(remaining, loan[field]);
        if (part <= 0) continue;
        if (!spendCash(player, part, field === "principal" ? "归还贷款本金" : field === "penalty" ? "支付合约违约金" : "支付贷款利息",
          { source: "business-repayment", financeCategory: "debt-repayment", repEligible: false, itemId: loan.id, at: now })) break;
        loan[field] -= part;
        remaining -= part;
        paid += part;
      }
    }
    return paid;
  }
  function settleBusinessForPlayer(player, now = Date.now()) {
    const b = normalizeBusiness(player, now);
    let changed = false;
    observeBusinessProgress(player, now);
    const contract = b.contract;
    if (contract?.status === "succeeded" && !contract.rewardPaid) {
      contract.rewardPaid = true;
      earnCash(player, contract.reward, `${contract.name}达标奖励`, { source: "business-reward", recoveryDebtExempt: true, repEligible: false, at: now });
      note(player, `${contract.name}达标，奖励 ¥${contract.reward.toLocaleString("zh-CN")} 已到账。`, now);
      changed = true;
    }
    if (contract?.status === "active" && now >= contract.endsAt) {
      contract.status = "failed";
      contract.completedAt = contract.endsAt;
      const loan = addDebt(player, { principal: contract.cash, penalty: Math.round(contract.target * .5), source: "contract", now: contract.endsAt });
      contract.loanId = loan.id;
      contract.initialDebt = outstanding(loan);
      let available = Math.max(0, player.cash - operatingReserveFor(player));
      if (player.employeePayroll?.debt > 0 && available > 0) {
        payEmployeePayroll(player, Math.min(available, player.employeePayroll.debt), { spendCash, now: contract.endsAt });
        available = Math.max(0, player.cash - operatingReserveFor(player));
      }
      contract.paidAtSettlement = payDebt(player, available, { onlyLoan: loan.id, now: contract.endsAt });
      note(player, `${contract.name}到期未达标，应付 ¥${contract.initialDebt.toLocaleString("zh-CN")}，已偿付 ¥${contract.paidAtSettlement.toLocaleString("zh-CN")}。`, now);
      changed = true;
    }
    for (const loan of b.loans) {
      if (loan.principal <= 0 || now < loan.nextInterestAt) continue;
      const periods = Math.floor((now - loan.nextInterestAt) / BUSINESS_DAY_MS) + 1;
      const interest = Math.ceil(loan.principal * .01) * periods;
      const periodAt = loan.nextInterestAt;
      loan.interest += interest;
      loan.nextInterestAt += periods * BUSINESS_DAY_MS;
      recordFinanceBorrowingFee(player, interest, `business:${loan.id}:${periodAt}`, now);
      changed = true;
    }
    if (changed) refreshPlayerReport(player, now);
    return changed;
  }
  function chooseBusinessStart(player, optionId, now = Date.now()) {
    const b = normalizeBusiness(player, now);
    if (b.choice) return fail("已经选择开局方式。合约与启动金仅能领取一次。");
    const option = STARTUP_OPTIONS.find(row => row.id === optionId);
    if (!option) return fail("请选择有效的经营方式。");
    b.choice = option.id;
    b.chosenAt = now;
    b.profitBase = businessProfit(player) + b.profitBase;
    if (option.target) b.contract = { ...option, status: "active", startedAt: now, endsAt: now + BUSINESS_DAY_MS, profitStart: 0, progress: 0 };
    earnCash(player, option.cash, `${option.name}启动资金`, { source: "business-start", recoveryDebtExempt: true, repEligible: false, at: now });
    refillSupply(player, now);
    note(player, `已选择${option.name}，启动资金 ¥${option.cash.toLocaleString("zh-CN")} 已到账。`, now);
    return { ok: true, message: "开局资金已到账，去黑市开始第一笔生意。" };
  }
  function buildBusiness(player, buildingId, { buyEquipment = true, now = Date.now() } = {}) {
    settleBusinessForPlayer(player, now);
    const access = buildingAccess(player, buildingId);
    if (!access.ok) return access;
    const def = BUSINESS_BUILDINGS.find(row => row.id === buildingId);
    const hasMachine = def.stage && (player.workshop?.devices || []).some(device => device.stage === def.stage);
    const equipment = def.equipment && buyEquipment && !hasMachine ? def.equipment : 0;
    const price = def.permit + def.construction + equipment;
    if (player.cash < price) return fail(`本次许可、建设与设备合计需要 ¥${price.toLocaleString("zh-CN")}。`);
    const machine = def.id === "workshop" || equipment > 0
      ? createDeviceInstance(def.stage, `used-${def.stage}-1`, makeId()) : null;
    if (!spendCash(player, price, `建设${def.name}`, { source: "asset", itemId: def.id, at: now })) return fail("现金不足。");
    const b = player.business;
    b.built.push(def.id);
    if (!b.qualified.includes(def.id)) b.qualified.push(def.id);
    if (def.id === "workshop") player.assets.workshopOwned = true;
    if (def.id === "livestream") player.assets.livestreamPermitOwned = true;
    if (machine) { machine.resourceOrigin = def.id === "workshop" ? "starter" : "purchase"; player.workshop.devices.push(machine); }
    observeBusinessProgress(player, now);
    refillSupply(player, now);
    note(player, `${def.name}已营业：${def.reward}。`, now);
    return { ok: true, message: `${def.name}已建成，${def.reward}。`, price };
  }
  function borrowBusinessLoan(player, rawAmount, now = Date.now()) {
    settleBusinessForPlayer(player, now);
    const b = player.business;
    if (!b.choice || b.trades < 1 && !(Number(player.stats?.bmDeals) > 0)) return fail("先完成一笔真实交易，再申请周转贷款。");
    if (b.loans.some(loan => outstanding(loan) > 0 && loan.dueAt <= now)) return fail("请先结清逾期债务。");
    const amount = Number(rawAmount);
    const used = b.loans.filter(loan => loan.source === "working").reduce((sum, loan) => sum + loan.principal, 0);
    const available = Math.max(0, businessCreditLimit(player) - used);
    if (!Number.isSafeInteger(amount) || amount < 100 || amount % 100 || amount > available) return fail(`可新增借款 ¥${available.toLocaleString("zh-CN")}，按100元整数倍申请。`);
    const loan = addDebt(player, { principal: amount, source: "working", now });
    earnCash(player, amount, "经营周转贷款", { source: "business-loan", recoveryDebtExempt: true, repEligible: false, at: now });
    note(player, `贷款 ¥${amount.toLocaleString("zh-CN")} 已到账，首期利息 ¥${loan.interest}。`, now);
    return { ok: true, message: `贷款到账 ¥${amount}，首期应还 ¥${outstanding(loan)}，7天到期。` };
  }
  function repayBusinessLoan(player, amount, now = Date.now()) {
    settleBusinessForPlayer(player, now);
    if (!Number.isSafeInteger(Number(amount)) || Number(amount) <= 0) return fail("请输入有效还款金额。");
    const paid = payDebt(player, Number(amount), { now });
    return { ok: paid > 0, message: paid > 0 ? `已还款 ¥${paid}。` : "当前没有可归还的债务或现金不足。" };
  }
  function positiveIncomeProfit(player, income, meta) {
    if (["commission", "consignment", "blackmarket-service-payout", "blackmarket-service-recovery-payout"].includes(meta.source)) return income;
    const sale = (player.financeBook?.recentSales || []).find(row => row.costComplete
      && (row.items.some(item => item.id === meta.itemId) || row.id === `order:${meta.itemId}`));
    return Math.max(0, Number(sale?.grossProfit) || 0);
  }
  function businessIncomeBudget(player, income, meta) {
    if (!player.business || player.business.choice === "established") return null;
    return Math.floor(positiveIncomeProfit(player, income, meta) * .3);
  }
  function repayBusinessFromIncome(player, income, meta, now = Date.now(), maxPayment = Infinity) {
    if (!player.business || !BUSINESS_AUTO_REPAY_SOURCES.has(meta.source)) return 0;
    let profit = 0;
    if (["commission", "consignment", "blackmarket-service-payout", "blackmarket-service-recovery-payout"].includes(meta.source)) profit = income;
    else {
      const sale = (player.financeBook?.recentSales || []).find(row => !row.loanRepaymentApplied && row.costComplete
        && (row.items.some(item => item.id === meta.itemId) || row.id === `order:${meta.itemId}`));
      if (!sale) return 0;
      sale.loanRepaymentApplied = true;
      profit = Math.max(0, sale.grossProfit);
    }
    const available = Math.max(0, player.cash - operatingReserveFor(player));
    return payDebt(player, Math.min(available, Math.floor(profit * .2), maxPayment), { now });
  }
  function makeSmallProduct(reference) {
    const rough = makeRoughStone({ qualityKey: "bean", mass: .7 });
    const material = revealPolishedRough(rough);
    const placement = canonicalizeExtractionKitIntents([{ type: "peacePendant", x: 50, y: 50, size: "S" }], { makeId }).kits[0];
    const item = { id: makeId(), type: "bracelet", kind: "peacePendant", jadeKind: "peacePendant", size: "S", name: "街坊小平安扣", baseName: "小平安扣",
      qualityKey: "bean", quality: material.quality, color: material.color, score: 1, value: reference, baseValue: reference, baseMaterialValue: reference,
      price: reference, mass: Math.max(.002, reference / 100000), rep: 0, count: 1, materialStage: "finished", stage: "finished", npcOrigin: "blackmarket",
      plan: placement, sourceRoughId: rough.id, sourceMaterial: { roughId: rough.id, roughName: rough.name, visual: rough.visual,
        openingSeed: rough.visual.seed, qualityKey: "bean", quality: material.quality, color: material.color,
        placement: { ...placement, openingTpl: placement.openingTpl, svgSpace: false } } };
    completeNpcJadeAppearance(item);
    item.value = reference;
    return item;
  }
  function refillSupply(player, now = Date.now()) {
    const b = player.business;
    if (!b?.choice) return;
    b.supply ||= [];
    if (b.supply.length) return;
    const trades = b.trades || 0;
    const fund = Math.max(60, Number(player.cash) || 0);
    const capacity = businessCapacity(player, "goods");
    const phaseLimit = b.built.includes("store") ? 60000 : b.built.includes("livestream") ? 40000 : b.built.includes("finishing") ? 30000
      : b.built.includes("carving") ? 20000 : b.built.includes("auction") ? 10000 : b.built.includes("workshop") ? 5000
      : b.built.includes("expanded") ? 2000 : b.built.includes("stall") ? 1000 : b.supplierUnlocked ? 600 : 300;
    const priceLimit = Math.max(phaseLimit, b.choice === "venture" ? 5000 : b.choice === "trade" ? 1000 : 300);
    const target = trades === 0 ? 60 : Math.max(50, Math.min(priceLimit, Math.round(fund / Math.min(3, capacity) / 10) * 10));
    for (const [index, factor] of [1, .65, 1.25].entries()) {
      const price = trades === 0 && index === 0 ? 60 : Math.max(20, Math.round(target * factor / 10) * 10);
      const buyerPay = trades === 0 && index === 0 ? 75 : Math.round(price * (1.15 + ((trades + index) % 3) * .05));
      const reference = Math.ceil(buyerPay / .98);
      b.supply.push({ id: makeId(), item: makeSmallProduct(reference), price, buyerPay,
        customer: ["街坊陈婶", "绳饰小铺", "礼品采购商"][index], createdAt: now });
    }
  }
  function buyNeighborhoodItem(player, offerId, now = Date.now()) {
    settleBusinessForPlayer(player, now);
    const access = businessAccess(player, "blackmarket");
    if (!access.ok) return access;
    const offer = player.business.supply?.find(row => row.id === offerId);
    if (!offer) return fail("这批货已变更，请重新选择。");
    if (player.cash < offer.price) return fail("采购现金不足，可先交付已有货品或做街坊寄售。");
    const item = structuredClone(offer.item);
    item.costBasis = { amount: offer.price, complete: true, components: { acquisition: offer.price }, componentsComplete: true };
    const demand = quoteSystemDemand(player, [item], offer.buyerPay, now);
    if (!demand.ok) return demand;
    if (!spendCash(player, offer.price, `街坊进货：${item.name}`, { source: "blackmarket", itemId: item.id, at: now })) return fail("现金不足。");
    item.neighborhoodBuyer = { name: offer.customer, pay: offer.buyerPay };
    addItem(player, item, { type: "bracelet", acquisitionCost: offer.price });
    (player.business.reservations ||= []).push({ itemId: item.id, cash: demand.amount, count: demand.quantity, premiumCash: demand.premiumCash, rareCount: demand.rareCount });
    player.business.supply = player.business.supply.filter(row => row.id !== offer.id);
    refillSupply(player, now);
    return { ok: true, message: `进货 ¥${offer.price}，${offer.customer}保留收购报价 ¥${offer.buyerPay}。` };
  }
  function sellNeighborhoodItem(player, itemId, now = Date.now()) {
    settleBusinessForPlayer(player, now);
    const entry = inventoryEntries(player).find(row => row.item.id === itemId);
    if (!entry) return fail("这件货品不在库存中。");
    const item = entry.item;
    const stage = item.materialStage || item.stage;
    if (item.escrowOrderId || item.customerCommissionId) return fail("客户委托物不能出售。");
    const isOwnWork = stage === "opened" || stage === "carved" || item.craftedByPlayerId === player.id;
    const amount = item.neighborhoodBuyer?.pay || (isOwnWork ? Math.round(Number(item.value) * 1.05) : Math.round(Number(item.value) * .98));
    const quote = quoteSystemDemand(player, [item], amount, now);
    if (!quote.ok) return quote;
    const cost = itemCost(item);
    const removed = takeItem(player, entry.type, item.id);
    if (!removed) return fail("这件货品已被其他经营操作使用。");
    recordFinanceSale(player, [removed], amount, { id: `neighborhood:${item.id}`, channel: "neighborhood", at: now });
    bookSystemDemand(player, quote, "neighborhood");
    earnCash(player, amount, `街坊收购：${item.name}`, { source: "neighborhood-sale", itemId: item.id, repEligible: false, at: now });
    player.business.trades += 1;
    player.stats.bmDeals = (Number(player.stats.bmDeals) || 0) + 1;
    player.business.supply = [];
    refillSupply(player, now);
    settleBusinessForPlayer(player, now);
    return { ok: true, message: `成交 ¥${amount}，${cost.complete ? `本笔${amount >= cost.amount ? "赚" : "亏"} ¥${Math.abs(amount-cost.amount)}` : "历史成本未知"}；累计经营净利润 ¥${businessProfit(player)}。` };
  }
  function startConsignment(player, now = Date.now()) {
    if (!player.business?.choice) return fail("请先选择经营方式。");
    if (player.business.consignment) return fail("请先交付当前寄售。");
    player.business.consignment = { id: makeId(), startedAt: now, readyAt: now + 120000, pay: 20 };
    return { ok: true, message: "已接街坊寄售，2分钟后交付，服务收入20元。" };
  }
  function startOpeningCommission(player, now = Date.now()) {
    const access = businessAccess(player, "opening");
    if (!access.ok) return access;
    const b = player.business;
    const current = b.openingCommission;
    if (current && !player.rough.some(item => item.id === current.itemId)) return fail("当前委托正在加工或等待交付，请先完成。");
    const device = player.workshop.devices.find(row => row.stage === "opening" && row.condition > 0 && !row.blackmarketListingId
      && !(player.jobs || []).some(job => job.deviceId === row.id));
    const item = current ? player.rough.find(row => row.id === current.itemId) : makeRoughStone({ qualityKey: "glutinous", mass: .8 });
    if (!current) {
      const id = makeId();
      item.customerCommissionId = id;
      item.starterProtection = true;
      item.starterOwnerId = player.id;
      item.type = "rough";
      addItem(player, item, { type: "rough", acquisitionCost: 0 });
      b.openingCommission = { id, itemId: item.id, name: "街坊开料委托", pay: 200, startedAt: now };
    }
    const result = startWorkshopJobForPlayer(player, device?.id || "public-opening", { itemId: item.id, workerId: "owner-operator" });
    if (!result.ok && !current) { takeItem(player, "rough", item.id); b.openingCommission = null; }
    return result.ok ? { ok: true, message: "客户来料已开工，完工后到工坊启匣领取明料，再交还客户领取200元加工报酬。" } : result;
  }
  function claimOpeningCommission(player, now = Date.now()) {
    settleBusinessForPlayer(player, now);
    const order = player.business?.openingCommission;
    if (!order) return fail("没有待交付的开料委托。");
    const entry = inventoryEntries(player).find(row => row.item.id === order.itemId && row.item.materialStage === "opened");
    if (!entry) return fail("请先完成开料，并在工坊启匣领取明料；失败退回的客户料可继续开料。");
    const item = takeItem(player, entry.type, entry.item.id);
    if (!item) return fail("客户明料已不在库存。");
    player.business.openingCommission = null;
    recordFinanceSale(player, [item], 0, { id: `commission-return:${order.id}`, channel: "commission-return", at: now });
    earnCash(player, order.pay, "街坊开料加工报酬", { source: "commission", itemId: order.id, repEligible: false, at: now });
    player.business.trades += 1;
    settleBusinessForPlayer(player, now);
    return { ok: true, message: "已交还客户明料，加工报酬200元到账。" };
  }
  function claimConsignment(player, now = Date.now()) {
    settleBusinessForPlayer(player, now);
    const order = player.business?.consignment;
    if (!order || order.readyAt > now) return fail("寄售尚未完成。");
    player.business.consignment = null;
    earnCash(player, order.pay, "街坊寄售服务收入", { source: "consignment", itemId: order.id, repEligible: false, at: now });
    player.business.trades += 1;
    settleBusinessForPlayer(player, now);
    return { ok: true, message: "街坊寄售已交付，服务收入20元。" };
  }
  return { settleBusinessForPlayer, chooseBusinessStart, buildBusiness, borrowBusinessLoan, repayBusinessLoan, repayBusinessFromIncome, businessIncomeBudget,
    buyNeighborhoodItem, sellNeighborhoodItem, startConsignment, claimConsignment, startOpeningCommission, claimOpeningCommission, refillSupply };
}
