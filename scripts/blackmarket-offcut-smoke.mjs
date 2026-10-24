import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { __testHooks as H } from "../server.js";
import { claimWorkshopOutputs } from "./workshop-test-utils.mjs";
import { requireApi } from "../server/services/blackmarket/context.js";
import { createNpcOffcut, NPC_OFFCUT_POLICY_VERSION } from "../server/services/blackmarket/npc-offcut.js";
import { npcRandom, upgradeNpcOffcutRow } from "../server/services/blackmarket/npc-catalog.js";
import { maintainNpcBlackmarket } from "../server/services/blackmarket/npc.js";
import { createOffcutLayout, storedOffcutKit, kitFitsRemainingStone } from "../shared/domain/jade/offcut-layout.js";
import { buildOpeningStone, evaluateLeftoverMaterial, evaluateOpeningKit, renderJadeOpeningSvg, openingStoneOutline } from "../shared/domain/jade/jade-opening-engine.js";
import { materialEvaluationWeight } from "../shared/domain/workshop/material-value-pool.js";
import { createMemoryWorldStore } from "../server/world-store.js";
import { canonicalizeExtractionKitIntents } from "../server/services/workshop-planning.js";

const api = requireApi();
const samples = [];
const counts = new Set();
const profiles = new Set();
const sizes = new Set();
const geometry = (kit) => [kit.openingTpl, kit.x, kit.y, kit.rot, kit.scale, kit.size];
function stoneFor(item) {
  return buildOpeningStone({ seed: `${item.id}:${item.openingSeed || item.visual?.openingSeed || item.visual?.seed || item.id}`, roughId: item.id, qualityKey: item.qualityKey, quality: item.quality, color: item.color });
}
for (let index = 0; index < 60; index += 1) {
  const rng = npcRandom(`offcut-quality-${index}`);
  const rough = api.makeRoughStone({ qualityKey: ["bean", "glutinous", "stickyIce", "ice"][index % 4], mass: 1.3, rng });
  // Stable IDs make geometry assertions repeatable across runs.
  rough.id = `offcut-fixture-${index}`;
  const material = api.revealPolishedRough(rough);
  material.openingSeed = `offcut-map-${index}`;
  material.visual.seed = material.openingSeed;
  material.color = ["青白", "灰绿", "浅绿", "晴水"][index % 4];
  const item = createNpcOffcut(material, rng, api, samples.at(-1)?.npcOffcut.profile);
  const stone = stoneFor(item);
  const cuts = item.extractionKits.map(storedOffcutKit);
  const evalResult = evaluateLeftoverMaterial(cuts, stone, { withinStone: true });
  assert.equal(item.remainingRatio, evalResult.remainRatio);
  assert.ok(item.remainingRatio > 0 && item.remainingRatio < 1, `bad retained area ${item.remainingRatio}`);
  const canonical = canonicalizeExtractionKitIntents(item.extractionKits, { requireIds: true });
  assert.equal(canonical.ok, true);
  assert.deepEqual(item.extractionKits.map(geometry), canonical.kits.map(geometry), "Merchant cut geometry must match player planning at the same size");
  item.extractionKits.forEach((kit) => sizes.add(kit.size));
  assert.equal(item.npcOffcut.policyVersion, NPC_OFFCUT_POLICY_VERSION);
  assert.equal(item.mass, Number((material.mass * item.remainingRatio).toFixed(2)));
  assert.ok(item.value > 0 && item.value <= material.value);
  assert.ok(kitFitsRemainingStone(item.npcOffcut.usableKit, stone, cuts, item.npcOffcut.margin, item.npcOffcut.gap));
  assert.ok(evaluateOpeningKit(item.npcOffcut.usableKit, stone).price > 0, "reserved space must contain jade rather than an all-waste hole");
  const remainingAfterReserve = evaluateLeftoverMaterial([...cuts, item.npcOffcut.usableKit], stone, { withinStone: true });
  const beforeWeight = materialEvaluationWeight(evalResult, stone);
  const afterWeight = materialEvaluationWeight(remainingAfterReserve, stone);
  assert.ok(beforeWeight > afterWeight, "cutting the reserved jade must decrease the additive material weight");
  assert.ok(Math.round(item.value * afterWeight / beforeWeight) < item.value, "the advertised usable reserve must yield nonzero rounded material value");
  for (let cut = 0; cut < cuts.length; cut += 1) {
    assert.ok(kitFitsRemainingStone(cuts[cut], stone, cuts.filter((_, i) => i !== cut), item.npcOffcut.margin - 0.01, item.npcOffcut.gap - 0.01));
  }
  const svg = renderJadeOpeningSvg(stone, { revealed: true, kits: cuts.map((kit) => ({ ...kit, extracted: true })) });
  assert.match(svg, /remainingStoneMask/);
  assert.equal((svg.match(/data-cutout="hollow"/g) || []).length, cuts.length);
  assert.doesNotMatch(svg.slice(svg.indexOf("kitLayer")), /fill="#000"/);
  counts.add(cuts.length); profiles.add(item.npcOffcut.profile); samples.push(item);
}
assert.deepEqual([...counts].sort(), [1, 2, 3, 4, 5]);
assert.ok(profiles.size >= 10);
assert.deepEqual([...sizes].sort(), ["L", "M", "S"]);
const deterministicStone = stoneFor(samples[0]);
const makeLayout = () => { let id = 0; return createOffcutLayout(deterministicStone, npcRandom("stable-offcut"), () => `stable-${id++}`); };
assert.deepEqual(makeLayout(), makeLayout(), "A fixed stone and seed must reproduce the same geometry");
assert.ok(openingStoneOutline(deterministicStone).length > 100);
// A rotated drop's tip must remove the same cell its SVG covers.
const probeStone = { ...deterministicStone, jadeMap: { ...deterministicStone.jadeMap, grid: deterministicStone.jadeMap.grid.map((cell, index) => ({ ...cell, waste: index !== 16 * 40 + 23, crack: false })) } };
assert.equal(evaluateLeftoverMaterial([], probeStone, { withinStone: true }).goodN, 1);
assert.equal(evaluateLeftoverMaterial([{ tpl: "drop", x: 300, y: 300, rot: 45, scale: 1 }], probeStone, { withinStone: true }).goodN, 0);

