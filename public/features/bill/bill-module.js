// bill-module.js — 主页账单（金额）+ 客户评级：时间分段 / 来源下拉 / 弱摘要
import {
  BILL_GRAINS,
  BILL_SOURCE_FILTERS,
  CUSTOMER_RATING_PUBLIC_MIN_SAMPLES,
  aggregateBillPeriods,
  customerRatingSampleTotal,
  customerRatingScore,
  customerRatingStarsFromScore,
  filterEntriesByRange,
  filterEntriesBySource,
  getBillEntries,
  isCustomerRatingPublic,
  mergePeriodRollups,
  monthBounds,
  monthKey,
  pendingCashHint,
  sourceLabel,
  summarizeEntries,
  yearBounds,
  yearKey
} from "../../metric-history.js";

let getState;
let elsRef;
let helpers = {};
let openHomeOverview = null;
let bound = false;

function makePanelUi(metric) {
  return {
    metric,
    grain: "detail",
    source: "all",
    sourceOpen: false,
    rangeKey: null,
    rangeGrain: null
  };
}

const panels = {
  bill: makePanelUi("cash"),
  credit: makePanelUi("satisfaction")
};

export function initBillModule(deps) {
  getState = deps.getState;
  elsRef = deps.els;
  helpers = deps.helpers || {};
  openHomeOverview = typeof deps.openHomeOverview === "function" ? deps.openHomeOverview : null;
  bindBillOnce();
}

/** Programmatic open — used by 经营账房深链等. */
export function openBillView(opts = {}) {
  const wantCredit = opts.metric === "satisfaction";
  const ui = wantCredit ? panels.credit : panels.bill;
  ui.metric = wantCredit ? "satisfaction" : "cash";
  if (opts.grain) ui.grain = opts.grain;
  if (opts.source != null) ui.source = opts.source;
  if (Object.prototype.hasOwnProperty.call(opts, "rangeKey")) ui.rangeKey = opts.rangeKey;
  if (Object.prototype.hasOwnProperty.call(opts, "rangeGrain")) ui.rangeGrain = opts.rangeGrain;
  if (opts.sourceOpen != null) ui.sourceOpen = Boolean(opts.sourceOpen);
  if (opts.thisMonth) {
    ui.grain = "detail";
    ui.rangeKey = monthKey(Date.now());
    ui.rangeGrain = "month";
    ui.source = opts.source || "all";
    ui.sourceOpen = false;
  }
  if (typeof openHomeOverview === "function") openHomeOverview(wantCredit ? "credit" : "bill");
  if (wantCredit) renderCredit();
  else renderBill();
}

function escapeHtml(value) {
  return helpers.escapeHtml ? helpers.escapeHtml(value) : String(value ?? "");
}

function formatMoney(value) {
  return helpers.formatMoney ? helpers.formatMoney(value) : `¥${Math.round(Number(value) || 0).toLocaleString("zh-CN")}`;
}

function formatNumber(value) {
  return helpers.formatNumber
    ? helpers.formatNumber(value)
    : Math.round(Number(value) || 0).toLocaleString("zh-CN");
}

function formatAbs(metric, value) {
  const abs = Math.abs(Number(value) || 0);
  if (metric === "cash") return formatMoney(abs);
  return formatNumber(abs);
}

function formatDelta(metric, delta) {
  const n = Number(delta) || 0;
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${formatAbs(metric, n)}`;
}

function formatBalance(metric, value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  if (metric === "cash") return formatMoney(value);
  return formatNumber(value);
}

function formatBillTime(at) {
  const ts = Number(at) || 0;
  if (!ts) return "—";
  const d = new Date(ts);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `今天 ${hm}`;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `昨天 ${hm}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

function naturalVisibleText(value, fallback = "暂无") {
  const cleaned = String(value ?? "")
    .replace(/\bLv\.?\s*(\d+)/gi, "等级 $1")
    .replace(/\bT\s*(\d+)/g, "$1 阶")
    .replace(/\bkg\b/gi, "千克")
    .replace(/\{[^{}]*\}/g, "")
    .replace(/[A-Za-z_][A-Za-z0-9_.-]*/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s·,，。:：;；/|()-]+|[\s·,，。:：;；/|()-]+$/g, "")
    .trim();
  return cleaned || fallback;
}

