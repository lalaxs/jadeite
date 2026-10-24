import assert from "node:assert/strict";
import { createDurableMutationCoordinator } from "../server/services/durable-mutation-coordinator.js";

function makeWorld() {
  const raw = {
    players: new Map([["p1", { id: "p1", cash: 100 }]]),
    sockets: new Map([["s1", "p1"]])
  };
  return {
    raw,
    hasPlayer(id) { return raw.players.has(String(id)); },
    bindSocket(socketId, playerId) { raw.sockets.set(String(socketId), String(playerId)); },
    exportSnapshot() {
      return { players: structuredClone([...raw.players.entries()]) };
    },
    importSnapshot(snapshot) {
      raw.players = new Map(structuredClone(snapshot.players));
      raw.sockets.clear();
    }
  };
}

function makeSocket() {
  const handlers = new Map();
  const outgoing = [];
  return {
    handlers,
    outgoing,
    failEmit: false,
    on(event, listener) {
      handlers.set(event, listener);
      return this;
    },
    emit(event, ...args) {
      if (this.failEmit) throw new Error("transport unavailable");
      outgoing.push([event, ...args]);
      return true;
    },
    receive(event, ...args) {
      handlers.get(event)?.(...args);
    }
  };
}

const world = makeWorld();
let flushes = 0;
let failNext = false;
let rollbackCleanups = 0;
const coordinator = createDurableMutationCoordinator({
  world,
  async flush() {
    flushes += 1;
    if (failNext) {
      failNext = false;
      throw new Error("disk unavailable");
    }
  },
  onRollback() { rollbackCleanups += 1; },
  logger: { error() {}, warn() {} }
});
const socket = makeSocket();
coordinator.wrapSocketRegistration(socket, new Set(["spend"]));
socket.on("spend", (amount, ack) => {
  world.raw.players.get("p1").cash -= amount;
  socket.emit("state", { cash: world.raw.players.get("p1").cash });
  ack({ ok: true });
});

let firstAck = null;
socket.receive("spend", 25, (result) => { firstAck = result; });
assert.equal(socket.outgoing.length, 0, "network effects must wait for durable commit");
await coordinator.drain();
assert.equal(world.raw.players.get("p1").cash, 75);
assert.equal(flushes, 1);
assert.deepEqual(firstAck, { ok: true });
assert.equal(socket.outgoing[0][0], "state");

failNext = true;
let failedAck = null;
socket.receive("spend", 50, (result) => { failedAck = result; });
await coordinator.drain();
assert.equal(world.raw.players.get("p1").cash, 75, "failed persistence must restore world state");
assert.equal(rollbackCleanups, 1, "failed persistence must reset transport-side state");
assert.equal(failedAck.code, "PERSISTENCE_FAILED");
assert.equal(socket.outgoing.some(([event]) => event === "toast"), true);

socket.failEmit = true;
socket.receive("spend", 5, () => {});
await coordinator.drain();
assert.equal(world.raw.players.get("p1").cash, 70, "post-commit transport errors must not roll back durable state");
assert.equal(flushes, 3);

await coordinator.close();
console.log("durable-mutation-coordinator-smoke: commit barrier + rollback ok");
