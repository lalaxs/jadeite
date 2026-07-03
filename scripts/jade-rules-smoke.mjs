import assert from "node:assert/strict";
import {
  analyzeRoughPlacement,
  productMatchesOrder,
  productOrderFitReasons,
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

const bangle = { kind: "bracelet", score: 4, value: 12000, rep: 32 };
const pendant = { kind: "leafPendant", score: 3, value: 4200, rep: 12 };
const collectorOrder = {
  minScore: 4,
  acceptedKinds: ["bracelet", "cabochon"],
  preferredKinds: ["bracelet"],
  tasteTags: ["highGrade"]
};
assert.equal(productMatchesOrder(bangle, collectorOrder), true);
assert.equal(productMatchesOrder(pendant, collectorOrder), false);
assert.ok(productOrderFitReasons(bangle, collectorOrder).some((reason) => reason.includes("题材匹配")));

const liveRange = liveSaleRange(bangle, 120);
assert.ok(liveRange.low < liveRange.high);
assert.ok(liveRange.low > bangle.value * 0.7);

assert.equal(routeRecommendation(bangle, [collectorOrder]).route, "order");
assert.equal(routeRecommendation(pendant, []).route, "livestream");

console.log("Jade expert rules checks passed");
