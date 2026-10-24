import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyRepDelta,
  applySatisfactionDelta,
  applyBuyerCreditDelta,
  aggregateBillPeriods,
  cashBillEntries,
  CUSTOMER_RATING_PUBLIC_MIN_SAMPLES,
  customerRatingSampleTotal,
  customerRatingStarProgress,
  customerRatingTierInfo,
  filterEntriesByRange,
  filterEntriesBySource,
  foldEntriesIntoMonthRollups,
  getBillEntries,
  isCustomerRatingPublic,
  mergePeriodRollups,
  monthBounds,
  monthKey,
  recordExpGain,
  recordMetricEntry,
  sourceLabel,
  summarizeEntries,
  trimCashLedger,
  yearBounds
} from "../public/metric-history.js";
import { grantPlayerExp } from "../public/player-progression.js";
import { createEconomyService } from "../server/services/economy-service.js";
import { initBillModule, openBillView, renderBill, renderCredit } from "../public/bill-module.js";

const player = {
  id: "p-bill",
  cash: 10000,
  rep: 20,
  exp: 0,
  level: 1,
  satisfaction: null,
  ledger: [],
  repHistory: [],
  expHistory: [],
  ratingHistory: [],
  payouts: [{ amount: 500 }],
  blackPayouts: []
};

const { spendCash, earnCash } = createEconomyService({
  refreshPlayerReport: () => {}
});

assert.equal(spendCash(player, 1000, "工坊加工", { source: "workshop" }), true);
assert.equal(player.ledger[0].after, 9000);
assert.equal(player.ledger[0].before, 10000);
earnCash(player, 2500, "订单交付", { source: "order" });

applyRepDelta(player, 12, "开石完成", { source: "opening" });
assert.equal(player.rep, 32);
assert.equal(player.repHistory[0].delta, 12);
assert.equal(player.repHistory[0].after, 32);

applyRepDelta(player, -0.35, "衰减1", { source: "decay", floor: 5 });
applyRepDelta(player, -0.35, "衰减2", { source: "decay", floor: 5 });
assert.equal(player.repHistory.filter((e) => e.source === "decay").length, 1);
assert.ok(player.repHistory.find((e) => e.source === "decay").delta < 0);

const expResult = grantPlayerExp(player, "window_open");
assert.equal(expResult.granted, 6);
assert.equal(player.expHistory[0].delta, 6);
assert.equal(player.expHistory[0].source, "window_open");

applySatisfactionDelta(player, 8, "订单好评", { source: "order_rating" });
assert.equal(player.orderSat, 78);
assert.equal(player.bmSat, null);
assert.equal(player.satisfaction, 78);
assert.equal(player.ratingHistory[0].delta, 8);
assert.equal(CUSTOMER_RATING_PUBLIC_MIN_SAMPLES, 5);
assert.equal(isCustomerRatingPublic(player, 0), false, "无样本时不公开");
player.stats = { orderCount: 1 };
assert.equal(customerRatingSampleTotal(player, 2), 3);
assert.equal(isCustomerRatingPublic(player, 0), false, "不足 5 个样本时不公开");
player.stats.orderCount = 5;
assert.equal(isCustomerRatingPublic(player, 0), true);
assert.equal(customerRatingStarProgress(78).stars, 4);
assert.equal(customerRatingStarProgress(78).nextAt, 90);
assert.equal(customerRatingStarProgress(78).remain, 12);
assert.equal(customerRatingTierInfo(78).title, "口碑优良");
assert.equal(customerRatingTierInfo(20).payBoost, 0.97);
assert.equal(customerRatingTierInfo(78).payBoost, 1.04);
assert.equal(customerRatingTierInfo(95).payBoost, 1.08);
const legacyRating = { satisfaction: 82, stats: { orderCount: 5 } };
const legacyRatingBeforeRead = structuredClone(legacyRating);
assert.equal(isCustomerRatingPublic(legacyRating, 0), true);
assert.deepEqual(legacyRating, legacyRatingBeforeRead, "rating visibility checks must not migrate player state");
applySatisfactionDelta(player, 2, "黑市摊评 5 星", { source: "bm_rating", track: "bm" });
assert.equal(player.bmSat, 72);
assert.equal(player.orderSat, 78);
assert.equal(player.satisfaction, Math.round(78 * 0.7 + 72 * 0.3));
applyBuyerCreditDelta(player, -2, "买家信誉 2 星", { source: "bm_buyer_credit" });
assert.equal(player.buyerCredit, 68);
assert.equal(player.satisfaction, Math.round(78 * 0.7 + 72 * 0.3), "买家信誉不改店铺评级");

