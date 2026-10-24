import assert from "node:assert/strict";
import { inventoryDetailAnalysis } from "../public/features/inventory/item-detail-analysis.js";
import { inventoryItemDetailHtml } from "../public/features/inventory/item-detail-view.js";
import { inventoryDetailStats } from "../public/features/inventory/item-detail-model.js";
import { deliveryMaterialAnalysis } from "../public/features/workshop/delivery-material-analysis.js";
import { bindOpeningRenderDeps, openingKitsForRender, openingStoneFor, openingProductKitFor } from "../public/features/opening/opening-render.js";
import { roughKits } from "../public/features/opening/opening-state.js";
import { evaluateLeftoverMaterial, evaluateOpeningKit, buildOpeningStone, scaleForOpeningKit } from "../shared/domain/jade/jade-opening-engine.js";
import { captureJadePiece } from "../shared/domain/jade/jade-piece.js";
import { publicStone } from "../server/services/snapshot-public.js";

const hidden = {
  id: "hidden-analysis", name: "暗料", type: "rough", materialStage: "rough", revealed: false,
  qualityKey: "glass", quality: "玻璃种", color: "帝王绿", trueQualityKey: "glass",
  openingEval: { crackRatio: .6, wasteRatio: .8 }, visual: { seed: 97531 }
};
for (const [item, stage, status] of [
  [hidden, "rough", "hidden"],
  [hidden, "unknown", "hidden"],
  [{ ...hidden, windows: [{ x: 50, y: 50, hasCrack: true }] }, "rough", "partial"],
  [publicStone({ ...hidden, windows: [{ x: 50, y: 50, hasCrack: true }] }), "rough", "partial"]
]) {
  const report = inventoryDetailAnalysis({ item, stage, source: "rough" });
  assert.equal(report.status, status);
  assert.deepEqual(report.grades, []);
  assert.deepEqual(report.colors, []);
  assert.equal(report.crackPercent, null);
  assert.equal(report.wastePercent, null);
  assert.doesNotMatch(JSON.stringify(report), /玻璃种|帝王绿|60|80/, "hidden local metadata never leaks through a window");
}

const material = {
  id: "detail-actual-material", name: "真实明料", type: "material", materialStage: "opened", revealed: true,
  qualityKey: "ice", quality: "冰种", color: "晴水", openingSeed: "actual-authoritative-seed", visual: { seed: 97531 }
};
const original = structuredClone(material);
const whole = inventoryDetailAnalysis({ item: material, stage: "opened", source: "materials" });
const expectedWhole = deliveryMaterialAnalysis(material);
assert.equal(whole.status, "revealed");
assert.deepEqual(whole.grades, expectedWhole.grades);
assert.deepEqual(whole.colors, expectedWhole.colors.map(({ name, color, percent }) => ({ name, color, percent })));
assert.equal(whole.crackPercent, expectedWhole.crackPercent);
assert.equal(whole.wastePercent, expectedWhole.wastePercent);
assert.equal(Math.round(whole.colors.reduce((sum, row) => sum + row.percent, 0) * 10), 1000);
assert.deepEqual(material, original, "inspection does not mutate the material");

const extraction = { id: "removed-egg", type: "cabochon", openingTpl: "egg", x: 45, y: 50, rot: 31, size: "L", scale: scaleForOpeningKit("egg", "L") };
const leftover = { ...material, leftover: true, leftoverGeometryVersion: 2, extractionKits: [extraction] };
const stone = openingStoneFor(material);
const leftoverEvaluation = evaluateLeftoverMaterial(openingKitsForRender(leftover).filter((kit) => kit.extracted), stone, { withinStone: true });
const remaining = inventoryDetailAnalysis({ item: leftover, stage: "opened", source: "materials" });
assert.ok(leftoverEvaluation.total < expectedWhole.total, "the extracted cut is excluded from the remaining material");
assert.equal(remaining.wastePercent, leftoverEvaluation.wasteRatio * 100);
assert.equal(remaining.crackPercent, leftoverEvaluation.crackRatio * 100);
assert.equal(Math.round(remaining.colors.reduce((sum, row) => sum + row.percent, 0) * 10), 1000);

