import assert from "node:assert/strict";
import { itemCost, itemCostComponents, setAcquisitionCost, addItemCost, distributeItemCost } from "../shared/domain/economy/item-cost.js";
import { registerFinanceItem, addFinanceItemCost, recordFinanceSale, recordFinanceLoss, recordFinanceCash,
  recordFinancePayroll, recordFinanceBorrowingFee, refundFinanceItemCost, financeSnapshot, previewIncomeCash } from "../shared/domain/economy/finance-book.js";
import { validateFinanceBook } from "../server/persistence/finance-snapshot-schema.js";
import { createEconomyService } from "../server/services/economy-service.js";
import { publicStone } from "../server/services/snapshot-public.js";

const at = Date.UTC(2026, 9, 23, 4);
const player = { id: "finance-owner", cash: 10000, ledger: [], workshop: { workers: [] } };
const source = { id: "rough", name: "测试原石", value: 4000 };
setAcquisitionCost(source, 4000);
registerFinanceItem(player, source, { acquisition: true, at });
addFinanceItemCost(player, source, 100);
const pieces = [2000, 1500, 600].map((value, index) => ({ id: `piece-${index}`, name: `取件${index}`, value }));
distributeItemCost(source, pieces);
assert.deepEqual(pieces.map(item => itemCost(item).amount), [2000, 1500, 600]);
assert.ok(pieces.every(item => item.financeBatchId === source.financeBatchId));
recordFinanceSale(player, [pieces[0]], 2400, { id: "first", channel: "order", at });
let snap = financeSnapshot(player, pieces.slice(1), at);
assert.equal(snap.summary.grossProfit, 400);
assert.equal(snap.batches[0].heldCost, 2100);
assert.equal(snap.batches[0].status, "open");
assert.equal(snap.batches[0].finalProfit, null);
assert.equal(snap.batches[0].cashRecovery, -1700);
assert.equal(recordFinanceSale(player, [pieces[0]], 2400, { id: "first", at }), null);
recordFinanceSale(player, pieces.slice(1), 2100, { id: "rest", at });
snap = financeSnapshot(player, [], at);
assert.equal(snap.summary.grossProfit, 400);
assert.equal(snap.batches[0].finalProfit, 400);
assert.equal(snap.batches[0].status, "closed");

// Each row and component column remains conserved under tiny, uneven splits.
for (let acquisition = 0; acquisition < 9; acquisition++) for (let processing = 0; processing < 9; processing++) {
  for (let materials = 0; materials < 7; materials++) {
    const total = acquisition + processing + materials;
    const input = { costBasis: { amount: total, complete: true, components: { acquisition, processing, materials }, componentsComplete: true } };
    const outputs = Array.from({ length: 5 }, (_, index) => ({ value: ((total + index * 3) % 11) }));
    distributeItemCost(input, outputs);
    assert.equal(outputs.reduce((sum, item) => sum + itemCost(item).amount, 0), total);
    for (const row of outputs) {
      const detail = itemCostComponents(row);
      assert.equal(Object.values(detail.components).reduce((sum, n) => sum + n, 0), itemCost(row).amount);
      assert.ok(Object.values(detail.components).every(n => Number.isInteger(n) && n >= 0));
      assert.equal(detail.complete, true);
    }
    for (const key of ["acquisition", "processing", "materials"]) {
      assert.equal(outputs.reduce((sum, row) => sum + (row.costBasis.components[key] || 0), 0), input.costBasis.components[key]);
    }
  }
}

const oldItem = { id: "old", value: 9000 };
addItemCost(oldItem, 25);
assert.equal(itemCost(oldItem).complete, false);
assert.equal(itemCostComponents({ costBasis: { amount: 100, complete: true } }).complete, false);
recordFinanceSale(player, [oldItem], 2000, { id: "unknown", at });
snap = financeSnapshot(player, [], at);
assert.equal(snap.summary.grossProfit, null);
assert.equal(snap.summary.unknownCostSales, 1);
assert.equal(snap.summary.knownSalesProfit, 400);
assert.equal(snap.summary.operatingNet, null);

