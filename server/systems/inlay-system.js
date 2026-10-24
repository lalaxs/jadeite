import { FULL_HALO, SETTING_GEMS, MAX_FINISH_GEMS, finishedMotifKind, finishGemPolicy, resolveFinishGemCount, normalizeFinishGemLayout, finishMetalScale, finishPieceRestriction } from "../../shared/domain/workshop/finished-product-design.js";
import { isBangle, BANGLE_REFINEMENTS, BANGLE_POLISHES, validateBangleFinishPlan, quoteBangleFinish, applyBangleFinish } from "../../shared/domain/workshop/bangle-finish.js";
import { INLAY_MATERIAL_UNIT_VALUES, inlayValueBreakdown } from "../../shared/domain/workshop/inlay-value.js";

export const SETTINGS = {
  claw: { name: "爪镶", grams: 1.5, labor: 200, value: 0.03, metals: ["gold18k", "platinum"] },
  bezel: { name: "包镶", grams: 2.5, labor: 300, value: 0.05, metals: ["goldPure", "silver925", "gold18k", "platinum"] },
  micro: { name: "微镶/钉镶", grams: 3.0, labor: 800, value: 0.12, metals: ["gold18k", "platinum"] },
  channel: { name: "槽镶", grams: 2.0, labor: 500, value: 0.08, metals: ["gold18k", "platinum"] },
  invisible: { name: "无边镶", grams: 3.5, labor: 1200, value: 0.16, metals: ["gold18k", "platinum"] },
  cord: { name: "编绳/配链", grams: 0, labor: 20, value: 0.02, metals: [] }
};

const METAL_VALUE = {
  goldPure: 0.22,
  silver925: 0.03,
  gold18k: 0.20,
  platinum: 0.25
};

const GEM_VALUE_PER_STONE = {
  diamond: 0.06,
  ruby: 0.04,
  sapphire: 0.04
};

const METAL_BONUS_PER_GRAM = {
  goldPure: 700,
  silver925: 30,
  gold18k: 500,
  platinum: 600
};

const GEM_BONUS_PER_STONE = {
  diamond: 260,
  ruby: 140,
  sapphire: 140
};

const VALUE_BONUS_BASE = 1200;
const VALUE_BONUS_LABOR_RATE = 0.6;

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
  bangle: []
};

const PRODUCT_TYPES = {
  cabochon: ["ring", "pendant"],
  carving: ["pendant"],
  pierced: ["pendant"],
  bangle: ["bangle"]
};

const GEMS = new Set(["diamond", "ruby", "sapphire"]);

function itemShape(item) {
  if (isBangle(item)) return "bangle";
  const key = String(item?.jadePiece?.kind || item?.motifKind || item?.sourceMaterial?.placement?.layout || item?.plan?.layout || item?.kind || item?.design || "").toLowerCase();
  if (["cabochon", "egg", "saddle", "蛋面"].includes(key)) return "cabochon";
  if ([
    "buddha", "buddhapendant", "guanyin", "guanyinpendant", "leaf", "leafpendant",
    "gourd", "gourdpendant", "fubean", "fubeanpendant", "droppendant", "ruyipendant",
    "carving", "雕件"
  ].includes(key)) return "carving";
  if (["peacependant", "plaque", "pierced", "平安扣", "无事牌", "山水牌"].includes(key)) return "pierced";
  return null;
}

export function finishCapabilities(kind) {
  const shape = itemShape({ kind });
  return shape ? { settings: SHAPE_SETTINGS[shape], products: PRODUCT_TYPES[shape] } : null;
}

function failure(code, message) {
  return { ok: false, code, message };
}

