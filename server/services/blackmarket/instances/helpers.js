// Instance-owned implementation; legacy entry points remain one directory above.
import { findInventoryItem, inventoryEntries, restoreInventoryItem, takeInventoryItem } from "../../inventory-items.js";
import {
  BLACKMARKET_MIN_PRICE,
  BLACKMARKET_GOODS_TYPES,
  BLACKMARKET_BLIND_MIN,
  BLACKMARKET_RATING_TTL_MS
} from "../../../../shared/domain/blackmarket/bm-constants.js";
import {
  EXTRACTION_KITS,
  productMetaForKind
} from "../../../../shared/domain/jade/jade-categories.js";
import {
  buildOpeningStone,
  computeOverlaps,
  evaluateOpeningKit,
  evaluateLeftoverMaterial,
  computeGrade as computeOpeningGrade,
  scaleForOpeningKit
} from "../../../../shared/domain/jade/jade-opening-engine.js";
import {
  OPENING_KIT_BY_SERVER_TYPE,
  canonicalizeExtractionKitIntents
} from "../../workshop-planning.js";
import { isNpcBlackStall } from "../../../../shared/domain/blackmarket/npc-rules.js";
import { kitFitsRemainingStone } from "../../../../shared/domain/jade/offcut-layout.js";
import { captureExtractedJadePiece } from "../../../../shared/domain/workshop/finished-product-design.js";
import { isBlackmarketResource } from "../../../../shared/domain/blackmarket/bm-resources.js";
import { distributeItemCost } from "../../../../shared/domain/economy/item-cost.js";
import { registerFinanceItem } from "../../../../shared/domain/economy/finance-book.js";