const economic = { id: "economic", cash: 10000, ledger: [], workshop: { workers: [] } };
const eco = createEconomyService({ refreshPlayerReport() {} });
eco.spendCash(economic, 3200, "购机", { source: "equipment", at });
eco.holdDeposit(economic, 1000, "保证金", { at });
eco.releaseDeposit(economic, 1000, "退保证金", { at });
eco.earnCash(economic, 200, "来料净收入", { source: "commission", at });
recordFinancePayroll(economic, [{ workerId: "a", amount: 100 }], at - 86_400_000, at);
recordFinancePayroll(economic, [{ workerId: "a", amount: 100 }], at - 86_400_000, at);
eco.spendCash(economic, 100, "补薪", { source: "employeeSalary", at });
recordFinanceBorrowingFee(economic, 50, "loan", at);
recordFinanceCash(economic, "expense", 50, { source: "recovery-repayment", at });
snap = financeSnapshot(economic, [], at);
assert.equal(snap.summary.equipmentOutflow, 3200);
assert.equal(snap.summary.commissionNet, 200);
assert.equal(snap.summary.operatingExpenses, 100);
assert.equal(snap.summary.financeCosts, 50);
assert.equal(snap.summary.operatingNet, 50);
assert.equal(snap.summary.debtRepayment, 50);
assert.equal(snap.summary.depositsHeld, 1000);
assert.equal(snap.summary.depositsReleased, 1000);
assert.equal(snap.daily.find(row => row.day === String(Math.floor((at - 86_400_000 + 8 * 3_600_000) / 86_400_000))).operatingExpenses, 100);

const thirdParty = { id: "provider", cash: 10000, workshop: { workers: [] } };
const escrow = { id: "escrow", escrowOrderId: "work", escrowFromBuyerId: player.id, costBasis: { amount: 500, complete: true } };
addFinanceItemCost(thirdParty, escrow, 35);
addFinanceItemCost(thirdParty, escrow, 120, true, "materials");
assert.equal(itemCost(escrow).amount, 500, "provider spends do not inflate buyer stock costs");
assert.equal(financeSnapshot(thirdParty).summary.operatingExpenses, 155);

const lossPlayer = { id: "loss" };
recordFinanceSale(lossPlayer, [{ id: "known", costBasis: { amount: 100, complete: true } }], 150, { id: "known" });
recordFinanceLoss(lossPlayer, { id: "unknown-loss" }, { id: "shatter" });
assert.equal(financeSnapshot(lossPlayer).summary.grossProfit, 50);
assert.equal(financeSnapshot(lossPlayer).summary.operatingNet, null);
assert.equal(recordFinanceLoss(lossPlayer, { id: "unknown-loss" }, { id: "shatter" }), false);

const debtPlayer = { cash: 10000, ledger: [], workshop: { workers: [] }, recovery: { debt: 1000 }, employeePayroll: { debt: 1000 } };
assert.deepEqual(previewIncomeCash(debtPlayer, 1000, { source: "order" }), {
  gross: 1000, recoveryRepayment: 100, payrollRepayment: 200, cashIncrease: 700, cashAfter: 10700, reserve: 4000
});
assert.equal(previewIncomeCash({ ...debtPlayer, cash: 3500 }, 1000, { source: "order" }).cashIncrease, 700);
assert.equal(previewIncomeCash({ ...debtPlayer, cash: 3000 }, 500, { source: "order" }).cashIncrease, 500);

