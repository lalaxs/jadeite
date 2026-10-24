// Top HUD + rating popover (moved from main.js)

import {
  formatMoney,
  formatMoneyCompact,
  formatNumber,
  formatDuration,
  nowMs,
  escapeHtml
} from "../../shell/format-utils.js";
import { animateNumber } from "../../shell/toast-fx.js";
import {
  CUSTOMER_RATING_PUBLIC_MIN_SAMPLES,
  customerRatingScore,
  customerRatingSampleTotal,
  customerRatingStarProgress,
  customerRatingStarsFromScore,
  customerRatingTierInfo,
  isCustomerRatingPublic,
  sourceLabel
} from "../../metric-history.js";
import { playerExpProgress } from "../../player-progression.js";

let getState = () => null;
let getEls = () => null;
let auctionPhaseMeta = () => ({ remain: 0 });
let openBillView = (_opts) => {};
let hudPrev = { cash: null, rep: null };

export function bindTopHudDeps(deps = {}) {
  if (typeof deps.getState === "function") getState = deps.getState;
  if (typeof deps.getEls === "function") getEls = deps.getEls;
  if (typeof deps.auctionPhaseMeta === "function") auctionPhaseMeta = deps.auctionPhaseMeta;
  if (typeof deps.openBillView === "function") openBillView = deps.openBillView;
}

export function tickHudClock(now = nowMs()) {
  const els = getEls();

  if (!els.topHud) return;
  const clockEl = els.topHud.querySelector('[data-hud="clock"]');
  if (clockEl) clockEl.textContent = formatDuration(auctionPhaseMeta(undefined, now).remain);
}

export function clientBmRatingSamples(me) {
  const state = getState();

  const fromCounter = Number(me?.bmRatingSampleCount) || 0;
  const fromService = (state?.blackServiceOrders || []).filter(
    (order) => order.isSeller && order.buyerRating?.stars
  ).length;
  return fromCounter + fromService;
}

export function starsGlyphHtml(n, { ghost = false } = {}) {
  if (ghost) {
    return `<span class="hud-stars is-ghost" aria-hidden="true">☆☆☆☆☆</span>`;
  }
  let s = "";
  for (let i = 1; i <= 5; i++) s += i <= n ? "★" : "☆";
  return `<span class="hud-stars">${s}</span>`;
}
export function closeHudRatingPopover() {
  const els = getEls();

  const pop = els.hudRatingPopover || document.querySelector("#hudRatingPopover");
  if (!pop) return;
  pop.classList.add("is-hidden");
  pop.hidden = true;
  pop.innerHTML = "";
  document.querySelector("#hudRatingStat")?.setAttribute("aria-expanded", "false");
}

