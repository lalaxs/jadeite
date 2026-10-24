import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __testHooks as H } from "../server.js";
import {
  QUALITIES,
  STARTER_ROUGH_COUNT,
  ROUGH_POOL_TARGET,
  ROUGH_PRICE_NOISE,
  ROUGH_QUALITY_WEIGHTS,
  qualityByKey,
  createRoughPoolService
} from "../server/services/rough-pool-service.js";

assert.equal(QUALITIES.length, 6);
assert.equal(STARTER_ROUGH_COUNT, 1);
assert.equal(ROUGH_POOL_TARGET, 8);
assert.equal(qualityByKey("ice").name, "正冰");
assert.equal(qualityByKey("icy").name, "正冰");
assert.equal(qualityByKey("imperial").name, "玻璃种");
assert.equal(qualityByKey("highIce").name, "高冰");
assert.equal(qualityByKey("stickyIce").name, "糯冰");
assert.equal(qualityByKey("missing").key, "bean");
assert.deepEqual(QUALITIES.map((q) => q.name), ["豆种", "糯种", "糯冰", "正冰", "高冰", "玻璃种"]);
assert.deepEqual(QUALITIES.map((q) => q.value), [0.75, 1, 1.3, 1.7, 2.4, 3.4]);
assert.ok(Math.abs(ROUGH_QUALITY_WEIGHTS.reduce((sum, row) => sum + row.weight, 0) - 1) < 1e-9);
assert.deepEqual(ROUGH_QUALITY_WEIGHTS.map((row) => row.weight), [0.38, 0.30, 0.18, 0.09, 0.04, 0.01]);
assert.deepEqual(ROUGH_PRICE_NOISE, { min: 0.82, max: 1.22 });

function reset() {
  H.world.clear();
}

reset();
H.refreshRoughPool();
assert.ok(H.state.roughPool.length >= ROUGH_POOL_TARGET);
const sample = H.state.roughPool[0];
assert.ok(sample.expertClues?.length >= 3);
assert.ok(sample.visual?.seed != null);
assert.ok(sample.trueQualityKey);
const sampleQuality = qualityByKey(sample.trueQualityKey);
assert.equal(sample.trueValue, Math.round(sample.price * sampleQuality.value));

const player = H.makePlayer("rough-svc-1");
assert.equal(player.rough.length, STARTER_ROUGH_COUNT);
assert.equal(player.rough.every((item) => item.starter === true), true);
assert.ok(["glutinous", "bean"].includes(player.rough[0].trueQualityKey));
assert.equal(player.rough.filter((item) => item.starterProtection === true).length, 1);

const local = createRoughPoolService({
  money: (v) => Math.max(0, Math.round(Number(v) || 0)),
  clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
  pick: (list) => list[0],
  getState: () => ({ roughPool: [] })
});
assert.ok(local.makeRoughStone().id);
assert.equal(local.pickWeightedQuality(() => 0).key, "bean");
assert.equal(local.pickWeightedQuality(() => 0.379999).key, "bean");
assert.equal(local.pickWeightedQuality(() => 0.38).key, "glutinous");
assert.equal(local.pickWeightedQuality(() => 0.989999).key, "highIce");
assert.equal(local.pickWeightedQuality(() => 0.99).key, "glass");
assert.ok(local.makeExpertClues("白雾", QUALITIES[0], 0.7, 1.5).length >= 3);

const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
assert.match(bootSource, /createRoughPoolService/);
assert.doesNotMatch(serverSource, /function makeRoughStone\(/);
assert.doesNotMatch(serverSource, /function makeExpertClues\(/);
assert.doesNotMatch(serverSource, /const qualities\s*=\s*\[/);

const serviceSource = readFileSync("server/services/rough-pool-service.js", "utf8");
assert.match(serviceSource, /function makeRoughStone/);
assert.match(serviceSource, /function makeExpertClues/);
assert.match(serviceSource, /export const QUALITIES/);

console.log("rough-pool-service-smoke: ok");
process.exit(0);
