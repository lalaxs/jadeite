import assert from "node:assert/strict";
import { readClientShellSource } from "./load-client-shell.mjs";
import { readFileSync } from "node:fs";
import {
  inventoryRecyclePayout,
  itemValue,
  recycleInventoryItemForPlayer,
  takeItem
} from "../server/services/inventory-service.js";
import {
  inventoryRecyclePayout as clientPayout,
  exitInventoryRecycleMode
} from "../public/inventory-module.js";
import { SOURCE_LABELS } from "../public/metric-history.js";

assert.equal(inventoryRecyclePayout(0), 0);
assert.equal(inventoryRecyclePayout(5), 1);
assert.equal(inventoryRecyclePayout(100), 20);
assert.equal(inventoryRecyclePayout(99), 19);
assert.equal(clientPayout(250), 50);
assert.equal(itemValue({ type: "rough", price: 0 }), 0, "explicit zero valuations must not become 1000");

const cashLog = [];
const money = (n) => Math.max(0, Math.round(Number(n) || 0));
const earnCash = (player, amount, label, meta) => {
  player.cash = money((player.cash || 0) + amount);
  cashLog.push({ amount, label, meta });
};
const deps = {
  money,
  earnCash,
  materialUnitPrice: (key) => (key === "gold18k" ? 380 : 0)
};

const player = {
  cash: 1000,
  rough: [{ id: "r1", name: "木那原石", type: "rough", price: 1000 }],
  materials: [
    { id: "m1", name: "明料", type: "material", value: 500 },
    { id: "esc1", name: "委托明料", type: "material", value: 800, escrowOrderId: "ord-1" }
  ],
  slices: [],
  bracelets: [{ id: "b1", name: "成品", type: "bracelet", value: 2000 }],
  externalMaterials: { gold18k: 4 },
  externalMaterialCosts: { gold18k: { quantity: 4, amount: 1500, complete: true } },
  externalMaterialsUnseen: { gold18k: true }
};

const jade = recycleInventoryItemForPlayer(player, { kind: "jade", itemId: "r1" }, deps);
assert.equal(jade.ok, true);
assert.equal(jade.payout, 200);
assert.equal(player.rough.length, 0);
assert.equal(player.cash, 1200);
assert.equal(cashLog.at(-1)?.meta?.source, "inventory-recycle");

const escrow = recycleInventoryItemForPlayer(player, { kind: "jade", itemId: "esc1" }, deps);
assert.equal(escrow.ok, false);
assert.match(String(escrow.message || ""), /委托/);
assert.equal(player.materials.some((item) => item.id === "esc1"), true);

const external = recycleInventoryItemForPlayer(player, { kind: "external", materialKey: "gold18k" }, deps);
assert.equal(external.ok, true);
assert.equal(external.quantity, 4);
assert.equal(external.value, 1520);
assert.equal(external.payout, 304);
assert.equal(player.externalMaterials.gold18k, 0);
assert.equal(player.externalMaterialCosts.gold18k, undefined);
assert.equal(player.externalMaterialsUnseen.gold18k, undefined);

const planned = recycleInventoryItemForPlayer(player, {
  kind: "planned",
  parentId: "m1",
  kitId: "kit-a"
}, deps);
assert.equal(planned.ok, true);
assert.equal(planned.clearClientKit, true);
assert.equal(planned.payout, 0);
assert.equal(planned.parentId, "m1");
assert.equal(planned.kitId, "kit-a");
assert.equal(player.materials.some((item) => item.id === "m1"), true);
const cashAfterPlanned = player.cash;
const repeatedPlanned = recycleInventoryItemForPlayer(player, {
  kind: "planned",
  parentId: "m1",
  kitId: "made-up-kit-id"
}, deps);
assert.equal(repeatedPlanned.ok, true);
assert.equal(repeatedPlanned.payout, 0);
assert.equal(player.cash, cashAfterPlanned, "unverifiable client-only drafts must never mint cash");

const missingParent = recycleInventoryItemForPlayer(player, {
  kind: "planned",
  parentId: "nope",
  kitId: "kit-a"
}, deps);
assert.equal(missingParent.ok, false);

