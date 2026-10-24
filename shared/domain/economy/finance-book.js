// Private business accounting. Valuation never creates cash or realized income.
import { itemCost, addItemCost, itemCostComponents } from "./item-cost.js";
import { operatingReserveFor } from "./operating-reserve.js";

const TOTAL_KEYS = ["salesRevenue", "soldCost", "salesFees", "unknownCostSales", "commissionNet", "serviceNet",
  "operatingExpenses", "materialLoss", "unknownLosses", "unknownOperatingCosts", "financeCosts", "equipmentOutflow", "equipmentInflow", "cashIn", "cashOut", "knownSalesProfit", "otherOperatingIncome",
  "financingInflow", "debtRepayment", "depositsHeld", "depositsReleased", "nonOperatingIncome"];
const EXPENSE_SOURCES = new Set(["equipmentRepair", "auctionEntry", "window", "orderRefresh", "order-refresh", "recruit", "recruitRefresh", "taskReset"]);
const DEPOSIT_SOURCES = new Set(["auctionDeposit", "auctionEscrow", "market-want-escrow", "blackmarket-service"]);
const DEPOSIT_REFUNDS = new Set(["auctionRefund", "auctionEscrowRefund", "market-want-escrow-refund", "blackmarket-service-refund", "blackmarket-service-recovery"]);
const BUSINESS_SOURCES = new Set(["market-payout", "order", "livestream", "blackmarket-sale", "blackmarket-payout",
  "blackmarket-service-payout", "blackmarket-service-recovery-payout", "blackmarket-blind-sale", "blackmarket-blind-extra-sale", "inventory-recycle", "salvage", "commission"]);
const money = value => Math.max(0, Math.round(Number(value) || 0));
const dayKey = at => String(Math.floor((Number(at) + 8 * 3_600_000) / 86_400_000));
const emptyTotals = () => Object.fromEntries(TOTAL_KEYS.map(key => [key, 0]));

export function ensureFinanceBook(player, now = Date.now()) {
  if (!player.financeBook || player.financeBook.version !== 1) {
    player.financeBook = { version: 1, startedAt: now, sequence: 0, totals: emptyTotals(), days: {}, batches: {}, events: {}, recentSales: [] };
  }
  return player.financeBook;
}

function event(player, id, deltas, at = Date.now()) {
  const book = ensureFinanceBook(player, at);
  if (id && book.events[id]) return false;
  if (id) book.events[id] = at || 1;
  // Assets/orders/payroll also own their authoritative one-time settlement guards.
  // Keep bounded secondary dedupe and daily detail; lifetime totals never trim.
  if (id && Object.keys(book.events).length > 5_000) {
    const oldest = Object.entries(book.events).sort((a, b) => a[1] - b[1]).slice(0, 500);
    for (const [key] of oldest) delete book.events[key];
  }
  const key = dayKey(at);
  const daily = book.days[key] ||= { day: key, ...emptyTotals() };
  for (const [field, amount] of Object.entries(deltas)) {
    book.totals[field] = (Number(book.totals[field]) || 0) + Number(amount || 0);
    daily[field] = (Number(daily[field]) || 0) + Number(amount || 0);
  }
  const days = Object.keys(book.days).sort((a, b) => Number(b) - Number(a));
  for (const key of days.slice(365)) delete book.days[key];
  return true;
}

/** A new owner starts a new cost history; internal transfers retain attribution. */
export function registerFinanceItem(player, item, { acquisition = false, at = Date.now(), legacy = !acquisition } = {}) {
  if (!player || !item || !item.id || (item.escrowOrderId && item.escrowFromBuyerId !== player.id)) return null;
  const book = ensureFinanceBook(player, at);
  if (!acquisition && item.financeOwnerId === player.id && book.batches[item.financeBatchId]) return book.batches[item.financeBatchId];
  const id = `${player.id || "player"}:${item.id}:${at}:${++book.sequence}`;
  const cost = itemCost(item);
  item.financeBatchId = id;
  item.financeOwnerId = player.id;
  delete item.financeParentItemId;
  return book.batches[id] = { id, name: item.name || "历史库存", startedAt: at, legacy,
    costComplete: cost.complete, directCost: cost.amount, revenue: 0, soldCost: 0, salesFees: 0, lossCost: 0,
    unknownSales: 0, pendingRevenue: 0, sales: [], losses: [] };
}

