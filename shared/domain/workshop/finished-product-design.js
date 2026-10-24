import { KIT_LIB, OPENING_KIT_KIND_MAP, scaleForOpeningKit } from "../jade/jade-opening-engine.js";
import { templateSizeForKind } from "../jade/jade-categories.js";
import { jadePieceFor, captureJadePiece } from "../jade/jade-piece.js";

// Physical millimetres, shared by the server quote and the SVG renderer.
export const FULL_HALO = "fullHalo";
export const SETTING_GEMS = "settingSlotsV2";
export const MAX_FINISH_GEMS = 256;
export const ACCENT_DIAMETER = 1.8;
const GAP = 0.10;
const aliases = {
  egg: "cabochon", saddle: "cabochon", carving: "buddhaPendant", buddha: "buddhaPendant",
  guanyin: "guanyinPendant", leaf: "leafPendant", drop: "dropPendant", rect: "plaque",
  pierced: "peacePendant", ping: "peacePendant", whole: "bracelet", bangle: "bracelet",
  gourd: "gourdPendant", fubean: "fuBeanPendant",
  蛋面: "cabochon", 雕件: "buddhaPendant", 佛公: "buddhaPendant", 平安扣: "peacePendant",
  无事牌: "plaque", 山水牌: "plaque", 手镯: "bracelet"
};
const extras = {
  gourdPendant: "M0,-90 C44,-90 50,-48 28,-24 C22,-16 24,-10 36,0 C80,40 58,96 0,96 C-58,96 -80,40 -36,0 C-24,-10 -22,-16 -28,-24 C-50,-48 -44,-90 0,-90 Z",
  fuBeanPendant: "M0,-100 C48,-86 56,-22 35,38 C24,74 10,100 -12,100 C-48,78 -50,24 -38,-28 C-30,-65 -18,-94 0,-100 Z",
  guanyinPendant: "M0,-110 C35,-110 42,-65 25,-43 C40,-12 39,35 58,83 C48,106 -48,106 -58,83 C-39,35 -40,-12 -25,-43 C-42,-65 -35,-110 0,-110 Z",
  ruyiPendant: "M-50,-78 C-44,-112 -4,-106 0,-80 C22,-112 66,-90 55,-58 C68,-26 34,-16 22,-25 C38,18 64,54 30,86 C0,116 -50,95 -40,60 C-20,37 -10,16 -22,-15 C-58,-10 -76,-47 -50,-78 Z"
};
const finite = (v, fallback, min, max) => Number.isFinite(Number(v)) && Number(v) > 0
  ? Math.max(min, Math.min(max, Number(v))) : fallback;
const f = (n) => Number(n.toFixed(4));

export function finishedMotifKind(item = {}) {
  if (jadePieceFor(item)) return item.jadePiece.kind;
  const jade = item.components?.find((c) => c.type === "jade");
  const source = jade?.sourceMaterial || item.sourceMaterial;
  const raw = item.motifKind || source?.placement?.layout || item.plan?.layout
    || (OPENING_KIT_KIND_MAP[source?.placement?.openingTpl]) || jade?.kind || item.jadeKind || item.kind || item.design;
  return aliases[raw] || [...Object.values(OPENING_KIT_KIND_MAP), ...Object.keys(extras)].find((kind) => kind.toLowerCase() === String(raw).toLowerCase()) || raw || "cabochon";
}

function ellipse(rx, ry) {
  return Array.from({ length: 192 }, (_, i) => {
    const a = -Math.PI / 2 + i * Math.PI * 2 / 192;
    return { x: Math.cos(a) * rx, y: Math.sin(a) * ry };
  });
}

// The opening templates use absolute M/C/Z paths. Sample the very same curves,
// rather than estimating every motif with an ellipse or browser-only APIs.
function cubicOutline(path) {
  const tokens = path.match(/[MCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const points = [];
  let i = 0, command = "", cursor = { x: 0, y: 0 };
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) command = tokens[i++].toUpperCase();
    if (command === "Z") break;
    if (command === "M") {
      cursor = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
      points.push(cursor);
      command = "C";
    } else if (command === "C") {
      const a = cursor;
      const b = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
      const c = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
      const d = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
      for (let step = 1; step <= 18; step++) {
        const t = step / 18, u = 1 - t;
        points.push({ x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
          y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y });
      }
      cursor = d;
    } else break;
  }
  if (points.length > 1 && Math.hypot(points[0].x - cursor.x, points[0].y - cursor.y) < 0.001) points.pop();
  return points;
}

