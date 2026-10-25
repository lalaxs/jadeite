import {
  bmSellables as buildBmSellables
} from "../../bm-plan-pool.js";
import { featureAccess } from "../../player-progression.js";
import {
  BLACKMARKET_BLIND_MIN as BM_BLIND_MIN
} from "../../bm-constants.js";
import { BM_TYPE_META } from "./catalog.js";

export function createBlackmarketSelectors({ document, ui, getState, helpers }) {
  const { escapeHtml, showToast, kitsFor, roughKits, openingKitsForServer, openingKitFromStored, openingKitProductLabel } = helpers;

function bmSellables() {
  return buildBmSellables(getState() || {}, {
    kitsFor,
    openingKitsForServer,
    openingKitFromStored,
    openingKitProductLabel
  });
}

function clearBmPlanDrafts(parentIds = []) {
  if (typeof roughKits?.delete !== "function") return;
  for (const id of parentIds) {
    if (id) roughKits.delete(id);
  }
}

function bmFeatureGate(featureId) {
  return featureAccess(getState()?.me, featureId);
}

function guardBmFeature(featureId) {
  const access = bmFeatureGate(featureId);
  if (access.ok) return true;
  showToast?.({ text: access.message, tone: "warn" });
  return false;
}

function syncBmFeatureChrome() {
  const buy = bmFeatureGate("bmBuy");
  const stall = bmFeatureGate("bmStall");
  const root = document.querySelector('section.view[data-view="blackmarket"]');
  if (!root) return;
  let banner = root.querySelector("[data-bm-ap-gate]");
  if (!buy.ok || !stall.ok) {
    if (!banner) {
      banner = document.createElement("div");
      banner.className = "bm-ap-gate";
      banner.dataset.bmApGate = "1";
      const topbar = root.querySelector(".bm-topbar");
      if (topbar) topbar.insertAdjacentElement("afterend", banner);
      else root.prepend(banner);
    }
    banner.hidden = false;
    banner.textContent = !buy.ok
      ? `黑市浏览已开放；购买需 ${buy.required} 成就积分（当前 ${buy.current}）。可先查看摊位与行情。`
      : `成就积分未达标：摆摊 ${stall.current}/${stall.required}。可购买与逛摊，达标后解锁开设摊位。`;
  } else if (banner) {
    banner.hidden = true;
  }
  const openBtn = root.querySelector('[data-action="openBmOpenModal"]');
  if (openBtn) {
    const hasMine = Boolean(bmMyStall());
    openBtn.disabled = !stall.ok && !hasMine;
    openBtn.title = stall.ok || hasMine ? "" : stall.message;
    openBtn.classList.toggle("is-ap-locked", !stall.ok && !hasMine);
  }
}

function bmStalls() {
  return getState()?.blackStalls || [];
}

function bmPublishedStalls() {
  return bmStalls().filter((s) => {
    if (s.status === "setup") return false;
    if (s.type === "goods" && !(s.items || []).length) return false;
    return true;
  });
}

function bmMyStall() {
  return bmStalls().find((s) => s.isMine) || null;
}

function bmStallInSetup(stall = bmMyStall()) {
  return stall?.status === "setup";
}

function bmSetupHint(type) {
  if (type === "goods") return "请上架至少一件物品，摊才会出现在广场。";
  if (type === "blindbox") return `请补货至少 ${BM_BLIND_MIN} 件，摊才会出现在广场。`;
  return "请添加至少一项服务，摊才会出现在广场。";
}

function bmStallById(id) {
  return bmStalls().find((s) => s.id === id) || null;
}

function bmClaimable() {
  const rows = getState()?.me?.blackPayouts || [];
  return rows.reduce((sum, p) => sum + Number(p.amount || 0), 0);
}

function bmPendingRatings() {
  const now = Date.now();
  return (getState()?.me?.pendingBmRatings || [])
    .filter((r) => Number(r.expiresAt || 0) > now)
    .slice()
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function bmPendingRatingLine(rating) {
  const item = String(rating?.itemName || rating?.itemLabel || "").trim();
  if (rating?.tradeKind === "service") {
    const material = String(rating?.inputItemName || "").trim();
    if (item && material) return `${item} · ${material}`;
    return item || material || "技术委托";
  }
  if (rating?.tradeKind === "blindbox") {
    return item && item !== "盲盒" ? `盲盒 · ${item}` : (item || "盲盒");
  }
  return item || "卖物品成交";
}

function bmPendingRatingsSummary(pending = []) {
  const labels = pending.map(bmPendingRatingLine).filter(Boolean);
  if (!labels.length) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]}、${labels[1]}`;
  return `${labels[0]}、${labels[1]} 等${labels.length}笔`;
}

function bmServiceOrders() {
  return getState()?.blackServiceOrders || [];
}

function bmAffordable(price) {
  return Number(getState()?.me?.cash || 0) >= Number(price || 0);
}

function starsHtml(n, max = 5) {
  const rating = Math.max(0, Math.min(max, Math.round(Number(n) || 0)));
  let s = "";
  for (let i = 1; i <= max; i++) s += i <= rating ? "★" : '<span class="off">★</span>';
  return `<span class="mini-stars bm-stars">${s}</span>`;
}

function satisfactionStars(sat) {
  return Math.max(0, Math.min(5, Math.round((Number(sat) || 0) / 20)));
}

function bmRatingPublicHtml(stall, { ownerView = false } = {}) {
  const rd = stall.ratingDisplay;
  if (rd && !rd.visible) {
    const hint = ownerView
      ? `<span class="bm-rating-owner-hint">（样本 ${rd.sampleCount}/${rd.minSamples} 后公开）</span>`
      : "";
    return `<span class="bm-rating-muted">${escapeHtml(rd.label || "暂无评级")}</span>${hint}`;
  }
  const score = Math.round(Number(rd?.score ?? stall.satisfaction ?? 0));
  const stars = satisfactionStars(score);
  const title = rd?.title ? `<span class="bm-rating-title">${escapeHtml(rd.title)}</span>` : "";
  return `${starsHtml(stars)} <span class="bm-sat-num">${score}</span>${title}`;
}

function bmRatingSortScore(stall) {
  const rd = stall.ratingDisplay;
  if (rd && !rd.visible) return -1;
  const score = Number(rd?.score ?? stall.satisfaction ?? 0);
  const penalty = Number(rd?.ratePenalty) || 0;
  return score - penalty;
}

function typeLabel(type) {
  return BM_TYPE_META[type]?.label || type || "摊位";
}

function setBmFiltersBound(v) {
  ui.bmFiltersBound = v;
}

function setLastBlindSellableKey(v) {
  ui.lastBlindSellableKey = v;
}

  return { bmSellables, clearBmPlanDrafts, bmFeatureGate, guardBmFeature, syncBmFeatureChrome, bmStalls, bmPublishedStalls, bmMyStall, bmStallInSetup, bmSetupHint, bmStallById, bmClaimable, bmPendingRatings, bmPendingRatingLine, bmPendingRatingsSummary, bmServiceOrders, bmAffordable, starsHtml, satisfactionStars, bmRatingPublicHtml, bmRatingSortScore, typeLabel, setBmFiltersBound, setLastBlindSellableKey };
}
