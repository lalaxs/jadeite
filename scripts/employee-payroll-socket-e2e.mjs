import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { io } from "socket.io-client";
import { employeePayrollDayStart, EMPLOYEE_PAYROLL_DAY_MS, workerDailyWage } from "../shared/domain/economy/worker-economy.js";
import { enterEmployeePayrollDay } from "../server/systems/employee-payroll.js";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";

process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
H.world.clear();
const player = installOwnedWorkshopFixture(H.makePlayer("employee-payroll-socket"));
player.cash = 50000;
const today = employeePayrollDayStart(Date.now());
enterEmployeePayrollDay(player, { spendCash: H.spendCash, now: today - 3 * EMPLOYEE_PAYROLL_DAY_MS });
const dailyTotal = player.workshop.workers.reduce((sum, worker) => sum + workerDailyWage(worker), 0);
assert.equal(dailyTotal, 1500);
const worker = player.workshop.workers[0];
const dismissalWage = workerDailyWage(worker);
assert.equal(dismissalWage, 320);
// Seed old cached wages: reload must adopt the new table without resetting the unpaid day.
const oldBaseWages = { 3: 390, 5: 580, 6: 690, 8: 940 };
for (const entry of player.workshop.workers) entry.baseWage = oldBaseWages[entry.tier];
const auth = { playerId: player.id, resumeToken: H.playerSessions.issueSession(player) };
H.state.players.set(player.id, player);
const gracePlayer = installOwnedWorkshopFixture(H.makePlayer("employee-payroll-grace-socket"));
gracePlayer.cash = 800;
enterEmployeePayrollDay(gracePlayer, { spendCash: H.spendCash, now: today - 3 * EMPLOYEE_PAYROLL_DAY_MS });
const graceAuth = { playerId: gracePlayer.id, resumeToken: H.playerSessions.issueSession(gracePlayer) };
H.state.players.set(gracePlayer.id, gracePlayer);
const stoppedPlayer = installOwnedWorkshopFixture(H.makePlayer("employee-payroll-stopped-socket"));
stoppedPlayer.cash = 0;
Object.assign(stoppedPlayer.employeePayroll, { status: "stopped", debt: 3000, accruedTotal: 3000,
  stoppedAt: today - EMPLOYEE_PAYROLL_DAY_MS, businessDay: today - EMPLOYEE_PAYROLL_DAY_MS,
  currentBill: { day: today - EMPLOYEE_PAYROLL_DAY_MS, entries: [] } });
const stoppedAuth = { playerId: stoppedPlayer.id, resumeToken: H.playerSessions.issueSession(stoppedPlayer) };
H.state.players.set(stoppedPlayer.id, stoppedPlayer);
const legacyPlayer = installOwnedWorkshopFixture(H.makePlayer("employee-payroll-legacy-socket"));
Object.assign(legacyPlayer.employeePayroll, { version: 2, policyVersion: 1, debt: 99000, accruedTotal: 100000,
  paidTotal: 1000, status: "stopped" });
const legacyAuth = { playerId: legacyPlayer.id, resumeToken: H.playerSessions.issueSession(legacyPlayer) };
H.state.players.set(legacyPlayer.id, legacyPlayer);
const directory = mkdtempSync(path.join(tmpdir(), "jade-employee-payroll-"));
const seedPath = path.join(directory, "seed.json");
writeFileSync(seedPath, JSON.stringify(H.world.exportSnapshot()));
const port = 43000 + process.pid % 1000;
const origin = `http://127.0.0.1:${port}`;
let server, socket, parallelSocket, current, output = "";

