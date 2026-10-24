import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServerContext } from "../server/shell/server-context.js";
import { __testHooks as H } from "../server.js";

const io = {
  sockets: {
    sockets: {
      get: () => null
    }
  }
};

const ctx = createServerContext({
  io,
  world: H.world,
  getState: () => H.state,
  randomUUID: () => "ctx-test-id"
});

assert.equal(typeof ctx.emitUiEvent, "function");
assert.equal(typeof ctx.broadcast, "function");
assert.equal(typeof ctx.consumeRequestId, "function");
assert.equal(typeof ctx.normalizeMutationPayload, "function");
assert.equal(typeof ctx.addNews, "function");
assert.equal(typeof ctx.getPlayer, "function");
assert.equal(typeof ctx.isPlayerOnline, "function");

assert.deepEqual(ctx.normalizeMutationPayload(null), {});
assert.deepEqual(ctx.normalizeMutationPayload("legacy"), {});

const player = H.makePlayer("ctx-player");
H.state.players.set(player.id, player);
assert.equal(ctx.consumeRequestId(player, "req-1"), true);
assert.equal(ctx.consumeRequestId(player, "req-1"), false);
assert.deepEqual(player.processedRequestIds, ["req-1"], "dedupe ids should persist with the player");
assert.equal(ctx.consumeRequestId(player, "x".repeat(129)), false);
assert.equal(ctx.consumeRequestId(player, "request id with spaces"), false);
assert.deepEqual(
  player.processedRequestIds,
  ["req-1"],
  "invalid request ids must not inflate the persisted dedupe history"
);

ctx.bindSnapshotFor(H.snapshotFor);
H.state.news = [];
ctx.addNews("测试快讯", "info");
assert.equal(H.state.news[0].text, "测试快讯");

assert.equal(typeof H.consumeRequestId, "function");
assert.equal(typeof H.normalizeMutationPayload, "function");
assert.equal(typeof H.emitUiEvent, "function");
assert.equal(typeof H.broadcast, "function");
assert.equal(typeof H.playerSocketCount, "function");

const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
const contextSource = readFileSync("server/shell/server-context.js", "utf8");
assert.match(bootSource, /server-context\.js/);
assert.match(bootSource, /createServerContext/);
assert.match(bootSource, /bindSnapshotFor\(snapshotFor, sharedSnapshotFor\)/);
assert.doesNotMatch(serverSource, /function emitUiEvent\(/);
assert.doesNotMatch(serverSource, /function broadcast\(/);
assert.doesNotMatch(serverSource, /function consumeRequestId\(/);
assert.doesNotMatch(serverSource, /function getPlayer\(/);

assert.match(contextSource, /function emitUiEvent/);
assert.match(contextSource, /function broadcast/);
assert.match(contextSource, /playerSocketCount\(player\.id\)\s*>\s*0/);

console.log("server-context-smoke: ok");
process.exit(0);
