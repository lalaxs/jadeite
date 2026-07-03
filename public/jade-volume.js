const TAU = Math.PI * 2;

export function createJadeVolume(item = {}) {
  const visual = item.visual || {};
  const seed = Number(visual.seed || hashString(item.id || item.name || "jade-volume"));
  const rng = seededRandom(seed);
  const shape = visual.shape || "chunk";
  const veinColor = visual.vein || "#3f9b71";
  const skinColor = visual.skin || "#6f776d";
  const beltAngle = normalizeAngle(visual.beltAngle ?? item.board?.sourceBeltAngle ?? 18);
  const veinCount = Math.max(2, Math.min(4, Math.round((Number(item.score || 2) + 1) / 2)));
  const veins = Array.from({ length: veinCount }, (_, index) => makeVein(seed, rng, beltAngle, index, veinCount));
  return {
    seed,
    shape,
    veinColor,
    skinColor,
    beltAngle,
    crackAngle: normalizeAngle(visual.crackAngle ?? item.board?.sourceCrackAngle ?? 102),
    translucency: clamp(Number(visual.translucency ?? 0.42), 0.08, 0.95),
    cotton: clamp(Number(visual.cotton ?? 0.38), 0.04, 0.9),
    veins
  };
}

export function sampleJadeVolume(volume, x, y, z) {
  const nx = clamp(Number(x), 0, 1);
  const ny = clamp(Number(y), 0, 1);
  const nz = clamp(Number(z), 0, 1);
  const green = clamp(volume.veins.reduce((strongest, vein) => Math.max(strongest, sampleVein(vein, nx, ny, nz)), 0), 0, 1);
  const cottonSeed = Math.floor(volume.seed + nx * 997 + ny * 577 + nz * 271);
  const cottonNoise = valueNoise(cottonSeed, nx * 5.2, ny * 5.8, nz * 4.1);
  const clarityNoise = valueNoise(cottonSeed + 449, nx * 9.4, ny * 7.1, nz * 6.2);
  return {
    green,
    cotton: clamp(volume.cotton * (0.45 + cottonNoise * 0.75), 0, 1),
    clarity: clamp(1 - volume.cotton * 0.52 + clarityNoise * 0.16, 0, 1),
    translucency: clamp(volume.translucency + green * 0.14 - volume.cotton * 0.08, 0, 1)
  };
}

export function volumeSliceVeinPolygons(volume, board = {}, width = 288, height = 176) {
  const sliceIndex = Math.max(0, Number(board.sliceIndex || 0));
  const sliceCount = Math.max(1, Number(board.sliceCount || 1));
  const z = sliceCount === 1 ? 0.5 : 0.16 + (sliceIndex / Math.max(1, sliceCount - 1)) * 0.68;
  const ribbons = volume.veins
    .map((vein, index) => veinRibbonAtSlice(volume, vein, index, z, width, height))
    .filter((ribbon) => ribbon && ribbon.alpha > 0.12)
    .sort((a, b) => b.alpha - a.alpha)
    .slice(0, 3);
  return ribbons.length ? ribbons : [fallbackRibbon(volume, z, width, height)];
}

function makeVein(seed, rng, beltAngle, index, count) {
  const angle = (beltAngle + (rng() - 0.5) * 18) * Math.PI / 180;
  const side = index - (count - 1) / 2;
  const offset = side * (0.12 + rng() * 0.04) + (rng() - 0.5) * 0.08;
  const zDrift = (rng() - 0.5) * 0.36;
  const thickness = 0.055 + rng() * 0.045 + index * 0.006;
  const wobble = 0.04 + rng() * 0.05;
  return {
    seed: seed + index * 919,
    angle,
    offset,
    zDrift,
    thickness,
    wobble,
    strength: 0.55 + rng() * 0.42
  };
}

