import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { io } from "socket.io-client";
import { BLACKMARKET_GOODS_BUCKETS, isBlackmarketGoodsType } from "../shared/domain/blackmarket/bm-constants.js";

const directory = mkdtempSync(path.join(tmpdir(), "jade-blackmarket-npc-"));
const port = 37000 + process.pid % 1000;
const origin = `http://127.0.0.1:${port}`;
let server;
let output = "";
const sockets = [];
function once(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${event}\n${output}`)), 10_000);
    socket.once(event, (data) => { clearTimeout(timer); resolve(data); });
  });
}
async function start() {
  server = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(port), LOG_LEVEL: "warn", JADE_WORLD_PERSIST: "1", JADE_WORLD_PERSIST_DRIVER: "sqlite", JADE_WORLD_SQLITE_PATH: path.join(directory, "world.sqlite"), JADE_WORLD_PATH: path.join(directory, "none.json") },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    try { if ((await fetch(`${origin}/health/ready`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`server failed to start\n${output}`);
}
async function stop() {
  if (!server || server.exitCode != null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await exited;
}
async function connect(auth = {}) {
  const socket = io(origin, { transports: ["websocket"], autoConnect: false, auth });
  sockets.push(socket);
  const hello = once(socket, "hello");
  const state = once(socket, "state");
  socket.connect();
  return { socket, hello: await hello, state: await state };
}
async function buy(client, stall, row, requestId) {
  const state = once(client.socket, "state");
  client.socket.emit("bmBuyListing", { stallId: stall.id, listingId: row.id, requestId });
  return state;
}

function savedSchedules() {
  const db = new DatabaseSync(path.join(directory, "world.sqlite"), { readOnly: true });
  try {
    const snapshot = JSON.parse(db.prepare("SELECT payload FROM world_snapshots ORDER BY id DESC LIMIT 1").get().payload);
    return snapshot.blackStalls.filter((stall) => stall.npc).map((stall) => ({
      id: stall.id, npcScheduleVersion: stall.npcScheduleVersion,
      npcRotateAt: stall.npcRotateAt, npcRefillAt: stall.npcRefillAt,
      npcBatch: stall.npcBatch, npcDiscountIssued: stall.npcDiscountIssued, npcPremiumIssued: stall.npcPremiumIssued
    }));
  } finally { db.close(); }
}

try {
  await start();
  const first = await connect();
  assert.equal(first.state.blackStalls.filter((stall) => stall.npc && !stall.roaming).length, 5);
  assert.equal(first.state.blackStalls.filter((stall) => stall.npc).length, 6);
  assert.ok(first.state.blackStalls.flatMap((stall) => stall.items).every((row) => isBlackmarketGoodsType(row.type)));
  const stones = first.state.blackStalls.find((stall) => stall.npcRole === "stone");
  const discounted = stones.items.find((row) => row.npcDiscount);
  const afterStone = await buy(first, stones, discounted, "npc-stone-once");
  assert.ok(afterStone.me[BLACKMARKET_GOODS_BUCKETS[discounted.type]].some((item) => item.id === discounted.item.id));
  assert.equal(afterStone.me.cash, first.state.me.cash - discounted.price);
  assert.equal(afterStone.blackStalls.find((stall) => stall.id === stones.id).items.filter((row) => row.npcDiscount).length, 0);
  const offcuts = afterStone.blackStalls.find((stall) => stall.npcRole === "offcut");
  const slice = offcuts.items.find((row) => row.type === "slice");
  const afterSlice = await buy(first, offcuts, slice, "npc-slice-once");
  assert.ok(afterSlice.me.slices.some((item) => item.id === slice.item.id));
  assert.equal(afterSlice.me.pendingBmRatings.length, 0);
  const finishedStall = afterSlice.blackStalls.find((stall) => stall.npcRole === "finished");
  const finishedRow = [...finishedStall.items].sort((a, b) => a.price - b.price)[0];
  if (finishedRow.price > afterSlice.me.cash) {
    const granted = once(first.socket, "state");
    first.socket.emit("debugGrant", { cash: finishedRow.price });
    await granted;
  }
  const afterFinished = await buy(first, finishedStall, finishedRow, "npc-finished-once");
  const finishedItem = afterFinished.me.bracelets.find((item) => item.id === finishedRow.item.id);
  assert.ok(finishedItem);
  for (const key of ["jadePiece", "components", "inlay", "finish", "craftScores", "value", "name"]) assert.deepEqual(finishedItem[key], finishedRow.item[key], `purchase must preserve ${key}`);
  const session = { playerId: first.hello.playerId, resumeToken: first.hello.resumeToken };
  const cash = afterFinished.me.cash;
  const inventoryIds = Object.fromEntries(Object.values(BLACKMARKET_GOODS_BUCKETS).map((bucket) => [bucket, afterFinished.me[bucket].map((item) => item.id)]));
  const stockBefore = afterFinished.blackStalls.map((stall) => ({ id: stall.id, items: stall.items }));
  const schedulesBefore = savedSchedules();
  assert.ok(schedulesBefore.find((stall) => stall.id === stones.id).npcRefillAt > Date.now());
  for (const stall of afterSlice.blackStalls) {
    assert.equal(stall.nextBatchAt, undefined);
    assert.equal(stall.npcRotateAt, undefined);
    assert.equal(stall.npcRefillAt, undefined);
  }
  first.socket.close();
  // On Windows SIGTERM stops the process directly: committed SQLite mutations must survive it.
  await stop();
  await start();
  const resumed = await connect(session);
  assert.equal(resumed.hello.playerId, session.playerId);
  assert.equal(resumed.state.me.cash, cash);
  const restoredFinished = resumed.state.me.bracelets.find((item) => item.id === finishedItem.id);
  for (const key of ["jadePiece", "components", "inlay", "finish", "craftScores", "value", "name"]) assert.deepEqual(restoredFinished[key], finishedItem[key], `restart must preserve ${key}`);
  for (const [bucket, ids] of Object.entries(inventoryIds)) assert.deepEqual(resumed.state.me[bucket].map((item) => item.id), ids);
  assert.ok(resumed.state.blackStalls.flatMap((stall) => stall.items).every((row) => isBlackmarketGoodsType(row.type)));
  assert.deepEqual(resumed.state.blackStalls.map((stall) => ({ id: stall.id, items: stall.items })), stockBefore, "restart must preserve stock IDs, quotes and depleted offers");
  assert.deepEqual(savedSchedules(), schedulesBefore, "SQLite restart must preserve random rotation/refill deadlines and batch quotas");
  const duplicate = once(resumed.socket, "toast");
  resumed.socket.emit("bmBuyListing", { stallId: offcuts.id, listingId: slice.id, requestId: "npc-slice-once" });
  const toast = await duplicate;
  assert.match(String(toast?.text || toast), /已处理|重复/);
  resumed.socket.close();
  console.log("blackmarket-npc-socket-e2e: SQLite restart, random deadlines, delayed replenishment, purchases, inventory and duplicate request protection ok");
} finally {
  for (const socket of sockets) socket.close();
  await stop();
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("jade-blackmarket-npc-")) throw new Error("unexpected test directory");
  rmSync(resolved, { recursive: true, force: true });
}
