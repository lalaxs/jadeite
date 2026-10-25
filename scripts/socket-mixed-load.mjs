import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import pg from "pg";
import { io } from "socket.io-client";
import { preparePostgresTestEnvironment } from "./fixtures/postgres-test-environment.mjs";
import { createPostgresWorldPersister } from "../server/shell/postgres-world-persist.js";
import { createMemoryWorldStore } from "../server/world-store.js";
import { createProjectionDelta } from "../server/persistence/projection-delta.js";
import { isFeatureAvailable } from "../shared/domain/feature-availability.js";

if (!process.env.TEST_DATABASE_URL) throw new Error("socket-mixed-load: TEST_DATABASE_URL is required; use a disposable test database");
const clientCount = Math.max(8, Math.min(100, Math.floor(Number(process.env.LOAD_CLIENTS) || 25)));
const savedPlayerCount = Math.max(clientCount, Math.min(5000, Math.floor(Number(process.env.LOAD_SAVED_PLAYERS) || 1000)));
const stockCount = Math.max(10, Math.min(500, Math.floor(Number(process.env.LOAD_INVENTORY_ITEMS) || 100)));
const durationMs = Math.max(35_000, Math.min(900_000, Number(process.env.LOAD_DURATION_MS) || 45_000));
const miningAvailable = isFeatureAvailable("mining");
const databaseTest = await preparePostgresTestEnvironment("mixed_load");
const connectionString = databaseTest.env.DATABASE_URL;
const port = 36000 + (process.pid % 1000);
const origin = `http://127.0.0.1:${port}`;
const adminToken = "mixed-load-test-admin-token-32-characters";
process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
const pool = new pg.Pool({ connectionString, max: 2 });
const clients = [];
const sessions = [];
const latencies = new Map();
const counts = { purchases: 0, trades: 0, productions: 0, shattered: 0, shifts: 0, reconnects: 0, duplicates: 0 };
let child = null;
let output = "";
let metricsText = "";
let sampledRss = 0;
let peakSampledQueue = 0;
let sustainedMs = 0;
let samplingTimer = null;
let pendingSample = null;
let sampleError = null;

