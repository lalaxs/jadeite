import { escapeHtml, formatMoney } from "./format-utils.js";

export function payrollDate(at) {
  return at > 0 ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(at) : "此前登录日";
}

export function buildEmployeePayrollSettleModal(receipt, workers = []) {
  if (!receipt?.id) return null;
  const entries = receipt.entries || [];
  const roster = new Map(workers.map((worker) => [worker.id, worker]));
  const roles = { cutter: "开料师傅", finisher: "精加工师傅", planner: "规划师傅", streamer: "直播掌柜" };
  const debt = Number(receipt.debt) || 0;
  const previousDebt = Number(receipt.previousDebt) || 0;
  const stopped = receipt.status === "stopped";
  const paid = Number(receipt.paid) || 0;
  const state = debt > 0 ? stopped ? "欠薪逾期 · 员工已停工" : "现金不足 · 已挂账"
    : stopped ? "欠薪已结清 · 待复工" : "✓ 本次工资已结清";
  const pendingNote = stopped
    ? "员工暂停新工作，停工期间不新增工资；结清欠薪后请在员工页主动复工。"
    : "现有现金已保留，宽限至下个营业日；保留周转金后，按经营收入20%补薪。";
  return {
    id: `payroll-settle:${receipt.id}`, payrollReceiptId: receipt.id,
    title: "员工工资结算", size: "standard", modalClass: "payroll-settle-modal",
    subtitle: `工资日期 ${payrollDate(receipt.billDay)} · 本次结算 ${payrollDate(receipt.at)}`,
    tone: debt > 0 || stopped ? "warn" : "expense",
    html: `
      <div class="payroll-settle-summary ${debt > 0 || stopped ? "is-pending" : ""}">
        <div><span class="payroll-settle-label">${paid > 0 ? "本次实际扣款" : "本次未扣款"}</span>
          <span class="payroll-settle-state">${state}</span></div>
        <strong class="payroll-settle-amount">${paid > 0 ? "−" : ""}${formatMoney(paid)}</strong>
      </div>
      ${debt > 0 ? `<p class="payroll-settle-owed"><strong>待补工资 ${formatMoney(debt)}</strong><br>${pendingNote}</p>` : ""}
      <div class="payroll-settle-section"><h4>员工明细</h4><span>${new Set(entries.map((entry) => entry.workerId)).size}名员工</span></div>
      <table class="payroll-settle-table" aria-label="员工工资明细">
        <thead><tr><th scope="col">员工</th><th scope="col">岗位</th><th scope="col">本期工资</th></tr></thead>
        <tbody>${entries.length ? entries.map((entry) => `<tr>
          <td>${escapeHtml(entry.workerName || "员工")}</td>
          <td>${roles[roster.get(entry.workerId)?.job] || "—"}</td>
          <td>${formatMoney(entry.amount)}</td></tr>`).join("")
          : `<tr><td colspan="3" class="payroll-settle-empty">本次没有新增员工工资</td></tr>`}</tbody>
        <tfoot>${previousDebt > 0 ? `<tr class="payroll-settle-carry"><td colspan="2">原有欠薪</td><td>${formatMoney(previousDebt)}</td></tr>` : ""}
          <tr><td colspan="2">本期应付合计</td><td>${formatMoney((Number(receipt.accrued) || 0) + previousDebt)}</td></tr></tfoot>
      </table>
      <p class="payroll-settle-next">${stopped ? "当天已停工，不新增工资；已开始的任务继续完成。"
        : `当天工资已记账，<span>下个登录日结算。</span>`}</p>`,
    footerHtml: `<details class="payroll-settle-rules"><summary>结算规则</summary><div>
      <p>只收上次登录当天的工资，离线日期不计薪；同一天不会重复扣款。</p>
      <p>持续在线跨天后，首次安排员工工作进入新营业日；仅挂机不扣费。</p>
      <p>资金不足则整笔挂账，宽限一个营业日；离线不消耗宽限期。逾期停工后不再新增工资。</p>
      <p>保留周转金后，按经营收入20%补薪，也可在员工页手动补齐。结清欠薪后请主动复工。</p>
    </div></details>`,
    actions: debt > 0 || stopped ? [
      { label: "知道了", variant: "secondary" },
      { label: debt > 0 ? "前往补薪" : "前往复工", clientAction: "goFeatureUnlock", payload: "hireMarket" }
    ] : [{ label: "知道了" }]
  };
}
