import assert from "node:assert/strict";
import { createServerContext } from "../server/shell/server-context.js";

const player = { id: "patch-player" };
const state = {
  players: new Map([[player.id, player]]),
  sockets: new Map([["patch-socket", player.id]]),
  news: []
};
const outgoing = [];
const socket = {
  id: "patch-socket",
  handshake: { auth: { capabilities: { statePatchV1: true } } },
  emit(event, payload) { outgoing.push({ event, payload }); }
};
const io = { sockets: { sockets: new Map([[socket.id, socket]]) } };
const world = {
  getPlayer: (id) => state.players.get(id) || null,
  playerIdForSocket: (id) => state.sockets.get(id) || null,
  socketCountForPlayer: (id) => [...state.sockets.values()].filter((value) => value === id).length
};
const context = createServerContext({ io, world, getState: () => state, randomUUID: () => "id" });
let cash = 100;
context.bindSnapshotFor((_player, now) => ({ serverNow: now, me: { id: player.id, cash }, news: [] }));

assert.equal(context.emitState(socket, player, 1000, { forceFull: true }), true);
assert.equal(outgoing[0].event, "state");
assert.equal(outgoing[0].payload.stateVersion, 1);
assert.equal(context.emitState(socket, player, 1001), false, "serverNow alone must not emit a patch");
cash = 75;
assert.equal(context.emitState(socket, player, 1002), true);
assert.equal(outgoing[1].event, "state:patch");
assert.equal(outgoing[1].payload.baseVersion, 1);
assert.equal(outgoing[1].payload.stateVersion, 2);
assert.deepEqual(outgoing[1].payload.changes.me, { id: player.id, cash: 75 });

context.forgetSocketState(socket.id);
assert.equal(context.emitState(socket, player, 1003), true);
assert.equal(outgoing[2].event, "state");

// A reconnect can be bound before its explicit initial-state read runs.
// A public-only broadcast in that window still has to send a complete first frame.
context.bindSnapshotFor((_player, now, options) => ({ serverNow: now,
  ...(options.includePrivatePlayer !== false ? { me: { id: player.id, cash } } : {}),
  ...(options.includeStaticCatalogs ? { equipmentCatalog: ["opening"] } : {}), news: []
}), () => ({ news: [] }));
context.forgetSocketState(socket.id);
context.broadcast({ privatePlayerIds: [] });
assert.equal(outgoing.at(-1).event, "state");
assert.equal(outgoing.at(-1).payload.me.id, player.id, "first frame must retain private state even for an unrelated broadcast");
assert.deepEqual(outgoing.at(-1).payload.equipmentCatalog, ["opening"]);
context.resetStateCache();
context.broadcast({ privatePlayerIds: [] });
assert.equal(outgoing.at(-1).payload.me.cash, cash, "reset after rollback must also rebuild a complete frame");
socket.handshake.auth.capabilities.statePatchV1 = false;
context.broadcast({ privatePlayerIds: [] });
assert.equal(outgoing.at(-1).payload.me.cash, cash, "legacy clients must always receive a complete frame");

console.log("state-patch-smoke: capability negotiation + top-level deltas ok");