export function addFinanceItemCost(player, item, amount, complete = true, component = "processing", options = {}) {
  if (item?.escrowOrderId && item.escrowFromBuyerId !== player?.id) {
    const book = ensureFinanceBook(player, options.at);
    event(player, `service-cost:${item.escrowOrderId}:${++book.sequence}`, {
      operatingExpenses: money(amount), unknownOperatingCosts: complete ? 0 : 1
    }, options.at);
    item.financeServiceCost = money(item.financeServiceCost) + money(amount);
    return item.costBasis;
  }
  const batch = registerFinanceItem(player, item, { at: options.at });
  addItemCost(item, amount, complete, component);
  if (options.refundKey && money(amount) > 0) {
    const lots = item.costBasis.refundableCosts ||= {};
    lots[options.refundKey] = money(lots[options.refundKey]) + money(amount);
  }
  if (batch) {
    batch.directCost += money(amount);
    batch.costComplete = batch.costComplete && complete;
  }
  return item.costBasis;
}

/** Positive receipt allocations sum exactly to the actual combined transaction. */
export function allocateFinanceAmount(items, amount) {
  const weights = items.map(item => money(item.value ?? item.price));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let remaining = money(amount);
  return items.map((item, index) => {
    const share = index === items.length - 1 ? remaining : Math.min(remaining,
      Math.floor(money(amount) * (total > 0 ? weights[index] / total : 1 / items.length)));
    remaining -= share;
    return share;
  });
}

export function recordFinanceSale(player, items, revenue, { id, channel = "sale", at = Date.now(), salesFees = 0, pending = false } = {}) {
  const rows = (Array.isArray(items) ? items : [items]).filter(Boolean);
  if (!rows.length || !player) return null;
  const book = ensureFinanceBook(player, at);
  const key = `sale:${id || `${channel}:${rows.map(item => item.id).join("+")}`}`;
  if (book.events[key]) return null;
  const receipts = allocateFinanceAmount(rows, revenue);
  const fees = allocateFinanceAmount(rows, salesFees);
  const snapshots = rows.map((item, index) => {
    const batch = registerFinanceItem(player, item, { at });
    const cost = itemCost(item);
    return { id: item.id, name: item.name || "货品", batchId: batch?.id || null, cost: cost.amount,
      costComplete: cost.complete, value: money(item.value ?? item.price), revenue: receipts[index], salesFees: fees[index], status: "sold",
      ...(item.costBasis?.refundableCosts ? { refundableCosts: { ...item.costBasis.refundableCosts } } : {}) };
  });
  const soldCost = snapshots.reduce((sum, item) => sum + item.cost, 0);
  const unknown = snapshots.filter(item => !item.costComplete).length;
  const sale = { id: String(id || key), at, channel, revenue: money(revenue), salesFees: money(salesFees), soldCost,
    costComplete: unknown === 0, grossProfit: unknown ? null : money(revenue) - soldCost - money(salesFees), pending,
    items: snapshots };
  event(player, key, { salesRevenue: money(revenue), soldCost, salesFees: money(salesFees), unknownCostSales: unknown,
    knownSalesProfit: snapshots.filter(item => item.costComplete).reduce((sum, item) => sum + item.revenue - item.cost - item.salesFees, 0) }, at);
  for (const item of snapshots) {
    const batch = book.batches[item.batchId];
    if (!batch) continue;
    batch.revenue += item.revenue;
    batch.soldCost += item.cost;
    batch.salesFees += item.salesFees;
    batch.unknownSales += item.costComplete ? 0 : 1;
    batch.costComplete = batch.costComplete && item.costComplete;
    if (pending) batch.pendingRevenue += item.revenue;
    batch.sales.unshift({ saleId: sale.id, at, channel, ...item, pending });
    batch.sales = batch.sales.slice(0, 100);
  }
  book.recentSales.unshift(sale);
  book.recentSales = book.recentSales.slice(0, 120);
  return sale;
}