// Upgrade only unsold NPC stock, without creating new offers or changing IDs.
const legacy = structuredClone(samples[0]);
delete legacy.npcOffcut; delete legacy.leftoverGeometryVersion;
const row = { id: "legacy-row", item: legacy, price: Math.round(legacy.value * 0.82), referencePrice: legacy.value, npcDiscount: true };
assert.equal(upgradeNpcOffcutRow(row, api), true);
assert.equal(row.item.id, legacy.id);
assert.equal(row.id, "legacy-row");
assert.equal(row.npcDiscount, true);
const upgraded = structuredClone(row);
assert.equal(upgradeNpcOffcutRow(row, api), false);
assert.deepEqual(row, upgraded);

// Version-2 geometry with the old sizing policy must also upgrade, once.
const oversized = structuredClone(samples[0]);
oversized.npcOffcut.policyVersion = 1;
oversized.extractionKits[0].scale = 3.4;
const oldPolicyRow = { ...structuredClone(row), id: "old-policy-row", item: oversized };
assert.equal(upgradeNpcOffcutRow(oldPolicyRow, api), true);
assert.equal(oldPolicyRow.item.id, oversized.id);
assert.equal(oldPolicyRow.id, "old-policy-row");
assert.equal(oldPolicyRow.item.npcOffcut.policyVersion, NPC_OFFCUT_POLICY_VERSION);
assert.deepEqual(oldPolicyRow.item.extractionKits.map(geometry), canonicalizeExtractionKitIntents(oldPolicyRow.item.extractionKits, { requireIds: true }).kits.map(geometry));
const migratedPolicyRow = structuredClone(oldPolicyRow);
assert.equal(upgradeNpcOffcutRow(oldPolicyRow, api), false);
assert.deepEqual(oldPolicyRow, migratedPolicyRow);

