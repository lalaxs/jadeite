import { employeePayrollStatus } from "./worker-economy.js";

export function payrollWorkNotice(me, { now = Date.now(), formatMoney }) {
  if (employeePayrollStatus(me, now) !== "stopped") return "";
  return `<div class="workforce-payroll-note is-short" role="status">
    <strong>员工已停工</strong>
    <p>欠薪 ${formatMoney(me.employeePayroll?.debt || 0)}，停工期间不新增工资。已有任务继续完成；结清欠薪后请在员工页主动复工。</p>
    <button type="button" data-view-link="hireMarket">前往补薪与复工</button>
  </div>`;
}
