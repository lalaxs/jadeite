import assert from "node:assert/strict";
import { createDurableMutationCoordinator } from "../server/services/durable-mutation-coordinator.js";

process.env.JADE_WORLD_PERSIST = "0";
process.env.JADE_MINING_REQUIRED_PLAYERS = "2";
process.env.JADE_MINING_APPLICATION_MS = "1000";
process.env.JADE_MINING_LEASE_MS = "10000";
const { __testHooks: H } = await import("../server.js");
H.world.clear();
const now = Date.now();
for (const id of ["scope-1", "scope-2"]) {
  const player = H.makePlayer(id); player.cash = 1_000_000; player.rep = 150;
  H.normalizePlayer(player); H.world.setPlayer(player);
}
H.processMiningWorld(now);
const winner = H.world.getPlayer("scope-1");
assert.equal(H.submitMiningApplication(winner, ["core-06"], now, { allowFallback: true }).ok, true);
const startsAt = H.state.mining.currentRound.startsAt;
H.processMiningWorld(startsAt);
const lease = H.state.mining.currentRound.leases.find((entry) => entry.playerId === winner.id);
assert.ok(lease);
let fail = false;
let participants = [];
const begin = H.world.beginMutation;
H.world.beginMutation = (...args) => {
  const scope = begin(...args);
  return { ...scope, snapshots() {
    const snapshots = scope.snapshots(); participants = snapshots.before.players.map(([id]) => id); return snapshots;
  } };
};
const queue = createDurableMutationCoordinator({ world: H.world, logger: { error() {} },
  flush: async () => { if (fail) throw new Error("injected mining write failure"); }
});
await queue.run("mining:healthy", () => H.processMiningWorld(startsAt + 1));
assert.deepEqual(participants, [], "healthy allocated leases and roster must remain read-only");

const history = winner.mining.leaseHistory.find((entry) => entry.id === lease.id);
history.endsAt -= 1;
const damagedPlayer = structuredClone(winner);
fail = true;
await assert.rejects(queue.run("mining:repair", () => H.processMiningWorld(startsAt + 2)), /mining write failure/);
assert.deepEqual(participants, [winner.id], "lease-history repair must enlist its owner");
assert.deepEqual(H.world.getPlayer(winner.id), damagedPlayer, "failed history repair must roll back the captured player");
fail = false;
await queue.run("mining:repair", () => H.processMiningWorld(startsAt + 3));
assert.equal(H.world.getPlayer(winner.id).mining.leaseHistory.find((entry) => entry.id === lease.id).endsAt, lease.endsAt);

const debtor = H.world.getPlayer("scope-2");
H.holdDeposit(debtor, 1000, "过期申请测试冻结", { source: "miningLease" });
H.state.mining.applications.push({ id: "scope-expired", playerId: debtor.id, playerName: debtor.name,
  targetRound: 1, preferences: ["core-06"], allowFallback: true, escrow: 1000, submittedAt: now, revision: 1 });
const beforeRefund = structuredClone(debtor);
const beforeApplications = structuredClone(H.state.mining.applications);
fail = true;
await assert.rejects(queue.run("mining:refund", () => H.processMiningWorld(startsAt + 4)), /mining write failure/);
assert.ok(participants.includes(debtor.id), "refund must reacquire a writable player after read-only inspection");
assert.deepEqual(H.world.getPlayer(debtor.id), beforeRefund);
assert.deepEqual(H.state.mining.applications, beforeApplications);
fail = false;
await queue.run("mining:refund", () => H.processMiningWorld(startsAt + 5));
assert.equal(H.world.getPlayer(debtor.id).cash, beforeRefund.cash + 1000);
assert.equal(H.state.mining.applications.length, 0);
await queue.close(); H.world.beginMutation = begin;
console.log("mining-read-scope-regressions: healthy roster/leases copy zero players; history repair and refund retain rollback protection ok");
