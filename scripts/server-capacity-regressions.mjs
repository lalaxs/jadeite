import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createDurableMutationCoordinator } from "../server/services/durable-mutation-coordinator.js";
import { initRankingModule, rankingRowsFor, rankBoardById } from "../public/features/ranking/ranking-module.js";

process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
H.world.clear();
for (let i = 0; i < 1000; i++) {
  const player = H.makePlayer(`capacity-${i}`);
  player.rep = i;
  player.cash = 1000 - i;
  H.refillOrders(player);
  H.world.setPlayer(player);
}
let participantCount = 0;
const coordinator = createDurableMutationCoordinator({ world: H.world, flush: async (options) => {
  participantCount = options.beforeSnapshot.players.length;
}, logger: { error() {}, warn() {} } });
H.processMiningWorld(Date.now());
let mutationScopes = 0;
const beginMutation = H.world.beginMutation;
H.world.beginMutation = (...args) => { mutationScopes++; return beginMutation(...args); };
await coordinator.read(() => H.inspectMiningHealth(Date.now()), { key: "inspection:mining" });
assert.equal(mutationScopes, 0, "readonly inspection of 1000 players must not capture rollback roots");
H.world.beginMutation = beginMutation;
let membershipParticipants = -1;
H.world.beginMutation = (...args) => {
  const scope = beginMutation(...args);
  return { ...scope, snapshots() {
    const snapshots = scope.snapshots(); membershipParticipants = snapshots.before.players.length; return snapshots;
  } };
};
await coordinator.run("capacity:mining-membership", () => H.processMiningWorld(Date.now()));
assert.equal(membershipParticipants, 0, "unchanged mining membership must not capture all licensed players");
H.world.beginMutation = beginMutation;
const durations = [];
for (let i = 0; i < 6; i++) {
  const start = performance.now();
  await coordinator.run("capacity:set-name", () => { H.world.getPlayer("capacity-0").name = `测试${i}`; });
  if (i) durations.push(performance.now() - start);
}
assert.equal(participantCount, 1, "copy work must be independent of saved player count");
const snapshot = H.snapshotFor(H.world.getPlayer("capacity-0"));
assert.equal(snapshot.players.length, 100, "public player directory must be bounded");
assert.equal(snapshot.rankings.rep.length, 100);
assert.equal(snapshot.rankingPlayerCount, 1000);
assert.equal(snapshot.rankingSelf.rep.row.rank, 1000);
assert.equal(snapshot.rankingSelf.rep.previous.rank, 999);
globalThis.document = { getElementById: () => null };
initRankingModule({ getState: () => snapshot, els: {}, helpers: {} });
const rows = rankingRowsFor(rankBoardById("rep"));
assert.equal(rows.find((row) => row.mine).rank, 1000, "client must retain true rank outside the top 100");
assert.equal(rows.length, 102);
await coordinator.close();
console.log(`server-capacity-regressions: 1000 players, 1 copied participant, 100-row boards and real self rank; mutation average=${(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2)}ms (no database/network)`);