function customerRatingGate(player) {
  const blackMarketSamples = Math.max(0, Math.round(Number(player?.bmRatingSampleCount) || 0));
  const count = customerRatingSampleTotal(player, blackMarketSamples);
  const opened = isCustomerRatingPublic(player, blackMarketSamples);
  const score = opened ? customerRatingScore(player) : null;
  const stars = opened ? customerRatingStarsFromScore(score) : null;
  return { count, opened, score, stars };
}

function ratingStarsHtml(gate, compact = false) {
  if (!gate.opened) {
    return `<span class="credit-stars is-locked${compact ? " compact" : ""}" aria-label="评分尚未开放">☆☆☆☆☆</span>`;
  }
  let glyphs = "";
  for (let index = 1; index <= 5; index += 1) glyphs += index <= gate.stars ? "★" : "☆";
  return `<span class="credit-stars${compact ? " compact" : ""}" aria-label="${gate.score} 分，${gate.stars} 星">${glyphs}</span>`;
}

function ratingOverviewHtml(gate) {
  return `<section class="credit-overview ${gate.opened ? "is-open" : "is-locked"}">
    <div class="credit-overview-score">${ratingStarsHtml(gate)}<strong>${gate.opened ? `${gate.score} 分` : "评分人数不足，暂未开分"}</strong></div>
    <div class="credit-overview-meta">
      <span>${gate.opened ? `${gate.count} 人已评价` : `评价进度 ${gate.count}/${CUSTOMER_RATING_PUBLIC_MIN_SAMPLES}`}</span>
      <small>累计满 ${CUSTOMER_RATING_PUBLIC_MIN_SAMPLES} 位客户后，同时公开分数与星级。</small>
    </div>
  </section>`;
}

function directionLabel(metric, delta) {
  const n = Number(delta) || 0;
  if (metric === "cash") return n >= 0 ? "收入" : "支出";
  if (n > 0) return "上升";
  if (n < 0) return "下降";
  return "持平";
}

function activeRange(ui) {
  if (!ui.rangeKey) return { since: 0, until: Infinity, label: null };
  if (ui.rangeGrain === "year") {
    const b = yearBounds(ui.rangeKey);
    return { ...b, label: `${ui.rangeKey} 年` };
  }
  const b = monthBounds(ui.rangeKey);
  return { ...b, label: ui.rangeKey };
}

function effectiveSource(ui) {
  return ui.grain === "detail" ? ui.source : "all";
}

function entriesForView(player, ui) {
  const all = getBillEntries(player, ui.metric);
  const { since, until } = activeRange(ui);
  const ranged = filterEntriesByRange(all, since, until);
  return filterEntriesBySource(ranged, ui.metric, effectiveSource(ui));
}

function emptyCopy(metric) {
  return {
    cash: "暂无金额流水。买卖、工坊与订单结算后会显示在这里。",
    satisfaction: "尚无客户评级记录。"
  }[metric] || "暂无记录。";
}

function sourceFilterLabel(metric, sourceId) {
  const filters = BILL_SOURCE_FILTERS[metric] || [];
  return filters.find((item) => item.id === sourceId)?.label || "全部";
}

function panelKeyFromTarget(target) {
  if (target?.closest?.("#homeCreditPane")) return "credit";
  return "bill";
}

