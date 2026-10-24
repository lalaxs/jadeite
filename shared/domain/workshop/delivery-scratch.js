export const SCRATCH_REVEAL_THRESHOLD = .6;

// Only primary raw-opening outputs participate; carving offcuts never do.
export function openingScratchItemIds(delivery) {
  if (delivery?.stage !== "opening") return [];
  return (delivery.items || []).filter((item) => !item.leftover
    && ["rough", "material", "slice"].includes(item.type)
    && (item.materialStage === "opened" || item.stage === "material"))
    .map((item) => item.id);
}

export function scratchItemIds(delivery) {
  const candidates = openingScratchItemIds(delivery);
  if (delivery.scratchReveal?.version === 1) {
    return candidates.filter((id) => delivery.scratchReveal.itemIds.includes(id));
  }
  // Already-opened legacy batches keep their previous handover behaviour.
  return delivery.revealedAt ? [] : candidates;
}

export function pendingScratchItemIds(delivery) {
  const revealed = new Set(delivery.scratchReveal?.revealedItemIds || []);
  return scratchItemIds(delivery).filter((id) => !revealed.has(id));
}

export function isValidScratchReveal(delivery) {
  const scratch = delivery.scratchReveal;
  return delivery.stage === "opening" && scratch?.version === 1
    && Array.isArray(scratch.itemIds) && Array.isArray(scratch.revealedItemIds)
    && scratch.itemIds.length <= 32 && new Set(scratch.itemIds).size === scratch.itemIds.length
    && scratch.revealedItemIds.length <= 32 && new Set(scratch.revealedItemIds).size === scratch.revealedItemIds.length
    // Returned commissions may leave only auxiliary outputs in a saved batch.
    && scratch.itemIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 128)
    && scratch.revealedItemIds.every((id) => scratch.itemIds.includes(id));
}