/** Strip transport-only or forged fields before validation and persistence. */
export function canonicalizeFinishPlan(item, rawPlan) {
  if (!rawPlan || typeof rawPlan !== "object" || Array.isArray(rawPlan)) {
    return failure("INVALID_COMBINATION", "精加工方案格式无效。");
  }
  if (isBangle(item)) {
    if (!validateBangleFinishPlan(rawPlan)) return failure("INVALID_COMBINATION", "请选择有效的手镯精修档次与抛光效果，手镯精修不使用镶嵌配件。");
    const plan = { process: "bangle", productType: "bangle", refinementId: rawPlan.refinementId, polishId: rawPlan.polishId };
    return { ok: true, shape: "bangle", plan };
  }
  const optionalId = (value) => (
    typeof value === "string" && value.trim() ? value.trim() : null
  );
  const requiredId = (value) => (
    typeof value === "string" ? value.trim() : ""
  );
  const gemCount = typeof rawPlan.gemCount === "number"
    || typeof rawPlan.gemCount === "string"
    ? Number(rawPlan.gemCount)
    : Number.NaN;
  const plan = {
    productType: requiredId(rawPlan.productType),
    settingId: requiredId(rawPlan.settingId),
    metalId: optionalId(rawPlan.metalId),
    gemId: optionalId(rawPlan.gemId),
    gemCount,
    polishId: requiredId(rawPlan.polishId),
    backingId: optionalId(rawPlan.backingId)
  };
  if (rawPlan.gemLayout != null && ![FULL_HALO, SETTING_GEMS].includes(rawPlan.gemLayout)) return failure("INVALID_COMBINATION", "配石排布方式无效。");
  // All new submissions use current rules, even if a stale/forged client sends
  // the old halo mode. Persisted jobs/products keep their recorded version.
  plan.gemLayout = SETTING_GEMS;
  normalizeFinishGemLayout(item, plan);
  const validation = validateFinishPlan(item, plan);
  return validation.ok ? { ...validation, plan } : validation;
}