function bindPaneClicks(pane) {
  if (!pane) return;
  pane.addEventListener("click", (event) => {
    const key = panelKeyFromTarget(event.target);
    const ui = panels[key];
    const inSourceDd = Boolean(event.target.closest(".bill-source-dd"));
    const grainBtn = event.target.closest("[data-bill-grain]");
    if (grainBtn) {
      ui.grain = grainBtn.dataset.billGrain;
      if (ui.grain !== "detail") {
        ui.rangeKey = null;
        ui.rangeGrain = null;
        ui.source = "all";
        ui.sourceOpen = false;
      } else {
        ui.sourceOpen = false;
      }
      renderPanel(key);
      return;
    }
    const sourceToggle = event.target.closest("[data-bill-source-toggle]");
    if (sourceToggle) {
      event.stopPropagation();
      ui.sourceOpen = !ui.sourceOpen;
      renderPanel(key);
      return;
    }
    const sourceBtn = event.target.closest("[data-bill-source]");
    if (sourceBtn) {
      event.stopPropagation();
      ui.source = sourceBtn.dataset.billSource || "all";
      ui.sourceOpen = false;
      renderPanel(key);
      return;
    }
    const periodBtn = event.target.closest("[data-bill-period]");
    if (periodBtn) {
      const periodKey = periodBtn.dataset.billPeriod;
      const grain = periodBtn.dataset.billPeriodGrain;
      if (grain === "year") {
        ui.rangeKey = periodKey;
        ui.rangeGrain = "year";
        ui.grain = "month";
      } else {
        ui.rangeKey = periodKey;
        ui.rangeGrain = "month";
        ui.grain = "detail";
      }
      ui.sourceOpen = false;
      renderPanel(key);
      return;
    }
    const backBtn = event.target.closest("[data-bill-back]");
    if (backBtn) {
      if (ui.grain === "detail" && ui.rangeGrain === "month") {
        if (ui.rangeKey) {
          ui.rangeKey = yearKey(monthBounds(ui.rangeKey).since);
          ui.rangeGrain = "year";
          ui.grain = "month";
        } else {
          ui.rangeKey = null;
          ui.rangeGrain = null;
          ui.grain = "month";
        }
      } else if (ui.grain === "month" && ui.rangeGrain === "year") {
        ui.rangeKey = null;
        ui.rangeGrain = null;
        ui.grain = "year";
      } else {
        ui.rangeKey = null;
        ui.rangeGrain = null;
        ui.grain = "detail";
      }
      ui.sourceOpen = false;
      renderPanel(key);
      return;
    }
    if (ui.sourceOpen && !inSourceDd) {
      ui.sourceOpen = false;
      renderPanel(key);
    }
  });
}

function closeOpenSourceMenus(exceptKey = null) {
  for (const key of Object.keys(panels)) {
    if (exceptKey && key === exceptKey) continue;
    const ui = panels[key];
    if (!ui?.sourceOpen) continue;
    ui.sourceOpen = false;
    renderPanel(key);
  }
}

function bindBillOnce() {
  if (bound) return;
  bound = true;
  bindPaneClicks(elsRef?.homeBillPane);
  bindPaneClicks(elsRef?.homeCreditPane);
  const doc = typeof document !== "undefined" ? document : null;
  if (!doc?.addEventListener) return;
  doc.addEventListener("click", (event) => {
    // 面板内操作会 re-render，点击目标会脱离 DOM；此时不要当成「点外部」关掉
    if (!event.target?.isConnected) return;
    if (event.target.closest?.(".bill-source-dd")) return;
    for (const key of Object.keys(panels)) {
      const ui = panels[key];
      if (!ui.sourceOpen) continue;
      const pane = paneForKey(key);
      if (pane && pane.contains(event.target)) continue;
      ui.sourceOpen = false;
      renderPanel(key);
    }
  });
  doc.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeOpenSourceMenus();
  });
}

function grainSegmentHtml(activeId) {
  return `
    <div class="bill-grain-seg" role="group" aria-label="账单粒度">
      ${BILL_GRAINS.map((item) =>
        `<button type="button" class="${item.id === activeId ? "on" : ""}" data-bill-grain="${item.id}" aria-pressed="${item.id === activeId}">${escapeHtml(item.label)}</button>`
      ).join("")}
    </div>
  `;
}

