// 1～10 阶登录日日薪，表内金额就是每个记薪日的实际应付工资。
export const EMPLOYEE_BASE_WAGES = Object.freeze([
  100, 140, 190, 250, 320, 400, 490, 590, 700, 820
]);

export const EMPLOYEE_RECRUIT_PRICES = Object.freeze([
  2800, 4800, 7500, 11000, 15500, 21000, 27500, 35000, 43500, 53500
]);

export const RECRUIT_REFRESH_COST = 350;

export function baseWageForTier(tier) {
  const normalizedTier = Math.max(1, Math.min(10, Math.round(Number(tier) || 1)));
  return EMPLOYEE_BASE_WAGES[normalizedTier - 1];
}

export function recruitPrice(tier) {
  const normalizedTier = Math.max(1, Math.min(10, Math.round(Number(tier) || 1)));
  return EMPLOYEE_RECRUIT_PRICES[normalizedTier - 1];
}

export function workerBaseWage(worker) {
  // 工资由当前阶位统一决定，避免旧存档的 baseWage 缓存沿用旧金额。
  return baseWageForTier(worker?.tier);
}

export function workerDailyWage(worker) {
  return workerBaseWage(worker);
}

// 工资使用北京时间自然日，与游戏经营日、服务器所在时区及加速模式无关。
export const EMPLOYEE_PAYROLL_VERSION = 3;
export const EMPLOYEE_PAYROLL_DAY_MS = 24 * 60 * 60 * 1000;
export const EMPLOYEE_PAYROLL_REPAY_RATE = 0.2;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

export function employeePayrollDayStart(now = Date.now()) {
  return Math.floor((now + BEIJING_OFFSET_MS) / EMPLOYEE_PAYROLL_DAY_MS)
    * EMPLOYEE_PAYROLL_DAY_MS - BEIJING_OFFSET_MS;
}

export function nextEmployeePayrollAt(now = Date.now()) {
  return employeePayrollDayStart(now) + EMPLOYEE_PAYROLL_DAY_MS;
}

export function employeePayrollStatus(player, now = Date.now()) {
  const payroll = player?.employeePayroll;
  if (payroll?.status === "stopped") return "stopped";
  if (payroll?.debt > 0) return "grace";
  return "active";
}

/** 登录日账单快照；只报价已记录的日期，不按离线时长推算。 */
export function employeePayrollQuote(player, now = Date.now(), closingWorkerId = null) {
  const payroll = player?.employeePayroll;
  const bill = payroll?.currentBill;
  const entries = (bill?.entries || []).filter((entry) => !entry.booked
    && (!closingWorkerId || bill.day < employeePayrollDayStart(now) || entry.workerId === closingWorkerId)).map((entry) => ({ ...entry }));
  // 停工日不记普通工资；主动解雇仍结清当天整日日薪。
  if (closingWorkerId && (bill?.day !== employeePayrollDayStart(now)
    || !bill.entries.some((entry) => entry.workerId === closingWorkerId))) {
    const worker = player?.workshop?.workers?.find((entry) => entry.id === closingWorkerId);
    if (worker) entries.push(employeePayrollEntry(worker, employeePayrollDayStart(now)));
  }
  const accrued = entries.reduce((sum, entry) => sum + entry.amount, 0);
  const debt = Math.max(0, Math.round(Number(player?.employeePayroll?.debt) || 0));
  const totalDue = accrued + debt;
  const cash = Math.max(0, Math.floor(Number(player?.cash) || 0));
  let paid = cash >= totalDue ? totalDue : 0;
  // 跨天直接解雇会先结上次登录日，再结当天离职工资，预览与两次支付一致。
  const priorAmount = closingWorkerId && bill?.day < employeePayrollDayStart(now)
    ? entries.filter((entry) => entry.from < employeePayrollDayStart(now)).reduce((sum, entry) => sum + entry.amount, 0) : 0;
  if (priorAmount > 0) {
    const first = cash >= priorAmount + debt ? priorAmount + debt : 0;
    paid = first + (cash - first >= totalDue - first ? totalDue - first : 0);
  }
  return { entries, accrued, debt, totalDue, paid, shortfall: Math.max(0, totalDue - cash), debtAfter: totalDue - paid, cashAfter: cash - paid };
}

export function employeePayrollEntry(worker, day) {
  const dailyWage = workerDailyWage(worker);
  return { workerId: worker.id, workerName: worker.name || "员工", dailyWage,
    days: 1, amount: dailyWage, from: day, through: day + EMPLOYEE_PAYROLL_DAY_MS, booked: false };
}

export const WORKSHOP_STAGE_OVERHEAD = Object.freeze({
  opening: { rate: 0, min: 0, max: 0 },
  carving: { rate: 0, min: 0, max: 0 },
  finishing: { rate: 0, min: 0, max: 0 }
});

export function workshopStageOverhead(stage, itemValue = 0) {
  return 0;
}

export function workerProcessingFee(worker, craftLabor = 0, options = {}) {
  return 0;
}
