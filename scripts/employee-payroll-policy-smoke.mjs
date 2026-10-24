import assert from "node:assert/strict";
import { createEconomyService } from "../server/services/economy-service.js";
import { enterEmployeePayrollDay, settleEmployeePayroll, payEmployeePayroll, resumeEmployeeWork,
  employeeWorkBlock } from "../server/systems/employee-payroll.js";
import { dismissWorker, recruitWorker } from "../server/systems/employee-system.js";
import { employeePayrollQuote, EMPLOYEE_PAYROLL_DAY_MS as DAY } from "../shared/domain/economy/worker-economy.js";
import { runAtomicMutation } from "../server/services/atomic-mutation.js";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";

process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
const tenth = Date.parse("2026-10-10T12:00:00+08:00");
const originalNow = Date.now;
let now = tenth;
Date.now = () => now;
const economy = createEconomyService({ refreshPlayerReport: () => {} });
const opts = () => ({ spendCash: economy.spendCash, now });
function firstFailure() {
  now = tenth;
  const p = installOwnedWorkshopFixture(H.makePlayer(`policy-${Math.random()}`));
  p.cash = 800;
  enterEmployeePayrollDay(p, opts());
  now = tenth + 3 * DAY;
  const result = enterEmployeePayrollDay(p, opts());
  assert.equal(result.accrued, 1500);
  assert.equal(result.paid, 0);
  assert.equal(p.cash, 800);
  assert.equal(p.employeePayroll.debt, 1500);
  assert.equal(p.employeePayroll.status, "grace");
  return p;
}
try {
  const grace = firstFailure();
  const graceDay = grace.employeePayroll.graceDay;
  now += 20 * DAY;
  assert.equal(settleEmployeePayroll(grace, opts()).changed, false);
  assert.equal(employeeWorkBlock(grace), null, "offline time does not exhaust the grace business day");
  economy.earnCash(grace, 2000, "订单收入", { source: "order" });
  assert.equal(grace.cash, 2800, "automatic repayment protects the working-capital reserve");
  assert.equal(grace.employeePayroll.debt, 1500);
  assert.equal(grace.employeePayroll.graceDay, graceDay);
  assert.equal(grace.employeePayroll.currentBill.day, graceDay, "passive income must not open new salary dates");
  assert.equal(payEmployeePayroll(grace, 100, opts()).paid, 100);
  assert.equal(grace.employeePayroll.graceDay, graceDay);
  assert.equal(enterEmployeePayrollDay(grace, opts()).paid, 0);
  assert.equal(grace.employeePayroll.debt, 2900, "only grace day's ¥1500 is added, never 20 offline days");
  assert.equal(grace.employeePayroll.status, "stopped");
  assert.equal(grace.employeePayroll.currentBill.entries.length, 0);
  now += 100 * DAY;
  assert.equal(enterEmployeePayrollDay(grace, opts()).accrued, 0);
  assert.equal(grace.employeePayroll.debt, 2900);
  grace.cash = 10000;
  now += DAY;
  assert.equal(enterEmployeePayrollDay(grace, opts()).paid, 0, "stopped debt cannot silently sweep cash");
  assert.equal(recruitWorker(grace, "missing", opts()).code, "PAYROLL_OUTSTANDING");
  assert.equal(resumeEmployeeWork(grace, opts()).ok, false);
  assert.equal(payEmployeePayroll(grace, 2900, opts()).paid, 2900);
  assert.equal(grace.employeePayroll.status, "stopped");
  assert.equal(resumeEmployeeWork(grace, opts()).ok, true);
  assert.equal(employeePayrollQuote(grace, now).accrued, 1500);
  now += 4 * DAY;
  assert.equal(enterEmployeePayrollDay(grace, opts()).paid, 1500);

  for (const source of ["market-payout", "order", "livestream", "blackmarket-sale", "blackmarket-payout",
    "blackmarket-service-payout", "blackmarket-service-recovery-payout", "blackmarket-blind-sale", "inventory-recycle", "salvage"]) {
    const p = firstFailure();
    economy.earnCash(p, 1000, "经营收入", { source });
    assert.equal(p.cash, 1800, source);
    assert.equal(p.employeePayroll.debt, 1500, source);
  }
  const funded = firstFailure();
  funded.cash = 6000;
  economy.earnCash(funded, 1000, "充足周转金的收入", { source: "order" });
  assert.equal(funded.cash, 6800);
  assert.equal(funded.employeePayroll.debt, 1300, "income above the reserve still repays 20%");
  for (const source of ["auctionRefund", "market-refund", "blackmarket-service-refund", "recovery-advance", "debug", "taskReward", "achievement", undefined]) {
    const p = firstFailure();
    economy.earnCash(p, 1000, "其他收入", { source });
    assert.equal(p.cash, source === "taskReward" ? 1100 : 1800, source);
    assert.equal(p.employeePayroll.debt, 1500, source);
  }

  // Continuous online: idle midnight + world reconciliation cannot charge.
  now = tenth;
  const online = installOwnedWorkshopFixture(H.makePlayer("online-cross-day"));
  H.state.players.set(online.id, online);
  enterEmployeePayrollDay(online, { spendCash: H.spendCash, now });
  now += DAY;
  H.reconcileWorld(now, { broadcast: false });
  assert.equal(online.cash, 12000);
  // Actual service entry points must perform the rollover even without reconnecting.
  H.startWorkshopJobForPlayer(online, "missing", {});
  assert.equal(online.cash, 10500);
  assert.equal(online.employeePayroll.pendingSettlement.reason, "continued");
  H.startWorkshopJobForPlayer(online, "missing", {});
  assert.equal(online.cash, 10500);
  now += 2 * DAY;
  H.startLivestreamRoomForPlayer(online, []);
  assert.equal(online.cash, 9000, "skipped date isn't charged");
  now += DAY;
  H.replenishLivestreamRoomForPlayer(online, []);
  assert.equal(online.cash, 7500);

  // Dismissal during a stopped day still charges that worker once.
  const stopped = firstFailure();
  now += DAY;
  enterEmployeePayrollDay(stopped, opts());
  assert.equal(stopped.employeePayroll.status, "stopped");
  const fired = dismissWorker(stopped, stopped.workshop.workers[0].id, opts());
  assert.equal(fired.payroll.accrued, 320);
  assert.equal(stopped.employeePayroll.debt, 3320);
  now += 10 * DAY;
  enterEmployeePayrollDay(stopped, opts());
  assert.equal(stopped.employeePayroll.debt, 3320);

  // Payment exceptions roll back the bill marker and cash together.
  now = tenth;
  const atomic = installOwnedWorkshopFixture(H.makePlayer("atomic-salary"));
  enterEmployeePayrollDay(atomic, { spendCash: H.spendCash, now });
  const before = structuredClone(atomic);
  now += DAY;
  assert.throws(() => runAtomicMutation([atomic], () => enterEmployeePayrollDay(atomic,
    { now, spendCash: () => { throw Error("payment fault"); } })), /payment fault/);
  assert.deepEqual(atomic, before);
} finally { Date.now = originalNow; }
console.log("employee-payroll-policy-smoke: business-day grace,reserve-protected 20%,offline exclusion,cross-day service entries,stop/resume and rollback ok");