function sourceFilterHtml(ui) {
  if (ui.grain !== "detail") return "";
  const filters = BILL_SOURCE_FILTERS[ui.metric] || [];
  if (filters.length <= 1) return "";
  const label = sourceFilterLabel(ui.metric, ui.source);
  const filtered = ui.source && ui.source !== "all";
  return `
    <div class="bill-source-dd${ui.sourceOpen ? " is-open" : ""}${filtered ? " is-filtered" : ""}">
      <button type="button"
        class="bill-source-trigger${filtered || ui.sourceOpen ? " is-active" : ""}"
        data-bill-source-toggle
        aria-haspopup="listbox"
        aria-expanded="${ui.sourceOpen ? "true" : "false"}"
        aria-label="筛选来源">
        <span class="bill-source-value">${escapeHtml(label)}</span>
        <span class="bill-source-caret" aria-hidden="true"></span>
      </button>
      ${ui.sourceOpen ? `
        <ul class="bill-source-menu" role="listbox" aria-label="来源筛选">
          ${filters.map((item) => `
            <li role="presentation">
              <button type="button"
                class="bill-source-option${item.id === ui.source ? " on" : ""}"
                role="option"
                aria-selected="${item.id === ui.source ? "true" : "false"}"
                data-bill-source="${escapeHtml(item.id)}">
                <span class="bill-source-check" aria-hidden="true">${item.id === ui.source ? "✓" : ""}</span>
                <span>${escapeHtml(item.label)}</span>
              </button>
            </li>
          `).join("")}
        </ul>
      ` : ""}
    </div>
  `;
}

function summaryStrip(summary, metric, rangeLabel, ratingGate = null) {
  if (metric === "satisfaction" && ratingGate && !ratingGate.opened) {
    return `<div class="bill-brief credit-locked-brief" aria-label="客户评级尚未开放">
      <span>评分人数不足，暂未开分</span>
      <span class="bill-brief-sep" aria-hidden="true">·</span>
      <span>当前进度 ${ratingGate.count}/${CUSTOMER_RATING_PUBLIC_MIN_SAMPLES}</span>
      ${rangeLabel ? `<span class="bill-brief-sep" aria-hidden="true">·</span><span>${escapeHtml(rangeLabel)}</span>` : ""}
    </div>`;
  }
  const pending = metric === "cash" ? pendingCashHint(getState()?.me) : 0;
  return `
    <div class="bill-brief" aria-label="本期摘要">
      <span>净变化 <b class="${summary.net >= 0 ? "pos" : "neg"}">${escapeHtml(formatDelta(metric, summary.net))}</b></span>
      <span class="bill-brief-sep" aria-hidden="true">·</span>
      <span>增 ${escapeHtml(formatAbs(metric, summary.gain))}</span>
      <span class="bill-brief-sep" aria-hidden="true">·</span>
      <span>减 ${escapeHtml(formatAbs(metric, summary.loss))}</span>
      <span class="bill-brief-sep" aria-hidden="true">·</span>
      <span>${summary.count} 条</span>
      ${rangeLabel ? `<span class="bill-brief-sep" aria-hidden="true">·</span><span>${escapeHtml(rangeLabel)}</span>` : ""}
      ${pending > 0 ? `<span class="bill-brief-sep" aria-hidden="true">·</span><span class="bill-pending">待结算 ${escapeHtml(formatMoney(pending))}</span>` : ""}
    </div>
  `;
}

