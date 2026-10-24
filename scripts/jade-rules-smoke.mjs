import assert from "node:assert/strict";
import {
  analyzeRoughPlacement,
  productMatchesOrder,
  productOrderFitReasons,
  evaluateOrderFit,
  estimateOrderSettlement,
  orderCareLine,
  productSizeBand,
  liveSaleRange,
  routeRecommendation
} from "../public/jade-rules.js";

const rough = {
  visual: {
    belt: true,
    beltAngle: 18,
    crack: true,
    crackAngle: 96
  },
  windows: [{ x: 52, y: 24, r: 12 }],
  score: 4,
  rep: 55
};

const goodPlacement = analyzeRoughPlacement(rough, {
  layout: "bracelet",
  x: 54,
  y: 24,
  ringSize: 58
});
assert.equal(goodPlacement.tone, "profit");
assert.ok(goodPlacement.score >= 100);
assert.ok(goodPlacement.reasons.some((reason) => reason.includes("吃色")));
assert.ok(goodPlacement.reasons.some((reason) => reason.includes("开窗")));

const riskyPlacement = analyzeRoughPlacement(rough, {
  layout: "bracelet",
  x: 50,
  y: 50,
  ringSize: 56
});
assert.equal(riskyPlacement.tone, "danger");
assert.ok(riskyPlacement.reasons.some((reason) => reason.includes("压裂")));

const bangle = { kind: "bracelet", score: 4, value: 12000, rep: 32, ringSize: 56 };
const pendant = { kind: "leafPendant", score: 3, value: 4200, rep: 12, size: "M" };
const collectorOrder = {
  minScore: 4,
  acceptedKinds: ["bracelet", "cabochon"],
  preferredKinds: ["bracelet"],
  tasteTags: ["highGrade"]
};
assert.equal(productMatchesOrder(bangle, collectorOrder), true);
assert.equal(productMatchesOrder(pendant, collectorOrder), false);
assert.ok(productOrderFitReasons(bangle, collectorOrder).some((reason) => reason.includes("题材匹配")));

assert.equal(productSizeBand({ ringSize: 54 }), "S");
assert.equal(productSizeBand({ ringSize: 58 }), "M");
assert.equal(productSizeBand({ ringSize: 60 }), "L");
assert.equal(productSizeBand({ size: "S" }), "S");

const personaOrder = {
  persona: { motive: "喜欢", personality: "宽和", temper: 0.45 },
  hard: { budgetMax: 5000, budgetUnlimited: false, sizeBand: "M", kind: "bracelet", kindLabel: "手镯" },
  requirements: [{ type: "minScore", minScore: 3, label: "种水：糯冰及以上" }],
  pay: 4000
};
assert.equal(evaluateOrderFit({ score: 3, value: 3500, size: "M", kind: "bracelet" }, personaOrder).tier, "full");
assert.equal(evaluateOrderFit({ score: 2, value: 3500, size: "M", kind: "bracelet" }, personaOrder).tier, "partial");
assert.equal(evaluateOrderFit({ score: 3, value: 9000, size: "M", kind: "bracelet" }, personaOrder).tier, "hard_fail");
assert.equal(evaluateOrderFit({ score: 3, value: 3500, size: "M", kind: "peacePendant" }, personaOrder).tier, "hard_fail");
assert.equal(productMatchesOrder({ score: 3, value: 3500, size: "M", kind: "bracelet" }, personaOrder), true);

const softBudget = evaluateOrderFit({ score: 3, value: 5400, size: "M", kind: "bracelet" }, personaOrder);
assert.equal(softBudget.tier, "partial");
assert.equal(softBudget.budgetSoftOver, true);
assert.equal(softBudget.rejected, false);

const prestigeFail = evaluateOrderFit(
  { score: 3, value: 400, size: "M", kind: "bracelet" },
  { ...personaOrder, persona: { motive: "炫富", personality: "计较", temper: 1.15 }, pay: 4000 }
);
assert.equal(prestigeFail.tier, "hard_fail");
assert.equal(prestigeFail.rejected, true);

const prestigePartial = evaluateOrderFit(
  { score: 3, value: 800, size: "M", kind: "bracelet" },
  { ...personaOrder, persona: { motive: "装样子", personality: "宽和", temper: 0.45 }, pay: 4000 }
);
assert.equal(prestigePartial.tier, "hard_fail", "a cheap product cannot receive a high fixed quote");
assert.equal(prestigePartial.rejected, true);

const craftGood = evaluateOrderFit(
  { score: 3, value: 3500, size: "M", kind: "bracelet", craftScore: 92, craftGrade: "A" },
  { ...personaOrder, persona: { motive: "炫富", personality: "计较", temper: 1.15 }, pay: 4000 }
);
assert.ok(craftGood.craftTipBoost >= 0.04);
assert.equal(craftGood.tier, "full");

const craftBad = evaluateOrderFit(
  { score: 3, value: 3500, size: "M", kind: "bracelet", craftScore: 40, craftGrade: "D" },
  { ...personaOrder, persona: { motive: "炫富", personality: "计较", temper: 1.15 }, pay: 4000 }
);
assert.ok(craftBad.craftMismatch >= 0.15);
assert.equal(craftBad.tier, "full");

const settleFull = estimateOrderSettlement({ tier: "full" }, { pay: 1000 });
assert.equal(settleFull.payMult, 1);
const settlePartial = estimateOrderSettlement({ tier: "partial", budgetSoftOver: true }, { pay: 1000 });
assert.equal(settlePartial.payMult, 0.65);
const settleReject = estimateOrderSettlement({ tier: "hard_fail", rejected: true }, { pay: 1000 });
assert.equal(settleReject.payMult, 0);

const careScore = orderCareLine({
  id: "care-score",
  persona: { motive: "炫富" },
  hard: { kind: "bracelet", kindLabel: "手镯", budgetMax: 5000, sizeBand: "M" },
  requirements: [{ type: "minScore", minScore: 3 }]
});
assert.equal(typeof careScore, "string");
assert.match(careScore, /种水|水头/);

const careColor = orderCareLine({
  id: "care-color",
  persona: { motive: "喜欢" },
  hard: { kind: "bracelet", kindLabel: "手镯" },
  requirements: [{ type: "requireBrightColor", label: "色泽：要明艳正色" }]
});
assert.match(careColor, /绿|颜色|醒目/);

const careFace = orderCareLine({
  id: "care-face",
  persona: { motive: "炫富" },
  hard: {},
  requirements: []
});
assert.match(careFace, /面子|场面|掉价/);

const liveRange = liveSaleRange(bangle, 120);
assert.ok(liveRange.low < liveRange.high);
assert.ok(liveRange.low > bangle.value * 0.7);

assert.equal(routeRecommendation(bangle, [collectorOrder]).route, "order");
assert.equal(routeRecommendation(pendant, []).route, "livestream");

console.log("Jade expert rules checks passed");
