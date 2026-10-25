/**
 * Inventory helpers — bucket take/add and unseen (red-dot) markers.
 * Pure module; no world state dependency.
 */
import {
  INVENTORY_RECYCLE_RATE,
  inventoryRecyclePayout as sharedInventoryRecyclePayout
} from "../../shared/domain/economy/inventory-recycle.js";
import { setAcquisitionCost } from "../../shared/domain/economy/item-cost.js";
import { registerFinanceItem, recordFinanceSale } from "../../shared/domain/economy/finance-book.js";
import { inventoryBucketName, initializeInventory, inventoryEntries, takeInventoryItem, restoreInventoryItem } from "./inventory-items.js";
export { inventoryBucketName, inventoryEntries, findInventoryItem, takeInventoryItem, takeInventoryItems,
  restoreInventoryItem, restoreInventoryItems } from "./inventory-items.js";

export { INVENTORY_RECYCLE_RATE };

export function inventoryRecyclePayout(value) {
  return sharedInventoryRecyclePayout(value);
}

export function materialStageFor(item) {
  if (!item || typeof item !== "object") return "unknown";
  if (item.materialStage) return item.materialStage;
  if (item.type === "rough") return item.revealed || item.polished ? "opened" : "rough";
  if (item.stage === "opened" || item.stage === "material") return "opened";
  if (item.stage === "carved") return "carved";
  if (item.stage === "polished") return "polished";
  if (item.stage === "finished" || item.inlaid) return "finished";
  if (item.type === "bracelet") return "finished";
  return "unknown";
}

export function itemValue(item) {
  if (item.type === "rough") return item.price ?? 1000;
  if (item.type === "material") return item.value ?? 1000;
  if (item.type === "slice") return item.value ?? 1000;
  if (item.type === "bracelet") return item.value ?? 1000;
  return 1000;
}

export function takeItem(player, type, itemId) {
  const id = String(itemId || "");
  if (!id || !player) return null;
  const types = type === "rough" ? ["rough", "material", "slice"]
    : type === "material" || type === "slice" ? [type] : ["bracelet"];
  for (const inventoryType of types) {
    const item = takeInventoryItem(player, inventoryType, id);
    if (item) return item;
  }
  return null;
}

/** 新入账未读标记：seen === false 表示库存红点未清除 */
export function markInventoryItemNew(item) {
  if (!item || typeof item !== "object") return item;
  item.seen = false;
  item.acquiredAt = Date.now();
  return item;
}

export function markExternalMaterialNew(player, key) {
  if (!player || !key) return;
  player.externalMaterialsUnseen ||= {};
  player.externalMaterialsUnseen[key] = true;
}

export function addItem(player, item, options = {}) {
  if (!player || !item) return null;
  const type = String(options.type || item.type || "");
  if (!inventoryBucketName(type) || type === "collection") return null;
  initializeInventory(player, type);
  item.type = type;
  if (options.acquisitionCost != null) {
    setAcquisitionCost(item, options.acquisitionCost);
    registerFinanceItem(player, item, { acquisition: true });
  }
  if (options.asNew !== false) markInventoryItemNew(item);
  return restoreInventoryItem(player, type, item);
}

export function markInventoryItemsSeen(player, rawIds = []) {
  if (!player) return 0;
  const ids = [...new Set((Array.isArray(rawIds) ? rawIds : []).map((id) => String(id || "")).filter(Boolean))];
  if (!ids.length) return 0;
  let cleared = 0;
  const buckets = [player.rough, player.materials, player.slices, player.bracelets];
  for (const id of ids) {
    if (id.startsWith("external:")) {
      const key = id.slice("external:".length);
      if (player.externalMaterialsUnseen?.[key]) {
        delete player.externalMaterialsUnseen[key];
        cleared += 1;
      }
      continue;
    }
    for (const bucket of buckets) {
      const item = (bucket || []).find((entry) => entry.id === id);
      if (item && item.seen === false) {
        item.seen = true;
        cleared += 1;
        break;
      }
    }
  }
  return cleared;
}

export function inventoryUnseenCount(player) {
  if (!player) return 0;
  let count = 0;
  for (const bucket of [player.rough, player.materials, player.slices, player.bracelets]) {
    for (const item of bucket || []) {
      if (item?.seen === false) count += 1;
    }
  }
  const unseenExt = player.externalMaterialsUnseen || {};
  const stocks = player.externalMaterials || {};
  for (const [key, flagged] of Object.entries(unseenExt)) {
    if (flagged && Number(stocks[key] || 0) > 0) count += 1;
  }
  return count;
}

function findOwnedJadeItem(player, itemId) {
  const id = String(itemId || "");
  if (!id || !player) return null;
  return inventoryEntries(player).find(({ item }) => String(item?.id) === id) || null;
}

function resolveRecycleValue(rawValue, asMoney) {
  if (
    rawValue == null
    || (typeof rawValue !== "number" && typeof rawValue !== "string")
    || (typeof rawValue === "string" && !rawValue.trim())
  ) {
    return null;
  }
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > Number.MAX_SAFE_INTEGER) {
    return null;
  }
  const value = asMoney(numeric);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

