/**
 * Inventory storage only. Acquisition metadata belongs to inventory-service;
 * callers own transactions, escrow and persistence. No player references are retained.
 */
const BUCKETS = {
  rough: "rough", material: "materials", slice: "slices", bracelet: "bracelets", collection: "collection"
};
const JADE_INVENTORY_TYPES = ["rough", "material", "slice", "bracelet"];

export function inventoryBucketName(type) {
  return Object.hasOwn(BUCKETS, type) ? BUCKETS[type] : null;
}

export function initializeInventory(player, type) {
  const bucket = inventoryBucketName(type);
  if (player && bucket && !Array.isArray(player[bucket])) player[bucket] = [];
}

export function inventoryEntries(player, types = JADE_INVENTORY_TYPES) {
  return types.flatMap(type => (player?.[inventoryBucketName(type)] || []).map(item => ({ type, item })));
}

export function findInventoryItem(player, type, itemId) {
  const id = String(itemId || "");
  if (!id) return null;
  return (player?.[inventoryBucketName(type)] || []).find(item => String(item?.id) === id) || null;
}

export function takeInventoryItem(player, type, itemId) {
  const id = String(itemId || "");
  if (!id) return null;
  const items = player?.[inventoryBucketName(type)];
  if (!Array.isArray(items)) return null;
  const index = items.findIndex(item => String(item?.id) === id);
  return index < 0 ? null : items.splice(index, 1)[0];
}

/** Remove matching items in inventory order. */
export function takeInventoryItems(player, type, itemIds) {
  const bucket = inventoryBucketName(type);
  if (!player || !bucket || !Array.isArray(player[bucket])) return [];
  const ids = new Set(itemIds);
  const taken = [];
  player[bucket] = player[bucket].filter(item => {
    if (!ids.has(item.id)) return true;
    taken.push(item);
    return false;
  });
  return taken;
}

/** Return an already-owned item without changing its type, cost or unread state. */
export function restoreInventoryItem(player, type, item, { merge = false } = {}) {
  const bucket = inventoryBucketName(type);
  if (!player || !bucket || !item) return null;
  initializeInventory(player, type);
  const items = player[bucket];
  if (merge) {
    const index = items.findIndex(existing => existing.id === item.id);
    if (index >= 0) {
      items[index] = { ...items[index], ...item };
      return items[index];
    }
  }
  items.push(item);
  return item;
}

export function restoreInventoryItems(player, type, items) {
  const bucket = inventoryBucketName(type);
  if (!player || !bucket) return;
  initializeInventory(player, type);
  player[bucket].push(...items);
}
