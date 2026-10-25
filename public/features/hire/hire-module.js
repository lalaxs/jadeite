// hire-module.js — 员工：在册花名册 + 师傅招募
import {
  renderWorkerDetailPanel,
  workerStepForJob
} from "../../worker-detail-view.js";
import { patchRecruitDetailView } from "../../recruit-detail-dom.js";
import { createRecruitDetailController } from "../../recruit-detail-controller.js";
import { activateModalLifecycle } from "../../modal-lifecycle.js";
import { renderResourceCard } from "../../resource-card-view.js";
import { nowMs } from "../../shell/format-utils.js";
import { payrollDate } from "../../shell/payroll-settle-modal.js";
import {
  RECRUIT_REFRESH_COST,
  workerDailyWage,
  employeePayrollQuote,
  employeePayrollStatus
} from "../../worker-economy.js";

let socketRef, getState, elsRef, getActiveView;
let activeHireMarketTab = "roster";
let recruitDetailController = null;
let recruitModalLifecycleCleanup = null;
let ownedWorkerDetailId = null;
let ownedWorkerModalLifecycleCleanup = null;
let ownedWorkerDismissPrompted = false;
let ownedWorkerDismissSubmitting = false;
let ownedWorkerDismissError = "";
let hireTabsKeyboardBound = false;
let formatMoney, escapeHtml, empty;
let payrollSubmitting = false;
let payrollError = "";
let payrollInfoModalLifecycleCleanup = null;
let payrollInfoHtml = "";


export function initHireModule(deps) {
  socketRef = deps.socket;
  getState = deps.getState;
  elsRef = deps.els;
  getActiveView = deps.getActiveView;
  ({ formatMoney, escapeHtml, empty } = deps.helpers);
  recruitDetailController = createRecruitDetailController({
    mount: mountRecruitDetailShell,
    patch: patchRecruitCandidateDetail,
    unmount: (root) => {
      recruitModalLifecycleCleanup?.();
      recruitModalLifecycleCleanup = null;
      root?.remove();
    },
    emit: (event, payload, acknowledge) => socketRef.emit(event, payload, acknowledge),
    createRequestId: () => globalThis.crypto?.randomUUID?.() || `recruit-${Date.now()}`
  });
  applyHireMarketTab();
  bindHireMarketTabKeyboard();
  const register = deps.registerAction;
  if (typeof register === "function") {
    register("hireMarketTab", ({ payload }) => setHireMarketTab(payload));
    register("refreshRecruitCandidates", () => {
      socketRef.emit("refreshRecruitCandidates", {
        requestId: globalThis.crypto?.randomUUID?.() || `recruit-refresh-${Date.now()}`
      });
    });
    register("openOwnedWorkerDetail", ({ payload }) => openOwnedWorkerDetail(payload));
    register("closeOwnedWorkerDetail", () => closeOwnedWorkerDetail());
    register("promptDismissOwnedWorker", () => promptDismissOwnedWorker());
    register("cancelDismissOwnedWorker", () => cancelDismissOwnedWorker());
    register("confirmDismissOwnedWorker", () => confirmDismissOwnedWorker());
    register("openRecruitCandidateDetail", ({ payload }) => openRecruitCandidateDetail(payload));
    register("closeRecruitCandidateDetail", () => closeRecruitCandidateDetail());
    register("confirmRecruitCandidate", () => confirmRecruitCandidate());
    register("openEmployeePayrollInfo", () => openEmployeePayrollInfo());
    register("closeEmployeePayrollInfo", () => closeEmployeePayrollInfo());
    register("payEmployeePayroll", () => submitPayrollAction("payEmployeePayroll", {
      amount: Math.min(Number(getState()?.me?.cash || 0), Number(getState()?.me?.employeePayroll?.debt || 0))
    }));
    register("resumeEmployeeWork", () => submitPayrollAction("resumeEmployeeWork"));
  }
}

function submitPayrollAction(event, payload = {}) {
  if (payrollSubmitting || !socketRef) return;
  payrollSubmitting = true;
  payrollError = "";
  renderOwnedWorkers();
  const timer = setTimeout(() => {
    payrollSubmitting = false;
    payrollError = "未收到操作结果，请等待状态同步后重试。";
    renderOwnedWorkers();
  }, 10000);
  socketRef.emit(event, { ...payload, requestId: globalThis.crypto?.randomUUID?.() || `payroll-${Date.now()}` }, (result) => {
    clearTimeout(timer);
    payrollSubmitting = false;
    payrollError = result?.ok ? "" : result?.message || "操作失败。";
    renderOwnedWorkers();
  });
}

