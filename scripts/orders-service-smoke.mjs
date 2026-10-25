import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __testHooks as H } from "../server.js";
import {
  NPC_PROFILES,
  ORDER_SLOT_CAP,
  createOrdersService,
  orderGameDayKey,
  personaDisplayTitle,
  computeOrderSatisfactionDelta,
  orderGenerationSatisfaction,
  resolveOrderCustomerRating,
  ORDER_SAT_EQUILIBRIUM,
  ORDER_SINGLE_REFRESH_DAILY_CAP,
  ORDER_BATCH_REFRESH_DAILY_CAP,
  orderSingleRefreshFeeForCount,
  orderBatchRefreshFeeForCount
} from "../server/services/orders-service.js";
import { evaluateOrderFit, productMatchesOrder } from "../public/jade-rules.js";
import { previewOrderIncome } from "../public/features/orders/orders-module.js";
import { buildSaleComparison } from "../public/features/finance/sale-comparison.js";

assert.ok(NPC_PROFILES.length >= 4);
assert.equal(ORDER_SLOT_CAP, 4);
assert.equal(orderGenerationSatisfaction(null), 70);
assert.equal(orderGenerationSatisfaction(""), 70);
assert.equal(orderGenerationSatisfaction(0), 0);
assert.equal(orderGenerationSatisfaction(100), 100);
assert.equal(typeof H.makeOrder, "function");
assert.equal(typeof H.refillOrders, "function");
assert.equal(typeof H.completeOrderForPlayer, "function");
assert.equal(typeof H.replaceOrdersPool, "function");
assert.equal(typeof H.ensureDailyOrderRefresh, "function");
assert.equal(ORDER_SINGLE_REFRESH_DAILY_CAP, 10);
assert.equal(ORDER_BATCH_REFRESH_DAILY_CAP, 3);
assert.deepEqual(
  [0, 1, 2, 9].map(orderSingleRefreshFeeForCount),
  [500, 750, 1_100, 18_000]
);
assert.deepEqual(
  [0, 1, 2].map(orderBatchRefreshFeeForCount),
  [1_500, 3_000, 6_000]
);

function reset() {
  H.world.clear();
}

reset();
const player = H.makePlayer("ord-svc-1");
H.normalizePlayer(player);
player.cash = 50_000;
player.rep = 120;
player.level = 20; // Persona/settlement fixture can draw expensive clients; demand limits have their own test.
H.refillOrders(player);
H.state.players.set(player.id, player);

const refreshNow = Date.now();
player.orderRefreshCounts = { dayKey: orderGameDayKey(refreshNow), single: 2, batch: 1 };
assert.equal(H.orderSingleRefreshFee(player, refreshNow), 1_100);
assert.equal(H.orderBatchRefreshFee(player, refreshNow), 3_000);

assert.equal(player.orders.length, ORDER_SLOT_CAP);
const order = player.orders[0];
assert.ok(order.persona, "order should carry persona");
assert.ok(order.hard, "order should carry hard constraints");
assert.ok(order.hard.kind, "order should require a product kind");
assert.ok(order.hard.kindLabel, "order should expose kind label");
assert.ok(Array.isArray(order.requirements), "order should carry requirements list");
assert.ok(order.client && !String(order.client).includes("岁"), "client title should be fused nickname");
assert.ok(order.persona.title || order.persona.label);

const finished = [];
for (let i = 0; i < (order.quantity || 1); i += 1) {
  finished.push({
    id: `fin-${i}`,
    type: "bracelet",
    kind: order.hard.kind,
    productType: order.hard.kind,
    name: "测试成品",
    score: 5,
    materialStage: "finished",
    value: Math.min(Number(order.hard?.budgetMax || order.pay || 5000), Number(order.pay || 5000)),
    size: order.hard?.sizeBand || "M",
    ringSize: order.hard?.sizeBand === "S" ? 54 : order.hard?.sizeBand === "L" ? 60 : 56,
    rep: 2,
    color: "晴水",
    inlay: { metalId: "gold18k", settingId: "bezel" },
    openingEval: { crackRatio: 0 }
  });
}
player.bracelets.push(...finished);

