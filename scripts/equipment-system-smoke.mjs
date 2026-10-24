import assert from "node:assert/strict";
import {
  equipmentCatalog,
  createDeviceInstance,
  normalizeDevice,
  buyEquipment,
  durabilityLoss,
  repairQuote,
  repairEquipment,
  MODEL_TECH_PRICE_MULTIPLIERS,
  MODEL_TECH_ATTR_BONUSES
} from "../server/systems/equipment-system.js";
import {
  EQUIPMENT_REPAIR_RATES,
  equipmentRepairQuote
} from "../shared/domain/economy/equipment-maintenance.js";

const catalog = equipmentCatalog();
assert.equal(catalog.length, 75);
assert.deepEqual(catalog.filter((entry) => entry.brandKey === "used").map((entry) => entry.price), [3200, 4600, 6200]);
assert.equal(catalog.every((entry) => entry.tier === 1), true);
assert.ok(Math.min(...catalog.map((entry) => entry.price)) <= 7_000);
assert.ok(Math.max(...catalog.map((entry) => entry.price)) >= 200_000);
assert.ok(Math.max(...catalog.map((entry) => entry.price)) < 250_000);
assert.deepEqual(MODEL_TECH_PRICE_MULTIPLIERS, [1, 3, 8]);
assert.deepEqual(EQUIPMENT_REPAIR_RATES, { 1: 0.25, 2: 0.20, 3: 0.15 });
assert.deepEqual(MODEL_TECH_ATTR_BONUSES[1], { quality: 6, speed: 15, perfectFloor: 12, riskSafety: 0.05 });
assert.deepEqual(MODEL_TECH_ATTR_BONUSES[2], { quality: 18, speed: 32, perfectFloor: 30, riskSafety: 0.12 });
assert.ok(
  catalog.find((entry) => entry.modelKey === "cuijie-opening-1").price
    < catalog.find((entry) => entry.modelKey === "cuijie-opening-2").price
);

const device = createDeviceInstance("opening", "rough", "dev-test");
assert.equal(device.capacity, 1);
assert.equal(normalizeDevice({ ...device, capacity: 9 }).capacity, 1);
assert.equal(normalizeDevice({ ...device, tier: 8 }).tier, 1);
assert.match(device.specs, /品质\+2%/);
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

const cashBeforeIdConflict = player.cash;
const duplicateBuy = buyEquipment(player, "rough", {
  spendCash: spend,
  makeId: () => "bought-1"
});
assert.equal(duplicateBuy.ok, false);
assert.equal(duplicateBuy.code, "ID_CONFLICT");
assert.equal(player.cash, cashBeforeIdConflict, "duplicate device ids must be rejected before payment");
assert.equal(player.workshop.devices.length, 1);

player.workshop.devices[0].condition = 0;
player.commissions = { active: { deviceIds: ["bought-1"] } };
const repairCash = player.cash;
assert.equal(repairEquipment(player, "bought-1", { spendCash: spend }).code, "DEVICE_BUSY");
assert.equal(player.cash, repairCash);
player.commissions.active = null;
player.jobs = [{ deviceId: "bought-1" }];
assert.equal(repairEquipment(player, "bought-1", { spendCash: spend }).code, "DEVICE_BUSY");
player.jobs = [];
player.polishingJobs = [{ deviceId: "bought-1" }];
assert.equal(repairEquipment(player, "bought-1", { spendCash: spend }).code, "DEVICE_BUSY");
player.polishingJobs = [];
assert.equal(repairQuote(player.workshop.devices[0]), Math.ceil(player.workshop.devices[0].basePrice * 0.25));
const tier2 = createDeviceInstance("opening", "cuijie-opening-2", "dev-tier-2");
const tier3 = createDeviceInstance("opening", "cuijie-opening-3", "dev-tier-3");
tier2.condition = 0;
tier3.condition = 0;
assert.equal(equipmentRepairQuote(tier2), Math.ceil(tier2.basePrice * 0.20));
assert.equal(equipmentRepairQuote(tier3), Math.ceil(tier3.basePrice * 0.15));
assert.equal(
  repairEquipment(player, "bought-1", { spendCash: spend }).ok,
  true
);
assert.equal(player.workshop.devices[0].condition, 100);

console.log("equipment-system-smoke: ok");
