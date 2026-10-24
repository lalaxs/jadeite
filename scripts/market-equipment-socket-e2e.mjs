import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { io } from "socket.io-client";
import { createDeviceInstance } from "../server/systems/equipment-system.js";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";

process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
H.state.players.clear();
H.state.listings.length = 0;
const auth = {};
for (const id of ["equipment-socket-seller", "equipment-socket-buyer", "equipment-socket-rival"]) {
  const player = installOwnedWorkshopFixture(H.makePlayer(id));
  player.cash = 100000;
  player.assets.workshopOwned = true;
  H.state.players.set(id, player);
  auth[id] = { playerId: id, resumeToken: H.playerSessions.issueSession(player) };
}
const device = createDeviceInstance("opening", "cuijie-opening-1", "equipment-socket-used");
device.condition = 43;
H.state.players.get("equipment-socket-seller").workshop.devices.push(device);
const directory = mkdtempSync(path.join(tmpdir(), "jade-equipment-socket-"));
const seedPath = path.join(directory, "seed.json");
writeFileSync(seedPath, JSON.stringify(H.world.exportSnapshot()));
const port = 42000 + process.pid % 1000;
const origin = `http://127.0.0.1:${port}`;
let server, output = "", winnerId;
const clients = [];
function once(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${event}\n${output}`)), 10000);
    socket.once(event, (value) => { clearTimeout(timer); resolve(value); });
  });
}
async function start() {
  server = spawn(process.execPath, ["server.js"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env,
    NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(port), LOG_LEVEL: "warn", JADE_WORLD_PERSIST: "1",
    JADE_WORLD_PERSIST_DRIVER: "sqlite", JADE_WORLD_SQLITE_PATH: path.join(directory, "world.sqlite"), JADE_WORLD_PATH: seedPath
  } });
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    try { if ((await fetch(`${origin}/health/ready`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`server failed to start\n${output}`);
}
async function stop() {
  clients.splice(0).forEach((client) => client.socket.close());
  if (!server || server.exitCode != null) return;
  const stopped = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await stopped;
}
async function connect(id) {
  const socket = io(origin, { transports: ["websocket"], autoConnect: false, auth: auth[id] });
  const hello = once(socket, "hello");
  const first = once(socket, "state");
  const client = { socket, state: null };
  clients.push(client);
  socket.on("state", (state) => { client.state = state; });
  socket.connect();
  await hello;
  await first;
  return client;
}
async function until(client, predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (client.state && predicate(client.state)) return client.state;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`state timeout\n${output}`);
}
async function action(client, event, payload, predicate) {
  client.socket.emit(event, payload);
  return until(client, predicate);
}
const ownsDevice = (state) => state.me.workshop.devices.some((row) => row.id === device.id);
try {
  await start();
  let seller = await connect("equipment-socket-seller");
  let buyer = await connect("equipment-socket-buyer");
  const initialSellerDevices = seller.state.me.workshop.devices.length;
  await action(seller, "listItem", { type: "equipment", itemId: device.id, price: 5000, requestId: "equipment-list-first" }, (state) => state.listings.some((row) => row.item.id === device.id));
  let listing = seller.state.listings.find((row) => row.item.id === device.id);
  assert.equal(ownsDevice(seller.state), false);
  assert.equal(listing.item.condition, 43);
  assert.equal(listing.item.workerId, null);
  // A listing survives an actual SQLite process restart and can be withdrawn.
  await stop();
  await start();
  seller = await connect("equipment-socket-seller");
  buyer = await connect("equipment-socket-buyer");
  listing = seller.state.listings.find((row) => row.item.id === device.id);
  assert.ok(listing);
  assert.equal(ownsDevice(seller.state), false);
  assert.equal(listing.item.condition, 43);
  const foreignWithdraw = once(buyer.socket, "toast");
  buyer.socket.emit("withdrawListing", { listingId: listing.id, requestId: "equipment-foreign-withdraw" });
  assert.match(String(await foreignWithdraw), /自己的挂单/);
  await action(seller, "withdrawListing", { listingId: listing.id, requestId: "equipment-withdraw-first" }, ownsDevice);
  assert.equal(seller.state.me.workshop.devices.length, initialSellerDevices);
  assert.equal(seller.state.me.workshop.devices.find((row) => row.id === device.id).condition, 43);
  await action(seller, "listItem", { type: "equipment", itemId: device.id, price: 5000, requestId: "equipment-list-second" }, (state) => state.listings.some((row) => row.item.id === device.id));
  listing = seller.state.listings.find((row) => row.item.id === device.id);
  const duplicate = once(seller.socket, "toast");
  seller.socket.emit("listItem", { type: "equipment", itemId: device.id, price: 5000, requestId: "equipment-list-second" });
  assert.match(String(await duplicate), /已处理|重复/);
  const rival = await connect("equipment-socket-rival");
  const buyerCash = buyer.state.me.cash;
  const rivalCash = rival.state.me.cash;
  const sellerCash = seller.state.me.cash;
  buyer.socket.emit("buyListing", { listingId: listing.id, requestId: "equipment-race-buyer" });
  rival.socket.emit("buyListing", { listingId: listing.id, requestId: "equipment-race-rival" });
  await until(buyer, (state) => !state.listings.some((row) => row.id === listing.id));
  await until(rival, (state) => !state.listings.some((row) => row.id === listing.id));
  await until(seller, (state) => !state.listings.some((row) => row.id === listing.id));
  assert.equal(Number(ownsDevice(buyer.state)) + Number(ownsDevice(rival.state)), 1);
  const winner = ownsDevice(buyer.state) ? buyer : rival;
  const loser = winner === buyer ? rival : buyer;
  winnerId = winner.state.me.id;
  assert.equal(winner.state.me.cash, (winner === buyer ? buyerCash : rivalCash) - 5100);
  assert.equal(loser.state.me.cash, loser === buyer ? buyerCash : rivalCash);
  assert.equal(seller.state.me.cash, sellerCash + 5000);
  assert.equal(winner.state.me.workshop.devices.find((row) => row.id === device.id).condition, 43);
  assert.equal(winner.state.me.bracelets.some((row) => row.id === device.id), false);
  const noResale = once(seller.socket, "toast");
  seller.socket.emit("withdrawListing", { listingId: listing.id, requestId: "equipment-withdraw-sold" });
  assert.match(String(await noResale), /不存在/);
  const settledCash = winner.state.me.cash;
  await stop();
  await start();
  const resumed = await connect(winnerId);
  assert.equal(resumed.state.me.cash, settledCash);
  assert.equal(resumed.state.me.workshop.devices.filter((row) => row.id === device.id).length, 1);
  assert.equal(resumed.state.me.workshop.devices.find((row) => row.id === device.id).condition, 43);
  assert.equal(resumed.state.me.workshop.devices.find((row) => row.id === device.id).workerId, "owner-operator");
  // Sell the seller's entire remaining roster, including each stage's last device.
  let emptySeller = await connect("equipment-socket-seller");
  const remaining = structuredClone(emptySeller.state.me.workshop.devices);
  for (const row of remaining) {
    await action(emptySeller, "listItem", { type: "equipment", itemId: row.id, price: 1000, requestId: `equipment-sell-all-${row.id}` }, (state) => !state.me.workshop.devices.some((entry) => entry.id === row.id));
  }
  assert.deepEqual(emptySeller.state.me.workshop.devices, []);
  await stop();
  await start();
  emptySeller = await connect("equipment-socket-seller");
  const allBuyer = await connect(winnerId);
  assert.deepEqual(emptySeller.state.me.workshop.devices, [], "restart must not refill a fully listed workshop");
  let remainingListings = emptySeller.state.listings.filter((row) => row.ownerId === emptySeller.state.me.id);
  assert.equal(remainingListings.length, remaining.length);
  const withdrawn = remainingListings[0];
  await action(emptySeller, "withdrawListing", { listingId: withdrawn.id, requestId: "equipment-empty-withdraw" }, (state) => state.me.workshop.devices.length === 1);
  assert.equal(emptySeller.state.me.workshop.devices[0].id, withdrawn.item.id);
  await action(emptySeller, "listItem", { type: "equipment", itemId: withdrawn.item.id, price: 1000, requestId: "equipment-empty-relist" }, (state) => state.me.workshop.devices.length === 0);
  remainingListings = emptySeller.state.listings.filter((row) => row.ownerId === emptySeller.state.me.id);
  for (const row of remainingListings) {
    await action(allBuyer, "buyListing", { listingId: row.id, requestId: `equipment-buy-all-${row.id}` }, (state) => state.me.workshop.devices.some((entry) => entry.id === row.item.id));
  }
  await stop();
  await start();
  emptySeller = await connect("equipment-socket-seller");
  const allResumed = await connect(winnerId);
  assert.deepEqual(emptySeller.state.me.workshop.devices, [], "restart after selling all equipment must preserve an empty workshop");
  assert.equal(emptySeller.state.listings.some((row) => row.ownerId === emptySeller.state.me.id), false);
  for (const row of remaining) assert.equal(allResumed.state.me.workshop.devices.filter((entry) => entry.id === row.id).length, 1);
  console.log("market-equipment-socket-e2e: list, SQLite restart, withdraw, replay protection, two-buyer race, tax, sell-out and empty-workshop restarts ok");
} finally {
  await stop();
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("jade-equipment-socket-")) throw new Error("unsafe test cleanup path");
  rmSync(resolved, { recursive: true, force: true });
}
process.exit(0);