export function recordFinanceLoss(player, item, { id, at = Date.now() } = {}) {
  if (!player || ensureFinanceBook(player, at).events[`loss:${id || item?.id}`]) return false;
  const batch = registerFinanceItem(player, item, { at });
  if (!batch) return false;
  const cost = itemCost(item);
  if (!event(player, `loss:${id || item.id}`, { materialLoss: cost.amount, unknownLosses: cost.complete ? 0 : 1 }, at)) return false;
  batch.lossCost += cost.amount;
  batch.costComplete = batch.costComplete && cost.complete;
  batch.losses.push({ id: item.id, name: item.name, status: "lost", cost: cost.amount, costComplete: cost.complete, at,
    ...(item.costBasis?.refundableCosts ? { refundableCosts: { ...item.costBasis.refundableCosts } } : {}) });
  return true;
}

/** Cash classification does not count stock purchases, loan repayments or escrow as expenses. */
export function recordFinanceCash(player, kind, amount, meta = {}) {
  const book = ensureFinanceBook(player, Number(meta.at) || Date.now());
  const at = Number(meta.at) || Date.now();
  const expense = kind === "expense";
  const source = meta.source || kind;
  const deltas = { [expense ? "cashOut" : "cashIn"]: money(amount) };
  if (!expense && source === "commission") deltas.commissionNet = money(amount);
  if (!expense && ["blackmarket-service-payout", "blackmarket-service-recovery-payout"].includes(source)) deltas.serviceNet = money(amount);
  if (expense && ["equipment", "asset"].includes(source)) deltas.equipmentOutflow = money(amount);
  if (expense && EXPENSE_SOURCES.has(source)) deltas.operatingExpenses = money(amount);
  if (meta.financeCategory === "equipment-sale") deltas.equipmentInflow = expense ? 0 : money(amount);
  if (meta.financeCategory === "equipment-purchase") deltas.equipmentOutflow = expense ? money(amount) : 0;
  if (meta.financeCategory === "operating") deltas.operatingExpenses = expense ? money(amount) : 0;
  if (!expense && meta.financeCategory === "personnel-sale") deltas.otherOperatingIncome = money(amount);
  if (!expense && source === "recovery-advance") deltas.financingInflow = money(amount);
  if (expense && source === "recovery-repayment") deltas.debtRepayment = money(amount);
  if (expense && DEPOSIT_SOURCES.has(source)) deltas.depositsHeld = money(amount);
  if (!expense && DEPOSIT_REFUNDS.has(source)) deltas.depositsReleased = money(amount);
  if (!expense && ["taskReward", "achievementReward", "debug", "debug-cash"].includes(source)) deltas.nonOperatingIncome = money(amount);
  // Ledger IDs predate accounting and can collide for equal same-ms payments.
  // Each successful money mutation is a cash event; sale/payroll IDs dedupe economics separately.
  book.sequence += 1;
  event(player, null, deltas, at);
}

export function recordFinancePayroll(player, entries, billDay, at = Date.now()) {
  ensureFinanceBook(player, at);
  for (const entry of entries || []) {
    event(player, `payroll:${billDay}:${entry.workerId}`, { operatingExpenses: money(entry.amount) }, billDay || at);
  }
}

export function recordFinanceBorrowingFee(player, amount, id, at = Date.now()) {
  event(player, `borrowing-fee:${id}`, { financeCosts: money(amount) }, at);
}

/** Already received participation fees with no goods transferred are not a second cash receipt. */
export function recordFinanceOtherIncome(player, amount, id, at = Date.now()) {
  event(player, `other-income:${id}`, { otherOperatingIncome: money(amount) }, at);
}

