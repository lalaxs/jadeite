import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TEST_HOOK_KEYS, createTestHooks } from "../server/shell/test-hooks.js";
import { __testHooks as H } from "../server.js";

assert.equal(TEST_HOOK_KEYS.length, 176);
assert.equal(Object.isFrozen(H), true);

for (const key of TEST_HOOK_KEYS) {
  assert.ok(key in H, `live hook missing: ${key}`);
  assert.notEqual(H[key], undefined, `${key} should be defined`);
}

assert.equal(typeof H.makePlayer, "function");
assert.equal(typeof H.snapshotFor, "function");
assert.equal(typeof H.TASK_RESET_COST, "number");
assert.equal(typeof H.BLACKMARKET_MIN_PRICE, "number");
assert.equal(typeof H.reconcileAuctionEscrows, "function");
assert.equal(typeof H.reconcileMarketReferences, "function");
assert.equal(typeof H.reconcileBlackmarketReferences, "function");
assert.equal(typeof H.ensureEquipmentShop, "function");
assert.equal(typeof H.buyShopEquipmentForPlayer, "function");

assert.throws(
  () => createTestHooks({ world: H.world }),
  /test-hooks: missing state/
);

const serverSource = readFileSync("server.js", "utf8") + readFileSync("server/create-game.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
const hooksSource = readFileSync("server/shell/test-hooks.js", "utf8");
assert.match(serverSource, /test-hooks\.js/);
assert.match(serverSource, /createTestHooks\(/);
assert.doesNotMatch(serverSource, /export const __testHooks = \{\s*\n\s*world,/);

assert.match(hooksSource, /export const TEST_HOOK_KEYS/);
assert.match(hooksSource, /export function createTestHooks/);

console.log("test-hooks-smoke: ok", TEST_HOOK_KEYS.length, "keys");
process.exit(0);