function detailRowsHtml(entries, metric) {
  if (!entries.length) {
    return `<div class="bill-empty">${escapeHtml(emptyCopy(metric))}</div>`;
  }
  if (metric === "satisfaction") return ratingReviewRowsHtml(entries);
  return `
    <div class="bill-list" role="list">
      ${entries.map((entry) => {
        const delta = Number(entry.delta) || 0;
        const tone = delta >= 0 ? "pos" : "neg";
        return `
          <article class="bill-row ${tone}" role="listitem">
            <div class="bill-row-main">
              <div class="bill-row-top">
                <b class="bill-delta">${escapeHtml(formatDelta(metric, delta))}</b>
                <span class="bill-dir">${escapeHtml(directionLabel(metric, delta))}</span>
                <span class="bill-src">${escapeHtml(sourceLabel(entry.source, metric))}</span>
              </div>
              <div class="bill-note">${escapeHtml(naturalVisibleText([
                entry.note || "",
                entry.track === "order" ? "订单轨" : entry.track === "bm" ? "黑市轨" : entry.track === "buyer" ? "买家信誉" : "",
                entry.reasonTag || ""
              ].filter(Boolean).join(" · "), "交易记录"))}</div>
            </div>
            <div class="bill-row-side">
              <time>${escapeHtml(formatBillTime(entry.at))}</time>
              <span class="bill-bal">余 ${escapeHtml(formatBalance(metric, entry.after))}</span>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function reviewScoreFromEntry(entry) {
  const exact = Number(entry?.meta?.review?.score);
  if (exact >= 1 && exact <= 5) return Math.round(exact);
  const noted = String(entry?.note || "").match(/([1-5])\s*星/);
  if (noted) return Number(noted[1]);
  const delta = Number(entry?.delta) || 0;
  if (delta >= 3) return 5;
  if (delta > 0) return 4;
  if (delta === 0) return 3;
  if (delta >= -3) return 2;
  return 1;
}

function singleReviewStars(score) {
  return `<span class="credit-stars compact" aria-label="本次评价 ${score} 分">${"★".repeat(score)}${"☆".repeat(5 - score)}</span>`;
}

function ratingReviewRowsHtml(entries) {
  if (!entries.length) return `<div class="bill-empty">${escapeHtml(emptyCopy("satisfaction"))}</div>`;
  return `<div class="credit-review-list" role="list">
    ${entries.map((entry) => {
      const review = entry?.meta?.review || {};
      const score = reviewScoreFromEntry(entry);
      const requirements = Array.isArray(review.requirements) ? review.requirements : [];
      const submitted = Array.isArray(review.submittedItems) ? review.submittedItems : [];
      const clientName = naturalVisibleText(review.clientName, entry.source === "bm_rating" ? "黑市买家" : "顾客");
      const comment = naturalVisibleText(review.comment, entry.reasonTag
        ? `客户认为本次交付存在${naturalVisibleText(entry.reasonTag, "需要改进之处")}。`
        : score >= 4 ? "客户对本次交易表示满意。" : "客户已完成本次评价。");
      return `<article class="credit-review-card" role="listitem">
        <header class="credit-review-head">
          <span class="credit-review-avatar">${escapeHtml(clientName.charAt(0) || "客")}</span>
          <div><strong>${escapeHtml(clientName)}</strong><time>${escapeHtml(formatBillTime(entry.at))}</time></div>
          <div class="credit-review-score">${singleReviewStars(score)}<span>本次评价 ${score.toFixed(1)} 分</span></div>
        </header>
        <blockquote class="credit-review-comment">
          <span class="credit-review-quote-mark" aria-hidden="true">“</span>
          <p>${escapeHtml(comment)}</p>
          <span class="credit-review-quote-mark is-closing" aria-hidden="true">”</span>
        </blockquote>
        <div class="credit-review-facts">
          <section><h4>订单具体要求</h4>${requirements.length
            ? `<ul>${requirements.map((item) => `<li>${escapeHtml(naturalVisibleText(item, "按订单要求制作"))}</li>`).join("")}</ul>`
            : `<p>${entry.source === "order_rating" ? "历史订单未记录完整要求" : "完成本次黑市交易"}</p>`}</section>
          <section><h4>玩家实际提交</h4>${submitted.length
            ? submitted.map((item) => `<p><b>${escapeHtml(naturalVisibleText(item.name, "翡翠成品"))}</b> · ${escapeHtml(naturalVisibleText(item.kind, "翡翠成品"))} · ${escapeHtml(naturalVisibleText(item.quality, "品质合格"))} · ${escapeHtml(naturalVisibleText(item.color, "天然玉色"))}</p>`).join("")
            : `<p>${entry.source === "order_rating" ? "历史订单未记录成品明细" : "黑市交易内容"}</p>`}</section>
        </div>
        <footer>${review.fit ? `<span>${escapeHtml(naturalVisibleText(review.fit, "订单已完成"))}</span>` : ""}${review.delivery ? `<span>${escapeHtml(naturalVisibleText(review.delivery, "已交付"))}</span>` : ""}</footer>
      </article>`;
    }).join("")}
  </div>`;
}

function periodRowsHtml(periods, grain, metric, ratingGate = null) {
  if (!periods.length) {
    return `<div class="bill-empty">${escapeHtml(emptyCopy(metric))}</div>`;
  }
  return `
    <div class="bill-list bill-period-list" role="list">
      ${periods.map((period) => `
        <button type="button" class="bill-row bill-period-row ${period.net >= 0 ? "pos" : "neg"}" role="listitem"
          data-bill-period="${escapeHtml(period.key)}" data-bill-period-grain="${grain}">
          <div class="bill-row-main">
            <div class="bill-row-top">
              <b class="bill-period-key">${escapeHtml(grain === "year" ? `${period.key} 年` : period.key)}</b>
              <span class="bill-delta">${metric === "satisfaction" && ratingGate && !ratingGate.opened ? "暂未开分" : escapeHtml(formatDelta(metric, period.net))}</span>
            </div>
            <div class="bill-note">${metric === "satisfaction" && ratingGate && !ratingGate.opened
              ? `评价进度 ${ratingGate.count}/${CUSTOMER_RATING_PUBLIC_MIN_SAMPLES} · ${period.count} 条记录 · 点击查看`
              : `增加 ${escapeHtml(formatAbs(metric, period.gain))} · 减少 ${escapeHtml(formatAbs(metric, period.loss))} · ${period.count} 条 · 点击查看`}</div>
          </div>
        </button>
      `).join("")}
    </div>
  `;
}

function periodSummaryForStrip(player, entries, ui) {
  if (effectiveSource(ui) !== "all") {
    return summarizeEntries(entries);
  }
  const { since, until } = activeRange(ui);
  const livePeriods = aggregateBillPeriods(entries, ui.grain);
  const merged = mergePeriodRollups(player, ui.metric, livePeriods, ui.grain, since, until);
  return merged.reduce((acc, period) => {
    acc.gain += Number(period.gain) || 0;
    acc.loss += Number(period.loss) || 0;
    acc.net += Number(period.net) || 0;
    acc.count += Number(period.count) || 0;
    return acc;
  }, { gain: 0, loss: 0, net: 0, count: 0 });
}

function paneForKey(key) {
  return key === "credit" ? elsRef?.homeCreditPane : elsRef?.homeBillPane;
}

function renderPanel(key) {
  const pane = paneForKey(key);
  const ui = panels[key];
  if (!pane || !ui) return;
  const player = getState()?.me;
  if (!player) {
    pane.innerHTML = `<div class="placeholder">连接后可查看${key === "credit" ? "客户评级" : "账单"}。</div>`;
    return;
  }

  const range = activeRange(ui);
  const entries = entriesForView(player, ui);
  const sourceId = effectiveSource(ui);
  const ratingGate = ui.metric === "satisfaction" ? customerRatingGate(player) : null;

  let body = "";
  let summary;
  if (ui.grain === "detail") {
    summary = summarizeEntries(entries);
    body = detailRowsHtml(entries, ui.metric);
  } else {
    const livePeriods = aggregateBillPeriods(entries, ui.grain);
    const periods = sourceId !== "all"
      ? livePeriods
      : mergePeriodRollups(player, ui.metric, livePeriods, ui.grain, range.since, range.until);
    summary = periodSummaryForStrip(player, entries, ui);
    body = periodRowsHtml(periods, ui.grain, ui.metric, ratingGate);
  }

  const crumb = range.label
    ? `<div class="bill-crumb">
        <button type="button" class="ghost bill-back" data-bill-back>返回</button>
        <span>${escapeHtml(range.label)}${ui.grain === "detail" ? " · 明细" : ui.grain === "month" ? " · 月账单" : ""}</span>
      </div>`
    : "";

  pane.innerHTML = `
    <section class="bill-panel" data-bill-panel="${key}">
      <div class="bill-toolbar">
        ${grainSegmentHtml(ui.grain)}
        ${sourceFilterHtml(ui)}
      </div>
      ${ratingGate ? ratingOverviewHtml(ratingGate) : ""}
      ${crumb}
      ${summaryStrip(summary, ui.metric, range.label, ratingGate)}
      ${body}
    </section>
  `;
}

export function renderBill() {
  panels.bill.metric = "cash";
  renderPanel("bill");
}

export function renderCredit() {
  panels.credit.metric = "satisfaction";
  renderPanel("credit");
}