export function renderHireMarket() {
  applyHireMarketTab();
  renderOwnedWorkers();
  renderRecruitCandidates();
}

export function setHireMarketTab(tab) {
  activeHireMarketTab = tab === "recruit" ? "recruit" : "roster";
  applyHireMarketTab();
  if (activeHireMarketTab === "roster") renderOwnedWorkers();
  else renderRecruitCandidates();
}

function applyHireMarketTab() {
  const view = elsRef.hireMarketView || document.querySelector('section.view[data-view="hireMarket"]');
  if (!view) return;
  const tools = view.querySelector(".hire-market-tools");
  const toolsContainer = view.querySelector(activeHireMarketTab === "recruit"
    ? "#recruitWorkerPanel .panel-head" : ".hire-market-tabs");
  if (tools && toolsContainer && tools.parentElement !== toolsContainer) {
    if (activeHireMarketTab === "recruit") toolsContainer.prepend(tools);
    else toolsContainer.append(tools);
  }
  view.querySelectorAll(".hire-market-tabs .shop-tab").forEach((button) => {
    const on = button.dataset.payload === activeHireMarketTab;
    button.classList.toggle("active", on);
    button.setAttribute("aria-selected", on ? "true" : "false");
    button.setAttribute("tabindex", on ? "0" : "-1");
  });
  view.querySelectorAll(".tab-panel").forEach((panel) => {
    const on = panel.dataset.tabPanel === activeHireMarketTab;
    panel.classList.toggle("is-hidden", !on);
    panel.hidden = !on;
  });
}

function bindHireMarketTabKeyboard() {
  if (hireTabsKeyboardBound) return;
  const view = elsRef.hireMarketView || document.querySelector('section.view[data-view="hireMarket"]');
  const tabs = view?.querySelector(".hire-market-tabs-main");
  if (!tabs) return;
  hireTabsKeyboardBound = true;
  tabs.addEventListener("keydown", (event) => {
    const current = event.target.closest?.('.shop-tab[role="tab"]');
    if (!current) return;
    const buttons = [...tabs.querySelectorAll('.shop-tab[role="tab"]')];
    const index = buttons.indexOf(current);
    if (index < 0) return;
    let next = index;
    if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;
    event.preventDefault();
    setHireMarketTab(buttons[next].dataset.payload);
    buttons[next].focus();
  });
}

function ownedWorkerStatus(worker) {
  if (!worker) return { label: "未知", busy: false };
  if (worker.blackmarketListingId) return { label: "黑市转聘中", busy: true };
  const hostId = getState()?.me?.livestreamRoom?.hostWorkerId;
  if (hostId && hostId === worker.id) return { label: "直播中", busy: true };
  if (worker.busy) return { label: "工作中", busy: true };
  if (employeePayrollStatus(getState()?.me, nowMs()) === "stopped") return { label: "已停工", busy: false, stopped: true };
  return { label: "空闲", busy: false };
}

function payrollTime(at) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

