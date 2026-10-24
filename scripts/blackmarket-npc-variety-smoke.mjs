import assert from "node:assert/strict";
import { __testHooks as H } from "../server.js";
import { requireApi } from "../server/services/blackmarket/context.js";
import { createNpcGoodsRow, npcRandom, NPC_JADE_KINDS } from "../server/services/blackmarket/npc-catalog.js";
import { createNpcFinishPlan, npcFinishSignature, npcFinishStyle } from "../server/services/blackmarket/npc-finish-plans.js";
import { completeNpcJadeAppearance } from "../server/services/blackmarket/npc-jade-finish.js";
import { maintainNpcBlackmarket } from "../server/services/blackmarket/npc.js";
import { NPC_STALLS } from "../shared/domain/blackmarket/npc-rules.js";
import { canonicalizeExtractionKitIntents } from "../server/services/workshop-planning.js";
import { validateFinishPlan, quoteFinishPlan, SETTINGS } from "../server/systems/inlay-system.js";
import { finishPieceRestriction, resolveFinishGemCount } from "../shared/domain/workshop/finished-product-design.js";
import { overallScore, craftGrade, gradeMult, applyCraftValue, PROCESS_BONUS_CAP } from "../shared/domain/workshop/workshop-craft-scoring.js";
import { createMemoryWorldStore } from "../server/world-store.js";
import { buyGoodsFromStallForPlayer } from "../server/services/blackmarket-service.js";
import { inlaySummary } from "../shared/domain/jade/product-meta.js";

const rule = NPC_STALLS.find((entry) => entry.role === "finished");
const deps = requireApi();
const shelf = { id: "npc-variety-fixture", npcSequence: 0, npcBatch: 1, items: [] };
const examples = new Map();
let ringEgg;
const values = { products: new Set(), metals: new Set(), gems: new Set(), polishes: new Set(), refinements: new Set(), rings: new Set(), backings: new Set(), settings: new Set() };
for (let index = 0; index < 350; index += 1) {
  const row = createNpcGoodsRow(rule, shelf, Date.now(), {}, deps);
  const item = row.item;
  examples.set(item.kind, item);
  if (item.kind === "cabochon" && !finishPieceRestriction(item, "ring")) ringEgg ||= item;
  assert.ok(NPC_JADE_KINDS.includes(item.kind));
  const record = { ...(item.finish || item.inlay), productType: item.productType };
  assert.equal(validateFinishPlan(item, record).ok, true, inlaySummary(item));
  assert.equal(canonicalizeExtractionKitIntents([{ ...item.plan, type: item.plan.kitType }], { requireIds: true }).ok, true);
  assert.equal(item.craftScore, Math.round(overallScore(item)));
  assert.equal(item.craftGrade, craftGrade(item.craftScore));
  const blank = structuredClone(item);
  applyCraftValue(blank, item.craftScore / 100 * PROCESS_BONUS_CAP, gradeMult(item.craftScore));
  const quote = quoteFinishPlan(blank, record);
  assert.equal(item.value, blank.value + quote.valueBonus, "NPC valuation must use the workshop's craft and finish quote");
  assert.equal(row.referencePrice, item.value);
  values.products.add(item.productType);
  values.polishes.add(record.polishId);
  if (item.kind === "bracelet") {
    assert.equal(item.productType, "bangle");
    assert.ok([52, 54, 56, 58, 60, 62].includes(item.ringSize));
    assert.ok(["bright", "soft"].includes(record.polishId));
    assert.deepEqual(item.components.map((part) => part.type), ["jade"]);
    assert.equal(item.inlay, undefined);
    values.refinements.add(record.refinementId); values.rings.add(item.ringSize);
  } else {
    values.settings.add(record.settingId);
    if (record.metalId) { values.metals.add(record.metalId); assert.ok(SETTINGS[record.settingId].metals.includes(record.metalId)); }
    if (record.gemId) values.gems.add(record.gemId);
    assert.equal(record.gemCount, resolveFinishGemCount(item, record));
    assert.equal(item.components.find((part) => part.type === "accentStones")?.count || 0, record.gemCount);
    if (item.productType === "ring") {
      assert.equal(item.kind, "cabochon"); assert.equal(finishPieceRestriction(item, "ring"), "");
      assert.notEqual(record.settingId, "cord"); values.backings.add(record.backingId);
    } else assert.equal(record.backingId, null);
    if (record.settingId === "cord") { assert.equal(record.metalId, null); assert.equal(record.gemCount, 0); }
    if (record.settingId === "bezel") assert.equal(record.gemCount, 0);
    if (record.settingId === "micro") assert.ok(record.gemId && record.gemCount > 0);
  }
  const frozen = structuredClone(item);
  assert.equal(completeNpcJadeAppearance(item), false);
  assert.deepEqual(item, frozen, "maintenance never rerolls a generated finish");
  shelf.items.push(row); if (shelf.items.length > 5) shelf.items.shift();
}
assert.equal(examples.size, 7);
for (const [name, count] of Object.entries({ products: 3, metals: 4, gems: 3, polishes: 3, refinements: 3, rings: 6, backings: 2, settings: 6 })) {
  assert.equal(values[name].size, count, `${name} should vary across stock`);
}

