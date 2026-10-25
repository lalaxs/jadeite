import { restoreInventoryItem } from "../inventory-items.js";
// Inventory restoration and escrow metadata; keep existing saved buckets.

export function createWorkshopInventory({
  materialStageFor
}) {
function restoreWorkshopItem(player, item) {
  if (!item) return;
  if (item.type === "slice") { restoreInventoryItem(player, "slice", item); return; }
  if (item.type === "rough" || item.type === "material") {
    restoreRoughToInventory(player, item);
    return;
  }
  restoreInventoryItem(player, "bracelet", item);
}

function restoreRoughToInventory(player, rough) {
  // —materialStage 决定归属桶：已开窗的明料—materials，其余回 rough
  const stage = materialStageFor(rough);
  const type = stage === "opened" || rough.type === "material" ? "material" : "rough";
  restoreInventoryItem(player, type, rough, { merge: true });
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
