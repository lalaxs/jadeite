export const PRODUCT_CATEGORIES = {
  bracelet: {
    label: "手镯",
    kitType: "bangle",
    kitLabel: "手镯套件",
    short: "镯",
    w: 34,
    h: 34,
    mult: 1.58,
    rep: 1,
    radius: 14
  },
  cabochon: {
    label: "蛋面",
    kitType: "cabochon",
    kitLabel: "蛋面套件",
    short: "蛋",
    w: 22,
    h: 28,
    mult: 0.72,
    rep: 0.58,
    radius: 7
  },
  peacePendant: {
    label: "平安扣挂件",
    kitType: "peacePendant",
    kitLabel: "平安扣挂件",
    short: "扣",
    w: 30,
    h: 30,
    mult: 0.98,
    rep: 0.66,
    radius: 12
  },
  ruyiPendant: {
    label: "如意挂件",
    kitType: "ruyiPendant",
    kitLabel: "如意挂件",
    short: "如",
    w: 32,
    h: 30,
    mult: 1.02,
    rep: 0.68,
    radius: 11
  },
  leafPendant: {
    label: "叶子挂件",
    kitType: "leafPendant",
    kitLabel: "叶子挂件",
    short: "叶",
    w: 24,
    h: 36,
    mult: 0.9,
    rep: 0.62,
    radius: 10
  },
  dropPendant: {
    label: "水滴挂件",
    kitType: "dropPendant",
    kitLabel: "水滴挂件",
    short: "滴",
    w: 24,
    h: 36,
    mult: 0.92,
    rep: 0.62,
    radius: 10
  },
  plaque: {
    label: "无字牌",
    kitType: "plaque",
    kitLabel: "无字牌套件",
    short: "牌",
    w: 30,
    h: 32,
    mult: 0.94,
    rep: 0.64,
    radius: 9
  },
  buddhaPendant: {
    label: "佛公挂件",
    kitType: "buddhaPendant",
    kitLabel: "佛公挂件",
    short: "佛",
    w: 28,
    h: 38,
    mult: 1.08,
    rep: 0.72,
    radius: 9
  },
  guanyinPendant: {
    label: "观音挂件",
    kitType: "guanyinPendant",
    kitLabel: "观音挂件",
    short: "观",
    w: 26,
    h: 42,
    mult: 1.12,
    rep: 0.76,
    radius: 9
  },
  fuBeanPendant: {
    label: "福豆挂件",
    kitType: "fuBeanPendant",
    kitLabel: "福豆挂件",
    short: "豆",
    w: 22,
    h: 36,
    mult: 0.88,
    rep: 0.6,
    radius: 8
  },
  gourdPendant: {
    label: "葫芦挂件",
    kitType: "gourdPendant",
    kitLabel: "葫芦挂件",
    short: "葫",
    w: 24,
    h: 34,
    mult: 0.9,
    rep: 0.62,
    radius: 8
  },
  beads: {
    label: "珠串",
    kitType: "beads",
    kitLabel: "珠串套件",
    short: "珠",
    w: 42,
    h: 18,
    mult: 1.04,
    rep: 0.64,
    radius: 8
  }
};

