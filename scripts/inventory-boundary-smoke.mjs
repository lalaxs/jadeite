import assert from "node:assert/strict";
import { createGame } from "../server/create-game.js";
import { createDurableMutationCoordinator } from "../server/services/durable-mutation-coordinator.js";
import { createMemoryWorldStore } from "../server/world-store.js";
import { createWorkshopInventory } from "../server/services/workshop/inventory.js";
import {
  inventoryEntries, findInventoryItem, takeInventoryItem, takeItem, materialStageFor
} from "../server/services/inventory-service.js";
import { itemCost } from "../shared/domain/economy/item-cost.js";

// Rough commands accept opened materials and slices; exact bucket operations do not.
const legacyMaterial = { id: "opened", type: "rough", materialStage: "opened", seen: true, acquiredAt: 123,
  costBasis: { amount: 400, complete: true }, financeBatchId: "original-batch", financeOwnerId: "owner" };
const legacySlice = { id: "slice", type: "slice" };
const inventory = { rough: [], materials: [legacyMaterial], slices: [legacySlice], bracelets: [] };
assert.equal(takeInventoryItem(inventory, "rough", legacyMaterial.id), null);
assert.equal(takeItem(inventory, "rough", legacyMaterial.id), legacyMaterial);
const { restoreWorkshopItem } = createWorkshopInventory({ materialStageFor });
const original = structuredClone(legacyMaterial);
restoreWorkshopItem(inventory, legacyMaterial);
assert.equal(findInventoryItem(inventory, "material", legacyMaterial.id), legacyMaterial);
assert.deepEqual(legacyMaterial, original, "returning opened rough must preserve its saved type and acquisition metadata");
restoreWorkshopItem(inventory, { ...legacyMaterial, value: 900 });
assert.deepEqual(inventory.materials, [{ ...original, value: 900 }], "restoring updated rough merges without duplicating it");
assert.equal(takeItem(inventory, "rough", legacySlice.id), legacySlice);
restoreWorkshopItem(inventory, legacySlice);
const entries = inventoryEntries(inventory);
entries.splice(0, entries.length);
assert.equal(inventory.materials.length + inventory.slices.length, 2, "query results must not expose the backing arrays");

const game = createGame({ env: { ...process.env, NODE_ENV: "test", JADE_WORLD_PERSIST: "0", LOG_LEVEL: "silent" } });
const H = game.__testHooks;
let coordinator;
try {
  for (const id of ["owner", "buyer"]) {
    const player = H.makePlayer(id);
    H.normalizePlayer(player);
    player.cash = 100_000;
    player.achievementPoints = 100;
    player.achievementPointsBonus = 100;
    player.rough = []; player.materials = []; player.slices = []; player.bracelets = [];
    H.world.setPlayer(player);
  }
  const owner = H.world.getPlayer("owner");
  const product = { id: "transfer-product", type: "bracelet", name: "测试成品", materialStage: "finished", value: 2000 };
  H.addItem(owner, product, { acquisitionCost: 800 });
  product.seen = true;
  product.acquiredAt = 123;
  const ownedSnapshot = structuredClone(product);
  const list = () => {
    const result = H.listItemForPlayer(H.world.getPlayer("owner"), { type: "bracelet", itemId: product.id, price: 2000 });
    assert.equal(result.ok, true, result.message);
    return H.state.listings[0].id;
  };
  const withdrawnId = list();
  assert.equal(H.withdrawListingForPlayer(owner, withdrawnId).ok, true);
  assert.equal(owner.bracelets[0], product, "withdrawal returns the owned item itself");
  assert.deepEqual(owner.bracelets[0], ownedSnapshot, "withdrawal must not create a new acquisition or finance batch");
  const listingId = list();
  const before = H.world.exportSnapshot({ savedAt: 1000 });
  let failNext = true;
  let committedSnapshot;
  coordinator = createDurableMutationCoordinator({
    world: H.world,
    async flush({ snapshot }) {
      if (failNext) { failNext = false; throw new Error("inventory save failed"); }
      committedSnapshot = structuredClone(snapshot);
    },
    logger: { error() {}, warn() {} }
  });
  const buy = () => coordinator.run("inventory-transfer", () => {
    const result = H.buyListingForPlayer(H.world.getPlayer("buyer"), listingId);
    assert.equal(result.ok, true, result.message);
    return result;
  });
  await assert.rejects(buy(), /inventory save failed/);
  assert.deepEqual(H.world.exportSnapshot({ savedAt: 1000 }), before,
    "failed persistence must restore both players, escrow, costs and cash");
  await buy();
  const acquired = findInventoryItem(H.world.getPlayer("buyer"), "bracelet", product.id);
  assert.ok(acquired);
  assert.equal(acquired.seen, false, "a completed purchase is a new acquisition");
  assert.equal(acquired.financeOwnerId, "buyer");
  assert.notEqual(acquired.financeBatchId, ownedSnapshot.financeBatchId);
  assert.equal(itemCost(acquired).amount, 2040, "buyer cost includes the existing market tax");
  assert.equal(H.state.listings.length, 0);
  assert.equal(findInventoryItem(H.world.getPlayer("owner"), "bracelet", product.id), null);
  const restored = createMemoryWorldStore();
  restored.importSnapshot(committedSnapshot);
  const snapshotState = ({ players, ...world }) => ({ ...world, players: new Map(players) });
  assert.deepEqual(snapshotState(restored.exportSnapshot({ savedAt: 1000 })), snapshotState(H.world.exportSnapshot({ savedAt: 1000 })),
    "the existing save format must round-trip after a cross-player transfer");
  assert.equal(inventoryEntries(restored.getPlayer("buyer")).filter(({ item }) => item.id === product.id).length, 1);
} finally {
  await coordinator?.close();
  await game.shutdown();
}

console.log("inventory-boundary-smoke: restoration metadata, escrow transfer, durable rollback and save round-trip ok");