H.state.players.clear(); H.state.blackStalls.length = 0; H.state.sockets.clear();
maintainNpcBlackmarket();
const buyer = H.makePlayer("offcut-buyer"); H.normalizePlayer(buyer);
buyer.cash = 1_000_000; buyer.achievementPoints = buyer.achievementPointsBonus = 680;
H.state.players.set(buyer.id, buyer);
const legacyOwned = { ...structuredClone(oversized), id: "owned-old-policy-offcut" };
buyer.materials.push(legacyOwned);
const preservedOwned = structuredClone(legacyOwned);
maintainNpcBlackmarket();
assert.deepEqual(buyer.materials.find((item) => item.id === legacyOwned.id), preservedOwned, "Stock maintenance must not resize an already-owned offcut");
const stall = H.state.blackStalls.find((entry) => entry.npcRole === "offcut");
const listing = stall.items.find((entry) => entry.item.leftover);
assert.ok(new Set(stall.items.filter((entry) => entry.item.leftover).map((entry) => entry.item.extractionKits.length)).size >= 2, "On-sale offcuts must vary their cut counts");
const expectedCuts = structuredClone(listing.item.extractionKits);
assert.equal(H.buyGoodsFromStallForPlayer(buyer, stall.id, listing.id).ok, true);
const owned = buyer.materials.find((entry) => entry.id === listing.item.id);
assert.deepEqual(owned.extractionKits, expectedCuts);
const device = H.workshopDevicesForPlayer(buyer).find((entry) => entry.stage === "carving");
const common = { itemId: owned.id, workerId: buyer.workshop.owner.id };
const old = owned.extractionKits[0];
const cash = buyer.cash;
assert.equal(H.startWorkshopJobForPlayer(buyer, device.id, { ...common, kits: [{ type: "cabochon", size: "S", x: old.x, y: old.y }] }).ok, false);
assert.equal(H.startWorkshopJobForPlayer(buyer, device.id, { ...common, kits: [{ type: "plaque", size: "L", x: 4, y: 4 }] }).ok, false);
assert.equal(buyer.cash, cash);
const usable = owned.npcOffcut.usableKit;
const result = H.startWorkshopJobForPlayer(buyer, device.id, { ...common, kits: [{ type: "cabochon", size: "S", x: usable.x / 6, y: usable.y / 6, rot: usable.rot }] });
assert.equal(result.ok, true, result.message);
assert.deepEqual(JSON.parse(JSON.stringify(result.job.item.extractionKits.slice(0, expectedCuts.length))), expectedCuts, "Stored historical cut sizes must survive normalization");
const realRandom = Math.random;
try { Math.random = () => 0.99; H.completeProductionJob(buyer, result.job); } finally { Math.random = realRandom; }
claimWorkshopOutputs(H, buyer);
buyer.jobs = buyer.jobs.filter((job) => job.id !== result.job.id);
const after = buyer.materials.find((entry) => entry.id === owned.id);
assert.equal(after.extractionKits.length, expectedCuts.length + 1);
assert.ok(after.remainingRatio < owned.remainingRatio);
assert.ok(after.value < owned.value);
const restored = createMemoryWorldStore();
restored.importSnapshot(H.world.exportSnapshot());
assert.deepEqual(restored.getPlayer(buyer.id).materials.find((entry) => entry.id === owned.id).extractionKits, after.extractionKits);

if (process.argv.includes("--fixture")) {
  const dir = "docs/reports/2026-10-21-blackmarket-npc";
  mkdirSync(dir, { recursive: true });
  const chosen = [1, 2, 3, 4, 5].map((count) => samples.find((item) => item.extractionKits.length === count));
  const cards = chosen.map((item) => `<article><div class="art">${renderJadeOpeningSvg(stoneFor(item), { revealed: true, kits: item.extractionKits.map((kit) => ({ ...storedOffcutKit(kit), extracted: true })) })}</div><strong>${item.quality}边角余料</strong><p>已取 ${item.extractionKits.length} 件 · 剩余 ${Math.round(item.remainingRatio * 100)}%</p><span>${item.npcOffcut.profile.replaceAll("+", " / ")}</span></article>`).join("");
  writeFileSync(`${dir}/offcut-variants.html`, `<!doctype html><html lang="zh"><meta charset="utf-8"><title>新版边角余料验证</title><style>body{margin:0;background:#f5f4ea;color:#273c34;font:16px system-ui}main{padding:36px}h1{font-size:24px;margin:0 0 8px}header p{color:#61766b;margin-bottom:28px}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:18px}article{background:#fffdf6;border:1px solid #b7caba;border-radius:16px;overflow:hidden;box-shadow:0 6px 16px #214a2b0d}.art{height:250px;background:linear-gradient(140deg,#fffdf6,#e2e0d7);padding:12px}.art svg{width:100%;height:100%}strong,p,article span{display:block;margin:12px 16px}article span{color:#789083;font-size:12px;margin-bottom:20px}small{display:block;margin-top:24px;color:#61766b}</style><main><header><h1>边角余料 · 新版取件效果</h1><p>不同形状与数量 · 完整落在料内 · 保留可加工空间</p></header><section class="grid">${cards}</section><small>使用游戏实际生成器与 SVG 渲染器；缺口透出卡片背景。</small></main></html>`);
}
console.log(`blackmarket-offcut-smoke: 60 layouts, counts ${[...counts].sort()}, ${profiles.size} profiles; containment, clearance, usable reserve, purchase/carving/save consistency and migration ok`);