/** Reverse a refunded fee without rewriting another owner's acquisition cost. */
export function refundFinanceItemCost(player, { id, feeKey, batchId, amount, items = [], at = Date.now() }) {
  const book = ensureFinanceBook(player, at);
  const key = `cost-refund:${id}`;
  if (book.events[key]) return 0;
  const batch = book.batches[batchId];
  if (!batch) return 0;
  const refund = Math.min(money(amount), batch.directCost);
  let remaining = refund, sold = 0, lost = 0, knownProfit = 0;
  const adjusted = [];
  const seen = new Set();
  for (const item of items) {
    if (!item || seen.has(item.id) || item.financeOwnerId !== player.id || item.financeBatchId !== batchId) continue;
    seen.add(item.id);
    const cost = itemCost(item), details = itemCostComponents(item);
    const portion = Math.min(remaining, money(item.costBasis?.refundableCosts?.[feeKey]), cost.amount);
    if (!portion) continue;
    item.costBasis.amount -= portion;
    item.costBasis.components = { ...details.components };
    let componentRefund = portion;
    for (const component of ["processing", "legacy", "acquisition", "materials"]) {
      const reduction = Math.min(componentRefund, item.costBasis.components[component] || 0);
      if (reduction) item.costBasis.components[component] -= reduction;
      componentRefund -= reduction;
    }
    item.costBasis.refundableCosts[feeKey] -= portion;
    remaining -= portion;
    adjusted.push({ itemId: item.id, amount: portion, status: "held" });
  }
  for (const [rows, kind] of [[batch.sales, "sold"], [batch.losses, "lost"]]) {
    for (const row of rows || []) {
      const portion = Math.min(remaining, money(row.refundableCosts?.[feeKey]), row.cost);
      if (!portion) continue;
      row.costAtSale ??= row.cost;
      row.cost -= portion;
      row.refundableCosts[feeKey] -= portion;
      row.costRefunded = money(row.costRefunded) + portion;
      if (kind === "sold") { sold += portion; if (row.costComplete) knownProfit += portion; }
      else lost += portion;
      remaining -= portion;
      adjusted.push({ itemId: row.id, saleId: row.saleId, amount: portion, status: kind });
    }
  }
  const reversed = refund - remaining;
  if (!event(player, key, { soldCost: -sold, materialLoss: -lost, knownSalesProfit: knownProfit,
    unknownOperatingCosts: remaining > 0 ? 1 : 0 }, at)) return 0;
  batch.directCost -= reversed;
  batch.soldCost -= sold;
  batch.lossCost -= lost;
  if (remaining > 0) batch.costComplete = false;
  batch.costRefunds ||= [];
  batch.costRefunds.push({ id, at, amount: refund, reversed, unresolved: remaining, adjusted });
  for (const sale of book.recentSales) {
    let correction = 0;
    for (const row of sale.items) {
      const change = adjusted.find(entry => entry.status === "sold" && entry.saleId === sale.id && entry.itemId === row.id);
      if (!change) continue;
      row.costAtSale ??= row.cost;
      row.cost -= change.amount;
      row.costRefunded = money(row.costRefunded) + change.amount;
      correction += change.amount;
    }
    if (correction > 0) {
      sale.soldCostAtSale ??= sale.soldCost;
      sale.grossProfitAtSale ??= sale.grossProfit;
      sale.soldCost -= correction;
      if (sale.costComplete) sale.grossProfit = sale.revenue - sale.soldCost - sale.salesFees;
    }
  }
  return reversed;
}

/** Mirrors earnCash's reserve, 10% borrowing repayment and eligible 20% payroll repayment. */
export function previewIncomeCash(player, amount, { source = "sale", recoveryDebtExempt = false } = {}) {
  const gross = money(amount);
  const reserve = operatingReserveFor(player);
  const cashBefore = money(player?.cash);
  const available = Math.max(0, cashBefore + gross - reserve);
  const recoveryRepayment = recoveryDebtExempt || gross <= 0 ? 0 : Math.min(money(player?.recovery?.debt),
    Math.max(1, Math.round(gross * .1)), Math.floor(gross * .3), available);
  const payrollRepayment = BUSINESS_SOURCES.has(source) ? Math.min(money(player?.employeePayroll?.debt),
    Math.floor(gross * .2), Math.max(0, Math.floor(gross * .3) - recoveryRepayment), Math.max(0, available - recoveryRepayment)) : 0;
  return { gross, recoveryRepayment, payrollRepayment, cashIncrease: gross - recoveryRepayment - payrollRepayment,
    cashAfter: cashBefore + gross - recoveryRepayment - payrollRepayment, reserve };
}

