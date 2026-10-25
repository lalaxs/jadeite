// Instance-owned implementation; legacy entry points remain one directory above.
import { PRODUCT_CATEGORIES, productMetaForKind, templateSizeForKind } from "../../../../shared/domain/jade/jade-categories.js";
import { buildOpeningStone, evaluateOpeningKit, computeGrade } from "../../../../shared/domain/jade/jade-opening-engine.js";
import { OPENING_KIT_BY_SERVER_TYPE, canonicalizeExtractionKitIntents } from "../../workshop-planning.js";
import { finishCapabilities } from "../../../systems/inlay-system.js";
import { isBlackmarketGoodsType } from "../../../../shared/domain/blackmarket/bm-constants.js";
import { makeCandidate } from "../../../systems/employee-system.js";
import { equipmentCatalog, createDeviceInstance } from "../../../systems/equipment-system.js";
import { NPC_PRICING_VERSION, NPC_PRICE_RANGES, quoteNpcGoods } from "../../../../shared/domain/blackmarket/npc-pricing.js";
import { BLACKMARKET_MIN_PRICE } from "../../../../shared/domain/blackmarket/bm-constants.js";

export function createNpcCatalog({
  createNpcOffcut,
  NPC_OFFCUT_POLICY_VERSION,
  completeNpcJadeAppearance,
  createNpcFinishPlan,
  applyNpcCraftScore,
  npcFinishSignature
}) {
function createResourceRow(rule, stall, now, { discount = false, premium = false }, deps) {
  const sequence = stall.npcSequence++;
  const rng = npcRandom(`${stall.id}:${sequence}:${stall.npcBatch}`);
  let item;
  if (rule.role === "employee") {
    const jobs = ["cutter", "planner", "finisher", "streamer"];
    const job = jobs.find((key) => !stall.items.some((row) => row.item.job === key)) || jobs[sequence % jobs.length];
    const tier = rng() < 0.06 ? 8 : 4 + Math.floor(rng() * 4);
    item = makeCandidate({ rng, makeId: deps.randomUUID, usedNames: new Set(stall.items.map((row) => row.item.name)), tier, job });
    delete item.price;
  } else {
    const stages = ["opening", "carving", "finishing"];
    const stage = stages.find((key) => stall.items.filter((row) => row.item.stage === key).length < 2) || stages[sequence % 3];
    const models = equipmentCatalog().filter((model) => model.stage === stage);
    const model = models[Math.floor(rng() * models.length)];
    item = createDeviceInstance(stage, model.modelKey, deps.randomUUID());
    item.condition = 40 + Math.floor(rng() * 56);
    delete item.workerId;
  }
  item.type = rule.role;
  item.resourceOrigin = "blackmarket";
  const row = { id: deps.randomUUID(), type: rule.role, item, npcDiscount: discount, npcPremium: premium, createdAt: now };
  repriceNpcGoodsRow(rule, row);
  return row;
}

const NPC_JADE_KINDS = Object.keys(PRODUCT_CATEGORIES).filter((kind) =>
  OPENING_KIT_BY_SERVER_TYPE[PRODUCT_CATEGORIES[kind].kitType] && finishCapabilities(kind));

const RING_SIZES = [52, 54, 56, 58, 60, 62];

const QUALITY_KEYS = ["bean", "glutinous", "stickyIce", "ice"];

function npcRandom(seed) {
  let state = 2166136261;
  for (const ch of String(seed)) state = Math.imul(state ^ ch.charCodeAt(0), 16777619);
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function repriceNpcGoodsRow(rule, row) {
  if (row.npcPricingVersion === NPC_PRICING_VERSION) return false;
  if (row.type === "equipment") {
    const model = equipmentCatalog().find((entry) => entry.modelKey === row.item.modelKey && entry.stage === row.item.stage);
    if (model) row.item.basePrice = model.price;
  }
  const quote = quoteNpcGoods(row.npcSupplyRole || rule.role, row.type, row.item, {
    discount: row.npcDiscount === true,
    roll: npcRandom(`npc-price:${NPC_PRICING_VERSION}:${rule.role}:${row.id}`)()
  });
  row.price = quote.price;
  row.referencePrice = quote.referencePrice;
  const availability = row.npcDiscount ? "本批清仓，售完等下一批" : row.npcPremium ? "限量高货，按品质估值" : "常规现货，限量供应";
  const resourceNote = row.type === "employee" ? "；签约当天记薪，保留全部技能，后续可在黑市转聘。"
    : row.type === "equipment" ? "；按当前耐久交付，可维修、可再次挂牌。" : "";
  row.note = availability + resourceNote;
  row.npcPricingVersion = NPC_PRICING_VERSION;
  return true;
}

function jadeItem(role, sequence, rng, deps, avoidOffcutProfile, avoidOffcutCount, premium = false, finishOptions = {}) {
  const qualities = premium ? ["highIce", "glass"] : QUALITY_KEYS;
  const qualityKey = qualities[sequence % qualities.length];
  const rough = deps.makeRoughStone({ qualityKey, mass: 0.7 + (sequence % 5) * 0.3, rng });
  rough.type = "rough";
  if (role === "stone" && sequence % 2 === 0) return rough;
  const material = deps.revealPolishedRough(rough);
  if (role === "stone") return material;
  if (role === "offcut" && sequence % 3 === 0) {
    return createNpcOffcut(material, rng, deps, avoidOffcutProfile, avoidOffcutCount);
  }
  if (role === "offcut" && sequence % 3 === 1) {
    // Modern carving consumes opened stone maps; a slice remains an opened, plannable item.
    return { ...material, type: "slice", stage: "material", name: `${material.quality}${material.color}片料`, baseValue: material.value };
  }
  // Whole pieces and extracted pieces use the same source map and evaluator as workshop planning.
  const candidates = NPC_JADE_KINDS.filter((kind) => !finishOptions.excludeKinds?.includes(kind));
  const kinds = candidates.length ? candidates : NPC_JADE_KINDS;
  const kind = kinds[Math.floor(rng() * kinds.length)];
  const category = PRODUCT_CATEGORIES[kind];
  const size = kind === "bracelet" ? undefined : ["S", "M", "L"][Math.floor(rng() * 3)];
  const ringSize = kind === "bracelet" ? RING_SIZES[Math.floor(rng() * RING_SIZES.length)] : undefined;
  const intent = canonicalizeExtractionKitIntents([{ type: category.kitType, x: 50, y: 50, size, ringSize }], { makeId: deps.randomUUID });
  if (!intent.ok) throw new Error(`NPC extraction rejected: ${intent.message}`);
  const stone = buildOpeningStone({ seed: `${rough.id}:${rough.visual.seed}`, qualityKey, quality: material.quality, color: material.color });
  const normalized = intent.kits[0];
  const kit = { tpl: normalized.openingTpl, x: normalized.x * 6, y: normalized.y * 6, rot: normalized.rot, scale: normalized.scale };
  let evaluation = evaluateOpeningKit(kit, stone);
  for (const x of [240, 360]) {
    for (const y of [240, 360]) {
      const candidate = evaluateOpeningKit({ ...kit, x, y }, stone);
      if (candidate.price > evaluation.price) { kit.x = x; kit.y = y; evaluation = candidate; }
    }
  }
  const value = Math.max(1, evaluation.price);
  const placement = { id: normalized.id, layout: kind, openingTpl: kit.tpl, kitType: category.kitType, x: kit.x / 6, y: kit.y / 6, rot: 0, scale: kit.scale, size, ringSize, templateSize: templateSizeForKind(kind), svgSpace: false };
  const finished = role !== "offcut";
  const meta = productMetaForKind(kind, { size, ringSize });
  const item = {
    id: deps.randomUUID(), type: "bracelet", kind, jadeKind: kind,
    name: `${material.quality}${material.color}${meta.label}${finished ? "" : "毛坯"}`,
    baseName: `${material.quality}${material.color}${meta.label}`,
    qualityKey, quality: material.quality, color: material.color, score: material.score,
    design: meta.label, ringSize, size, count: 1, value, baseValue: value, price: value,
    rep: Math.max(1, Math.round((material.rep || 1) * meta.rep)),
    materialStage: "carved", stage: "carved",
    polished: false, inlaid: false, plan: placement, sourceRoughId: rough.id,
    openingEval: { price: evaluation.price, crackRatio: evaluation.crackRatio, wasteRatio: evaluation.wasteRatio, avgCv: evaluation.avgCv, avgRar: evaluation.avgRar },
    openingGrade: computeGrade(evaluation, stone),
    sourceMaterial: { roughId: rough.id, roughName: rough.name, visual: rough.visual, openingSeed: rough.visual.seed, qualityKey, quality: material.quality, color: material.color, placement, windows: [] }
  };
  completeNpcJadeAppearance(item);
  const finishPlan = finished ? createNpcFinishPlan(item, rng, finishOptions) : null;
  applyNpcCraftScore(item, rng, finishPlan, premium);
  if (finished) {
    item.materialStage = item.stage = "finished";
    completeNpcJadeAppearance(item, { preserveValue: false, finishPlan });
    const motif = meta.label.replace(/挂件$/u, "");
    item.name = `${material.quality}${material.color}${motif}${item.inlay?.productTypeName || ""}`;
  }
  item.price = item.value;
  return item;
}

function createNpcSingleRoleGoodsRow(rule, stall, now, { discount = false, premium = false, excludeKinds = [], preferredStyles = [] } = {}, deps) {
  if (!NPC_PRICE_RANGES[rule.role]) throw new Error("Unsupported NPC black-market category");
  if (["employee", "equipment"].includes(rule.role)) return createResourceRow(rule, stall, now, { discount, premium }, deps);
  let sequence = stall.npcSequence++;
  let rng = npcRandom(`${stall.id}:${sequence}:${stall.npcBatch}`);
  const previousOffcut = [...(stall.items || [])].reverse().find((row) => row.item.npcOffcut)?.item;
  const avoidProfile = previousOffcut?.npcOffcut.profile;
  const avoidCount = previousOffcut?.extractionKits.length;
  const role = rule.role === "traveler" ? "finished" : rule.role;
  const finishOptions = { supplierRole: rule.role, excludeKinds, preferredStyles,
    avoidSignatures: (stall.items || []).map((row) => npcFinishSignature(row.item)).filter(Boolean) };
  let item = jadeItem(role, sequence, rng, deps, avoidProfile, avoidCount, premium, finishOptions);
  let reference = Number(item.value ?? item.price);
  const minimumReference = Math.ceil(BLACKMARKET_MIN_PRICE / NPC_PRICE_RANGES[rule.role][discount ? "discount" : "ordinary"][0]);
  for (let attempt = 0; reference < minimumReference && attempt < 12; attempt += 1) {
    sequence = stall.npcSequence++;
    rng = npcRandom(`${stall.id}:${sequence}:${stall.npcBatch}`);
    item = jadeItem(role, sequence, rng, deps, avoidProfile, avoidCount, premium, finishOptions);
    reference = Number(item.value ?? item.price);
  }
  if (reference < minimumReference) throw new Error("NPC supplier could not source a usable jade item");
  if (!isBlackmarketGoodsType(item.type)) throw new Error("NPC stock must use player-tradable goods categories");
  const row = { id: deps.randomUUID(), type: item.type, item, npcDiscount: discount, npcPremium: premium, createdAt: now };
  repriceNpcGoodsRow(rule, row);
  return row;
}

function createNpcGoodsRow(rule, stall, now, flags, deps) {
  const role = rule.assortment?.[stall.npcSequence % rule.assortment.length] || rule.role;
  const row = createNpcSingleRoleGoodsRow({ ...rule, role }, stall, now, flags, deps);
  row.npcSupplyRole = role;
  return row;
}

function upgradeNpcOffcutRow(row, deps, previousOffcut) {
  const item = row.item;
  if (!item?.leftover) return false;
  if (item.npcOffcut?.version === 2 && item.npcOffcut.policyVersion === NPC_OFFCUT_POLICY_VERSION) {
    if (!Number.isFinite(item.rep)) { item.rep = 0; return true; }
    return false;
  }
  const ratio = Math.max(0.01, Number(item.remainingRatio) || 1);
  const material = { ...item, value: item.npcOffcut?.sourceValue ?? item.value / ratio, baseValue: item.npcOffcut?.sourceBaseValue ?? (item.baseValue ?? item.value) / ratio, mass: item.npcOffcut?.sourceMass ?? (item.mass || 1) / ratio };
  const multiplier = row.price / Math.max(1, row.referencePrice || item.value);
  row.item = createNpcOffcut(material, npcRandom(`offcut-v2-policy-${NPC_OFFCUT_POLICY_VERSION}:${item.id}`), deps, previousOffcut?.npcOffcut.profile, previousOffcut?.extractionKits.length);
  row.referencePrice = row.item.value;
  row.price = Math.max(100, Math.round(row.referencePrice * Math.max(0.8, Math.min(1.2, multiplier))));
  delete row.npcPricingVersion;
  return true;
}

  return {
    NPC_JADE_KINDS,
    npcRandom,
    repriceNpcGoodsRow,
    createNpcGoodsRow,
    upgradeNpcOffcutRow
  };
}
