import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __testHooks as H } from "../server.js";
import { inlayCatalog, canonicalizeFinishPlan, quoteFinishPlan, reserveFinishMaterials, applyInlay } from "../server/systems/inlay-system.js";
import { createFinishPlanDraft, validateFinishPlanDraft } from "../shared/domain/workshop/finish-plan-model.js";
import { BANGLE_REFINEMENTS, bangleStepScore, previewBangleFinish, normalizeBangleOrderRequirements } from "../shared/domain/workshop/bangle-finish.js";
import { PRODUCT_CATEGORIES, EXTRACTION_KITS } from "../shared/domain/jade/jade-categories.js";
import { inlaySummary } from "../shared/domain/jade/product-meta.js";
import { publicStone, publicListing, publicProductionJob } from "../server/services/snapshot-public.js";
import { buildFinishPreviewProduct } from "../public/inlay-preview-tester.js";
import { componentJewelrySvg } from "../public/inlay-product-renderer.js";
import { jadePiecePreviewMarkup } from "../public/jade-piece-view.js";
import { evaluateOrderFit } from "../shared/domain/jade/jade-rules.js";
import { claimWorkshopOutputs } from "./workshop-test-utils.mjs";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";

const catalog = inlayCatalog();
assert.equal(inlaySummary(null), "");
assert.deepEqual(normalizeBangleOrderRequirements(null), []);
assert.deepEqual(catalog.productTypes.bangle, ["bangle"]);
assert.deepEqual(catalog.shapeSettings.bangle, []);
assert.equal(catalog.productTypeNames.bangle, "手镯");
for (const removed of ["beads", "bead", "seal"]) {
  assert.equal(PRODUCT_CATEGORIES[removed], undefined);
  assert.equal(EXTRACTION_KITS[removed], undefined);
}
const player = installOwnedWorkshopFixture(H.makePlayer("bangle-finish-regression"));
H.normalizePlayer(player);
H.state.players.set(player.id, player);
const device = H.workshopDevicesForPlayer(player).find((entry) => entry.stage === "finishing");
let worker = player.workshop.workers.find((entry) => entry.id === device.workerId);
const material = { ...player.rough[0], id: "bangle-qa-source", name: "飘花明料", type: "material", materialStage: "opened",
  qualityKey: "ice", quality: "冰种", color: "飘花绿", value: 30000, price: 30000, rep: 20, score: 4,
  openingSeed: "bangle-stable-seed", visual: { seed: 32198, vein: "#247854", cotton: .65, crack: true } };
const [blank] = H.extractProductsFromJob({ item: material, options: { kits: [{ id: "bangle-cut", type: "bangle", openingTpl: "bangle", x: 50, y: 50, ringSize: 56, rot: 17, scale: 1 }] } });
assert.ok(blank?.jadePiece);
const source = structuredClone(blank);
const plan = createFinishPlanDraft("bangle", catalog, blank);
assert.deepEqual(plan, { process: "bangle", productType: "bangle", refinementId: "standard", polishId: "bright" });
const staleCatalog = { ...catalog, productTypes: { whole: ["handpiece"] } };
const blocked = validateFinishPlanDraft({ shape: "bangle", draft: { ...plan }, catalog: staleCatalog, item: blank });
assert.equal(blocked.canStart, false, "a new bangle form must not submit against a legacy server catalog");
assert.ok(blocked.reasons.some((reason) => reason.includes("服务尚未加载手镯精修规则")));
assert.deepEqual(blocked.stockShortages, [], "the version mismatch is not a missing materials/product selection error");
for (const forged of [ { refinementId: "invented" }, { polishId: "matte" }, { productType: "ring" }, { settingId: "cord" },
  { metalId: "gold18k" }, { gemId: "diamond", gemCount: 5 }, { backingId: "closed" }, { process: "inlay" } ]) {
  assert.equal(canonicalizeFinishPlan(blank, { ...plan, ...forged }).ok, false, JSON.stringify(forged));
}
assert.equal(canonicalizeFinishPlan(blank, { productType: "handpiece", settingId: "cord", polishId: "bright", gemCount: 0 }).ok, false);
assert.deepEqual(canonicalizeFinishPlan(blank, { ...plan, ringSize: 62, jadePiece: { kind: "cabochon" }, fakePrice: 1 }).plan, plan);