const before = JSON.stringify(player);
financeSnapshot(player, pieces, at);
assert.equal(JSON.stringify(player), before, "projection is read-only");
validateFinanceBook(player, "player");
validateFinanceBook(JSON.parse(JSON.stringify(economic)), "restored");
const publicItem = publicStone(pieces[0]);
assert.equal(publicItem.costBasis, undefined);
assert.equal(publicItem.financeBatchId, undefined);
assert.equal(publicStone(pieces[0], { privateFinance: true }).costBasis.amount, 2000);
const retentionPlayer = { id: "retention" };
for (let index = 0; index < 90; index++) {
  const item = { id: `closed-${index}`, name: "历史货品", value: 10 };
  setAcquisitionCost(item, 1);
  registerFinanceItem(retentionPlayer, item, { acquisition: true, at: at + index });
  recordFinanceSale(retentionPlayer, [item], 10, { id: `closed-${index}`, at: at + index });
}
const activeItem = { id: "still-active", value: 10 };
setAcquisitionCost(activeItem, 5);
registerFinanceItem(retentionPlayer, activeItem, { acquisition: true, at: 1 });
const retainedBefore = JSON.stringify(retentionPlayer);
const retentionSnap = financeSnapshot(retentionPlayer, [activeItem]);
assert.equal(retentionSnap.batches.length, 81);
assert.equal(retentionSnap.archivedBatchCount, 10);
assert.ok(retentionSnap.batches.some(batch => batch.items.some(row => row.id === activeItem.id)));
assert.equal(retentionSnap.summary.salesRevenue, 900);
retentionSnap.batches[0].sales.push({ id: "viewer-mutates" });
retentionSnap.daily[0].salesRevenue = -999;
assert.equal(JSON.stringify(retentionPlayer), retainedBefore, "bounded projection remains detached and read-only");
const refundPlayer = { id: "refund-owner" };
const refundable = { id: "refundable-source", value: 700 };
setAcquisitionCost(refundable, 500);
registerFinanceItem(refundPlayer, refundable, { acquisition: true, at });
addFinanceItemCost(refundPlayer, refundable, 200, true, "processing", { refundKey: "service-fee" });
const refundPieces = [1, 1, 1].map((value, index) => ({ id: `refund-piece-${index}`, value }));
distributeItemCost(refundable, refundPieces);
assert.equal(refundPieces.reduce((sum, item) => sum + (item.costBasis.refundableCosts?.["service-fee"] || 0), 0), 200);
recordFinanceSale(refundPlayer, [refundPieces[0]], 300, { id: "refund-sold", at });
recordFinanceLoss(refundPlayer, refundPieces[1], { id: "refund-lost", at });
const successor = structuredClone(refundPieces[0]);
setAcquisitionCost(successor, 306);
assert.equal(successor.costBasis.refundableCosts, undefined, "a new owner never inherits earlier refund rights");
const originalSaleCost = itemCost(refundPieces[0]).amount;
assert.equal(refundFinanceItemCost(refundPlayer, { id: "refund-1", feeKey: "service-fee", batchId: refundable.financeBatchId,
  amount: 200, items: [refundPieces[2]], at: at + 86_400_000 }), 200);
const refunded = financeSnapshot(refundPlayer, [refundPieces[2]], at + 86_400_000);
assert.equal(refunded.batches[0].directCost, 500);
assert.equal(refunded.batches[0].soldCost + refunded.batches[0].lossCost + refunded.batches[0].heldCost, 500);
assert.equal(refunded.summary.salesRevenue, 300, "cost refunds cannot mint sales revenue");
assert.equal(refunded.recentSales[0].items[0].costAtSale, originalSaleCost, "original transaction cost remains auditable");
assert.ok(refunded.summary.soldCost < originalSaleCost);
assert.ok(refunded.summary.materialLoss < itemCost(refundPieces[1]).amount);
assert.equal(refundFinanceItemCost(refundPlayer, { id: "refund-1", feeKey: "service-fee", batchId: refundable.financeBatchId,
  amount: 200, items: [refundPieces[2]] }), 0);
validateFinanceBook(refundPlayer, "refund");
const lostRefundOwner = { id: "lost-refund-owner" };
const lostRefundItem = { id: "lost-refund-item", value: 700 };
setAcquisitionCost(lostRefundItem, 500);
registerFinanceItem(lostRefundOwner, lostRefundItem, { acquisition: true, at });
addFinanceItemCost(lostRefundOwner, lostRefundItem, 200, true, "processing", { refundKey: "lost-fee" });
recordFinanceLoss(lostRefundOwner, lostRefundItem, { id: "all-lost", at });
refundFinanceItemCost(lostRefundOwner, { id: "lost-refund", feeKey: "lost-fee", batchId: lostRefundItem.financeBatchId,
  amount: 200, at: at + 86_400_000 });
const lossRefund = financeSnapshot(lostRefundOwner);
assert.equal(lossRefund.batches[0].status, "closed");
assert.equal(lossRefund.batches[0].finalProfit, -500);
assert.equal(lossRefund.summary.materialLoss, 500);
assert.equal(lossRefund.summary.grossProfit, 0, "loss-cost refunds do not change realized sales margin");
assert.equal(lossRefund.summary.operatingNet, -500);
assert.ok(lossRefund.daily.some(day => day.materialLoss === -200));
validateFinanceBook(lostRefundOwner, "loss-refund");
console.log("finance-book-smoke: ok (567 component splits, costs, realized sales, payroll accrual, debt preview, privacy, persistence shape)");
