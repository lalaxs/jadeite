import assert from "node:assert/strict";
import { buildSaleComparison } from "../public/features/finance/sale-comparison.js";
import { financeBatchForItem, financeBatchHtml, financeReportHtml, saleComparisonHtml } from "../public/features/finance/finance-view.js";
import { inventoryDetailStats } from "../public/features/inventory/item-detail-model.js";
import { setAcquisitionCost } from "../shared/domain/economy/item-cost.js";
import { financeSnapshot, registerFinanceItem } from "../shared/domain/economy/finance-book.js";

const now = Date.UTC(2026, 9, 24, 1);
const product = setAcquisitionCost({ id: "p1", name: '<玉&"镯>', type: "bracelet", kind: "bracelet", score: 3,
  materialStage: "finished", value: 1000 }, 800);
const player = { id: "seller", level: 1, cash: 5000, bracelets: [product], orders: [
  { id: "one", client: "街坊", pay: 1000, quantity: 1, minScore: 1, acceptedKinds: ["bracelet"] },
  { id: "bundle", client: "多件客", pay: 2400, quantity: 3, minScore: 1, acceptedKinds: ["bracelet"] }
], workshop: { workers: [] }, ledger: [], recovery: { debt: 1000 }, employeePayroll: { debt: 1000 } };
const state = { me: player, listings: [] };
const before = JSON.stringify(state);
const model = buildSaleComparison(state, product, { targetPrice: 1100, now });
assert.equal(JSON.stringify(state), before, "comparison must not mutate inventory, budgets, debt or cash");
const order = model.rows.find(row => row.id === "order:one");
assert.equal(order.revenue, 1000);
assert.equal(order.grossProfit, 200);
assert.equal(order.cash.cashIncrease, 700, "debt repayment reduces cash without reducing sales margin");
assert.equal(order.cash.cashAfter, 5700);
assert.equal(order.cash.recoveryRepayment, 100);
assert.equal(order.cash.payrollRepayment, 200);
const bundle = model.rows.find(row => row.id === "order:bundle");
assert.equal(bundle.kind, "bundle");
assert.equal(bundle.bundlePay, 2400);
assert.equal(bundle.revenue, undefined, "whole-order price must not masquerade as one item's receipt");
assert.equal(bundle.grossProfit, undefined);
assert.equal(model.rows.find(row => row.id === "wholesale").revenue, undefined, "no invented executable wholesale quote");
assert.equal(model.rows.find(row => row.id === "recycle").revenue, 200);
const invalidTarget = buildSaleComparison(state, product, { targetPrice: "", now });
assert.equal(invalidTarget.rows.find(row => row.id === "market").available, false);
assert.equal(buildSaleComparison(state, product, { targetPrice: 50, now }).rows.find(row => row.id === "market").available, false);

const unknown = { ...product, id: "legacy", costBasis: undefined };
const unknownModel = buildSaleComparison({ ...state, me: { ...player, bracelets: [unknown] } }, unknown, { now });
assert.equal(unknownModel.rows.find(row => row.id === "recycle").grossProfit, null);
const escrow = { ...product, escrowOrderId: "customer" };
assert.equal(buildSaleComparison({ ...state, me: { ...player, bracelets: [escrow] } }, escrow, { now }).rows.some(row => row.available), false);
const exhausted = { ...player, systemDemand: { day: Math.floor((now + 8 * 3600000) / 86400000), spent: { cash: 24000, count: 12, premiumCash: 1500 } } };
assert.equal(buildSaleComparison({ me: exhausted, listings: [] }, product, { now }).rows.find(row => row.id === "order:one").available, false);
const listing = { id: "listed", ownerId: player.id, item: product, price: 1100, npcOffer: { id: "offer", amount: 650 } };
const listedModel = buildSaleComparison({ me: { ...player, bracelets: [] }, listings: [listing] }, product, { now });
assert.equal(listedModel.rows.find(row => row.id === "wholesale").revenue, 650);
assert.equal(listedModel.rows.find(row => row.id === "wholesale").available, true);

registerFinanceItem(player, product, { acquisition: true, at: now });
const finance = financeSnapshot(player, [{ item: product, status: "inventory" }], now);
const batch = finance.batches[0];
assert.equal(financeBatchForItem(finance, product)?.id, batch.id);
const batchHtml = financeBatchHtml(batch);
assert.match(batchHtml, /本批尚未清完/);
assert.doesNotMatch(batchHtml, /本批直接收益/);
assert.match(batchHtml, /&lt;玉&amp;&quot;镯&gt;/);
assert.doesNotMatch(batchHtml, /<玉/);
const heldElsewhere = financeBatchHtml({ ...batch, items: [
  { id: "bm", name: "黑市货", status: "blackmarket", cost: 10, value: 20, costComplete: true },
  { id: "want", name: "应征货", status: "want", cost: 10, value: 20, costComplete: true },
  { id: "market", name: "交易行货", status: "listed", cost: 10, value: 20, costComplete: true }
] });
assert.match(heldElsewhere, /黑市在售/);
assert.match(heldElsewhere, /求购应征中/);
assert.equal((heldElsewhere.match(/data-action="openSaleComparison"/g) || []).length, 1);
const stats = inventoryDetailStats({ item: product, category: "finished", categoryLabel: "成品", totalValue: 1000 });
assert.equal(stats.find(row => row.label === "购入分摊").value.includes("800"), true);
const unknownStats = inventoryDetailStats({ item: unknown, category: "finished", totalValue: 1000 });
assert.equal(unknownStats.find(row => row.label === "已记货品成本").value, "待补全");
assert.equal(inventoryDetailStats({ item: product, isPlanned: true, totalValue: 1000 }).some(row => row.label === "已记货品成本"), false);
const html = saleComparisonHtml(model);
assert.match(html, /目标价成交时/);
assert.match(html, /data-finance-target/);
assert.match(html, /整单报价不能当成本件收入/);
assert.doesNotMatch(html, /data-modal-emit=/, "comparison cannot transact directly");
const reports = financeReportHtml({ ...finance, summary: { ...finance.summary, grossProfit: null, grossProfitKnown: 1000, unknownCostSales: 1, operatingNet: null } });
assert.match(reports, /非完整利润/);
assert.match(reports, /设备与许可资金/);
assert.match(reports, /资金往来/);
assert.match(reports, /累计借款还款/);
assert.match(reports, /开始记录：2026/);
assert.match(reports, /北京时间/);
assert.match(financeReportHtml(null), /启用后开始记录/);
assert.match(reports, /成本不完整，暂不判定盈亏/);
console.log("finance-ui-smoke: ok");
