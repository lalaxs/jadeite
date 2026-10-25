import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { io } from "socket.io-client";
import { createDeviceInstance } from "../server/systems/equipment-system.js";

// Every world/SQLite file and server process belongs only to this fixture.
process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
H.world.clear();
const auth = {};
for (const id of ["commission-fresh", "commission-intruder", "commission-equipped"]) {
  const player = H.makePlayer(id);
  if (id === "commission-equipped") {
    player.cash = 100_000;
    player.workshop.devices = ["opening", "carving", "finishing"].map((stage) => {
      const device = createDeviceInstance(stage, `jingong-${stage}-3`, `commission-gear-${stage}`);
      device.condition = 81;
      device.resourceOrigin = "fixture";
      return device;
    });
    H.normalizePlayer(player);
  }
  H.state.players.set(id, player);
  auth[id] = { playerId: id, resumeToken: H.playerSessions.issueSession(player) };
}
const directory = mkdtempSync(path.join(tmpdir(), "jade-commission-socket-"));
const seedPath = path.join(directory, "seed.json");
writeFileSync(seedPath, JSON.stringify(H.world.exportSnapshot()));
const port = 46000 + process.pid % 1000;
const origin = `http://127.0.0.1:${port}`;
const clients = [];
let server;
let output = "";
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function start() {
  server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "test", LOG_LEVEL: "warn",
      JADE_TIMING_PROFILE: "test", JADE_WORLD_PERSIST: "1", JADE_WORLD_PERSIST_DRIVER: "sqlite",
      JADE_WORLD_PATH: seedPath, JADE_WORLD_SQLITE_PATH: path.join(directory, "world.sqlite") }
  });
  let spawnError;
  server.once("error", (error) => { spawnError = error; });
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (server.exitCode != null) throw new Error(`isolated server exited: ${output}`);
    try { if ((await fetch(`${origin}/health/ready`)).ok) return; } catch {}
    await pause(60);
  }
  throw new Error(`isolated server startup timeout: ${output}`);
}

async function stop() {
  for (const client of clients.splice(0)) client.socket.close();
  if (!server || server.exitCode != null || !server.pid) return;
  const processToStop = server;
  const stopped = new Promise((resolve) => processToStop.once("exit", resolve));
  processToStop.kill("SIGTERM");
  await Promise.race([stopped, pause(15_000).then(() => {
    if (processToStop.exitCode == null) {
      processToStop.kill("SIGKILL");
      throw new Error("isolated commission server did not stop within its grace period");
    }
  })]);
}

async function connect(id) {
  const socket = io(origin, { auth: auth[id], transports: ["websocket"], reconnection: false, autoConnect: false });
  const client = { socket, state: null, toasts: [] };
  clients.push(client);
  socket.on("state", (state) => { client.state = state; });
  socket.on("toast", (toast) => { client.toasts.push(String(toast)); });
  const initial = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`initial snapshot timeout for ${id}: ${output}`)), 10_000);
    socket.once("state", () => { clearTimeout(timer); resolve(); });
    socket.once("connect_error", (error) => { clearTimeout(timer); reject(error); });
  });
  socket.connect();
  await initial;
  return client;
}

async function until(client, predicate) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (client.state && predicate(client.state)) return client.state;
    await pause(20);
  }
  throw new Error(`snapshot condition timeout for ${client.state?.me?.id}: ${output}`);
}

const ack = (client, event, payload) => client.socket.timeout(10_000).emitWithAck(event, payload);
function toastAction(client, event, payload) {
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`toast timeout for ${event}: ${output}`)), 10_000);
    client.socket.once("toast", (toast) => { clearTimeout(timer); resolve(String(toast)); });
  });
  client.socket.emit(event, payload);
  return response;
}
function contractOf(active) {
  const { ready, ...contract } = active;
  return contract;
}