// Legacy parents may lack extractionKits even though the item preview recovers
// their holes from finished products and products currently inside jobs.
const recoveredPlacement = { id: "recovered-cut", openingTpl: "egg", x: 35, y: 50, rot: 17, size: "M", scale: scaleForOpeningKit("egg", "M") };
const recoveredProduct = { id: "already-extracted", kind: "cabochon", sourceMaterial: { roughId: material.id, placement: recoveredPlacement } };
const inFlightPlacement = { ...recoveredPlacement, id: "in-flight-cut", x: 65 };
const analysisState = { me: { bracelets: [recoveredProduct], jobs: [{ item: { ...recoveredProduct, id: "in-flight-product", sourceMaterial: { roughId: material.id, placement: inFlightPlacement } } }] } };
bindOpeningRenderDeps({ getState: () => analysisState });
roughKits.set(material.id, [{ id: "unextracted-draft", tpl: "rect", x: 300, y: 100, scale: 1, size: "M" }]);
const recoveredKits = openingKitsForRender(material);
assert.equal(recoveredKits.filter((kit) => kit.extracted).length, 2);
assert.equal(recoveredKits.filter((kit) => !kit.extracted).length, 1);
const recoveredEvaluation = evaluateLeftoverMaterial(recoveredKits.filter((kit) => kit.extracted), stone, { withinStone: true });
const recovered = inventoryDetailAnalysis({ item: material, stage: "opened", source: "materials" });
assert.equal(recovered.crackPercent, recoveredEvaluation.crackRatio * 100);
assert.equal(recovered.wastePercent, recoveredEvaluation.wasteRatio * 100);
roughKits.set(material.id, []);
assert.deepEqual(inventoryDetailAnalysis({ item: material, stage: "opened", source: "materials" }), recovered, "unextracted draft kits do not affect true inventory area statistics");
bindOpeningRenderDeps({ getState: () => null });
roughKits.delete(material.id);

const kit = { id: "actual-cut", tpl: "egg", x: 180, y: 240, rot: 27, scale: scaleForOpeningKit("egg", "M"), size: "M" };
const cutEvaluation = evaluateOpeningKit(kit, stone);
const product = {
  id: "finished-id-is-not-a-material-seed", name: "取件成品", type: "bracelet", materialStage: "finished",
  qualityKey: material.qualityKey, quality: material.quality, color: material.color,
  openingEval: { crackRatio: cutEvaluation.crackRatio, wasteRatio: cutEvaluation.wasteRatio },
  sourceMaterial: { roughId: material.id, roughName: material.name, openingSeed: material.openingSeed, visual: material.visual, qualityKey: material.qualityKey, quality: material.quality, color: material.color }
};
product.jadePiece = captureJadePiece(product, stone, kit, { width: 20, height: 24 });
const frozen = inventoryDetailAnalysis({ item: product, stage: "finished", source: "bracelets" });
assert.equal(frozen.crackPercent, cutEvaluation.crackRatio * 100);
assert.equal(frozen.wastePercent, cutEvaluation.wasteRatio * 100);
assert.deepEqual(frozen.grades, cutEvaluation.goodN ? [{ name: stone.grade.name, percent: 100 }] : []);
assert.equal(Math.round(frozen.colors.reduce((sum, row) => sum + row.percent, 0) * 10), 1000);
const independent = structuredClone(product);
independent.id = "renamed-product";
independent.color = "紫罗兰";
delete independent.sourceMaterial;
assert.deepEqual(inventoryDetailAnalysis({ item: independent, stage: "finished" }), frozen, "the original frozen material survives id/color/parent changes");
const missingCrack = structuredClone(independent);
delete missingCrack.jadePiece.intrinsic.openingEval;
delete missingCrack.openingEval;
assert.equal(inventoryDetailAnalysis({ item: missingCrack, stage: "finished" }).crackPercent, null, "an absent saved crack measurement never becomes zero");

