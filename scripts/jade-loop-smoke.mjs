import assert from "node:assert/strict";
import {
  resolveTiming,
  productionDuration,
  ledgerEntry,
  cashFlowTotals,
  repFromCashFlow,
  makeOfflineSummary,
  livestreamOutcome,
  reportSummary
} from "../public/jade-loop.js";

const testTiming = resolveTiming("test");
assert.equal(testTiming.production.rough, 300);
assert.equal(testTiming.production.refine, 900);
assert.equal(testTiming.production.inlay, 300);
assert.equal(productionDuration("rough", "test"), 300);
assert.equal(productionDuration("refine", "test"), 900);
assert.equal(productionDuration("inlay", "test"), 300);

const normalTiming = resolveTiming("normal");
assert.equal(normalTiming.day, 20 * 60 * 1000);
assert.equal(normalTiming.auction.registration, 5 * 60 * 1000);
assert.equal(normalTiming.auction.bidding, 5 * 60 * 1000);
assert.equal(normalTiming.auction.settlement, 30 * 1000);
assert.equal(normalTiming.auction.cadence, 20 * 60 * 1000);

const income = ledgerEntry("income", 18000, "直播成交", { source: "livestream", at: 1 });
const spend = ledgerEntry("expense", 6200, "公盘保证金", { source: "auction", at: 2 });
assert.equal(income.amount, 18000);
assert.equal(spend.amount, -6200);

const originalNow = Date.now;
let nowCall = 0;
Date.now = () => 1000 + nowCall++;
const generated = ledgerEntry("income", 1200, "测试流水", { source: "manual", itemId: "piece-1" });
Date.now = originalNow;
assert.equal(generated.at, 1000);
assert.equal(generated.id, "income-1000-manual-piece-1-1200");
assert.equal(
  ledgerEntry("income", 1200, "自定义流水", { id: "custom-ledger-id", source: "manual", at: 9 }).id,
  "custom-ledger-id"
);

const totals = cashFlowTotals([income, spend]);
assert.equal(totals.income, 18000);
assert.equal(totals.expense, 6200);
assert.equal(totals.net, 11800);
assert.equal(repFromCashFlow("expense", 20000), 20);
assert.equal(repFromCashFlow("livestream", 25000), 20);

const summary = makeOfflineSummary([
  { type: "production", text: "粗加工完成", income: 0, expense: 0 },
  { type: "livestream", text: "直播售出一件", income: 12000, expense: 800 }
]);
assert.equal(summary.count, 2);
assert.equal(summary.income, 12000);
assert.equal(summary.expense, 800);
assert.ok(summary.lines.includes("粗加工完成"));

const conservative = livestreamOutcome(
  { id: "p1", value: 10000, score: 4, rep: 32 },
  { mode: "autoConservative", rep: 60, seed: 11 }
);
assert.deepEqual(conservative, { sold: true, price: 10753, mode: "autoConservative", multiplier: 1.075 });

const aggressive = livestreamOutcome(
  { id: "p2", value: 10000, score: 2, rep: 8 },
  { mode: "autoAggressive", rep: 0, seed: 3 }
);
assert.deepEqual(aggressive, { sold: false, price: 0, mode: "autoAggressive", multiplier: 1.148 });

const report = reportSummary([
  ledgerEntry("income", 20000, "订单", { source: "order", at: 10 }),
  ledgerEntry("income", 8000, "直播", { source: "livestream", at: 11 }),
  ledgerEntry("expense", 5000, "加工", { source: "production", at: 12 })
], [
  { value: 12000, createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000 },
  { price: 3000, createdAt: Date.now() }
]);
assert.equal(report.income, 28000);
assert.equal(report.expense, 5000);
assert.equal(report.net, 23000);
assert.ok(report.incomeSources.order > report.incomeSources.livestream);
assert.equal(report.staleCount, 1);
assert.ok(report.advice.length >= 1);

console.log("Jade idle loop rules checks passed");
