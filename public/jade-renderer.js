import { createJadeVolume, volumeSliceVeinPolygons } from "./jade-volume.js";
import {
  kitProductKind as sharedKitProductKind,
  templateSizeForKind
} from "./jade-categories.js";

const ROUGH_VIEWBOX = { width: 168, height: 140 };
const SLICE_VIEWBOX = { width: 144, height: 96 };

export function jadeCanvasMarkup(kind, item, className = "") {
  const label = escapeAttr(item?.name || "翡翠");
  const payload = encodeURIComponent(JSON.stringify(item || {}));
  const classes = ["jade-canvas", className].filter(Boolean).join(" ");
  return `<canvas class="${classes}" data-jade-kind="${escapeAttr(kind)}" data-jade-payload="${payload}" data-jade-signature="${escapeAttr(jadeVisualSignature(item))}" aria-label="${label}"></canvas>`;
}

export function jadeVisualSignature(item) {
  const relevant = {
    id: item?.id,
    kind: item?.kind,
    type: item?.type,
    layout: item?.layout,
    visual: item?.visual,
    board: item?.board,
    windows: item?.windows,
    revealed: item?.revealed,
    braceletPlacements: item?.braceletPlacements,
    sourceMaterial: item?.sourceMaterial,
    templateSize: item?.templateSize,
    ringSize: item?.ringSize,
    preview: item?.preview,
    score: item?.score,
    mass: item?.mass
  };
  return String(hashString(JSON.stringify(relevant)));
}

export function getRoughDrawBox(width, height) {
  const scale = Math.min(width / ROUGH_VIEWBOX.width, height / ROUGH_VIEWBOX.height);
  const boxWidth = ROUGH_VIEWBOX.width * scale;
  const boxHeight = ROUGH_VIEWBOX.height * scale;
  return {
    x: (width - boxWidth) / 2,
    y: (height - boxHeight) / 2,
    width: boxWidth,
    height: boxHeight,
    scaleX: scale,
    scaleY: scale
  };
}

export function roughOutlineSignature(shape = "chunk", seed = 1) {
  return roughOutlinePoints(shape, seed)
    .map((point) => `${Math.round(point.x)}:${Math.round(point.y)}`)
    .join("|");
}

export function sliceOutlineSignature(board = {}) {
  return sliceOutlinePoints(board)
    .map((point) => `${Math.round(point.x)}:${Math.round(point.y)}`)
    .join("|");
}

export function getPolishedWindowEdgeStyle(width, height) {
  return {
    alpha: 0,
    lineWidth: 0
  };
}

export function flatBandSegments(seed, width, height) {
  const rng = seededRandom(seed + 3347);
  return Array.from({ length: 3 }, (_, index) => {
    const y = height * (0.43 + index * 0.075 + (rng() - 0.5) * 0.04);
    const thickness = height * (0.055 - index * 0.008);
    const start = width * (0.16 + rng() * 0.12);
    const end = width * (0.74 + rng() * 0.16);
    const slant = height * (0.1 + rng() * 0.08);
    return {
      points: [
        { x: start, y: y - thickness },
        { x: end, y: y - thickness - slant },
        { x: end + width * 0.04, y: y + thickness - slant },
        { x: start + width * 0.04, y: y + thickness }
      ],
      alpha: 0.24 + index * 0.08
    };
  });
}

export function flatSliceBandPolygons(seed, width, height, zones = []) {
  const source = zones.length ? zones : [{ cx: 72, cy: 48, rx: 30, ry: 12, angle: 18, opacity: 0.42 }];
  const weightSum = source.reduce((sum, zone) => sum + Math.max(1, Number(zone.rx || 24)), 0);
  const centerX = source.reduce((sum, zone) => sum + (zone.cx || 72) * Math.max(1, Number(zone.rx || 24)), 0) / weightSum * width / SLICE_VIEWBOX.width;
  const centerY = source.reduce((sum, zone) => sum + (zone.cy || 48) * Math.max(1, Number(zone.rx || 24)), 0) / weightSum * height / SLICE_VIEWBOX.height;
  const angle = source.reduce((sum, zone) => sum + (zone.angle || 0), 0) / source.length * Math.PI / 180;
  const averageRy = source.reduce((sum, zone) => sum + Number(zone.ry || 10), 0) / source.length * height / SLICE_VIEWBOX.height;
  const averageOpacity = source.reduce((sum, zone) => sum + Number(zone.opacity || 0.38), 0) / source.length;
  const rng = seededRandom(seed + Math.round(centerX) * 17 + Math.round(centerY) * 31);
  const ribbonCount = clamp(Math.ceil(source.length / 3), 1, 3);
  const length = Math.max(width, height) * (0.86 + rng() * 0.24);
  const baseHalf = clamp(averageRy * (0.72 + source.length * 0.08), height * 0.035, height * 0.15);

  return Array.from({ length: ribbonCount }, (_, ribbonIndex) => {
    const localRng = seededRandom(seed + ribbonIndex * 997 + 41);
    const offset = (ribbonIndex - (ribbonCount - 1) / 2) * baseHalf * (1.45 + localRng() * 0.45);
    const half = baseHalf * (0.68 + localRng() * 0.42) * (ribbonIndex === 0 ? 1 : 0.72);
    const segmentCount = 6;
    const top = [];
    const bottom = [];
    for (let index = 0; index < segmentCount; index += 1) {
      const t = index / (segmentCount - 1);
      const x = -length / 2 + t * length;
      const centerDrift = Math.sin((t * 2.2 + localRng()) * Math.PI) * half * 0.34 + (localRng() - 0.5) * half * 0.55;
      const pinch = 0.78 + Math.sin(t * Math.PI) * 0.22 + (localRng() - 0.5) * 0.14;
      top.push({ x, y: offset + centerDrift - half * pinch });
      bottom.unshift({ x: x + (localRng() - 0.5) * length * 0.045, y: offset + centerDrift + half * (0.74 + localRng() * 0.38) });
    }
    const points = [...top, ...bottom].map((point) => rotatePoint(point.x, point.y, angle, centerX, centerY));
    return {
      points,
      alpha: clamp(averageOpacity * (ribbonIndex === 0 ? 0.9 : 0.48), 0.16, 0.66),
      tone: ribbonIndex
    };
  });
}

export function flatCrackSegments(seed, width, height, angle = 96) {
  const rng = seededRandom(seed + Math.round(angle) * 43);
  const main = [];
  const length = height * 0.52;
  const startX = width * (0.58 + (rng() - 0.5) * 0.16);
  const startY = height * (0.22 + rng() * 0.12);
  for (let index = 0; index < 7; index += 1) {
    const t = index / 6;
    main.push({
      x: startX + (rng() - 0.5) * width * 0.13 + Math.sin(t * Math.PI * 1.4) * width * 0.035,
      y: startY + t * length
    });
  }
  const branches = [2, 4].map((mainIndex, branchIndex) => {
    const base = main[mainIndex];
    const dir = branchIndex % 2 === 0 ? -1 : 1;
    return [
      base,
      {
        x: base.x + dir * width * (0.07 + rng() * 0.06),
        y: base.y + height * (0.03 + rng() * 0.07)
      }
    ];
  });
  return { main, branches };
}

export function paintJadeCanvases(root = document) {
  root.querySelectorAll("canvas[data-jade-kind][data-jade-payload]").forEach((canvas) => {
    try {
      const item = JSON.parse(decodeURIComponent(canvas.dataset.jadePayload || "%7B%7D"));
      if (canvas.dataset.jadeKind === "rough") renderRoughCanvas(canvas, item);
      if (canvas.dataset.jadeKind === "slice") renderSliceCanvas(canvas, item);
      if (canvas.dataset.jadeKind === "product") renderProductCanvas(canvas, item);
      if (canvas.dataset.jadeKind === "kit") renderKitTemplateCanvas(canvas, item);
      if (canvas.dataset.jadeKind === "kitMask") renderKitMaskCanvas(canvas, item);
    } catch (error) {
      paintFallback(canvas);
      console.warn("Jade renderer fallback", error);
    }
  });
}

