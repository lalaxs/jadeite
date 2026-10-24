import assert from "node:assert/strict";
import { __testHooks as hooks } from "../server.js";

const player = hooks.makePlayer("unseen-test");
hooks.normalizePlayer(player);

const item = hooks.markInventoryItemNew({
  id: "item-1",
  type: "material",
  name: "测试明料",
  materialStage: "opened",
  value: 1000
});
assert.equal(item.seen, false);
hooks.addItem(player, { id: "item-2", type: "rough", name: "测试原石", materialStage: "rough", price: 500 });
assert.equal(player.rough.at(-1).seen, false);
assert.ok(hooks.inventoryUnseenCount(player) >= 1);

hooks.markExternalMaterialNew(player, "gold18k");
player.externalMaterials.gold18k = Math.max(1, Number(player.externalMaterials.gold18k || 0));
const before = hooks.inventoryUnseenCount(player);
assert.ok(before >= 2);

const cleared = hooks.markInventoryItemsSeen(player, ["item-2", "external:gold18k"]);
assert.ok(cleared >= 2);
assert.equal(player.rough.find((entry) => entry.id === "item-2")?.seen, true);
assert.equal(player.externalMaterialsUnseen.gold18k, undefined);
assert.ok(hooks.inventoryUnseenCount(player) < before);

console.log("inventory-unseen-smoke: ok");
process.exit(0);