function payrollSummaryHtml(me) {
  const now = nowMs();
  const quote = employeePayrollQuote(me, now);
  const history = me.employeePayroll?.history || [];
  const latest = history[0];
  const payroll = me.employeePayroll || {};
  const status = employeePayrollStatus(me, now);
  const manualPayment = Math.min(Math.floor(Number(me.cash) || 0), quote.debt);
  const stateText = status === "stopped" ? (quote.debt > 0 ? "员工已停工 · 停工期间不新增工资" : "欠薪已结清 · 点击复工后恢复计薪")
    : status === "grace" ? "欠薪宽限中 · 下一个营业日仍未补齐将停工" : "员工工资正常";
  const wasOpen = document.getElementById("employee-payroll-info-root")?.querySelector(".workforce-payroll-history")?.open;
  return `
    <section class="workforce-payroll-note ${quote.shortfall > 0 ? "is-short" : ""}" aria-label="员工工资结算">
      <div class="workforce-payroll-heading"><strong>${stateText}</strong><span>登录日记薪</span></div>
      ${status !== "stopped" ? `<p>待结工资日期 · ${payrollDate(payroll.currentBill?.day)} · 下一个登录日结算</p>` : ""}
      <div class="workforce-payroll-heading"><span>预计应付 <strong>${formatMoney(quote.totalDue)}</strong></span><span>当前现金 ${formatMoney(me.cash)}${quote.shortfall > 0 ? ` · 还差 ${formatMoney(quote.shortfall)}` : ""}</span></div>
      <p>登录当天记薪，下一个登录日弹窗结算；离线日期不计薪，同一天不重复扣费。跨天后首次安排员工工作视为新营业日，仅挂机不扣费。解雇结清当天整日日薪。</p>
      <p>现金不足时整笔挂账，宽限一个营业日，离线不消耗宽限期；逾期暂停新工作并停止新增工资。</p>
      ${payroll.legacyDebtCleared > 0 ? `<p>已免除旧规则累计欠薪 ${formatMoney(payroll.legacyDebtCleared)}，已支付的历史账单保留。</p>` : ""}
      ${quote.debt > 0 ? `<p class="workforce-payroll-debt">欠薪 ${formatMoney(quote.debt)}，保留周转金后，按保留周转金后按经营收入20%补薪；退款、保证金返还及纾困金不参与自动补薪。</p>
        <p>本次补薪 ${formatMoney(manualPayment)}，支付后余额 ${formatMoney(Number(me.cash) - manualPayment)}，剩余欠薪 ${formatMoney(quote.debt - manualPayment)}。</p>
        <button type="button" data-action="payEmployeePayroll" ${payrollSubmitting || manualPayment <= 0 ? "disabled" : ""}>${payrollSubmitting ? "正在处理…" : `立即补薪 · ${formatMoney(manualPayment)}`}</button>` : ""}
      ${status === "stopped" ? `<button type="button" data-action="resumeEmployeeWork" ${payrollSubmitting || quote.debt > 0 ? "disabled" : ""}>复工 · 当天按整日计薪</button>` : ""}
      ${payrollError ? `<p role="alert">${escapeHtml(payrollError)}</p>` : ""}
    </section>
    ${latest ? `<details class="workforce-payroll-history" ${wasOpen ? "open" : ""}>
      <summary tabindex="0">最近工资结算 · 已扣 ${formatMoney(latest.paid)} · ${payrollTime(latest.at)} · 查看明细</summary>
      <div class="workforce-payroll-records">${history.map((receipt) => `
        <article>
          <strong>${payrollTime(receipt.at)} · ${{ login: "登录结算", continued: "跨天营业结算", dismissal: "解雇结清（含当天）", repayment: "收入20%补薪", manualPayment: "手动补薪", stopped: "欠薪逾期停工", resumed: "员工复工" }[receipt.reason] || "旧规则日工资结算"}${receipt.billDay ? ` · 工资日期 ${payrollDate(receipt.billDay)}` : ""}</strong>
          ${receipt.entries.map((entry) => `<div><span>${escapeHtml(entry.workerName)} · ${formatMoney(entry.dailyWage)} × ${entry.days} 天</span><span>${formatMoney(entry.amount)}</span></div>`).join("")}
          <p>本期工资 ${formatMoney(receipt.accrued)} + 原欠薪 ${formatMoney(receipt.previousDebt)}；已扣 ${formatMoney(receipt.paid)}；待补 ${formatMoney(receipt.debt)}；扣后余额 ${formatMoney(receipt.cashAfter)}</p>
        </article>`).join("")}</div>
    </details>` : ""}`;
}

function openEmployeePayrollInfo() {
  if (!getState()?.me) return;
  let root = document.getElementById("employee-payroll-info-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "employee-payroll-info-root";
    root.className = "modal-root employee-payroll-info-root";
    root.innerHTML = `<section class="game-modal employee-payroll-info-modal" role="dialog" aria-modal="true" aria-labelledby="employeePayrollInfoTitle">
      <header class="game-modal-head">
        <div class="game-modal-title"><h3 id="employeePayrollInfoTitle">员工工资说明</h3></div>
        <button class="modal-close" data-action="closeEmployeePayrollInfo" type="button" aria-label="关闭">×</button>
      </header>
      <div class="game-modal-body" data-employee-payroll-info-body></div>
    </section>`;
    document.body.appendChild(root);
  }
  refreshEmployeePayrollInfo();
  if (!payrollInfoModalLifecycleCleanup) {
    payrollInfoModalLifecycleCleanup = activateModalLifecycle({
      root,
      dialog: root.querySelector('[role="dialog"]'),
      shell: document.querySelector(".shell"),
      onClose: closeEmployeePayrollInfo
    });
  }
}