try {
  await start();
  let fresh = await connect("commission-fresh");
  let intruder = await connect("commission-intruder");
  let equipped = await connect("commission-equipped");
  assert.equal(fresh.state.me.cash, 12_000);
  assert.deepEqual(fresh.state.me.workshop.devices, []);
  assert.deepEqual(fresh.state.me.workshop.workers, []);
  assert.equal(Object.hasOwn(fresh.state.me.workshop, "publicStations"), false);
  assert.equal(fresh.state.me.workshop.owner.isOwner, true);

  // Strict schemas must reject client-authored rewards, timers and claim values.
  for (const extra of [{ netPay: 999_999 }, { readyAt: 1 }]) {
    const rejected = await ack(fresh, "startCommission", { offerId: "standard", requestId: `invalid-start-${Object.keys(extra)[0]}`, ...extra });
    assert.equal(rejected.ok, false);
  }
  assert.equal(fresh.state.me.commissions.active, null);
  const initialCash = fresh.state.me.cash;
  const startPayload = { offerId: "standard", requestId: "commission-start-once" };
  const started = await ack(fresh, "startCommission", startPayload);
  assert.equal(started.ok, true, started.message);
  const firstContract = structuredClone(started.commission);
  assert.equal(firstContract.netPay, 180);
  assert.ok(firstContract.readyAt > firstContract.startedAt);
  const early = await ack(fresh, "claimCommission", { commissionId: firstContract.id, requestId: "commission-early-claim" });
  assert.equal(early.code, "NOT_READY");
  const duplicateStart = await ack(fresh, "startCommission", startPayload);
  assert.equal(duplicateStart.ok, false);
  assert.equal(duplicateStart.duplicate, true);
  const foreignClaim = await ack(intruder, "claimCommission", { commissionId: firstContract.id, requestId: "commission-foreign-claim" });
  assert.equal(foreignClaim.ok, false);
  assert.equal(intruder.state.me.cash, 12_000);
  for (const extra of [{ netPay: 999_999 }, { readyAt: 1 }]) {
    const rejected = await ack(fresh, "claimCommission", { commissionId: firstContract.id, requestId: `invalid-claim-${Object.keys(extra)[0]}`, ...extra });
    assert.equal(rejected.ok, false);
  }
  await until(fresh, (state) => state.me.commissions.active?.id === firstContract.id);
  assert.equal(fresh.state.me.cash, initialCash);

  // A high-value, fully owned line also persists a quote above the old 1,000 cap.
  const equippedCash = equipped.state.me.cash;
  const gearStart = await ack(equipped, "startCommission", { offerId: "standard", requestId: "gear-start-once" });
  assert.equal(gearStart.ok, true, gearStart.message);
  const gearContract = structuredClone(gearStart.commission);
  assert.ok(gearContract.netPay > 1_000);
  assert.equal(gearContract.deviceIds.length, 3);
  const gearId = gearContract.deviceIds[0];
  const repairBlocked = await toastAction(equipped, "repairWorkshopDevice", { deviceId: gearId, requestId: "commission-repair-busy" });
  assert.match(repairBlocked, /加工|来料|占用/);
  const saleBlocked = await toastAction(equipped, "listItem", { type: "equipment", itemId: gearId, price: 1000, requestId: "commission-list-busy" });
  assert.match(saleBlocked, /加工|来料|占用/);

  await stop();
  await start();
  fresh = await connect("commission-fresh");
  intruder = await connect("commission-intruder");
  equipped = await connect("commission-equipped");
  assert.deepEqual(contractOf(fresh.state.me.commissions.active), firstContract, "restart must retain the exact original reward and authoritative timer");
  assert.deepEqual(contractOf(equipped.state.me.commissions.active), gearContract, "quotes above 1,000 must survive SQLite import and normalization");
  assert.equal(fresh.state.me.cash, initialCash);
  assert.equal(equipped.state.me.cash, equippedCash);
  assert.equal(equipped.state.me.workshop.devices.find((device) => device.id === gearId).condition, 81, "commission maintenance must not silently double-charge durability");
  assert.equal(equipped.state.listings.some((listing) => listing.item?.id === gearId), false);
  assert.equal((await ack(fresh, "startCommission", startPayload)).duplicate, true, "start deduplication must survive process restart");

  await pause(Math.max(0, Math.max(firstContract.readyAt, gearContract.readyAt) - Date.now() + 30));
  const claimPayload = { commissionId: firstContract.id, requestId: "commission-claim-once" };
  const paid = await ack(fresh, "claimCommission", claimPayload);
  assert.equal(paid.ok, true, paid.message);
  assert.equal(paid.finalPay, firstContract.netPay);
  await until(fresh, (state) => state.me.commissions.completedCount === 1 && !state.me.commissions.active);
  assert.equal(fresh.state.me.cash, initialCash + firstContract.netPay);
  assert.equal(fresh.state.me.commissions.totalEarned, firstContract.netPay);
  assert.equal(fresh.state.me.ledger.filter((entry) => entry.source === "commission").length, 1);
  const duplicateClaim = await ack(fresh, "claimCommission", claimPayload);
  assert.equal(duplicateClaim.ok, false);
  assert.equal(duplicateClaim.duplicate, true);
  assert.equal((await ack(fresh, "claimCommission", { commissionId: firstContract.id, requestId: "commission-claim-new-id" })).ok, false);
  assert.equal((await ack(fresh, "startCommission", startPayload)).duplicate, true, "a completed start request cannot create a second job");

  const gearPaid = await ack(equipped, "claimCommission", { commissionId: gearContract.id, requestId: "gear-claim-once" });
  assert.equal(gearPaid.ok, true, gearPaid.message);
  assert.equal(gearPaid.finalPay, gearContract.netPay);
  await until(equipped, (state) => state.me.commissions.completedCount === 1 && !state.me.commissions.active);
  assert.equal(equipped.state.me.cash, equippedCash + gearContract.netPay);
  assert.equal(equipped.state.me.workshop.devices.find((device) => device.id === gearId).condition, 81);

  await stop();
  await start();
  fresh = await connect("commission-fresh");
  equipped = await connect("commission-equipped");
  for (const [client, cash, pay] of [[fresh, initialCash, firstContract.netPay], [equipped, equippedCash, gearContract.netPay]]) {
    assert.equal(client.state.me.cash, cash + pay);
    assert.equal(client.state.me.commissions.completedCount, 1);
    assert.equal(client.state.me.commissions.totalEarned, pay);
    assert.equal(client.state.me.commissions.active, null);
    assert.equal(client.state.me.commissions.history.length, 1);
    assert.equal(client.state.me.ledger.filter((entry) => entry.source === "commission").length, 1);
  }
  assert.equal((await ack(fresh, "claimCommission", claimPayload)).duplicate, true, "claim deduplication must survive settlement and restart");
  assert.equal(fresh.state.me.cash, initialCash + firstContract.netPay);
  console.log(JSON.stringify({ ok: true, restarts: 2, fresh: { initialCash, finalCash: fresh.state.me.cash, netPay: firstContract.netPay, completed: 1 },
    equipped: { initialCash: equippedCash, finalCash: equipped.state.me.cash, netPay: gearContract.netPay, completed: 1 },
    verified: ["zero owned machines and paid staff", "strict reward/timer schemas", "early and foreign claims rejected", "persistent start/claim deduplication",
      "exact active contract after restart", "single settlement after second restart", "equipment repair and sale lock", "maintenance not charged twice"] }, null, 2));
} finally {
  await stop();
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("jade-commission-socket-")) throw new Error("unsafe commission fixture cleanup path");
  rmSync(resolved, { recursive: true, force: true });
}
process.exit(0);
