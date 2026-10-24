import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { io } from "socket.io-client";

const directory = mkdtempSync(path.join(tmpdir(), "jade-auction-halls-"));
const port = 38000 + process.pid % 1000;
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

async function action(client, event, payload) {
  const state = once(client.socket, "state");
  client.socket.emit(event, payload);
  return state;
}
function savedWorld() {
  const db = new DatabaseSync(path.join(directory, "world.sqlite"), { readOnly: true });
  try { return JSON.parse(db.prepare("SELECT payload FROM world_snapshots ORDER BY id DESC LIMIT 1").get().payload); }
  finally { db.close(); }
}
function assertSharedClock(state) {
  for (const hall of state.auctionHalls) {
    assert.equal(hall.startsAt, state.auction.startsAt);
    assert.equal(hall.endsAt, state.auction.endsAt);
    assert.equal(state.auctionRounds[hall.id].startsAt, state.auction.startsAt);
    assert.equal(state.auctionRounds[hall.id].endsAt, state.auction.endsAt);
  }
}
try {
  await start();
  const first = await connect();
  assertSharedClock(first.state);
  assert.equal(first.state.auctionHalls.filter((hall) => hall.active).length, 1);
  const upgraded = await action(first, "debugGrant", { exp: 250, cash: 100000 });
  assert.equal(upgraded.me.level, 2);
  assert.deepEqual(upgraded.auctionHalls.filter((hall) => hall.active).map((hall) => hall.id), ["novice", "regular"]);
  const initialRounds = Object.fromEntries(Object.entries(upgraded.auctionRounds).map(([hall, round]) => [hall, round.id]));
  assert.equal(Object.keys(initialRounds).length, 5);
  const afterNovice = await action(first, "enterAuction", { hallId: "novice", requestId: "enter-novice" });
  const afterRegular = await action(first, "enterAuction", { hallId: "regular", requestId: "enter-regular" });
  assertSharedClock(afterRegular);
  assert.equal(afterRegular.auction.endsAt, first.state.auction.endsAt, "entry cannot reset the shared clock");
  assert.equal(afterRegular.me.cash, upgraded.me.cash - 1400);
  assert.ok(afterRegular.auctionHalls.find((hall) => hall.id === "novice").entered);
  assert.ok(afterRegular.auctionHalls.find((hall) => hall.id === "regular").entered);
  assert.equal(afterRegular.auctionRounds.novice.roughs.length, 8);
  assert.equal(afterRegular.auctionRounds.regular.roughs.length, 8);
  const novice = [...afterNovice.auctionRounds.novice.roughs].sort((a,b) => a.price-b.price)[0];
  const regular = [...afterRegular.auctionRounds.regular.roughs].sort((a,b) => a.price-b.price)[0];
  await action(first, "submitAuctionBid", { hallId: "novice", roughId: novice.id, amount: novice.price, requestId: "bid-novice" });
  const bidState = await action(first, "submitAuctionBid", { hallId: "regular", roughId: regular.id, amount: regular.price, requestId: "bid-regular" });
  assert.equal(bidState.me.auctionEscrow.length, 2);
  assert.equal(bidState.auctionRounds.novice.myBids.length, 1);
  assert.equal(bidState.auctionRounds.regular.myBids.length, 1);
  const newcomer = await connect();
  const denied = once(newcomer.socket, "toast");
  newcomer.socket.emit("enterAuction", { hallId: "regular", requestId: "level-blocked" });
  assert.match(String(await denied), /经营 Lv\.2/);
  newcomer.socket.close();
  const persisted = savedWorld();
  const persistedRounds = [persisted.auction, ...Object.values(persisted.auctionRounds)];
  assert.equal(persistedRounds.length, 5);
  assert.equal(persistedRounds.find((round) => round.hallId === "regular").bids.length, 1);
  const session = { playerId: first.hello.playerId, resumeToken: first.hello.resumeToken };
  const cash = bidState.me.cash;
  first.socket.close();
  await stop();
  await start();
  const resumed = await connect(session);
  assertSharedClock(resumed.state);
  assert.equal(resumed.state.auction.endsAt, bidState.auction.endsAt, "restart cannot reset the shared clock");
  assert.equal(resumed.state.me.cash, cash);
  assert.equal(resumed.state.me.auctionEscrow.length, 2);
  assert.deepEqual(Object.fromEntries(Object.entries(resumed.state.auctionRounds).map(([hall, round]) => [hall, round.id])), initialRounds);
  assert.equal(resumed.state.auctionRounds.novice.myBids[0].roughId, novice.id);
  assert.equal(resumed.state.auctionRounds.regular.myBids[0].roughId, regular.id);
  const unchanged = await action(resumed, "enterAuction", { hallId: "regular", requestId: "return-paid-hall" });
  assert.equal(unchanged.me.cash, cash);
  assert.equal(unchanged.me.auctionEscrow.length, 2);
  const duplicate = once(resumed.socket, "toast");
  resumed.socket.emit("submitAuctionBid", { hallId: "regular", roughId: regular.id, amount: regular.price, requestId: "bid-regular" });
  const duplicateToast = await duplicate;
  assert.match(String(duplicateToast?.text || duplicateToast), /重复|已处理/);
  console.log("auction-halls-socket-e2e: instant Lv.2 unlock, two paid halls/bids, level denial, SQLite restart and guarantee isolation ok");
} finally {
  for (const socket of sockets) socket.close();
  await stop();
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("jade-auction-halls-")) throw new Error("unexpected test directory");
  rmSync(resolved, { recursive: true, force: true });
}