export function renderRoughCanvas(canvas, item) {
  const visual = item?.visual || {};
  const { ctx, width, height } = prepareCanvas(canvas, fallbackSize(canvas, 168, 122));
  const seed = Number(visual.seed || hashString(item?.id || item?.name || "rough"));
  const rng = seededRandom(seed);
  const skin = visual.skin || "#6f776d";
  const vein = visual.vein || "#3f9b71";
  const shape = visual.shape || "chunk";
  const box = getRoughDrawBox(width, height);

  ctx.clearRect(0, 0, width, height);
  if (visual.masked) {
    drawMaskedRough(ctx, item, visual, box, seed);
    return;
  }
  ctx.save();
  ctx.translate(box.x, box.y);
  roughPath(ctx, shape, box.width, box.height, seed);
  ctx.clip();
  drawJadeTextureField(ctx, visual, seed, box.width, box.height);
  drawFlatSpeckles(ctx, rng, box.width, box.height, Number(visual.speckles || 90));
  if (visual.belt) drawSoftColorBloom(ctx, seed, box.width, box.height, vein, visual);
  if (visual.window) drawJadeWindow(ctx, rng, box.width, box.height, vein, Number(visual.translucency ?? 0.45), Number(visual.cotton ?? 0.38));
  drawFibrousVeins(ctx, seed, box.width, box.height, vein, Number(visual.cotton ?? 0.38));
  if (visual.crack) drawNaturalCrack(ctx, seed, box.width, box.height, Number(visual.crackAngle || 102), "#211b18", 1.6, 0.62);
  ctx.restore();

  ctx.save();
  ctx.translate(box.x, box.y);
  drawPolishedRim(ctx, shape, box.width, box.height, seed, skin);
  ctx.restore();
}

function drawJadeTextureField(ctx, visual, seed, width, height) {
  const skin = visual.skin || "#6f776d";
  const vein = visual.vein || "#3f9b71";
  const rng = seededRandom(seed + 8723);
  const base = ctx.createLinearGradient(width * 0.08, height * 0.12, width * 0.92, height * 0.9);
  base.addColorStop(0, mixColor(skin, "#f4fbf5", 0.26));
  base.addColorStop(0.32, mixColor(skin, "#dfe9dc", 0.18));
  base.addColorStop(0.68, mixColor(skin, vein, 0.08 + Number(visual.translucency ?? 0.42) * 0.12));
  base.addColorStop(1, mixColor(skin, "#39453f", 0.16));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  drawMistWash(ctx, seededRandom(seed + 931), width, height, skin, vein, Number(visual.translucency ?? 0.42));
  drawSoftColorBloom(ctx, seed + 37, width, height, vein, {
    ...visual,
    beltAngle: Number(visual.beltAngle || 18) - 8,
    bloomStrength: visual.belt ? 0.38 : 0.18
  });
  drawFlatSkinBlocks(ctx, rng, width, height, mixColor(skin, "#dbe5da", 0.1));
}

