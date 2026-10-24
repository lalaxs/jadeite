import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createProjectionDelta } from "../server/persistence/projection-delta.js";
import { applyWorldDelta, replayWorldDeltas } from "../server/persistence/world-delta.js";
import { createStateSignatureBuilder } from "../server/shell/state-signatures.js";
import { createSnapshotService } from "../server/services/snapshot-service.js";

const player = {
  id: "p1", name: "before", cash: 1000, rep: 20, level: 1,
  bracelets: Array.from({ length: 500 }, (_, i) => ({ id: `item-${i}`, type: "bracelet", value: i })),
  processedRequestIds: Array.from({ length: 200 }, (_, i) => `request-${i}`), ledger: []
};
const before = { version: 2, savedAt: 1, players: [[player.id, player]], sockets: [] };
const renamed = { ...structuredClone(player), name: "after" };
const delta = { version: 1, snapshotVersion: 2, savedAt: 2, players: { upsert: [[player.id, renamed]], remove: [] }, world: {}, removeWorldKeys: [] };
const nameChange = createProjectionDelta(before, delta);
assert.equal(nameChange.players.length, 1);
for (const key of ["inventory", "removedInventory", "requests", "removedRequests", "ledger"]) {
  assert.equal(nameChange[key].length, 0, `name-only mutation must not rewrite ${key}`);
}
renamed.processedRequestIds = [...renamed.processedRequestIds.slice(1), "request-new"];
renamed.bracelets[1].value++;
renamed.collection = [renamed.bracelets.shift()];
renamed.ledger.push({ id: "ledger-new", amount: 10, before: 1000, after: 1010 });
const selective = createProjectionDelta(before, delta);
assert.equal(selective.inventory.length, 2, "one edited item and one location move should update two rows");
assert.equal(selective.removedInventory.length, 0, "moving location retains the item id");
assert.deepEqual(selective.requests, [{ player_id: "p1", request_id: "request-new" }]);
assert.deepEqual(selective.removedRequests, [{ player_id: "p1", request_id: "request-0" }]);
assert.equal(selective.ledger.length, 1);
const receiver = { ...structuredClone(player), id: "p2", bracelets: [] };
const senderAfter = { ...structuredClone(player), bracelets: player.bracelets.slice(1) };
const receiverAfter = { ...receiver, bracelets: [player.bracelets[0]] };
const transfer = createProjectionDelta({ players: [["p1", player], ["p2", receiver]] }, {
  players: { upsert: [["p2", receiverAfter], ["p1", senderAfter]] }
});
assert.deepEqual(transfer.removedInventory, [{ item_id: "item-0", owner_player_id: "p1" }]);
assert.equal(transfer.inventory.length, 1);
assert.equal(transfer.inventory[0].owner_player_id, "p2");

const replayStart = structuredClone(before);
replayStart.players.push(["p2", receiver]);
replayStart.worldChat = [{ id: "old" }];
const deltas = [delta,
  { ...delta, savedAt: 3, players: { upsert: [["p2", receiverAfter]], remove: ["p1"] }, world: { news: [{ id: "new" }] }, removeWorldKeys: ["worldChat"] }
];
const immutableInput = structuredClone(replayStart);
const immutableDeltas = structuredClone(deltas);
const expected = { version: 2, savedAt: 3, players: [["p2", structuredClone(receiverAfter)]], sockets: [], news: [{ id: "new" }] };
const recovered = replayWorldDeltas(replayStart, deltas);
assert.deepEqual(recovered, expected, "bulk replay must preserve ordered delta semantics");
assert.deepEqual(deltas.reduce(applyWorldDelta, replayStart), expected, "legacy single-delta API must retain the same result");
assert.deepEqual(replayStart, immutableInput);
assert.deepEqual(deltas, immutableDeltas);
assert.throws(() => replayWorldDeltas(replayStart, [...deltas, { ...delta, snapshotVersion: 999 }]), /snapshot version/);
assert.deepEqual(replayStart, immutableInput, "late corrupt log must not alter the checkpoint input");
recovered.players[0][1].bracelets[0].value++;
assert.deepEqual(deltas, immutableDeltas, "recovered values must not alias journal payloads");

