// Disposable visual QA: never load or modify the player's saved world.
if (!["3019", "3020"].includes(process.env.PORT) || process.env.JADE_WORLD_PERSIST !== "0") {
  throw new Error("payroll visual QA requires PORT=3019/3020 and JADE_WORLD_PERSIST=0");
}
const { __testHooks: H } = await import("../server.js");
const { installOwnedWorkshopFixture } = await import("./fixtures/owned-workshop.mjs");
const { enterEmployeePayrollDay } = await import("../server/systems/employee-payroll.js");
const { employeePayrollDayStart, EMPLOYEE_PAYROLL_DAY_MS } = await import("../shared/domain/economy/worker-economy.js");
const seeded = new Set();
setInterval(() => {
  for (const player of H.state.players.values()) {
    if (seeded.has(player.id)) continue;
    seeded.add(player.id);
    installOwnedWorkshopFixture(player);
    const today = employeePayrollDayStart(Date.now());
    const stopped = process.env.JADE_PAYROLL_QA_STATE === "stopped";
    player.cash = stopped ? 0 : process.env.JADE_PAYROLL_QA_STATE === "paid" ? 30000 : 800;
    // bootstrap created today's empty first bill; replace only this disposable fixture.
    player.employeePayroll.businessDay = 0;
    player.employeePayroll.currentBill = null;
    enterEmployeePayrollDay(player, { spendCash: H.spendCash, now: today - 3 * EMPLOYEE_PAYROLL_DAY_MS });
    if (stopped) enterEmployeePayrollDay(player, { spendCash: H.spendCash, now: today - EMPLOYEE_PAYROLL_DAY_MS });
    enterEmployeePayrollDay(player, { spendCash: H.spendCash, now: today });
    if (stopped) player.cash = 5000;
    player.offlineSummary = null;
    H.broadcast();
  }
}, 200).unref();