function drawMistWash(ctx, rng, width, height, skin, vein, translucency) {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "blur(12px)";
  const tones = [
    mixColor(skin, "#ffffff", 0.5),
    mixColor(vein, "#f0fff6", 0.52),
    mixColor(skin, "#d5b7bd", 0.22),
    mixColor(skin, "#789482", 0.18)
  ];
  for (let i = 0; i < 12; i += 1) {
    const tone = tones[i % tones.length];
    ctx.fillStyle = withAlpha(tone, 0.1 + rng() * 0.16 + translucency * 0.08);
    ctx.beginPath();
    ctx.ellipse(
      width * (0.08 + rng() * 0.84),
      height * (0.12 + rng() * 0.76),
      width * (0.1 + rng() * 0.24),
      height * (0.06 + rng() * 0.18),
      (rng() - 0.5) * Math.PI,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();
}

function drawSoftColorBloom(ctx, seed, width, height, vein, visual = {}) {
  const rng = seededRandom(seed + 3347);
  const angle = Number(visual.beltAngle || 18) * Math.PI / 180;
  const clarity = Number(visual.clarity ?? visual.translucency ?? 0.42);
  const strength = clamp(Number(visual.bloomStrength ?? 1), 0.1, 1.2);
  ctx.save();
  ctx.translate(width * 0.5, height * 0.5);
  ctx.rotate(angle - 0.28);
  ctx.translate(-width * 0.5, -height * 0.5);
  ctx.filter = "blur(9px)";
  ctx.globalCompositeOperation = "multiply";
  for (let i = 0; i < 4; i += 1) {
    const centerY = height * (0.38 + i * 0.08 + (rng() - 0.5) * 0.08);
    const bandHeight = height * (0.12 + rng() * 0.11);
    const startX = -width * (0.14 + rng() * 0.08);
    const endX = width * (1.02 + rng() * 0.12);
    const fill = ctx.createLinearGradient(startX, centerY, endX, centerY);
    fill.addColorStop(0, withAlpha(vein, 0));
    fill.addColorStop(0.24, withAlpha(mixColor(vein, "#f2fff8", 0.18), (0.16 + clarity * 0.1) * strength));
    fill.addColorStop(0.5, withAlpha(mixColor(vein, "#0d5c45", 0.08), (0.23 + clarity * 0.12) * strength));
    fill.addColorStop(0.76, withAlpha(mixColor(vein, "#f2fff8", 0.28), (0.12 + clarity * 0.08) * strength));
    fill.addColorStop(1, withAlpha(vein, 0));
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(startX, centerY - bandHeight * (0.48 + rng() * 0.24));
    for (let step = 1; step <= 7; step += 1) {
      const t = step / 7;
      ctx.lineTo(
        startX + (endX - startX) * t,
        centerY - bandHeight * (0.36 + rng() * 0.36) + Math.sin(t * Math.PI * 2) * bandHeight * 0.18
      );
    }
    for (let step = 7; step >= 0; step -= 1) {
      const t = step / 7;
      ctx.lineTo(
        startX + (endX - startX) * t,
        centerY + bandHeight * (0.36 + rng() * 0.34) + Math.sin(t * Math.PI * 2 + 1.2) * bandHeight * 0.16
      );
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawFibrousVeins(ctx, seed, width, height, vein, cotton) {
  const rng = seededRandom(seed + 4529);
  const count = Math.round(32 + cotton * 28);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 0; i < count; i += 1) {
    const x = width * (-0.08 + rng() * 1.16);
    const y = height * (0.08 + rng() * 0.82);
    const length = width * (0.16 + rng() * 0.36);
    const sway = height * (0.025 + rng() * 0.09);
    const tone = rng() > 0.58 ? "#ffffff" : mixColor(vein, "#eafff4", 0.52);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(
      x + length * 0.3,
      y - sway,
      x + length * 0.62,
      y + sway * (rng() > 0.5 ? 1 : -1),
      x + length,
      y + (rng() - 0.5) * sway
    );
    ctx.strokeStyle = withAlpha(tone, 0.08 + rng() * 0.13);
    ctx.lineWidth = 0.45 + rng() * 1.25;
    ctx.stroke();
  }
  ctx.restore();
}

function drawPolishedRim(ctx, shape, width, height, seed, skin) {
  ctx.save();
  roughPath(ctx, shape, width, height, seed);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, width * 0.012);
  ctx.strokeStyle = withAlpha(mixColor(skin, "#14231d", 0.46), 0.24);
  ctx.stroke();
  ctx.lineWidth = Math.max(0.8, width * 0.004);
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.stroke();
  ctx.restore();
}

function drawMaskedRough(ctx, item, visual, box, seed) {
  const shape = visual.shape || "chunk";
  const maskTone = visual.maskTone || "#4f5550";
  ctx.save();
  ctx.translate(box.x, box.y);
  roughPath(ctx, shape, box.width, box.height, seed);
  ctx.clip();
  ctx.fillStyle = maskTone;
  ctx.fillRect(0, 0, box.width, box.height);
  drawFlatSpeckles(ctx, seededRandom(seed + 41), box.width, box.height, 70);
  drawMaskedSkinBlocks(ctx, seededRandom(seed + 337), box.width, box.height, maskTone);
  drawWindowReveals(ctx, visual.windows || item?.windows || [], box.width, box.height, seed);
  ctx.restore();

  ctx.save();
  ctx.translate(box.x, box.y);
  roughPath(ctx, shape, box.width, box.height, seed);
  ctx.lineWidth = Math.max(1, box.width * 0.008);
  ctx.strokeStyle = "rgba(18,24,22,0.56)";
  ctx.stroke();
  ctx.restore();
}

function drawMaskedSkinBlocks(ctx, rng, width, height, baseColor) {
  for (let i = 0; i < 7; i += 1) {
    ctx.fillStyle = i % 2
      ? withAlpha(mixColor(baseColor, "#101412", 0.28), 0.18)
      : withAlpha(mixColor(baseColor, "#ffffff", 0.1), 0.14);
    ctx.beginPath();
    ctx.ellipse(
      width * (0.16 + rng() * 0.68),
      height * (0.16 + rng() * 0.68),
      width * (0.06 + rng() * 0.12),
      height * (0.04 + rng() * 0.09),
      rng() * Math.PI,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
}

function drawWindowReveals(ctx, windows, width, height, seed) {
  windows.forEach((win, index) => {
    const rng = seededRandom(Number(win.seed || seed + index * 977));
    const cx = width * (Number(win.x || 50) / 100);
    const cy = height * (Number(win.y || 50) / 100);
    const radius = Math.max(5, width * (Number(win.r || 10) / 100));
    const vein = win.vein || "#4fb58a";
    const skin = win.skin || "#aeb5a8";
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * 1.12, radius * 0.78, (rng() - 0.5) * 0.6, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = mixColor(skin, "#dff7eb", 0.2 + Number(win.translucency || 0.35) * 0.16);
    ctx.fillRect(cx - radius * 1.2, cy - radius, radius * 2.4, radius * 2);
    if (win.hasBelt) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((rng() - 0.5) * 0.9);
      ctx.fillStyle = withAlpha(vein, 0.42);
      ctx.fillRect(-radius * 1.1, -radius * 0.18, radius * 2.2, radius * 0.38);
      ctx.restore();
    }
    drawCotton(ctx, rng, width, height, 82 - Number(win.cotton || 0.38) * 54, {
      x: cx - radius,
      y: cy - radius * 0.72,
      width: radius * 2,
      height: radius * 1.44
    });
    if (win.hasCrack) drawFracture(ctx, seed + index * 31, radius * 2, radius * 1.4, 96, "#332424", 1.1, 0.58);
    ctx.restore();
  });
}

export function renderSliceCanvas(canvas, slice) {
  const board = slice?.board || {};
  const { ctx, width, height } = prepareCanvas(canvas, fallbackSize(canvas, 144, 96));
  const seed = Number(board.sourceSeed || slice?.visual?.seed || hashString(slice?.id || slice?.name || "slice"));
  const rng = seededRandom(seed + 7919);
  const ground = board.groundColor || "#d7ddd0";
  const baseColor = board.baseColor || "#65a985";

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  slicePath(ctx, board, width, height);
  ctx.clip();

  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, width, height);

  drawSliceGrain(ctx, rng, width, height, baseColor, Number(board.grainAngle || 0));
  drawVolumeColorVeins(ctx, createJadeVolume(slice), board, width, height, baseColor);
  drawCotton(ctx, seededRandom(seed + 17), width, height, Number(board.clarity || board.cleanScore || 55));
  drawBoardCottonThreads(ctx, width, height, board.cottonThreads || []);
  drawDirtySpots(ctx, rng, width, height, board.dirtySpots || [], slice?.score || 2);
  (board.flaws || []).forEach((flaw, index) => {
    const local = seededRandom(seed + index * 101);
    drawSliceFlaw(ctx, local, width, height, flaw);
  });
  ctx.restore();

  ctx.save();
  slicePath(ctx, board, width, height);
  ctx.lineWidth = Math.max(1, width * 0.007);
  ctx.strokeStyle = withAlpha(mixColor(ground, "#176d58", 0.34), 0.44);
  ctx.stroke();
  ctx.restore();
}

export function renderProductCanvas(canvas, item) {
  const { ctx, width, height } = prepareCanvas(canvas, fallbackSize(canvas, 96, 96));
  const seed = Number(item?.plan?.x || 0) * 31 + Number(item?.plan?.y || 0) * 47 + hashString(item?.id || item?.name || "product");
  const visual = productVisual(item);
  ctx.clearRect(0, 0, width, height);
  if (item?.sourceMaterial?.visual) {
    renderSourceMaterialProductCanvas(ctx, item, seed, width, height);
    return;
  }
  if ((item?.kind || "bracelet") === "bracelet") {
    drawPolishedBangle(ctx, visual, seed, width, height);
    return;
  }
  drawPolishedSmallPiece(ctx, item, visual, seed, width, height);
}

export function renderKitTemplateCanvas(canvas, item) {
  const { ctx, width, height } = prepareCanvas(canvas, fallbackSize(canvas, 96, 96));
  const kind = kitProductKind(item?.type || item?.layout || item?.kind);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  const evenOdd = drawKitTemplatePath(ctx, kind, width, height);
  ctx.fillStyle = "rgba(37, 142, 107, 0.18)";
  if (evenOdd) ctx.fill("evenodd");
  else ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  strokeKitTemplatePath(ctx, kind, width, height, "rgba(20, 91, 72, 0.72)", Math.max(1.4, Math.min(width, height) * 0.055));
  strokeKitTemplatePath(ctx, kind, width, height, "rgba(240, 255, 249, 0.46)", Math.max(0.8, Math.min(width, height) * 0.024), -0.035);
  ctx.restore();
}

export function renderKitMaskCanvas(canvas, item) {
  const { ctx, width, height } = prepareCanvas(canvas, fallbackSize(canvas, 96, 96));
  const kind = kitProductKind(item?.type || item?.layout || item?.kind);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  const evenOdd = drawKitMaskPath(ctx, kind, width, height);
  ctx.fillStyle = "rgba(0, 0, 0, 0.74)";
  if (evenOdd) ctx.fill("evenodd");
  else ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  strokeKitTemplatePath(ctx, kind, width, height, "rgba(0, 0, 0, 0.88)", Math.max(1, Math.min(width, height) * 0.04));
  ctx.restore();
}

function kitProductKind(type) {
  return sharedKitProductKind(type);
}

function renderSourceMaterialProductCanvas(ctx, item, seed, width, height) {
  const kind = item?.kind || item?.sourceMaterial?.placement?.layout || "bracelet";
  const isPreview = Boolean(item?.preview);
  const evenOdd = productPiecePath(ctx, kind, width, height);
  ctx.save();
  productPiecePath(ctx, kind, width, height);
  if (evenOdd) ctx.clip("evenodd");
  else ctx.clip();
  ctx.globalAlpha = isPreview ? 0.32 : 1;
  drawSourceMaterialTexture(ctx, item, seed, width, height);
  ctx.restore();
  if (isPreview) {
    ctx.save();
    clipSourceRoughShape(ctx, item, seed, width, height);
    drawProductCutoutFinish(ctx, kind, width, height, evenOdd, {
      showSurface: false,
      showHighlight: false
    });
    ctx.restore();
  } else {
    drawProductCutoutFinish(ctx, kind, width, height, evenOdd);
  }
  if (!isPreview) drawProductCarvingLines(ctx, kind, width, height);
}

function drawSourceMaterialTexture(ctx, item, seed, width, height) {
  const source = item?.sourceMaterial || {};
  const visual = {
    ...(source.visual || {}),
    belt: source.visual?.belt ?? true,
    skin: source.visual?.skin || productVisual(item).skin,
    vein: source.visual?.vein || productVisual(item).vein
  };
  const placement = source.placement || item?.plan || {};
  const sample = sourceSampleDimensions(item, width, height);
  const sourceSeed = Number(visual.seed || seed);
  const box = getRoughDrawBox(sample.sourceWidth, sample.sourceHeight);
  const offsetX = sample.offsetX - box.x;
  const offsetY = sample.offsetY - box.y;

  ctx.save();
  clipSourceRoughShape(ctx, item, seed, width, height);
  ctx.translate(-offsetX, -offsetY);
  drawJadeTextureField(ctx, visual, sourceSeed, box.width, box.height);
  drawFlatSpeckles(ctx, seededRandom(sourceSeed), box.width, box.height, Number(visual.speckles || 90));
  if (visual.belt) drawSoftColorBloom(ctx, sourceSeed, box.width, box.height, visual.vein, visual);
  drawFibrousVeins(ctx, sourceSeed, box.width, box.height, visual.vein, Number(visual.cotton ?? 0.38));
  drawSourceWindows(ctx, source.windows || [], box.width, box.height, visual.vein);
  if (visual.crack) {
    drawNaturalCrack(ctx, sourceSeed, box.width, box.height, Number(visual.crackAngle || 102), "#211b18", 1.6, 0.62);
  }
  ctx.restore();
}

function clipSourceRoughShape(ctx, item, seed, width, height) {
  const source = item?.sourceMaterial || {};
  const visual = source.visual || {};
  const sample = sourceSampleDimensions(item, width, height);
  const sourceSeed = Number(visual.seed || seed);
  const box = getRoughDrawBox(sample.sourceWidth, sample.sourceHeight);
  const offsetX = sample.offsetX - box.x;
  const offsetY = sample.offsetY - box.y;
  ctx.translate(-offsetX, -offsetY);
  roughPath(ctx, visual.shape || "chunk", box.width, box.height, sourceSeed);
  ctx.clip();
  ctx.translate(offsetX, offsetY);
}

function sourceSampleDimensions(item, width, height) {
  const source = item?.sourceMaterial || {};
  const placement = source.placement || item?.plan || {};
  const size = source.templateSize || placement.templateSize || defaultTemplateSize(item?.kind || placement.layout || "bracelet");
  const sampleWidthPercent = clamp(Number(size?.w) || 28, 8, 60);
  const sampleHeightPercent = clamp(Number(size?.h) || 28, 8, 60);
  const x = clamp(Number(placement.x) || 50, 0, 100) / 100;
  const y = clamp(Number(placement.y) || 50, 0, 100) / 100;
  const sourceWidth = width * 100 / sampleWidthPercent;
  const sourceHeight = height * 100 / sampleHeightPercent;
  return {
    sourceWidth,
    sourceHeight,
    offsetX: sourceWidth * x - width * 0.5,
    offsetY: sourceHeight * y - height * 0.5
  };
}

function defaultTemplateSize(kind) {
  return templateSizeForKind(kind);
}

function drawSourceWindows(ctx, windows, width, height, vein) {
  windows.slice(0, 6).forEach((win, index) => {
    const cx = clamp(Number(win.x) || 50, 0, 100) / 100 * width;
    const cy = clamp(Number(win.y) || 50, 0, 100) / 100 * height;
    const rx = clamp(Number(win.r) || 9, 4, 18) / 100 * width;
    const ry = rx * 0.74;
    const glow = ctx.createRadialGradient(cx - rx * 0.24, cy - ry * 0.28, 1, cx, cy, rx * 1.28);
    glow.addColorStop(0, withAlpha(mixColor(vein, "#ffffff", 0.52), 0.42));
    glow.addColorStop(0.62, withAlpha(vein, 0.2));
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * (1 + index * 0.03), ry, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawProductCutoutFinish(ctx, kind, width, height, evenOdd = false, options = {}) {
  const { showSurface = true, showHighlight = true } = options;
  const cx = width * 0.5;
  const cy = height * 0.5;
  ctx.save();
  if (showSurface) {
    const shine = ctx.createRadialGradient(width * 0.34, height * 0.28, width * 0.05, cx, cy, Math.max(width, height) * 0.58);
    shine.addColorStop(0, "rgba(255,255,255,0.42)");
    shine.addColorStop(0.42, "rgba(255,255,255,0.08)");
    shine.addColorStop(1, "rgba(16,52,43,0.2)");
    productPiecePath(ctx, kind, width, height);
    ctx.fillStyle = shine;
    if (evenOdd) ctx.fill("evenodd");
    else ctx.fill();
  }
  ctx.lineWidth = Math.max(1.2, width * 0.018);
  ctx.strokeStyle = "rgba(28,49,45,0.48)";
  productPiecePath(ctx, kind, width, height);
  ctx.stroke();
  if (showHighlight) {
    ctx.lineWidth = Math.max(1, width * 0.01);
    ctx.strokeStyle = "rgba(255,255,255,0.34)";
    ctx.beginPath();
    ctx.ellipse(cx - width * 0.04, cy - height * 0.04, width * 0.28, height * 0.36, -0.72, -2.55, -0.44);
    ctx.stroke();
  }
  ctx.restore();
}

function drawProductCarvingLines(ctx, kind, width, height) {
  const cx = width * 0.5;
  const cy = height * 0.5;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(28,49,45,0.28)";
  ctx.lineWidth = Math.max(1, width * 0.012);
  if (kind === "plaque") {
    ctx.beginPath();
    ctx.arc(cx, height * 0.28, width * 0.035, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(width * 0.38, height * 0.48);
    ctx.quadraticCurveTo(cx, height * 0.42, width * 0.62, height * 0.48);
    ctx.stroke();
  }
  if (kind === "buddhaPendant") {
    ctx.beginPath();
    ctx.moveTo(width * 0.36, height * 0.48);
    ctx.quadraticCurveTo(cx, height * 0.56, width * 0.64, height * 0.48);
    ctx.moveTo(width * 0.34, height * 0.72);
    ctx.quadraticCurveTo(cx, height * 0.84, width * 0.66, height * 0.72);
    ctx.stroke();
  }
  if (kind === "guanyinPendant") {
    ctx.beginPath();
    ctx.moveTo(cx, height * 0.2);
    ctx.quadraticCurveTo(width * 0.38, height * 0.54, cx, height * 0.84);
    ctx.moveTo(cx, height * 0.2);
    ctx.quadraticCurveTo(width * 0.62, height * 0.54, cx, height * 0.84);
    ctx.stroke();
  }
  if (kind === "leafPendant") {
    ctx.beginPath();
    ctx.moveTo(width * 0.62, height * 0.18);
    ctx.quadraticCurveTo(width * 0.48, height * 0.54, width * 0.36, height * 0.84);
    ctx.moveTo(width * 0.48, height * 0.5);
    ctx.quadraticCurveTo(width * 0.58, height * 0.47, width * 0.68, height * 0.38);
    ctx.stroke();
  }
  if (kind === "fuBeanPendant") {
    [0.36, 0.56, 0.76].forEach((pos) => {
      ctx.beginPath();
      ctx.ellipse(cx, height * pos, width * 0.12, height * 0.07, -0.28, 0, Math.PI * 2);
      ctx.stroke();
    });
  }
  if (kind === "gourdPendant") {
    ctx.beginPath();
    ctx.moveTo(width * 0.36, height * 0.44);
    ctx.quadraticCurveTo(cx, height * 0.52, width * 0.64, height * 0.44);
    ctx.stroke();
  }
  if (kind === "beads") {
    ctx.beginPath();
    ctx.arc(width * 0.32, cy, width * 0.035, 0, Math.PI * 2);
    ctx.moveTo(width * 0.72, cy);
    ctx.arc(width * 0.68, cy, width * 0.035, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPolishedBangle(ctx, visual, seed, width, height) {
  const cx = width * 0.5;
  const cy = height * 0.5;
  const outer = Math.min(width, height) * 0.42;
  const inner = outer * 0.48;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
  ctx.clip("evenodd");
  drawJadeTextureField(ctx, visual, seed, width, height);
  drawFibrousVeins(ctx, seed + 59, width, height, visual.vein, 0.24);
  ctx.restore();

  ctx.save();
  ctx.lineCap = "round";
  const shine = ctx.createRadialGradient(cx - outer * 0.28, cy - outer * 0.32, inner * 0.4, cx, cy, outer);
  shine.addColorStop(0, "rgba(255,255,255,0.42)");
  shine.addColorStop(0.42, "rgba(255,255,255,0.08)");
  shine.addColorStop(1, "rgba(18,70,55,0.22)");
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
  ctx.fillStyle = shine;
  ctx.fill("evenodd");
  ctx.lineWidth = Math.max(2, width * 0.035);
  ctx.strokeStyle = "rgba(42,64,61,0.46)";
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = Math.max(1.5, width * 0.018);
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.beginPath();
  ctx.arc(cx - outer * 0.03, cy - outer * 0.04, outer * 0.9, -2.55, -0.32);
  ctx.stroke();
  ctx.lineWidth = Math.max(1.4, width * 0.02);
  ctx.strokeStyle = "rgba(28,49,45,0.4)";
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawPolishedSmallPiece(ctx, item, visual, seed, width, height) {
  const kind = item?.kind || "plaque";
  const evenOdd = productPiecePath(ctx, kind, width, height);
  ctx.save();
  productPiecePath(ctx, kind, width, height);
  if (evenOdd) ctx.clip("evenodd");
  else ctx.clip();
  drawJadeTextureField(ctx, visual, seed, width, height);
  drawFibrousVeins(ctx, seed + 83, width, height, visual.vein, 0.28);
  ctx.restore();

  ctx.save();
  productPiecePath(ctx, kind, width, height);
  ctx.lineWidth = Math.max(1.2, width * 0.018);
  ctx.strokeStyle = "rgba(35,60,54,0.5)";
  ctx.stroke();
  ctx.restore();
}

function drawKitTemplatePath(ctx, kind, width, height) {
  if (kind === "bracelet") return drawBangleTemplatePath(ctx, width, height);
  if (kind === "peacePendant") return drawPeacePendantTemplatePath(ctx, width, height);
  return productPiecePath(ctx, kind, width, height);
}

function drawBangleTemplatePath(ctx, width, height, inset = 0) {
  const cx = width * 0.5;
  const cy = height * 0.5;
  const outerX = Math.max(1, width * (0.46 + inset));
  const outerY = Math.max(1, height * (0.46 + inset));
  const innerX = Math.max(1, outerX * 0.5);
  const innerY = Math.max(1, outerY * 0.5);
  ctx.beginPath();
  ctx.moveTo(cx + outerX, cy);
  ctx.ellipse(cx, cy, outerX, outerY, 0, 0, Math.PI * 2);
  ctx.moveTo(cx + innerX, cy);
  ctx.ellipse(cx, cy, innerX, innerY, 0, 0, Math.PI * 2, true);
  return true;
}

function drawPeacePendantTemplatePath(ctx, width, height, inset = 0) {
  const cx = width * 0.5;
  const cy = height * 0.5;
  const outer = Math.max(1, Math.min(width, height) * (0.42 + inset));
  const inner = Math.max(1, outer * 0.42);
  ctx.beginPath();
  ctx.moveTo(cx + outer, cy);
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.moveTo(cx + inner, cy);
  ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
  return true;
}

function drawKitMaskPath(ctx, kind, width, height) {
  if (kind === "bracelet") {
    drawBangleTemplatePath(ctx, width, height);
    return true;
  }
  if (kind === "peacePendant") {
    drawPeacePendantTemplatePath(ctx, width, height);
    return true;
  }
  return drawKitTemplatePath(ctx, kind, width, height);
}

function strokeKitTemplatePath(ctx, kind, width, height, color, lineWidth, inset = 0) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  if (kind === "bracelet") {
    strokeBangleTemplatePath(ctx, width, height, inset);
    return;
  }
  if (kind === "peacePendant") {
    strokePeacePendantTemplatePath(ctx, width, height, inset);
    return;
  }
  drawKitTemplatePath(ctx, kind, width, height);
  ctx.stroke();
}

function strokeBangleTemplatePath(ctx, width, height, inset = 0) {
  const cx = width * 0.5;
  const cy = height * 0.5;
  const outerX = Math.max(1, width * (0.46 + inset));
  const outerY = Math.max(1, height * (0.46 + inset));
  const innerX = Math.max(1, outerX * 0.5);
  const innerY = Math.max(1, outerY * 0.5);
  ctx.beginPath();
  ctx.ellipse(cx, cy, outerX, outerY, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, cy, innerX, innerY, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function strokePeacePendantTemplatePath(ctx, width, height, inset = 0) {
  const cx = width * 0.5;
  const cy = height * 0.5;
  const outer = Math.max(1, Math.min(width, height) * (0.42 + inset));
  const inner = Math.max(1, outer * 0.42);
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.stroke();
}

function productPiecePath(ctx, kind, width, height) {
  const cx = width * 0.5;
  const cy = height * 0.5;
  if (kind === "bracelet") {
    const outerX = width * 0.43;
    const outerY = height * 0.32;
    const innerX = outerX * 0.48;
    const innerY = outerY * 0.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy, outerX, outerY, -0.08, 0, Math.PI * 2);
    ctx.ellipse(cx, cy, innerX, innerY, -0.08, 0, Math.PI * 2, true);
    return true;
  }
  if (kind === "peacePendant") {
    const outer = Math.min(width, height) * 0.38;
    const inner = outer * 0.42;
    ctx.beginPath();
    ctx.arc(cx, cy, outer, 0, Math.PI * 2);
    ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
    return true;
  }
  if (kind === "cabochon") {
    ctx.beginPath();
    ctx.ellipse(cx, cy, width * 0.24, height * 0.34, 0, 0, Math.PI * 2);
    return false;
  }
  if (kind === "plaque") {
    roundedRectPath(ctx, width * 0.28, height * 0.16, width * 0.44, height * 0.68, width * 0.1);
    return false;
  }
  if (kind === "buddhaPendant") {
    ctx.beginPath();
    ctx.moveTo(cx, height * 0.12);
    ctx.bezierCurveTo(width * 0.76, height * 0.13, width * 0.77, height * 0.42, width * 0.67, height * 0.48);
    ctx.bezierCurveTo(width * 0.84, height * 0.72, width * 0.7, height * 0.9, cx, height * 0.9);
    ctx.bezierCurveTo(width * 0.3, height * 0.9, width * 0.16, height * 0.72, width * 0.33, height * 0.48);
    ctx.bezierCurveTo(width * 0.23, height * 0.42, width * 0.24, height * 0.13, cx, height * 0.12);
    ctx.closePath();
    return false;
  }
  if (kind === "guanyinPendant") {
    ctx.beginPath();
    ctx.moveTo(cx, height * 0.1);
    ctx.bezierCurveTo(width * 0.76, height * 0.24, width * 0.7, height * 0.46, width * 0.62, height * 0.54);
    ctx.bezierCurveTo(width * 0.78, height * 0.76, width * 0.62, height * 0.92, cx, height * 0.92);
    ctx.bezierCurveTo(width * 0.38, height * 0.92, width * 0.22, height * 0.76, width * 0.38, height * 0.54);
    ctx.bezierCurveTo(width * 0.3, height * 0.46, width * 0.24, height * 0.24, cx, height * 0.1);
    ctx.closePath();
    return false;
  }
  if (kind === "ruyiPendant") {
    ctx.beginPath();
    ctx.moveTo(width * 0.28, height * 0.34);
    ctx.bezierCurveTo(width * 0.18, height * 0.12, width * 0.46, height * 0.08, cx, height * 0.28);
    ctx.bezierCurveTo(width * 0.68, height * 0.04, width * 0.94, height * 0.26, width * 0.72, height * 0.5);
    ctx.lineTo(width * 0.58, height * 0.84);
    ctx.bezierCurveTo(width * 0.47, height * 0.92, width * 0.36, height * 0.88, width * 0.31, height * 0.78);
    ctx.lineTo(width * 0.42, height * 0.52);
    ctx.bezierCurveTo(width * 0.26, height * 0.58, width * 0.18, height * 0.48, width * 0.28, height * 0.34);
    ctx.closePath();
    return false;
  }
  if (kind === "fuBeanPendant") {
    ctx.beginPath();
    ctx.moveTo(width * 0.52, height * 0.08);
    ctx.bezierCurveTo(width * 0.78, height * 0.24, width * 0.76, height * 0.48, width * 0.58, height * 0.58);
    ctx.bezierCurveTo(width * 0.78, height * 0.76, width * 0.58, height * 0.94, width * 0.34, height * 0.9);
    ctx.bezierCurveTo(width * 0.16, height * 0.7, width * 0.28, height * 0.56, width * 0.38, height * 0.5);
    ctx.bezierCurveTo(width * 0.22, height * 0.3, width * 0.28, height * 0.12, width * 0.52, height * 0.08);
    ctx.closePath();
    return false;
  }
  if (kind === "leafPendant") {
    ctx.beginPath();
    ctx.moveTo(width * 0.66, height * 0.08);
    ctx.bezierCurveTo(width * 0.92, height * 0.46, width * 0.72, height * 0.82, width * 0.32, height * 0.94);
    ctx.bezierCurveTo(width * 0.12, height * 0.52, width * 0.28, height * 0.2, width * 0.66, height * 0.08);
    ctx.closePath();
    return false;
  }
  if (kind === "dropPendant") {
    ctx.beginPath();
    ctx.moveTo(cx, height * 0.08);
    ctx.bezierCurveTo(width * 0.75, height * 0.34, width * 0.78, height * 0.58, width * 0.62, height * 0.78);
    ctx.bezierCurveTo(width * 0.52, height * 0.92, width * 0.35, height * 0.94, cx, height * 0.94);
    ctx.bezierCurveTo(width * 0.35, height * 0.94, width * 0.48, height * 0.92, width * 0.38, height * 0.78);
    ctx.bezierCurveTo(width * 0.22, height * 0.58, width * 0.25, height * 0.34, cx, height * 0.08);
    ctx.closePath();
    return false;
  }
  if (kind === "gourdPendant") {
    ctx.beginPath();
    ctx.moveTo(cx, height * 0.08);
    ctx.bezierCurveTo(width * 0.72, height * 0.08, width * 0.72, height * 0.38, width * 0.58, height * 0.44);
    ctx.bezierCurveTo(width * 0.84, height * 0.56, width * 0.76, height * 0.92, cx, height * 0.94);
    ctx.bezierCurveTo(width * 0.24, height * 0.92, width * 0.16, height * 0.56, width * 0.42, height * 0.44);
    ctx.bezierCurveTo(width * 0.28, height * 0.38, width * 0.28, height * 0.08, cx, height * 0.08);
    ctx.closePath();
    return false;
  }
  if (kind === "beads") {
    ctx.beginPath();
    const count = 6;
    const bead = Math.min(width, height) * 0.18;
    for (let index = 0; index < count; index += 1) {
      const t = count === 1 ? 0.5 : index / (count - 1);
      const x = width * (0.18 + t * 0.64);
      const y = cy + Math.sin((t - 0.5) * Math.PI) * height * 0.08;
      ctx.moveTo(x + bead, y);
      ctx.arc(x, y, bead, 0, Math.PI * 2);
    }
    return false;
  }
  roundedRectPath(ctx, width * 0.24, height * 0.16, width * 0.52, height * 0.68, width * 0.16);
  return false;
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function productVisual(item) {
  const color = String(item?.color || item?.name || "");
  if (/紫|春/.test(color)) return { skin: "#c9c1d4", vein: "#8f78ba", translucency: 0.48, belt: true };
  if (/红|黄|翡/.test(color)) return { skin: "#d6c3ad", vein: "#c87858", translucency: 0.38, belt: true };
  if (/白|冰/.test(color)) return { skin: "#dce7df", vein: "#73b89b", translucency: 0.56, belt: true };
  return { skin: "#b8c9bd", vein: "#33a878", translucency: 0.5, belt: true };
}

function prepareCanvas(canvas, fallback) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || fallback.width));
  const height = Math.max(1, Math.round(rect.height || fallback.height));
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function fallbackSize(canvas, width, height) {
  if (canvas.classList?.contains("small")) return { width: 96, height: 78 };
  if (canvas.classList?.contains("finished")) return { width: 96, height: 96 };
  if (canvas.classList?.contains("planner")) return { width: 240, height: 148 };
  if (canvas.classList?.contains("slice")) return { width: 288, height: 176 };
  return { width, height };
}

function paintFallback(canvas) {
  const { ctx, width, height } = prepareCanvas(canvas, fallbackSize(canvas, 168, 122));
  ctx.fillStyle = "#d7eee4";
  ctx.fillRect(0, 0, width, height);
}

function roughPath(ctx, shape, width, height, seed = 1) {
  const points = roughOutlinePoints(shape, seed);
  const sx = width / ROUGH_VIEWBOX.width;
  const sy = height / ROUGH_VIEWBOX.height;
  const scaled = points.map((point) => ({ x: point.x * sx, y: point.y * sy }));
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const first = midpoint(scaled[scaled.length - 1], scaled[0]);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 0; i < scaled.length; i += 1) {
    const current = scaled[i];
    const next = scaled[(i + 1) % scaled.length];
    const mid = midpoint(current, next);
    ctx.quadraticCurveTo(current.x, current.y, mid.x, mid.y);
  }
  ctx.closePath();
}

function roughOutlinePoints(shape, seed) {
  const rng = seededRandom(seed + hashString(shape));
  const center = {
    x: shape === "long" ? 86 : shape === "round" ? 83 : 84,
    y: shape === "long" ? 70 : shape === "round" ? 72 : 68
  };
  const radius = shape === "long"
    ? { x: 70, y: 43 }
    : shape === "round"
      ? { x: 62, y: 54 }
      : { x: 66, y: 49 };
  const count = 18;
  return Array.from({ length: count }, (_, index) => {
    const angle = (Math.PI * 2 * index) / count;
    const local = 0.88 + rng() * 0.2 + Math.sin(angle * 3 + seed * 0.01) * 0.045;
    const shoulder = shape === "chunk" && index % 5 === 0 ? 1.08 : 1;
    const flat = shape === "long" && Math.abs(Math.sin(angle)) < 0.28 ? 0.94 : 1;
    return {
      x: center.x + Math.cos(angle) * radius.x * local * shoulder,
      y: center.y + Math.sin(angle) * radius.y * local * flat
    };
  });
}

function slicePath(ctx, board, width, height) {
  if (board && typeof board === "object" && (board.sourceSeed || board.sourceShape || Number.isFinite(board.sliceIndex))) {
    drawPointPath(ctx, sliceOutlinePoints(board), width / SLICE_VIEWBOX.width, height / SLICE_VIEWBOX.height, true);
    return;
  }
  const outlinePath = typeof board === "string" ? board : board?.outlinePath;
  if (outlinePath && drawSimpleSvgPath(ctx, outlinePath, width, height)) return;
  defaultSlicePath(ctx, width, height);
}

function sliceOutlinePoints(board = {}) {
  const shape = board.sourceShape || "chunk";
  const index = Number(board.sliceIndex || 0);
  const seed = Number(board.sourceSeed || board.seed || 1) + index * 211 + hashString(shape);
  const rng = seededRandom(seed);
  const longBias = shape === "long" ? 1 : shape === "round" ? -0.3 : 0.35;
  const left = 8 + rng() * 7 - longBias * 2;
  const right = 136 - rng() * 7 + longBias * 2;
  const top = 13 + rng() * 7 + (shape === "round" ? 3 : 0);
  const bottom = 87 - rng() * 7 - (shape === "long" ? 4 : 0);
  const shoulder = shape === "chunk" ? 5 : 2;
  return [
    { x: left + 3 + rng() * 5, y: 42 + (rng() - 0.5) * 10 },
    { x: 17 + rng() * 10, y: top + 12 + (rng() - 0.5) * 8 },
    { x: 39 + rng() * 11, y: top + (rng() - 0.5) * 7 },
    { x: 72 + (rng() - 0.5) * 12, y: top - shoulder + rng() * 8 },
    { x: 105 + rng() * 10, y: top + 4 + (rng() - 0.5) * 9 },
    { x: right - 8 + rng() * 5, y: 31 + (rng() - 0.5) * 12 },
    { x: right + (rng() - 0.5) * 6, y: 54 + (rng() - 0.5) * 13 },
    { x: right - 14 + rng() * 8, y: bottom - 6 + (rng() - 0.5) * 8 },
    { x: 91 + (rng() - 0.5) * 13, y: bottom + (rng() - 0.5) * 7 },
    { x: 55 + (rng() - 0.5) * 14, y: bottom + 3 + (rng() - 0.5) * 8 },
    { x: 25 + rng() * 10, y: bottom - 8 + (rng() - 0.5) * 9 },
    { x: left + (rng() - 0.5) * 5, y: 62 + (rng() - 0.5) * 12 }
  ];
}

function drawPointPath(ctx, points, sx, sy, smooth = true) {
  const scaled = points.map((point) => ({ x: point.x * sx, y: point.y * sy }));
  if (!smooth) {
    ctx.beginPath();
    ctx.moveTo(scaled[0].x, scaled[0].y);
    scaled.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.closePath();
    return;
  }
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const first = midpoint(scaled[scaled.length - 1], scaled[0]);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 0; i < scaled.length; i += 1) {
    const current = scaled[i];
    const next = scaled[(i + 1) % scaled.length];
    const mid = midpoint(current, next);
    ctx.quadraticCurveTo(current.x, current.y, mid.x, mid.y);
  }
  ctx.closePath();
}

function drawSimpleSvgPath(ctx, outlinePath, width, height) {
  const numbers = String(outlinePath).match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (numbers.length < 26) return false;
  const sx = width / SLICE_VIEWBOX.width;
  const sy = height / SLICE_VIEWBOX.height;
  let cursor = 0;
  ctx.beginPath();
  ctx.moveTo(numbers[cursor++] * sx, numbers[cursor++] * sy);
  while (cursor + 5 < numbers.length) {
    ctx.bezierCurveTo(
      numbers[cursor++] * sx,
      numbers[cursor++] * sy,
      numbers[cursor++] * sx,
      numbers[cursor++] * sy,
      numbers[cursor++] * sx,
      numbers[cursor++] * sy
    );
  }
  ctx.closePath();
  return true;
}

function defaultSlicePath(ctx, width, height) {
  const sx = width / SLICE_VIEWBOX.width;
  const sy = height / SLICE_VIEWBOX.height;
  ctx.beginPath();
  ctx.moveTo(10 * sx, 24 * sy);
  ctx.bezierCurveTo(28 * sx, 8 * sy, 104 * sx, 8 * sy, 130 * sx, 28 * sy);
  ctx.bezierCurveTo(143 * sx, 45 * sy, 133 * sx, 78 * sy, 110 * sx, 90 * sy);
  ctx.bezierCurveTo(72 * sx, 103 * sy, 25 * sx, 88 * sy, 10 * sx, 66 * sy);
  ctx.bezierCurveTo(0, 48 * sy, 1 * sx, 31 * sy, 10 * sx, 24 * sy);
  ctx.closePath();
}

function drawFlatSkinBlocks(ctx, rng, width, height, baseColor) {
  const colors = [
    withAlpha(mixColor(baseColor, "#ffffff", 0.16), 0.28),
    withAlpha(mixColor(baseColor, "#10231c", 0.24), 0.22),
    withAlpha(mixColor(baseColor, "#8aa48f", 0.18), 0.18)
  ];
  for (let i = 0; i < 8; i += 1) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath();
    ctx.ellipse(
      width * (0.18 + rng() * 0.66),
      height * (0.18 + rng() * 0.64),
      width * (0.05 + rng() * 0.12),
      height * (0.04 + rng() * 0.1),
      rng() * Math.PI,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
}

function drawFlatSpeckles(ctx, rng, width, height, count) {
  const total = Math.min(90, Math.max(28, Math.round(count * 0.55)));
  for (let i = 0; i < total; i += 1) {
    const light = rng() > 0.55;
    ctx.fillStyle = light ? "rgba(255,255,255,0.18)" : "rgba(20,31,27,0.16)";
    ctx.beginPath();
    ctx.arc(rng() * width, rng() * height, 0.7 + rng() * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRoughBand(ctx, seed, width, height, vein, angle) {
  ctx.save();
  ctx.translate(width * 0.5, height * 0.5);
  ctx.rotate((angle - 18) * Math.PI / 180);
  ctx.translate(-width * 0.5, -height * 0.5);
  flatBandSegments(seed, width, height).forEach((band, index) => {
    ctx.beginPath();
    ctx.moveTo(band.points[0].x, band.points[0].y);
    band.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.closePath();
    ctx.fillStyle = withAlpha(mixColor(vein, "#164f3e", index * 0.08), band.alpha);
    ctx.fill();
  });
  ctx.restore();
}

function drawJadeWindow(ctx, rng, width, height, vein, translucency, cotton) {
  const cx = width * 0.36;
  const cy = height * 0.36;
  const rx = width * 0.17;
  const ry = height * 0.11;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, -0.18, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = mixColor(vein, "#d8f7ea", 0.12 + translucency * 0.08);
  ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
  for (let i = 0; i < 3; i += 1) {
    ctx.fillStyle = withAlpha(mixColor(vein, i % 2 ? "#f2fff8" : "#0e5b45", 0.18), 0.16);
    ctx.beginPath();
    ctx.ellipse(
      cx + (rng() - 0.5) * rx * 1.2,
      cy + (rng() - 0.5) * ry * 0.9,
      rx * (0.18 + rng() * 0.22),
      ry * (0.16 + rng() * 0.24),
      rng() * Math.PI,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  drawCotton(ctx, rng, width, height, 80 - cotton * 60, { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 });
  ctx.restore();
}

function drawNaturalCrack(ctx, seed, width, height, angle, color, lineWidth, alpha) {
  const crack = flatCrackSegments(seed, width, height, angle);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = withAlpha(color, alpha);
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(crack.main[0].x, crack.main[0].y);
  crack.main.slice(1).forEach((point, index) => {
    const prev = crack.main[index];
    const mx = (prev.x + point.x) / 2;
    const my = (prev.y + point.y) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
  });
  const tail = crack.main[crack.main.length - 1];
  ctx.lineTo(tail.x, tail.y);
  ctx.stroke();

  ctx.strokeStyle = withAlpha(mixColor(color, "#ffffff", 0.16), alpha * 0.34);
  ctx.lineWidth = Math.max(0.45, lineWidth * 0.38);
  crack.branches.forEach((branch) => {
    ctx.beginPath();
    ctx.moveTo(branch[0].x, branch[0].y);
    ctx.quadraticCurveTo(
      (branch[0].x + branch[1].x) / 2,
      branch[0].y + (branch[1].y - branch[0].y) * 0.35,
      branch[1].x,
      branch[1].y
    );
    ctx.stroke();
  });
  ctx.restore();
}

function drawFracture(ctx, seed, width, height, angle, color, lineWidth, alpha) {
  const crack = flatCrackSegments(seed, width, height, angle);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(crack.main[0].x, crack.main[0].y);
  crack.main.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.strokeStyle = withAlpha(color, alpha);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  ctx.stroke();
  ctx.lineWidth = Math.max(1, lineWidth * 0.55);
  crack.branches.forEach((branch) => {
    ctx.beginPath();
    ctx.moveTo(branch[0].x, branch[0].y);
    ctx.lineTo(branch[1].x, branch[1].y);
    ctx.stroke();
  });
  ctx.restore();
}

function drawSliceGrain(ctx, rng, width, height, baseColor, angle) {
  ctx.save();
  ctx.translate(width * 0.5, height * 0.5);
  ctx.rotate(angle * Math.PI / 180);
  ctx.translate(-width * 0.5, -height * 0.5);
  for (let i = 0; i < 11; i += 1) {
    const y = height * (0.14 + i / 13) + (rng() - 0.5) * height * 0.05;
    const start = -width * 0.1 + rng() * width * 0.16;
    const mid = width * (0.24 + rng() * 0.34);
    const end = width * (0.68 + rng() * 0.5);
    ctx.beginPath();
    ctx.moveTo(start, y);
    ctx.lineTo(mid, y + (rng() - 0.5) * height * 0.06);
    ctx.lineTo(end, y + (rng() - 0.5) * height * 0.05);
    ctx.strokeStyle = withAlpha(baseColor, 0.16);
    ctx.lineWidth = 0.8 + rng() * 2.2;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.stroke();
  }
  ctx.restore();
}

function drawColorZones(ctx, width, height, zones, baseColor) {
  const seed = zones.reduce((sum, zone) => sum + Math.round((zone.cx || 0) * 13 + (zone.cy || 0) * 17 + (zone.rx || 0) * 19), 0);
  flatSliceBandPolygons(seed || 37, width, height, zones).forEach((band) => {
    ctx.beginPath();
    ctx.moveTo(band.points[0].x, band.points[0].y);
    band.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.closePath();
    ctx.fillStyle = withAlpha(mixColor(baseColor, band.tone % 2 ? "#0e5b45" : "#dff7eb", band.tone % 2 ? 0.16 : 0.08), band.alpha);
    ctx.fill();
  });
}

function drawVolumeColorVeins(ctx, volume, board, width, height, baseColor) {
  const bands = volumeSliceVeinPolygons(volume, board, width, height);
  bands.forEach((band) => {
    ctx.beginPath();
    ctx.moveTo(band.points[0].x, band.points[0].y);
    band.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.closePath();
    ctx.fillStyle = withAlpha(mixColor(baseColor, band.tone % 2 ? "#0e5b45" : "#dff7eb", band.tone % 2 ? 0.18 : 0.08), band.alpha);
    ctx.fill();
  });
}

function drawCotton(ctx, rng, width, height, clarity, bounds = { x: 0, y: 0, width, height }) {
  const count = Math.round(clamp(100 - clarity, 6, 42));
  ctx.save();
  ctx.lineCap = "butt";
  for (let i = 0; i < count; i += 1) {
    const x = bounds.x + rng() * bounds.width;
    const y = bounds.y + rng() * bounds.height;
    const len = bounds.width * (0.025 + rng() * 0.09);
    const angle = (rng() - 0.5) * 0.8;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len * 0.45, (rng() - 0.5) * bounds.height * 0.025);
    ctx.lineTo(len, (rng() - 0.5) * bounds.height * 0.035);
    ctx.strokeStyle = `rgba(255,255,255,${0.1 + rng() * 0.14})`;
    ctx.lineWidth = 0.7 + rng() * 0.9;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawBoardCottonThreads(ctx, width, height, threads) {
  const sx = width / SLICE_VIEWBOX.width;
  const sy = height / SLICE_VIEWBOX.height;
  ctx.save();
  ctx.lineCap = "round";
  threads.forEach((thread, index) => {
    const x = thread.x * sx;
    const y = thread.y * sy;
    const len = (thread.len || 18) * sx;
    const angle = (thread.angle || 0) * Math.PI / 180;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len * 0.44, (index % 2 ? 1 : -1) * sy * (1.4 + (index % 4)));
    ctx.lineTo(len, (index % 3 - 1) * sy * 2.2);
    ctx.strokeStyle = `rgba(255,255,255,${0.08 + (index % 4) * 0.025})`;
    ctx.lineWidth = 0.8 + (index % 3) * 0.35;
    ctx.stroke();
    ctx.restore();
  });
  ctx.restore();
}

function drawDirtySpots(ctx, rng, width, height, spots, score) {
  const generated = spots.length ? spots : Array.from({ length: Math.max(1, 5 - score) }, () => ({
    x: rng() * SLICE_VIEWBOX.width,
    y: rng() * SLICE_VIEWBOX.height,
    r: 1.6 + rng() * 3.8,
    opacity: 0.08 + rng() * 0.16
  }));
  generated.forEach((spot) => {
    ctx.fillStyle = `rgba(62,54,43,${spot.opacity || 0.12})`;
    ctx.beginPath();
    ctx.arc(spot.x * width / SLICE_VIEWBOX.width, spot.y * height / SLICE_VIEWBOX.height, (spot.r || 2.4) * width / SLICE_VIEWBOX.width, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawSliceFlaw(ctx, rng, width, height, flaw) {
  const x = (flaw.x || 40) * width / SLICE_VIEWBOX.width;
  const y = (flaw.y || 40) * height / SLICE_VIEWBOX.height;
  const len = (flaw.len || 18) * width / SLICE_VIEWBOX.width;
  const angle = (flaw.angle || 90) * Math.PI / 180;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  const points = Array.from({ length: 5 }, (_, index) => ({
    x: len * index / 4,
    y: (rng() - 0.5) * 6
  }));
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.strokeStyle = "rgba(92,54,54,0.7)";
  ctx.lineWidth = 1.2 + rng() * 1.1;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  ctx.stroke();
  for (let i = 1; i < points.length - 1; i += 2) {
    ctx.beginPath();
    ctx.moveTo(points[i].x, points[i].y);
    ctx.lineTo(points[i].x + len * (rng() > 0.5 ? 0.22 : -0.18), points[i].y + (rng() - 0.2) * 14);
    ctx.stroke();
  }
  ctx.restore();
}

function seededRandom(seed) {
  let value = Math.abs(Math.floor(seed)) || 1;
  return () => {
    value = value * 1664525 + 1013904223;
    return ((value >>> 0) % 1000000) / 1000000;
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < String(value).length; i += 1) {
    hash ^= String(value).charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rotatePoint(x, y, angle, cx, cy) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: cx + x * cos - y * sin,
    y: cy + x * sin + y * cos
  };
}

function hexToRgb(hex) {
  const clean = String(hex).replace("#", "");
  const value = clean.length === 3
    ? clean.split("").map((part) => part + part).join("")
    : clean.padEnd(6, "0").slice(0, 6);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function mixColor(a, b, amount) {
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  const t = clamp(amount, 0, 1);
  return `rgb(${Math.round(left.r + (right.r - left.r) * t)}, ${Math.round(left.g + (right.g - left.g) * t)}, ${Math.round(left.b + (right.b - left.b) * t)})`;
}

function withAlpha(color, alpha) {
  if (color.startsWith("rgb(")) return color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  const { r, g, b } = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
