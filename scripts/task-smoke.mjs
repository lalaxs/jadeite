import assert from "node:assert/strict";
import { __testHooks as H } from "../server.js";
import { TASK_DEFINITIONS, TASK_REFRESH_MS } from "../server/services/task-service.js";

const player = H.makePlayer("task-smoke-player");
H.normalizePlayer(player);
assert.equal(player.tasks.length, H.TASK_COUNT);
assert.equal(new Set(player.tasks.map((task) => task.uid)).size, H.TASK_COUNT);
assert.equal(H.taskDefinitionAvailable(player, { type: "market_buy" }), true);
assert.equal(player.tasks.some((task) => task.type === "livestream_sell"), false);
assert.ok(player.tasks.every((task) => H.taskDefinitionAvailable(player, task)));
assert.equal(TASK_DEFINITIONS.some((task) => task.type === "commission_complete"), false);
assert.equal(player.tasks.some((task) => task.type === "commission_complete"), false);

player.tasks[0] = {
  ...player.tasks[0],
  type: "market_buy",
  status: "active"
};
player.taskRefreshedAt = Date.now();
assert.equal(H.refreshTasksIfDue(player, player.taskRefreshedAt + 1), false);
assert.equal(player.tasks[0].type, "market_buy");

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
assert.equal(reset.cost, 0);
assert.equal(player.cash, cashBeforeReset, "first reset on a fresh board should be free");
const secondResettable = player.tasks.find((task) => task.status === "active");
const second = H.resetTask(player, secondResettable.uid);
assert.equal(second.ok, true);
assert.equal(second.cost, 1000);
assert.equal(player.cash, cashBeforeReset - 1000);

const legacy = H.makePlayer("task-commission-retirement");
H.normalizePlayer(legacy);
const now = Date.now();
const task = (uid, type, status, progress, target = 1) => ({
  uid, type, status, progress, target, title: uid, desc: "旧存档日课", reward: 100, rep: 0, exp: 12, view: "workshop"
});
const unfinished = task("legacy-unfinished", "commission_complete", "active", 2, 3);
const complete = task("legacy-complete", "commission_complete", "complete", 3, 3);
const claimed = task("legacy-claimed", "commission_complete", "claimed", 3, 3);
const otherActive = task("other-in-progress", "workshop_craft", "active", 2, 3);
const otherComplete = task("other-ready", "market_buy", "complete", 1);
const otherClaimed = task("other-claimed", "window_open", "claimed", 1);
const retained = [complete, claimed, otherActive, otherComplete, otherClaimed];
const retainedBefore = structuredClone(retained);
legacy.tasks = [unfinished, ...retained];
legacy.taskRefreshedAt = now;
legacy.taskResetCount = 2;
const cashBeforeMigration = legacy.cash;
assert.equal(H.taskDefinitionAvailable(legacy, unfinished), false);
assert.equal(H.taskDefinitionAvailable(legacy, complete), true);
assert.equal(H.taskDefinitionAvailable(legacy, claimed), true);
assert.equal(H.refreshTasksIfDue(legacy, now + 1), true);
assert.equal(legacy.tasks.length, H.TASK_COUNT);
assert.equal(legacy.tasks.some((row) => row.uid === unfinished.uid), false);
assert.equal(H.taskDefinitionAvailable(legacy, legacy.tasks[0]), true);
assert.equal(legacy.tasks[0].status, "active");
assert.equal(legacy.tasks[0].progress, 0);
assert.equal(retained.some((row) => row.type === legacy.tasks[0].type), false, "replacement avoids existing task types");
assert.deepEqual(legacy.tasks.slice(1), retainedBefore, "retirement preserves all other progress and pending rewards");
for (const row of retained) assert.equal(legacy.tasks.find((item) => item.uid === row.uid), row);
assert.equal(legacy.cash, cashBeforeMigration, "retirement does not charge cash");
assert.equal(legacy.taskRefreshedAt, now, "retirement does not restart the task-board refresh clock");
assert.equal(legacy.taskResetCount, 2, "retirement does not consume or reset paid refresh usage");
const migratedBefore = structuredClone(legacy.tasks);
assert.equal(H.refreshTasksIfDue(legacy, now + 2), false);
assert.deepEqual(legacy.tasks, migratedBefore, "retirement runs once");
const legacyReward = H.claimTask(legacy, complete.uid);
assert.equal(legacyReward.ok, true, "already completed retired tasks still pay their recorded rewards");
assert.equal(legacy.cash, cashBeforeMigration + legacyReward.reward);
assert.equal(H.claimTask(legacy, complete.uid).ok, false);
assert.equal(H.claimTask(legacy, claimed.uid).ok, false);

const dueAt = now + TASK_REFRESH_MS;
assert.equal(H.refreshTasksIfDue(legacy, dueAt), true);
assert.equal(legacy.taskRefreshedAt, dueAt, "normal timed refresh still updates its timestamp");
assert.equal(legacy.taskResetCount, 0);
assert.equal(legacy.tasks.some((row) => row.type === "commission_complete"), false);

console.log("task-smoke: ok");
process.exit(0);