function refreshEmployeePayrollInfo() {
  const root = document.getElementById("employee-payroll-info-root");
  const body = root?.querySelector("[data-employee-payroll-info-body]");
  const me = getState()?.me;
  if (!body || !me) return;
  const html = payrollSummaryHtml(me);
  if (payrollInfoHtml === html) return;
  const scrollTop = body.scrollTop;
  const focused = body.contains(document.activeElement) ? document.activeElement : null;
  const focusedAction = focused?.dataset.action;
  body.innerHTML = html;
  payrollInfoHtml = html;
  body.scrollTop = scrollTop;
  if (focused) {
    const nextFocus = (focusedAction ? body.querySelector(`[data-action="${focusedAction}"]:not([disabled])`)
      : body.querySelector("summary"))
      || root.querySelector('[data-action="closeEmployeePayrollInfo"]');
    nextFocus?.focus({ preventScroll: true });
  }
}

function closeEmployeePayrollInfo() {
  payrollInfoModalLifecycleCleanup?.();
  payrollInfoModalLifecycleCleanup = null;
  payrollInfoHtml = "";
  document.getElementById("employee-payroll-info-root")?.remove();
}

export function renderOwnedWorkers() {
  if (!elsRef.ownedWorkerList || !getState()) return;
  const workers = getState().me.workshop?.workers || [];
  const jobMeta = {
    cutter: { label: "开料师傅", keys: [["cut", "jieliao", "解料"], ["cut", "damo", "打磨"]] },
    planner: { label: "规划师傅", keys: [["set", "qieliao", "切料"], ["set", "xiuxing", "修形"]] },
    finisher: { label: "精加工师傅", keys: [["finish", "diaozhuo", "雕琢"], ["finish", "xiangqian", "镶嵌"]] },
    streamer: { label: "直播掌柜", keys: [["speak", "huashu", "话术"], ["speak", "kongchang", "控场"], ["speak", "cuidan", "催单"]] }
  };
  const statuses = workers.map((worker) => ownedWorkerStatus(worker));
  const idleCount = statuses.filter((status) => !status.busy && !status.stopped).length;
  const busyCount = statuses.filter((status) => status.busy).length;
  const stopped = employeePayrollStatus(getState().me, nowMs()) === "stopped";
  const wagePerDay = workers.reduce((sum, worker) => sum + Number(workerDailyWage(worker) || 0), 0);
  const coveredJobs = new Set(workers.map((worker) => worker.job).filter(Boolean)).size;
  const payrollDebt = Number(getState().me.employeePayroll?.debt || 0);
  refreshEmployeePayrollInfo();
  if (elsRef.hireMarketBrief) {
    elsRef.hireMarketBrief.textContent = `在册 ${workers.length}/8${stopped ? " · 已停工" : ""}`;
  }
  if (!workers.length) {
    elsRef.ownedWorkerList.innerHTML = `
      <div class="owned-worker-empty game-empty-state">
        <span class="game-empty-state-mark" aria-hidden="true">才</span>
        <strong>花名册还是空的</strong>
        <p>招募第一位师傅后，工坊排工和直播带货会更稳定。</p>
        ${payrollDebt > 0 ? `<p>待结清工资 ${formatMoney(payrollDebt)}，保留周转金后，按保留周转金后按经营收入20%补薪，也可手动补齐。</p>` : ""}
        <button type="button" data-action="hireMarketTab" data-payload="recruit">去招募</button>
      </div>
    `;
    if (ownedWorkerDetailId) closeOwnedWorkerDetail();
    return;
  }
  const workforceSummary = `
    <section class="workforce-summary" aria-label="员工状态概览">
      <div class="workforce-summary-copy ${idleCount ? "is-ready" : "is-busy"}">
        <span>当前排工能力</span>
        <strong>${stopped ? "员工已停工" : idleCount ? `${idleCount} 人可立即排工` : "全员正在工作"}</strong>
        <small>${stopped ? "已有任务正常完成，结清欠薪后可复工" : busyCount ? `${busyCount} 人忙碌中` : "当前没有进行中的员工任务"}</small>
      </div>
      <div class="workforce-summary-stat"><span>岗位覆盖</span><strong>${coveredJobs}/4</strong></div>
      <div class="workforce-summary-stat"><span>${stopped ? "复工后" : ""}日工资合计 · ${workers.length} 人</span><strong>${formatMoney(wagePerDay)} / 日</strong></div>
    </section>`;
  elsRef.ownedWorkerList.innerHTML = workforceSummary + workers.map((worker) => {
    const meta = jobMeta[worker.job] || jobMeta.cutter;
    const status = ownedWorkerStatus(worker);
    const skills = meta.keys.map(([dir, key, label]) => {
      const skill = worker.skills?.[dir]?.[key] || { level: 1 };
      return `<span>${label} Lv.${skill.level}</span>`;
    }).join("");
    const traits = [
      ...(worker.traits || []).map((trait) => `<span class="recruit-trait-chip pos">${escapeHtml(trait)}</span>`),
      ...(worker.flaws || []).map((trait) => `<span class="recruit-trait-chip neg">${escapeHtml(trait)}</span>`)
    ].join("");
    const detailAction = `data-action="openOwnedWorkerDetail" data-payload="${escapeHtml(worker.id)}"`;
    return renderResourceCard({
      type: "employee", name: worker.name, badge: status.label,
      className: `owned-worker-card ${status.busy ? "is-busy" : ""}`,
      visualAttributes: `${detailAction} aria-label="查看${escapeHtml(worker.name)}能力详情"`,
      summary: [`${meta.label} · ${Number(worker.tier) || 1} 阶`, `登录日日薪 ${formatMoney(workerDailyWage(worker))}`],
      body: `<span class="recruit-skill-row">${skills}</span>${traits ? `<span class="trait-row">${traits}</span>` : ""}`,
      footer: `<button ${detailAction} type="button">查看能力详情</button>`
    });
  }).join("");
  if (ownedWorkerDetailId) refreshOwnedWorkerDetail();
}