async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw Error(`payroll socket timeout: ${output}`);
}
async function start() {
  server = spawn(process.execPath, ["server.js"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "test", LOG_LEVEL: "warn",
      JADE_WORLD_PERSIST: "1", JADE_WORLD_PERSIST_DRIVER: "sqlite", JADE_WORLD_PATH: seedPath,
      JADE_WORLD_SQLITE_PATH: path.join(directory, "world.sqlite") } });
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${origin}/health/ready`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(`payroll server startup timeout: ${output}`);
}
async function stop() {
  socket?.close();
  if (!server || server.exitCode != null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await exited;
}
async function connect(session = auth) {
  current = null;
  socket = io(origin, { auth: session, transports: ["websocket"], reconnection: false });
  socket.on("state", (next) => { current = next; });
  await until(() => current?.me);
}
function emitAck(event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`${event} acknowledgement timeout`)), 10000);
    socket.emit(event, payload, (result) => { clearTimeout(timer); resolve(result); });
  });
}
function dismiss(requestId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("dismiss acknowledgement timeout")), 10000);
    socket.emit("dismissWorker", { workerId: worker.id, requestId }, (result) => { clearTimeout(timer); resolve(result); });
  });
}

try {
  await start();
  let parallelState;
  parallelSocket = io(origin, { auth, transports: ["websocket"], reconnection: false });
  parallelSocket.on("state", (value) => { parallelState = value; });
  await connect();
  await until(() => parallelState?.me);
  assert.equal(parallelState.me.cash, 50000 - dailyTotal, "concurrent windows share one salary settlement");
  assert.equal(parallelState.me.employeePayroll.sequence, 1);
  parallelSocket.close();
  assert.equal(current.me.cash, 50000 - dailyTotal, "login settles only the previous recorded date");
  assert.equal(current.me.employeePayroll.history[0].paid, dailyTotal);
  assert.deepEqual(current.me.workshop.workers.map((entry) => entry.baseWage), [320, 590, 190, 400]);
  assert.equal(current.me.employeePayroll.currentBill.day, today);
  assert.equal(current.me.employeePayroll.history[0].billDay, today - 3 * EMPLOYEE_PAYROLL_DAY_MS);
  const pendingId = current.me.employeePayroll.pendingSettlement.id;
  socket.close();
  await connect();
  assert.equal(current.me.employeePayroll.pendingSettlement.id, pendingId, "unread receipt survives reconnect without another debit");
  socket.emit("ackEmployeePayrollSettle", { receiptId: "stale-receipt" });
  socket.emit("requestState");
  await until(() => current.me.employeePayroll.pendingSettlement?.id === pendingId);
  socket.emit("ackEmployeePayrollSettle", { receiptId: pendingId });
  await until(() => current.me.employeePayroll.pendingSettlement === null);
  const result = await dismiss("salary-dismiss-once");
  assert.equal(result.ok, true, result.message);
  await until(() => !current.me.workshop.workers.some((entry) => entry.id === worker.id));
  assert.equal(current.me.cash, 50000 - dailyTotal - dismissalWage);
  assert.equal(current.me.employeePayroll.history[0].accrued, dismissalWage);
  assert.equal(current.me.employeePayroll.history[0].reason, "dismissal");
  assert.equal(current.me.employeePayroll.sequence, 2);
  assert.equal((await dismiss("salary-dismiss-once")).ok, false, "replaying dismissal cannot charge twice");
  socket.close();
  await connect();
  assert.equal(current.me.cash, 50000 - dailyTotal - dismissalWage);
  assert.equal(current.me.employeePayroll.sequence, 2);
  await stop();
  await start();
  await connect();
  assert.equal(current.me.cash, 50000 - dailyTotal - dismissalWage, "restart cannot re-accrue or re-deduct salary");
  assert.equal(current.me.employeePayroll.sequence, 2);
  assert.equal(current.me.employeePayroll.history.length, 2);
  assert.equal(current.me.employeePayroll.pendingSettlement, null, "receipt acknowledgement survives SQLite restart");
  assert.equal((await dismiss("salary-dismiss-once")).ok, false);
  assert.equal(current.me.workshop.workers.some((entry) => entry.id === worker.id), false);
  assert.equal(current.me.ledger.filter((entry) => entry.source === "employeeSalary").length, 2);
  socket.close();
  await connect(graceAuth);
  assert.equal(current.me.cash, 800, "insufficient cash is preserved at midnight");
  assert.equal(current.me.employeePayroll.debt, 1500);
  assert.equal(current.me.employeePayroll.status, "grace");
  const graceDeadline = current.me.employeePayroll.graceDay;
  const itemId = current.me.rough[0].id;
  socket.emit("listItem", { type: "rough", itemId, price: 2000, requestId: "policy-list-once" });
  await until(() => current.listings.some((entry) => entry.ownerId === gracePlayer.id && entry.item.id === itemId));
  const listingId = current.listings.find((entry) => entry.ownerId === gracePlayer.id && entry.item.id === itemId).id;
  socket.close();
  await connect();
  socket.emit("buyListing", { listingId, requestId: "policy-buy-once" });
  await until(() => !current.listings.some((entry) => entry.id === listingId));
  socket.close();
  await connect(graceAuth);
  assert.equal(current.me.cash, 2800, "a real ¥2000 sale preserves cash below the operating reserve");
  assert.equal(current.me.employeePayroll.debt, 1500);
  assert.equal(current.me.employeePayroll.graceDay, graceDeadline);
  assert.equal((await emitAck("payEmployeePayroll", { amount: 100, requestId: "policy-pay-partial" })).ok, true);
  await until(() => current.me.employeePayroll.debt === 1400);
  assert.equal(current.me.cash, 2700);
  assert.equal(current.me.employeePayroll.graceDay, graceDeadline);
  assert.equal((await emitAck("payEmployeePayroll", { amount: 100, requestId: "policy-pay-partial" })).ok, false);
  await stop();
  await start();
  await connect(graceAuth);
  assert.equal(current.me.cash, 2700);
  assert.equal(current.me.employeePayroll.debt, 1400);
  assert.equal(current.me.employeePayroll.graceDay, graceDeadline, "restart never renews the grace period");
  socket.close();
  await connect(stoppedAuth);
  assert.equal(current.me.employeePayroll.debt, 3000);
  assert.equal(current.me.employeePayroll.status, "stopped");
  const stopSequence = current.me.employeePayroll.sequence;
  socket.emit("debugGrant", { cash: 5000 });
  await until(() => current.me.cash === 5000);
  assert.equal(current.me.employeePayroll.debt, 3000, "debug grants must not be treated as business income");
  assert.equal((await emitAck("resumeEmployeeWork", { requestId: "policy-resume-early" })).ok, false);
  assert.equal((await emitAck("payEmployeePayroll", { amount: 3000, requestId: "policy-pay-complete" })).ok, true);
  await until(() => current.me.employeePayroll.debt === 0);
  assert.equal(current.me.cash, 2000);
  assert.equal(current.me.employeePayroll.status, "stopped");
  assert.equal(current.me.employeePayroll.sequence, stopSequence + 1);
  assert.equal((await emitAck("payEmployeePayroll", { amount: 3000, requestId: "policy-pay-complete" })).ok, false);
  await stop();
  await start();
  await connect(stoppedAuth);
  assert.equal(current.me.cash, 2000);
  assert.equal(current.me.employeePayroll.debt, 0);
  assert.equal(current.me.employeePayroll.status, "stopped", "paid strike state survives restart until explicit resume");
  assert.equal((await emitAck("resumeEmployeeWork", { requestId: "policy-resume-once" })).ok, true);
  await until(() => current.me.employeePayroll.status === "active");
  assert.equal(current.me.cash, 2000);
  assert.equal((await emitAck("resumeEmployeeWork", { requestId: "policy-resume-once" })).ok, false);
  socket.close();
  await connect(legacyAuth);
  assert.equal(current.me.cash, 12000);
  assert.equal(current.me.employeePayroll.debt, 0);
  assert.equal(current.me.employeePayroll.legacyDebtCleared, 99000);
  assert.equal(current.me.employeePayroll.paidTotal, 1000);
  assert.equal(current.me.employeePayroll.status, "active");
  assert.equal(current.me.employeePayroll.history.length, 0);
  assert.equal(current.me.employeePayroll.currentBill.day, today);
  console.log("employee-payroll-socket-e2e: login-only bills, modal ack, dismissal,20%, migration, dedupe and SQLite restarts ok");
} finally {
  parallelSocket?.close();
  await stop();
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
  assert.ok(path.basename(resolved).startsWith("jade-employee-payroll-"));
  rmSync(resolved, { recursive: true, force: true });
}