export function createHelpers({
  requireApi,
  lockResource,
  unlockResource
}) {
const STALL_TYPES = new Set(["goods", "blindbox", "service"]);

const ITEM_TYPES = new Set(BLACKMARKET_GOODS_TYPES);

const PLAN_LIST_TYPES = new Set(["planned", "leftover"]);

const MASK_PREFIXES = ["夜摊", "雾影", "暗柜", "无牌", "隐客", "墨市"];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function blackMaskForPlayerId(playerId) {
  const id = String(playerId || "");
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = Math.abs(h) >>> 0;
  const prefix = MASK_PREFIXES[u % MASK_PREFIXES.length];
  const tag = u.toString(16).toUpperCase().slice(-4).padStart(4, "0");
  return {
    maskKey: `bm:${u.toString(16)}`,
    maskName: `${prefix}·${tag}`
  };
}

function findStallByOwner(state, playerId) {
  const id = String(playerId || "");
  return (state.blackStalls || []).find((s) => s.ownerId === id) || null;
}

function findStallById(state, stallId) {
  return (state.blackStalls || []).find((s) => s.id === stallId) || null;
}

function stallDisplayName(stall) {
  if (stall.anonymous) return stall.maskName || "匿名摊主";
  return stall.ownerName || "掌柜";
}

function pushPendingRatings(buyer, seller, meta) {
  const { randomUUID } = requireApi();
  const now = Date.now();
  const expiresAt = now + BLACKMARKET_RATING_TTL_MS;
  const tradeId = meta.tradeId || randomUUID();
  const base = {
    tradeId,
    tradeKind: meta.tradeKind || "goods",
    stallTitle: meta.stallTitle || "",
    itemLabel: meta.itemLabel || "",
    itemName: meta.itemName || meta.itemLabel || "",
    price: Number(meta.price) || 0,
    note: String(meta.note || "").trim().slice(0, 120),
    inputItemName: meta.inputItemName || "",
    anonymous: meta.anonymous === true,
    createdAt: now,
    expiresAt
  };
  buyer.pendingBmRatings = buyer.pendingBmRatings || [];
  seller.pendingBmRatings = seller.pendingBmRatings || [];
  buyer.pendingBmRatings.push({
    ...base,
    id: randomUUID(),
    counterpartyId: seller.id,
    counterpartyName: seller.name,
    role: "buyer"
  });
  seller.pendingBmRatings.push({
    ...base,
    id: randomUUID(),
    counterpartyId: buyer.id,
    counterpartyName: buyer.name,
    role: "seller"
  });
}

function pushSellerPayout(seller, amount, label, stall) {
  const { randomUUID } = requireApi();
  seller.blackPayouts = seller.blackPayouts || [];
  seller.blackPayouts.push({
    id: randomUUID(),
    itemName: label,
    amount,
    at: Date.now(),
    maskName: stall?.maskName,
    anonymous: stall?.anonymous === true
  });
}

function paySellerNow(
  seller,
  amount,
  label,
  { source = "blackmarket-sale", afterCommit, financeCategory } = {}
) {
  const { earnCash, notifyPlayerToast } = requireApi();
  if (!seller) return 0;
  const paid = earnCash(seller, amount, label, { source, financeCategory });
  requireApi().queueOfflineEvent?.(seller, { type: "blackmarket", text: `${label}，成交金额 ${requireApi().uiMoney(amount)}，货款已结算。`, income: amount });
  if (typeof notifyPlayerToast === "function") {
    const notify = () => notifyPlayerToast(seller, `${label}，成交金额 ${requireApi().uiMoney(amount)}，货款已结算。`);
    if (typeof afterCommit === "function") afterCommit(notify);
    else notify();
  }
  return paid;
}

function removeStallFromState(state, stall) {
  const list = state.blackStalls;
  if (!Array.isArray(list) || !stall) return false;
  const idx = list.findIndex((row) => row === stall || row?.id === stall.id);
  if (idx < 0) return false;
  list.splice(idx, 1);
  return true;
}

function closeGoodsStallIfEmpty(state, stall, { force = false, afterCommit } = {}) {
  const { addNews, notifyPlayerToast } = requireApi();
  if (!stall || stall.type !== "goods") return false;
  if (isNpcBlackStall(stall)) return false;
  if ((stall.items || []).length > 0) return false;
  if (!force && stall.status === "setup") return false;
  if (!removeStallFromState(state, stall)) return false;
  addNews("黑市有摊位收摊了。", "trade");
  const owner = state.players?.get?.(stall.ownerId);
  if (owner && typeof notifyPlayerToast === "function") {
    const notify = () => notifyPlayerToast(owner, "货架已售空清空，摊位已自动收摊。");
    if (typeof afterCommit === "function") afterCommit(notify);
    else notify();
  }
  return true;
}

function returnItemToPlayer(player, type, item) {
  if (isBlackmarketResource(type)) return unlockResource(player, type, item.id);
  restoreInventoryItem(player, type, item);
}

function clampBm(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function findParentInPlayer(player, parentId) {
  const id = String(parentId || "");
  if (!id) return null;
  for (const type of ["material", "rough"]) {
    const item = findInventoryItem(player, type, id);
    if (item) return { type, item };
  }
  return null;
}

function canonicalizeBmKits(rawKits, randomUUID) {
  return canonicalizeExtractionKitIntents(rawKits, {
    maxKits: 10,
    makeId: randomUUID,
    requireIds: true
  });
}

function bmKitSignature(kits) {
  return JSON.stringify(
    [...kits]
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((kit) => ({
        id: kit.id,
        type: kit.type,
        openingTpl: kit.openingTpl,
        x: kit.x,
        y: kit.y,
        rot: kit.rot,
        scale: kit.scale,
        size: kit.size,
        ringSize: kit.ringSize
      }))
  );
}

function openingStoneForParent(parent) {
  return buildOpeningStone({
    seed: `${parent.id}:${parent.openingSeed || parent.visual?.openingSeed || parent.visual?.seed || parent.id}`,
    roughId: parent.id,
    qualityKey: parent.qualityKey,
    quality: parent.quality,
    color: parent.color
  });
}

function openingKitFromBmKit(kit) {
  const tpl = kit.openingTpl || OPENING_KIT_BY_SERVER_TYPE[kit.type] || "bangle";
  const sizeVal = tpl === "bangle"
    ? (Number(kit.ringSize) || 56)
    : (["S", "M", "L"].includes(kit.size) ? kit.size : "M");
  return {
    uid: kit.id,
    tpl,
    x: clampBm(Number(kit.x) || 50, 4, 96) * 6,
    y: clampBm(Number(kit.y) || 50, 4, 96) * 6,
    rot: Number(kit.rot || 0),
    scale: Number(kit.scale || scaleForOpeningKit(tpl, sizeVal)),
    size: sizeVal
  };
}

function buildPlannedProductFromKit(parent, kit, randomUUID, money) {
  const stone = openingStoneForParent(parent);
  const openingKit = openingKitFromBmKit(kit);
  const openingEval = evaluateOpeningKit(openingKit, stone);
  const openingGrade = computeOpeningGrade(openingEval, stone);
  const template = EXTRACTION_KITS[kit.type] || EXTRACTION_KITS.bangle;
  const slot = template.slots?.[0] || { layout: kit.type || "bangle" };
  const productMeta = productMetaForKind(slot.layout, {
    ringSize: kit.ringSize,
    size: kit.size
  });
  const value = money(Math.max(1, Number(openingEval.price) || Math.round(Number(parent.value || parent.price || 1000) / 3)));
  const product = {
    id: randomUUID(),
    type: "bracelet",
    kind: slot.layout || kit.type,
    name: `${parent.quality || ""}${parent.color || ""}${productMeta.label || "规划产物"}`,
    qualityKey: parent.qualityKey,
    quality: parent.quality,
    score: parent.score,
    color: parent.color,
    design: productMeta.label || "规划产物",
    ringSize: kit.ringSize,
    size: kit.size,
    value,
    price: value,
    materialStage: "carved",
    stage: "carved",
    sourceRoughId: parent.id,
    openingGrade,
    openingEval: {
      price: openingEval.price,
      crackRatio: openingEval.crackRatio,
      wasteRatio: openingEval.wasteRatio,
      avgCv: openingEval.avgCv,
      avgRar: openingEval.avgRar
    },
    sourceMaterial: {
      roughId: parent.id,
      roughName: parent.name,
      visual: parent.visual,
      openingSeed: parent.openingSeed || parent.visual?.openingSeed,
      windows: parent.windows || [],
      qualityKey: parent.qualityKey,
      quality: parent.quality,
      color: parent.color,
      placement: {
        id: kit.id,
        openingTpl: kit.openingTpl,
        kitType: kit.type,
        x: kit.x,
        y: kit.y,
        rot: kit.rot,
        scale: kit.scale,
        size: kit.size,
        ringSize: kit.ringSize
      }
    },
    _fromPlanSplit: true
  };
  product.jadePiece = captureExtractedJadePiece(product, stone, openingKit);
  return product;
}

function buildLeftoverMaterial(parent, kits, randomUUID, money) {
  const stone = openingStoneForParent(parent);
  const openingKits = kits.map(openingKitFromBmKit);
  const withinStone = parent.leftoverGeometryVersion === 2;
  const leftoverEval = evaluateLeftoverMaterial(openingKits, stone, { withinStone });
  const leftoverGrade = computeOpeningGrade(leftoverEval, stone);
  const remainingRatio = Math.max(0, Math.min(1, Number(leftoverEval.remainRatio) || 0));
  const parentValue = Math.max(0, Number(parent.value ?? parent.price) || 0);
  const parentBaseValue = Math.max(0, Number(parent.baseValue ?? parentValue) || 0);
  const priorKits = withinStone ? (parent.extractionKits || parent.braceletPlacements || []).map(openingKitFromBmKit) : [];
  const wholeEval = withinStone ? evaluateLeftoverMaterial(priorKits, stone, { withinStone }) : null;
  const valueRatio = wholeEval?.price > 0 ? Math.min(1, leftoverEval.price / wholeEval.price) : remainingRatio;
  const value = money(Math.max(1, parentValue * valueRatio));
  const baseValue = money(Math.max(1, parentBaseValue * valueRatio));
  return {
    id: withinStone ? parent.id : randomUUID(),
    type: "material",
    name: `${parent.name || "明料"}·余料`,
    materialStage: "opened",
    stage: "material",
    qualityKey: parent.qualityKey,
    quality: parent.quality,
    score: parent.score,
    color: parent.color,
    flower: parent.flower,
    rep: Number(parent.rep) || 0,
    grade: leftoverGrade.letter,
    value,
    price: value,
    baseValue,
    visual: parent.visual,
    windows: parent.windows || [],
    openingSeed: parent.openingSeed || parent.visual?.openingSeed,
    openingEval: {
      price: leftoverEval.price,
      crackRatio: leftoverEval.crackRatio,
      wasteRatio: leftoverEval.wasteRatio,
      remainRatio: remainingRatio,
      avgCv: leftoverEval.avgCv,
      avgRar: leftoverEval.avgRar
    },
    leftoverGrade,
    sourceRoughId: parent.id,
    leftover: true,
    ...(withinStone ? { leftoverGeometryVersion: 2 } : {}),
    ...(withinStone && Number.isFinite(parent.mass) ? { mass: Number((parent.mass * remainingRatio / (parent.remainingRatio || 1)).toFixed(2)) } : {}),
    remainingRatio,
    // Keep consumed kit masks so pool/inventory previews show cut-out leftovers.
    extractionKits: kits.map((kit) => ({ ...kit })),
    braceletPlacements: kits.map((kit) => ({ ...kit })),
    _fromPlanSplit: true
  };
}

function takeBmListEntries(player, entries) {
  const { takeItem, addItem, money, randomUUID } = requireApi();
  const list = Array.isArray(entries) ? entries : [];
  const taken = [];
  const returned = [];
  const planGroups = new Map();
  const normal = [];

  for (const entry of list) {
    const type = entry?.type;
    if (PLAN_LIST_TYPES.has(type)) {
      const parentId = String(entry.parentId || "");
      if (!parentId) return { ok: false, message: "规划货品缺少父料。" };
      if (!planGroups.has(parentId)) {
        planGroups.set(parentId, {
          planned: [],
          leftover: null,
          kitsById: new Map(),
          planSignature: null
        });
      }
      const group = planGroups.get(parentId);
      const entryKitsResult = canonicalizeBmKits(entry.kits || [], randomUUID);
      if (!entryKitsResult.ok) return entryKitsResult;
      const entryKits = entryKitsResult.kits;
      if (entryKits.length) {
        const signature = bmKitSignature(entryKits);
        if (group.planSignature && group.planSignature !== signature) {
          return { ok: false, code: "INVALID_PLANNING", message: "同一父料的套件规划不一致。" };
        }
        group.planSignature = signature;
      }
      if (type === "planned") {
        const kitResult = canonicalizeBmKits(entry.kit ? [entry.kit] : [], randomUUID);
        if (!kitResult.ok || kitResult.kits.length !== 1) {
          return kitResult.ok
            ? { ok: false, code: "INVALID_PLANNING", message: "规划产物套件无效。" }
            : kitResult;
        }
        const kit = kitResult.kits[0];
        const entryPlanKit = entryKits.find((row) => row.id === kit.id);
        if (entryKits.length && !entryPlanKit) {
          return { ok: false, code: "INVALID_PLANNING", message: "规划产物不在本次套件方案中。" };
        }
        if (entryPlanKit && bmKitSignature([entryPlanKit]) !== bmKitSignature([kit])) {
          return { ok: false, code: "INVALID_PLANNING", message: "规划产物与整组套件数据不一致。" };
        }
        if (String(entry.itemId || "") !== `planned:${parentId}:${kit.id}`) {
          return { ok: false, code: "INVALID_PLANNING", message: "规划产物编号与父料不匹配。" };
        }
        if (group.planned.some((row) => row.kit.id === kit.id)) {
          return { ok: false, code: "INVALID_PLANNING", message: "同一规划产物不能重复上架。" };
        }
        group.planned.push({ entry, kit: entryPlanKit || kit });
        group.kitsById.set(kit.id, entryPlanKit || kit);
        for (const sibling of entryKits) {
          group.kitsById.set(sibling.id, sibling);
        }
      } else {
        if (group.leftover) {
          return { ok: false, code: "INVALID_PLANNING", message: "同一父料的余料不能重复上架。" };
        }
        if (String(entry.itemId || "") !== `leftover:${parentId}`) {
          return { ok: false, code: "INVALID_PLANNING", message: "规划余料编号与父料不匹配。" };
        }
        group.leftover = entry;
        for (const kit of entryKits) {
          group.kitsById.set(kit.id, kit);
        }
      }
      continue;
    }
    if (!ITEM_TYPES.has(type)) {
      return { ok: false, message: "物品类型无效。" };
    }
    normal.push(entry);
  }

  // 父料整料上架与规划拆分互斥
  for (const entry of normal) {
    for (const parentId of planGroups.keys()) {
      if (String(entry.itemId) === parentId) {
        return { ok: false, message: "同一明料不能同时整料上架又拆规划件/余料。" };
      }
    }
  }

  for (const entry of normal) {
    const hasPrice = entry.price != null && entry.price !== "";
    const listingPrice = hasPrice ? money(Number(entry.price)) : null;
    if (hasPrice && listingPrice < BLACKMARKET_MIN_PRICE) {
      return { ok: false, message: `上架参数无效（最低 ¥${BLACKMARKET_MIN_PRICE}）。`, taken, returned };
    }
    const resource = isBlackmarketResource(entry.type) ? lockResource(player, entry.type, entry.itemId) : null;
    if (resource && !resource.ok) return { ...resource, taken, returned };
    const item = resource ? resource.item : takeItem(player, entry.type, entry.itemId);
    if (!item) {
      return { ok: false, message: "库存中找不到部分货品。", taken, returned };
    }
    taken.push({
      type: entry.type,
      listingId: resource?.listingId,
      item,
      price: listingPrice,
      itemId: entry.itemId
    });
  }

  for (const [parentId, group] of planGroups) {
    const parentHit = findParentInPlayer(player, parentId);
    if (!parentHit) {
      rollbackBmTaken(player, taken, returned);
      return { ok: false, message: "规划父料不在库存中。" };
    }
    // —leftover 未带齐套件，—planned 条目补齐
    const allKits = [...group.kitsById.values()];
    const parent = parentHit.item;
    const priorKits = parent.leftoverGeometryVersion === 2 ? (parent.extractionKits || parent.braceletPlacements || []) : [];
    if (!allKits.length) {
      rollbackBmTaken(player, taken, returned);
      return { ok: false, message: "规划拆分缺少套件数据。" };
    }
    for (const row of group.planned) {
      const planKit = group.kitsById.get(row.kit.id);
      if (!planKit || bmKitSignature([planKit]) !== bmKitSignature([row.kit])) {
        rollbackBmTaken(player, taken, returned);
        return { ok: false, code: "INVALID_PLANNING", message: "规划产物与整组套件数据不一致。" };
      }
      row.kit = planKit;
    }
    if (allKits.length + priorKits.length > 10) {
      rollbackBmTaken(player, taken, returned);
      return { ok: false, code: "INVALID_PLANNING", message: "同一父料最多安排 10 件套件。" };
    }
    if (parent.leftoverGeometryVersion === 2) {
      const stone = openingStoneForParent(parent);
      const consumed = priorKits.map(openingKitFromBmKit);
      for (const kit of allKits.map(openingKitFromBmKit)) {
        if (!kitFitsRemainingStone(kit, stone, consumed)) {
          rollbackBmTaken(player, taken, returned);
          return { ok: false, code: "INVALID_PLANNING", message: "规划取件超出了剩余料，或覆盖了已取走的部分。" };
        }
        consumed.push(kit);
      }
    } else if (computeOverlaps(allKits.map(openingKitFromBmKit)).size > 0) {
      rollbackBmTaken(player, taken, returned);
      return { ok: false, code: "INVALID_PLANNING", message: "套件位置互相重叠，不能拆分上架。" };
    }
    takeInventoryItem(player, parentHit.type, parentHit.item.id);
    const restoreParent = () => returnItemToPlayer(player, parentHit.type, parent);

    const listedKitIds = new Set(group.planned.map((row) => row.kit.id));
    const splitOutputs = [];
    const returnProducts = [];
    for (const row of group.planned) {
      const hasPrice = row.entry.price != null && row.entry.price !== "";
      const listingPrice = hasPrice ? money(Number(row.entry.price)) : null;
      if (hasPrice && listingPrice < BLACKMARKET_MIN_PRICE) {
        restoreParent();
        rollbackBmTaken(player, taken, returned);
        return { ok: false, message: `上架参数无效（最低 ¥${BLACKMARKET_MIN_PRICE}）。` };
      }
      const product = buildPlannedProductFromKit(parent, row.kit, randomUUID, money);
      splitOutputs.push(product);
      taken.push({
        type: "bracelet",
        item: product,
        price: listingPrice,
        itemId: row.entry.itemId
      });
    }
    for (const kit of allKits) {
      if (listedKitIds.has(kit.id)) continue;
      const product = buildPlannedProductFromKit(parent, kit, randomUUID, money);
      splitOutputs.push(product);
      returnProducts.push(product);
    }

    const leftoverItem = buildLeftoverMaterial(parent, [...priorKits, ...allKits], randomUUID, money);
    registerFinanceItem(player, parent);
    distributeItemCost(parent, [...splitOutputs, leftoverItem]);
    for (const product of returnProducts) {
      addItem(player, product, { type: "bracelet", asNew: false });
      returned.push({ type: "bracelet", item: product });
    }
    if (group.leftover) {
      const hasPrice = group.leftover.price != null && group.leftover.price !== "";
      const listingPrice = hasPrice ? money(Number(group.leftover.price)) : null;
      if (hasPrice && listingPrice < BLACKMARKET_MIN_PRICE) {
        restoreParent();
        rollbackBmTaken(player, taken, returned);
        return { ok: false, message: `上架参数无效（最低 ¥${BLACKMARKET_MIN_PRICE}）。` };
      }
      taken.push({
        type: "material",
        item: leftoverItem,
        price: listingPrice,
        itemId: group.leftover.itemId
      });
    } else {
      addItem(player, leftoverItem, { type: "material", asNew: false });
      returned.push({ type: "material", item: leftoverItem });
    }
  }

  return { ok: true, taken, returned };
}

function rollbackBmTaken(player, taken = [], returned = []) {
  const { takeItem } = requireApi();
  // 先收回因拆分退回库存的件，再把—take 的退
  for (const row of returned) {
    takeItem(player, row.type, row.item.id);
  }
  for (const row of taken) {
    returnItemToPlayer(player, row.type, row.item);
  }
}

function desensitizePlayerName(name) {
  const n = String(name || "玩家").trim();
  if (n.length <= 1) return "买家·*";
  return `买家·${n[0]}*`;
}

function inventoryItemEntries(player) {
  return inventoryEntries(player);
}

function findEscrowItemForOrder(seller, orderId) {
  if (!seller) return null;
  const id = String(orderId || "");
  for (const row of inventoryItemEntries(seller)) {
    if (String(row.item?.escrowOrderId || "") === id) return { ...row, inJob: false };
  }
  for (const delivery of seller.workshopDeliveries || []) {
    const item = delivery.items.find((item) => String(item?.escrowOrderId || "") === id);
    if (item) return { type: item.type || "bracelet", item, inJob: false, inDelivery: true, delivery };
  }
  for (const job of seller.jobs || []) {
    if (String(job.item?.escrowOrderId || "") === id) {
      const type = job.item?.type
        || (job.item?.materialStage === "rough" ? "rough" : null)
        || orderInputTypeHint(job.item)
        || "material";
      return { type, item: job.item, inJob: true, job };
    }
  }
  return null;
}

function orderInputTypeHint(item) {
  if (!item || typeof item !== "object") return null;
  if (item.type) return item.type;
  if (Array.isArray(item.windows) || item.trueQualityKey) return "rough";
  if (item.inlaid || item.craftGrade) return "bracelet";
  return null;
}

function attachEscrowItemToSeller(seller, orderId, buyerId, type, item) {
  const { addItem } = requireApi();
  // takeItem 按桶查找，但 addItem 依赖 item.type；下单时以订单类型为准。
  item.type = type;
  item.escrowOrderId = orderId;
  item.escrowFromBuyerId = buyerId;
  addItem(seller, item, { asNew: true });
  const landed = findInventoryItem(seller, type, item.id);
  if (!landed) restoreInventoryItem(seller, type, item);
}

function removeEscrowItemFromSeller(seller, type, item) {
  const { takeItem } = requireApi();
  let taken = takeItem(seller, type, item.id);
  if (!taken) {
    for (const delivery of seller.workshopDeliveries || []) {
      const index = delivery.items.findIndex((row) => row.id === item.id);
      if (index < 0) continue;
      [taken] = delivery.items.splice(index, 1);
      seller.workshopDeliveries = seller.workshopDeliveries.filter((row) => row.items.length || row.auxiliaryItems.length);
      break;
    }
  }
  if (!taken) return null;
  delete taken.escrowOrderId;
  delete taken.escrowFromBuyerId;
  delete taken.financeServiceCost;
  return taken;
}

function returnHeldItemToBuyer(order, state) {
  const { addItem } = requireApi();
  const buyer = state.players?.get?.(order.buyerId);
  const held = order.heldItem;
  if (!buyer || !held?.item) return false;
  const item = held.item;
  delete item.escrowOrderId;
  delete item.escrowFromBuyerId;
  delete item.financeServiceCost;
  addItem(buyer, item, { type: held.type || item.type, asNew: false });
  order.heldItem = null;
  return true;
}

function returnEscrowItemToBuyer(order, state) {
  const { addItem } = requireApi();
  if (order?.heldItem?.item) return returnHeldItemToBuyer(order, state);
  const seller = state.players?.get?.(order.sellerId);
  const buyer = state.players?.get?.(order.buyerId);
  if (!seller || !buyer) return false;
  const row = findEscrowItemForOrder(seller, order.id);
  if (!row) return false;
  if (row.inDelivery) {
    // Return every output of a multi-piece commission, retaining the seller's offcuts.
    let pending = row;
    while (pending?.inDelivery) {
      const item = removeEscrowItemFromSeller(seller, pending.type, pending.item);
      if (!item) break;
      addItem(buyer, item, { type: pending.type, asNew: true });
      pending = findEscrowItemForOrder(seller, order.id);
    }
    return true;
  }
  if (row.inJob && row.job) {
    const jobs = seller.jobs || [];
    const idx = jobs.findIndex((job) => job === row.job || job?.id === row.job?.id);
    if (idx >= 0) jobs.splice(idx, 1);
    const item = row.item;
    delete item.escrowOrderId;
    delete item.escrowFromBuyerId;
    delete item.financeServiceCost;
    addItem(buyer, item, { type: row.type || item.type, asNew: false });
    return true;
  }
  const item = removeEscrowItemFromSeller(seller, row.type, row.item);
  if (!item) return false;
  addItem(buyer, item);
  return true;
}

function itemMatchesAcceptScope(item, scopeId, materialStageFor) {
  const stage = materialStageFor(item);
  const score = Number(item.score || 0);
  switch (scopeId) {
    case "sealed":
      return item.type === "rough" && stage === "rough";
    case "opened":
      return stage === "opened" || stage === "carved";
    case "finished":
      return stage === "finished";
    case "premium":
      return score >= 5 || String(item.color || "").includes("帝王");
    default:
      return false;
  }
}

function itemMatchesAcceptScopes(item, scopes, materialStageFor) {
  if (!Array.isArray(scopes) || !scopes.length) return true;
  return scopes.some((scopeId) => itemMatchesAcceptScope(item, scopeId, materialStageFor));
}

function publicInputItemRef(inputItem) {
  if (!inputItem) return null;
  return {
    type: inputItem.type,
    itemId: inputItem.itemId,
    name: inputItem.name,
    materialStage: inputItem.materialStage
  };
}

function publicCapabilitySnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    capturedAt: snapshot.capturedAt,
    templateId: snapshot.templateId,
    bindLabels: snapshot.bindLabels || [],
    serviceSnapshot: snapshot.serviceSnapshot || null
  };
}

