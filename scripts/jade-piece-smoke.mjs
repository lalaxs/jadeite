import assert from "node:assert/strict";
import { captureJadePiece, jadePieceFor, jadePieceSizeLabel, originalJadeItem } from "../shared/domain/jade/jade-piece.js";
import { buildOpeningStone, KIT_LIB } from "../shared/domain/jade/jade-opening-engine.js";
import { finishedJadeGeometry, finishPieceRestriction } from "../shared/domain/workshop/finished-product-design.js";
import { inlayCatalog, quoteFinishPlan, canonicalizeFinishPlan, applyInlay } from "../server/systems/inlay-system.js";
import { createFinishPlanDraft, quoteFinishPlanDraft, normalizeFinishPlanDraft } from "../shared/domain/workshop/finish-plan-model.js";
import { buildFinishPreviewProduct } from "../public/inlay-preview-tester.js";
import { componentJewelrySvg } from "../public/inlay-product-renderer.js";
import { productCanvas } from "../public/features/opening/opening-render.js";
import { jadePiecePreviewMarkup } from "../public/jade-piece-view.js";
import { publicStone } from "../server/services/snapshot-public.js";
import { __testHooks as H } from "../server.js";
import { claimWorkshopOutputs } from "./workshop-test-utils.mjs";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";

const catalog = inlayCatalog();
const player = installOwnedWorkshopFixture(H.makePlayer("jade-piece-workflow"));
H.normalizePlayer(player);
H.state.players.set(player.id, player);
const material = {
  ...player.rough[0], id: "piece-specific-rough", name: "飘花棉料", type: "material",
  materialStage: "opened", stage: "material", qualityKey: "ice", quality: "冰种", color: "飘花绿",
  openingSeed: "authoritative-seed-different-from-visual", price: 30000, value: 30000,
  visual: { seed: 32198, cotton: .65, crack: true, translucency: .55, vein: "#247854" }
};
player.materials.push(material);
const carving = H.workshopDevicesForPlayer(player).find((d) => d.stage === "carving");
const finish = H.workshopDevicesForPlayer(player).find((d) => d.stage === "finishing");
function complete(job) {
  job.readyAt = Date.now() - 1;
  const random = Math.random;
  try { Math.random = () => .99; H.processProductionJobs(Date.now(), { onlineOnly: false }); }
  finally { Math.random = random; }
  claimWorkshopOutputs(H, player);
}
const extraction = H.startWorkshopJobForPlayer(player, carving.id, {
  itemId: material.id, workerId: carving.workerId,
  kits: [
    { id: "piece-left", type: "cabochon", x: 30, y: 40, rot: 27, size: "S" },
    { id: "piece-right", type: "cabochon", x: 70, y: 60, rot: 125, size: "L" }
  ]
});
assert.equal(extraction.ok, true, extraction.message);
complete(extraction.job);
const blanks = player.bracelets.filter((i) => i.sourceRoughId === material.id);
assert.equal(blanks.length, 2);
const [blank, large] = blanks;
const original = structuredClone(blank);
const expectedStone = buildOpeningStone({ seed: `${material.id}:${material.openingSeed}`, roughId: material.id, qualityKey: material.qualityKey, quality: material.quality, color: material.color });
assert.equal(blank.jadePiece.material.material, expectedStone.material, "freeze exactly the planner's material including the authoritative opening seed");
assert.equal(blank.sourceMaterial.openingSeed, material.openingSeed);
assert.equal(blank.jadePiece.kit.x, 180);
assert.equal(blank.jadePiece.kit.y, 240);
assert.equal(blank.jadePiece.kit.rot, 27);
assert.equal(blank.jadePiece.intrinsic.visual.cotton, .65);
assert.equal(blank.jadePiece.intrinsic.thicknessMm, null, "never invent a measured thickness");
assert.notEqual(blank.jadePiece.signature, large.jadePiece.signature);
assert.notDeepEqual(blank.jadePiece.kit, large.jadePiece.kit, "two cuts from the same rough have independent coordinates");
assert.ok(blank.jadePiece.geometry.width < large.jadePiece.geometry.width);
assert.ok(jadePieceSizeLabel(blank).includes("mm"));
assert.equal(jadePieceFor({ id: "legacy" }), null);
assert.equal(jadePiecePreviewMarkup({ id: "missing" }), "");
assert.match(productCanvas(blank), /data-jade-view="original"/);
assert.match(jadePiecePreviewMarkup(blank), /加工效果/);
assert.doesNotMatch(jadePiecePreviewMarkup(blank), /取件原貌|查看来源|data-jade-original|jade-origin-details/);