function record(event, elapsed) {
  if (!latencies.has(event)) latencies.set(event, []);
  latencies.get(event).push(elapsed);
}
function once(socket, event, timeout = 15_000) {
  return new Promise((resolve, reject) => {
    const listener = (payload) => { clearTimeout(timer); resolve(payload); };
    const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`mixed load timeout: ${event}`)); }, timeout);
    socket.once(event, listener);
  });
}
function waitState(client, predicate, timeout = 15_000, label = "state") {
  if (predicate(client.state)) return Promise.resolve(client.state);
  return new Promise((resolve, reject) => {
    const check = () => {
      if (!predicate(client.state)) return;
      clearTimeout(timer); client.watchers.delete(check); resolve(client.state);
    };
    const timer = setTimeout(() => {
      client.watchers.delete(check);
      reject(new Error(`mixed load ${label} timeout for ${client.state?.me?.id}; latest toasts: ${client.toasts.join(" | ")}`));
    }, timeout);
    client.watchers.add(check);
  });
}
async function connect(session) {
  const socket = io(origin, { transports: ["websocket"], autoConnect: false, reconnection: false,
    extraHeaders: { Origin: origin }, auth: { ...session, capabilities: { statePatchV1: true } } });
  const client = { socket, state: null, watchers: new Set(), toasts: [], protocolError: null };
  socket.on("state", (state) => { client.state = state; for (const check of client.watchers) check(); });
  socket.on("state:patch", (patch) => {
    if (patch.baseVersion !== client.state?.stateVersion) {
      client.protocolError = `patch version gap ${client.state?.stateVersion} -> ${patch.baseVersion}`;
      return;
    }
    client.state = { ...client.state, ...patch.changes, serverNow: patch.serverNow, stateVersion: patch.stateVersion };
    for (const check of client.watchers) check();
  });
  socket.on("toast", (toast) => { client.toasts.push(String(toast?.text || toast)); client.toasts = client.toasts.slice(-5); });
  const hello = once(socket, "hello");
  const state = once(socket, "state");
  const started = performance.now();
  socket.connect();
  const greeting = await hello;
  await state;
  assert.equal(greeting.playerId, session.playerId);
  record("connect", performance.now() - started);
  client.session = { playerId: greeting.playerId, resumeToken: greeting.resumeToken || session.resumeToken };
  return client;
}
async function mutate(client, event, payload, predicate) {
  const done = waitState(client, predicate, 15_000, event);
  const started = performance.now();
  client.socket.emit(event, { ...payload, requestId: payload.requestId || randomUUID() });
  const state = await done;
  record(event, performance.now() - started);
  return state;
}
async function acknowledged(client, event, payload) {
  const started = performance.now();
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`mixed load ack timeout: ${event}`)), 15_000);
    client.socket.emit(event, { ...payload, requestId: payload.requestId || randomUUID() }, (value) => { clearTimeout(timer); resolve(value); });
  });
  record(event, performance.now() - started);
  return result;
}
async function freshState(client) {
  const done = once(client.socket, "state"); client.socket.emit("requestState"); return done;
}
async function startServer() {
  output = "";
  child = spawn(process.execPath, ["server.js"], { cwd: process.cwd(), env: {
    ...process.env, ...databaseTest.env, NODE_ENV: "production", PUBLIC_ORIGIN: origin,
    HOST: "127.0.0.1", PORT: String(port), ADMIN_TOKEN: adminToken, JADE_DEBUG_TOOLS: "0", LOG_LEVEL: "warn",
    JADE_TIMING_PROFILE: "test", JADE_MINING_REQUIRED_PLAYERS: String(clientCount), JADE_MINING_APPLICATION_MS: "12000",
    JADE_WORLD_SAVE_MS: "30000",
    JADE_MINING_LEASE_MS: "60000", JADE_MINING_SHIFT_MS: "1000",
    SOCKET_CONNECTS_PER_MINUTE: String(clientCount * 3 + 30)
  }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-20_000); });
  child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-20_000); });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) break;
    try { if ((await fetch(`${origin}/health/ready`)).ok) return; } catch (_) {}
    await delay(100);
  }
  throw new Error(`mixed load server failed to start: ${output}`);
}
async function stopServer() {
  if (!child || child.exitCode != null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const currentChild = child;
  child.kill("SIGTERM");
  let timer;
  const exitCode = await Promise.race([exited, new Promise((_, reject) => {
    timer = setTimeout(() => { currentChild.kill("SIGKILL"); reject(new Error(`mixed load shutdown timeout: ${output}`)); }, 15_000);
  })]).finally(() => clearTimeout(timer));
  assert.equal(exitCode, 0, `mixed load server shutdown failed: ${output}`);
}
async function sampleMetrics() {
  const response = await fetch(`${origin}/metrics`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(response.status, 200);
  metricsText = await response.text();
  sampledRss = Math.max(sampledRss, Number(metricsText.match(/^jade_process_resident_memory_bytes (\d+)/m)?.[1] || 0));
  peakSampledQueue = Math.max(peakSampledQueue, Number(metricsText.match(/^jade_mutation_queue_depth (\d+)/m)?.[1] || 0));
}

try {
  H.world.clear();
  for (let i = 0; i < savedPlayerCount; i++) {
    const player = H.makePlayer(`mixed-${i}`);
    player.cash = 50_000_000; player.exp = 10000; player.rep = i < clientCount ? 150 : 0;
    player.bracelets = Array.from({ length: stockCount }, (_, index) => ({
      id: `mixed-stock-${i}-${index}`, type: "bracelet", name: "库存成品", value: 500, estimatedValue: 500, qualityKey: "bean"
    }));
    if (i < clientCount) {
      const { starter, starterProtection, starterOwnerId, starterOriginId, ...template } = player.rough[0];
      player.rough = Array.from({ length: 30 }, (_, index) => ({ ...structuredClone(template), id: `mixed-rough-${i}-${index}` }));
      sessions.push({ playerId: player.id, resumeToken: H.playerSessions.issueSession(player, "mixed-load-fixture") });
    }
    player.processedRequestIds = Array.from({ length: 200 }, (_, index) => `fixture-${i}-${index}`);
    player.ledger = Array.from({ length: 100 }, (_, index) => ({ id: `fixture-ledger-${i}-${index}`, kind: "income", source: "fixture", amount: 1, at: Date.now() - 1000 }));
    H.normalizePlayer(player); H.refillOrders(player); H.world.setPlayer(player);
  }
  const fixtureWriter = createPostgresWorldPersister({ world: H.world, pool });
  await fixtureWriter.flush({ rebuildProjections: true });
  await startServer();
  clients.push(...await Promise.all(sessions.map(connect)));
  const pairCount = Math.max(1, Math.floor(clientCount / 4));
  const productionIndices = Array.from({ length: clientCount - pairCount * 2 }, (_, i) => pairCount * 2 + i).filter((_, i) => !miningAvailable || i % 2 === 0);
  const miningIndices = miningAvailable
    ? Array.from({ length: clientCount - pairCount * 2 }, (_, i) => pairCount * 2 + i).filter((_, i) => i % 2 === 1)
    : [];
  if (!miningAvailable) {
    const result = await acknowledged(clients.at(-1), "miningApply", { preferences: ["core-06"], allowFallback: true });
    assert.equal(result.ok, false);
    assert.equal(result.code, "FEATURE_UNAVAILABLE");
  }
  await Promise.all(miningIndices.map(async (index) => {
    const result = await acknowledged(clients[index], "miningApply", { preferences: ["core-06", "core-05", "core-04"], allowFallback: true });
    assert.equal(result.ok, true, result.message);
  }));
  samplingTimer = setInterval(() => {
    if (pendingSample) return;
    pendingSample = sampleMetrics().catch((error) => { sampleError = error; }).finally(() => { pendingSample = null; });
  }, 1000);
  const started = Date.now();
  let cycle = 0;
  while (Date.now() - started < durationMs) {
    const cycleStart = Date.now();
    await Promise.all(clients.map(async (client) => {
      const before = Number(client.state.me.externalMaterials.silver925);
      const requestId = randomUUID();
      await mutate(client, "buyMaterialPack", { materialId: "silver925", amount: 1, requestId }, (state) => state.me.externalMaterials.silver925 === before + 1);
      counts.purchases++;
      if (cycle % 5 === 0) {
        client.socket.emit("buyMaterialPack", { materialId: "silver925", amount: 1, requestId });
        assert.equal((await freshState(client)).me.externalMaterials.silver925, before + 1);
        counts.duplicates++;
      }
    }));
    await Promise.all([
      ...Array.from({ length: pairCount }, async (_, pair) => {
        const seller = clients[pair * 2 + cycle % 2];
        const buyer = clients[pair * 2 + 1 - cycle % 2];
        const itemId = `mixed-stock-${pair * 2}-0`;
        assert.ok(seller.state.me.bracelets.some((item) => item.id === itemId));
        const listed = await mutate(seller, "listItem", { type: "bracelet", itemId, price: 1_000_000 },
          (state) => state.listings.some((listing) => listing.item.id === itemId));
        const listing = listed.listings.find((entry) => entry.item.id === itemId);
        const cashBefore = buyer.state.me.cash;
        const sellerCashBefore = seller.state.me.cash;
        await mutate(buyer, "buyListing", { listingId: listing.id }, (state) => state.me.bracelets.some((item) => item.id === itemId));
        assert.equal(buyer.state.me.cash, cashBefore - 1_020_000);
        assert.equal(buyer.state.me.bracelets.filter((item) => item.id === itemId).length, 1);
        await waitState(seller, (state) => state.me.cash === sellerCashBefore + listing.price, 15_000, "immediate seller proceeds");
        assert.ok(seller.state.me.ledger.some((entry) => entry.itemId === itemId && entry.amount === listing.price));
        counts.trades++;
      }),
      ...productionIndices.map(async (index) => {
        const client = clients[index];
        const rough = client.state.me.rough[0];
        if (!rough) return;
        const cutCount = Number(client.state.me.stats.cutCount || 0);
        const badCutCount = Number(client.state.me.stats.badCutCount || 0);
        // With an accelerated 300ms clock, merged broadcasts can legitimately
        // arrive after settlement. Accept the committed active or completed state.
        await mutate(client, "startPolish", { roughId: rough.id }, (state) => state.me.jobs.some((job) => job.item.id === rough.id) || state.me.stats.cutCount === cutCount + 1);
        await waitState(client, (state) => !state.me.jobs.some((job) => job.item.id === rough.id) && state.me.stats.cutCount === cutCount + 1, 15_000, "production settlement");
        const delivery = client.state.me.workshopDeliveries.find((entry) => entry.items.some((item) => item.id === rough.id));
        if (delivery) {
          const revealed = await acknowledged(client, "revealWorkshopDelivery", { deliveryId: delivery.id });
          assert.equal(revealed.ok, true, revealed.message);
          if (revealed.scratchReveal?.itemIds.length) {
            const scratched = await acknowledged(client, "revealWorkshopDelivery", {
              deliveryId: delivery.id, itemIds: revealed.scratchReveal.itemIds
            });
            assert.equal(scratched.ok, true, scratched.message);
          }
          const claimed = await acknowledged(client, "claimWorkshopDelivery", { deliveryId: delivery.id });
          assert.equal(claimed.ok, true, claimed.message);
          await waitState(client, (state) => state.me.materials.some((item) => item.id === rough.id), 15_000, "production handover");
        }
        const outputCount = client.state.me.materials.filter((item) => item.id === rough.id).length;
        assert.ok(outputCount <= 1, "production may legitimately shatter, but must never duplicate its output");
        if (!outputCount) { assert.equal(client.state.me.stats.badCutCount, badCutCount + 1); counts.shattered++; }
        counts.productions++;
      }),
      ...miningIndices.map(async (index) => {
        const client = clients[index];
        if (client.state.mining?.acceptingApplications && !client.state.mining.myApplication) {
          const result = await acknowledged(client, "miningApply", { preferences: ["core-06", "core-05", "core-04"], allowFallback: true });
          assert.equal(result.ok, true, result.message);
        }
        const lease = client.state.mining?.currentRound?.leases?.find((entry) => entry.playerId === client.state.me.id);
        if (!client.state.mining?.currentRound?.allocatedAt || !lease || lease.shiftsStarted >= lease.maxShifts) return;
        const cashBefore = client.state.me.cash;
        const roughBefore = client.state.me.rough.length;
        const shiftsBefore = Number(client.state.me.mining.stats.shifts || 0);
        const result = await acknowledged(client, "miningStartShift", { minerIds: [client.state.me.mining.miners[0].id] });
        assert.equal(result.ok, true, result.message);
        const jobId = result.job.id;
        await waitState(client, (state) => state.me.mining.history.some((entry) => entry.id === jobId));
        assert.equal(client.state.me.mining.history.filter((entry) => entry.id === jobId).length, 1);
        assert.equal(client.state.me.mining.stats.shifts, shiftsBefore + 1);
        assert.equal(client.state.me.cash, cashBefore - result.fee);
        assert.equal(client.state.me.rough.length - roughBefore, client.state.me.mining.history.find((entry) => entry.id === jobId).roughCount);
        counts.shifts++;
      })
    ]);
    if (cycle % 5 === 2) {
      const index = cycle % clientCount;
      const previous = clients[index];
      previous.socket.close();
      const resumed = await connect(previous.session);
      assert.equal(resumed.state.me.externalMaterials.silver925, previous.state.me.externalMaterials.silver925);
      clients[index] = resumed; counts.reconnects++;
    }
    await sampleMetrics();
    for (const client of clients) assert.equal(client.protocolError, null);
    cycle++;
    await delay(Math.max(0, 1200 - (Date.now() - cycleStart)));
  }
  sustainedMs = Date.now() - started;
  clearInterval(samplingTimer); samplingTimer = null;
  await pendingSample;
  assert.equal(sampleError, null);
  assert.ok(counts.purchases >= clientCount * 5 && counts.trades >= pairCount * 5);
  assert.ok(counts.productions > 0 && counts.reconnects > 0 && counts.duplicates > 0);
  if (miningAvailable) assert.ok(counts.shifts > 0);
  else assert.equal(counts.shifts, 0);
  for (const phase of ["queue", "compute", "commit"]) assert.ok(metricsText.includes(
    `jade_operation_phase_milliseconds_count{event="buyMaterialPack",phase="${phase}"}`
  ), `live server must expose ${phase} histogram observations`);
  assert.match(metricsText, /jade_broadcast_milliseconds_count \d+/);
  assert.match(metricsText, /jade_persistence_transaction_milliseconds_count\{kind="checkpoint",outcome="committed"\} \d+/);
  const finalStates = await Promise.all(clients.map(freshState));
  const resumeSessions = clients.map((client) => client.session);
  clients.forEach((client) => client.socket.close());
  await stopServer();
  const restored = createMemoryWorldStore();
  const restoreResult = await createPostgresWorldPersister({ world: restored, pool }).loadIfPresent();
  assert.equal(restoreResult.players, savedPlayerCount);
  const expectedProjections = createProjectionDelta({ players: [] }, { players: { upsert: [...restored.raw.players] } });
  const actualInventory = (await pool.query("SELECT item_id, owner_player_id, location, item_type, payload FROM jade_inventory_projection")).rows;
  assert.deepEqual(actualInventory.sort((a, b) => a.item_id.localeCompare(b.item_id)), expectedProjections.inventory.sort((a, b) => a.item_id.localeCompare(b.item_id)));
  const keys = (await pool.query("SELECT player_id, request_id FROM jade_idempotency_keys")).rows;
  const keyOrder = (a, b) => `${a.player_id}:${a.request_id}`.localeCompare(`${b.player_id}:${b.request_id}`);
  assert.deepEqual(keys.sort(keyOrder), expectedProjections.requests.sort(keyOrder));
  for (const state of finalStates) {
    const player = restored.getPlayer(state.me.id);
    assert.equal(player.cash, state.me.cash);
    assert.equal(player.externalMaterials.silver925, state.me.externalMaterials.silver925);
  }
  await startServer();
  clients.length = 0;
  clients.push(...await Promise.all(resumeSessions.slice(0, 3).map(connect)));
  for (let i = 0; i < clients.length; i++) assert.equal(clients[i].state.me.cash, finalStates[i].me.cash);
  const percentiles = {};
  const violations = [];
  for (const [event, values] of latencies) {
    values.sort((a, b) => a - b);
    const percentile = (ratio) => values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)];
    percentiles[event] = { count: values.length, p95: percentile(0.95), p99: percentile(0.99) };
    if (percentile(0.95) >= 5000) violations.push(event);
    console.log(`socket-mixed-load: ${event}, n=${values.length}, p95=${percentile(0.95).toFixed(1)}ms, p99=${percentile(0.99).toFixed(1)}ms`);
  }
  console.log(`socket-mixed-load: PostgreSQL, clients=${clientCount}, saved players=${savedPlayerCount}, bracelets/player=${stockCount}, sustained=${sustainedMs}ms, cycles=${cycle}, ${JSON.stringify(counts)}, sampled RSS=${(sampledRss / 1048576).toFixed(1)}MiB, sampled queue=${peakSampledQueue}; exact inventory/request projection equality + restart/reconnect ok (accelerated production/mining clocks)`);
  if (process.env.LOAD_REPORT_PATH) await writeFile(process.env.LOAD_REPORT_PATH, JSON.stringify({
    clientCount, savedPlayerCount, stockCount, sustainedMs, cycles: cycle, counts, sampledRss, peakSampledQueue,
    percentiles, violations, metrics: metricsText, assetRecoveryChecksPassed: true
  }, null, 2));
  assert.deepEqual(violations, [], `${violations.join(", ")} P95 exceeds 5s`);
} finally {
  clearInterval(samplingTimer);
  await pendingSample;
  clients.forEach((client) => client.socket.close());
  await stopServer();
  await pool.end();
  await databaseTest.cleanup();
}
