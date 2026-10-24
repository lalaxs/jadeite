import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { io } from "socket.io-client";
import { seedWorkshopDeliveryFixtures } from "./workshop-delivery-fixtures.mjs";

process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
const directory = mkdtempSync(path.join(tmpdir(), "jade-workshop-delivery-"));
const seedPath = path.join(directory, "seed.json");
const port = 36000 + process.pid % 1000;
const origin = `http://127.0.0.1:${port}`;
H.state.players.clear();
const player = H.makePlayer("delivery-socket-player");
H.state.players.set(player.id, player);
seedWorkshopDeliveryFixtures(H, player);
const auth = { playerId: player.id, resumeToken: H.playerSessions.issueSession(player) };
writeFileSync(seedPath, JSON.stringify(H.world.exportSnapshot()));
let server;
let serverOutput = "";
const sockets = [];
async function startServer() {
  server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "test", LOG_LEVEL: "warn",
      JADE_WORLD_PERSIST: "1", JADE_WORLD_PERSIST_DRIVER: "sqlite", JADE_WORLD_PATH: seedPath,
      JADE_WORLD_SQLITE_PATH: path.join(directory, "world.sqlite") }
  });
  server.stdout.on("data", (data) => { serverOutput += data; });
  server.stderr.on("data", (data) => { serverOutput += data; });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${origin}/health/ready`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`delivery server startup failed: ${serverOutput}`);
}
async function stopServer() {
  if (!server || server.exitCode != null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await exited;
}
async function connect(session = {}) {
  const socket = io(origin, { auth: session, transports: ["websocket"], autoConnect: false, reconnection: false });
  sockets.push(socket);
  const client = { socket, state: null };
  socket.on("state", (state) => { client.state = state; });
  const first = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`connection timeout: ${serverOutput}`)), 10000);
    socket.once("state", () => { clearTimeout(timer); resolve(); });
  });
  socket.connect(); await first; return client;
}
async function waitState(client, predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (predicate(client.state.me)) return client.state.me;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`state did not settle: ${serverOutput}`);
}
const ack = (client, event, payload) => client.socket.timeout(10000).emitWithAck(event, payload);

try {
  await startServer();
  const first = await connect(auth);
  assert.equal(first.state.me.workshopDeliveries.length, 3);
  const delivery = first.state.me.workshopDeliveries.find((row) => row.stage === "carving");
  const other = await connect();
  assert.equal((await ack(other, "claimWorkshopDelivery", { deliveryId: delivery.id, requestId: "delivery-other-owner" })).ok, false);
  assert.equal((await ack(first, "claimWorkshopDelivery", { deliveryId: delivery.id, requestId: "delivery-unopened" })).ok, false);
  assert.equal((await ack(first, "claimWorkshopDelivery", { deliveryId: delivery.id, items: [], requestId: "delivery-forged-items" })).ok, false);
  assert.equal((await ack(first, "revealWorkshopDelivery", { deliveryId: delivery.id, requestId: "delivery-reveal-once" })).ok, true);
  await waitState(first, (me) => me.workshopDeliveries.find((row) => row.id === delivery.id)?.revealedAt);
  first.socket.close();
  const resumed = await connect(auth);
  assert.ok(resumed.state.me.workshopDeliveries.find((row) => row.id === delivery.id).revealedAt);
  assert.equal(resumed.state.me.bracelets.length, 0);
  const claimed = await ack(resumed, "claimWorkshopDelivery", { deliveryId: delivery.id, requestId: "delivery-claim-once" });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.count, 3);
  assert.equal(claimed.auxiliaryCount, 1);
  const handed = await waitState(resumed, (me) => !me.workshopDeliveries.some((row) => row.id === delivery.id));
  assert.equal(handed.bracelets.length, 3);
  assert.equal(handed.materials.length, 1);
  assert.ok(handed.bracelets.every((item) => item.seen === false));
  assert.equal((await ack(resumed, "claimWorkshopDelivery", { deliveryId: delivery.id, requestId: "delivery-claim-once" })).duplicate, true);
  assert.equal((await ack(resumed, "claimWorkshopDelivery", { deliveryId: delivery.id, requestId: "delivery-claim-twice" })).ok, false);
  const opening = handed.workshopDeliveries.find((row) => row.stage === "opening");
  assert.ok(opening.scratchReveal?.itemIds.length);
  const scratchIds = opening.scratchReveal.itemIds;
  assert.equal((await ack(other, "revealWorkshopDelivery", { deliveryId: opening.id, itemIds: scratchIds, requestId: "scratch-other-owner" })).ok, false);
  assert.equal((await ack(resumed, "revealWorkshopDelivery", { deliveryId: opening.id, itemIds: scratchIds, requestId: "scratch-before-box" })).ok, false);
  assert.equal((await ack(resumed, "revealWorkshopDelivery", { deliveryId: opening.id, requestId: "scratch-open-box" })).ok, true);
  assert.equal((await ack(resumed, "claimWorkshopDelivery", { deliveryId: opening.id, requestId: "scratch-unrevealed" })).ok, false);
  assert.equal((await ack(resumed, "revealWorkshopDelivery", { deliveryId: opening.id, itemIds: ["forged"], requestId: "scratch-forged-item" })).ok, false);
  const revealedSlice = await ack(resumed, "revealWorkshopDelivery", { deliveryId: opening.id, itemIds: scratchIds, requestId: "scratch-reveal-slice" });
  assert.equal(revealedSlice.ok, true);
  assert.deepEqual(revealedSlice.scratchReveal.revealedItemIds, scratchIds);
  for (const socket of sockets) socket.close();
  await stopServer();
  await startServer();
  const restarted = await connect(auth);
  assert.equal(restarted.state.me.workshopDeliveries.length, 2);
  assert.equal(restarted.state.me.bracelets.length, 3);
  assert.equal(restarted.state.me.materials.length, 1);
  const restoredOpening = restarted.state.me.workshopDeliveries.find((row) => row.id === opening.id);
  assert.deepEqual(restoredOpening.scratchReveal.revealedItemIds, scratchIds, "surface reveal survives SQLite restart");
  const claimSlice = await ack(restarted, "claimWorkshopDelivery", { deliveryId: opening.id, requestId: "scratch-claim-slice" });
  assert.equal(claimSlice.ok, true);
  await waitState(restarted, (me) => !me.workshopDeliveries.some((row) => row.id === opening.id));
  assert.equal((await ack(restarted, "claimWorkshopDelivery", { deliveryId: delivery.id, requestId: "delivery-claim-once" })).duplicate, true);
  console.log("workshop-delivery-socket-e2e: durable reveal/claim, owner isolation, forged payload rejection, reconnect, restart and exactly-once inventory handover ok");
} finally {
  for (const socket of sockets) socket.close();
  await stopServer();
  if (path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith("jade-workshop-delivery-")) throw new Error("invalid test cleanup path");
  rmSync(directory, { recursive: true, force: true });
}
process.exit(0);
