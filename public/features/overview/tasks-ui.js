// Daily tasks panel (moved from main.js)

import { formatMoney, formatCountdown, nowMs, escapeHtml, empty } from "../../shell/format-utils.js";
import { rewardCashQuote } from "../../../shared/domain/economy/new-player-economy.js";

let getState = () => null;
let getEls = () => null;

export const TASK_RESET_COSTS = Object.freeze([0, 1000, 2000, 4000]);
export const TASK_RESET_COST = 1000;

export function taskResetCostForCount(count = 0) {
  const index = Math.max(0, Math.round(Number(count) || 0));
  return TASK_RESET_COSTS[Math.min(index, TASK_RESET_COSTS.length - 1)];
}

export function bindTasksUiDeps(deps = {}) {
  if (typeof deps.getState === "function") getState = deps.getState;
  if (typeof deps.getEls === "function") getEls = deps.getEls;
}

export function taskStatusLabel(status) {
  if (status === "complete") return "可领取";
  if (status === "claimed") return "已领取";
  return "进行中";
}

export function taskCardHtml(task, resetCost = TASK_RESET_COST) {
  const cashReward = task.status === "claimed" ? (task.grantedReward ?? task.reward)
    : rewardCashQuote(getState()?.me, task.reward, "taskReward", nowMs());
  const status = task.status;
  const claimed = status === "claimed";
  const complete = status === "complete";
  const rowCls = claimed ? " is-claimed" : (complete ? " is-ready" : "");
  const resetLabel = resetCost > 0 ? `${formatMoney(resetCost)} 重置` : "免费重置";
  const resetBtn = status === "active"
    ? `<button class="task-btn task-reset" data-task-action="reset" data-reset-cost="${resetCost}" data-uid="${escapeHtml(task.uid)}">${resetLabel}</button>`
    : `<button class="task-btn task-reset is-disabled" disabled>已结束</button>`;
  let rightBtn;
  if (claimed) {
    rightBtn = `<button class="task-btn task-claim is-disabled" disabled>已领取</button>`;
  } else if (complete) {
    rightBtn = `<button class="task-btn task-claim" data-task-action="claim" data-uid="${escapeHtml(task.uid)}">领取</button>`;
  } else {
    rightBtn = `<button class="task-btn task-go" data-task-action="go" data-view="${escapeHtml(task.view)}">前往</button>`;
  }
  return `
    <article class="task-card${rowCls}">
      <div class="task-card-body">
        <div class="task-card-top">
          <div class="task-card-titles">
            <p class="task-card-title">${escapeHtml(task.title)}</p>
            <p class="task-card-desc">${escapeHtml(task.desc)}</p>
          </div>
          <span class="task-status ${status}">${taskStatusLabel(status)}</span>
        </div>
        <div class="task-card-meta">
          <span>进度：<b>${Number(task.progress || 0)}/${task.target}</b></span>
          <div class="reward-chips task-reward-chips" aria-label="奖励">
            ${task.reward ? `<span class="reward-chip is-cash" title="现金奖励受每日及新手预算限制">¥ ${escapeHtml(String(Number(cashReward).toLocaleString("zh-CN")))}</span>` : ""}
            ${task.exp ? `<span class="reward-chip is-exp" title="+经验 ${Number(task.exp)}">经验 × ${Number(task.exp)}</span>` : ""}
          </div>
        </div>
        <div class="task-card-actions">
          ${resetBtn}
          ${rightBtn}
        </div>
      </div>
    </article>
  `;
}

export function renderTasks() {
  const state = getState();
  const els = getEls();

  if (!els.homeTaskPane || !state?.me) return;
  const { me } = state;
  const tasks = me.tasks || [];
  const resetCost = taskResetCostForCount(me.taskResetCount);
  const done = tasks.filter((t) => t.status === "claimed").length;
  const nextIn = Math.max(0, (me.taskRefreshedAt || nowMs()) + (me.taskRefreshMs || 21600000) - nowMs());
  els.homeTaskPane.innerHTML = `
    <div class="task-head">
      <div class="task-head-main">
        <div class="task-head-ico">
          <svg width="18" height="18" fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        </div>
        <div>
          <p class="task-head-title">每日任务</p>
          <p class="task-head-sub" id="taskCountdown">下次刷新：${formatCountdown(nextIn)}</p>
          <p class="task-head-sub">日课现金每日上限 ¥1,000；首次引导期与成就共享 ¥1,000 现金预算，经验照常领取。</p>
        </div>
      </div>
      <span class="task-done-pill">已完成 ${done}/${tasks.length}</span>
    </div>
    <div class="task-list">
      ${tasks.length ? tasks.map((task) => taskCardHtml(task, resetCost)).join("") : empty("暂无任务，等待刷新")}
    </div>
  `;
}

export function updateTaskCountdown() {
  const state = getState();

  const el = document.getElementById("taskCountdown");
  if (!el || !state?.me) return;
  const nextIn = Math.max(0, (state.me.taskRefreshedAt || nowMs()) + (state.me.taskRefreshMs || 21600000) - nowMs());
  el.textContent = `下次刷新：${formatCountdown(nextIn)}`;
}