/** Read-only projection: inventory rows carry status, never mutate old saves during snapshots. */
export function financeSnapshot(player, inventoryRows = [], now = Date.now()) {
  const book = player?.financeBook;
  const totals = { ...emptyTotals(), ...(book?.totals || {}) };
  const grossComplete = totals.unknownCostSales === 0;
  const complete = grossComplete && totals.unknownLosses === 0 && totals.unknownOperatingCosts === 0;
  const grossProfitKnown = totals.salesRevenue - totals.soldCost - totals.salesFees;
  const operatingNetKnown = grossProfitKnown + totals.commissionNet + totals.serviceNet + totals.otherOperatingIncome - totals.operatingExpenses - totals.materialLoss - totals.financeCosts;
  const currentBill = player?.employeePayroll?.currentBill;
  const currentPayrollEstimate = (currentBill?.entries || []).filter(entry => !entry.booked)
    .reduce((sum, entry) => sum + money(entry.amount), 0);
  const summary = { ...totals, costComplete: complete, grossProfitComplete: grossComplete, operatingNetComplete: complete, grossProfitKnown,
    grossProfit: grossComplete ? grossProfitKnown : null, operatingNetKnown, operatingNet: complete ? operatingNetKnown : null,
    currentPayrollEstimate, currentPayrollDay: currentBill?.day || null,
    operatingNetAfterPayrollEstimate: complete ? operatingNetKnown - currentPayrollEstimate : null,
    cashNet: totals.cashIn - totals.cashOut };
  const batches = new Map(Object.entries(book?.batches || {}).map(([id, batch]) => [id,
    { ...batch, items: [], heldCost: 0, heldCount: 0 }]));
  const seen = new Set();
  for (const row of inventoryRows) {
    const item = row?.item || row;
    if (!item?.id || (item.escrowOrderId && item.escrowFromBuyerId !== player.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    const cost = itemCost(item);
    const batchId = item.financeOwnerId === player.id && batches.has(item.financeBatchId)
      ? item.financeBatchId : `legacy:${item.id}`;
    if (!batches.has(batchId)) batches.set(batchId, { id: batchId, name: item.name || "历史库存", startedAt: book?.startedAt || now,
      legacy: true, costComplete: cost.complete, directCost: cost.amount, revenue: 0, soldCost: 0, salesFees: 0,
      lossCost: 0, unknownSales: 0, pendingRevenue: 0, sales: [], losses: [], items: [], heldCost: 0, heldCount: 0 });
    const batch = batches.get(batchId);
    batch.heldCost += cost.amount;
    batch.heldCount += 1;
    batch.costComplete = batch.costComplete && cost.complete;
    batch.items.push({ id: item.id, name: item.name || "货品", status: row.status || "inventory", cost: cost.amount,
      costComplete: cost.complete, value: money(item.value ?? item.price), components: itemCostComponents(item).components });
  }
  for (const batch of batches.values()) {
    batch.items.push(...batch.sales.map(sale => ({ ...sale, status: "sold" })), ...(batch.losses || []));
    batch.status = batch.heldCount > 0 || batch.pendingRevenue > 0 ? "open" : "closed";
    batch.grossProfit = batch.costComplete ? batch.revenue - batch.soldCost - batch.salesFees : null;
    batch.cashRecovery = batch.revenue - batch.pendingRevenue - batch.directCost;
    batch.finalProfit = batch.status === "closed" && batch.costComplete ? batch.revenue - batch.directCost - batch.salesFees : null;
  }
  const ordered = [...batches.values()].sort((a, b) => b.startedAt - a.startedAt);
  const active = ordered.filter(batch => batch.status !== "closed");
  const closed = ordered.filter(batch => batch.status === "closed");
  return { version: 1, startedAt: book?.startedAt || null, summary,
    batches: structuredClone([...active, ...closed.slice(0, 80)]), archivedBatchCount: Math.max(0, closed.length - 80),
    recentSales: structuredClone(book?.recentSales || []),
    daily: structuredClone(Object.values(book?.days || {}).sort((a, b) => Number(b.day) - Number(a.day)).slice(0, 365)) };
}