const beforeCash = player.cash;
const beforeOrders = player.orders.length;
const result = H.completeOrderForPlayer(player, {
  orderId: order.id,
  braceletIds: finished.map((item) => item.id)
});
assert.equal(result.ok, true, result.message);
assert.ok(player.cash > beforeCash);
assert.equal(player.bracelets.filter((b) => finished.some((f) => f.id === b.id)).length, 0);
assert.equal(player.orders.length, beforeOrders);
assert.ok(player.orders.every((item) => item.id !== order.id));
assert.equal(typeof result.badReview, "boolean");
assert.ok(["full", "partial", "hard_fail"].includes(result.tier));
assert.ok(["好评", "好评+", "中评", "差评"].includes(result.customerRating));
assert.equal(typeof result.satisfactionDelta, "number");
assert.ok(Number.isFinite(Number(result.satisfactionAfter)));
const savedReview = player.ratingHistory.find((entry) => entry.itemId === order.id)?.meta?.review;
assert.ok(savedReview, "completed order should persist a detailed customer review");
assert.ok(savedReview.clientName);
assert.ok(savedReview.score >= 1 && savedReview.score <= 5);
assert.ok(Array.isArray(savedReview.requirements) && savedReview.requirements.length >= 1);
assert.ok(Array.isArray(savedReview.submittedItems) && savedReview.submittedItems.length === finished.length);
assert.ok(savedReview.comment);
assert.doesNotMatch(JSON.stringify(savedReview), /\{order\./);
assert.doesNotMatch(String(player.ratingHistory.find((entry) => entry.itemId === order.id)?.note || ""), /\{order\.|[A-Za-z]{3,}/);
if (result.tier === "full" && !result.late && !result.badReview) {
  assert.ok(
    result.satisfactionDelta > 0,
    `full on-time should raise satisfaction, got delta ${result.satisfactionDelta}`
  );
  assert.ok(["好评", "好评+"].includes(result.customerRating));
}

const fail = H.completeOrderForPlayer(player, { orderId: "missing", braceletIds: [] });
assert.equal(fail.ok, false);

reset();
const rejectPlayer = H.makePlayer("ord-svc-reject");
H.normalizePlayer(rejectPlayer);
rejectPlayer.cash = 20_000;
rejectPlayer.orders = [{
  id: "ord-reject-1",
  client: "测试客人",
  pay: 5000,
  rep: 8,
  quantity: 1,
  persona: { motive: "喜欢", personality: "宽和", temper: 0.45 },
  hard: { budgetMax: 5000, budgetUnlimited: false, sizeBand: "M", kind: "bracelet", kindLabel: "手镯" },
  requirements: []
}];
rejectPlayer.bracelets = [{
  id: "fin-wrong-kind",
  type: "bracelet",
  kind: "peacePendant",
  productType: "peacePendant",
  name: "错题材成品",
  score: 4,
  materialStage: "finished",
  value: 3000,
  size: "M",
  ringSize: 56,
  color: "晴水",
  inlay: { metalId: "gold18k" },
  openingEval: { crackRatio: 0 }
}];
H.state.players.set(rejectPlayer.id, rejectPlayer);
const rejected = H.completeOrderForPlayer(rejectPlayer, {
  orderId: "ord-reject-1",
  braceletIds: ["fin-wrong-kind"]
});
assert.equal(rejected.ok, false);
assert.match(String(rejected.message || ""), /拒收/);
assert.equal(rejectPlayer.bracelets.length, 1, "拒收不应扣货");
assert.equal(rejectPlayer.orders.length, 1, "拒收不应销单");
assert.equal(rejectPlayer.cash, 20_000, "拒收不应付款");

for (const [score, cracked, expectedPay] of [[4, false, 1250], [2, false, 1000], [2, true, 750]]) {
  const customer = H.makePlayer(`order-fit-${expectedPay}`);
  H.normalizePlayer(customer);
  customer.orders = [{ id: `fit-${expectedPay}`, client: "熟客", pay: 5000, rep: 8, quantity: 1,
    persona: { motive: "炫富", personality: "计较", temper: 1.15 },
    hard: { minValue: 4000, kind: "dropPendant", sizeBand: "M", budgetMax: 5000 },
    requirements: [{ type: "minScore", minScore: 4, label: "种水：正冰及以上" },
      { type: "forbidCrack", label: "净度：无纹裂" }] }];
  const product = { id: `product-${expectedPay}`, name: "水滴挂件", type: "bracelet", kind: "dropPendant",
    materialStage: "finished", size: "M", value: 1000, score, visual: { crack: cracked } };
  customer.bracelets = [product];
  H.state.players.set(customer.id, customer);
  const fitOrder = customer.orders[0];
  const preview = previewOrderIncome(customer, fitOrder, [product], evaluateOrderFit(product, fitOrder));
  assert.equal(preview.amount, expectedPay, "fitting requirements determine the capped product quote");
  const comparison = buildSaleComparison({ me: customer }, product);
  assert.equal(comparison.rows.find((row) => row.id === `order:${fitOrder.id}`).revenue, expectedPay);
  const originalRandom = Math.random;
  let settled;
  try {
    Math.random = () => 0.99;
    settled = H.completeOrderForPlayer(customer, { orderId: fitOrder.id, braceletIds: [product.id] });
  } finally { Math.random = originalRandom; }
  assert.equal(settled.ok, true, settled.message);
  assert.equal(settled.finalPay, expectedPay, "actual receipt matches the order and finance previews");
}

const local = createOrdersService({
  money: (value) => Math.max(0, Math.round(Number(value) || 0)),
  clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
  pick: (list) => list[0],
  qualities: [
    { key: "bean", name: "豆种", score: 1 },
    { key: "ice", name: "正冰", score: 4 },
    { key: "glass", name: "玻璃种", score: 6 }
  ],
  takeItem: () => null,
  earnCash: () => {},
  materialStageFor: () => "finished",
  advanceTask: () => {},
  addNews: () => {}
});
const sample = local.makeOrder({ rep: 0, satisfaction: 50, orders: [] });
assert.ok(sample.persona);
assert.ok(sample.hard);
assert.equal(Object.hasOwn(sample.hard, "minValue"), false);
assert.ok(sample.client);
assert.doesNotMatch(sample.client, /岁/);

const unratedOrder = local.makeOrder(
  { rep: 0, satisfaction: null, orders: [] },
  { rng: () => 0.42 }
);
const baselineOrder = local.makeOrder(
  { rep: 0, satisfaction: 70, orders: [] },
  { rng: () => 0.42 }
);
assert.equal(unratedOrder.pay, baselineOrder.pay, "unrated players should receive baseline-70 order pay");
assert.equal(unratedOrder.persona.wealth, baselineOrder.persona.wealth);

const sparse = {
  persona: { age: 20, wealth: "小康", personality: "宽和", motive: "喜欢", temper: 0.45 },
  hard: { budgetMax: 3000, budgetUnlimited: false, sizeBand: "M", kind: "peacePendant", kindLabel: "平安扣挂件" },
  requirements: [],
  pay: 2800
};
const fitOk = evaluateOrderFit({
  score: 2,
  value: 2500,
  size: "M",
  kind: "peacePendant",
  color: "青白"
}, sparse);
assert.equal(fitOk.tier, "full");
assert.equal(productMatchesOrder({ score: 2, value: 2500, size: "M", kind: "peacePendant" }, sparse), true);
assert.equal(evaluateOrderFit({
  score: 2,
  value: 2500,
  size: "M",
  kind: "bracelet",
  color: "青白"
}, sparse).tier, "hard_fail");

const fitBad = evaluateOrderFit({
  score: 1,
  value: 9000,
  size: "S",
  color: "灰绿",
  openingEval: { crackRatio: 0.1 },
  inlay: { metalId: "silver925" }
}, {
  persona: { motive: "炫富", personality: "计较", temper: 1.15 },
  hard: { budgetMax: 5000, budgetUnlimited: false, sizeBand: "L" },
  requirements: [
    { type: "minScore", minScore: 3, label: "种水：糯冰及以上" },
    { type: "forbidCrack", label: "净度：无纹裂" },
    { type: "forbidCheapMetal", label: "镶嵌金属：不要 925银" }
  ],
  pay: 4800
});
assert.equal(fitBad.tier, "hard_fail");
assert.ok(fitBad.aversionHits.length >= 2);

assert.ok(orderGameDayKey().includes("-"));
assert.equal(
  personaDisplayTitle({
    age: 65,
    ageBand: "elder",
    wealth: "富有",
    motive: "撑场面"
  }),
  "贵妇"
);

const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
assert.match(bootSource, /createOrdersService/);
assert.doesNotMatch(serverSource, /const npcProfiles\s*=/);
assert.doesNotMatch(serverSource, /function makeOrder\(/);
assert.doesNotMatch(serverSource, /function refillOrders\(/);

const serviceSource = readFileSync("server/services/orders-service.js", "utf8");
assert.match(serviceSource, /function completeOrderForPlayer/);
assert.match(serviceSource, /evaluateOrderFit/);
assert.match(serviceSource, /persona/);
assert.match(serviceSource, /客人拒收/);
assert.match(serviceSource, /estimateOrderSettlement/);
assert.match(serviceSource, /WEALTH_VALUE_BAND/);
assert.match(serviceSource, /satisfactionPayBoost/);
assert.match(serviceSource, /tipMult/);
assert.doesNotMatch(serviceSource, /urgencyRoll|urgentMs|urgentAt/);
assert.match(serviceSource, /日常订单/);
assert.match(serviceSource, /timePenalty/);
assert.match(serviceSource, /craftTipBoost/);
assert.doesNotMatch(serviceSource, /satisfaction \|\| 0\) \/ 360/);
assert.match(serviceSource, /computeOrderSatisfactionDelta/);
assert.match(serviceSource, /ORDER_SAT_EQUILIBRIUM/);
assert.match(serviceSource, /customerRating/);

{
  const good = resolveOrderCustomerRating({ tier: "full", late: false, badReview: false });
  assert.equal(good.label, "好评");
  const great = resolveOrderCustomerRating({
    tier: "full",
    late: false,
    badReview: false,
    tipped: true
  });
  assert.equal(great.label, "好评+");
  const bad = resolveOrderCustomerRating({ tier: "partial", badReview: true });
  assert.equal(bad.label, "差评");

  const fixed = () => 0; // randInt picks min
  const up = computeOrderSatisfactionDelta(55, {
    tier: "full",
    late: false,
    badReview: false
  }, fixed);
  assert.equal(up.label, "好评");
  assert.ok(up.delta >= 2, `expected recovery delta, got ${up.delta}`);
  assert.ok(up.pull > 0);

  const high = computeOrderSatisfactionDelta(92, {
    tier: "full",
    late: false,
    badReview: false
  }, fixed);
  assert.ok(high.delta < up.delta, "high sat good reviews should climb slower");

  const hit = computeOrderSatisfactionDelta(70, {
    tier: "partial",
    late: false,
    badReview: true
  }, fixed);
  assert.equal(hit.label, "差评");
  assert.equal(hit.delta, -6);
  assert.equal(ORDER_SAT_EQUILIBRIUM, 72);
}

// 第 2 批：报价锚定货值带；满意度软抬不超过约 +8%
const bandSamples = { 贫穷: [], 小康: [], 富有: [] };
for (let i = 0; i < 36; i += 1) {
  const sampleOrder = local.makeOrder({ satisfaction: 0, orders: [] });
  assert.equal(sampleOrder.urgency, "日常订单");
  const wealth = sampleOrder.persona?.wealth;
  if (bandSamples[wealth]) bandSamples[wealth].push(sampleOrder.pay);
  assert.ok(sampleOrder.targetMid > 0, "order should expose targetMid");
  if (!sampleOrder.hard?.budgetUnlimited) {
    assert.ok(sampleOrder.pay >= 400 && sampleOrder.pay <= 68000);
  }
}
assert.ok(bandSamples["贫穷"].length + bandSamples["小康"].length + bandSamples["富有"].length >= 20);
if (bandSamples["贫穷"].length && bandSamples["富有"].length) {
  const poorAvg = bandSamples["贫穷"].reduce((a, b) => a + b, 0) / bandSamples["贫穷"].length;
  const richAvg = bandSamples["富有"].reduce((a, b) => a + b, 0) / bandSamples["富有"].length;
  assert.ok(richAvg > poorAvg, `rich avg ${richAvg} should exceed poor avg ${poorAvg}`);
}

const lowSat = local.makeOrder({ satisfaction: 0, orders: [] });
const highSatPays = [];
for (let i = 0; i < 24; i += 1) {
  highSatPays.push(local.makeOrder({ satisfaction: 100, orders: [] }).pay);
}
assert.ok(Math.max(...highSatPays) <= 70_000);

console.log("orders-service-smoke: ok");
process.exit(0);
