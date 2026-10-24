import assert from "node:assert/strict";
import { normalizeEmployeePayroll, settleEmployeePayroll, enterEmployeePayrollDay,
  recordEmployeePayrollRoster } from "../server/systems/employee-payroll.js";
import { dismissWorker, recruitWorker } from "../server/systems/employee-system.js";
import { employeePayrollDayStart, employeePayrollQuote, EMPLOYEE_PAYROLL_DAY_MS as DAY } from "../shared/domain/economy/worker-economy.js";
import { buildEmployeePayrollSettleModal } from "../public/shell/payroll-settle-modal.js";
import { createPayrollNotifier } from "../public/shell/payroll-notifications.js";
import { initHireModule, renderOwnedWorkers } from "../public/hire-module.js";
import { bindFormatDeps } from "../public/shell/format-utils.js";

const tenth = Date.parse("2026-10-10T12:00:00+08:00");
const thirteenth = tenth + 3 * DAY;
const spendCash = (p, amount) => { if (p.cash < amount) return false; p.cash -= amount; (p.ledger ||= []).push(amount); return true; };
const opts = (now) => ({ spendCash, now });
function player(cash = 10000) {
  const p = { id: "salary", cash, jobs: [], workshop: { workers: [
    { id: "one", name: "师傅甲", tier: 1 }, { id: "two", name: "师傅乙", tier: 2 }
  ] } };
  normalizeEmployeePayroll(p, tenth);
  return p;
}
const p = player();
assert.equal(enterEmployeePayrollDay(p, opts(tenth)).paid, 0);
assert.equal(employeePayrollQuote(p, tenth).totalDue, 240);
assert.equal(settleEmployeePayroll(p, opts(thirteenth)).changed, false, "time alone cannot charge or record offline dates");
assert.equal(p.cash, 10000);
assert.equal(enterEmployeePayrollDay(p, opts(thirteenth)).paid, 240, "10th → 13th charges only the 10th");
assert.equal(p.employeePayroll.history[0].billDay, employeePayrollDayStart(tenth));
assert.deepEqual(p.employeePayroll.history[0].entries.map((row) => row.days), [1, 1]);
assert.equal(p.employeePayroll.currentBill.day, employeePayrollDayStart(thirteenth));
assert.equal(enterEmployeePayrollDay(p, opts(thirteenth + 1000)).paid, 0);
assert.equal(enterEmployeePayrollDay(JSON.parse(JSON.stringify(p)), opts(thirteenth + 2000)).paid, 0, "refresh/restart are idempotent");
assert.equal(p.employeePayroll.sequence, 1);
const modal = buildEmployeePayrollSettleModal(p.employeePayroll.pendingSettlement);
assert.match(modal.subtitle, /2026\/10\/10.*2026\/10\/13/);
assert.match(modal.html, /payroll-settle-amount">−¥240/);
assert.match(modal.html, /2名员工/);
assert.doesNotMatch(modal.html, /扣后现金余额|计薪1天|计薪一天/);
assert.match(modal.footerHtml, /结算规则/);

// Snapshot wages do not change retroactively; newly hired workers join today's bill.
p.workshop.workers[0].tier = 10;
recordEmployeePayrollRoster(p, thirteenth);
assert.equal(employeePayrollQuote(p, thirteenth).accrued, 240);
p.recruitCandidates = [{ id: "new", name: "新员工", tier: 1, price: 2800 }];
assert.equal(recruitWorker(p, "new", opts(thirteenth)).ok, true);
assert.equal(employeePayrollQuote(p, thirteenth).accrued, 340);
const before = p.cash;
assert.equal(dismissWorker(p, "one", opts(thirteenth)).payroll.paid, 100, "dismissal uses same-day wage snapshot");
assert.equal(p.cash, before - 100);
assert.equal(dismissWorker(p, "one", opts(thirteenth)).code, "NOT_FOUND");
assert.equal(enterEmployeePayrollDay(p, opts(thirteenth + 5 * DAY)).paid, 240, "dismissed wages cannot be charged again");
assert.equal(p.employeePayroll.currentBill.entries.length, 2);

// Cross-day dismissal quotes and charges yesterday's roster plus today's departing worker.
const closing = player();
enterEmployeePayrollDay(closing, opts(tenth));
assert.equal(employeePayrollQuote(closing, thirteenth, "one").totalDue, 340);
assert.equal(dismissWorker(closing, "one", opts(thirteenth)).payroll.paid, 340);
assert.equal(enterEmployeePayrollDay(closing, opts(thirteenth + DAY)).paid, 140);
const shortClosing = player(300);
enterEmployeePayrollDay(shortClosing, opts(tenth));
assert.equal(employeePayrollQuote(shortClosing, thirteenth, "one").paid, 240);
assert.equal(dismissWorker(shortClosing, "one", opts(thirteenth)).payroll.paid, 240);
assert.equal(shortClosing.cash, 60);
assert.equal(shortClosing.employeePayroll.debt, 100);

// Migration clears legacy debt once, preserves cash/paid history, and starts on first login.
const legacy = player();
legacy.employeePayroll = { version: 2, policyVersion: 1, debt: 9000, accruedTotal: 10000,
  paidTotal: 1000, sequence: 7, status: "stopped", history: [{ id: "paid-history", paid: 1000 }] };
normalizeEmployeePayroll(legacy, tenth);
assert.equal(legacy.cash, 10000);
assert.equal(legacy.employeePayroll.debt, 0);
assert.equal(legacy.employeePayroll.legacyDebtCleared, 9000);
assert.equal(legacy.employeePayroll.forgivenTotal, 9000);
assert.equal(legacy.employeePayroll.paidTotal, 1000);
assert.equal(legacy.employeePayroll.history[0].id, "paid-history");
assert.equal(legacy.employeePayroll.currentBill, null);
normalizeEmployeePayroll(legacy, thirteenth);
assert.equal(legacy.employeePayroll.forgivenTotal, 9000);
assert.equal(enterEmployeePayrollDay(legacy, opts(thirteenth)).paid, 0);
assert.equal(legacy.employeePayroll.status, "active");

// Roster UI and notifications use login days; no midnight toast can fire.
const notices = [];
const notify = createPayrollNotifier({ showToast: (value) => notices.push(value), formatMoney: (n) => `¥${n}` });
notify({ me: closing, serverNow: thirteenth });
assert.equal(notices.length, 0, "login settlement belongs in the durable modal, not a duplicate toast");
const list = { innerHTML: "", querySelector: () => null };
const originalDocument = globalThis.document;
const roots = new Map();
const actions = new Map();
let uiPlayer = p;
function fakeElement() {
  const element = {
    ownerDocument: null, innerHTML: "", hidden: false,
    addEventListener() {}, removeEventListener() {}, focus() {},
    querySelectorAll: () => [], contains: () => false,
    getAttribute: () => null,
    remove() { roots.delete(this.id); },
    querySelector(selector) {
      if (selector === '[data-employee-payroll-info-body]') return this.content || null;
      if (selector === '[role="dialog"]' || selector === '.employee-payroll-info-modal') return this.dialog || null;
      if (selector === '.workforce-payroll-history') return this.history || this.content?.history || null;
      return null;
    }
  };
  let html = "";
  Object.defineProperty(element, "innerHTML", {
    get: () => html,
    set(value) {
      html = value;
      if (value.includes("data-employee-payroll-info-body")) {
        element.content = fakeElement();
        element.dialog = fakeElement();
      }
      element.history = value.includes('class="workforce-payroll-history"')
        ? { open: /class="workforce-payroll-history"\s+open/.test(value) } : null;
    }
  });
  element.ownerDocument = globalThis.document;
  return element;
}
globalThis.document = {
  activeElement: null,
  querySelector: () => null,
  getElementById: (id) => roots.get(id) || null,
  createElement: () => fakeElement(),
  addEventListener() {}, removeEventListener() {},
  body: { appendChild: (root) => roots.set(root.id, root) }
};
try {
  bindFormatDeps({ getNowMs: () => thirteenth });
  p.employeePayroll.history[0].entries[0].workerName = "<img>";
  initHireModule({ socket: {}, getState: () => ({ me: uiPlayer }), els: { ownedWorkerList: list },
    registerAction: (name, handler) => actions.set(name, handler),
    helpers: { formatMoney: (n) => `¥${n}`, escapeHtml: (s) => String(s).replaceAll("<", "&lt;").replaceAll(">", "&gt;") } });
  renderOwnedWorkers();
  assert.doesNotMatch(list.innerHTML, /workforce-payroll-note|workforce-payroll-history/);
  assert.equal(roots.size, 0, "roster refresh does not open the explanation");
  actions.get("openEmployeePayrollInfo")();
  const root = roots.get("employee-payroll-info-root");
  const body = root.querySelector('[data-employee-payroll-info-body]');
  assert.match(body.innerHTML, /登录日记薪/);
  assert.match(body.innerHTML, /离线日期不计薪/);
  assert.match(body.innerHTML, /&lt;img&gt;/);
  assert.doesNotMatch(body.innerHTML, /每日 00:00|宽限24小时|<img>/);
  body.querySelector(".workforce-payroll-history").open = true;
  p.cash = 12345;
  renderOwnedWorkers();
  assert.match(body.innerHTML, /当前现金 ¥12345/);
  assert.equal(body.querySelector(".workforce-payroll-history").open, true, "history stays expanded during live refresh");
  actions.get("closeEmployeePayrollInfo")();
  assert.equal(roots.has("employee-payroll-info-root"), false);
  uiPlayer = player();
  uiPlayer.workshop.workers = [];
  renderOwnedWorkers();
  assert.match(list.innerHTML, /花名册还是空的/);
  assert.doesNotMatch(list.innerHTML, /workforce-payroll-note/);
  actions.get("openEmployeePayrollInfo")();
  assert.match(roots.get("employee-payroll-info-root").querySelector('[data-employee-payroll-info-body]').innerHTML,
    /登录日记薪/, "explanation is available with an empty roster");
  actions.get("closeEmployeePayrollInfo")();
} finally {
  globalThis.document = originalDocument;
  bindFormatDeps({ getNowMs: () => Date.now() });
}
console.log("employee-payroll-smoke: login dates, snapshots, same-day dedupe, dismissal, migration and UI ok");
