/** 使用服务端时钟；存储不可用时仍在本次会话去重。 */
export function createPayrollNotifier({ showToast, formatMoney, storage } = {}) {
  const seen = new Map();
  function read(key) {
    if (seen.has(key)) return seen.get(key);
    try { return Number(storage?.getItem(key)) || 0; } catch { return 0; }
  }
  function remember(key, value) {
    seen.set(key, value);
    try { storage?.setItem(key, String(value)); } catch { /* private browsing */ }
  }
  return function notifyPayroll(state) {
    const me = state?.me;
    if (!me?.id) return;
    const history = me.employeePayroll?.history || [];
    const latest = history[0];
    const receiptKey = `jade-payroll-receipt:${me.id}`;
    if (latest?.sequence > read(receiptKey)) {
      const pending = history.filter((receipt) => receipt.sequence > read(receiptKey)
        && receipt.at >= (me.employeePayroll.migratedAt || 0)
        && ["dismissal", "transfer", "repayment", "manualPayment", "resumed"].includes(receipt.reason));
      remember(receiptKey, latest.sequence);
      if (!pending.length || !pending.includes(latest)) return;
      const paid = pending.reduce((sum, receipt) => sum + receipt.paid, 0);
      const accrued = pending.reduce((sum, receipt) => sum + receipt.accrued, 0);
      const title = latest.reason === "resumed" ? "员工已复工" : latest.status === "stopped"
        ? latest.debt > 0 ? "欠薪逾期，员工已停工" : "欠薪已结清，请点击复工"
        : latest.reason === "repayment" ? "保留周转金后按经营收入20%补薪" : latest.reason === "manualPayment" ? "员工补薪完成" : "员工工资结算";
      showToast({ title, tone: latest.debt > 0 || latest.status === "stopped" ? "warn" : "info", duration: 10000,
        text: `${accrued > 0 ? `应计工资 ${formatMoney(accrued)}，` : ""}已扣 ${formatMoney(paid)}，余额 ${formatMoney(latest.cashAfter)}。${accrued > 0 && !paid ? "现金不足，本次工资整笔挂账，现有现金已保留。" : ""}${latest.debt > 0 ? `尚欠 ${formatMoney(latest.debt)}，保留周转金后，按保留周转金后按经营收入20%补薪。` : ""}${latest.status === "grace" ? "宽限至下一个营业日，离线不消耗宽限期。" : ""}${latest.status === "stopped" ? "停工期间不新增工资，结清欠薪后请主动复工。" : ""}明细可在员工页查看。` });
      remember(receiptKey, latest.sequence);
    }
  };
}
