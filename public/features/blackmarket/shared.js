// 黑市 shared：DI 闭包状态 + 共用小函数

import {
  bmSellables as buildBmSellables
} from "../../bm-plan-pool.js";
import { featureAccess } from "../../player-progression.js";
import {
  BLACKMARKET_MIN_PRICE as BM_MIN_PRICE,
  BLACKMARKET_BLIND_MIN as BM_BLIND_MIN
} from "../../bm-constants.js";

export const BM_TYPE_META = {
  goods: { label: "卖物品", tone: "goods" },
  blindbox: { label: "盲盒", tone: "blind" },
  service: { label: "技术支持", tone: "service" }
};
export const BM_FILTERS = [
  { id: "all", label: "全部" },
  { id: "goods", label: "卖物品" },
  { id: "jade", label: "玉料与成品" },
  { id: "employee", label: "员工" },
  { id: "equipment", label: "设备" },
  { id: "blindbox", label: "盲盒" },
  { id: "service", label: "技术支持" }
];

export let socketRef = null;
export let getState = () => null;
export let elsRef = null;
export let getActiveView = () => "overview";
export let leaveLockedBlackmarket = null;
export let formatMoney, escapeHtml, empty, showToast, openGameModal, closeGameModal, typeName, productCanvas, openingStoneSvg, jadeCanvasMarkup;
export let kitsFor, roughKits, openingKitsForServer, openingKitFromStored, openingKitProductLabel;

export function bmSellables() {
  return buildBmSellables(getState() || {}, {
    kitsFor,
    openingKitsForServer,
    openingKitFromStored,
    openingKitProductLabel
  });
}

export function clearBmPlanDrafts(parentIds = []) {
  if (typeof roughKits?.delete !== "function") return;
  for (const id of parentIds) {
    if (id) roughKits.delete(id);
  }
}

export function bmFeatureGate(featureId) {
  return featureAccess(getState()?.me, featureId);
}

export function guardBmFeature(featureId) {
  const access = bmFeatureGate(featureId);
  if (access.ok) return true;
  showToast?.({ text: access.message, tone: "warn" });
  return false;
}

export function syncBmFeatureChrome() {
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

export const bmUi = {
  section: "plaza", // plaza | mine | detail
  typeFilter: "all",
  search: "",
  sort: "latest",
  detailStallId: null,
  buyStallId: null,
  buyListingId: null,
  buyPrice: null,
  openType: "goods",
  openTitle: "",
  openBlurb: "",
  openAnonymous: false,
  goodsPrice: BM_MIN_PRICE,
  goodsSelectedIds: new Set(),
  goodsPriceById: new Map(),
  goodsFocusId: null,
  goodsSubmitting: false,
  goodsPendingIds: new Set(),
  pendingWithdrawId: null,
  blindSelected: new Set(),
  blindFocusId: null,
  blindSubmitting: false,
  blindPriceTouched: false,
  blindManageFocusId: null,
  blindManageTab: "pool",
  blindWithdrawing: false,
  blindDraw: null, // { stallId, drawId, price, extras, candidates, selectedIds:Set, phase }
  blindDrawTimer: null,
  suppressBlindDrawResume: false,
  serviceTitle: "",
  serviceDesc: "",
  servicePrice: 100,
  serviceEta: 30,
  ratingStars: 5,
  orderItemId: null,
  orderItemType: null,
  orderStallId: null,
  orderOfferId: null,
  orderNote: "",
  orderFilter: "all",
  pendingSetupType: null,
  pendingAnonymous: null
};
export let bmFiltersBound = false;
export let lastBlindSellableKey = "";

export function bmStalls() {
  return getState()?.blackStalls || [];
}

export function bmPublishedStalls() {
  return bmStalls().filter((s) => {
    if (s.status === "setup") return false;
    if (s.type === "goods" && !(s.items || []).length) return false;
    return true;
  });
}

export function bmMyStall() {
  return bmStalls().find((s) => s.isMine) || null;
}

export function bmStallInSetup(stall = bmMyStall()) {
  return stall?.status === "setup";
}

export function bmSetupHint(type) {
  if (type === "goods") return "请上架至少一件物品，摊才会出现在广场。";
  if (type === "blindbox") return `请补货至少 ${BM_BLIND_MIN} 件，摊才会出现在广场。`;
  return "请添加至少一项服务，摊才会出现在广场。";
}

export function bmStallById(id) {
  return bmStalls().find((s) => s.id === id) || null;
}

export function bmClaimable() {
  const rows = getState()?.me?.blackPayouts || [];
  return rows.reduce((sum, p) => sum + Number(p.amount || 0), 0);
}

export function bmPendingRatings() {
  const now = Date.now();
  return (getState()?.me?.pendingBmRatings || [])
    .filter((r) => Number(r.expiresAt || 0) > now)
    .slice()
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

export function bmPendingRatingLine(rating) {
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

export function bmPendingRatingsSummary(pending = []) {
  const labels = pending.map(bmPendingRatingLine).filter(Boolean);
  if (!labels.length) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]}、${labels[1]}`;
  return `${labels[0]}、${labels[1]} 等${labels.length}笔`;
}

export function bmServiceOrders() {
  return getState()?.blackServiceOrders || [];
}

export function bmAffordable(price) {
  return Number(getState()?.me?.cash || 0) >= Number(price || 0);
}

export function starsHtml(n, max = 5) {
  const rating = Math.max(0, Math.min(max, Math.round(Number(n) || 0)));
  let s = "";
  for (let i = 1; i <= max; i++) s += i <= rating ? "★" : '<span class="off">★</span>';
  return `<span class="mini-stars bm-stars">${s}</span>`;
}

export function satisfactionStars(sat) {
  return Math.max(0, Math.min(5, Math.round((Number(sat) || 0) / 20)));
}

export function bmRatingPublicHtml(stall, { ownerView = false } = {}) {
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

export function bmRatingSortScore(stall) {
  const rd = stall.ratingDisplay;
  if (rd && !rd.visible) return -1;
  const score = Number(rd?.score ?? stall.satisfaction ?? 0);
  const penalty = Number(rd?.ratePenalty) || 0;
  return score - penalty;
}

export function typeLabel(type) {
  return BM_TYPE_META[type]?.label || type || "摊位";
}

export function setBmFiltersBound(v) {
  bmFiltersBound = v;
}

export function setLastBlindSellableKey(v) {
  lastBlindSellableKey = v;
}

export function bindBlackmarketDeps(deps) {
  socketRef = deps.socket;
  getState = deps.getState;
  elsRef = deps.els;
  getActiveView = deps.getActiveView;
  leaveLockedBlackmarket = typeof deps.leaveLockedBlackmarket === "function"
    ? deps.leaveLockedBlackmarket
    : null;
  ({
    formatMoney, escapeHtml, empty, showToast, openGameModal, closeGameModal, typeName,
    productCanvas, openingStoneSvg, jadeCanvasMarkup,
    kitsFor, roughKits, openingKitsForServer, openingKitFromStored, openingKitProductLabel
  } = deps.helpers);
}
