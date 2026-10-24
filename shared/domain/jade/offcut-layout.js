import { openingStoneOutline, openingKitOutline, scaleForOpeningKit, evaluateOpeningKit } from "./jade-opening-engine.js";
import { pointInOutline, distanceToOutline, transformOutline, outlinesSeparated } from "./outline-geometry.js";

const TYPES = { egg: "cabochon", rect: "plaque", leaf: "leafPendant", drop: "dropPendant" };
const SHAPES = Object.keys(TYPES);
const SIZES = ["S", "M", "L"];

export const storedOffcutKit = (kit) => ({ ...kit, tpl: kit.openingTpl, x: kit.x * 6, y: kit.y * 6 });
const transformedCache = new WeakMap();
export function offcutKitOutline(kit) {
  if (!transformedCache.has(kit)) transformedCache.set(kit, transformOutline(openingKitOutline(kit.tpl), kit));
  return transformedCache.get(kit);
}

export function kitFitsRemainingStone(kit, stone, consumed = [], margin = 2, gap = 2) {
  const polygon = offcutKitOutline(kit);
  const boundary = openingStoneOutline(stone);
  if (!polygon.every(([x, y]) => pointInOutline(x, y, boundary) && distanceToOutline(x, y, boundary) >= margin)) return false;
  return consumed.every((other) => outlinesSeparated(polygon, offcutKitOutline(other), gap));
}

export function createOffcutLayout(stone, rng, makeId, { avoidProfile = null, avoidCount = null } = {}) {
  const boundary = openingStoneOutline(stone);
  const width = Math.max(...boundary.map((p) => p[0])) - Math.min(...boundary.map((p) => p[0]));
  const margin = width * (0.03 + rng() * 0.02);
  const gap = width * 0.03;
  const roll = rng();
  let targetCount = roll < 0.25 ? 1 : roll < 0.55 ? 2 : roll < 0.85 ? 2 + Math.floor(rng() * 2) : 3 + Math.floor(rng() * 3);
  if (targetCount === avoidCount) targetCount = targetCount === 1 ? 2 : targetCount - 1;
  for (let attempt = 0; attempt < 36; attempt += 1) {
    const count = attempt < 20 ? targetCount : attempt < 28 ? Math.max(1, targetCount - 1) : 1;
    const reserveAngle = rng() * Math.PI * 2;
    const reserveRadius = count >= 3 ? 15 : 140;
    const usableKit = { tpl: "egg", x: 300 + Math.cos(reserveAngle) * reserveRadius, y: 300 + Math.sin(reserveAngle) * reserveRadius, rot: Math.floor(rng() * 180), scale: scaleForOpeningKit("egg", "S"), size: "S" };
    if (!kitFitsRemainingStone(usableKit, stone, [], margin) || evaluateOpeningKit(usableKit, stone).price <= 0) continue;
    const cuts = [];
    for (let index = 0; index < count; index += 1) {
      const available = count > 1 && index === 1 ? SHAPES.filter((tpl) => tpl !== cuts[0]?.tpl) : SHAPES;
      const tpl = available[Math.floor(rng() * available.length)];
      // Merchant cuts use the same size presets as player planning. Remaining
      // area is measured afterwards instead of enlarging cuts to fill a quota.
      const size = SIZES[Math.floor(rng() * SIZES.length)];
      const scale = scaleForOpeningKit(tpl, size);
      let placed = null;
      for (let trial = 0; trial < 65; trial += 1) {
        const angle = reserveAngle + index * Math.PI * 2 / count + (rng() - 0.5) * 0.4;
        const radius = 120 + rng() * 35;
        const nested = count >= 3 && trial < 24;
        const kit = { tpl, x: nested ? 300 + Math.cos(angle) * radius : 145 + rng() * 310, y: nested ? 300 + Math.sin(angle) * radius : 145 + rng() * 310, rot: nested ? Math.round((angle * 180 / Math.PI + 720) % 180) % 180 : Math.floor(rng() * 180), scale, size };
        if (kitFitsRemainingStone(kit, stone, [...cuts, usableKit], margin, gap)) { placed = kit; break; }
      }
      if (!placed) break;
      cuts.push(placed);
    }
    if (cuts.length !== count) continue;
    const profile = cuts.map((kit) => kit.tpl).sort().join("+");
    if (count === avoidCount || (profile === avoidProfile && attempt < 28)) continue;
    return {
      kits: cuts.map((kit) => ({ id: makeId(), type: TYPES[kit.tpl], openingTpl: kit.tpl, x: kit.x / 6, y: kit.y / 6, rot: kit.rot, scale: kit.scale, size: kit.size })),
      profile, usableKit, margin, gap
    };
  }
  // A compact fallback guarantees a different count without clipping a large layout.
  for (let index = 0; index < 24; index += 1) {
    const angle = index * Math.PI / 12;
    const count = avoidCount === 1 ? 2 : 1;
    const cuts = Array.from({ length: count }, (_, i) => {
      const tpl = i === 1 ? "egg" : "rect";
      const size = SIZES[index % SIZES.length];
      const offset = count === 1 ? 0 : i === 0 ? -95 : 95;
      return { tpl, x: 300 + offset * Math.cos(angle), y: 300 + offset * Math.sin(angle), rot: index * 15 % 180,
        scale: scaleForOpeningKit(tpl, size), size };
    });
    const usableKit = { tpl: "egg", x: 300 - Math.sin(angle) * 150, y: 300 + Math.cos(angle) * 150, rot: 0, scale: scaleForOpeningKit("egg", "S"), size: "S" };
    const safeMargin = width * 0.03;
    if (!kitFitsRemainingStone(usableKit, stone, cuts, safeMargin, gap) || evaluateOpeningKit(usableKit, stone).price <= 0
      || !cuts.every((kit, i) => kitFitsRemainingStone(kit, stone, cuts.filter((_, j) => i !== j), safeMargin, gap))) continue;
    return { kits: cuts.map((kit) => ({ id: makeId(), type: TYPES[kit.tpl], openingTpl: kit.tpl, x: kit.x / 6, y: kit.y / 6, rot: kit.rot, scale: kit.scale, size: kit.size })),
      profile: cuts.map((kit) => kit.tpl).sort().join("+"), usableKit, margin: safeMargin, gap };
  }
  throw new Error("Could not source a usable offcut layout inside the stone boundary");
}