function ownedWorkerDetailRoot() {
  let root = document.getElementById("owned-worker-detail-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "owned-worker-detail-root";
    root.className = "modal-root owned-worker-detail-root";
    document.body.appendChild(root);
  }
  return root;
}

function mountOwnedWorkerDetailShell() {
  const root = ownedWorkerDetailRoot();
  if (!root.querySelector(".owned-worker-detail-modal")) {
    root.innerHTML = `<section class="game-modal owned-worker-detail-modal" role="dialog" aria-modal="true" aria-labelledby="ownedWorkerDetailTitle">
      <div data-owned-worker-detail-body></div>
    </section>`;
  }
  if (!ownedWorkerModalLifecycleCleanup) {
    ownedWorkerModalLifecycleCleanup = activateModalLifecycle({
      root,
      dialog: root.querySelector('[role="dialog"]'),
      shell: document.querySelector(".shell"),
      onClose: closeOwnedWorkerDetail,
      closeOnBackdrop: false
    });
  }
  return root;
}

function ownedWorkerDismissFooter(status, worker) {
  const disabledReason = status.busy ? "员工忙碌中，无法解雇" : "";
  if (ownedWorkerDismissPrompted) {
    const quote = employeePayrollQuote(getState().me, nowMs(), worker.id);
    const closingWage = quote.entries.filter((entry) => entry.workerId === worker.id).at(-1)?.dailyWage ?? workerDailyWage(worker);
    return `
      <div data-owned-dismiss-footer class="is-confirming">
        <div class="owned-dismiss-inline" role="group" aria-labelledby="ownedDismissInlineTitle">
          <div class="owned-dismiss-inline-copy">
            <strong id="ownedDismissInlineTitle">确认解雇 ${escapeHtml(worker.name)}？</strong>
            <span>含当天整日工资 ${formatMoney(closingWage)}，本次应结 ${formatMoney(quote.totalDue)}（含此前未结工资及欠薪）。</span>
            <span>立即扣款 ${formatMoney(quote.paid)}，扣后余额 ${formatMoney(quote.cashAfter)}。${quote.debtAfter > 0 ? `未付清的 ${formatMoney(quote.debtAfter)} 记为欠薪，保留周转金后，按保留周转金后按经营收入20%补薪。` : ""}确认后从花名册移除。</span>
          </div>
          ${ownedWorkerDismissError
            ? `<p class="recruit-detail-error" role="alert">${escapeHtml(ownedWorkerDismissError)}</p>`
            : ""}
          <div class="owned-dismiss-inline-actions">
            <button type="button" data-action="cancelDismissOwnedWorker"
              ${ownedWorkerDismissSubmitting ? "disabled" : ""}>取消</button>
            <button class="danger" data-action="confirmDismissOwnedWorker" type="button"
              ${ownedWorkerDismissSubmitting ? "disabled" : ""}>
              ${ownedWorkerDismissSubmitting ? "正在解雇…" : `确认解雇 · 扣 ${formatMoney(quote.paid)}`}
            </button>
          </div>
        </div>
      </div>
    `;
  }
  return `
    <div data-owned-dismiss-footer>
      <button class="danger-outline" data-action="promptDismissOwnedWorker" type="button"
        ${disabledReason ? "disabled" : ""}
        title="${escapeHtml(disabledReason)}">
        ${disabledReason || "解雇"}
      </button>
      <button class="primary" data-action="closeOwnedWorkerDetail" type="button">关闭</button>
    </div>
  `;
}