function rectangle() {
  const result = [];
  // Clockwise, starting at the top centre, including rounded corners.
  result.push({ x: 0, y: -86 }, { x: 50, y: -86 });
  for (const [cx, cy, start] of [[50, -72, -90], [50, 72, 0], [-50, 72, 90], [-50, -72, 180]]) {
    for (let j = 0; j <= 16; j++) {
      const a = (start + j * 90 / 16) * Math.PI / 180;
      result.push({ x: cx + Math.cos(a) * 14, y: cy + Math.sin(a) * 14 });
    }
  }
  return result;
}

export function contourLength(points) {
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + Math.hypot(q.x - p.x, q.y - p.y);
  }, 0);
}

export function sampleClosedContour(points, count) {
  const lengths = points.map((p, i) => Math.hypot(points[(i + 1) % points.length].x - p.x, points[(i + 1) % points.length].y - p.y));
  const total = lengths.reduce((a, b) => a + b, 0);
  let edge = 0, traversed = 0;
  return Array.from({ length: count }, (_, i) => {
    const distance = i * total / count;
    while (edge < points.length - 1 && traversed + lengths[edge] < distance) traversed += lengths[edge++];
    const p = points[edge], q = points[(edge + 1) % points.length];
    const t = lengths[edge] ? (distance - traversed) / lengths[edge] : 0;
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
  });
}

export function offsetContour(points, distance) {
  const area = points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0);
  const sign = area >= 0 ? 1 : -1;
  return points.map((p, i) => {
    const before = points[(i + points.length - 1) % points.length], after = points[(i + 1) % points.length];
    const dx = after.x - before.x, dy = after.y - before.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: p.x + sign * dy / length * distance, y: p.y - sign * dx / length * distance };
  });
}

export function contourPath(points) {
  return points.map((p, i) => `${i ? "L" : "M"}${f(p.x)},${f(p.y)}`).join(" ") + " Z";
}

export function finishedJadeGeometry(item = {}) {
  if (jadePieceFor(item)) return item.jadePiece.geometry;
  const kind = finishedMotifKind(item);
  const jade = item.components?.find((c) => c.type === "jade");
  const source = jade?.sourceMaterial || item.sourceMaterial || {};
  const placement = source.placement || item.plan || {};
  const tpl = KIT_LIB.find((t) => OPENING_KIT_KIND_MAP[t.id] === kind) || null;
  const tplId = tpl?.id || "egg";
  const path = extras[kind];
  let shape = path ? `<path d="${path}"/>` : tpl?.shape;
  let nativePoints;
  if (path) nativePoints = cubicOutline(path);
  else if (tplId === "egg") nativePoints = ellipse(24, 32);
  else if (tplId === "rect") nativePoints = rectangle();
  else if (tplId === "ping" || tplId === "bangle") nativePoints = ellipse(tplId === "ping" ? 76 : 88, tplId === "ping" ? 76 : 88);
  else nativePoints = cubicOutline(shape.match(/d="([^"]+)"/)?.[1] || "");
  if (!shape || !nativePoints?.length) {
    nativePoints = ellipse(24, 32);
    shape = KIT_LIB[0].shape;
  }
  const xs = nativePoints.map((p) => p.x), ys = nativePoints.map((p) => p.y);
  const nativeBounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const nativeWidth = nativeBounds.maxX - nativeBounds.minX, nativeHeight = nativeBounds.maxY - nativeBounds.minY;
  const template = jade?.templateSize || item.templateSize || source.templateSize || placement.templateSize || templateSizeForKind(kind);
  const nominal = Math.max(finite(template?.w, 28, 8, 80), finite(template?.h, 32, 8, 80));
  const size = placement.size || item.size;
  const sizeScale = tplId !== "bangle" && ["S", "M", "L"].includes(size) ? scaleForOpeningKit(tplId, size)
    : tplId === "bangle" ? finite(item.ringSize || placement.ringSize, 56, 42, 72) / 56
      : finite(placement.scale, 1, 0.45, 1.5);
  const unit = nominal * sizeScale / Math.max(nativeWidth, nativeHeight);
  const points = sampleClosedContour(nativePoints.map((p) => ({ x: p.x * unit, y: p.y * unit })), 240);
  return { kind, tplId, shape, nativeBounds, unit, points, width: nativeWidth * unit, height: nativeHeight * unit,
    top: nativeBounds.minY * unit, bottom: nativeBounds.maxY * unit };
}

