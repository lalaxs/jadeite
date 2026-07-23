import assert from "node:assert/strict";
import { __testHooks as H } from "../server.js";

const player = H.makePlayer("task-smoke-player");
H.normalizePlayer(player);
assert.equal(player.tasks.length, H.TASK_COUNT);
assert.equal(new Set(player.tasks.map((task) => task.uid)).size, H.TASK_COUNT);

const active = player.tasks[0];
H.advanceTask(player, active.type, active.target);
assert.equal(player.tasks.find((task) => task.uid === active.uid).status, "complete");

const cashBeforeClaim = player.cash;
const claim = H.claimTask(player, active.uid);
assert.equal(claim.ok, true);
assert.equal(player.cash, cashBeforeClaim + claim.reward);
assert.equal(H.claimTask(player, active.uid).ok, false);

const resettable = player.tasks.find((task) => task.status === "active");
const cashBeforeReset = player.cash;
const reset = H.resetTask(player, resettable.uid);
assert.equal(reset.ok, true);
assert.equal(player.cash, cashBeforeReset - H.TASK_RESET_COST);

console.log("task-smoke: ok");
process.exit(0);
