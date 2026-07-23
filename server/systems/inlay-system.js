const SETTINGS = {
  claw: { name: "爪镶", grams: 1.5, labor: 200, metals: ["gold18k", "platinum"] },
  bezel: { name: "包镶", grams: 2.5, labor: 300, metals: ["goldPure", "silver925", "gold18k", "platinum"] },
  micro: { name: "微镶/钉镶", grams: 3.0, labor: 800, metals: ["gold18k", "platinum"] },
  channel: { name: "槽镶", grams: 2.0, labor: 500, metals: ["gold18k", "platinum"] },
  invisible: { name: "无边镶", grams: 3.5, labor: 1200, metals: ["gold18k", "platinum"] },
  cord: { name: "编绳/配链", grams: 0, labor: 20, metals: [] }
};

const METAL_VALUE = {
  goldPure: 0.15,
  silver925: 0.03,
  gold18k: 0.20,
  platinum: 0.25
};

const POLISH = {
  bright: { labor: 50, value: 0.05 },
  soft: { labor: 30, value: 0.02 },
  matte: { labor: 0, value: 0 }
};

const BACKING = {
  open: { labor: 0, value: 0, trust: 0 },
  closed: { labor: 100, value: 0.03, trust: -0.20 }
};

const SHAPE_SETTINGS = {
  cabochon: ["claw", "bezel", "micro", "channel", "invisible", "cord"],
  carving: ["claw", "bezel", "micro", "cord"],
  pierced: ["bezel", "cord"],
  whole: ["cord"]
};

const PRODUCT_TYPES = {
  cabochon: ["ring", "pendant", "earring"],
  carving: ["pendant", "earring"],
  pierced: ["pendant"],
  whole: ["bracelet", "handpiece"]
};

const GEMS = new Set(["diamond", "ruby", "sapphire"]);

function itemShape(item) {
  const key = String(item?.kind || item?.design || "").toLowerCase();
  if (["cabochon", "egg", "saddle", "蛋面"].includes(key)) return "cabochon";
  if ([
    "buddha", "buddhapendant", "guanyin", "guanyinpendant", "leaf", "leafpendant",
    "gourd", "gourdpendant", "fubean", "fubeanpendant", "droppendant", "ruyipendant",
    "carving", "雕件"
  ].includes(key)) return "carving";
  if (["peacependant", "plaque", "pierced", "平安扣", "无事牌", "山水牌"].includes(key)) return "pierced";
  if (["bangle", "bead", "beads", "seal", "whole", "bracelet", "手镯", "珠链", "印章"].includes(key)) return "whole";
  return null;
}

function failure(code, message) {
  return { ok: false, code, message };
}

export function validateFinishPlan(item, plan) {
  const shape = itemShape(item);
  if (!shape || !plan || typeof plan !== "object") {
    return failure("INVALID_COMBINATION", "无法识别该套件的精加工形态。");
  }
  const setting = SETTINGS[plan.settingId];
  if (!PRODUCT_TYPES[shape].includes(plan.productType)) {
    return failure("INVALID_COMBINATION", "该套件不能制作所选成品类型。");
  }
  if (!setting || !SHAPE_SETTINGS[shape].includes(plan.settingId)) {
    return failure("INVALID_COMBINATION", "该套件不支持所选镶嵌方式。");
  }
  const gemCount = Number(plan.gemCount);
  if (!Number.isInteger(gemCount) || gemCount < 0 || gemCount > 12) {
    return failure("INVALID_QUANTITY", "配石数量必须为 0～12 颗。");
  }
  if (gemCount === 0 && plan.gemId != null) {
    return failure("INVALID_COMBINATION", "不配石时不能选择宝石。");
  }
  if (gemCount > 0 && !GEMS.has(plan.gemId)) {
    return failure("INVALID_COMBINATION", "请选择有效的配石材料。");
  }
  if (plan.settingId === "cord") {
    if (plan.metalId != null) {
      return failure("INVALID_COMBINATION", "编绳工艺不使用金属。");
    }
  } else if (!setting.metals.includes(plan.metalId)) {
    return failure("INVALID_COMBINATION", "所选金属不适用于该镶嵌方式。");
  }
  if (!POLISH[plan.polishId]) {
    return failure("INVALID_COMBINATION", "请选择有效的抛光方式。");
  }
  const backingAllowed = shape === "cabochon" && plan.productType === "ring";
  if (backingAllowed && !BACKING[plan.backingId]) {
    return failure("INVALID_COMBINATION", "蛋面戒指必须选择底托方式。");
  }
  if (!backingAllowed && plan.backingId != null) {
    return failure("INVALID_COMBINATION", "当前成品不支持底托选项。");
  }
  return { ok: true, shape };
}