function materialLayer(markup) {
  // SVG instance ids are presentation-only; material, masks and transforms must
  // otherwise be byte-identical across polish, mount, lifecycle and context.
  const start = markup.indexOf('<g class="craft-source-material"');
  const end = markup.indexOf('</g></g>', start);
  return markup.slice(start, end).replace(/finished-\d+/g, "finished-instance");
}
const sourceLayer = materialLayer(componentJewelrySvg(original, "compact", { viewMode: "original" }));
const materialTransform = (markup) => markup.match(/<use href="#finished-\d+-material-jadeMaterial" transform="([^"]+)"/)?.[1];
const originalTransform = materialTransform(productCanvas(blank));
assert.equal(originalTransform, "scale(1.33333) rotate(-27.0) translate(-180 -240)", "the exact rotated cut remains anchored in source material coordinates");
assert.notEqual(materialTransform(productCanvas(large)), originalTransform, "other cuts from this stone sample their own region");
for (const polishId of ["bright", "soft", "matte"]) {
  for (const settingId of ["claw", "bezel", "micro", "cord"]) {
    const draft = createFinishPlanDraft("cabochon", catalog, blank);
    Object.assign(draft, { productType: "pendant", settingId, metalId: settingId === "cord" ? null : "platinum", gemId: settingId === "micro" ? "diamond" : null, polishId, backingId: null });
    normalizeFinishPlanDraft("cabochon", draft, catalog, blank);
    const plan = canonicalizeFinishPlan(blank, draft);
    assert.equal(plan.ok, true, plan.message);
    const quote = quoteFinishPlan(blank, plan.plan);
    const clientQuote = quoteFinishPlanDraft(plan.plan, catalog, 0, blank.value, blank);
    for (const key of ["metalAmount", "gemCount", "valueBonus"]) assert.equal(clientQuote[key], quote[key]);
    const preview = buildFinishPreviewProduct(blank, draft);
    const finished = applyInlay(structuredClone(blank), plan.plan, quote);
    for (const item of [preview, finished, JSON.parse(JSON.stringify(finished)), publicStone(finished)]) {
      assert.deepEqual(item.jadePiece, original.jadePiece);
      assert.deepEqual(finishedJadeGeometry(item), original.jadePiece.geometry);
      assert.equal(materialLayer(productCanvas(item)), sourceLayer);
      assert.equal(materialTransform(productCanvas(item)), originalTransform);
      assert.equal(materialLayer(componentJewelrySvg(item, "compact", { viewMode: "jade" })), sourceLayer);
      assert.deepEqual(originalJadeItem(item).quality, original.quality);
    }
    if (settingId === "cord") assert.doesNotMatch(productCanvas(finished), /craft-drill-rim/, "keep the captured outline and holes intact");
  }
}
assert.deepEqual(blank, original, "rendering and quoting cannot mutate the input");
const beforeParentMutation = JSON.stringify(blank.jadePiece);
material.visual.cotton = 0;
material.visual.seed = 1;
material.openingSeed = "changed";
assert.equal(JSON.stringify(blank.jadePiece), beforeParentMutation, "parent changes do not rewrite the piece");
const independent = structuredClone(blank);
delete independent.sourceMaterial;
delete independent.sourceRoughId;
independent.id = "new-owner-display-id";
independent.color = "紫罗兰";
independent.kind = "plaque";
assert.equal(materialLayer(productCanvas(independent)), sourceLayer, "the frozen piece survives missing parents, renamed ids and display metadata");

const smallDraft = canonicalizeFinishPlan(blank, { productType: "pendant", settingId: "bezel", metalId: "platinum", gemId: null, gemCount: 0, polishId: "bright", backingId: null }).plan;
assert.ok(quoteFinishPlan(blank, smallDraft).metalAmount < quoteFinishPlan(large, smallDraft).metalAmount, "mount consumption follows actual piece size");
const largeRing = canonicalizeFinishPlan(large, { ...smallDraft, productType: "ring", backingId: "open" });
assert.equal(largeRing.ok, false, "an oversized original cannot silently shrink to a ring");
assert.ok(finishPieceRestriction(large, "ring"));
const thin = structuredClone(blank);
thin.jadePiece.intrinsic.thicknessMm = 1;
assert.ok(finishPieceRestriction(thin, "ring"));