function resetOwnedWorkerDismissState() {
  ownedWorkerDismissPrompted = false;
  ownedWorkerDismissSubmitting = false;
  ownedWorkerDismissError = "";
}

function refreshOwnedWorkerDetail() {
  if (!ownedWorkerDetailId || !getState()) {
    closeOwnedWorkerDetail();
    return;
  }
  const worker = (getState().me.workshop?.workers || [])
    .find((entry) => entry.id === ownedWorkerDetailId);
  if (!worker) {
    closeOwnedWorkerDetail();
    return;
  }
  const root = mountOwnedWorkerDetailShell();
  const body = root.querySelector("[data-owned-worker-detail-body]");
  if (!body) return;
  const previousScrollTop = body.querySelector("[data-owned-worker-scroll]")?.scrollTop || 0;
  const status = ownedWorkerStatus(worker);
  body.innerHTML = renderWorkerDetailPanel({
    worker,
    step: workerStepForJob(worker.job),
    mode: "roster",
    summaryHtml: `
      <div class="owned-worker-facts">
        <span class="owned-worker-state ${status.busy ? "is-busy" : status.stopped ? "is-stopped" : "is-idle"}">${escapeHtml(status.label)}</span>
        <span class="owned-worker-wage"><span>日薪</span><strong>${formatMoney(workerDailyWage(worker))}</strong><span>/ 日</span></span>
      </div>
    `,
    footerHtml: ownedWorkerDismissFooter(status, worker)
  });
  const detailPanel = body.querySelector("[data-owned-worker-scroll]");
  if (detailPanel) detailPanel.scrollTop = previousScrollTop;
  root.querySelector('[role="dialog"]')?.setAttribute(
    "aria-busy",
    ownedWorkerDismissSubmitting ? "true" : "false"
  );
}

export function openOwnedWorkerDetail(workerId) {
  ownedWorkerDetailId = String(workerId || "").trim() || null;
  resetOwnedWorkerDismissState();
  if (!ownedWorkerDetailId) return;
  refreshOwnedWorkerDetail();
}

export function closeOwnedWorkerDetail() {
  if (ownedWorkerDismissSubmitting) return;
  resetOwnedWorkerDismissState();
  ownedWorkerDetailId = null;
  ownedWorkerModalLifecycleCleanup?.();
  ownedWorkerModalLifecycleCleanup = null;
  document.getElementById("owned-worker-detail-root")?.remove();
}

export function promptDismissOwnedWorker() {
  if (!ownedWorkerDetailId || !getState()) return;
  const worker = (getState().me.workshop?.workers || [])
    .find((entry) => entry.id === ownedWorkerDetailId);
  if (!worker) return;
  const status = ownedWorkerStatus(worker);
  if (status.busy) return;
  ownedWorkerDismissPrompted = true;
  ownedWorkerDismissSubmitting = false;
  ownedWorkerDismissError = "";
  refreshOwnedWorkerDetail();
  document.querySelector('[data-action="cancelDismissOwnedWorker"]')?.focus({ preventScroll: true });
}