const sourceProduct = structuredClone(product);
delete sourceProduct.jadePiece;
sourceProduct.sourceMaterial.placement = { openingTpl: kit.tpl, x: kit.x, y: kit.y, rot: kit.rot, scale: kit.scale, size: kit.size, svgSpace: true };
const fromSource = inventoryDetailAnalysis({ item: sourceProduct, stage: "finished" });
const sourceEvaluation = evaluateOpeningKit(openingProductKitFor(sourceProduct, sourceProduct.sourceMaterial.placement), stone);
assert.equal(fromSource.wastePercent, sourceEvaluation.wasteRatio * 100);
assert.equal(fromSource.crackPercent, sourceEvaluation.crackRatio * 100);
assert.deepEqual(fromSource.colors, frozen.colors, "a preserved authoritative source analyzes the same original cut");
const serializedLegacy = publicStone(sourceProduct);
assert.equal(serializedLegacy.sourceMaterial.openingSeed, undefined);
const legacy = inventoryDetailAnalysis({ item: serializedLegacy, stage: "finished" });
assert.equal(legacy.grades[0].percent, null);
assert.equal(legacy.colors[0].percent, null, "an ambiguous legacy source never generates guessed area shares");
assert.equal(legacy.crackPercent, sourceProduct.openingEval.crackRatio * 100);
assert.equal(legacy.wastePercent, sourceProduct.openingEval.wasteRatio * 100);

const zero = inventoryDetailAnalysis({ item: { type: "bracelet", quality: "冰种", color: "晴水", openingEval: { crackRatio: 0, wasteRatio: 0 } }, stage: "finished" });
assert.equal(zero.crackPercent, 0);
assert.equal(zero.wastePercent, 0);
assert.equal(inventoryDetailAnalysis({ item: {}, category: "external" }).kind, "external");
assert.equal(inventoryDetailAnalysis({ item: {}, category: "external" }).wastePercent, null);
assert.equal(inventoryDetailAnalysis({ item: {} }).status, "unavailable");
const maskedComponent = inventoryDetailAnalysis({ item: { type: "bracelet", materialStage: "finished", quality: "玻璃种", color: "帝王绿", components: [{ type: "jade", sourceMaterial: { visual: { masked: true } } }] }, stage: "finished" });
assert.equal(maskedComponent.status, "hidden");
assert.deepEqual(maskedComponent.grades, []);
assert.deepEqual(maskedComponent.colors, []);

// The frozen map must also handle snapshots that genuinely contain no waste.
const cleanStone = buildOpeningStone({ seed: "clean-detail-piece", qualityKey: "ice", color: "白冰", withWaste: false });
const cleanEvaluation = evaluateOpeningKit(kit, cleanStone);
const cleanProduct = { ...product, openingEval: { crackRatio: cleanEvaluation.crackRatio, wasteRatio: cleanEvaluation.wasteRatio } };
cleanProduct.jadePiece = captureJadePiece(cleanProduct, cleanStone, kit, { width: 20, height: 24 });
const clean = inventoryDetailAnalysis({ item: cleanProduct, stage: "finished" });
assert.equal(clean.wastePercent, 0);
assert.equal(clean.colors.some(({ name }) => name === "废料"), false);

const colorOnly = { name: "旧成品", type: "bracelet", materialStage: "finished", color: "晴水" };
const colorOnlyHtml = inventoryItemDetailHtml({ item: colorOnly, name: colorOnly.name, stage: "finished" });
assert.match(colorOnlyHtml, /暂无种水记录/);
assert.doesNotMatch(colorOnlyHtml, /未检出可用玉肉/, "missing historical grade data must not claim that the piece has no jade");

function detailRegions(html) {
  const layoutStart = html.search(/class="inventory-detail-layout(?:\s|")/);
  const rightStart = html.search(/class="inventory-detail-content(?:\s|")/);
  const footerStart = html.search(/class="inventory-detail-footer(?:\s|")/);
  assert.ok(layoutStart > 0 && rightStart > layoutStart, "prices span the full width before two balanced content columns");
  return { summary: html.slice(0, layoutStart), overview: html.slice(layoutStart, rightStart),
    content: html.slice(rightStart, footerStart < 0 ? html.length : footerStart), footer: footerStart < 0 ? "" : html.slice(footerStart) };
}