export const EXTRACTION_KITS = {
  bangle: {
    label: "手镯套件",
    short: "镯",
    productKind: "bracelet",
    cost: 680,
    w: 34,
    h: 34,
    slots: [{ dx: 0, dy: 0, layout: "bracelet" }]
  },
  cabochon: {
    label: "蛋面套件",
    short: "蛋",
    productKind: "cabochon",
    cost: 520,
    w: 22,
    h: 28,
    slots: [{ dx: 0, dy: 0, layout: "cabochon" }]
  },
  peacePendant: {
    label: "平安扣挂件",
    short: "扣",
    productKind: "peacePendant",
    cost: 580,
    w: 30,
    h: 30,
    slots: [{ dx: 0, dy: 0, layout: "peacePendant" }]
  },
  ruyiPendant: {
    label: "如意挂件",
    short: "如",
    productKind: "ruyiPendant",
    cost: 600,
    w: 32,
    h: 30,
    slots: [{ dx: 0, dy: 0, layout: "ruyiPendant" }]
  },
  leafPendant: {
    label: "叶子挂件",
    short: "叶",
    productKind: "leafPendant",
    cost: 560,
    w: 24,
    h: 36,
    slots: [{ dx: 0, dy: 0, layout: "leafPendant" }]
  },
  dropPendant: {
    label: "水滴挂件",
    short: "滴",
    productKind: "dropPendant",
    cost: 560,
    w: 24,
    h: 36,
    slots: [{ dx: 0, dy: 0, layout: "dropPendant" }]
  },
  plaque: {
    label: "无字牌套件",
    short: "牌",
    productKind: "plaque",
    cost: 540,
    w: 30,
    h: 32,
    slots: [{ dx: 0, dy: 0, layout: "plaque" }]
  },
  buddhaPendant: {
    label: "佛公挂件",
    short: "佛",
    productKind: "buddhaPendant",
    cost: 660,
    w: 28,
    h: 38,
    slots: [{ dx: 0, dy: 0, layout: "buddhaPendant" }]
  },
  guanyinPendant: {
    label: "观音挂件",
    short: "观",
    productKind: "guanyinPendant",
    cost: 720,
    w: 26,
    h: 42,
    slots: [{ dx: 0, dy: 0, layout: "guanyinPendant" }]
  },
  fuBeanPendant: {
    label: "福豆挂件",
    short: "豆",
    productKind: "fuBeanPendant",
    cost: 520,
    w: 22,
    h: 36,
    slots: [{ dx: 0, dy: 0, layout: "fuBeanPendant" }]
  },
  gourdPendant: {
    label: "葫芦挂件",
    short: "葫",
    productKind: "gourdPendant",
    cost: 540,
    w: 24,
    h: 34,
    slots: [{ dx: 0, dy: 0, layout: "gourdPendant" }]
  },
  beads: {
    label: "珠串套件",
    short: "珠",
    productKind: "beads",
    cost: 620,
    w: 42,
    h: 18,
    slots: [{ dx: 0, dy: 0, layout: "beads" }]
  }
};

export const KIT_DEFAULT_POSITIONS = {
  bangle: { x: 50, y: 50 },
  cabochon: { x: 18, y: 18 },
  peacePendant: { x: 20, y: 82 },
  ruyiPendant: { x: 80, y: 82 },
  leafPendant: { x: 88, y: 18 },
  dropPendant: { x: 68, y: 18 },
  plaque: { x: 50, y: 18 },
  buddhaPendant: { x: 18, y: 50 },
  guanyinPendant: { x: 82, y: 50 },
  fuBeanPendant: { x: 35, y: 30 },
  gourdPendant: { x: 65, y: 30 },
  beads: { x: 50, y: 82 }
};

export const SMALL_PIECE_KINDS = [
  "cabochon",
  "peacePendant",
  "ruyiPendant",
  "leafPendant",
  "dropPendant",
  "plaque",
  "buddhaPendant",
  "guanyinPendant",
  "fuBeanPendant",
  "gourdPendant",
  "beads"
];

export const KIND_LABELS = Object.fromEntries(
  Object.entries(PRODUCT_CATEGORIES).map(([kind, category]) => [kind, category.label])
);

export function productKindLabel(kind) {
  return PRODUCT_CATEGORIES[kind]?.label || "成品";
}

export function kitLayout(type) {
  return EXTRACTION_KITS[type]?.productKind || "bracelet";
}

export function kitProductKind(type) {
  return kitLayout(type);
}

export function templateSizeForKind(kind) {
  const category = PRODUCT_CATEGORIES[kind] || PRODUCT_CATEGORIES.bracelet;
  return { w: category.w, h: category.h };
}

export function templateSizeForKit(type) {
  const kit = EXTRACTION_KITS[type] || EXTRACTION_KITS.bangle;
  return { w: kit.w, h: kit.h };
}

export function productMetaForKind(kind, placement = {}) {
  const category = PRODUCT_CATEGORIES[kind] || PRODUCT_CATEGORIES.peacePendant;
  return {
    label: kind === "bracelet" ? `${placement.ringSize || 56}圈口手镯` : category.label,
    mult: category.mult,
    rep: category.rep,
    count: 1
  };
}

export function placementRadiusForKind(kind, placement = {}) {
  if (kind === "bracelet") {
    const ringSize = Number(placement.ringSize) || 56;
    return Math.max(12, Math.min(18, 12 + (ringSize - 52) * 0.55));
  }
  return PRODUCT_CATEGORIES[kind]?.radius || 10;
}

export function isSmallPieceKind(kind) {
  return SMALL_PIECE_KINDS.includes(kind);
}