const cashEntries = getBillEntries(player, "cash");
assert.ok(cashEntries.length >= 2);
const summary = summarizeEntries(cashEntries);
assert.equal(summary.net, 1500);
assert.equal(filterEntriesBySource(cashEntries, "cash", "workshop").length, 1);
assert.equal(filterEntriesBySource(cashEntries, "cash", "order").length, 1);

const now = Date.now();
const stamped = [
  { delta: 100, at: now },
  { delta: -40, at: now - 40 * 24 * 3600 * 1000 }
];
const months = aggregateBillPeriods(stamped, "month");
assert.ok(months.length >= 1);
assert.equal(months[0].key, monthKey(now));

const { since, until } = monthBounds(monthKey(now));
assert.equal(filterEntriesByRange(stamped, since, until).length, 1);
assert.ok(yearBounds(new Date(now).getFullYear()).until > since);

recordMetricEntry(player, "rep", 1, "extra", { source: "debug" });
recordExpGain(player, 3, "task_claim", "领取任务");
assert.ok(cashBillEntries(player).every((e) => e.metric === "cash"));

assert.equal(sourceLabel("market-want-escrow-refund", "cash"), "求购退还");
assert.equal(sourceLabel("market-want-escrow", "cash"), "求购冻结");
assert.equal(sourceLabel("miningLeaseAutomatic", "cash"), "矿权自动分配");
assert.equal(sourceLabel("miningShift", "cash"), "矿山开采");
assert.equal(sourceLabel("minerRecruit", "cash"), "招聘矿工");
assert.equal(sourceLabel("someUnknownEnglishKey", "cash"), "其他");
assert.equal(sourceLabel("some-unknown-english-key", "cash"), "其他");

// Legacy ledger rows without after/before still show a reconstructed balance.
player.cash = 70000;
player.ledger.unshift({
  id: "legacy-refund",
  kind: "income",
  source: "market-want-escrow-refund",
  amount: 10300,
  note: "求购关闭退还冻结",
  at: Date.now()
});
const legacyRows = cashBillEntries(player);
assert.equal(legacyRows[0].after, 70000);
assert.equal(legacyRows[0].before, 59700);
assert.equal(sourceLabel(legacyRows[0].source, "cash"), "求购退还");

// Archive rollup: trimmed rows remain visible in month aggregates
const oldAt = now - 100 * 24 * 3600 * 1000;
foldEntriesIntoMonthRollups(player, "cash", [{ delta: -88, at: oldAt, source: "debug" }]);
const merged = mergePeriodRollups(
  player,
  "cash",
  aggregateBillPeriods(cashEntries, "month"),
  "month"
);
assert.ok(merged.some((period) => period.key === monthKey(oldAt) && period.loss >= 88));

player.ledger.push(
  { id: "old-1", kind: "expense", source: "debug", amount: -1, note: "old", at: oldAt },
  { id: "old-2", kind: "expense", source: "debug", amount: -1, note: "old2", at: oldAt }
);
const beforeTrim = player.ledger.length;
trimCashLedger(player, beforeTrim - 1);
assert.equal(player.ledger.length, beforeTrim - 1);
assert.ok(Object.keys(player.billMonthRollups.cash).length >= 1);