export function cancelDismissOwnedWorker() {
  if (ownedWorkerDismissSubmitting) return;
  ownedWorkerDismissPrompted = false;
  ownedWorkerDismissError = "";
  refreshOwnedWorkerDetail();
  document.querySelector('[data-action="promptDismissOwnedWorker"]')?.focus({ preventScroll: true });
}

export function confirmDismissOwnedWorker() {
  if (!ownedWorkerDetailId || ownedWorkerDismissSubmitting || !socketRef) return;
  const workerId = ownedWorkerDetailId;
  ownedWorkerDismissSubmitting = true;
  ownedWorkerDismissError = "";
  refreshOwnedWorkerDetail();
  const requestId = globalThis.crypto?.randomUUID?.() || `dismiss-${Date.now()}`;
  socketRef.emit("dismissWorker", { workerId, requestId }, (result) => {
    ownedWorkerDismissSubmitting = false;
    if (!result?.ok) {
      ownedWorkerDismissError = result?.message || "解雇失败。";
      refreshOwnedWorkerDetail();
      document.querySelector('[data-action="cancelDismissOwnedWorker"]')?.focus({ preventScroll: true });
      return;
    }
    closeOwnedWorkerDetail();
  });
}

export function renderRecruitCandidates() {
  if (!elsRef.recruitCandidateList || !getState()) return;
  const candidates = getState().me.recruitCandidates || [];
  const workers = getState().me.workshop?.workers || [];
  const cash = Number(getState().me.cash || 0);
  const payrollBlocked = Number(getState().me.employeePayroll?.debt || 0) > 0 || employeePayrollStatus(getState().me, nowMs()) === "stopped";
  const jobMeta = {
    cutter: { label: "开料师傅", keys: [["cut", "jieliao", "解料"], ["cut", "damo", "打磨"]] },
    planner: { label: "规划师傅", keys: [["set", "qieliao", "切料"], ["set", "xiuxing", "修形"]] },
    finisher: { label: "精加工师傅", keys: [["finish", "diaozhuo", "雕琢"], ["finish", "xiangqian", "镶嵌"]] },
    streamer: { label: "直播掌柜", keys: [["speak", "huashu", "话术"], ["speak", "kongchang", "控场"], ["speak", "cuidan", "催单"]] }
  };
  if (elsRef.refreshRecruitBtn) {
    elsRef.refreshRecruitBtn.disabled = cash < RECRUIT_REFRESH_COST || Number(getState().me.employeePayroll?.debt || 0) > 0 || employeePayrollStatus(getState().me, nowMs()) === "stopped";
    elsRef.refreshRecruitBtn.textContent = `刷新候选人 ¥${RECRUIT_REFRESH_COST}`;
  }
  elsRef.recruitCandidateList.innerHTML = candidates.map((candidate) => {
    const meta = jobMeta[candidate.job] || jobMeta.cutter;
    const skills = meta.keys.map(([dir, key, label]) => {
      const skill = candidate.skills?.[dir]?.[key] || { level: 1 };
      return `<span>${label} Lv.${skill.level}</span>`;
    }).join("");
    const traits = [
      ...(candidate.traits || []).map((trait) => `<span class="recruit-trait-chip pos">${escapeHtml(trait)}</span>`),
      ...(candidate.flaws || []).map((trait) => `<span class="recruit-trait-chip neg">${escapeHtml(trait)}</span>`)
    ].join("");
    const baseWage = workerDailyWage(candidate);
    const detailAction = `data-action="openRecruitCandidateDetail" data-payload="${escapeHtml(candidate.id)}"`;
    return renderResourceCard({
      type: "employee", name: candidate.name, badge: "待招募", className: "recruit-candidate-card",
      visualAttributes: `${detailAction} aria-label="查看${escapeHtml(candidate.name)}完整详情"`,
      summary: [`${meta.label} · ${Number(candidate.tier) || 1} 阶`, `登录日日薪 ${formatMoney(baseWage)}`],
      body: `<span class="recruit-skill-row">${skills}</span>${traits ? `<span class="trait-row">${traits}</span>` : ""}`,
      footer: `<span class="inventory-slot-value"><span>签约费用</span><strong>${formatMoney(candidate.price)}</strong></span><button ${detailAction} type="button">查看完整详情</button>`
    });
  }).join("") || `
    <div class="game-empty-state recruit-empty-state">
      <span class="game-empty-state-mark" aria-hidden="true">募</span>
      <strong>${workers.length >= 8 ? "员工人数已达上限" : "暂时没有候选人"}</strong>
      <p>${workers.length >= 8 ? "当前最多可管理 8 位员工，可先调整现有花名册。" : "刷新候选池后会出现新一批师傅。"}</p>
      ${workers.length >= 8 ? "" : `<button type="button" data-action="refreshRecruitCandidates" ${cash < RECRUIT_REFRESH_COST || payrollBlocked ? "disabled" : ""}>${payrollBlocked ? "请先补薪并复工" : cash < RECRUIT_REFRESH_COST ? `现金不足 · 还差 ${formatMoney(RECRUIT_REFRESH_COST - cash)}` : `刷新候选人 · ¥${RECRUIT_REFRESH_COST}`}</button>`}
    </div>`;
  recruitDetailController?.refresh();
}

