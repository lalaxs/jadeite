import {
  EMPLOYEE_PAYROLL_VERSION, EMPLOYEE_PAYROLL_REPAY_RATE, employeePayrollEntry,
  employeePayrollDayStart, employeePayrollQuote, employeePayrollStatus
} from "../../shared/domain/economy/worker-economy.js";
import { availableDebtRepayment } from "../../shared/domain/economy/operating-reserve.js";
import { recordFinancePayroll } from "../../shared/domain/economy/finance-book.js";

export function normalizeEmployeePayroll(player, now = Date.now()) {
  player.employeePayroll ||= {};
  const payroll = player.employeePayroll;
  for (const key of ["debt", "accruedTotal", "paidTotal", "sequence", "forgivenTotal"]) {
    payroll[key] = Math.max(0, Math.round(Number(payroll[key]) || 0));
  }
  if (!Array.isArray(payroll.history)) payroll.history = [];
  if (payroll.version !== EMPLOYEE_PAYROLL_VERSION) {
    // 旧存档无法可靠拆分在线/离线欠薪，免除旧规则未付余额，保留实际付款记录。
    payroll.legacyDebtCleared = payroll.debt;
    payroll.forgivenTotal += payroll.debt;
    payroll.debt = 0;
    payroll.version = EMPLOYEE_PAYROLL_VERSION;
    payroll.policyVersion = 2;
    payroll.migratedAt = now;
    payroll.status = "active";
    payroll.businessDay = 0;
    payroll.currentBill = null;
    payroll.pendingSettlement = null;
    payroll.debtSince = payroll.graceDay = payroll.graceEndsAt = payroll.stoppedAt = 0;
  }
  return payroll;
}

/** 仅显式登录/主动员工操作记录名册；tick、离线收入和重启都不能开新账单。 */
export function recordEmployeePayrollRoster(player, now = Date.now()) {
  const payroll = normalizeEmployeePayroll(player, now);
  if (payroll.status === "stopped" || payroll.currentBill?.day !== employeePayrollDayStart(now)) return;
  for (const worker of player.workshop?.workers || []) {
    if (!payroll.currentBill.entries.some((entry) => entry.workerId === worker.id)) {
      payroll.currentBill.entries.push(employeePayrollEntry(worker, payroll.currentBill.day));
    }
  }
}

function debtCleared(payroll) {
  if (payroll.debt > 0) return;
  payroll.debtSince = payroll.graceDay = payroll.graceEndsAt = 0;
  if (payroll.status !== "stopped") payroll.status = "active";
}

function receiptFor(player, { now, reason, entries = [], previousDebt, accrued = 0, paid = 0, billDay = 0 }) {
  const payroll = player.employeePayroll;
  payroll.sequence += 1;
  const receipt = { id: `salary:${payroll.sequence}:${now}`, sequence: payroll.sequence, at: now,
    reason, billDay, entries, previousDebt, accrued, paid, debt: payroll.debt, cashAfter: player.cash,
    status: payroll.status, graceDay: payroll.graceDay, stoppedAt: payroll.stoppedAt };
  payroll.history = [receipt, ...payroll.history].slice(0, 10);
  return receipt;
}

export function enterEmployeePayrollDay(player, options = {}) {
  return settleEmployeePayroll(player, { ...options, enterDay: true });
}

/** 前一登录日只结一次；绝不补记跳过的日期。普通调用不会因时间流逝扣款。 */
export function settleEmployeePayroll(player, { spendCash, now = Date.now(), closingWorkerId = null,
  enterDay = false, reason = "login", closingWorkerOnly = false, closingReason = "dismissal" } = {}) {
  const payroll = normalizeEmployeePayroll(player, now);
  const today = employeePayrollDayStart(now);
  let changed = false, accrued = 0, paid = 0, receipt = null;
  function book(entries, billDay, receiptReason) {
    if (!entries.length) return null;
    const previousDebt = payroll.debt;
    const amount = entries.reduce((sum, entry) => sum + entry.amount, 0);
    const due = previousDebt + amount;
    const payment = due > 0 && player.cash >= due && typeof spendCash === "function" ? due : 0;
    if (payment > 0 && !spendCash(player, payment,
      receiptReason === "transfer" ? "员工转聘工资结清" : receiptReason === "dismissal" ? "解雇工资结清（含当天日工资）" : "上次登录日员工工资结算",
      { source: "employeeSalary", repEligible: false, at: now })) {
      throw new Error("员工工资支付异常，请重试。");
    }
    for (const entry of entries) entry.booked = true;
    recordFinancePayroll(player, entries, billDay, now);
    payroll.accruedTotal += amount;
    payroll.debt = due - payment;
    payroll.paidTotal += payment;
    accrued += amount;
    paid += payment;
    if (payroll.debt > 0 && payroll.status === "active") {
      payroll.status = "grace";
      payroll.debtSince = now;
      payroll.graceDay = today;
    }
    debtCleared(payroll);
    if (amount > 0 || payment > 0) {
      receipt = receiptFor(player, { now, reason: receiptReason, billDay,
        entries: entries.map((entry) => ({ ...entry })), previousDebt, accrued: amount, paid: payment });
    }
    return receipt;
  }
  if (closingWorkerOnly && closingWorkerId && today > payroll.businessDay) {
    // An offline consignment sale must not open a new business/payroll day for
    // the seller's other employees. Close only this employee's recorded wage.
    const entries = (payroll.currentBill?.entries || []).filter((entry) => entry.workerId === closingWorkerId && !entry.booked);
    if (entries.length) { book(entries, payroll.currentBill.day, closingReason); changed = true; }
    return { changed, accrued, paid, debt: payroll.debt, receipt };
  }
  if ((enterDay || closingWorkerId) && today > payroll.businessDay) {
    const previousBill = payroll.currentBill;
    const graceExpired = payroll.status === "grace" && payroll.debt > 0 && payroll.graceDay < today;
    const oldStatus = payroll.status;
    const dayReceipt = book((previousBill?.entries || []).filter((entry) => !entry.booked), previousBill?.day || 0, reason);
    if (graceExpired && payroll.debt > 0) {
      payroll.status = "stopped";
      payroll.stoppedAt ||= now;
    }
    if (oldStatus !== payroll.status && !dayReceipt) {
      receipt = receiptFor(player, { now, reason: "stopped", previousDebt: payroll.debt });
    }
    if (receipt) {
      receipt.status = payroll.status;
      receipt.stoppedAt = payroll.stoppedAt;
      payroll.pendingSettlement = structuredClone(receipt);
    }
    payroll.businessDay = today;
    payroll.currentBill = { day: today, entries: [] };
    recordEmployeePayrollRoster(player, now);
    changed = true;
  }
  if (closingWorkerId) {
    recordEmployeePayrollRoster(player, now);
    const quote = employeePayrollQuote(player, now, closingWorkerId);
    const entries = quote.entries.map((entry) => {
      let row = payroll.currentBill.entries.find((row) => row.workerId === entry.workerId);
      if (!row) payroll.currentBill.entries.push(row = entry);
      return row;
    });
    if (entries.length) {
      book(entries, today, closingReason);
      changed = true;
    }
  }
  return { changed, accrued, paid, debt: payroll.debt, receipt };
}

