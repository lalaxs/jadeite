import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { io } from "socket.io-client";
import { createFinishPlanDraft, validateFinishPlanDraft } from "../shared/domain/workshop/finish-plan-model.js";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";

process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
H.state.players.clear();
const player = installOwnedWorkshopFixture(H.makePlayer("bangle-default-plan-socket"));
H.normalizePlayer(player);
H.state.players.set(player.id, player);
const rough = { ...player.rough[0], id: "bangle-52-source", type: "material", materialStage: "opened", name: "52圈口验证料",
  qualityKey: "glutinous", quality: "糯种", color: "青白", price: 12000, value: 12000, rep: 10, score: 3 };
const [blank] = H.extractProductsFromJob({ item: rough, options: { kits: [{ id: "bangle-52", type: "bangle", openingTpl: "bangle", x: 50, y: 50, ringSize: 52, rot: 0, scale: 52 / 56 }] } });
player.bracelets = [blank];
// Keep this test deterministic while running the real authoritative start,
// timed completion, delivery and persistence code in the child server.
player.workshop.workers.forEach((worker) => {
  worker.tier = 10; worker.flaws = [];
  for (const direction of Object.values(worker.skills)) for (const skill of Object.values(direction)) skill.level = 10;
});
const auth = { playerId: player.id, resumeToken: H.playerSessions.issueSession(player) };
const directory = mkdtempSync(path.join(tmpdir(), "jade-bangle-socket-"));
const seedPath = path.join(directory, "seed.json");
writeFileSync(seedPath, JSON.stringify(H.world.exportSnapshot()));
const port = 41000 + process.pid % 1000;
const origin = `http://127.0.0.1:${port}`;
let server, socket, state, output = "";
const toasts = [];
async function start() {
  server = spawn(process.execPath, ["server.js"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "test", LOG_LEVEL: "warn", JADE_TIMING_PROFILE: "test",
      JADE_WORLD_PERSIST: "1", JADE_WORLD_PERSIST_DRIVER: "sqlite", JADE_WORLD_PATH: seedPath, JADE_WORLD_SQLITE_PATH: path.join(directory, "world.sqlite") } });
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${origin}/health/ready`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server startup timeout: ${output}`);
}
async function stop() {
  socket?.close();
  if (!server || server.exitCode != null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM"); await exited;
}
async function connect() {
  state = null;
  socket = io(origin, { auth, transports: ["websocket"], reconnection: false, autoConnect: false });
  socket.on("state", (next) => { state = next; });
  socket.on("toast", (toast) => toasts.push(toast));
  const initial = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("initial snapshot timeout")), 10000);
    socket.once("state", () => { clearTimeout(timer); resolve(); });
  });
  socket.connect(); await initial;
}
async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`state timeout: ${output}`);
}
const ack = (event, payload) => socket.timeout(10000).emitWithAck(event, payload);
try {
  await start(); await connect();
  assert.deepEqual(state.inlayCatalog.productTypes.bangle, ["bangle"]);
  const item = state.me.bracelets.find((entry) => entry.id === blank.id);
  assert.equal(item.ringSize, 52);
  const draft = createFinishPlanDraft("bangle", state.inlayCatalog, item);
  assert.deepEqual(draft, { process: "bangle", productType: "bangle", refinementId: "standard", polishId: "bright" });
  assert.equal(validateFinishPlanDraft({ shape: "bangle", draft, catalog: state.inlayCatalog, item }).canStart, true);
  const device = state.me.workshop.devices.find((entry) => entry.stage === "finishing");
  const started = await ack("startWorkshopJob", { itemId: item.id, deviceId: device.id, workerId: device.workerId, finishPlan: draft, requestId: "bangle-default-52-start" });
  assert.equal(started.ok, true, started.message);
  await until((snapshot) => snapshot.me.workshopDeliveries.some((delivery) => delivery.items.some((entry) => entry.id === item.id)));
  const delivery = state.me.workshopDeliveries.find((entry) => entry.items.some((output) => output.id === item.id));
  assert.equal(delivery.items[0].productType, "bangle");
  assert.equal((await ack("revealWorkshopDelivery", { deliveryId: delivery.id, requestId: "bangle-reveal" })).ok, true);
  assert.equal((await ack("claimWorkshopDelivery", { deliveryId: delivery.id, requestId: "bangle-claim" })).ok, true);
  await until((snapshot) => snapshot.me.bracelets.some((entry) => entry.id === item.id && entry.finish?.process === "bangle"));
  const finished = state.me.bracelets.find((entry) => entry.id === item.id);
  assert.deepEqual(finished.jadePiece, blank.jadePiece);
  assert.equal(finished.finish.refinementId, "standard");
  assert.equal(finished.ringSize, 52);
  assert.equal(finished.inlay, undefined);
  assert.doesNotMatch(JSON.stringify(toasts), /不能制作所选成品类型/);
  await stop(); await start(); await connect();
  assert.equal(state.me.bracelets.find((entry) => entry.id === item.id)?.finish?.process, "bangle");
  console.log("bangle-finish-socket-e2e: default 52mm bangle plan starts without product selection, completes, claims and survives server restart");
} finally {
  await stop();
  if (path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith("jade-bangle-socket-")) throw new Error("unsafe test cleanup path");
  rmSync(directory, { recursive: true, force: true });
}
process.exit(0);
