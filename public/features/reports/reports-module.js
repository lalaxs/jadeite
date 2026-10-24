// reports-module.js — 经营账房 + 离线结算摘要
import { financeReportHtml } from "../finance/finance-view.js";
let getState, elsRef;
let currentReportSummary, formatMoney, escapeHtml;
let openBillView = null;
let bound = false;

export function initReportsModule(deps) {
  getState = deps.getState;
  elsRef = deps.els;
  ({ currentReportSummary, formatMoney, escapeHtml } = deps.helpers);
  openBillView = typeof deps.openBillView === "function" ? deps.openBillView : null;
  bindReportsOnce();
}

function bindReportsOnce() {
  if (bound || !elsRef?.reports) return;
  bound = true;
  elsRef.reports.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-open-bill]");
    if (!btn || typeof openBillView !== "function") return;
    openBillView({
      metric: btn.dataset.openBill || "cash",
      thisMonth: btn.dataset.billScope === "month"
    });
  });
}

export function renderOfflineSummary() {
  const summary = getState()?.me?.offlineSummary;
  if (!summary || !Number(summary.count)) return "";
  const lines = Array.isArray(summary.lines) ? summary.lines : [];
  return `
    <section class="offline-summary">
      <div class="offline-head"><h3>离线结算</h3><span>${Number(summary.count)} 件事已完成</span></div>
      <div class="offline-totals">
        <span>收入 ${formatMoney(summary.income)}</span>
        <span>支出 ${formatMoney(summary.expense)}</span>
      </div>
      <div class="offline-lines">
        ${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
      </div>
    </section>
  `;
}

function signedMoney(value) {
  const amount = Number(value || 0);
  if (amount > 0) return `+${formatMoney(amount)}`;
  if (amount < 0) return `-${formatMoney(Math.abs(amount))}`;
  return formatMoney(0);
}

function expenseMoney(value) {
  const amount = Math.abs(Number(value || 0));
  return amount > 0 ? `-${formatMoney(amount)}` : formatMoney(0);
}

function reportHealthModel(report) {
  const income = Number(report?.income || 0);
  const expense = Number(report?.expense || 0);
  const net = Number(report?.net || 0);
  if (income === 0 && expense === 0) {
    return {
      tone: "is-idle",
      title: "本期还没有经营流水",
      detail: "完成交易、订单或加工后，这里会汇总本期经营结果。",
      marginLabel: "现金流不等于利润"
    };
  }
  if (net > 0) {
    return {
      tone: "is-positive",
      title: "本期现金净流入",
      detail: "现金流为正，可以继续周转进料，或保留现金等待更合适的机会。",
      marginLabel: "现金流不等于利润"
    };
  }
  if (net < 0) {
    return {
      tone: "is-negative",
      title: "本期现金净流出",
      detail: "支出高于收入，优先完成订单或出售成品，让库存重新变成现金。",
      marginLabel: "现金流不等于利润"
    };
  }
  return {
    tone: "is-even",
    title: "本期收支持平",
    detail: "当前现金流平稳，可以根据库存结构选择进料或变现。",
    marginLabel: "现金流不等于利润"
  };
}

export function renderReports() {
  const report = currentReportSummary();
  const advice = Array.isArray(report.advice) ? report.advice : [];
  const health = reportHealthModel(report);
  const cash = Number(getState()?.me?.cash || 0);
  elsRef.reports.innerHTML = `
    ${financeReportHtml(report.finance || getState()?.me?.reports?.find((row) => row.finance)?.finance)}
    <section class="panel report-card">
      <div class="panel-head">
        <h3>现金收支</h3>
        <span>当前周期</span>
      </div>
      <section class="report-health ${health.tone}" aria-label="本期现金流">
        <div class="report-health-copy">
          <span>本期现金流</span>
          <h4>${escapeHtml(health.title)}</h4>
          <p>${escapeHtml(health.detail)}</p>
        </div>
        <div class="report-health-net">
          <span>现金净变化</span>
          <strong>${signedMoney(report.net)}</strong>
          <small>${escapeHtml(health.marginLabel)}</small>
        </div>
      </section>
      <div class="report-metrics">
        <div class="is-income"><span>收入</span><strong>${signedMoney(report.income)}</strong></div>
        <div class="is-expense"><span>支出</span><strong>${expenseMoney(report.expense)}</strong></div>
        <div class="${Number(report.net || 0) < 0 ? "is-negative" : "is-net"}"><span>现金净变化</span><strong>${signedMoney(report.net)}</strong></div>
        <div class="is-inventory"><span>库存参考估值</span><strong>${formatMoney(report.inventoryValue)}</strong></div>
      </div>
      <div class="report-actions" aria-label="账房快捷操作">
        <button type="button" class="secondary" data-open-bill="cash" data-bill-scope="month">查看本月金额账单</button>
        <button type="button" class="secondary" data-view-link="inventory">盘点库存 · ${formatMoney(report.inventoryValue)}</button>
        <button type="button" data-view-link="orders">去订单变现 · 现金 ${formatMoney(cash)}</button>
        ${cash < 2000 ? '<button type="button" class="secondary" data-action="requestRecovery">申请经营周转借款</button>' : ""}
      </div>
      <section class="report-advice">
        ${cash < 2000 ? '<p>周转借款仅供已有经营记录且无可变现资产的掌柜申请；补足至 ¥12,000，应还金额含 5% 周转成本。</p>' : ""}
        <div class="report-advice-head"><h4>经营建议</h4><span>${advice.length || 1} 条</span></div>
        <div class="fit-list">${advice.length
          ? advice.map((item, index) => `<div><b>${index + 1}</b><span>${escapeHtml(item)}</span></div>`).join("")
          : `<div><b>1</b><span>当前经营节奏平稳，可按库存与现金情况安排下一步。</span></div>`}</div>
      </section>
    </section>
  `;
}