const workerCopy = structuredClone(worker);
workerCopy.skills.finish.xiangqian.level = 10;
workerCopy.skills.finish.diaozhuo.level = 10;
assert.equal(bangleStepScore(workerCopy), bangleStepScore(worker), "inlay/carving skills do not determine bangle quality");
workerCopy.skills.cut.damo.level = 10;
assert.ok(bangleStepScore(workerCopy) > bangleStepScore(worker));
const materialPass = (svg) => svg.slice(svg.indexOf('<g class="craft-source-material"'), svg.indexOf('</g></g>', svg.indexOf('<g class="craft-source-material"'))).replace(/finished-\d+/g, "finished-instance");
const originalLayer = materialPass(componentJewelrySvg(blank, "compact", { viewMode: "original" }));
const times = [];
const values = [];
for (const refinementId of Object.keys(BANGLE_REFINEMENTS)) {
  for (const polishId of ["bright", "soft"]) {
    worker = player.workshop.workers.find((entry) => entry.id === device.workerId);
    const draft = { ...plan, refinementId, polishId };
    const validation = validateFinishPlanDraft({ shape: "bangle", draft, catalog, item: blank, itemValue: blank.value, cash: 0, materials: {} });
    assert.equal(validation.canStart, true);
    const quote = quoteFinishPlan(blank, draft);
    assert.deepEqual(validation.quote, quote, "client quote equals server quote");
    assert.equal(quote.laborFee, 0);
    assert.equal(quote.metalAmount, 0);
    assert.equal(quote.gemCount, 0);
    assert.equal(reserveFinishMaterials({}, quote).ok, true, "bangles do not require a materials inventory");
    const preview = buildFinishPreviewProduct(blank, draft);
    assert.deepEqual(preview.components.map((entry) => entry.type), ["jade"]);
    assert.deepEqual(preview.jadePiece, source.jadePiece);
    assert.equal(materialPass(componentJewelrySvg(preview)), originalLayer);
    assert.doesNotMatch(jadePiecePreviewMarkup(blank, preview), /data-jade-hide-mount|取件原貌|查看来源|data-jade-original/);
    assert.match(componentJewelrySvg(preview), new RegExp(`data-jade-polish="${polishId}"`));
    player.bracelets.push(structuredClone(blank));
    const cash = player.cash;
    const materials = structuredClone(player.externalMaterials);
    const estimate = previewBangleFinish(blank, draft, worker, device.attrs);
    const started = H.startWorkshopJobForPlayer(player, device.id, { itemId: blank.id, workerId: worker.id, finishPlan: draft });
    assert.equal(started.ok, true, started.message);
    const restoredJob = JSON.parse(JSON.stringify(publicProductionJob(started.job)));
    assert.deepEqual(restoredJob.finishPlan, draft);
    assert.deepEqual(restoredJob.item.jadePiece, source.jadePiece);
    assert.equal(player.cash, cash);
    assert.deepEqual(player.externalMaterials, materials);
    if (polishId === "bright") times.push(started.job.readyAt - started.job.startedAt);
    player.jobs[player.jobs.indexOf(started.job)] = restoredJob;
    restoredJob.readyAt = Date.now() - 1;
    const random = Math.random;
    try { Math.random = () => .99; H.processProductionJobs(Date.now(), { onlineOnly: false }); }
    finally { Math.random = random; }
    claimWorkshopOutputs(H, player);
    const finished = player.bracelets.find((entry) => entry.id === blank.id);
    assert.equal(finished.materialStage, "finished");
    assert.equal(finished.productType, "bangle");
    assert.equal(finished.inlaid, false);
    assert.equal(finished.inlay, undefined);
    assert.equal(finished.finish.refinementId, refinementId);
    assert.equal(finished.value, estimate.value, `${refinementId}/${polishId}: preview valuation equals actual settlement`);
    assert.equal(finished.craftGrade, estimate.craftGrade);
    assert.deepEqual(finished.jadePiece, source.jadePiece);
    assert.equal(finished.ringSize, 56);
    const summary = inlaySummary(finished);
    assert.match(summary, /手镯 · 56圈口/);
    assert.doesNotMatch(summary, /镶嵌|编绳|把件|金属|配石/);
    for (const saved of [publicStone(finished), publicListing({ item: finished }).item, JSON.parse(JSON.stringify(finished))]) {
      assert.equal(inlaySummary(saved), summary);
      assert.equal(materialPass(componentJewelrySvg(saved)), originalLayer);
    }
    if (polishId === "bright") values.push(quote.valueBonus);
    player.bracelets = player.bracelets.filter((entry) => entry.id !== blank.id);
  }
}
assert.ok(times[0] < times[1] && times[1] < times[2]);
assert.ok(values[0] < values[1] && values[1] <= values[2]);
assert.equal(quoteFinishPlan(blank, { ...plan, polishId: "soft" }).valueBonus, quoteFinishPlan(blank, plan).valueBonus);