export function formatHudRatingTime(at) {
  const ts = Number(at) || 0;
  if (!ts) return "—";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function renderHudRatingPopover() {
  const state = getState();
  const els = getEls();

  const pop = els.hudRatingPopover || document.querySelector("#hudRatingPopover");
  const anchor = document.querySelector("#hudRatingStat");
  const me = state?.me;
  if (!pop || !anchor || !me) return;

  const bmSamples = clientBmRatingSamples(me);
  const visible = isCustomerRatingPublic(me, bmSamples);
  const score = customerRatingScore(me);
  const progress = customerRatingStarProgress(score);
  const tier = customerRatingTierInfo(score);
  const history = [...(me.ratingHistory || [])]
    .filter((entry) => entry.source !== "bm_buyer_credit")
    .sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))
    .slice(0, 5);

  let body;
  if (!visible) {
    const samples = customerRatingSampleTotal(me, bmSamples);
    body = `
      <p class="hud-rating-pop-empty">评分人数不足，暂未开分。</p>
      <p class="hud-rating-pop-hint">当前进度 ${samples}/${CUSTOMER_RATING_PUBLIC_MIN_SAMPLES}；订单评价与黑市买家评价合计满 ${CUSTOMER_RATING_PUBLIC_MIN_SAMPLES} 人后公开。</p>
    `;
  } else {
    const nextLine = progress.nextStars == null
      ? "已达最高 5 星"
      : `距 ${progress.nextStars} 星还差约 ${progress.remain} 分（门槛 ${progress.nextAt}）`;
    const orderSat = me.orderSat == null || me.orderSat === "" ? "—" : `${Math.round(me.orderSat)}%`;
    const bmSat = me.bmSat == null || me.bmSat === "" ? "—" : `${Math.round(me.bmSat)}%`;
    const rows = history.length
      ? history.map((entry) => {
        const delta = Number(entry.delta) || 0;
        const sign = delta > 0 ? `+${delta}` : `${delta}`;
        const tone = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
        const tag = entry.reasonTag ? ` · ${entry.reasonTag}` : "";
        return `<li class="hud-rating-pop-row is-${tone}">
          <span>${escapeHtml(formatHudRatingTime(entry.at))}</span>
          <span>${escapeHtml(sourceLabel(entry.source, "satisfaction") || entry.note || "变动")}${escapeHtml(tag)}</span>
          <b>${sign}</b>
        </li>`;
      }).join("")
      : `<li class="hud-rating-pop-row is-flat"><span>暂无明细</span></li>`;
    body = `
      <div class="hud-rating-pop-score">
        ${starsGlyphHtml(progress.stars || 0)}
        <strong>${score}%</strong>
        <i class="hud-rating-pop-title">${escapeHtml(tier.title)}</i>
      </div>
      <p class="hud-rating-pop-hint">${escapeHtml(nextLine)}</p>
      <div class="hud-rating-pop-tracks">
        <span>订单轨 ${escapeHtml(orderSat)}</span>
        <span>黑市轨 ${escapeHtml(bmSat)}</span>
      </div>
      <ul class="hud-rating-pop-list">${rows}</ul>
    `;
  }

  pop.innerHTML = `
    <div class="hud-rating-pop-card">
      <div class="hud-rating-pop-head">
        <strong>客户评级</strong>
        <button type="button" class="hud-rating-pop-close" data-hud-rating-close aria-label="关闭">×</button>
      </div>
      ${body}
      <button type="button" class="secondary hud-rating-pop-link" data-hud-rating-open-bill>查看明细</button>
    </div>
  `;
  pop.classList.remove("is-hidden");
  pop.hidden = false;
  anchor.setAttribute("aria-expanded", "true");

  const rect = anchor.getBoundingClientRect();
  const pad = 8;
  const width = Math.min(280, window.innerWidth - pad * 2);
  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(pad, Math.min(left, window.innerWidth - width - pad));
  let top = rect.bottom + 8;
  pop.style.width = `${width}px`;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  const popRect = pop.getBoundingClientRect();
  if (popRect.bottom > window.innerHeight - pad) {
    top = Math.max(pad, rect.top - popRect.height - 8);
    pop.style.top = `${top}px`;
  }
}

export function toggleHudRatingPopover() {
  const els = getEls();

  const pop = els.hudRatingPopover || document.querySelector("#hudRatingPopover");
  if (!pop) return;
  if (!pop.hidden && !pop.classList.contains("is-hidden")) {
    closeHudRatingPopover();
    return;
  }
  renderHudRatingPopover();
}

export function bindHudRatingPopoverOnce() {
  const els = getEls();

  if (bindHudRatingPopoverOnce.bound) return;
  bindHudRatingPopoverOnce.bound = true;
  document.addEventListener("click", (event) => {
    const openBill = event.target.closest?.("[data-hud-rating-open-bill]");
    if (openBill) {
      closeHudRatingPopover();
      openBillView({ metric: "satisfaction" });
      return;
    }
    if (event.target.closest?.("[data-hud-rating-close]")) {
      closeHudRatingPopover();
      return;
    }
    if (event.target.closest?.("#hudRatingStat")) {
      event.preventDefault();
      toggleHudRatingPopover();
      return;
    }
    const pop = els.hudRatingPopover || document.querySelector("#hudRatingPopover");
    if (pop && !pop.hidden && !pop.contains(event.target)) {
      closeHudRatingPopover();
    }
  });
  window.addEventListener("resize", () => {
    const pop = els.hudRatingPopover || document.querySelector("#hudRatingPopover");
    if (pop && !pop.hidden) renderHudRatingPopover();
  });
}

