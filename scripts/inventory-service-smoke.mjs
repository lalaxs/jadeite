import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __testHooks as H } from "../server.js";
import {
  itemValue,
  materialStageFor,
  takeItem,
  addItem,
  markInventoryItemNew,
  markExternalMaterialNew,
  markInventoryItemsSeen,
  inventoryUnseenCount
} from "../server/services/inventory-service.js";

assert.equal(itemValue({ type: "rough", price: 1200 }), 1200);
assert.equal(itemValue({ type: "bracelet", value: 800 }), 800);

assert.equal(materialStageFor({ type: "rough" }), "rough");
assert.equal(materialStageFor({ type: "rough", revealed: true }), "opened");
assert.equal(materialStageFor({ type: "bracelet" }), "finished");
assert.equal(materialStageFor({ materialStage: "carved" }), "carved");

const player = {
  rough: [],
  materials: [],
  slices: [],
  bracelets: [],
  externalMaterials: { gold18k: 2 },
  externalMaterialsUnseen: {}
};

const marked = markInventoryItemNew({ id: "m1", type: "material", name: "料" });
assert.equal(marked.seen, false);
addItem(player, { id: "r1", type: "rough", name: "石", price: 100 });
assert.equal(player.rough[0].seen, false);
assert.equal(inventoryUnseenCount(player), 1);
const invalidItem = { id: "invalid-item", type: "unknown" };
assert.equal(addItem(player, invalidItem), null, "invalid inventory types must be rejected");
assert.equal(invalidItem.seen, undefined, "rejected items must not be marked as acquired");

markExternalMaterialNew(player, "gold18k");
assert.equal(inventoryUnseenCount(player), 2);

assert.equal(markInventoryItemsSeen(player, ["r1", "external:gold18k"]), 2);
assert.equal(player.rough[0].seen, true);
assert.equal(player.externalMaterialsUnseen.gold18k, undefined);

const taken = takeItem(player, "rough", "r1");
assert.equal(taken?.id, "r1");
assert.equal(player.rough.length, 0);

assert.equal(typeof H.takeItem, "function");
assert.equal(typeof H.addItem, "function");
assert.equal(typeof H.inventoryUnseenCount, "function");

const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
assert.match(bootSource, /inventory-service\.js/);
assert.doesNotMatch(serverSource, /function takeItem\(/);
assert.doesNotMatch(serverSource, /function materialStageFor\(/);
assert.doesNotMatch(serverSource, /function markInventoryItemNew\(/);
assert.doesNotMatch(serverSource, /function inventoryUnseenCount\(/);

const serviceSource = readFileSync("server/services/inventory-service.js", "utf8");
assert.match(serviceSource, /export function takeItem/);
assert.match(serviceSource, /export function materialStageFor/);
assert.match(serviceSource, /export function inventoryUnseenCount/);
assert.match(serviceSource, /export function inventoryRecyclePayout/);
assert.match(serviceSource, /export function recycleInventoryItemForPlayer/);
assert.equal(typeof H.inventoryRecyclePayout, "function");
assert.equal(typeof H.recycleInventoryItemForPlayer, "function");

console.log("inventory-service-smoke: ok");
process.exit(0);