// Failure preserves the exact blank and leaves external stock/cash untouched.
device.attrs.risk = 1.6;
worker.flaws = ["易裂", "手重"];
player.bracelets.push(structuredClone(blank));
H.normalizePlayer(player);
const failed = H.startWorkshopJobForPlayer(player, device.id, { itemId: blank.id, finishPlan: plan });
assert.equal(failed.ok, true, failed.message);
const beforeFailure = structuredClone(failed.job.item);
failed.job.readyAt = 0;
const random = Math.random;
try { Math.random = () => 0; H.processProductionJobs(Date.now(), { onlineOnly: false }); }
finally { Math.random = random; }
assert.deepEqual(player.bracelets.find((entry) => entry.id === blank.id), beforeFailure);
assert.deepEqual(blank, source);

const legacy = { ...source, materialStage: "finished", inlaid: true, inlay: { productType: "handpiece", settingId: "cord", polishId: "soft", productTypeName: "把件", settingName: "编绳/配链" }, components: [{ type: "jade", kind: "bracelet" }, { type: "cord", productType: "handpiece" }] };
assert.match(inlaySummary(legacy), /手镯 · 56圈口 · 标准精修 · 柔光/);
assert.doesNotMatch(componentJewelrySvg(legacy), /craft-woven-strand|craft-cord-wrap|craft-drill-rim/);
const legacyJobFinished = applyInlay(structuredClone(legacy), legacy.inlay, { valueBonus: 77 });
assert.equal(legacyJobFinished.value, source.value + 77);
assert.equal(legacyJobFinished.finish.polishId, "soft");
assert.equal(applyInlay(structuredClone(legacy), legacy.inlay, { valueMultiplier: 1.2 }).value, Math.round(source.value * 1.2));

const migrated = normalizeBangleOrderRequirements([{ type: "requireMetal", metalId: "gold18k" }, { type: "requireSetting", settingId: "cord" }]);
assert.deepEqual(migrated.map((entry) => entry.type), ["minCraftScore", "requirePolish"]);
assert.equal(normalizeBangleOrderRequirements([{ type: "requireSetting", settingId: "claw" }])[0].polishId, "bright");
const order = { hard: { kind: "bracelet", budgetUnlimited: true }, requirements: migrated };
const good = { ...source, materialStage: "finished", finish: { refinementId: "standard", polishId: "soft" }, craftScore: 85, craftGrade: "A" };
assert.equal(evaluateOrderFit(good, order).tier, "full");
assert.equal(evaluateOrderFit({ ...good, finish: { polishId: "bright" } }, order).tier, "partial");
for (let i = 0; i < 250; i++) {
  const generated = H.makeOrder(player);
  assert.ok(PRODUCT_CATEGORIES[generated.hard.kind]);
  if (generated.hard.kind === "bracelet") assert.ok(generated.requirements.every((entry) => !["requireMetal", "requireSetting", "requireFineMetal"].includes(entry.type)));
}
for (const file of ["public/features/inventory/inventory-module.js", "public/features/inventory/item-detail-model.js", "public/features/orders/orders-module.js", "public/features/market/market-module.js"]) assert.match(readFileSync(file, "utf8"), /inlaySummary/);
assert.match(readFileSync("public/features/inventory-helpers.js", "utf8"), /inventoryDetailStats/, "inventory details use the shared model after extraction");
console.log("bangle-finish-smoke: 6 real finish workflows, quotes, time/quality, immutable jade, delivery, snapshots, legacy compatibility, failure rollback and order matching ok");
process.exit(0);
