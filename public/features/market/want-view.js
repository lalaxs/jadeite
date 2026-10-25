import { WANT_RULES, WANT_TYPE_LABELS } from "../../jade-rules.js";
import { KIND_LABELS } from "../../jade-categories.js";
import { MARKET_QUALITY, WANT_SCORE_LABELS, KIND_OPTIONS } from "./catalog.js";

export function createMarketWantView({ getState, helpers, ports }) {
  const { formatMoney, escapeHtml } = helpers;
  const { sortOffersPreview, wantLowestOffer } = ports;

function wantRemainLabel(expiresAt) {
  const end = Number(expiresAt || 0);
  if (end <= 0) return "长期征集";
  const ms = end - Date.now();
  if (ms <= 0) return "即将结算";
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `剩余 ${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `剩余 ${hours} 小时 ${rem} 分` : `剩余 ${hours} 小时`;
}

function wantRuleLabel(want) {
  if (want.durationKey === "long") return "长期收";
  return WANT_RULES[want.rule]?.label || "价低者得";
}

function wantKindsSummary(want) {
  const type = (want.itemTypes || [])[0] || "bracelet";
  if (type === "bracelet") {
    const kinds = Array.isArray(want.acceptedKinds) ? want.acceptedKinds : [];
    const totalKinds = KIND_OPTIONS.length || 12;
    if (!kinds.length || kinds.length >= Math.max(8, Math.floor(totalKinds * 0.85))) {
      return { label: "题材", text: "不限" };
    }
    const names = kinds.map((k) => KIND_LABELS[k] || k);
    if (names.length <= 3) return { label: "题材", text: names.join("、") };
    return { label: "题材", text: `${names.slice(0, 3).join("、")} 等 ${names.length} 种` };
  }
  if (want.qualityKey && MARKET_QUALITY[want.qualityKey]) {
    return { label: "指定", text: MARKET_QUALITY[want.qualityKey].name };
  }
  return null;
}

function wantCoreChips(want) {
  const type = (want.itemTypes || [])[0] || "bracelet";
  const chips = [WANT_TYPE_LABELS[type] || type];
  const scoreLabel = WANT_SCORE_LABELS[want.minScore] || `种水≥${want.minScore}`;
  chips.push(scoreLabel);
  chips.push(wantRuleLabel(want));
  return chips.filter(Boolean).slice(0, 3);
}

function wantRequirementText(want) {
  const type = (want.itemTypes || [])[0] || "bracelet";
  const typeLabel = WANT_TYPE_LABELS[type] || type;
  const scoreLabel = WANT_SCORE_LABELS[want.minScore] || `种水≥${want.minScore}`;
  const parts = [`${typeLabel} · ${scoreLabel}`, `预算 ≤ ${formatMoney(want.budget)}`];
  if (type === "bracelet" && (want.acceptedKinds || []).length) {
    parts.push(`题材：${want.acceptedKinds.map((k) => KIND_LABELS[k] || k).join("、")}`);
  } else if (want.qualityKey && MARKET_QUALITY[want.qualityKey]) {
    parts.push(`指定：${MARKET_QUALITY[want.qualityKey].name}`);
  }
  if (want.note) parts.push(want.note);
  return parts.join(" · ");
}

function wantCardHtml(w) {
  const meId = getState().me?.id;
  const isOwner = w.ownerId === meId;
  const isManual = w.rule === "manual";
  const myOffer = (w.offers || []).find((o) => o.sellerId === meId);
  const lowest = wantLowestOffer(w);
  const offerCount = (w.offers || []).length;
  const chips = wantCoreChips(w);
  const kinds = wantKindsSummary(w);
  const offersHtml = isOwner && offerCount
    ? `<div class="jm-want-offers">${sortOffersPreview(w.offers).map((o, i) => `
        <div class="jm-want-offer ${!isManual && i === 0 ? "is-lead" : ""}">
          <span>${escapeHtml(o.item?.name || "货品")} · ${escapeHtml(o.sellerName)} · ${formatMoney(o.price)}${!isManual && i === 0 ? " · 当前最低" : ""}</span>
          ${isManual
            ? `<button class="jm-btn-gold jm-btn-compact" data-action="settleWant" data-payload="${w.id}" data-offer-id="${o.id}" type="button">选此成交</button>`
            : `<b>${i === 0 ? "将成交" : ""}</b>`}
        </div>`).join("")}
      <div class="jm-want-hint">${isManual
        ? "手选模式：点「选此成交」指定应征；到期不会自动成交。"
        : "价低者得：确认或到期时取最低报价；冻结结余自动退回。"}</div>
    </div>`
    : "";
  let actions = "";
  if (isOwner) {
    actions = `
      <div class="jm-want-acts">
        ${isManual
          ? ""
          : `<button class="jm-btn-gold" data-action="settleWant" data-payload="${w.id}" type="button" ${offerCount ? "" : "disabled"}>按最低价成交</button>`}
        <button class="jm-btn-ghost" data-action="cancelWant" data-payload="${w.id}" type="button">撤销</button>
      </div>`;
  } else if (myOffer) {
    actions = `
      <div class="jm-want-acts">
        <span class="jm-want-mine-offer">已应征 ${formatMoney(myOffer.price)}</span>
        <button class="jm-btn-ghost" data-action="withdrawWantOffer" data-want-id="${w.id}" data-payload="${myOffer.id}" type="button">撤回应征</button>
      </div>`;
  } else {
    actions = `<button class="jm-btn-apply" data-action="marketApplyWant" data-payload="${w.id}" type="button">应征</button>`;
  }
  const offerSummary = offerCount
    ? `应征 ${offerCount}${lowest ? ` · 最低 ${formatMoney(lowest.price)}` : ""}`
    : "应征 0 · 暂无报价";
  return `
    <article class="jm-want ${isOwner ? "is-mine" : ""}">
      <div class="jm-want-head">
        <h4 class="jm-want-title">${escapeHtml(w.title || "未命名求购")}</h4>
        <span class="jm-want-timer">${escapeHtml(wantRemainLabel(w.expiresAt))}</span>
      </div>
      <div class="jm-want-chips">
        ${chips.map((chip) => `<span class="jm-want-chip">${escapeHtml(chip)}</span>`).join("")}
      </div>
      <div class="jm-want-budget-row">
        <div class="jm-want-budget"><span>预算</span><strong>≤ ${formatMoney(w.budget)}</strong></div>
        <div class="jm-want-offer-sum">${escapeHtml(offerSummary)}</div>
      </div>
      ${kinds ? `<div class="jm-want-kinds"><span>${escapeHtml(kinds.label)}</span><em>${escapeHtml(kinds.text)}</em></div>` : ""}
      ${w.note ? `<div class="jm-want-extra">${escapeHtml(w.note)}</div>` : ""}
      ${offersHtml}
      <div class="jm-want-foot">
        <span class="jm-want-owner">${escapeHtml(w.ownerName || "掌柜")}</span>
        ${actions}
      </div>
    </article>`;
}

  return { wantRemainLabel, wantRuleLabel, wantKindsSummary, wantCoreChips, wantRequirementText, wantCardHtml };
}