const BUSINESS_INCOME_SOURCES = new Set(["market-payout", "order", "livestream", "blackmarket-sale",
  "blackmarket-payout", "blackmarket-service-payout", "blackmarket-service-recovery-payout",
  "blackmarket-blind-sale", "blackmarket-blind-extra-sale", "inventory-recycle", "salvage", "commission"]);

export function repayEmployeePayrollFromIncome(player, income, meta = {}, { spendCash, now = Date.now(), maxPayment = Infinity } = {}) {
  if (!BUSINESS_INCOME_SOURCES.has(meta.source)) return 0;
  const payroll = normalizeEmployeePayroll(player, now);
  const payment = Math.min(payroll.debt, Math.floor(Math.max(0, income) * EMPLOYEE_PAYROLL_REPAY_RATE),
    Math.max(0, maxPayment), availableDebtRepayment(player));
  if (payment <= 0) return 0;
  const previousDebt = payroll.debt;
  if (!spendCash(player, payment, "经营收入20%补发员工工资", { source: "employeeSalary", repEligible: false, at: now })) {
    throw new Error("员工补薪支付异常，请重试。");
  }
  payroll.debt -= payment;
  payroll.paidTotal += payment;
  debtCleared(payroll);
  receiptFor(player, { now, reason: "repayment", previousDebt, paid: payment });
  return payment;
}

export function payEmployeePayroll(player, amount, options = {}) {
  const now = options.now ?? Date.now();
  const payroll = normalizeEmployeePayroll(player, now);
  if (!payroll.debt) return { ok: true, message: payroll.status === "stopped" ? "欠薪已结清，可点击复工。" : "当前没有欠薪。", paid: 0 };
  const requested = Number(amount);
  if (!Number.isSafeInteger(requested) || requested <= 0) return { ok: false, message: "请输入有效补薪金额。" };
  const payment = Math.min(payroll.debt, requested);
  if (player.cash < payment) return { ok: false, message: "现金不足，本次补薪未扣款。" };
  const previousDebt = payroll.debt;
  if (!options.spendCash(player, payment, "手动补发员工工资", { source: "employeeSalary", repEligible: false, at: now })) {
    throw new Error("员工补薪支付异常，请重试。");
  }
  payroll.debt -= payment;
  payroll.paidTotal += payment;
  debtCleared(payroll);
  receiptFor(player, { now, reason: "manualPayment", previousDebt, paid: payment });
  return { ok: true, message: `已补薪 ¥${payment}，剩余欠薪 ¥${payroll.debt}。${payroll.status === "stopped" && !payroll.debt ? "可点击复工。" : ""}`, paid: payment };
}

export function resumeEmployeeWork(player, options = {}) {
  const now = options.now ?? Date.now();
  const payroll = normalizeEmployeePayroll(player, now);
  if (payroll.debt > 0) return { ok: false, message: `请先结清欠薪 ¥${payroll.debt}。` };
  if (payroll.status !== "stopped") return { ok: false, message: "员工当前无需复工。" };
  enterEmployeePayrollDay(player, { ...options, now });
  payroll.status = "active";
  payroll.stoppedAt = 0;
  recordEmployeePayrollRoster(player, now);
  receiptFor(player, { now, reason: "resumed", previousDebt: 0 });
  return { ok: true, message: "员工已复工，复工当天记薪，下一个登录日结算。" };
}

export function employeeWorkBlock(player, now = Date.now()) {
  return employeePayrollStatus(player, now) === "stopped"
    ? { ok: false, code: "EMPLOYEE_STOPPED", message: "员工已停工，请先结清欠薪并在员工页点击复工。" } : null;
}

export function employeeRecruitmentBlock(player, now = Date.now()) {
  return player?.employeePayroll?.debt > 0 || employeeWorkBlock(player, now)
    ? { ok: false, code: "PAYROLL_OUTSTANDING", message: "请先结清员工欠薪并恢复工作，再进行招聘。" } : null;
}