// UI render smoke
const billPane = { innerHTML: "", addEventListener() {} };
const creditPane = { innerHTML: "", addEventListener() {} };
const els = { homeBillPane: billPane, homeCreditPane: creditPane };
let openedTab = null;
initBillModule({
  getState: () => ({ me: player }),
  els,
  openHomeOverview: (tab) => { openedTab = tab; },
  helpers: {
    formatMoney: (v) => `¥${Math.round(Number(v) || 0)}`,
    formatNumber: (v) => String(Math.round(Number(v) || 0)),
    escapeHtml: (v) => String(v ?? "")
  }
});
renderBill();
assert.match(billPane.innerHTML, /bill-panel/);
assert.match(billPane.innerHTML, /data-bill-panel="bill"/);
assert.doesNotMatch(billPane.innerHTML, /data-bill-metric=/);
assert.doesNotMatch(billPane.innerHTML, /声望|经验|信誉/);
assert.match(billPane.innerHTML, /bill-toolbar/);
assert.match(billPane.innerHTML, /bill-grain-seg/);
assert.match(billPane.innerHTML, /明细/);
assert.match(billPane.innerHTML, /bill-source-dd/);
assert.match(billPane.innerHTML, /bill-source-trigger/);
assert.match(billPane.innerHTML, /data-bill-source-toggle/);
assert.doesNotMatch(billPane.innerHTML, /bill-source-chip/);
assert.doesNotMatch(billPane.innerHTML, /来源：/);
const billVisibleText = billPane.innerHTML.replace(/<[^>]*>/g, "");
assert.doesNotMatch(billVisibleText, /[A-Za-z]/, "账单可见文字不应包含英文内容");
const billStyles = readFileSync("public/styles/theme-inventory-chat.css", "utf8");
assert.match(billStyles, /\.bill-source-dd\s*\{[^}]*margin-left:\s*0/s);
assert.match(billStyles, /\.bill-source-value\s*\{[^}]*text-align:\s*center/s);
assert.match(billStyles, /\.bill-source-trigger\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*20px/s);
assert.match(billStyles, /\.bill-source-caret\s*\{[^}]*justify-self:\s*center/s);

renderCredit();
assert.match(creditPane.innerHTML, /bill-panel/);
assert.match(creditPane.innerHTML, /data-bill-panel="credit"/);
assert.doesNotMatch(creditPane.innerHTML, /声望|经验/);
assert.match(creditPane.innerHTML, /客户对本次交易表示满意|尚无客户评级/);
assert.match(creditPane.innerHTML, /credit-overview/);
assert.match(creditPane.innerHTML, /分/);

player.stats.orderCount = 1;
renderCredit();
assert.match(creditPane.innerHTML, /评分人数不足，暂未开分/);
assert.match(creditPane.innerHTML, /评价进度 1\/5/);
assert.doesNotMatch(creditPane.innerHTML, /aria-label="1 分，1 星"/);

player.stats.orderCount = 5;
recordMetricEntry(player, "satisfaction", 2, "订单好评 · 收藏家", {
  source: "order_rating",
  track: "order",
  extra: {
    review: {
      clientName: "收藏家",
      score: 5,
      requirements: ["品类：手镯", "种水：冰种以上"],
      submittedItems: [{ name: "晴水手镯", kind: "手镯", quality: "冰种", color: "晴水" }],
      comment: "成品与要求十分契合，做工细致，值得再次光顾。",
      delivery: "按时交付",
      fit: "符合订单要求"
    }
  }
});
renderCredit();
assert.match(creditPane.innerHTML, /收藏家/);
assert.match(creditPane.innerHTML, /订单具体要求/);
assert.match(creditPane.innerHTML, /玩家实际提交/);
assert.match(creditPane.innerHTML, /晴水手镯/);
assert.match(creditPane.innerHTML, /本次评价 5\.0 分/);
assert.match(creditPane.innerHTML, /credit-review-comment/);
assert.match(creditPane.innerHTML, />“<\/span>/);
assert.match(creditPane.innerHTML, />”<\/span>/);
assert.ok(
  creditPane.innerHTML.indexOf("credit-review-comment") < creditPane.innerHTML.indexOf("credit-review-facts"),
  "评价文字应显示在订单要求和提交物品上方"
);
assert.doesNotMatch(creditPane.innerHTML, /\{order\./);

openBillView({ thisMonth: true });
assert.equal(openedTab, "bill");
assert.ok(billPane.innerHTML.includes(monthKey(Date.now())));
assert.match(billPane.innerHTML, /bill-brief/);
assert.doesNotMatch(billPane.innerHTML, /class="brief-strip/);

openBillView({ metric: "satisfaction" });
assert.equal(openedTab, "credit");

console.log("bill-module-smoke: ok");
