// Extraction, source jade inheritance and product staging.
import { applyCraftValue } from "../../../shared/domain/workshop/workshop-craft-scoring.js";
import { buildOpeningStone, computeGrade as computeOpeningGrade, evaluateOpeningKit, scaleForOpeningKit } from "../../../shared/domain/jade/jade-opening-engine.js";
import { captureExtractedJadePiece } from "../../../shared/domain/workshop/finished-product-design.js";

export function createWorkshopProducts({
  money,
  clamp,
  randomUUID,
  openingTplForKit,
  normalizeExtractionKits,
  expandKitPlacements,
  kitProductMeta,
  scoreRoughPlacement
}) {
function wsApplyWorker(item, bonus, gradeMult, worker) {
    return applyCraftValue(item, bonus, gradeMult, worker, money);
  }

function openingStoneForRough(rough) {
  return buildOpeningStone({
    seed: `${rough.id}:${rough.openingSeed || rough.visual?.openingSeed || rough.visual?.seed || rough.id}`,
    roughId: rough.id,
    qualityKey: rough.qualityKey,
    quality: rough.quality,
    color: rough.color
  });
}

function openingKitForPlacement(placement) {
  const tpl = placement.openingTpl || openingTplForKit(placement, placement.kitType);
  const sizeVal = tpl === "bangle"
    ? (Number(placement.ringSize) || 56)
    : (["S", "M", "L"].includes(placement.size) ? placement.size : "M");
  return {
    uid: placement.kitId || placement.id,
    tpl,
    x: clamp(Number(placement.x) || 50, 4, 96) * 6,
    y: clamp(Number(placement.y) || 50, 4, 96) * 6,
    rot: Number(placement.rot || 0),
    scale: Number(placement.scale || scaleForOpeningKit(tpl, sizeVal)),
    size: sizeVal
  };
}

function extractProductsFromJob(job) {
  const rough = job.item;
  const normalizedKits = normalizeExtractionKits(job.options?.kits || []);
  const placements = expandKitPlacements(normalizedKits);
  const openingStone = openingStoneForRough(rough);
  return placements.map((placement) => {
    const placementScore = scoreRoughPlacement(rough, placement);
    const productMeta = kitProductMeta(placement);
    const openingEval = evaluateOpeningKit(openingKitForPlacement(placement), openingStone);
    const openingGrade = computeOpeningGrade(openingEval, openingStone);
    const openingValue = Math.max(0, Number(openingEval.price) || 0);
    const product = {
      id: randomUUID(),
      type: "bracelet",
      kind: placement.layout,
      name: `${rough.quality}${rough.color}${productMeta.label}`,
      ...(rough.starterOriginId ? { starterOriginId: rough.starterOriginId,
        starterProtection: rough.starterProtection, starterOwnerId: rough.starterOwnerId } : {}),
      qualityKey: rough.qualityKey,
      quality: rough.quality,
      score: rough.score,
      color: rough.color,
      design: productMeta.label,
      ringSize: placement.ringSize,
      size: placement.size,
      value: money(openingValue),
      rep: Math.max(1, Math.round(((Number(rough.rep) || 0) * productMeta.rep * 0.35 + rough.score * 2 + openingGrade.score * 0.08) * clamp(placementScore, 0.72, 1.18))),
      count: productMeta.count,
      sourceRoughId: rough.id,
      plan: placement,
      openingGrade,
      openingEval: {
        price: openingEval.price,
        crackRatio: openingEval.crackRatio,
        wasteRatio: openingEval.wasteRatio,
        avgCv: openingEval.avgCv,
        avgRar: openingEval.avgRar
      },
      sourceMaterial: {
        roughId: rough.id,
        roughName: rough.name,
        visual: structuredClone(rough.visual || {}),
        openingSeed: rough.openingSeed || rough.visual?.openingSeed || rough.visual?.seed || rough.id,
        windows: structuredClone(rough.windows || []),
        placement: structuredClone(placement),
        openingTpl: placement.openingTpl,
        openingGrade,
        templateSize: { w: placement.templateSize?.w, h: placement.templateSize?.h },
        mass: rough.mass,
        qualityKey: rough.qualityKey,
        quality: rough.quality,
        color: rough.color
      },
      placementScore: Math.round(placementScore * 100),
      baseName: `${rough.quality}${rough.color}${productMeta.label}`,
      materialStage: "carved",
      stage: "carved"
    };
    product.jadePiece = captureExtractedJadePiece(product, openingStone, openingKitForPlacement(placement));
    return product;
  });
}

function productBaseName(product) {
  if (product.baseName) return product.baseName;
  return String(product.name || "翡翠成品").replace(/(?:精雕毛坯|抛光半成品|成品|镶嵌成品)$/u, "");
}

function stagedProduct(product, materialStage, suffix, valueMultiplier = 1, extra = {}) {
  const baseName = productBaseName(product);
  return {
    ...product,
    ...extra,
    baseName,
    name: suffix ? `${baseName}${suffix}` : baseName,
    materialStage,
    stage: materialStage,
    value: money(Number(product.value || product.price || 0) * valueMultiplier)
  };
}

  return { wsApplyWorker, openingStoneForRough, openingKitForPlacement, extractProductsFromJob, productBaseName, stagedProduct };
}
