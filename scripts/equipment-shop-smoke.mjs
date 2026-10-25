import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemoryWorldStore } from "../server/world-store.js";
import { createEquipmentShopService } from "../server/services/equipment-shop-service.js";
import { equipmentCatalog } from "../server/systems/equipment-system.js";
import { createWorldPersister } from "../server/shell/world-persist.js";
import { createSqliteWorldPersister } from "../server/shell/sqlite-world-persist.js";
import { equipmentParamTone } from "../public/equipment-param-view.js";

const now = Date.parse("2026-10-24T04:00:00Z");
const realNow = Date.now;
Date.now = () => now;
const world = createMemoryWorldStore();
const buyer = (id, cash = 1_000_000) => {
  const player = { id, name: id, cash, workshop: { devices: [], workers: [] } };
  world.setPlayer(player);
  return player;
};
let sequence = 0;
const serviceFor = (store, rng) => createEquipmentShopService({ getState: () => store.raw, rng,
  makeId: () => `shop-machine-${++sequence}`,
  spendCash(player, amount) { if (player.cash < amount) return false; player.cash -= amount; return true; }
});
const shop = serviceFor(world, () => 0.9);
shop.ensureEquipmentShop(now);
const catalog = equipmentCatalog();
assert.equal(world.raw.equipmentShop.items.length, 6);
assert.ok(world.raw.equipmentShop.items.every(row => catalog.find(model => model.modelKey === row.modelKey).techLevel === 1));
assert.equal(world.raw.equipmentShop.refreshAt, Date.parse("2026-10-24T21:00:00Z"));

const first = buyer("first"), second = buyer("second"), poor = buyer("poor", 1);
const row = world.raw.equipmentShop.items.find(item => item.modelKey === "used-opening-1");
const stock = row.stock;
assert.equal(shop.buyShopEquipmentForPlayer(poor, row.modelKey, now).code, "INSUFFICIENT_CASH");
assert.equal(row.stock, stock);
assert.equal(poor.workshop.devices.length, 0);
assert.equal(shop.buyShopEquipmentForPlayer(first, "cuijie-opening-3", now).code, "NOT_IN_STOCK");
row.stock = 1;
const before = world.exportSnapshot();
const transaction = world.beginMutation(now);
transaction.run(() => shop.buyShopEquipmentForPlayer(world.raw.players.get(first.id), row.modelKey, now));
assert.equal(world.raw.equipmentShop.items[0].stock, 0);
transaction.rollback();
assert.deepEqual(world.exportSnapshot(), before, "failed commits restore stock, cash and owned equipment together");

const a = world.getPlayer(first.id), b = world.getPlayer(second.id);
assert.equal(shop.buyShopEquipmentForPlayer(a, row.modelKey, now).ok, true);
assert.equal(shop.buyShopEquipmentForPlayer(b, row.modelKey, now).code, "SOLD_OUT");
assert.equal(a.cash, 996800);
assert.equal(a.workshop.devices.length, 1);
assert.equal(b.cash, 1_000_000);
assert.equal(b.workshop.devices.length, 0);
const sold = structuredClone(world.raw.equipmentShop);
assert.equal(shop.ensureEquipmentShop(now), false);
assert.deepEqual(world.raw.equipmentShop, sold);

const directory = mkdtempSync(path.join(tmpdir(), "jade-equipment-stock-"));
for (const [driver, create] of [["json", createWorldPersister], ["sqlite", createSqliteWorldPersister]]) {
  const filePath = path.join(directory, `stock.${driver}`);
  const persister = create({ world, filePath });
  persister.flushSync();
  persister.close?.();
  const restored = createMemoryWorldStore();
  const reader = create({ world: restored, filePath });
  assert.equal(reader.loadIfPresent().loaded, true);
  const resumed = serviceFor(restored, () => 0.1);
  assert.equal(resumed.ensureEquipmentShop(now), false);
  assert.deepEqual(restored.raw.equipmentShop, sold, `${driver}: restart does not restock sold machines`);
  reader.close?.();
}
const advancedWorld = createMemoryWorldStore();
const advancedShop = serviceFor(advancedWorld, () => 0.1);
advancedShop.ensureEquipmentShop(now);
assert.equal(advancedWorld.raw.equipmentShop.items.filter(item => catalog.find(model => model.modelKey === item.modelKey).techLevel > 1).length, 3);
assert.equal(advancedShop.ensureEquipmentShop(world.raw.equipmentShop.refreshAt - 1), false);
assert.equal(advancedShop.ensureEquipmentShop(world.raw.equipmentShop.refreshAt), true);
assert.equal(advancedWorld.raw.equipmentShop.day, sold.day + 1);
assert.ok(advancedWorld.raw.equipmentShop.items.every(item => item.stock === item.initialStock));
assert.equal(equipmentParamTone("risk", 1.18), "poor");
assert.equal(equipmentParamTone("risk", 0.88), "good");
assert.equal(equipmentParamTone("speed", 0), "neutral");
assert.equal(equipmentParamTone("quality", 8), "excellent");
Date.now = realNow;
if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith("jade-equipment-stock-")) throw new Error("invalid test directory");
rmSync(directory, { recursive: true, force: true });
console.log("equipment-shop-smoke: shared last-item sale, failed purchase, rollback, JSON/SQLite restart, daily restock and parameter colors ok");
