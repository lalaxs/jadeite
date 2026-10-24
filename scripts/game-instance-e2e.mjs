import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { io } from "socket.io-client";
import { bindAchievementRewards } from "../server/services/achievement-rewards.js";
import { bindAuctionApi } from "../server/services/auction-service.js";
import { bindMarketApi } from "../server/services/market-service.js";
import { bindBlackmarketApi } from "../server/services/blackmarket-service.js";
import { seedWorkshopDeliveryFixtures } from "./workshop-delivery-fixtures.mjs";

const signalCounts = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
const intervals = new Set();
const originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval;
globalThis.setInterval = (...args) => { const timer = originalSet(...args); intervals.add(timer); return timer; };
globalThis.clearInterval = timer => { intervals.delete(timer); originalClear(timer); };
const { createGame } = await import("../server/create-game.js");
assert.equal(intervals.size, 0, "importing the factory creates no timer");
assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], signalCounts);

const directory = mkdtempSync(path.join(tmpdir(), "jade-game-instance-"));
const games = [], sockets = [], checks = [];
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function makeGame(label, persistent = true) {
  const env = { NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(await freePort()), LOG_LEVEL: "silent",
    JADE_WORLD_PERSIST: persistent ? "1" : "0", JADE_WORLD_PERSIST_DRIVER: "sqlite",
    JADE_WORLD_PATH: path.join(directory, `${label}.json`), JADE_WORLD_SQLITE_PATH: path.join(directory, `${label}.sqlite`) };
  const game = createGame({ env }); games.push(game); return { game, env };
}
async function connect(game, auth, transports = ["websocket"]) {
  const socket = io(`http://127.0.0.1:${game.runtimeConfig.port}`, { auth, transports, autoConnect: false, reconnection: false });
  sockets.push(socket);
  const state = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("socket state timeout")), 10000);
    socket.once("state", value => { clearTimeout(timeout); resolve(value); });
    socket.once("connect_error", error => { clearTimeout(timeout); reject(error); });
  });
  socket.connect();
  return { socket, initial: await state };
}
async function toast(client, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('toast timeout: ' + event)), 5000);
    client.socket.once('toast', value => { clearTimeout(timer); resolve(value); });
    client.socket.emit(event, payload);
  });
}
try {
  const a = await makeGame("a"), b = await makeGame("b");
  const auth = [];
  for (const [index, { game, env }] of [a, b].entries()) {
    const H = game.__testHooks, player = H.makePlayer("same-player-id");
    player.name = `实例${index}`; player.cash = 200000; player.exp = 1000000;
    H.world.setPlayer(player);
    seedWorkshopDeliveryFixtures(H, player);
    auth.push({ playerId: player.id, resumeToken: H.playerSessions.issueSession(player) });
    writeFileSync(env.JADE_WORLD_PATH, JSON.stringify(H.world.exportSnapshot()));
  }
  assert.notEqual(a.game.world, b.game.world);
  assert.notEqual(a.game.io, b.game.io);
  assert.notEqual(a.game.health, b.game.health);
  assert.notEqual(a.game.metrics, b.game.metrics);
  const starts = [a.game.startServer(), b.game.startServer()];
  assert.equal(a.game.startServer(), starts[0]);
  await Promise.all(starts);
  assert.equal((await fetch(`http://127.0.0.1:${a.env.PORT}/health/ready`)).status, 200);
  const asset = await fetch(`http://127.0.0.1:${a.env.PORT}/main.js`);
  assert.equal(await asset.text(), readFileSync("public/main.js", "utf8"));
  assert.equal(asset.headers.get("cache-control"), "no-cache");
  const ca = await connect(a.game, auth[0]), cb = await connect(b.game, auth[1], ["polling"]);
  assert.equal(ca.initial.me.name, "实例0"); assert.equal(cb.initial.me.name, "实例1");
  assert.equal(b.game.__testHooks.playerSessions.verifySession(b.game.world.getPlayer(auth[1].playerId), auth[0].resumeToken), false, "a token from another world cannot resume the same id");
  checks.push("two independent worlds, HTTP assets, websocket and polling, same-id session isolation");

  const poison = new Proxy({}, { get() { throw new Error("legacy binding reached by an owned game"); } });
  bindAchievementRewards({ earnCash() { throw new Error("legacy achievement wallet reached"); } });
  bindAuctionApi(poison); bindMarketApi(poison); bindBlackmarketApi(poison);
  const bPlayerBefore = structuredClone(b.game.world.getPlayer(auth[1].playerId));
  assert.match(await toast(ca, "buyMaterialPack", { materialId: "ruby", amount: 2, requestId: "game-buy-1" }), /购入/);
  assert.equal(a.game.world.getPlayer(auth[0].playerId).externalMaterials.ruby, 2);
  assert.deepEqual(b.game.world.getPlayer(auth[1].playerId), bPlayerBefore);
  const firstCash = a.game.world.getPlayer(auth[0].playerId).cash;
  assert.match(await toast(ca, "buyMaterialPack", { materialId: "ruby", amount: 2, requestId: "game-buy-1" }), /已处理/);
  assert.equal(a.game.world.getPlayer(auth[0].playerId).cash, firstCash);
  const claim = await toast(ca, "achievement:claimAll", { requestId: "game-claim" });
  assert.match(claim, /已领取/);
  assert.ok(Object.values(a.game.world.getPlayer(auth[0].playerId).achievements).some(value => value.claimedAt));
  assert.deepEqual(b.game.world.getPlayer(auth[1].playerId), bPlayerBefore);
  checks.push("owned reward hooks, legacy-rebind isolation, durable purchase and duplicate request");

  const beforeStopTimers = intervals.size;
  const close = a.game.shutdown("test-a");
  assert.equal(a.game.shutdown("test-a-again"), close);
  await close;
  assert.equal(a.game.status().phase, "stopped");
  assert.ok(intervals.size < beforeStopTimers, "only the stopped game's intervals are removed");
  assert.equal((await fetch(`http://127.0.0.1:${b.env.PORT}/health/ready`)).status, 200);
  assert.match(await toast(cb, "buyMaterialPack", { materialId: "silver925", amount: 1, requestId: "b-still-running" }), /购入/);
  const history = await cb.socket.timeout(5000).emitWithAck("getMaterialHistory", "goldPure");
  assert.equal(history.history.length, 14);
  await assert.rejects(a.game.startServer(), { code: "ERR_GAME_CLOSED" });
  checks.push("stopping one game leaves the other's health, socket, queue and timers active");

  const replacement = createGame({ env: a.env }); games.push(replacement);
  await replacement.startServer();
  const resumed = await connect(replacement, auth[0]);
  assert.equal(resumed.initial.me.id, auth[0].playerId);
  assert.ok(resumed.initial.me.externalMaterials.ruby >= 2);
  assert.equal(resumed.initial.me.workshopDeliveries.length, 3);
  assert.match(await toast(resumed, "buyMaterialPack", { materialId: "ruby", amount: 2, requestId: "game-buy-1" }), /已处理/);
  checks.push("new instance reopens the same SQLite save, sessions, pending deliveries and request deduplication");

  const failed = createGame({ env: { ...b.env, JADE_WORLD_PERSIST: '0' } }); games.push(failed);
  await assert.rejects(failed.startServer(), { code: 'EADDRINUSE' });
  assert.equal(failed.status().phase, 'failed');
  assert.equal((await fetch('http://127.0.0.1:' + b.env.PORT + '/health/ready')).status, 200);
  checks.push('listen failure cleans up its own resources and leaves the serving game intact');

  const activeBeforeConstructionFailure = [...intervals].filter(timer => !timer._destroyed).length;
  assert.throws(() => createGame({ env: a.env, createPersister() { throw new Error('adapter construction failed'); } }), /adapter construction failed/);
  assert.equal([...intervals].filter(timer => !timer._destroyed).length, activeBeforeConstructionFailure);
  const brokenPath = path.join(directory, 'broken.json');
  writeFileSync(brokenPath, '{invalid save');
  const broken = createGame({ env: { ...a.env, PORT: String(await freePort()), JADE_WORLD_PERSIST_DRIVER: 'json', JADE_WORLD_PATH: brokenPath } }); games.push(broken);
  await assert.rejects(broken.startServer());
  assert.equal(broken.httpServer.listening, false);
  assert.equal(readFileSync(brokenPath, 'utf8'), '{invalid save', 'failed load must preserve the corrupt input for recovery');
  checks.push('constructor failure and corrupt save release resources without replacing the source save');

  const unused = await makeGame("unused", false);
  await unused.game.shutdown();
  assert.equal(unused.game.httpServer.listening, false);
  checks.push("unstarted game disposal");
} catch (error) {
  console.error("game-instance-e2e failure:", error);
  throw error;
} finally {
  for (const socket of sockets) socket.close();
  const closed = await Promise.allSettled(games.map(game => game.shutdown()));
  globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear;
  const activeIntervals = [...intervals].filter(timer => !timer._destroyed);
  assert.equal(activeIntervals.length, 0, `all owned intervals must be released: ${activeIntervals.map(timer => String(timer._onTimeout).slice(0, 160))}`);
  assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], signalCounts);
  assert.ok(closed.every(result => result.status === "fulfilled"), "all game resources close successfully");
  if (path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith("jade-game-instance-")) throw new Error("invalid cleanup target");
  rmSync(directory, { recursive: true, force: true });
}
console.log(JSON.stringify({ ok: true, checks, activeIntervalsRemaining: [...intervals].filter(timer => !timer._destroyed).length }));
