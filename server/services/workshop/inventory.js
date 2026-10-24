// Inventory restoration and escrow metadata; keep existing saved buckets.

export function createWorkshopInventory({
  materialStageFor
}) {
function restoreWorkshopItem(player, item) {
  if (!item) return;
  if (item.type === "slice") { player.slices.push(item); return; }
  if (item.type === "rough" || item.type === "material") {
    restoreRoughToInventory(player, item);
    return;
  }
  player.bracelets.push(item);
}

function restoreRoughToInventory(player, rough) {
  // —materialStage 决定归属桶：已开窗的明料—materials，其余回 rough
  const stage = materialStageFor(rough);
  const bucket = stage === "opened" || rough.type === "material" ? player.materials : player.rough;
  const existingIndex = bucket.findIndex((item) => item.id === rough.id);
  if (existingIndex >= 0) {
    bucket[existingIndex] = { ...bucket[existingIndex], ...rough };
    return;
  }
  bucket.push(rough);
}

function inheritEscrowMeta(source, ...targets) {
  if (!source?.escrowOrderId) return;
  for (const target of targets) {
    if (!target || typeof target !== "object") continue;
    target.escrowOrderId = source.escrowOrderId;
    target.escrowFromBuyerId = source.escrowFromBuyerId;
  }
}

  return { restoreWorkshopItem, restoreRoughToInventory, inheritEscrowMeta };
}