const fullCheckpoint = { ...before, players: Array.from({ length: 1000 }, (_, i) => [`p-${i}`, { ...structuredClone(player), id: `p-${i}` }]) };
// Use 50 records with a small participating player, avoiding a wall-clock pass threshold.
const journal = Array.from({ length: 50 }, (_, i) => ({ ...delta, savedAt: i + 10,
  players: { upsert: [["p-0", { ...player, id: "p-0", name: `replay-${i}` }]], remove: [] }
}));
const start = performance.now();
const clone = globalThis.structuredClone;
let completeWorldCopies = 0;
let largeRecovered;
try {
  globalThis.structuredClone = (value) => { if (value?.players?.length === 1000) completeWorldCopies++; return clone(value); };
  largeRecovered = replayWorldDeltas(fullCheckpoint, journal);
} finally { globalThis.structuredClone = clone; }
assert.equal(completeWorldCopies, 1, "recovery cost must not include one complete world copy per journal record");
assert.equal(largeRecovered.players.length, 1000);
assert.equal(largeRecovered.players[0][1].name, "replay-49");
console.log(`server-optimization-regressions: selective projections + transfer + immutable replay; 1000 players/500 items each, 50 deltas replayed in ${(performance.now() - start).toFixed(1)}ms (no database)`);

let serializations = 0;
const shared = { listings: { toJSON() { serializations++; return [{ id: "listing-1" }]; } }, news: [], serverNow: 1 };
const signaturesFor = createStateSignatureBuilder();
for (let i = 0; i < 100; i++) {
  const signatures = signaturesFor({ ...shared, me: { id: `p-${i}`, cash: i } }, shared);
  assert.equal(signatures.get("listings"), '[{"id":"listing-1"}]');
  assert.equal(signatures.get("me"), JSON.stringify({ id: `p-${i}`, cash: i }));
}
assert.equal(serializations, 1, "shared fields must serialize once per broadcast, independent of recipient count");
assert.equal(signaturesFor({ ...shared, listings: ["personalized"] }, shared).get("listings"), '["personalized"]');
signaturesFor({ ...shared }, { ...shared });
assert.equal(serializations, 2, "a new broadcast must calculate fresh signatures");

const p1 = { ...structuredClone(player), rough: [], materials: [], slices: [], collection: [], jobs: [], polishingJobs: [] };
const p2 = { ...structuredClone(p1), id: "p2", cash: 2000, rep: 30 };
const rankState = { players: new Map([["p1", p1], ["p2", p2]]), sockets: new Map(), roughPool: [], listings: [], news: [], worldChat: [] };
let rankingBuilds = 0;
const snapshots = createSnapshotService({ getState: () => rankState, TIMING: {},
  publicLivestreamRoom: () => null, metrics: { increment: () => { rankingBuilds++; } }
});
const first = snapshots.sharedSnapshotFor(1);
for (let i = 0; i < 20; i++) { rankState.worldChat = [{ id: `chat-${i}` }]; snapshots.sharedSnapshotFor(i + 2); }
assert.equal(rankingBuilds, 1, "chat-only broadcasts must reuse ranking computations");
first.rankings.cash[0].player.name = "snapshot-mutated";
assert.notEqual(snapshots.sharedSnapshotFor(22).rankings.cash[0].player.name, "snapshot-mutated", "transport must not expose the cached ranking rows");
p1.name = "renamed";
assert.equal(snapshots.sharedSnapshotFor(23).rankings.rep.find((row) => row.player.id === "p1").player.name, "renamed");
p1.cash = 3000;
assert.equal(snapshots.sharedSnapshotFor(24).rankings.cash[0].player.id, "p1");
p1.rep = 40;
assert.equal(snapshots.sharedSnapshotFor(25).rankings.rep[0].player.id, "p1");
p1.collection.push({ id: "rank-collection", type: "bracelet", value: 500, estimatedValue: 500 });
assert.equal(snapshots.sharedSnapshotFor(26).rankings.collection[0].player.id, "p1");
rankState.players.delete("p1");
assert.equal(snapshots.sharedSnapshotFor(27).rankingPlayerCount, 1);
rankState.players.set("p1", p1);
assert.equal(snapshots.sharedSnapshotFor(28).rankingPlayerCount, 2);
assert.equal(rankingBuilds, 7);
console.log("server-optimization-regressions: shared signatures + ranking reuse/invalidation + transport isolation ok");
