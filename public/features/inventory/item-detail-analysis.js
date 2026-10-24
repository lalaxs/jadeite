import { jadePieceFor } from "../../../shared/domain/jade/jade-piece.js";
import { resolveExactOpeningProductPlacement } from "../../../shared/domain/jade/product-meta.js";
import {
  buildJadeMap,
  evaluateLeftoverMaterial,
  evaluateOpeningKit,
  openingGradeForQuality,
  openingPaletteForColor
} from "../../jade-opening-engine.js";
import {
  openingKitsForRender,
  openingProductKitFor,
  openingStoneFor
} from "../opening/opening-render.js";
import { OPENING_KIT_BY_SERVER_TYPE, OPENING_KIT_TEMPLATE_IDS } from "../opening/opening-state.js";

const ANALYSIS_NOTE = "裂纹覆盖按玉肉上的裂纹影响区统计，占当前料面的比例。";

function emptyReport(status, note, kind = "jade") {
  return { kind, status, grades: [], colors: [], crackPercent: null, wastePercent: null, note };
}

function percentage(value) {
  if (value == null || value === "") return null;
  const ratio = Number(value);
  return Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio * 100 : null;
}

function qualityName(item) {
  const quality = typeof item.quality === "object" ? item.quality?.name : item.quality;
  return quality || item.qualityName || openingGradeForQuality(item.qualityKey)?.name || "";
}

function colorName(item) {
  return typeof item.color === "object" ? item.color?.name || "" : item.color || "";
}

// Actual sample counts, rounded together, keep color shares at exactly 100.0%.
function colorShares(stone, evaluation) {
  if (!evaluation.total) return [];
  const values = [
    ...stone.palList.map(({ pal }, index) => ({ name: pal.name, color: pal.base, count: evaluation.catCounts[index] || 0 })),
    { name: "废料", color: "#817767", count: evaluation.wasteCount }
  ].filter(({ count }) => count > 0).map((row) => {
    const units = row.count / evaluation.total * 1000;
    return { ...row, units: Math.floor(units), remainder: units % 1 };
  });
  const missing = 1000 - values.reduce((sum, row) => sum + row.units, 0);
  const ranked = [...values].sort((left, right) => right.remainder - left.remainder);
  for (let i = 0; i < missing; i++) ranked[i].units += 1;
  return values.map(({ name, color, units }) => ({ name, color, percent: units / 10 }));
}

function evaluatedReport(stone, evaluation, crackPercent = percentage(evaluation.crackRatio)) {
  if (!evaluation.total) return emptyReport("unavailable", "暂无可分析的料面。");
  return {
    kind: "jade",
    status: "revealed",
    hasUsableJade: evaluation.goodN > 0,
    grades: evaluation.goodN ? [{ name: stone.grade.name, percent: 100 }] : [],
    colors: colorShares(stone, evaluation),
    crackPercent,
    wastePercent: percentage(evaluation.wasteRatio),
    note: ANALYSIS_NOTE
  };
}

function recordedReport(item, piece) {
  const intrinsic = piece?.intrinsic || item;
  const quality = qualityName(intrinsic);
  const color = colorName(intrinsic);
  const evaluation = intrinsic.openingEval || item.openingEval || {};
  const report = emptyReport("unavailable", "部分料质占比尚无记录。");
  if (quality) report.grades.push({ name: quality, percent: null });
  if (color) report.colors.push({ name: color, color: openingPaletteForColor(color)?.base || null, percent: null });
  report.crackPercent = percentage(evaluation.crackRatio);
  report.wastePercent = percentage(evaluation.wasteRatio);
  if (quality || color || report.crackPercent != null || report.wastePercent != null) report.status = "revealed";
  return report;
}

function frozenPieceReport(item, piece) {
  const material = piece.material;
  const { palList, grade, seeds } = material;
  const kit = piece.kit;
  if (!Array.isArray(palList) || !palList.length || !palList.every(({ pal }) => pal?.name && pal?.base)
    || !grade?.name || !seeds || !["zoneA", "zoneB", "waste"].every((key) => Number.isFinite(seeds[key]))
    || typeof material.material !== "string" || !OPENING_KIT_TEMPLATE_IDS.has(kit?.tpl)
    || ![kit.x, kit.y, kit.scale].every(Number.isFinite) || kit.scale <= 0) return null;

  // The frozen piece saves its original palette and noise seeds. Rebuild those
  // cells, never a new stone based on a finished item's (changeable) id/color.
  // Cracks are not saved as polylines; their recorded extraction ratio is used
  // separately instead of inventing a zero-crack result from this color map.
  const withWaste = material.material.includes('fill="#5c5648"');
  const stone = { ...material, jadeMap: buildJadeMap(palList, grade, withWaste, [], seeds) };
  const evaluation = evaluateOpeningKit(kit, stone);
  const savedEvaluation = piece.intrinsic?.openingEval || item.openingEval || {};
  return evaluatedReport(stone, evaluation, percentage(savedEvaluation.crackRatio));
}

