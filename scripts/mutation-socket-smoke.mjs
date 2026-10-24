import assert from "node:assert/strict";
import {
  installMutationRequestIds,
  mutationEnvelope,
  MUTATION_SOCKET_EVENTS
} from "../public/shell/mutation-socket.js";
import { normalizeMutationPacketPayload } from "../shared/protocol/mutation-events.js";

assert.equal(MUTATION_SOCKET_EVENTS.has("setName"), true);
assert.equal(MUTATION_SOCKET_EVENTS.has("sendWorldChat"), true);
assert.equal(MUTATION_SOCKET_EVENTS.has("miningUpgradeFacility"), true);
assert.equal(MUTATION_SOCKET_EVENTS.has("miningResolveIncident"), true);
assert.equal(MUTATION_SOCKET_EVENTS.has("miningTrainMiner"), true);
assert.equal(MUTATION_SOCKET_EVENTS.has("miningCareMiner"), true);
assert.equal(MUTATION_SOCKET_EVENTS.has("miningResolveMinerRetention"), true);
assert.equal(MUTATION_SOCKET_EVENTS.has("miningFormMentorship"), true);
assert.equal(MUTATION_SOCKET_EVENTS.has("miningEndMentorship"), true);
assert.equal(MUTATION_SOCKET_EVENTS.has("miningSpecializeMiner"), true);
assert.equal(MUTATION_SOCKET_EVENTS.has("miningRenewMinerContract"), true);
assert.equal(MUTATION_SOCKET_EVENTS.has("miningPromoteMiner"), true);
assert.equal(MUTATION_SOCKET_EVENTS.has("debugGrant"), false);
assert.equal(MUTATION_SOCKET_EVENTS.has("debugSpawnFinished"), false);

const nullMutationPacket = ["buyMaterialPack", null];
assert.equal(normalizeMutationPacketPayload(nullMutationPacket), true);
assert.deepEqual(nullMutationPacket, ["buyMaterialPack", {}]);
const debugPacket = ["debugGrant", null];
assert.equal(normalizeMutationPacketPayload(debugPacket), false);
assert.deepEqual(debugPacket, ["debugGrant", null]);

let sequence = 0;
const makeRequestId = (event) => `${event}-${++sequence}`;
assert.deepEqual(
  mutationEnvelope("buyListing", "listing-1", makeRequestId),
  { value: "listing-1", requestId: "buyListing-1" }
);
const explicit = { listingId: "listing-2", requestId: "already-there" };
assert.equal(mutationEnvelope("buyListing", explicit, makeRequestId), explicit);

const calls = [];
const socket = {
  emit(event, ...args) {
    calls.push([event, ...args]);
    return this;
  }
};
installMutationRequestIds(socket, {
  makeRequestId
});
socket.emit("buyListing", "listing-3");
socket.emit("collectPayout");
socket.emit("setName", "新掌柜");
const chatAck = () => {};
socket.emit("sendWorldChat", { text: "开市大吉" }, chatAck);
socket.emit("state", { untouched: true });

assert.deepEqual(calls[0], ["buyListing", { value: "listing-3", requestId: "buyListing-2" }]);
assert.deepEqual(calls[1], ["collectPayout", { value: undefined, requestId: "collectPayout-3" }]);
assert.deepEqual(calls[2], ["setName", { value: "新掌柜", requestId: "setName-4" }]);
assert.deepEqual(calls[3], ["sendWorldChat", { text: "开市大吉", requestId: "sendWorldChat-5" }, chatAck]);
assert.deepEqual(calls[4], ["state", { untouched: true }]);

console.log("mutation-socket-smoke: ok");