// Only new, captured pieces use size-aware mount consumption. Existing saved
// plans keep their original quote and reservation amounts.
export function finishMetalScale(item) {
  const piece = jadePieceFor(item);
  return piece ? Math.max(.35, Math.min(6, (piece.geometry.width + piece.geometry.height) / 56)) : 1;
}

export function captureExtractedJadePiece(item, stone, kit) {
  const geometry = finishedJadeGeometry(item);
  if (geometry.kind === "bracelet") {
    // The template's inner radius is 62. Match its physical inner diameter to
    // the selected ring size, retaining the exact outer contour and hole.
    const factor = (Number(item.ringSize) || 56) / (124 * geometry.unit);
    geometry.unit *= factor;
    geometry.points = geometry.points.map((p) => ({ x: p.x * factor, y: p.y * factor }));
    for (const key of ["width", "height", "top", "bottom"]) geometry[key] *= factor;
  }
  return captureJadePiece(item, stone, kit, geometry);
}

export function finishPieceRestriction(item, productType) {
  const piece = jadePieceFor(item);
  if (!piece || productType !== "ring") return "";
  if (piece.geometry.width > 26 || piece.geometry.height > 34) return "这件玉件尺寸较大，适合制作吊坠";
  if (piece.intrinsic.thicknessMm != null && piece.intrinsic.thicknessMm < 2) return "这件玉件厚度不足，无法安装戒托";
  return "";
}

export function fullHaloLayout(item, { diameter = ACCENT_DIAMETER } = {}) {
  const geometry = finishedJadeGeometry(item);
  const track = offsetContour(geometry.points, 0.42 + diameter / 2);
  const perimeter = contourLength(track);
  let count = Math.min(MAX_FINISH_GEMS, Math.floor(perimeter / (diameter + GAP)));
  // Pair stones about the vertical axis; quantities still come from perimeter.
  count -= count % 2;
  let stones = [];
  for (; count >= 4; count -= 2) {
    stones = sampleClosedContour(track, count);
    let overlap = false;
    for (let a = 0; a < count && !overlap; a++) {
      for (let b = a + 1; b < count; b++) {
        if (Math.hypot(stones[a].x - stones[b].x, stones[a].y - stones[b].y) < diameter * 1.005) { overlap = true; break; }
      }
    }
    if (!overlap) break;
  }
  return { count: stones.length, diameter, perimeter, gap: perimeter / stones.length - diameter, track, stones };
}

export function finishGemPolicy(plan = {}) {
  const setting = plan.settingId;
  if (setting === "micro") return { supports: true, required: true, kind: "halo", title: "随形满圈 · 自动计算", hint: "沿玉件外轮廓排满一圈，需选择配石种类" };
  if (setting === "channel") return { supports: true, required: false, kind: "channel", title: "双侧槽镶 · 自动计算", hint: "只在左右短槽内排石，颗数按有效槽长计算" };
  if (setting === "invisible") return { supports: true, required: false, kind: "squarePair", title: "左右隐托对石 · 2颗", hint: "两侧各一颗方形配石，金属从侧边固定" };
  if (setting === "claw") return plan.productType === "ring"
    ? { supports: true, required: false, kind: "pair", title: "左右戒肩对石 · 2颗", hint: "左右戒肩各一个石座，可选择不使用配石" }
    : { supports: true, required: false, kind: "single", title: plan.productType === "earring" ? "连接单石 · 1颗" : "扣头单石 · 1颗", hint: "配石嵌在上方连接件中，可选择不使用配石" };
  return { supports: false, required: false, kind: "none", title: "不使用配石", hint: setting === "bezel" ? "包镶以连续金属边包住玉件，不设置配石座" : "编绳不使用金属石座和配石" };
}