// Actual dimensions exclude rings; exact stone seats remain mandatory.
assert.ok(ringEgg, "the fixture includes an egg that can actually become a ring");
const oversized = structuredClone(ringEgg);
oversized.jadePiece.geometry.width = 40;
for (let index = 0; index < 50; index += 1) assert.equal(createNpcFinishPlan(oversized, npcRandom(`large:${index}`)).productType, "pendant");
const thin = structuredClone(ringEgg);
thin.jadePiece.intrinsic.thicknessMm = 1;
for (let index = 0; index < 50; index += 1) assert.equal(createNpcFinishPlan(thin, npcRandom(`thin:${index}`)).productType, "pendant");

// Sampling weights are checked on one immutable eligible piece, independent of
// material generation, quotas and the shelf's intentional diversity adjustments.
const egg = ringEgg;
for (const [supplierRole, expected] of [["finished", [0.35, 0.45, 0.20]], ["traveler", [0.15, 0.45, 0.40]]]) {
  const counts = { cord: 0, metal: 0, gem: 0 };
  const polishes = { bright: 0, soft: 0, matte: 0 };
  let rings = 0, closed = 0;
  const rng = npcRandom(`profile:${supplierRole}`);
  for (let index = 0; index < 1500; index += 1) {
    const plan = createNpcFinishPlan(egg, rng, { supplierRole });
    counts[npcFinishStyle({ kind: "cabochon", inlay: plan })] += 1;
    polishes[plan.polishId] += 1;
    if (plan.productType === "ring") { rings += 1; if (plan.backingId === "closed") closed += 1; }
    assert.equal(validateFinishPlan(egg, plan).ok, true);
  }
  ["cord", "metal", "gem"].forEach((style, index) => assert.ok(Math.abs(counts[style] / 1500 - expected[index]) < 0.05, `${supplierRole}/${style}: ${JSON.stringify(counts)}`));
  ["bright", "soft", "matte"].forEach((polish, index) => assert.ok(Math.abs(polishes[polish] / 1500 - [0.45, 0.40, 0.15][index]) < 0.05));
  assert.ok(rings > 0 && Math.abs(closed / rings - 0.20) < 0.06);
}
const bangleRng = npcRandom("bangle-profile");
const refinements = { basic: 0, standard: 0, artisan: 0 };
let bright = 0;
for (let index = 0; index < 1500; index += 1) {
  const plan = createNpcFinishPlan(examples.get("bracelet"), bangleRng);
  refinements[plan.refinementId] += 1; if (plan.polishId === "bright") bright += 1;
}
["basic", "standard", "artisan"].forEach((id, index) => assert.ok(Math.abs(refinements[id] / 1500 - [0.25, 0.55, 0.20][index]) < 0.05));
assert.ok(Math.abs(bright / 1500 - 0.55) < 0.05);
const basePlan = createNpcFinishPlan(egg, npcRandom("repeat"));
assert.notEqual(npcFinishSignature(egg, createNpcFinishPlan(egg, npcRandom("repeat"), { avoidSignatures: [npcFinishSignature(egg, basePlan)] })), npcFinishSignature(egg, basePlan));
const exhausted = [];
for (const refinementId of ["basic", "standard", "artisan"]) for (const polishId of ["bright", "soft"]) exhausted.push(npcFinishSignature(examples.get("bracelet"), { productType: "bangle", refinementId, polishId }));
assert.equal(validateFinishPlan(examples.get("bracelet"), createNpcFinishPlan(examples.get("bracelet"), () => 0, { avoidSignatures: exhausted })).ok, true, "exhausted variety falls back to legal stock");

// Real restocks keep coverage, do not replace surviving goods, and do not
// reroll owned finished items when normalization and persistence run.
H.state.blackStalls.length = 0;
let now = Date.now();
for (let batch = 0; batch < 20; batch += 1) {
  maintainNpcBlackmarket(now);
  const stall = H.state.blackStalls.find((entry) => entry.npcRole === "finished");
  assert.equal(stall.items.length, 6);
  assert.ok(new Set(stall.items.map((row) => row.item.kind)).size >= 3);
  const styles = new Set(stall.items.map((row) => npcFinishStyle(row.item)));
  assert.ok(styles.has("cord") && (styles.has("metal") || styles.has("gem")));
  const signatures = stall.items.map((row) => npcFinishSignature(row.item));
  assert.equal(new Set(signatures).size, signatures.length);
  now = Math.max(...H.state.blackStalls.map((entry) => entry.npcRotateAt)) + 1;
}
const buyer = H.makePlayer("variety-buyer");
buyer.cash = 10_000_000; H.state.players.set(buyer.id, buyer);
const stall = H.state.blackStalls.find((entry) => entry.npcRole === "finished");
const row = stall.items[0];
const original = structuredClone(row.item);
assert.equal(buyGoodsFromStallForPlayer(buyer, stall.id, row.id).ok, true);
H.normalizePlayer(buyer);
const bought = buyer.bracelets.find((item) => item.id === original.id);
for (const field of ["jadePiece", "components", "inlay", "finish", "craftScores", "value", "name"]) assert.deepEqual(bought[field], original[field]);
const snapshot = H.world.exportSnapshot();
const restored = createMemoryWorldStore(); restored.importSnapshot(snapshot);
const saved = restored.raw.players.get(buyer.id).bracelets.find((item) => item.id === original.id);
assert.deepEqual(saved, bought);
console.log("blackmarket-npc-variety-smoke: reachable shapes/sizes, weighted styles, actual gem seats/quotes, scores, coverage, deduplication, immutable purchases and save/restore ok");
