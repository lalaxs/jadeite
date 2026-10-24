// Player card + sidebar (moved from main.js)

import { formatNumber, escapeHtml } from "../../shell/format-utils.js";
import { playerExpProgress } from "../../player-progression.js";

let getState = () => null;
let getEls = () => null;
let inventoryCounts = () => ({});
let reminderRows = () => [];
let reminderCardHtml = () => "";

export function bindPlayerCardDeps(deps = {}) {
  if (typeof deps.getState === "function") getState = deps.getState;
  if (typeof deps.getEls === "function") getEls = deps.getEls;
  if (typeof deps.inventoryCounts === "function") inventoryCounts = deps.inventoryCounts;
  if (typeof deps.reminderRows === "function") reminderRows = deps.reminderRows;
  if (typeof deps.reminderCardHtml === "function") reminderCardHtml = deps.reminderCardHtml;
}

export function renderPlayerCard() {
  const state = getState();
  const els = getEls();

  if (!els.playerCard || !state?.me) return;
  const { me } = state;
  const progress = playerExpProgress(me.exp);
  const initial = (me.name || "翠").trim().charAt(0) || "翠";

  els.playerCard.innerHTML = `
    <div class="player-id">
      <div class="avatar" data-avatar-slot="player" title="头像占位（后续接入头像）">
        <span class="ph">${escapeHtml(initial)}</span>
        <span class="avatar-lv" title="经营等级">Lv.${progress.level}</span>
      </div>
      <div class="player-meta">
        <div class="player-name">${escapeHtml(me.name || "无名")}</div>
      </div>
    </div>
    <div class="exp">
      <div class="exp-top"><span>经验</span><b>${progress.maxed ? "已满级" : `${formatNumber(progress.current)}/${formatNumber(progress.span)}`}</b></div>
      <div class="exp-bar"><i class="${progress.maxed ? "done" : ""}" style="width:${progress.pct}%"></i></div>
    </div>
  `;
}

export function renderPlayerSidebar() {
  const state = getState();
  const els = getEls();

  if (!els.sidebarStatus || !state?.me) return;
  const { me } = state;
  const counts = inventoryCounts(me);
  const reminders = reminderRows();
  els.sidebarStatus.innerHTML = `
    <div class="sidebar-block">
      <p class="eyebrow">库存</p>
      <div class="inventory-mini">
        <span>暗料 ${counts.sealed}</span>
        <span>加工 ${counts.jobs}</span>
        <span>明料 ${counts.revealed}</span>
        <span>成品 ${counts.products}</span>
        <span>藏品 ${counts.collection}</span>
      </div>
    </div>
    <div class="sidebar-block">
      <p class="eyebrow">提醒</p>
      <div class="reminder-list">
        ${reminders.map(reminderCardHtml).join("") || `<div class="reminder-row"><strong>暂无急事</strong><span>可以看看公盘或账房</span></div>`}
      </div>
    </div>
  `;
}

export function starsHtml(n, max = 5) {
  let s = "";
  for (let i = 1; i <= max; i++) s += i <= n ? "★" : '<span class="off">★</span>';
  return `<span class="mini-stars">${s}</span>`;
}