function openPoint(points, distance) {
  let remaining = Math.max(0, distance);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= length && length > 0) return { x: a.x + (b.x - a.x) * remaining / length, y: a.y + (b.y - a.y) * remaining / length };
    remaining -= length;
  }
  return { ...points.at(-1) };
}

function openLength(points) {
  return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
}

function halfWidthAt(geometry, y) {
  let result = 0;
  for (let i = 0; i < geometry.points.length; i++) {
    const a = geometry.points[i], b = geometry.points[(i + 1) % geometry.points.length];
    if ((a.y <= y && b.y >= y) || (b.y <= y && a.y >= y)) {
      const t = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
      result = Math.max(result, Math.abs(a.x + (b.x - a.x) * t));
    }
  }
  return result || geometry.width / 2;
}

// Complete mount geometry, including empty side galleries. Only selected gems
// contribute stones/count; the same positions drive rendering and consumption.
export function settingGemLayout(item, plan = {}) {
  const policy = finishGemPolicy(plan);
  if (!policy.supports) return { ...policy, count: 0, diameter: ACCENT_DIAMETER, stones: [], channels: [] };
  if (policy.kind === "halo") {
    const halo = fullHaloLayout(item);
    return { ...policy, ...halo, count: plan.gemId ? halo.count : 0, stones: plan.gemId ? halo.stones : [], channels: [] };
  }
  const geometry = finishedJadeGeometry(item);
  let diameter = policy.kind === "single" ? 1.9 : policy.kind === "channel" ? ACCENT_DIAMETER : 2.3;
  let stones = [], channels = [];
  if (policy.kind === "channel") {
    const track = offsetContour(geometry.points, diameter / 2 + .42);
    const span = geometry.height * .23;
    channels = [-1, 1].map((side) => {
      const points = track.filter((p) => p.x * side > 0 && Math.abs(p.y) <= span / 2);
      if (side < 0) points.reverse();
      return { side, points, length: openLength(points) };
    });
    const shortest = Math.min(...channels.map((c) => c.length));
    const perSide = Math.max(1, Math.floor((shortest - .6 + GAP) / (diameter + GAP)));
    for (const channel of channels) {
      const pitch = diameter + GAP;
      const first = (channel.length - (perSide - 1) * pitch) / 2;
      for (let i = 0; i < perSide; i++) stones.push({ ...openPoint(channel.points, first + i * pitch), side: channel.side });
    }
  } else if (policy.kind === "single") {
    stones = [{ x: 0, y: geometry.top - (plan.productType === "earring" ? 3.6 : 5.3) }];
  } else {
    const x = halfWidthAt(geometry, 0) + diameter / 2 + .55;
    stones = [{ x: -x, y: 0, side: -1 }, { x, y: 0, side: 1 }];
  }
  return { ...policy, diameter, count: plan.gemId ? stones.length : 0, stones: plan.gemId ? stones : [], channels };
}

export function resolveFinishGemCount(item, plan) {
  if (!plan?.gemId) return 0;
  if (plan.gemLayout === SETTING_GEMS) return settingGemLayout(item, plan).count;
  if (plan.gemLayout === FULL_HALO) return plan.settingId === "cord" ? 0 : fullHaloLayout(item).count;
  return Number(plan.gemCount) || 0;
}

export function normalizeFinishGemLayout(item, draft) {
  if (draft.gemLayout === SETTING_GEMS) {
    if (!finishGemPolicy(draft).supports) draft.gemId = null;
    draft.gemCount = resolveFinishGemCount(item, draft);
    return draft;
  }
  if (draft.gemLayout !== FULL_HALO) return draft;
  if (draft.settingId === "cord") draft.gemId = null;
  draft.gemCount = resolveFinishGemCount(item, draft);
  return draft;
}