function recruitDetailRoot() {
  let root = document.getElementById("recruit-detail-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "recruit-detail-root";
    root.className = "modal-root";
    document.body.appendChild(root);
  }
  return root;
}

function mountRecruitDetailShell() {
  const root = recruitDetailRoot();
  if (!root.querySelector(".recruit-detail-modal")) {
    root.innerHTML = `<section class="game-modal recruit-detail-modal" role="dialog" aria-modal="true" aria-label="候选人完整详情">
      <button class="modal-close recruit-detail-close" data-action="closeRecruitCandidateDetail" type="button" aria-label="关闭">×</button>
      <div data-recruit-detail-body></div>
    </section>`;
  }
  recruitModalLifecycleCleanup?.();
  recruitModalLifecycleCleanup = activateModalLifecycle({
    root,
    dialog: root.querySelector('[role="dialog"]'),
    shell: document.querySelector(".shell"),
    onClose: closeRecruitCandidateDetail
  });
  return root;
}

function patchRecruitCandidateDetail(modal, root) {
  if (!getState()) return false;
  const candidate = (getState().me.recruitCandidates || [])
    .find((entry) => entry.id === modal.candidateId);
  if (!candidate) return false;

  const workers = getState().me.workshop?.workers || [];
  const cash = Number(getState().me.cash || 0);
  const signingFee = Number(candidate.price || 0);
  const balanceAfter = cash - signingFee;
  const payrollBlocked = Number(getState().me.employeePayroll?.debt || 0) > 0 || employeePayrollStatus(getState().me, nowMs()) === "stopped";
  const disabledReason = payrollBlocked ? "请先结清欠薪并恢复工作" : workers.length >= 8
    ? "员工人数已达到 8 人上限"
    : cash < signingFee ? "现金不足" : "";
  const actionLabel = payrollBlocked || workers.length >= 8
    ? disabledReason
    : cash < signingFee
      ? `现金不足 · 还差 ${formatMoney(Math.abs(balanceAfter))}`
      : `确认招募 · ${formatMoney(signingFee)}`;

  patchRecruitDetailView(root, {
    candidateId: candidate.id,
    detailHtml: renderWorkerDetailPanel({
      worker: candidate,
      mode: "recruit",
      summaryHtml: `
        <div class="recruit-pay-summary">
          <div><span>签约费用</span><strong>${formatMoney(signingFee)}</strong></div>
          <div class="is-wage"><span>日工资 / 日</span><strong>${formatMoney(workerDailyWage(candidate))}</strong></div>
        </div>
        <p class="recruit-payroll-rule">当天入职记整日日薪，下一个登录日弹窗结算；离线日期不计薪，同一天不重复扣费，解雇时结清当天日工资。</p>
      `,
      footerHtml: '<div data-recruit-footer></div>'
    }),
    footerHtml: `
      ${modal.error ? `<p class="recruit-detail-error" role="alert">${escapeHtml(modal.error)}</p>` : ""}
      <button class="primary" data-action="confirmRecruitCandidate" type="button"
        ${disabledReason || modal.submitting ? "disabled" : ""}>
        ${modal.submitting ? "正在招募…" : actionLabel}
      </button>
    `
  });
  return true;
}

export function openRecruitCandidateDetail(candidateId) {
  recruitDetailController?.open(candidateId);
}

export function closeRecruitCandidateDetail() {
  recruitDetailController?.close();
}

export function confirmRecruitCandidate() {
  recruitDetailController?.confirm();
}
