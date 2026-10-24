import assert from "node:assert/strict";

// Economy/rendering tests continue their workflow after the new manual handover.
export function claimWorkshopOutputs(hooks, player) {
  for (const delivery of [...(player.workshopDeliveries || [])]) {
    assert.equal(hooks.revealWorkshopDeliveryForPlayer(player, delivery.id).ok, true);
    if (delivery.scratchReveal?.itemIds.length) {
      assert.equal(hooks.revealWorkshopDeliveryForPlayer(player, delivery.id, { itemIds: delivery.scratchReveal.itemIds }).ok, true);
    }
    assert.equal(hooks.claimWorkshopDeliveryForPlayer(player, delivery.id).ok, true);
  }
}