/**
 * Recycle one inventory entry for cash at the shared fallback rate.
 * payload.kind: "jade" | "external" | "planned"
 */
export function recycleInventoryItemForPlayer(player, payload = {}, deps = {}) {
  const { money, earnCash, materialUnitPrice } = deps;
  if (!player) return { ok: false, message: "未找到玩家。" };
  const kind = String(payload.kind || "jade");
  const asMoney = typeof money === "function" ? money : (n) => Math.max(0, Math.round(Number(n) || 0));
  const pay = (amount, label, meta) => {
    if (amount <= 0) return true;
    if (typeof earnCash !== "function") return false;
    earnCash(player, amount, label, meta);
    return true;
  };

  if (kind === "external") {
    const key = String(payload.materialKey || payload.itemId || "").replace(/^external:/, "");
    if (!key) return { ok: false, message: "材料无效。" };
    const qty = Number(player.externalMaterials?.[key] || 0);
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, message: "没有可回收的镶嵌材料。" };
    const unit = typeof materialUnitPrice === "function" ? Number(materialUnitPrice(key)) : NaN;
    const totalValue = unit > 0 && Number.isFinite(unit)
      ? resolveRecycleValue(unit * qty, asMoney)
      : null;
    if (totalValue == null) {
      return {
        ok: false,
        code: "INVALID_RECYCLE_VALUE",
        message: "材料估值异常，本次未回收，库存已保留。"
      };
    }
    const payout = inventoryRecyclePayout(totalValue);
    if (!pay(payout, `库存回收：镶嵌材料 ${key}×${qty}`, {
      source: "inventory-recycle",
      materialKey: key
    })) {
      return { ok: false, code: "ECONOMY_UNAVAILABLE", message: "回收入账暂不可用，库存已保留。" };
    }
    const materialCost = player.externalMaterialCosts?.[key];
    recordFinanceSale(player, [{ id: `external:${key}:${player.financeBook?.sequence || 0}`, name: `镶嵌材料 ${key}×${qty}`,
      value: totalValue, costBasis: { amount: Number(materialCost?.amount) || 0,
        complete: Boolean(materialCost?.complete && Math.abs(Number(materialCost.quantity) - qty) < .001) } }], payout,
    { id: `recycle-external:${key}:${player.financeBook?.sequence || 0}`, channel: "recycle" });
    player.externalMaterials[key] = 0;
    if (player.externalMaterialCosts) delete player.externalMaterialCosts[key];
    if (player.externalMaterialsUnseen) delete player.externalMaterialsUnseen[key];
    return {
      ok: true,
      message: "已回收镶嵌材料。",
      kind,
      materialKey: key,
      quantity: qty,
      value: totalValue,
      payout
    };
  }

  if (kind === "planned") {
    const parentId = String(payload.parentId || "");
    const kitId = String(payload.kitId || "");
    if (!parentId || !kitId) return { ok: false, message: "规划产物无效。" };
    const owned = findOwnedJadeItem(player, parentId);
    if (!owned) return { ok: false, message: "找不到对应明料。" };
    if (owned.item.escrowOrderId) return { ok: false, message: "委托物不可回收。" };
    // Planning kits live only in browser memory and are not authoritative
    // inventory. Let the client remove the draft, but never mint cash from an
    // unverifiable kit id while the source material remains owned.
    return {
      ok: true,
      message: "已撤销规划草稿；草稿不是实际库存，不产生回收收益。",
      kind,
      parentId,
      kitId,
      value: 0,
      payout: 0,
      clearClientKit: true
    };
  }

  const itemId = String(payload.itemId || payload.id || "");
  const owned = findOwnedJadeItem(player, itemId);
  if (!owned) return { ok: false, message: "找不到该物品。" };
  if (owned.item.escrowOrderId) return { ok: false, message: "委托物不可回收。" };
  const totalValue = resolveRecycleValue(itemValue(owned.item), asMoney);
  if (totalValue == null) {
    return {
      ok: false,
      code: "INVALID_RECYCLE_VALUE",
      message: "物品估值异常，本次未回收，物品已保留。"
    };
  }
  const payout = inventoryRecyclePayout(totalValue);
  if (!pay(payout, `库存回收：${owned.item.name || "物品"}`, {
    source: "inventory-recycle",
    itemId: owned.item.id,
    itemType: owned.item.type
  })) {
    return { ok: false, code: "ECONOMY_UNAVAILABLE", message: "回收入账暂不可用，物品已保留。" };
  }
  const removed = takeInventoryItem(player, owned.type, owned.item.id);
  if (!removed) return { ok: false, message: "回收失败，物品不存在。" };
  registerFinanceItem(player, removed);
  recordFinanceSale(player, [removed], payout, { id: `recycle:${removed.financeBatchId}:${removed.id}`, channel: "recycle" });
  return {
    ok: true,
    message: `已回收「${removed.name || "物品"}」。`,
    kind: "jade",
    itemId: removed.id,
    itemType: removed.type,
    name: removed.name,
    value: totalValue,
    payout
  };
}