export function quoteFinishPlan(item, plan) {
  const validation = validateFinishPlan(item, plan);
  if (!validation.ok) return validation;
  const setting = SETTINGS[plan.settingId];
  const polish = POLISH[plan.polishId];
  const backing = plan.backingId ? BACKING[plan.backingId] : BACKING.open;
  const gemCount = Number(plan.gemCount);
  const metalAmount = Number(
    (setting.grams * (1 + gemCount * 0.05)).toFixed(2)
  );
  const laborFee = setting.labor + gemCount * 80 + polish.labor + backing.labor;
  const valueMultiplier = Number((
    1 +
    (plan.metalId ? METAL_VALUE[plan.metalId] : 0) +
    gemCount * 0.05 +
    polish.value +
    backing.value
  ).toFixed(2));
  return {
    metalId: plan.metalId,
    metalAmount,
    gemId: plan.gemId,
    gemCount,
    laborFee,
    valueMultiplier,
    trustModifier: backing.trust
  };
}

function round2(value) {
  return Number(Number(value).toFixed(2));
}

export function reserveFinishMaterials(player, quote) {
  const materials = player?.externalMaterials;
  if (!materials) {
    return failure("INSUFFICIENT_MATERIAL", "镶嵌材料库存不存在。");
  }
  if (quote.metalId && Number(materials[quote.metalId] || 0) < quote.metalAmount) {
    return failure("INSUFFICIENT_MATERIAL", "金属材料不足。");
  }
  if (quote.gemCount > 0 && Number(materials[quote.gemId] || 0) < quote.gemCount) {
    return failure("INSUFFICIENT_MATERIAL", "配石库存不足。");
  }
  const reservedMaterials = {};
  if (quote.metalId) {
    materials[quote.metalId] = round2(
      Number(materials[quote.metalId]) - quote.metalAmount
    );
    reservedMaterials[quote.metalId] = quote.metalAmount;
  }
  if (quote.gemCount > 0) {
    materials[quote.gemId] = Number(materials[quote.gemId]) - quote.gemCount;
    reservedMaterials[quote.gemId] = quote.gemCount;
  }
  return { ok: true, reservedMaterials };
}

export function refundFinishMaterials(player, reservedMaterials = {}) {
  player.externalMaterials ||= {};
  for (const [key, amount] of Object.entries(reservedMaterials)) {
    player.externalMaterials[key] = round2(
      Number(player.externalMaterials[key] || 0) + Number(amount)
    );
  }
}

const LABELS = {
  productType: {
    ring: "戒指",
    pendant: "吊坠",
    earring: "耳坠",
    bracelet: "手链",
    handpiece: "把件"
  },
  metal: {
    goldPure: "足金24K",
    silver925: "925银",
    gold18k: "18K金",
    platinum: "铂金PT950"
  },
  gem: {
    diamond: "配石钻石",
    ruby: "红宝石",
    sapphire: "蓝宝石"
  },
  polish: {
    bright: "亮光",
    soft: "柔光",
    matte: "哑光"
  },
  backing: {
    open: "透底",
    closed: "封底"
  }
};

export function inlayCatalog() {
  return structuredClone({
    settings: SETTINGS,
    metals: LABELS.metal,
    metalValues: METAL_VALUE,
    gems: LABELS.gem,
    polishes: POLISH,
    polishNames: LABELS.polish,
    backings: BACKING,
    backingNames: LABELS.backing,
    productTypes: PRODUCT_TYPES,
    productTypeNames: LABELS.productType,
    shapeSettings: SHAPE_SETTINGS
  });
}

export function applyInlay(product, plan, quote) {
  product.value = Math.round(Number(product.value || 0) * quote.valueMultiplier);
  product.inlaid = true;
  product.polished = true;
  product.inlay = {
    ...structuredClone(plan),
    productTypeName: LABELS.productType[plan.productType],
    settingName: SETTINGS[plan.settingId].name,
    metalName: plan.metalId ? LABELS.metal[plan.metalId] : null,
    gemName: plan.gemId ? LABELS.gem[plan.gemId] : null,
    polishName: LABELS.polish[plan.polishId],
    backingName: plan.backingId ? LABELS.backing[plan.backingId] : null,
    metalAmount: quote.metalAmount,
    laborFee: quote.laborFee,
    valueMultiplier: quote.valueMultiplier,
    trustModifier: quote.trustModifier
  };
  return product;
}