function sourcePieceReport(entry, item) {
  const jade = item.components?.find((component) => component?.type === "jade");
  const source = jade?.sourceMaterial || item.sourceMaterial;
  if (!source) return null;
  // Serialized legacy sources omit the authoritative opening seed. A visual
  // seed alone may describe a different material, so only client-side planned
  // entries (which still hold the parent metadata) can use that fallback.
  if (source.openingSeed == null && source.visual?.openingSeed == null
    && !(entry.isPlanned && source.visual?.seed != null)) return null;
  const placement = resolveExactOpeningProductPlacement(source, {
    validTemplateIds: OPENING_KIT_TEMPLATE_IDS,
    templateByKitType: OPENING_KIT_BY_SERVER_TYPE
  });
  if (!placement) return null;
  const original = {
    id: source.roughId || item.sourceRoughId,
    name: source.roughName,
    openingSeed: source.openingSeed,
    visual: source.visual,
    qualityKey: source.qualityKey || item.qualityKey,
    quality: source.quality || item.quality,
    color: source.color || item.color
  };
  if (!original.id) return null;
  const stone = openingStoneFor(original);
  return evaluatedReport(stone, evaluateOpeningKit(openingProductKitFor(item, placement), stone));
}

function wholeMaterialReport(item) {
  if (!item.id && !item.name) return null;
  const rawKits = item.extractionKits || item.braceletPlacements || [];
  if (!Array.isArray(rawKits)) return null;
  for (const kit of rawKits) {
    if (!kit) return null;
    const template = kit.tpl || kit.openingTpl || OPENING_KIT_BY_SERVER_TYPE[kit.type];
    if (!OPENING_KIT_TEMPLATE_IDS.has(template)) return null;
  }
  // The preview also recovers already extracted cuts from finished/in-flight
  // products in legacy saves. Keep exactly those masks, excluding draft kits.
  const kits = openingKitsForRender(item).filter((kit) => kit.extracted);
  const stone = openingStoneFor(item);
  return evaluatedReport(stone, evaluateLeftoverMaterial(kits, stone, { withinStone: true }));
}

export function inventoryDetailAnalysis(entry = {}) {
  const item = entry.item || {};
  if (entry.category === "external" || entry.source === "externalMaterials") {
    return emptyReport("unavailable", "种水及料面分析不适用于镶嵌材料。", "external");
  }
  const stage = entry.stage || item.materialStage || item.stage;
  const rough = stage === "rough" || ((!stage || stage === "unknown") && (item.type === "rough" || entry.source === "rough"));
  const masked = item.visual?.masked === true;
  const fullyRevealed = !masked && (item.revealed === true || item.polished === true || (stage && !["rough", "unknown"].includes(stage)));
  if ((rough && !fullyRevealed) || masked) {
    const hasWindow = Boolean(item.windows?.length || item.visual?.windows?.length);
    return emptyReport(hasWindow ? "partial" : "hidden", hasWindow
      ? "开窗仅揭露局部皮壳线索，内部种水、颜色占比及裂纹尚未揭露。"
      : "暗料未揭露，种水、内部颜色、裂纹及废料占比暂不可见。");
  }
  const piece = jadePieceFor(item);
  if (piece) return frozenPieceReport(item, piece) || recordedReport(item, piece);
  const source = item.components?.find((component) => component?.type === "jade")?.sourceMaterial || item.sourceMaterial;
  if (source?.visual?.masked) {
    return emptyReport("hidden", "来源暗料尚未揭露，暂无法查看内部料质。");
  }
  const type = item.type || item._type;
  const isMaterial = ["rough", "material", "slice"].includes(type)
    || ["rough", "materials", "slices"].includes(entry.source);
  if (isMaterial && !entry.isPlanned && !item._planned) return wholeMaterialReport(item) || recordedReport(item);
  return sourcePieceReport(entry, item) || recordedReport(item);
}