function blindLockedCount(stall) {
  return stall?.blindDraw?.candidates?.length || 0;
}

function syncBlindPause(stall) {
  if (stall.type !== "blindbox") return;
  const n = (stall.pool || []).length + blindLockedCount(stall);
  if (n < BLACKMARKET_BLIND_MIN) {
    if (stall.status === "open") stall.status = "paused";
    return;
  }
  if (stall.status === "paused" && !stall.ownerPaused && !stall.blindDraw) {
    stall.status = "open";
  }
}

function stallTypeLabel(type) {
  return type === "goods" ? "卖物品" : type === "blindbox" ? "盲盒" : "技术支持";
}

function stallReadyToPublish(stall) {
  if (!stall) return false;
  if (stall.type === "goods") return (stall.items || []).length > 0;
  if (stall.type === "blindbox") return (stall.pool || []).length >= BLACKMARKET_BLIND_MIN;
  if (stall.type === "service") return (stall.offers || []).length > 0;
  return false;
}

function averageBlindPoolRefPrice(stall) {
  const values = (stall?.pool || [])
    .map((row) => Number(row?.item?.value ?? row?.item?.price ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return null;
  return Math.max(
    BLACKMARKET_MIN_PRICE,
    Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  );
}

function tryActivateStall(stall, owner) {
  if (!stall || stall.status !== "setup") return { activated: false };
  if (!stallReadyToPublish(stall)) return { activated: false };
  const { addNews } = requireApi();
  stall.status = "open";
  stall.updatedAt = Date.now();
  const typeLabel = stallTypeLabel(stall.type);
  addNews(
    stall.anonymous
      ? `黑市新开夜摊${stall.maskName}${typeLabel}）。`
      : `${owner?.name || stall.ownerName} 在黑市开了${stall.title}」（${typeLabel}）。`,
    "trade"
  );
  return {
    activated: true,
    message: `摆摊成功！${stall.title}」已出现在黑市广场。`
  };
}

function releaseDepositSafe(player, amount, note, meta = {}) {
  const { releaseDeposit } = requireApi();
  if (!player) return 0;
  return releaseDeposit(player, amount, note, meta);
}

  return {
    STALL_TYPES,
    ITEM_TYPES,
    PLAN_LIST_TYPES,
    clamp,
    blackMaskForPlayerId,
    findStallByOwner,
    findStallById,
    stallDisplayName,
    pushPendingRatings,
    pushSellerPayout,
    paySellerNow,
    removeStallFromState,
    closeGoodsStallIfEmpty,
    returnItemToPlayer,
    buildLeftoverMaterial,
    takeBmListEntries,
    rollbackBmTaken,
    desensitizePlayerName,
    findEscrowItemForOrder,
    attachEscrowItemToSeller,
    removeEscrowItemFromSeller,
    returnHeldItemToBuyer,
    returnEscrowItemToBuyer,
    itemMatchesAcceptScopes,
    publicInputItemRef,
    publicCapabilitySnapshot,
    blindLockedCount,
    syncBlindPause,
    stallTypeLabel,
    stallReadyToPublish,
    averageBlindPoolRefPrice,
    tryActivateStall,
    releaseDepositSafe
  };
}
