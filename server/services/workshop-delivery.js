import { openingScratchItemIds, pendingScratchItemIds } from "../../shared/domain/workshop/delivery-scratch.js";

/** Completed work stays owned by the player, outside usable inventory until claimed. */
export function createWorkshopDeliveryService({ normalizePlayer, restoreWorkshopItem, markInventoryItemNew, refreshPlayerReport, randomUUID, onClaim }) {
  function storeWorkshopDelivery(player, job, items, auxiliaryItems = [], metadata = {}) {
    player.workshopDeliveries ||= [];
    const delivery = {
      id: job.id || randomUUID(),
      stage: ({ rough: "opening", refine: "carving", inlay: "finishing" }[job.stage]) || job.stage,
      inputName: job.item?.name || "物料",
      completedAt: Number(job.readyAt) || Date.now(),
      revealedAt: null,
      items,
      auxiliaryItems,
      ...metadata
    };
    const scratchIds = openingScratchItemIds(delivery);
    if (scratchIds.length) delivery.scratchReveal = { version: 1, itemIds: scratchIds, revealedItemIds: [] };
    player.workshopDeliveries.push(delivery);
    return delivery;
  }

  function revealWorkshopDeliveryForPlayer(player, deliveryId, { itemIds } = {}) {
    if (!player) return { ok: false, message: "未找到玩家。" };
    normalizePlayer(player);
    const delivery = player.workshopDeliveries.find((row) => row.id === deliveryId);
    if (!delivery) return { ok: false, code: "DELIVERY_NOT_FOUND", message: "这批产物已领取或已移交。" };
    if (itemIds !== undefined) {
      const currentOutputs = new Set(openingScratchItemIds(delivery));
      const allowed = new Set((delivery.scratchReveal?.itemIds || []).filter((id) => currentOutputs.has(id)));
      if (!delivery.revealedAt || !Array.isArray(itemIds) || !itemIds.length
        || itemIds.length > 32 || itemIds.some((id) => !allowed.has(id))) {
        return { ok: false, message: "请先打开锦匣，并选择本批待揭晓片料。" };
      }
      delivery.scratchReveal.revealedItemIds = [...new Set([...delivery.scratchReveal.revealedItemIds, ...itemIds])];
    } else if (!delivery.revealedAt && !delivery.scratchReveal) {
      const ids = openingScratchItemIds(delivery);
      if (ids.length) delivery.scratchReveal = { version: 1, itemIds: ids, revealedItemIds: [] };
    }
    delivery.revealedAt ||= Date.now();
    return { ok: true, deliveryId: delivery.id, revealedAt: delivery.revealedAt,
      ...(delivery.scratchReveal ? { scratchReveal: structuredClone(delivery.scratchReveal) } : {}) };
  }

  function claimWorkshopDeliveryForPlayer(player, deliveryId) {
    if (!player) return { ok: false, message: "未找到玩家。" };
    normalizePlayer(player);
    const index = player.workshopDeliveries.findIndex((row) => row.id === deliveryId);
    if (index < 0) return { ok: false, code: "DELIVERY_NOT_FOUND", message: "这批产物已领取或已移交。" };
    const delivery = player.workshopDeliveries[index];
    if (!delivery.revealedAt) return { ok: false, message: "请先打开锦匣，查看本次产物。" };
    if (pendingScratchItemIds(delivery).length) return { ok: false, message: "请先刮开片料，或点击一键揭晓。" };
    // All outputs, including carving offcuts, transfer together in the durable socket transaction.
    for (const item of [...delivery.items, ...delivery.auxiliaryItems]) {
      restoreWorkshopItem(player, markInventoryItemNew(item));
    }
    player.workshopDeliveries.splice(index, 1);
    onClaim?.(player);
    refreshPlayerReport(player);
    return { ok: true, deliveryId, count: delivery.items.length, auxiliaryCount: delivery.auxiliaryItems.length };
  }

  return { storeWorkshopDelivery, revealWorkshopDeliveryForPlayer, claimWorkshopDeliveryForPlayer };
}