const costedItem = {
  ...material, hint: "白雾皮壳 · 轮廓饱满",
  costBasis: { amount: 9000, complete: true, componentsComplete: true,
    components: { acquisition: 6000, processing: 2500, materials: 500 } }
};
const costedEntry = { item: costedItem, name: costedItem.name, category: "stage", categoryLabel: "明料",
  stage: "opened", stageLabel: "明料", source: "materials", totalValue: 12500 };
const costedHtml = inventoryItemDetailHtml(costedEntry, {
  previewHtml: "<svg></svg>", stats: inventoryDetailStats(costedEntry), lines: ["已开料，可在工坊继续加工。"]
});
const costedRegions = detailRegions(costedHtml);
assert.match(costedRegions.overview, /物品概况/);
assert.match(costedRegions.overview, /阶段<\/dt><dd>明料/);
assert.match(costedRegions.overview, /白雾皮壳 · 轮廓饱满/);
assert.doesNotMatch(costedRegions.overview, /已记货品成本|购入分摊|直接加工|镶嵌材料|¥12,500/,
  "value and accounting no longer extend the image column");
for (const [label, value] of [["估值", "12,500"], ["已记货品成本", "9,000"],
  ["购入分摊", "6,000"], ["直接加工", "2,500"], ["镶嵌材料", "500"]]) {
  assert.match(costedRegions.summary, new RegExp(`${label}</dt><dd[^>]*>¥${value}`),
    "the value summary preserves each independent cost amount");
}
assert.match(costedRegions.content, /料质详情/);
assert.match(costedRegions.summary, /<details class="inventory-detail-costs"><summary>成本明细<\/summary>/,
  "complete accounting remains available behind the compact price summary");
assert.doesNotMatch(costedRegions.content, /玉料种水/, "the analysis does not repeat an already represented grade");
assert.match(costedHtml, /已开料，可在工坊继续加工。/, "existing processing guidance is retained");

const hiddenHtml = inventoryItemDetailHtml({ item: hidden, name: hidden.name, stage: "rough", source: "rough" }, {
  stats: [{ label: "玉料种水", value: "玻璃种" }, { label: "花色", value: "帝王绿" }]
});
assert.match(hiddenHtml, /内部料质未揭露，开窗或开料后可查看。/);
assert.doesNotMatch(hiddenHtml, /玻璃种|帝王绿|颜色分布|裂纹覆盖|废料占比/,
  "an unseen interior is explained once rather than shown as four empty measurements");
const partialHtml = inventoryItemDetailHtml({ item: hidden, name: hidden.name, stage: "rough", source: "rough" }, {
  analysis: { kind: "jade", status: "partial", grades: [{ name: "冰种", percent: null }],
    colors: [{ name: "晴水", color: "#9abbab", percent: null }],
    crackPercent: null, wastePercent: null, note: "仅为开窗处记录，完整料质待开料确认。" }
});
assert.match(partialHtml, /data-analysis-status="partial"/);
assert.match(partialHtml, /冰种/);
assert.match(partialHtml, /晴水/);
assert.match(partialHtml, /仅为开窗处记录，完整料质待开料确认。/);
assert.doesNotMatch(partialHtml, /裂纹覆盖|废料占比|玻璃种|帝王绿/,
  "a window retains its measured data without adding unknown fields or exposing the interior");

const externalEntry = { item: {}, name: "18K金", category: "external", stageLabel: "贵金属",
  categoryLabel: "镶嵌材料", quantity: 5, unitLabel: "克", unitPrice: 380, totalValue: 1900 };
const externalHtml = inventoryItemDetailHtml(externalEntry, { stats: inventoryDetailStats(externalEntry) });
const externalRegions = detailRegions(externalHtml);
assert.match(externalRegions.overview, /持有<\/dt><dd>5克/);
assert.match(externalRegions.summary, /总价值<\/dt><dd[^>]*>¥1,900/);
assert.match(externalRegions.content, /单价<\/dt><dd>¥380 \/ 克/);
assert.doesNotMatch(externalRegions.content, /种水分布|裂纹覆盖|废料占比/);

console.log("inventory-detail-analysis: true maps, frozen pieces, privacy, compact hidden analysis and grouped value/cost/material details ok");