// Saved in-flight jobs carry the original, and the server ignores client
// attempts to substitute the source, geometry or material snapshot.
player.externalMaterials = { platinum: 100, diamond: 500 };
const started = H.startWorkshopJobForPlayer(player, finish.id, {
  itemId: blank.id, workerId: finish.workerId,
  finishPlan: { ...smallDraft, jadePiece: { geometry: { width: 1 } }, sourceMaterial: { roughId: "forged" } }
});
assert.equal(started.ok, true, started.message);
assert.equal(started.job.finishPlan.jadePiece, undefined);
assert.equal(started.job.finishPlan.sourceMaterial, undefined);
const restored = JSON.parse(JSON.stringify(started.job));
player.jobs[player.jobs.findIndex((job) => job.id === restored.id)] = restored;
complete(restored);
const completed = player.bracelets.find((item) => item.id === blank.id);
assert.equal(completed.materialStage, "finished");
assert.deepEqual(completed.jadePiece, original.jadePiece);
assert.equal(materialLayer(productCanvas(completed)), sourceLayer);
for (const key of ["quality", "qualityKey", "color", "size", "ringSize"]) assert.deepEqual(completed[key], original[key]);

const largeOriginal = structuredClone(large);
const stocksBeforeFailure = structuredClone(player.externalMaterials);
const failed = H.startWorkshopJobForPlayer(player, finish.id, {
  itemId: large.id, workerId: finish.workerId, finishPlan: smallDraft
});
assert.equal(failed.ok, true, failed.message);
failed.job.readyAt = Date.now() - 1;
const savedRandom = Math.random;
try { Math.random = () => 0; H.processProductionJobs(Date.now(), { onlineOnly: false }); }
finally { Math.random = savedRandom; }
const refunded = player.bracelets.find((item) => item.id === large.id);
assert.deepEqual(refunded, largeOriginal, "failed finishing returns the exact same original piece");
assert.deepEqual(player.externalMaterials, stocksBeforeFailure, "failed finishing refunds actual size-based consumption");

// Every current extraction silhouette, including both hollow shapes, can be
// captured without depending on the original rough object at render time.
for (const tpl of KIT_LIB) {
  const item = { id: `shape-${tpl.id}`, sourceMaterial: { visual: { seed: 5 }, placement: { openingTpl: tpl.id, x: 50, y: 50, scale: 1 } } };
  const geometry = finishedJadeGeometry(item);
  item.jadePiece = captureJadePiece(item, expectedStone, { tpl: tpl.id, x: 300, y: 300, rot: 47, scale: 1 }, geometry);
  assert.match(productCanvas(item), /craft-source-material/);
  assert.equal(item.jadePiece.geometry.shape, tpl.shape);
  for (const size of ["S", "M", "L"]) {
    const sized = { ...item, jadePiece: null, size };
    const g = finishedJadeGeometry(sized);
    sized.jadePiece = captureJadePiece(sized, expectedStone, { tpl: tpl.id, x: 300, y: 300, rot: 47, scale: 1 }, g);
    for (const viewMode of ["original", "jade"]) {
      const markup = componentJewelrySvg(sized, "compact", { viewMode });
      const frame = markup.match(/data-product-layer="presentation" transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)"/);
      assert.ok(frame, `${tpl.id}: preview has a display frame`);
      const [, x, y, zoom] = frame.map(Number);
      const bounds = {
        left: x + g.nativeBounds.minX * g.unit * zoom,
        right: x + g.nativeBounds.maxX * g.unit * zoom,
        top: y + g.top * zoom,
        bottom: y + g.bottom * zoom
      };
      assert.ok(Math.abs((bounds.left + bounds.right) / 2 - 60) < .01, `${tpl.id}: horizontally centred`);
      assert.ok(Math.abs((bounds.top + bounds.bottom) / 2 - 60) < .01, `${tpl.id}: vertically centred`);
      assert.ok(bounds.left >= 10 && bounds.top >= 10 && bounds.right <= 110 && bounds.bottom <= 110,
        `${tpl.id} ${size}: entire outline fits with room for edge strokes and shadow`);
    }
  }
}
console.log("jade-piece-smoke: exact extraction field, independent cuts, immutable geometry, size-aware quotes, original comparison, legacy fallback and restored workshop completion ok");
process.exit(0);