function sampleVein(vein, x, y, z) {
  const dx = x - 0.5;
  const dy = y - 0.5;
  const along = dx * Math.cos(vein.angle) + dy * Math.sin(vein.angle);
  const cross = -dx * Math.sin(vein.angle) + dy * Math.cos(vein.angle);
  const depth = z - 0.5;
  const drift = Math.sin((along * 2.6 + depth * 1.8 + vein.seed * 0.0007) * TAU) * vein.wobble;
  const depthDrift = depth * vein.zDrift;
  const distance = Math.abs(cross - vein.offset - drift - depthDrift);
  const falloff = Math.max(0, 1 - distance / vein.thickness);
  const broken = 0.72 + valueNoise(vein.seed + 73, x * 7.2, y * 5.6, z * 4.8) * 0.38;
  return clamp(falloff * falloff * vein.strength * broken, 0, 1);
}

function veinRibbonAtSlice(volume, vein, veinIndex, z, width, height) {
  const rng = seededRandom(vein.seed + Math.round(z * 1000));
  const samples = 7;
  const center = [];
  const halfBase = height * (0.035 + vein.thickness * 0.72);
  const alphaProbe = sampleVein(vein, 0.5, 0.5, z);
  for (let index = 0; index < samples; index += 1) {
    const t = index / (samples - 1);
    const x = 0.04 + t * 0.92;
    const along = t - 0.5;
    const depth = z - 0.5;
    const cross = vein.offset
      + Math.sin((along * 2.6 + depth * 1.8 + vein.seed * 0.0007) * TAU) * vein.wobble
      + depth * vein.zDrift;
    const px = x * width;
    const py = clamp((0.5 + cross) * height + (rng() - 0.5) * height * 0.045, height * 0.08, height * 0.92);
    center.push({ x: px, y: py, t });
  }
  const top = center.map((point, index) => {
    const sample = sampleJadeVolume(volume, point.x / width, point.y / height, z);
    const half = halfBase * (0.7 + sample.green * 0.55 + Math.sin(index * 1.7 + vein.seed) * 0.08);
    return { x: point.x + (rng() - 0.5) * width * 0.018, y: point.y - half };
  });
  const bottom = center.toReversed().map((point, index) => {
    const sample = sampleJadeVolume(volume, point.x / width, point.y / height, z);
    const half = halfBase * (0.62 + sample.green * 0.52 + Math.cos(index * 1.3 + vein.seed) * 0.08);
    return { x: point.x + (rng() - 0.5) * width * 0.018, y: point.y + half };
  });
  const maxGreen = Math.max(...center.map((point) => sampleJadeVolume(volume, point.x / width, point.y / height, z).green), alphaProbe);
  return {
    points: [...top, ...bottom],
    alpha: clamp(maxGreen * (0.46 + veinIndex * 0.08), 0.08, 0.68),
    tone: veinIndex,
    z
  };
}

function fallbackRibbon(volume, z, width, height) {
  const rng = seededRandom(volume.seed + 1209);
  const y = height * (0.45 + (rng() - 0.5) * 0.16 + (z - 0.5) * 0.12);
  const points = [
    { x: width * 0.08, y: y - height * 0.045 },
    { x: width * 0.32, y: y - height * (0.075 + rng() * 0.03) },
    { x: width * 0.68, y: y - height * (0.04 + rng() * 0.035) },
    { x: width * 0.92, y: y + height * 0.015 },
    { x: width * 0.72, y: y + height * (0.065 + rng() * 0.03) },
    { x: width * 0.28, y: y + height * (0.046 + rng() * 0.025) }
  ];
  return { points, alpha: 0.18, tone: 0, z };
}

function valueNoise(seed, x, y, z) {
  const a = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 0.013) * 43758.5453;
  return a - Math.floor(a);
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

function normalizeAngle(value) {
  const angle = Number(value);
  if (!Number.isFinite(angle)) return 0;
  return ((angle % 180) + 180) % 180;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