export function validateFinishPlan(item, plan) {
  if (isBangle(item)) return validateBangleFinishPlan(plan)
    ? { ok: true, shape: "bangle" } : failure("INVALID_COMBINATION", "手镯精修方案无效。");
  const shape = itemShape(item);
  if (!shape || !plan || typeof plan !== "object") {
    return failure("INVALID_COMBINATION", "无法识别该套件的精加工形态。");
  }
  const setting = SETTINGS[plan.settingId];
  if (!PRODUCT_TYPES[shape].includes(plan.productType)) {
    return failure("INVALID_COMBINATION", "该套件不能制作所选成品类型。");
  }
  const restriction = finishPieceRestriction(item, plan.productType);
  if (restriction) return failure("INVALID_COMBINATION", restriction);
  if (!setting || !SHAPE_SETTINGS[shape].includes(plan.settingId)) {
    return failure("INVALID_COMBINATION", "该套件不支持所选镶嵌方式。");
  }
  const gemCount = Number(plan.gemCount);
  const maxGems = [FULL_HALO, SETTING_GEMS].includes(plan.gemLayout) ? MAX_FINISH_GEMS : 12;
  if (!Number.isInteger(gemCount) || gemCount < 0 || gemCount > maxGems) {
    return failure("INVALID_QUANTITY", "配石数量无效。");
  }
  if (plan.gemLayout === SETTING_GEMS) {
    const policy = finishGemPolicy(plan);
    if (policy.required && !plan.gemId) return failure("INVALID_COMBINATION", "微镶需选择配石种类。");
    if (!policy.supports && plan.gemId) return failure("INVALID_COMBINATION", "此镶嵌方式不使用配石。");
    if (gemCount !== resolveFinishGemCount(item, plan)) return failure("INVALID_QUANTITY", "配石数量与镶嵌石座不一致。");
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

export function quoteFinishPlan(item, plan, workerFee = 0) {
  if (isBangle(item)) return validateFinishPlan(item, plan).ok ? quoteBangleFinish(item, plan) : validateFinishPlan(item, plan);
  plan = normalizeFinishGemLayout(item, { ...plan });
  const validation = validateFinishPlan(item, plan);
  if (!validation.ok) return validation;
  const setting = SETTINGS[plan.settingId];
  const polish = POLISH[plan.polishId];
  const backing = plan.backingId ? BACKING[plan.backingId] : BACKING.open;
  const gemCount = Number(plan.gemCount);
  const metalAmount = Number(
    (setting.grams * finishMetalScale(item) * (1 + gemCount * 0.05)).toFixed(2)
  );
  const craftLaborFee = setting.labor + gemCount * 80 + polish.labor + backing.labor;
  const nominalValueMultiplier = Number((
    1 +
    Number(setting.value || 0) +
    (plan.metalId ? METAL_VALUE[plan.metalId] : 0) +
    gemCount * Number(GEM_VALUE_PER_STONE[plan.gemId] || 0) +
    polish.value +
    backing.value
  ).toFixed(2));
  const itemValue = Math.max(0, Number(item?.value ?? item?.price) || 0);
  const valueBreakdown = inlayValueBreakdown({ baseValue: itemValue,
    metalId: plan.metalId, metalAmount, gemId: plan.gemId, gemCount,
    craftValueRate: Number(setting.value || 0) + Number(polish.value || 0) + Number(backing.value || 0),
    craftLabor: craftLaborFee, valueBonusBase: VALUE_BONUS_BASE, valueBonusLaborRate: VALUE_BONUS_LABOR_RATE });
  return {
    metalId: plan.metalId,
    metalAmount,
    gemId: plan.gemId,
    gemCount,
    workerFee: 0,
    craftLaborFee: 0,
    laborFee: 0,
    nominalValueMultiplier,
    ...valueBreakdown,
    trustModifier: backing.trust
  };
}

function round2(value) {
  return Number(Number(value).toFixed(2));
}

export function reserveFinishMaterials(player, quote) {
  if (!quote.metalId && !quote.gemId) return { ok: true, reservedMaterials: {}, reservedMaterialCosts: {} };
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
  const reservedMaterialCosts = {};
  const reserveCost = (key, quantity) => {
    const stock = Number(materials[key]) || 0;
    const pool = player.externalMaterialCosts?.[key];
    const aligned = pool && Math.abs(Number(pool.quantity) - stock) < 0.001;
    const amount = aligned ? Number(pool.amount || 0) * quantity / stock : 0;
    reservedMaterialCosts[key] = { amount, complete: Boolean(aligned && pool.complete === true) };
    if (aligned) {
      pool.quantity = round2(stock - quantity);
      pool.amount = Math.max(0, Number(pool.amount || 0) - amount);
    }
  };
  if (quote.metalId) {
    reserveCost(quote.metalId, quote.metalAmount);
    materials[quote.metalId] = round2(
      Number(materials[quote.metalId]) - quote.metalAmount
    );
    reservedMaterials[quote.metalId] = quote.metalAmount;
  }
  if (quote.gemCount > 0) {
    reserveCost(quote.gemId, quote.gemCount);
    materials[quote.gemId] = Number(materials[quote.gemId]) - quote.gemCount;
    reservedMaterials[quote.gemId] = quote.gemCount;
  }
  return { ok: true, reservedMaterials, reservedMaterialCosts };
}

export function refundFinishMaterials(player, reservedMaterials = {}, reservedMaterialCosts = {}) {
  player.externalMaterials ||= {};
  for (const [key, amount] of Object.entries(reservedMaterials)) {
    const stock = Number(player.externalMaterials[key] || 0);
    player.externalMaterialCosts ||= {};
    const pool = player.externalMaterialCosts[key];
    const returned = reservedMaterialCosts[key];
    const aligned = pool && Math.abs(Number(pool.quantity) - stock) < 0.001;
    player.externalMaterialCosts[key] = {
      quantity: round2(stock + Number(amount)),
      amount: (aligned ? Number(pool.amount) || 0 : 0) + (Number(returned?.amount) || 0),
      complete: Boolean((stock === 0 || (aligned && pool.complete)) && returned?.complete)
    };
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
    bangle: "手镯"
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
  const selectableProducts = new Set(Object.values(PRODUCT_TYPES).flat());
  return structuredClone({
    settings: SETTINGS,
    metals: LABELS.metal,
    metalValues: METAL_VALUE,
    metalBonusPerGram: METAL_BONUS_PER_GRAM,
    gems: LABELS.gem,
    gemValues: GEM_VALUE_PER_STONE,
    gemBonusPerStone: GEM_BONUS_PER_STONE,
    valueBonusBase: VALUE_BONUS_BASE,
    valueBonusLaborRate: VALUE_BONUS_LABOR_RATE,
    materialUnitValues: INLAY_MATERIAL_UNIT_VALUES,
    polishes: POLISH,
    polishNames: LABELS.polish,
    backings: BACKING,
    backingNames: LABELS.backing,
    productTypes: PRODUCT_TYPES,
    productTypeNames: Object.fromEntries(Object.entries(LABELS.productType).filter(([id]) => selectableProducts.has(id))),
    shapeSettings: SHAPE_SETTINGS,
    bangleRefinements: BANGLE_REFINEMENTS, banglePolishes: BANGLE_POLISHES
  });
}

function productTemplateSize(product) {
  const size = product?.templateSize;
  if (!size || typeof size !== "object") return null;
  const w = Number(size.w);
  const h = Number(size.h);
  return Number.isFinite(w) && Number.isFinite(h) ? { w, h } : null;
}

export function buildInlayComponents(product, plan, quote = {}) {
  plan = normalizeFinishGemLayout(product, { ...plan });
  const components = [{
    type: "jade",
    role: "mainStone",
    pieceId: product.jadePiece?.id || product.id,
    kind: finishedMotifKind(product),
    polishId: plan.polishId,
    sourceMaterial: product?.sourceMaterial ? structuredClone(product.sourceMaterial) : null,
    templateSize: productTemplateSize(product)
  }];

  if (plan.settingId === "cord") {
    components.push({
      type: "cord",
      role: "hanger",
      productType: plan.productType,
      settingId: plan.settingId,
      polishId: plan.polishId
    });
  } else {
    components.push({
      type: "mount",
      role: "setting",
      productType: plan.productType,
      settingId: plan.settingId,
      metalId: plan.metalId,
      backingId: plan.backingId || null,
      metalAmount: quote.metalAmount || 0
    });
  }

  if (Number(plan.gemCount || 0) > 0) {
    components.push({
      type: "accentStones",
      role: plan.gemLayout === SETTING_GEMS ? finishGemPolicy(plan).kind : plan.settingId === "channel" ? "channel" : "halo",
      gemId: plan.gemId,
      count: Number(plan.gemCount || 0),
      layout: plan.gemLayout || "legacy"
    });
  }

  return components;
}

export function applyInlay(product, plan, quote) {
  // Saved legacy bangle jobs retain their original quote and geometry.
  if (isBangle(product)) return applyBangleFinish(product, plan, quote);
  plan = normalizeFinishGemLayout(product, { ...plan });
  const components = buildInlayComponents(product, plan, quote);
  const baseValue = Number(product.value || 0);
  const oldBonus = Math.max(0, Number(product.finishValueBonus) || 0);
  const nextBonus = Number.isFinite(Number(quote.valueBonus)) ? Math.max(0, Number(quote.valueBonus))
    : Math.max(0, Math.round(baseValue * (Number(quote.valueMultiplier || 1) - 1)));
  product.value = Math.round(baseValue + Math.max(oldBonus, nextBonus) - oldBonus);
  product.finishValueBonus = Math.max(oldBonus, nextBonus);
  product.inlaid = true;
  product.polished = true;
  product.productType = plan.productType;
  product.motifKind = product.motifKind || product.sourceMaterial?.placement?.layout || product.plan?.layout || product.kind;
  product.kind = product.motifKind;
  product.components = components;
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
    valueBonus: quote.valueBonus,
    materialCost: quote.materialCost,
    materialValue: quote.materialValue,
    processingValue: quote.processingValue,
    trustModifier: quote.trustModifier
  };
  return product;
}
