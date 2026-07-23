import assert from "node:assert/strict";
import {
  equipmentCatalog,
  createDeviceInstance,
  normalizeDevice,
  buyEquipment,
  durabilityLoss,
  repairQuote,
  repairEquipment
} from "../server/systems/equipment-system.js";

assert.equal(equipmentCatalog().length, 9);
assert.equal(equipmentCatalog().every((entry) => entry.tier === 1), true);

const device = createDeviceInstance("opening", "rough", "dev-test");
assert.equal(device.capacity, 1);
assert.equal(normalizeDevice({ ...device, capacity: 9 }).capacity, 1);
assert.equal(normalizeDevice({ ...device, tier: 8 }).tier, 1);
assert.match(device.specs, /品质\+3%/);
assert.equal(durabilityLoss({ attrs: { risk: 1.2 } }), 2);
assert.equal(durabilityLoss({ attrs: { risk: 0.85 } }), 1);

const player = { cash: 50000, workshop: { devices: [] } };
const spend = (target, amount) => {
  if (target.cash < amount) return false;
  target.cash -= amount;
  return true;
};
assert.equal(
  buyEquipment(player, "rough", { spendCash: spend, makeId: () => "bought-1" }).ok,
  true
);
assert.equal(player.workshop.devices.length, 1);
assert.equal(player.workshop.devices[0].capacity, 1);

player.workshop.devices[0].condition = 0;
assert.equal(repairQuote(player.workshop.devices[0]), 3150);
assert.equal(
  repairEquipment(player, "bought-1", { spendCash: spend }).ok,
  true
);
assert.equal(player.workshop.devices[0].condition, 100);

console.log("equipment-system-smoke: ok");
