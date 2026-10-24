/**
 * Workshop planning helpers — kit normalize, overlap, placement score, polish reveal.
 * Pure relative to injected clamp/money/qualityByKey/randomUUID.
 */
import {
  EXTRACTION_KITS,
  isSmallPieceKind,
  kitLayout,
  placementRadiusForKind,
  productMetaForKind
} from "../../shared/domain/jade/jade-categories.js";
import {
  computeOverlaps,
  scaleForOpeningKit
} from "../../shared/domain/jade/jade-opening-engine.js";
import { rollQualityColor } from "./rough-pool-service.js";

export const OPENING_KIT_SERVER_TYPES = {
  egg: "cabochon",
  ping: "peacePendant",
  rect: "plaque",
  drop: "dropPendant",
  leaf: "leafPendant",
  bangle: "bangle",
  buddha: "buddhaPendant"
};

export const OPENING_KIT_BY_SERVER_TYPE = Object.fromEntries(
  Object.entries(OPENING_KIT_SERVER_TYPES).map(([tpl, type]) => [type, tpl])
);

const BANGLE_RING_SIZES = new Set([52, 54, 56, 58, 60, 62]);
const PENDANT_SIZES = new Set(["S", "M", "L"]);

function kitIntentFailure(message) {
  return { ok: false, code: "INVALID_PLANNING", message };
}

/**
 * Convert an untrusted client planning request into the only kit shape that
 * production and valuation code may consume. The client chooses a supported
 * kit type, position, rotation and size; template and scale are server-owned.
 */
export function canonicalizeExtractionKitIntents(rawKits, options = {}) {
  if (!Array.isArray(rawKits)) {
    return kitIntentFailure("套件规划格式无效。");
  }
  const maxKits = Math.max(0, Math.min(10, Number(options.maxKits ?? 10)));
  if (rawKits.length > maxKits) {
    return kitIntentFailure(`本次最多还能安排 ${maxKits} 件套件。`);
  }
  const makeId = typeof options.makeId === "function" ? options.makeId : null;
  const requireIds = options.requireIds === true;
  const seenIds = new Set();
  const kits = [];

  for (const raw of rawKits) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return kitIntentFailure("套件规划中含有无效条目。");
    }
    const type = typeof raw.type === "string" ? raw.type : "";
    const openingTpl = OPENING_KIT_BY_SERVER_TYPE[type];
    if (!EXTRACTION_KITS[type] || !openingTpl) {
      return kitIntentFailure("套件类型无效。");
    }
    if (
      raw.openingTpl != null
      && raw.openingTpl !== ""
      && String(raw.openingTpl) !== openingTpl
    ) {
      return kitIntentFailure("套件类型与开料模板不匹配。");
    }

    const suppliedId = typeof raw.id === "string" ? raw.id.trim() : "";
    if (requireIds && !suppliedId) {
      return kitIntentFailure("套件缺少有效编号。");
    }
    const id = suppliedId || String(makeId?.() || "");
    if (!id || id.length > 64 || !/^[A-Za-z0-9:_-]+$/.test(id)) {
      return kitIntentFailure("套件编号无效。");
    }
    if (seenIds.has(id)) {
      return kitIntentFailure("同一规划中不能重复使用套件编号。");
    }
    seenIds.add(id);

    const x = raw.x == null ? 50 : Number(raw.x);
    const y = raw.y == null ? 50 : Number(raw.y);
    const rot = raw.rot == null && raw.rotation == null
      ? 0
      : Number(raw.rot ?? raw.rotation);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(rot)) {
      return kitIntentFailure("套件位置或角度无效。");
    }
    if (x < 4 || x > 96 || y < 4 || y > 96) {
      return kitIntentFailure("套件位置超出可规划范围。");
    }

    const isBangle = type === "bangle";
    let size;
    let ringSize;
    if (isBangle) {
      ringSize = raw.ringSize == null ? 56 : Number(raw.ringSize);
      if (!Number.isInteger(ringSize) || !BANGLE_RING_SIZES.has(ringSize)) {
        return kitIntentFailure("手镯圈口无效。");
      }
    } else {
      size = raw.size == null ? "M" : String(raw.size);
      if (!PENDANT_SIZES.has(size)) {
        return kitIntentFailure("挂件尺寸无效。");
      }
    }

    const sizeValue = isBangle ? ringSize : size;
    kits.push({
      id,
      type,
      openingTpl,
      x,
      y,
      rot: Math.round(((rot % 180) + 180) % 180),
      scale: scaleForOpeningKit(openingTpl, sizeValue),
      size,
      ringSize
    });
  }

  return { ok: true, kits };
}