player.bracelets.push({
  id: "invalid-value-item",
  name: "异常估值成品",
  type: "bracelet",
  value: Infinity
});
const cashBeforeInvalidValue = player.cash;
const invalidValue = recycleInventoryItemForPlayer(
  player,
  { kind: "jade", itemId: "invalid-value-item" },
  deps
);
assert.equal(invalidValue.ok, false);
assert.equal(invalidValue.code, "INVALID_RECYCLE_VALUE");
assert.equal(player.cash, cashBeforeInvalidValue);
assert.equal(
  player.bracelets.some((item) => item.id === "invalid-value-item"),
  true,
  "invalid valuation must preserve the owned item"
);

player.externalMaterials.sapphire = 2;
player.externalMaterialsUnseen.sapphire = true;
const invalidExternal = recycleInventoryItemForPlayer(
  player,
  { kind: "external", materialKey: "sapphire" },
  deps
);
assert.equal(invalidExternal.ok, false);
assert.equal(invalidExternal.code, "INVALID_RECYCLE_VALUE");
assert.equal(player.externalMaterials.sapphire, 2);
assert.equal(player.externalMaterialsUnseen.sapphire, true);

player.slices.push({ id: "zero-value-item", name: "零估值片料", type: "slice", value: 0 });
const zeroValue = recycleInventoryItemForPlayer(
  player,
  { kind: "jade", itemId: "zero-value-item" },
  deps
);
assert.equal(zeroValue.ok, true);
assert.equal(zeroValue.payout, 0);
assert.equal(player.slices.some((item) => item.id === "zero-value-item"), false);

// takeItem must match id by string coercion
const typed = {
  cash: 0,
  rough: [{ id: 4242, name: "编号石", type: "rough", price: 500 }],
  materials: [],
  slices: [],
  bracelets: [],
  externalMaterials: {}
};
assert.equal(takeItem(typed, "rough", "4242")?.name, "编号石");
assert.equal(typed.rough.length, 0);
const typed2 = {
  cash: 0,
  rough: [{ id: 4242, name: "编号石", type: "rough", price: 500 }],
  materials: [],
  slices: [],
  bracelets: [],
  externalMaterials: {}
};
const typedRecycle = recycleInventoryItemForPlayer(typed2, { kind: "jade", itemId: "4242" }, deps);
assert.equal(typedRecycle.ok, true);
assert.equal(typedRecycle.payout, 100);
assert.equal(typed2.cash, 100);

assert.equal(SOURCE_LABELS["inventory-recycle"], "库存回收");

const invSrc = readFileSync("public/features/inventory/inventory-module.js", "utf8");
assert.match(invSrc, /toggleInventoryRecycle/);
assert.match(invSrc, /inventory-recycle-toggle/);
assert.match(invSrc, /inventory-density-filters/);
assert.match(invSrc, /inventory-slot-recycle-btn/);
assert.match(invSrc, /确认回收/);
assert.match(invSrc, /INVENTORY_RECYCLE_PERCENT/);
assert.match(invSrc, /confirmInventoryRecycle/);
assert.match(invSrc, /pendingRecyclePayload/);
assert.match(invSrc, /clientAction:\s*"confirmInventoryRecycle"/);
assert.match(invSrc, /recycleMode = false/);
assert.match(invSrc, /data-inventory-reset/);

const cssSrc = readFileSync("public/styles/theme-inventory-chat.css", "utf8");
assert.match(cssSrc, /\.inventory-slot-recycle-btn/);
assert.match(cssSrc, /\.inventory-recycle-toggle/);
assert.match(cssSrc, /\.inventory-density-filters/);

const mainEntry = readFileSync("public/main.js", "utf8");
const mainSrc = readClientShellSource();
assert.match(mainSrc, /exitInventoryRecycleMode/);
assert.match(mainSrc, /removeOpeningKit/);
assert.match(mainSrc, /recycleInventoryItem/);

const socketSrc = [
  "server/shell/socket-handlers.js",
  "server/shell/commands/commerce-commands.js"
].map((file) => readFileSync(file, "utf8")).join("\n");
assert.match(socketSrc, /socket\.on\("recycleInventoryItem"/);

assert.equal(typeof exitInventoryRecycleMode, "function");
assert.equal(exitInventoryRecycleMode(), false);

console.log("inventory-recycle-smoke: ok");
process.exit(0);