export function renderTopHud() {
  const state = getState();
  const els = getEls();

  if (!els.topHud || !state?.me) return;
  const { me } = state;
  const rep = Number(me.rep || 0);
  const level = Number(me.level) || playerExpProgress(me.exp).level;
  const repTitle = repTier(rep);
  const bmSamples = clientBmRatingSamples(me);
  const hasCustomerRating = isCustomerRatingPublic(me, bmSamples);
  const ratingSamples = customerRatingSampleTotal(me, bmSamples);
  const satisfaction = customerRatingScore(me) ?? 0;
  const rating = customerRatingStarsFromScore(satisfaction) ?? 0;
  const ratingLabel = hasCustomerRating
    ? `客户评级：${Math.round(satisfaction)}分`
    : `暂未开分 · ${ratingSamples}/${CUSTOMER_RATING_PUBLIC_MIN_SAMPLES}`;
  const countdown = formatDuration(auctionPhaseMeta().remain);

  const ratingHtml = hasCustomerRating
    ? starsGlyphHtml(rating)
    : `<span class="hud-rating-empty" title="评分人数不足，暂未开分">
        ${starsGlyphHtml(0, { ghost: true })}
      </span>`;

  const ico = {
    cash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 8.5l3.5 4 3.5-4M12 12.5V16M9.5 14h5"/></svg>',
    rep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="5"/><path d="M9 13l-1.5 7L12 18l4.5 2L15 13"/></svg>',
    star: hasCustomerRating
      ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17.8 5.9 20.4l1.5-6.8L2.2 9l6.9-.7z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.6 7.2 18.1l.9-5.4-3.9-3.8 5.4-.8z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  };

  els.topHud.innerHTML = `
    <div class="hud-stat is-gold" id="hudCashStat" title="现金 ${formatMoney(me.cash)}">
      <span class="hud-ico">${ico.cash}</span>
      <div class="hud-meta"><b data-hud="cash">${formatMoneyCompact(me.cash)}</b><span>现金</span></div>
    </div>
    <div class="hud-stat is-jade" id="hudRepStat">
      <span class="hud-ico">${ico.rep}</span>
      <div class="hud-meta">
        <div class="hud-rep-row"><b data-hud="rep">${formatNumber(rep)}</b><i class="hud-rep-title">${escapeHtml(repTitle)}</i></div>
        <span>声望</span>
      </div>
    </div>
    <button type="button" class="hud-stat${hasCustomerRating ? " is-rating-active" : " is-rating-empty"}" id="hudRatingStat" aria-expanded="false" aria-controls="hudRatingPopover" title="查看客户评级详情">
      <span class="hud-ico">${ico.star}</span>
      <div class="hud-meta"><b>${ratingHtml}</b><span>${escapeHtml(ratingLabel)}</span></div>
    </button>
    <div class="hud-stat is-muted">
      <span class="hud-ico">${ico.clock}</span>
      <div class="hud-meta"><b data-hud="clock">${countdown}</b><span>公盘结束</span></div>
    </div>
  `;
  const cashEl = els.topHud.querySelector('[data-hud="cash"]');
  const repEl = els.topHud.querySelector('[data-hud="rep"]');
  const newCash = Number(me.cash || 0);
  if (cashEl) cashEl.title = `现金 ${formatMoney(newCash)}`;
  animateNumber(cashEl, hudPrev.cash ?? newCash, newCash, (v) => formatMoneyCompact(Math.round(v)));
  animateNumber(repEl, hudPrev.rep ?? rep, rep, (v) => formatNumber(Math.round(v)));
  hudPrev.cash = newCash;
  hudPrev.rep = rep;
  bindHudRatingPopoverOnce();
  const pop = els.hudRatingPopover || document.querySelector("#hudRatingPopover");
  if (pop && !pop.hidden) renderHudRatingPopover();
}

export function repTier(rep) {
  if (rep >= 320) return "宗师";
  if (rep >= 160) return "名店";
  if (rep >= 80) return "熟行";
  if (rep >= 30) return "起势";
  return "新人";
}