export function createWorkshopPlanning({ clamp, money, qualityByKey, randomUUID }) {
  function normalizeAngle(value) {
    const angle = Number(value);
    if (!Number.isFinite(angle)) return 0;
    return Math.round(((angle % 180) + 180) % 180);
  }

  function angleDistance(a, b) {
    const diff = Math.abs(normalizeAngle(a) - normalizeAngle(b));
    return Math.min(diff, 180 - diff);
  }

  function cutAngleName(angle) {
    return `${normalizeAngle(angle)}度刀线`;
  }

  function makeSliceBoard(material, index, count) {
    const score = material.score;
    const visual = material.visual || {};
    const seed = Number(visual.seed || 1000) + index * 97;
    const widthBias = material.mass > 1.4 ? 0 : index % 2 === 0 ? -8 : 7;
    const outlinePath = index % 3 === 0
      ? `M12 ${22 + widthBias / 2} C26 8 62 7 112 18 C133 24 139 50 130 74 C118 97 65 96 28 84 C10 78 3 43 12 ${22 + widthBias / 2} Z`
      : index % 3 === 1
        ? `M18 18 C50 5 102 10 127 28 C143 40 134 79 110 91 C75 103 28 88 13 66 C2 49 3 26 18 18 Z`
        : `M10 30 C24 10 74 4 116 18 C139 26 145 61 125 82 C101 103 55 97 25 83 C8 74 -1 48 10 30 Z`;
    const beltAngle = normalizeAngle(visual.beltAngle || material.cutAngle || 18);
    const beltOffset = ((index - (count - 1) / 2) * 14);
    const colorZones = Array.from({ length: Math.max(1, score - 1) }, (_, zoneIndex) => ({
      cx: clamp(72 + beltOffset + zoneIndex * 12 - score * 3, 20, 124),
      cy: clamp(48 + ((seed + zoneIndex * 17) % 25) - 12, 18, 78),
      rx: 18 + score * 4 + zoneIndex * 3,
      ry: 8 + score * 2,
      angle: beltAngle,
      opacity: clamp(0.22 + score * 0.09, 0.24, 0.76)
    }));
    const flaws = visual.crack ? Array.from({ length: Math.max(1, 4 - Math.floor(score / 2)) }, (_, flawIndex) => ({
      x: clamp(72 + beltOffset + ((seed + flawIndex * 29) % 36) - 18, 18, 126),
      y: 18 + ((seed + flawIndex * 23) % 56),
      len: 12 + ((seed + flawIndex * 11) % 18),
      angle: normalizeAngle((visual.crackAngle || 96) + flawIndex * 11)
    })) : [];
    const clarity = clamp(score * 18 + (seed % 18), 18, 96);
    const dirtySpots = Array.from({ length: Math.max(0, 5 - score) }, (_, spotIndex) => ({
      x: 14 + ((seed + spotIndex * 37) % 112),
      y: 14 + ((seed + spotIndex * 41) % 66),
      r: 1.2 + ((seed + spotIndex * 7) % 24) / 10,
      opacity: clamp(0.08 + (5 - score) * 0.025, 0.08, 0.2)
    }));
    const cottonThreads = Array.from({ length: Math.max(4, 18 - score * 2) }, (_, threadIndex) => ({
      x: 8 + ((seed + threadIndex * 17) % 120),
      y: 10 + ((seed + threadIndex * 13) % 70),
      len: 12 + ((seed + threadIndex * 9) % 28),
      angle: normalizeAngle((visual.beltAngle || 18) + threadIndex * 7)
    }));
    return {
      outlinePath,
      flaws,
      colorZones,
      baseColor: visual.vein || "#65a985",
      groundColor: score >= 5 ? "#d9fff0" : score >= 4 ? "#c6eadf" : "#d7ddd0",
      grainAngle: normalizeAngle((material.cutAngle || beltAngle || 20) + index * 4),
      sourceSeed: visual.seed,
      sourceBeltAngle: beltAngle,
      sourceCrackAngle: visual.crackAngle,
      sourceShape: visual.shape,
      sliceIndex: index,
      sliceCount: count,
      cleanScore: clarity,
      clarity,
      water: clamp(score * 0.18 + Math.random() * 0.16, 0.16, 0.96),
      dirtySpots,
      cottonThreads
    };
  }

  function normalizePlan(rawPlan, layout) {
    const plan = rawPlan && typeof rawPlan === "object" ? rawPlan : {};
    return {
      layout,
      x: clamp(Number(plan.x) || 50, 18, 82),
      y: clamp(Number(plan.y) || 50, 18, 82),
      scale: clamp(Number(plan.scale) || 82, 45, 128),
      rotation: normalizeAngle(plan.rotation || 0)
    };
  }

  function placementRadius(placement) {
    return placementRadiusForKind(placement.layout || placement.kind || "bracelet", placement);
  }

  const KIT_BOARD_REFERENCE = { width: 412, height: 148 };

  function templateWidthOnBoard(width) {
    return (Number(width) || 28) * KIT_BOARD_REFERENCE.height / KIT_BOARD_REFERENCE.width;
  }

  function normalizePlacement(rawPlacement, fallbackLayout = "bracelet") {
    const placement = rawPlacement && typeof rawPlacement === "object" ? rawPlacement : {};
    const allowedLayouts = new Set(Object.values(EXTRACTION_KITS).flatMap((kit) => kit.slots.map((slot) => slot.layout)));
    const layout = allowedLayouts.has(placement.layout) ? placement.layout : fallbackLayout;
    const ringSize = clamp(Number(placement.ringSize) || 56, 52, 62);
    const normalized = {
      id: typeof placement.id === "string" ? placement.id.slice(0, 36) : randomUUID(),
      layout,
      x: clamp(Number(placement.x) || 50, 12, 88),
      y: clamp(Number(placement.y) || 50, 12, 88),
      ringSize: layout === "bracelet" ? Math.round(ringSize / 2) * 2 : undefined
    };
    normalized.radius = placementRadius(normalized);
    return normalized;
  }

  function normalizePlacements(rawPlacements, fallbackLayout, fallbackPlan) {
    const source = Array.isArray(rawPlacements) && rawPlacements.length
      ? rawPlacements
      : [{ ...(fallbackPlan || {}), layout: fallbackLayout || fallbackPlan?.layout || "bracelet" }];
    return source.slice(0, 8).map((placement) => normalizePlacement(placement, fallbackLayout || "bracelet"));
  }

  function openingTplForKit(kit, type) {
    if (kit?.openingTpl && OPENING_KIT_SERVER_TYPES[kit.openingTpl]) return kit.openingTpl;
    return OPENING_KIT_BY_SERVER_TYPE[type] || "ping";
  }

  /** 把服务端百分比套件转成与规划预览相同的开料坐标系，供 computeOverlaps 使用 */
  function openingKitFromExtractionKit(kit) {
    const type = EXTRACTION_KITS[kit?.type] ? kit.type : "bangle";
    const tpl = openingTplForKit(kit, type);
    const sizeVal = tpl === "bangle"
      ? (Number(kit?.ringSize) || 56)
      : (["S", "M", "L"].includes(kit?.size) ? kit.size : "M");
    const fallbackScale = scaleForOpeningKit(tpl, sizeVal);
    const scale = Number(kit?.scale) > 0 ? Number(kit.scale) : fallbackScale;
    return {
      uid: kit?.id || randomUUID(),
      id: kit?.id,
      tpl,
      x: Number(kit?.x || 50) * 6,
      y: Number(kit?.y || 50) * 6,
      rot: Number(kit?.rot || 0),
      scale,
      size: sizeVal
    };
  }

  /** 与规划界面红框同一套形状采样；有重叠返—true */
  function extractionKitsOverlap(rawKits) {
    const kits = Array.isArray(rawKits) ? rawKits.filter(Boolean) : [];
    if (kits.length < 2) return false;
    return computeOverlaps(kits.map(openingKitFromExtractionKit)).size > 0;
  }

  function normalizeExtractionKits(rawKits, { maxScale = 1.45 } = {}) {
    const source = Array.isArray(rawKits) ? rawKits : [];
    return source.slice(0, 10).map((kit) => {
      const type = EXTRACTION_KITS[kit?.type] ? kit.type : "bangle";
      const openingTpl = openingTplForKit(kit, type);
      const isBangle = type === "bangle" || openingTpl === "bangle";
      const ringSize = clamp(Number(kit?.ringSize) || 56, 52, 62);
      const size = isBangle
        ? Math.round(ringSize / 2) * 2
        : (["S", "M", "L"].includes(kit?.size) ? kit.size : "M");
      const fallbackScale = scaleForOpeningKit(openingTpl, size);
      return {
        id: typeof kit?.id === "string" ? kit.id.slice(0, 36) : randomUUID(),
        type,
        openingTpl,
        x: clamp(Number(kit?.x) || 50, 4, 96),
        y: clamp(Number(kit?.y) || 50, 4, 96),
        rot: normalizeAngle(Number(kit?.rot ?? kit?.rotation ?? 0)),
        scale: clamp(Number(kit?.scale) || fallbackScale, 0.45, maxScale),
        size: isBangle ? undefined : size,
        ringSize: isBangle ? Math.round(ringSize / 2) * 2 : undefined
      };
    });
  }

  function expandKitPlacements(kits) {
    return kits.flatMap((kit) => {
      const template = EXTRACTION_KITS[kit.type] || EXTRACTION_KITS.bangle;
      return template.slots.map((slot, slotIndex) => {
        const placement = normalizePlacement({
          id: `${kit.id}-${slotIndex}`,
          layout: slot.layout,
          x: kit.x + slot.dx,
          y: kit.y + slot.dy,
          ringSize: kit.ringSize
        }, slot.layout);
        placement.kitId = kit.id;
        placement.kitType = kit.type;
        placement.openingTpl = kit.openingTpl;
        placement.rot = kit.rot || 0;
        placement.scale = kit.scale || 1;
        placement.size = kit.size;
        placement.templateLabel = template.label;
        placement.templateSize = { w: template.w, h: template.h };
        return placement;
      });
    });
  }

  function kitProductMeta(placement) {
    return productMetaForKind(placement.layout, placement);
  }

  function placementTemplateSize(placement) {
    const kitTypeByLayout = Object.fromEntries(Object.entries(EXTRACTION_KITS).map(([type, kit]) => [kitLayout(type), type]));
    const template = EXTRACTION_KITS[placement.kitType] || EXTRACTION_KITS[kitTypeByLayout[placement.layout]];
    const size = placement.templateSize || template || {};
    return {
      w: clamp(Number(size.w) || placementRadius(placement) * 2, 8, 60),
      h: clamp(Number(size.h) || placementRadius(placement) * 2, 8, 60)
    };
  }

  function placementFootprint(placement) {
    const { w, h } = placementTemplateSize(placement);
    const boardWidth = templateWidthOnBoard(w);
    if (placement.layout === "bracelet") return { rx: boardWidth * 0.46, ry: h * 0.46 };
    if (placement.layout === "cabochon") return { rx: boardWidth * 0.24, ry: h * 0.34 };
    if (placement.layout === "peacePendant") {
      return { rx: boardWidth * 0.42, ry: h * 0.42 };
    }
    if (placement.layout === "ruyiPendant") return { rx: boardWidth * 0.38, ry: h * 0.42 };
    if (placement.layout === "leafPendant") return { rx: boardWidth * 0.3, ry: h * 0.37 };
    if (placement.layout === "dropPendant") return { rx: boardWidth * 0.31, ry: h * 0.38 };
    if (placement.layout === "plaque") return { rx: boardWidth * 0.34, ry: h * 0.36 };
    if (placement.layout === "buddhaPendant") return { rx: boardWidth * 0.32, ry: h * 0.38 };
    if (placement.layout === "guanyinPendant") return { rx: boardWidth * 0.3, ry: h * 0.39 };
    if (placement.layout === "fuBeanPendant") return { rx: boardWidth * 0.3, ry: h * 0.34 };
    if (placement.layout === "gourdPendant") return { rx: boardWidth * 0.3, ry: h * 0.34 };
    return { rx: boardWidth * 0.5, ry: h * 0.5 };
  }

  function placementsOverlap(placements) {
    const list = Array.isArray(placements) ? placements : [];
    const byKit = new Map();
    for (const placement of list) {
      const kitId = placement?.kitId || placement?.id;
      if (!kitId || byKit.has(kitId)) continue;
      byKit.set(kitId, {
        id: kitId,
        type: placement.kitType || (placement.layout === "bracelet" ? "bangle" : placement.kitType),
        openingTpl: placement.openingTpl,
        x: placement.x,
        y: placement.y,
        rot: placement.rot || 0,
        scale: placement.scale,
        ringSize: placement.ringSize,
        size: placement.size
      });
    }
    if (byKit.size >= 2) return extractionKitsOverlap([...byKit.values()]);

    // 无 kit 元数据的旧数据：退回椭圆近似
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (a.kitId && a.kitId === b.kitId) continue;
        const aFootprint = placementFootprint(a);
        const bFootprint = placementFootprint(b);
        const rx = aFootprint.rx + bFootprint.rx + 1;
        const ry = aFootprint.ry + bFootprint.ry + 1;
        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) < 1) return true;
      }
    }
    return false;
  }

  function scoreSlicePlacement(slice, placement) {
    const board = slice.board || {};
    const radius = placement.radius || placementRadius(placement);
    const edgePenalty = (placement.x - radius < 7 || placement.x + radius > 93 ? 0.18 : 0)
      + (placement.y - radius < 8 || placement.y + radius > 92 ? 0.18 : 0);
    const colorBonus = (board.colorZones || []).some((zone) => {
      const dx = placement.x - zone.cx / 1.44;
      const dy = placement.y - zone.cy / 0.96;
      return Math.hypot(dx, dy) < 22;
    }) ? 0.18 : 0;
    const flawPenalty = (board.flaws || []).some((flaw) => {
      const dx = placement.x - flaw.x / 1.44;
      const dy = placement.y - flaw.y / 0.96;
      return Math.hypot(dx, dy) < radius + 3;
    }) ? 0.24 : 0;
    const grainPenalty = placement.layout === "plaque" ? 0.04 : 0;
    const sizeBonus = placement.layout === "bracelet" && placement.ringSize >= 58 ? 0.06 : 0;
    return clamp(0.82 + colorBonus + sizeBonus - edgePenalty - flawPenalty - grainPenalty, 0.48, 1.24);
  }

  function scoreSlicePlan(slice, plan) {
    return scoreSlicePlacement(slice, normalizePlacement(plan, plan.layout || "bracelet"));
  }

  function scoreRoughPlacement(rough, placement) {
    const visual = rough.visual || {};
    const radius = placement.radius || placementRadius(placement);
    const edgePenalty = (placement.x - radius < 10 || placement.x + radius > 90 ? 0.22 : 0)
      + (placement.y - radius < 10 || placement.y + radius > 90 ? 0.22 : 0);
    const angle = (visual.beltAngle || 18) * Math.PI / 180;
    const dx = (placement.x - 50) / 50;
    const dy = (placement.y - 50) / 50;
    const cross = Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle));
    const colorBonus = visual.belt && cross < 0.22 ? 0.18 : 0;
    const windowBonus = (rough.windows || []).some((win) => Math.hypot(placement.x - win.x, placement.y - win.y) < radius + win.r) ? 0.08 : 0;
    const crackPenalty = visual.crack && Math.abs(placement.x - 50) < 9 && Math.abs(placement.y - 50) < 34 ? 0.18 : 0;
    const sizeBonus = placement.layout === "bracelet" && placement.ringSize >= 58 ? 0.05 : 0;
    const smallPieceBonus = isSmallPieceKind(placement.layout) ? 0.05 : 0;
    return clamp(0.82 + colorBonus + windowBonus + sizeBonus + smallPieceBonus - edgePenalty - crackPenalty, 0.5, 1.22);
  }

  function revealPolishedRough(rough) {
    const quality = qualityByKey(rough.trueQualityKey);
    const color = rollQualityColor(quality);
    return {
      ...rough,
      type: "material",
      revealed: true,
      polished: true,
      materialStage: "opened",
      qualityKey: quality.key,
      quality: quality.name,
      score: quality.score,
      color,
      value: money(rough.price * quality.value * (0.88 + Math.random() * 0.34)),
      rep: quality.rep,
      braceletPlacements: rough.braceletPlacements || []
    };
  }

  return {
    normalizeAngle,
    angleDistance,
    cutAngleName,
    makeSliceBoard,
    normalizePlan,
    placementRadius,
    templateWidthOnBoard,
    normalizePlacement,
    normalizePlacements,
    openingTplForKit,
    openingKitFromExtractionKit,
    extractionKitsOverlap,
    normalizeExtractionKits,
    expandKitPlacements,
    kitProductMeta,
    placementTemplateSize,
    placementFootprint,
    placementsOverlap,
    scoreSlicePlacement,
    scoreSlicePlan,
    scoreRoughPlacement,
    revealPolishedRough
  };
}
