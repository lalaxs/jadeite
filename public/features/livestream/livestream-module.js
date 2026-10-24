// 直播间：公开、持续营业的成品摊位。开播先选货盘，主播可选；成交与库存由服务器裁决。
import { payrollWorkNotice } from "../../payroll-work-notice.js";
import { employeePayrollStatus } from "../../worker-economy.js";
import { nowMs as payrollNowMs } from "../../shell/format-utils.js";
import { systemSalePriceCap } from "../../../shared/domain/economy/system-demand.js";

import { workerJobLabel } from "../../worker-detail-view.js";
import { renderResourceCard } from "../../resource-card-view.js";
import { finishedProductCardContent } from "../../finished-product-card-view.js";
import { observeLazyPreviews } from "../../lazy-preview.js";
import {
  hostBonusPreview,
  hostBonusesFromWorker,
  livestreamSkillLevel,
  normalizeTalkStyle,
  rankLivestreamHosts,
  recommendLivestreamHost,
  talkStyleMeta
} from "../../livestream-host-bonuses.js";
import {
  LIVESTREAM_BASE_DURATION_MS,
  LIVESTREAM_MAX_DURATION_MS,
  LIVESTREAM_MIN_PRICE,
  LIVESTREAM_MIN_ITEMS as MIN_ROOM_ITEMS,
  LIVESTREAM_MAX_ITEMS as MAX_ROOM_ITEMS
} from "../../livestream-rules.js";

const BASE_DURATION_MINUTES = Math.round(LIVESTREAM_BASE_DURATION_MS / 60_000);
const MAX_DURATION_MINUTES = Math.round(LIVESTREAM_MAX_DURATION_MS / 60_000);
const CAROUSEL_INTERVAL_MS = 4_000;
const HALL_SORTS = [
  { id: "newest", label: "最新开播" },
  { id: "stock", label: "在售最多" },
  { id: "sales", label: "成交最热" },
  { id: "likes", label: "点赞" }
];

const PRESET_COMMENTS = [
  "这件水头看着真舒服",
  "掌柜，能再转一圈看看吗",
  "这个颜色很正，蹲个有缘人",
  "刚进来就看到好货",
  "实物应该更润吧",
  "价格合适我就下手了",
  "还有没有同料的成品",
  "这件做工很细，点赞了",
  "先收藏直播间，慢慢挑",
  "AI翠友：这件我关注很久了"
];
const CHAT_NICKS = ["阿凯", "小满", "路过翠友", "藏家老周", "新手小叶", "翠友阿杰", "逛摊的", "AI翠友"];
const CHAT_FEED_MAX = 40;
const CHAT_PIN_THRESHOLD_PX = 28;
const CHAT_TICK_MIN_MS = 7_000;
const CHAT_TICK_MAX_MS = 13_000;

let socketRef;
let getState;
let elsRef;
let getActiveView;
let finishedProducts;
let productCanvas;
let formatMoney;
let escapeHtml;
let empty;
let paintProductCanvases;
let showToast;

const selectedProductIds = new Set();
const priceDrafts = new Map();
const slideIndexByRoom = new Map();
/** @type {Map<string, { pinnedBottom: boolean, scrollTop: number }>} */
const chatScrollByRoom = new Map();
/** @type {Map<string, number>} */
const shelfScrollByRoom = new Map();
/** @type {Map<string, Array<{ type: string, name: string, text: string, price: number|null, saleKey?: string }>>} */
const chatFeedByRoom = new Map();
let chatTickTimer = null;
let chatTickSeq = 0;
let draftHostId = null;
let draftTalkStyle = "balanced";
let hostModalOpen = false;
let modalHostId = null;
let hostDetailsOpen = false;
let replenishOpen = false;
let hallSort = "newest";
let activeLivestreamTab = "hall";
let stockPickerQuery = "";
let stockPickerFilter = "all";
let stockPickerSort = "valueDesc";
/** 正在观看的他人直播间 id；大厅列表点进后进入详情 */
let watchingRoomId = null;
let buyConfirm = null;
let closeConfirmOpen = false;
let carouselTimer = null;
let boundRoot = null;
let lastLivestreamRenderFp = "";

function requestId(prefix) {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function rooms() {
  return getState()?.livestreamRooms || [];
}

function roomForId(roomId) {
  return rooms().find((room) => room.id === roomId) || null;
}

function itemValue(item) {
  return Math.max(1, Number(item?.value || item?.price || 100));
}

function defaultPrice(item) {
  return Math.max(LIVESTREAM_MIN_PRICE, Math.min(Math.round(itemValue(item) * 1.05), systemSalePriceCap(getState?.()?.me || {}, [item])));
}

function draftPrice(item) {
  if (!priceDrafts.has(item.id)) priceDrafts.set(item.id, defaultPrice(item));
  return priceDrafts.get(item.id);
}

/** @returns {"low"|"fair"|"high"} */
export function priceRatioTier(price, value) {
  const ratio = Number(price) / Math.max(1, Number(value) || 1);
  if (ratio < 0.95) return "low";
  if (ratio > 1.1) return "high";
  return "fair";
}

function tierMeta(tier) {
  if (tier === "low") return { label: "偏低", className: "is-low" };
  if (tier === "high") return { label: "偏高", className: "is-high" };
  return { label: "持平", className: "is-fair" };
}

export function aiDemandMeta(price, value) {
  const ratio = Number(price) / Math.max(1, Number(value) || 1);
  const className = tierMeta(priceRatioTier(price, value)).className;
  if (ratio > 1.25) return { label: "仅等玩家", className, ratio };
  if (ratio > 1.15) return { label: "限量溢价客", className, ratio };
  if (ratio > 1.1) return { label: "偏慢", className, ratio };
  if (ratio < 0.95) return { label: "好卖", className, ratio };
  return { label: "正常", className, ratio };
}

function currentSlideIndex(room) {
  const count = room?.items?.length || 0;
  if (!count) return 0;
  const index = Number(slideIndexByRoom.get(room.id) || 0);
  const normalized = ((index % count) + count) % count;
  slideIndexByRoom.set(room.id, normalized);
  return normalized;
}

function parsePresetComment(raw, seed) {
  const text = String(raw || "");
  const sep = text.indexOf("：");
  if (sep > 0 && sep < 10) {
    return { name: text.slice(0, sep), text: text.slice(sep + 1) };
  }
  return {
    name: CHAT_NICKS[Math.abs(seed) % CHAT_NICKS.length],
    text
  };
}

function ensureChatFeed(roomId) {
  const id = String(roomId || "");
  if (!id) return [];
  if (!chatFeedByRoom.has(id)) chatFeedByRoom.set(id, []);
  return chatFeedByRoom.get(id);
}

/**
 * 公屏只保留氛围评论；真实成交不进公屏。
 * 买家看自己的购买弹窗，卖家看私有飘字 /「最近成交」。
 */
function syncSalesIntoChatFeed(room) {
  const roomId = String(room?.id || "");
  if (!roomId) return [];
  return ensureChatFeed(roomId);
}

/** 追加 1–2 条氛围评论；与当前讲品无关，轮播切换不会重置。 */
export function appendLivestreamChatComments(roomId, count = 1, seed = Date.now()) {
  const id = String(roomId || "");
  if (!id) return [];
  const feed = ensureChatFeed(id);
  const n = Math.max(1, Math.min(2, Math.round(Number(count) || 1)));
  const base = Math.abs(Number(seed) || 0);
  for (let offset = 0; offset < n; offset += 1) {
    const raw = PRESET_COMMENTS[(base + offset * 5 + feed.length * 3) % PRESET_COMMENTS.length];
    const parsed = parsePresetComment(raw, base + offset + feed.length);
    feed.push({ type: "chat", name: parsed.name, text: parsed.text, price: null });
  }
  chatFeedByRoom.set(id, feed.slice(-CHAT_FEED_MAX));
  return chatFeedByRoom.get(id);
}

/** 抖音式公屏：仅氛围评论；成交不进公屏。item/index 保留兼容。 */
export function buildLivestreamChatFeed(room, _item, _index) {
  return [...syncSalesIntoChatFeed(room)];
}

export function resetLivestreamChatFeeds() {
  chatFeedByRoom.clear();
}

function pruneChatFeeds(aliveIds) {
  const alive = new Set([...aliveIds].map(String).filter(Boolean));
  for (const id of chatFeedByRoom.keys()) {
    if (!alive.has(id)) chatFeedByRoom.delete(id);
  }
}

function visibleChatRoomIds() {
  if (getActiveView?.() !== "livestream") return [];
  const state = getState?.();
  if (!state?.me) return [];
  if (watchingRoomId) return [watchingRoomId];
  if (activeLivestreamTab === "mine") {
    const myId = state.me.livestreamRoom?.id;
    return myId ? [myId] : [];
  }
  return (state.livestreamRooms || [])
    .filter((room) => room.ownerId !== state.me.id && room.items?.length)
    .map((room) => room.id);
}

function chatLinesHtml(feed) {
  return (feed || []).map((entry) => entry.type === "sale"
    ? `
      <div class="livestream-chat-line is-sale">
        <span class="livestream-chat-name">${escapeHtml(entry.name)}</span>
        <span class="livestream-chat-text">${escapeHtml(entry.text)}</span>
        <b class="livestream-chat-price">${formatMoney(entry.price || 0)}</b>
      </div>
    `
    : `
      <div class="livestream-chat-line is-chat">
        <span class="livestream-chat-name">${escapeHtml(entry.name)}</span>
        <span class="livestream-chat-text">${escapeHtml(entry.text)}</span>
      </div>
    `
  ).join("");
}

function paintVisibleChatRails() {
  const root = elsRef?.livestream;
  if (!root) return;
  root.querySelectorAll("[data-livestream-chat]").forEach((el) => {
    const roomId = el.getAttribute("data-room-id");
    if (!roomId) return;
    const state = getState?.();
    const myRoom = state?.me?.livestreamRoom;
    const room = myRoom?.id === roomId ? myRoom : roomForId(roomId);
    if (!room) return;
    captureChatScroll(el.parentElement || root);
    const feed = syncSalesIntoChatFeed(room);
    el.innerHTML = chatLinesHtml(feed);
    restoreChatScroll(root, roomId);
  });
}

function scheduleChatTick() {
  if (chatTickTimer) globalThis.clearTimeout(chatTickTimer);
  const span = CHAT_TICK_MAX_MS - CHAT_TICK_MIN_MS;
  const delay = CHAT_TICK_MIN_MS + Math.floor(Math.random() * (span + 1));
  chatTickTimer = globalThis.setTimeout(() => {
    chatTickTimer = null;
    const roomIds = visibleChatRoomIds();
    if (roomIds.length) {
      chatTickSeq += 1;
      for (const roomId of roomIds) {
        const burst = Math.random() < 0.45 ? 2 : 1;
        appendLivestreamChatComments(roomId, burst, Date.now() + chatTickSeq * 17);
      }
      paintVisibleChatRails();
    }
    scheduleChatTick();
  }, delay);
}

export {
  formatLivestreamDuration,
  buildLivestreamSettleModalEvent
} from "../../../shared/domain/livestream/settle-modal.js";

function chatRailMarkup(room) {
  const feed = syncSalesIntoChatFeed(room);
  return `
    <div class="livestream-chat-rail" aria-label="直播评论">
      <div class="livestream-chat-scroll" data-livestream-chat
        data-room-id="${escapeHtml(room.id)}">
        ${chatLinesHtml(feed)}
      </div>
    </div>
  `;
}

function captureChatScroll(root = elsRef?.livestream) {
  if (!root) return;
  root.querySelectorAll("[data-livestream-chat]").forEach((el) => {
    const roomId = el.getAttribute("data-room-id");
    if (!roomId) return;
    const pinnedBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= CHAT_PIN_THRESHOLD_PX;
    chatScrollByRoom.set(roomId, { pinnedBottom, scrollTop: el.scrollTop });
  });
}

function restoreChatScroll(root = elsRef?.livestream, roomId = null) {
  if (!root) return;
  const nodes = roomId
    ? root.querySelectorAll(`[data-livestream-chat][data-room-id="${CSS.escape(roomId)}"]`)
    : root.querySelectorAll("[data-livestream-chat]");
  nodes.forEach((el) => {
    const id = el.getAttribute("data-room-id");
    const saved = id ? chatScrollByRoom.get(id) : null;
    if (!saved || saved.pinnedBottom) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    el.scrollTop = saved.scrollTop;
  });
}

function shelfRoomIdFromEl(el) {
  return el?.getAttribute("data-room-id")
    || el?.closest("[data-room-id]")?.getAttribute("data-room-id")
    || null;
}

function captureShelfScroll(root = elsRef?.livestream) {
  if (!root) return;
  root.querySelectorAll("[data-livestream-shelf-scroll]").forEach((el) => {
    const roomId = shelfRoomIdFromEl(el);
    if (!roomId) return;
    shelfScrollByRoom.set(roomId, el.scrollLeft);
  });
}

function restoreShelfScroll(root = elsRef?.livestream, roomId = null) {
  if (!root) return;
  root.querySelectorAll("[data-livestream-shelf-scroll]").forEach((el) => {
    const id = shelfRoomIdFromEl(el);
    if (!id || (roomId && id !== roomId) || !shelfScrollByRoom.has(id)) return;
    const left = shelfScrollByRoom.get(id);
    el.scrollLeft = left;
    // 布局/画布回填后再写一次，避免被重置为 0
    requestAnimationFrame(() => {
      if (el.isConnected) el.scrollLeft = left;
    });
  });
}

/** 整页重绘前抠出货盘 DOM，货品未变时复用，避免滚动条被重建冲掉 */
function capturePreservedShelves(root = elsRef?.livestream) {
  /** @type {Map<string, { node: Element, itemsKey: string }>} */
  const preserved = new Map();
  if (!root) return preserved;
  root.querySelectorAll("[data-livestream-shelf-host]").forEach((host) => {
    const roomId = host.closest("[data-room-id]")?.getAttribute("data-room-id");
    const node = host.firstElementChild;
    const itemsKey = host.querySelector("[data-livestream-shelf-scroll]")?.getAttribute("data-shelf-items") || "";
    if (!roomId || !node) return;
    preserved.set(roomId, { node, itemsKey });
  });
  return preserved;
}

function restorePreservedShelves(preserved, root = elsRef?.livestream) {
  if (!root || !preserved?.size) return;
  const state = getState?.();
  const myRoom = state?.me?.livestreamRoom;
  preserved.forEach(({ node, itemsKey }, roomId) => {
    const host = root.querySelector(`[data-room-id="${CSS.escape(roomId)}"] [data-livestream-shelf-host]`);
    if (!host) return;
    const freshKey = host.querySelector("[data-livestream-shelf-scroll]")?.getAttribute("data-shelf-items") || "";
    if (freshKey !== itemsKey) return;
    host.replaceChildren(node);
    const room = myRoom?.id === roomId ? myRoom : roomForId(roomId);
    if (room) syncShelfCurrent(host, room);
  });
}

function skillLevel(worker, key) {
  return livestreamSkillLevel(worker, key);
}

function availableHosts() {
  return rankLivestreamHosts(getState()?.me?.workshop?.workers || []);
}

function ensureDraftHost() {
  const hosts = availableHosts();
  if (!hosts.length) {
    draftHostId = null;
    return null;
  }
  if (!draftHostId) return null;
  const selected = hosts.find((worker) => worker.id === draftHostId && !worker.busy);
  if (selected) return selected;
  draftHostId = null;
  return null;
}

function resolveSelectedHost() {
  return ensureDraftHost();
}

function resolveModalHost() {
  const hosts = availableHosts();
  if (!modalHostId) return null;
  const selected = hosts.find((worker) => worker.id === modalHostId && !worker.busy);
  if (selected) return selected;
  modalHostId = null;
  return null;
}

function hostSubtitle(room) {
  const host = room?.host;
  if (!host?.name) return "";
  return `主播 ${host.name} · ${workerJobLabel(host.job)}`;
}

function formatRelativeMinutes(targetAt, now = Date.now(), expiredLabel = "即将到访") {
  const ms = Number(targetAt) - now;
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return expiredLabel;
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  return `约 ${mins} 分`;
}

function formatSaleAgo(soldAt, now = Date.now()) {
  const ms = Math.max(0, now - Number(soldAt || now));
  if (ms < 60_000) return "刚刚";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分前`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} 小时前`;
  return `${Math.floor(ms / 86_400_000)} 天前`;
}

export function sortHallRooms(roomList, sortId = "newest") {
  const list = [...(roomList || [])];
  const stock = (room) => Number(room.stockCount ?? room.items?.length ?? 0);
  const sales = (room) => Number(room.totalSales ?? room.sales?.length ?? 0);
  const likes = (room) => Number(room.likes || 0);
  if (sortId === "stock") list.sort((a, b) => stock(b) - stock(a) || likes(b) - likes(a));
  else if (sortId === "sales") list.sort((a, b) => sales(b) - sales(a) || likes(b) - likes(a));
  else if (sortId === "likes") list.sort((a, b) => likes(b) - likes(a) || sales(b) - sales(a));
  else list.sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0));
  return list;
}

function selectedProducts(products) {
  const byId = new Map(products.map((item) => [item.id, item]));
  return [...selectedProductIds].map((id) => byId.get(id)).filter(Boolean);
}

function selectionSummary(products) {
  const selected = selectedProducts(products);
  let totalPrice = 0;
  let totalValue = 0;
  for (const item of selected) {
    totalPrice += Number(draftPrice(item)) || 0;
    totalValue += itemValue(item);
  }
  const avgRatio = totalValue > 0 ? totalPrice / totalValue : 1;
  const avgTier = avgRatio < 0.95 ? "low" : avgRatio > 1.1 ? "high" : "fair";
  const pct = Math.round((avgRatio - 1) * 100);
  const pctLabel = pct === 0 ? "持平" : pct > 0 ? `+${pct}%` : `${pct}%`;
  return {
    count: selected.length,
    totalPrice,
    totalValue,
    avgRatio,
    avgTier,
    pctLabel
  };
}

function sortHostsForPicker(hosts, recommendedId) {
  return [...hosts].sort((a, b) => {
    const busyA = a.busy ? 1 : 0;
    const busyB = b.busy ? 1 : 0;
    if (busyA !== busyB) return busyA - busyB;
    if (a.id === recommendedId && b.id !== recommendedId) return -1;
    if (b.id === recommendedId && a.id !== recommendedId) return 1;
    const pa = Number(hostBonusPreview(hostBonusesFromWorker(a).bonuses).convertPct) || 0;
    const pb = Number(hostBonusPreview(hostBonusesFromWorker(b).bonuses).convertPct) || 0;
    if (pb !== pa) return pb - pa;
    return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
  });
}

function hostRowButton(worker, { selected, recommended, action = "select-host" }) {
  const busy = Boolean(worker.busy);
  const preview = hostBonusPreview(hostBonusesFromWorker(worker).bonuses);
  return renderResourceCard({
    type: "employee", name: worker.name, tag: "button",
    badge: busy ? "忙碌中" : selected ? "已选主播" : recommended ? "推荐主播" : "可选主播",
    className: `livestream-host-row ${selected ? "is-selected" : ""} ${busy ? "is-busy" : ""} ${recommended ? "is-recommended" : ""}`,
    attributes: `type="button" role="option" aria-selected="${Boolean(selected)}" data-livestream-action="${action}" data-worker-id="${escapeHtml(worker.id)}" ${busy ? "disabled" : ""}`,
    summary: [`${workerJobLabel(worker.job)} · ${Number(worker.tier) || 1}阶`],
    body: `<span class="livestream-host-row-stats">
          <b>转化 +${preview.convertPct}%</b>
          <b>流速 +${preview.trafficPct}%</b>
        </span>
        <span class="livestream-host-row-skills">话术 Lv.${skillLevel(worker, "huashu")} · 控场 Lv.${skillLevel(worker, "kongchang")} · 催单 Lv.${skillLevel(worker, "cuidan")}</span>
    `
  });
}

function hostModalMarkup(hosts, modalHost) {
  const recommended = hosts.length ? recommendLivestreamHost(hosts) : null;
  const ordered = hosts.length ? sortHostsForPicker(hosts, recommended?.id) : [];
  return `
    <div class="jm-modal-root livestream-host-modal-root" role="dialog" aria-modal="true" aria-label="挑选带货主播">
      <div class="jm-modal jm-modal-wide livestream-host-modal">
        <div class="jm-modal-head">
          <h3>挑选带货主播</h3>
          <button class="jm-modal-x" type="button" data-livestream-action="close-host-modal" aria-label="关闭">×</button>
        </div>
        <div class="jm-modal-body">
          ${hosts.length
            ? `
              <div class="livestream-host-list" role="listbox" aria-label="可选主播">
                <button class="livestream-host-row ${modalHost ? "" : "is-selected"}"
                  type="button"
                  role="option"
                  aria-selected="${modalHost ? "false" : "true"}"
                  data-livestream-action="clear-modal-host">
                  <span class="livestream-host-radio" aria-hidden="true"></span>
                  <span class="livestream-host-row-body">
                    <span class="livestream-host-row-top">
                      <strong>不添加主播</strong>
                      <span class="livestream-host-row-job">无员工加成</span>
                    </span>
                    <span class="livestream-host-row-stats">
                      <b>转化 +0%</b>
                      <b>流速 +0%</b>
                    </span>
                    <span class="livestream-host-row-skills">先上架试水，稍后再安排主播</span>
                  </span>
                  <span class="livestream-host-row-check" aria-hidden="true">${modalHost ? "" : "✓"}</span>
                </button>
                ${ordered.map((worker) => hostRowButton(worker, {
                  selected: modalHost?.id === worker.id,
                  recommended: recommended?.id === worker.id,
                  action: "select-modal-host"
                })).join("")}
              </div>
            `
            : `<div class="game-empty-state is-compact">
                <span class="game-empty-state-mark" aria-hidden="true">人</span>
                <strong>暂时没有可用主播</strong>
                <p>可以不添加主播直接开播；若想获得主播加成，先去员工页招募。</p>
              </div>`}
        </div>
        <div class="jm-modal-foot">
          <button class="jm-btn-ghost" type="button" data-livestream-action="close-host-modal">取消</button>
          <button class="jm-btn-gold" type="button" data-livestream-action="confirm-host-modal">确认</button>
        </div>
      </div>
    </div>
  `;
}

function startHostBarMarkup(selectedHost, canStart, count) {
  const stopped = employeePayrollStatus(getState()?.me, payrollNowMs()) === "stopped";
  return `
    <div class="livestream-start-bar">
      <div class="livestream-host-status">
        <button type="button" class="ghost" data-livestream-action="open-host-modal">选择主播</button>
        ${selectedHost
          ? `<span class="livestream-host-picked">已选：${escapeHtml(selectedHost.name)}</span>`
          : `<span class="livestream-host-picked is-muted">默认不选择主播</span>`}
      </div>
      <button type="button" data-livestream-action="start" ${canStart && !stopped ? "" : "disabled"}>
        ${stopped ? "员工已停工" : canStart ? `开启直播（${count} 件）` : "至少选择 3 件"}
      </button>
    </div>
  `;
}

function stockRowMarkup(item, capacity) {
  const selected = selectedProductIds.has(item.id);
  const price = draftPrice(item);
  const atCap = !selected && selectedProductIds.size >= capacity;
  return `
    <article class="inventory-slot order-pick-card livestream-stock-row ${selected ? "is-selected" : ""}" data-product-id="${escapeHtml(item.id)}">
      <label class="order-pick-inspect livestream-stock-select">
        <input type="checkbox" data-livestream-select="${escapeHtml(item.id)}" aria-label="选择${escapeHtml(item.name || "翡翠成品")}"
          ${selected ? "checked" : ""} ${atCap ? "disabled" : ""}>
        ${finishedProductCardContent(item, { escapeHtml, formatMoney,
          selectionHtml: '<span class="livestream-stock-check" aria-hidden="true">✓</span>'
        })}
      </label>
      <div class="order-pick-fit livestream-stock-pricing">
      <label class="livestream-price-field">
        <span>直播价</span>
        <input type="number" min="${LIVESTREAM_MIN_PRICE}" step="1" inputmode="numeric"
          data-livestream-price="${escapeHtml(item.id)}"
          value="${price}" aria-label="${escapeHtml(item.name || "成品")}直播价">
      </label>
      </div>
    </article>
  `;
}

function visibleStockProducts(products) {
  const query = stockPickerQuery.trim().toLocaleLowerCase("zh-CN");
  const rows = products.filter((item) => {
    const selected = selectedProductIds.has(item.id);
    if (stockPickerFilter === "selected" && !selected) return false;
    if (stockPickerFilter === "unselected" && selected) return false;
    if (!query) return true;
    return [item.name, item.quality, item.color, item.design, item.kind]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("zh-CN")
      .includes(query);
  });
  return rows.sort((a, b) => {
    if (stockPickerSort === "valueAsc") return itemValue(a) - itemValue(b);
    if (stockPickerSort === "name") return String(a.name || "").localeCompare(String(b.name || ""), "zh");
    if (stockPickerSort === "selected") {
      return Number(selectedProductIds.has(b.id)) - Number(selectedProductIds.has(a.id))
        || itemValue(b) - itemValue(a);
    }
    return itemValue(b) - itemValue(a);
  });
}

function stockPickerMarkup(products, { mode, capacity, selectedHost = null }) {
  const isStart = mode === "start";
  const action = isStart ? "start" : "replenish";
  const title = isStart ? "选择首批直播商品" : "继续补货";
  const replenishHint = isStart ? "" : `本场还可补 ${capacity} 件，补货后会直接加入轮播。`;
  const summary = selectionSummary(products);
  const visibleProducts = visibleStockProducts(products);
  const selectable = visibleProducts.slice(0, Math.max(0, capacity));
  const allSelected = selectable.length > 0
    && selectable.every((item) => selectedProductIds.has(item.id));
  const canStart = isStart && summary.count >= MIN_ROOM_ITEMS && summary.count <= capacity
    && [...selectedProductIds].every((id) => {
      const price = Number(priceDrafts.get(id));
      return Number.isInteger(price) && price >= LIVESTREAM_MIN_PRICE;
    });

  if (!products.length) {
    return `
      <section class="livestream-stock-picker is-empty" data-picker-mode="${mode}" data-capacity="${capacity}">
        <div class="livestream-picker-head">
          <div><p class="eyebrow">${isStart ? "开播准备" : "库存补充"}</p><h3>${title}</h3></div>
        </div>
        <div class="game-empty-state livestream-stock-empty">
          <span class="game-empty-state-mark" aria-hidden="true">播</span>
          <strong>还没有可上架的成品</strong>
          <p>先在工坊完成精加工，至少准备 ${MIN_ROOM_ITEMS} 件成品即可开播；单场 ${BASE_DURATION_MINUTES} 分钟，成交可延长至 ${MAX_DURATION_MINUTES} 分钟。</p>
          <button type="button" data-view-link="workshop">去工坊备货</button>
        </div>
      </section>
    `;
  }

  return `
    <section class="livestream-wizard livestream-stock-picker" data-picker-mode="${mode}" data-capacity="${capacity}">
      <div class="livestream-picker-toolbar">
        ${!isStart
          ? `
            <div class="livestream-picker-head">
              <div>
                <p class="eyebrow">直播中可随时补货</p>
                <h3>${title}</h3>
                ${replenishHint ? `<p>${replenishHint}</p>` : ""}
              </div>
            </div>
          `
          : ""}
        <div class="livestream-price-tools" role="group" aria-label="一键定价">
          <label class="livestream-select-all${allSelected ? " is-checked" : ""}" title="全选 / 取消全选">
            <input type="checkbox" data-livestream-select-all ${allSelected ? "checked" : ""}
              aria-label="全选商品">
            <span class="livestream-stock-check" aria-hidden="true">✓</span>
          </label>
          <div class="livestream-price-tools-actions">
            <button type="button" class="ghost" data-livestream-action="price-preset" data-price-mult="1">按估值</button>
            <button type="button" class="ghost" data-livestream-action="price-preset" data-price-mult="1.05">估值+5%</button>
            <button type="button" class="ghost" data-livestream-action="price-preset" data-price-mult="1.15">估值+15%</button>
            <span>作用于已勾选商品</span>
          </div>
          <div class="livestream-picker-count">
            <strong data-livestream-selected-count>${summary.count}/${capacity}</strong>
            <span>已选择</span>
          </div>
        </div>
        <div class="item-picker-tools livestream-stock-tools">
          <input type="search" value="${escapeHtml(stockPickerQuery)}" data-livestream-stock-search placeholder="搜索名称、种水或颜色" aria-label="搜索直播商品">
          <select data-livestream-stock-filter aria-label="筛选选择状态">
            <option value="all" ${stockPickerFilter === "all" ? "selected" : ""}>全部状态</option>
            <option value="selected" ${stockPickerFilter === "selected" ? "selected" : ""}>已选择</option>
            <option value="unselected" ${stockPickerFilter === "unselected" ? "selected" : ""}>未选择</option>
          </select>
          <select data-livestream-stock-sort aria-label="直播商品排序">
            <option value="valueDesc" ${stockPickerSort === "valueDesc" ? "selected" : ""}>估值从高到低</option>
            <option value="valueAsc" ${stockPickerSort === "valueAsc" ? "selected" : ""}>估值从低到高</option>
            <option value="selected" ${stockPickerSort === "selected" ? "selected" : ""}>已选优先</option>
            <option value="name" ${stockPickerSort === "name" ? "selected" : ""}>名称</option>
          </select>
          <span class="item-picker-result" aria-live="polite">显示 ${visibleProducts.length}/${products.length} 件</span>
        </div>
      </div>
      <div class="livestream-stock-list">
        ${visibleProducts.length
          ? visibleProducts.map((item) => stockRowMarkup(item, capacity)).join("")
          : `<div class="game-empty-state livestream-filter-empty"><strong>没有符合条件的成品</strong><p>换个关键词或选择“全部状态”。</p></div>`}
      </div>
      <div class="livestream-picker-dock">
        <div class="livestream-stock-summary">
          <span>${summary.count} 件 · 总标价 <b>${formatMoney(summary.totalPrice)}</b> · 均价相对估值 ${escapeHtml(summary.pctLabel)}</span>
        </div>
        ${isStart
          ? startHostBarMarkup(selectedHost, canStart, summary.count)
          : `
            <div class="livestream-picker-actions">
              <span>已售商品不会被补货操作影响。</span>
              <button type="button" data-livestream-action="${action}" disabled>
                选择要补货的成品
              </button>
            </div>
          `}
      </div>
    </section>
  `;
}

function startWizardMarkup(hosts, selectedHost, products) {
  return `
    ${stockPickerMarkup(products, { mode: "start", capacity: MAX_ROOM_ITEMS, selectedHost })}
    ${hostModalOpen ? hostModalMarkup(hosts, resolveModalHost()) : ""}
  `;
}

function hostLiveChips(host, { collapsed = false } = {}) {
  if (!host) return "";
  const preview = host.preview || hostBonusPreview(host.bonuses || {});
  const skills = host.skills || {};
  const styleLabel = host.talkStyleLabel || talkStyleMeta(host.talkStyle).label;
  if (collapsed && !hostDetailsOpen) {
    return `
      <div class="livestream-host-chips is-compact">
        <span class="livestream-host-chip is-style">${escapeHtml(styleLabel)}</span>
        <span class="livestream-host-chip is-bonus">转化 +${Number(preview.convertPct) || 0}%</span>
        <button type="button" class="livestream-host-chip is-link" data-livestream-action="toggle-host-details">主播详情</button>
      </div>
    `;
  }
  return `
    <div class="livestream-host-chips">
      <span class="livestream-host-chip is-style">${escapeHtml(styleLabel)}</span>
      <span class="livestream-host-chip">话术 Lv.${livestreamSkillLevel(skills.huashu ?? 1)}</span>
      <span class="livestream-host-chip">控场 Lv.${livestreamSkillLevel(skills.kongchang ?? 1)}</span>
      <span class="livestream-host-chip">催单 Lv.${livestreamSkillLevel(skills.cuidan ?? 1)}</span>
      <span class="livestream-host-chip is-bonus">转化 +${Number(preview.convertPct) || 0}%</span>
      <span class="livestream-host-chip is-bonus">流速 +${Number(preview.trafficPct) || 0}%</span>
      ${collapsed ? `<button type="button" class="livestream-host-chip is-link" data-livestream-action="toggle-host-details">收起</button>` : ""}
    </div>
  `;
}

function shelfMarkup(room) {
  const index = currentSlideIndex(room);
  if (!room.items?.length) return "";
  const itemsKey = room.items.map((item) => `${item.id}:${item.price ?? ""}`).join(",");
  return `
    <div class="livestream-shelf" aria-label="本场货盘">
      <p class="livestream-shelf-label">本场货盘</p>
      <div class="livestream-shelf-scroll" data-livestream-shelf-scroll
        data-room-id="${escapeHtml(room.id)}"
        data-shelf-items="${escapeHtml(itemsKey)}">
        <div class="livestream-shelf-track">
          ${room.items.map((item, itemIndex) => `
            <button type="button"
              class="livestream-shelf-thumb ${itemIndex === index ? "is-current" : ""}"
              data-livestream-action="select-slide"
              data-room-id="${escapeHtml(room.id)}"
              data-slide-index="${itemIndex}"
              aria-label="${escapeHtml(item.product?.name || "成品")}"
              aria-current="${itemIndex === index ? "true" : "false"}">
              <span class="livestream-shelf-art">${productCanvas(item.product)}</span>
              <span class="livestream-shelf-price">${formatMoney(item.price)}</span>
            </button>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function buyConfirmMarkup(room) {
  if (!buyConfirm || buyConfirm.roomId !== room.id) return "";
  const roomItem = room.items?.find((item) => item.id === buyConfirm.itemId);
  if (!roomItem) return "";
  const cash = Number(getState()?.me?.cash || 0);
  const price = Number(roomItem.price || 0);
  const value = itemValue(roomItem.product);
  const enough = cash >= price;
  return `
    <div class="livestream-buy-confirm" role="dialog" aria-label="确认购买">
      <div>
        <strong>确认购买「${escapeHtml(roomItem.product?.name || "翡翠成品")}」？</strong>
        <p>直播价 ${formatMoney(price)} · 估值 ${formatMoney(value)} · ${enough ? "余额足够" : "余额不足"}</p>
      </div>
      <div class="livestream-buy-confirm-actions">
        <button type="button" class="ghost" data-livestream-action="cancel-buy">取消</button>
        <button type="button" data-livestream-action="confirm-buy"
          data-room-id="${escapeHtml(room.id)}"
          data-item-id="${escapeHtml(roomItem.id)}"
          ${enough ? "" : "disabled"}>${enough ? "确认支付" : "余额不足"}</button>
      </div>
    </div>
  `;
}

function roomHeroMarkup(room, mine, { showShelf = !mine, showChat = true, showFooter = true } = {}) {
  const index = currentSlideIndex(room);
  const roomItem = room.items[index];
  if (!roomItem) return `<div class="livestream-soldout">本场商品已经售罄</div>`;
  const itemNumber = `${index + 1}/${room.items.length}`;
  return `
    <div class="livestream-room-carousel">
      <div class="livestream-product-visual">
        ${productCanvas(roomItem.product)}
        <span class="livestream-item-count">${itemNumber}</span>
      </div>
      ${showChat ? chatRailMarkup(room) : ""}
      <button class="livestream-slide-control previous" type="button"
        data-livestream-action="previous" data-room-id="${escapeHtml(room.id)}"
        aria-label="上一件商品">‹</button>
      <button class="livestream-slide-control next" type="button"
        data-livestream-action="next" data-room-id="${escapeHtml(room.id)}"
        aria-label="下一件商品">›</button>
    </div>
    ${showFooter ? `
    <div class="livestream-room-footer">
      <div class="livestream-product-copy">
        <div>
          <p class="livestream-product-kicker">当前讲品 · ${itemNumber}</p>
          <h4>${escapeHtml(roomItem.product.name || "翡翠成品")}</h4>
          <p>参考估值 ${formatMoney(roomItem.product.value || roomItem.product.price || 0)}</p>
        </div>
        <div class="livestream-live-offer">
          <span>直播价</span>
          <strong>${formatMoney(roomItem.price)}</strong>
          ${mine
            ? '<span class="livestream-owner-note">自己的直播商品</span>'
            : `<button type="button" data-livestream-action="buy"
                data-room-id="${escapeHtml(room.id)}"
                data-item-id="${escapeHtml(roomItem.id)}">立即购买</button>`}
        </div>
      </div>
      ${showShelf ? shelfMarkup(room) : ""}
    </div>
    ${mine ? "" : buyConfirmMarkup(room)}
    ` : ""}
  `;
}

function recentSalesMarkup(room) {
  const sales = (room.sales || []).slice(0, 20);
  if (!sales.length) {
    return `<div class="livestream-recent-sales is-empty">本场还没有成交，AI 翠友会陆续进店。</div>`;
  }
  return `
    <div class="livestream-recent-sales" aria-label="最近成交">
      ${sales.map((sale) => `
        <div>
          <span class="livestream-history-dot"></span>
          <strong>${escapeHtml(sale.productName || "翡翠成品")}</strong>
          <span>${escapeHtml(sale.buyerName || (sale.buyerType === "ai" ? "AI翠友" : "翠友"))}</span>
          <em>${escapeHtml(formatSaleAgo(sale.soldAt))}</em>
        </div>
      `).join("")}
    </div>
  `;
}

function replenishModalMarkup(products, capacity) {
  return `
    <div class="jm-modal-root livestream-replenish-modal-root" role="dialog" aria-modal="true" aria-label="继续补货">
      <div class="jm-modal jm-modal-wide livestream-replenish-modal">
        <div class="jm-modal-head">
          <h3>继续补货</h3>
          <button class="jm-modal-x" type="button" data-livestream-action="close-replenish-modal" aria-label="关闭">×</button>
        </div>
        <div class="jm-modal-body">
          ${stockPickerMarkup(products, { mode: "replenish", capacity })}
        </div>
      </div>
    </div>
  `;
}

function closeConfirmModalMarkup() {
  return `
    <div class="jm-modal-root livestream-close-modal-root" role="dialog" aria-modal="true" aria-label="确认关播">
      <div class="jm-modal livestream-close-modal">
        <div class="jm-modal-head">
          <h3>关闭直播</h3>
          <button class="jm-modal-x" type="button" data-livestream-action="cancel-close" aria-label="关闭">×</button>
        </div>
        <div class="jm-modal-body">
          <p class="livestream-close-modal-copy">确定关闭直播间吗？未售出的成品会退回库存，主播也会被释放。</p>
        </div>
        <div class="jm-modal-foot">
          <button class="jm-btn-ghost" type="button" data-livestream-action="cancel-close">取消</button>
          <button class="danger" type="button" data-livestream-action="confirm-close">确认关闭</button>
        </div>
      </div>
    </div>
  `;
}

function ownerDashboardMarkup(room, products, capacity) {
  const saleCount = Number(room.totalSales ?? room.sales?.length ?? 0);
  const stockCount = Number(room.stockCount ?? room.items?.length ?? 0);
  const listedTotal = Math.max(stockCount + saleCount, saleCount);
  const progressPct = listedTotal > 0 ? Math.min(100, Math.round((saleCount / listedTotal) * 100)) : 0;
  const hostLine = hostSubtitle(room);
  const visitHint = room.nextAiVisitAt
    ? formatRelativeMinutes(room.nextAiVisitAt)
    : "";
  const remainingHint = room.endsAt
    ? formatRelativeMinutes(room.endsAt, Date.now(), "即将结束")
    : "";
  return `
    <article class="livestream-room-card is-mine is-owner-dash" data-room-id="${escapeHtml(room.id)}">
      <header class="livestream-room-head">
        <div>
          <span class="livestream-live-badge"><i></i> LIVE</span>
          <div>
            <h3>${escapeHtml(room.ownerName)}的翡翠直播间</h3>
            <p>${hostLine ? `${escapeHtml(hostLine)} · 离线也会继续营业` : "我的直播间 · 离线也会继续营业"}</p>
            ${hostLiveChips(room.host, { collapsed: true })}
          </div>
        </div>
        <dl class="livestream-room-metrics">
          <div><dt>点赞</dt><dd>♥ ${Number(room.likes || 0).toLocaleString("zh-CN")}</dd></div>
          <div><dt>在售</dt><dd>${stockCount} 件</dd></div>
          <div><dt>已售</dt><dd>${saleCount} 件</dd></div>
        </dl>
      </header>
      <div class="livestream-owner-grid">
        <div class="livestream-room-stage is-compact" data-livestream-stage>
          ${roomHeroMarkup(room, true)}
        </div>
        <aside class="livestream-owner-ops">
          ${visitHint ? `<div class="livestream-owner-stat"><span>下一波客流</span><strong>${escapeHtml(visitHint)}</strong></div>` : ""}
          ${remainingHint ? `<div class="livestream-owner-stat"><span>剩余时段</span><strong>${escapeHtml(remainingHint)}</strong></div>` : ""}
          <div class="livestream-sell-progress" aria-label="售罄进度">
            <div class="livestream-sell-progress-head">
              <span>售罄进度</span>
              <span>${saleCount}/${listedTotal || saleCount}</span>
            </div>
            <div class="livestream-sell-progress-bar"><i style="width:${progressPct}%"></i></div>
          </div>
          <div class="livestream-recent-host">
            <p class="livestream-ops-label">最近成交</p>
            ${recentSalesMarkup(room)}
          </div>
          <div class="livestream-owner-shelf-host" data-livestream-shelf-host>
            ${shelfMarkup(room)}
          </div>
        </aside>
      </div>
      <footer class="livestream-owner-bar">
        <div class="livestream-owner-actions">
          ${capacity > 0
            ? `<button type="button" class="ghost" data-livestream-action="open-replenish-modal">补货</button>`
            : `<span>货盘已满（${MAX_ROOM_ITEMS} 件）</span>`}
          <button class="danger ghost" type="button" data-livestream-action="close">关闭直播</button>
        </div>
      </footer>
    </article>
    ${capacity > 0 && replenishOpen ? replenishModalMarkup(products, capacity) : ""}
    ${closeConfirmOpen ? closeConfirmModalMarkup() : ""}
  `;
}

function visitorRoomCardMarkup(room) {
  const saleCount = Number(room.totalSales ?? room.sales?.length ?? 0);
  const mine = room.ownerId === getState()?.me?.id;
  return `
    <article class="livestream-room-card is-hall-card ${mine ? "is-mine" : ""}"
      data-room-id="${escapeHtml(room.id)}"
      data-livestream-action="enter-hall-room"
      data-owner-id="${escapeHtml(room.ownerId || "")}"
      role="button"
      tabindex="0"
      aria-label="${escapeHtml(mine ? "进入我的直播间" : `进入${room.ownerName || "玩家"}的直播间`)}">
      <header class="livestream-room-head">
        <div class="livestream-room-head-main">
          <h3>${escapeHtml(room.ownerName)}的翡翠直播间${mine ? "（我的）" : ""}</h3>
        </div>
        <dl class="livestream-room-metrics">
          <div><dt>点赞</dt><dd>♥ ${Number(room.likes || 0).toLocaleString("zh-CN")}</dd></div>
          <div><dt>在售</dt><dd>${room.stockCount || room.items.length} 件</dd></div>
          <div><dt>已售</dt><dd>${saleCount} 件</dd></div>
        </dl>
      </header>
      <div class="livestream-room-stage" data-livestream-stage>
        ${roomHeroMarkup(room, mine, { showChat: false, showFooter: false, showShelf: false })}
      </div>
    </article>
  `;
}

/** 进入他人直播间后的完整观看页（可购买） */
function visitorWatchMarkup(room) {
  const saleCount = Number(room.totalSales ?? room.sales?.length ?? 0);
  return `
    <section class="livestream-watch-section">
      <article class="livestream-room-card is-visitor-watch" data-room-id="${escapeHtml(room.id)}">
        <header class="livestream-room-head">
          <div class="livestream-room-head-main">
            <h3>${escapeHtml(room.ownerName)}的翡翠直播间</h3>
          </div>
          <dl class="livestream-room-metrics">
            <div><dt>点赞</dt><dd>♥ ${Number(room.likes || 0).toLocaleString("zh-CN")}</dd></div>
            <div><dt>在售</dt><dd>${room.stockCount || room.items.length} 件</dd></div>
            <div><dt>已售</dt><dd>${saleCount} 件</dd></div>
          </dl>
        </header>
        <div class="livestream-room-stage" data-livestream-stage>
          ${roomHeroMarkup(room, false)}
        </div>
      </article>
    </section>
  `;
}

export function trimLivestreamSelection(selection, capacity) {
  const limit = Math.max(0, Math.floor(Number(capacity) || 0));
  for (const productId of [...selection].slice(limit)) selection.delete(productId);
  return selection;
}

function applySelectAll(products, capacity, checked) {
  selectedProductIds.clear();
  if (!checked) return;
  const limit = Math.max(0, Math.floor(Number(capacity) || 0));
  for (const item of products) {
    if (selectedProductIds.size >= limit) break;
    selectedProductIds.add(item.id);
  }
}

function reconcileSelection(products, capacity) {
  const productIds = new Set(products.map((item) => item.id));
  for (const productId of [...selectedProductIds]) {
    if (!productIds.has(productId)) selectedProductIds.delete(productId);
  }
  trimLivestreamSelection(selectedProductIds, capacity);
}

function selectedListings(capacity = MAX_ROOM_ITEMS) {
  const availableIds = new Set(finishedProducts().map((item) => item.id));
  return [...selectedProductIds]
    .filter((productId) => availableIds.has(productId))
    .slice(0, Math.max(0, capacity))
    .map((productId) => ({
      productId,
      price: Number(priceDrafts.get(productId))
    }));
}

function syncSelectionControls() {
  const picker = elsRef.livestream?.querySelector(".livestream-stock-picker:not(.is-empty)");
  if (!picker) return;
  const isStart = picker.dataset.pickerMode === "start";
  const capacity = Math.max(0, Number(picker.dataset.capacity || MAX_ROOM_ITEMS));
  trimLivestreamSelection(selectedProductIds, capacity);
  const selected = [...selectedProductIds];
  const validPrices = selected.every((productId) => {
    const price = Number(priceDrafts.get(productId));
    return Number.isInteger(price) && price >= LIVESTREAM_MIN_PRICE;
  });
  const minimum = isStart ? MIN_ROOM_ITEMS : 1;
  const canSubmit = selected.length >= minimum && selected.length <= capacity && validPrices;
  const count = picker.querySelector("[data-livestream-selected-count]");
  if (count) count.textContent = `${selected.length}/${capacity}`;

  const products = finishedProducts();
  const summary = selectionSummary(products);
  const summaryEl = picker.querySelector(".livestream-stock-summary span");
  if (summaryEl) {
    summaryEl.innerHTML = `${summary.count} 件 · 总标价 <b>${formatMoney(summary.totalPrice)}</b> · 均价相对估值 ${escapeHtml(summary.pctLabel)}`;
  }

  picker.querySelectorAll(".livestream-stock-row, .livestream-stock-card").forEach((card) => {
    const productId = card.dataset.productId;
    const isSelected = selectedProductIds.has(productId);
    const checkbox = card.querySelector("[data-livestream-select]");
    card.classList.toggle("is-selected", isSelected);
    if (checkbox) {
      checkbox.checked = isSelected;
      checkbox.disabled = !isSelected && selected.length >= capacity;
    }
  });

  const selectAll = picker.querySelector("[data-livestream-select-all]");
  if (selectAll) {
    const selectable = visibleStockProducts(products).slice(0, capacity);
    const allOn = selectable.length > 0
      && selectable.every((item) => selectedProductIds.has(item.id));
    selectAll.checked = allOn;
    selectAll.closest(".livestream-select-all")?.classList.toggle("is-checked", allOn);
  }

  if (isStart) {
    const startBtn = picker.querySelector('[data-livestream-action="start"]');
    if (startBtn) {
      startBtn.disabled = !canSubmit;
      startBtn.textContent = canSubmit ? `开启直播（${selected.length} 件）` : "至少选择 3 件";
    }
    return;
  }

  const button = picker.querySelector('[data-livestream-action="replenish"]');
  if (button) {
    button.disabled = !canSubmit;
    button.textContent = canSubmit ? `确认补货（${selected.length} 件）` : "选择要补货的成品";
  }
}

function syncShelfCurrent(root, room) {
  if (!root || !room) return;
  const index = currentSlideIndex(room);
  root.querySelectorAll(".livestream-shelf-thumb[data-slide-index]").forEach((thumb) => {
    const on = Number(thumb.dataset.slideIndex) === index;
    thumb.classList.toggle("is-current", on);
    thumb.setAttribute("aria-current", on ? "true" : "false");
  });
}

function refreshRoomStage(roomId) {
  const state = getState();
  const myRoom = state?.me?.livestreamRoom;
  const room = myRoom?.id === roomId ? myRoom : roomForId(roomId);
  const card = elsRef.livestream?.querySelector(`[data-room-id="${CSS.escape(roomId)}"]`);
  const stage = card?.querySelector("[data-livestream-stage]");
  if (!room || !stage) return;
  captureChatScroll(stage);
  captureShelfScroll(card);
  const mine = room.ownerId === state.me.id || myRoom?.id === roomId;
  const hallCard = card.classList.contains("is-hall-card");

  stage.innerHTML = roomHeroMarkup(room, mine, hallCard
    ? { showChat: false, showFooter: false, showShelf: false }
    : undefined);

  // 主播货盘在右侧独立节点：切讲品只改高亮，不重建
  const shelfHost = card.querySelector("[data-livestream-shelf-host]");
  if (shelfHost) {
    syncShelfCurrent(shelfHost, room);
  }

  paintProductCanvases();
  restoreChatScroll(stage, roomId);
  restoreShelfScroll(card, roomId);
}

function moveSlide(roomId, delta) {
  const state = getState();
  const myRoom = state?.me?.livestreamRoom;
  const room = myRoom?.id === roomId ? myRoom : roomForId(roomId);
  if (!room?.items?.length) return;
  if (buyConfirm?.roomId === roomId) buyConfirm = null;
  slideIndexByRoom.set(roomId, currentSlideIndex(room) + delta);
  refreshRoomStage(roomId);
}

function selectSlide(roomId, index) {
  const state = getState();
  const myRoom = state?.me?.livestreamRoom;
  const room = myRoom?.id === roomId ? myRoom : roomForId(roomId);
  if (!room?.items?.length) return;
  if (buyConfirm?.roomId === roomId) buyConfirm = null;
  const next = Math.max(0, Math.min(room.items.length - 1, Number(index) || 0));
  slideIndexByRoom.set(roomId, next);
  refreshRoomStage(roomId);
}

function advanceVisibleCarousels() {
  if (getActiveView?.() !== "livestream") return;
  if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
  if (buyConfirm) return;
  if (watchingRoomId) {
    moveSlide(watchingRoomId, 1);
    return;
  }
  if (activeLivestreamTab === "mine") {
    const myRoom = getState()?.me?.livestreamRoom;
    if (myRoom?.id) moveSlide(myRoom.id, 1);
    return;
  }
  for (const room of rooms()) {
    moveSlide(room.id, 1);
  }
}

function clearWatchingRoom() {
  watchingRoomId = null;
  buyConfirm = null;
}

function enterHallRoom(roomId, ownerId) {
  const me = getState()?.me;
  if (me?.id && ownerId && ownerId === me.id) {
    clearWatchingRoom();
    setLivestreamTab("mine");
    return;
  }
  const room = roomForId(roomId) || (me?.livestreamRoom?.id === roomId ? me.livestreamRoom : null);
  if (!room?.id) return;
  watchingRoomId = room.id;
  buyConfirm = null;
  activeLivestreamTab = "hall";
  lastLivestreamRenderFp = "";
  renderLivestream();
}

function setLivestreamTab(tabId) {
  const next = tabId === "mine" ? "mine" : "hall";
  const wasWatching = Boolean(watchingRoomId);
  if (next === "hall") clearWatchingRoom();
  else watchingRoomId = null;
  if (activeLivestreamTab === next && !wasWatching) return;
  activeLivestreamTab = next;
  if (next !== "hall") buyConfirm = null;
  if (next !== "mine") {
    closeConfirmOpen = false;
    hostModalOpen = false;
    modalHostId = null;
  }
  renderLivestream();
}

function tabsMarkup() {
  const onMine = activeLivestreamTab === "mine";
  if (onMine) {
    const liveHint = getState()?.me?.livestreamRoom
      ? `<span class="livestream-nav-hint">售罄自动关闭 · 离线继续营业</span>`
      : "";
    return `
    <div class="livestream-top-nav is-mine-nav">
      <button type="button" class="livestream-back-btn" data-livestream-action="goto-hall-tab">返回</button>
      ${liveHint}
    </div>
    `;
  }
  if (watchingRoomId) {
    const room = roomForId(watchingRoomId);
    const label = room?.ownerName ? `${room.ownerName}的翡翠直播间` : "直播间";
    return `
    <div class="livestream-top-nav is-mine-nav">
      <button type="button" class="livestream-back-btn" data-livestream-action="goto-hall-tab">返回</button>
      <span class="livestream-nav-hint">${escapeHtml(label)}</span>
    </div>
    `;
  }
  return `
    <div class="livestream-top-nav">
      <div class="shop-tabs livestream-tabs" role="tablist" aria-label="直播间分区">
        <button class="shop-tab active"
          type="button" role="tab" aria-selected="true"
          data-livestream-tab="hall">翡翠街</button>
      </div>
    </div>
  `;
}

function mineEntryCardMarkup({ live = false, myRoom = null } = {}) {
  const title = "我的直播";
  const desc = myRoom
    ? `在售 ${Number(myRoom.items?.length || 0)} 件 · 点进来看摊位`
    : "挑选货盘开播，主播可选";
  const cta = myRoom ? "查看摊位" : "点击开播";
  return `
    <button type="button" class="livestream-mine-entry${live ? " is-live" : ""}"
      data-livestream-action="goto-mine-tab"
      aria-label="${myRoom ? "查看我的直播" : "去我的直播开播"}">
      <span class="lme-photo" aria-hidden="true"></span>
      <span class="lme-tint" aria-hidden="true"></span>
      <span class="lme-shade" aria-hidden="true"></span>
      <span class="lme-content">
        <span class="lme-top">
          <span class="lme-title">${title}</span>
          ${live ? '<span class="livestream-tab-live"><i></i>LIVE</span>' : ""}
        </span>
        <span class="lme-desc">${escapeHtml(desc)}</span>
      </span>
      <span class="lme-cta">${cta}<span aria-hidden="true"> →</span></span>
    </button>
  `;
}

function applyPricePreset(mult) {
  if (!selectedProductIds.size) {
    showToast?.("请先勾选要改价的商品");
    return;
  }
  const products = finishedProducts();
  const byId = new Map(products.map((item) => [item.id, item]));
  for (const id of selectedProductIds) {
    const item = byId.get(id);
    if (!item) continue;
    priceDrafts.set(id, Math.max(LIVESTREAM_MIN_PRICE, Math.round(itemValue(item) * Number(mult))));
  }
  // A preset can restore a previously rendered price after an in-place edit.
  lastLivestreamRenderFp = "";
  renderLivestream();
}

function emitStart() {
  const host = resolveSelectedHost();
  const items = selectedListings(MAX_ROOM_ITEMS);
  if (items.length < MIN_ROOM_ITEMS) return;
  hostModalOpen = false;
  modalHostId = null;
  socketRef.emit("startLivestreamRoom", {
    items,
    workerId: host?.id || null,
    talkStyle: normalizeTalkStyle(draftTalkStyle),
    requestId: requestId("livestream-start")
  });
}

function emitReplenish() {
  const roomCount = Number(getState()?.me?.livestreamRoom?.items?.length || 0);
  const items = selectedListings(Math.max(0, MAX_ROOM_ITEMS - roomCount));
  if (!items.length) return;
  socketRef.emit("replenishLivestreamRoom", {
    items,
    requestId: requestId("livestream-replenish")
  });
  selectedProductIds.clear();
  replenishOpen = false;
}

function emitClose() {
  closeConfirmOpen = false;
  socketRef.emit("closeLivestreamRoom", {
    requestId: requestId("livestream-close")
  });
}

function emitBuy(roomId, itemId) {
  socketRef.emit("buyLivestreamRoomItem", {
    roomId,
    itemId,
    requestId: requestId("livestream-buy")
  });
  buyConfirm = null;
}

function bindLivestreamOnce() {
  if (!elsRef.livestream || boundRoot === elsRef.livestream) return;
  boundRoot = elsRef.livestream;
  boundRoot.addEventListener("change", (event) => {
    const stockFilter = event.target.closest("[data-livestream-stock-filter]");
    const stockSort = event.target.closest("[data-livestream-stock-sort]");
    if (stockFilter || stockSort) {
      if (stockFilter) stockPickerFilter = stockFilter.value || "all";
      if (stockSort) stockPickerSort = stockSort.value || "valueDesc";
      lastLivestreamRenderFp = "";
      renderLivestream();
      return;
    }
    const selectAll = event.target.closest("[data-livestream-select-all]");
    if (selectAll) {
      const picker = selectAll.closest(".livestream-stock-picker");
      const capacity = Math.max(0, Number(picker?.dataset?.capacity || MAX_ROOM_ITEMS));
      applySelectAll(visibleStockProducts(finishedProducts()), capacity, selectAll.checked);
      syncSelectionControls();
      return;
    }
    const checkbox = event.target.closest("[data-livestream-select]");
    if (!checkbox) return;
    const productId = checkbox.dataset.livestreamSelect;
    if (checkbox.checked) selectedProductIds.add(productId);
    else selectedProductIds.delete(productId);
    syncSelectionControls();
  });
  boundRoot.addEventListener("input", (event) => {
    const search = event.target.closest("[data-livestream-stock-search]");
    if (search) {
      stockPickerQuery = search.value;
      const cursor = search.selectionStart;
      lastLivestreamRenderFp = "";
      renderLivestream();
      const next = elsRef.livestream?.querySelector("[data-livestream-stock-search]");
      next?.focus?.();
      if (next && cursor != null) next.setSelectionRange?.(cursor, cursor);
      return;
    }
    const input = event.target.closest("[data-livestream-price]");
    if (!input) return;
    priceDrafts.set(input.dataset.livestreamPrice, Number(input.value));
    syncSelectionControls();
  });
  boundRoot.addEventListener("wheel", (event) => {
    const scroller = event.target.closest("[data-livestream-shelf-scroll]");
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth + 1) return;
    // 竖向滚轮转到横向，方便货盘滑动
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;
    if (!delta) return;
    const before = scroller.scrollLeft;
    scroller.scrollLeft += delta;
    if (scroller.scrollLeft !== before) event.preventDefault();
  }, { passive: false });

  let shelfDrag = null;
  const endShelfDrag = () => {
    if (!shelfDrag) return;
    const { scroller, pointerId, moved } = shelfDrag;
    shelfDrag = null;
    scroller.classList.remove("is-dragging");
    try { scroller.releasePointerCapture?.(pointerId); } catch (_) { /* ignore */ }
    if (moved) {
      const suppress = (clickEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        scroller.removeEventListener("click", suppress, true);
      };
      scroller.addEventListener("click", suppress, true);
      globalThis.setTimeout(() => scroller.removeEventListener("click", suppress, true), 0);
    }
  };
  boundRoot.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    const scroller = event.target.closest("[data-livestream-shelf-scroll]");
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth + 1) return;
    shelfDrag = {
      scroller,
      pointerId: event.pointerId,
      startX: event.clientX,
      startLeft: scroller.scrollLeft,
      moved: false
    };
    scroller.classList.add("is-dragging");
    try { scroller.setPointerCapture?.(event.pointerId); } catch (_) { /* ignore */ }
  });
  boundRoot.addEventListener("pointermove", (event) => {
    if (!shelfDrag || shelfDrag.pointerId !== event.pointerId) return;
    const dx = event.clientX - shelfDrag.startX;
    if (Math.abs(dx) > 3) shelfDrag.moved = true;
    shelfDrag.scroller.scrollLeft = shelfDrag.startLeft - dx;
    if (shelfDrag.moved) event.preventDefault();
  });
  boundRoot.addEventListener("pointerup", endShelfDrag);
  boundRoot.addEventListener("pointercancel", endShelfDrag);

  boundRoot.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest("[data-livestream-action='enter-hall-room']");
    if (!card || event.target !== card) return;
    event.preventDefault();
    card.click();
  });

  boundRoot.addEventListener("click", (event) => {
    const stockRow = event.target.closest(".livestream-stock-row");
    if (stockRow) {
      const checkbox = stockRow.querySelector("[data-livestream-select]");
      const productId = checkbox?.dataset?.livestreamSelect;
      const picker = stockRow.closest("[data-capacity]");
      const capacity = Math.max(0, Number(picker?.dataset?.capacity || MAX_ROOM_ITEMS));
      // 已满档时 checkbox 为 disabled，点击无 change；在此补飘字提示
      if (checkbox?.disabled && productId && !selectedProductIds.has(productId)) {
        event.preventDefault();
        showToast?.({
          text: capacity > 0
            ? `已选满 ${capacity} 件，无法继续添加`
            : "货盘已满，无法继续添加",
          tone: "warn"
        });
        return;
      }
    }
    const tabBtn = event.target.closest("[data-livestream-tab]");
    if (tabBtn) {
      setLivestreamTab(tabBtn.dataset.livestreamTab);
      return;
    }
    const sortBtn = event.target.closest("[data-hall-sort]");
    if (sortBtn) {
      hallSort = sortBtn.dataset.hallSort || "newest";
      renderLivestream();
      return;
    }
    const button = event.target.closest("[data-livestream-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.livestreamAction;
    if (action === "goto-mine-tab") {
      setLivestreamTab("mine");
      return;
    }
    if (action === "enter-hall-room") {
      enterHallRoom(button.dataset.roomId, button.dataset.ownerId || "");
      return;
    }
    if (action === "goto-hall-tab") {
      setLivestreamTab("hall");
      return;
    }
    if (action === "previous") moveSlide(button.dataset.roomId, -1);
    if (action === "next") moveSlide(button.dataset.roomId, 1);
    if (action === "select-slide") selectSlide(button.dataset.roomId, button.dataset.slideIndex);
    if (action === "select-host") {
      draftHostId = button.dataset.workerId || null;
      renderLivestream();
      return;
    }
    if (action === "clear-host") {
      draftHostId = null;
      renderLivestream();
      return;
    }
    if (action === "open-host-modal") {
      modalHostId = draftHostId;
      hostModalOpen = true;
      renderLivestream();
      return;
    }
    if (action === "close-host-modal") {
      hostModalOpen = false;
      modalHostId = null;
      renderLivestream();
      return;
    }
    if (action === "select-modal-host") {
      modalHostId = button.dataset.workerId || null;
      renderLivestream();
      return;
    }
    if (action === "clear-modal-host") {
      modalHostId = null;
      renderLivestream();
      return;
    }
    if (action === "confirm-host-modal") {
      draftHostId = modalHostId;
      hostModalOpen = false;
      modalHostId = null;
      renderLivestream();
      return;
    }
    if (action === "toggle-host-details") {
      hostDetailsOpen = !hostDetailsOpen;
      renderLivestream();
      return;
    }
    if (action === "price-preset") {
      applyPricePreset(button.dataset.priceMult);
      return;
    }
    if (action === "open-replenish-modal") {
      replenishOpen = true;
      renderLivestream();
      return;
    }
    if (action === "close-replenish-modal") {
      replenishOpen = false;
      selectedProductIds.clear();
      renderLivestream();
      return;
    }
    if (action === "start") emitStart();
    if (action === "replenish") emitReplenish();
    if (action === "close") {
      closeConfirmOpen = true;
      renderLivestream();
      return;
    }
    if (action === "cancel-close") {
      closeConfirmOpen = false;
      renderLivestream();
      return;
    }
    if (action === "confirm-close") emitClose();
    if (action === "buy") {
      buyConfirm = { roomId: button.dataset.roomId, itemId: button.dataset.itemId };
      renderLivestream();
      return;
    }
    if (action === "cancel-buy") {
      buyConfirm = null;
      renderLivestream();
      return;
    }
    if (action === "confirm-buy") emitBuy(button.dataset.roomId, button.dataset.itemId);
  });
}

export function initLivestreamModule(deps) {
  socketRef = deps.socket;
  getState = deps.getState;
  elsRef = deps.els;
  getActiveView = deps.getActiveView;
  ({
    finishedProducts,
    productCanvas,
    formatMoney,
    escapeHtml,
    empty,
    paintProductCanvases,
    showToast
  } = deps.helpers);
  bindLivestreamOnce();
  if (!carouselTimer) carouselTimer = globalThis.setInterval(advanceVisibleCarousels, CAROUSEL_INTERVAL_MS);
  if (!chatTickTimer) scheduleChatTick();
}

/** Carry a finished product from inventory into the owner's live-sale picker. */
export function focusLivestreamProduct(rawProductId) {
  const productId = String(rawProductId || "").trim();
  const product = finishedProducts().find((item) => String(item.id) === productId);
  if (!product) {
    showToast?.({ text: "这件成品已不在可直播库存中。", tone: "warn" });
    return false;
  }
  selectedProductIds.add(product.id);
  if (!priceDrafts.has(product.id)) priceDrafts.set(product.id, defaultPrice(product));
  stockPickerQuery = product.name || "";
  stockPickerFilter = "all";
  stockPickerSort = "selected";
  activeLivestreamTab = "mine";
  watchingRoomId = null;
  lastLivestreamRenderFp = "";
  renderLivestream();
  elsRef.livestream?.querySelector(`[data-product-id="${CSS.escape(product.id)}"]`)?.scrollIntoView?.({ block: "center" });
  return true;
}

export function renderLivestream() {
  const state = getState();
  if (!state?.me || !elsRef.livestream) return;
  const products = finishedProducts();
  const myRoom = state.me.livestreamRoom;
  const capacity = myRoom ? Math.max(0, MAX_ROOM_ITEMS - myRoom.items.length) : MAX_ROOM_ITEMS;
  if (myRoom) {
    if (capacity <= 0) replenishOpen = false;
  } else {
    replenishOpen = false;
    closeConfirmOpen = false;
  }
  const hallRoomMap = new Map();
  for (const room of state.livestreamRooms || []) {
    if (room?.id) hallRoomMap.set(room.id, room);
  }
  // 自己的房间以 me.livestreamRoom 为准，确保开播后一定出现在大厅列表
  if (myRoom?.id) hallRoomMap.set(myRoom.id, myRoom);
  const publicRooms = sortHallRooms([...hallRoomMap.values()], hallSort);
  let watchedRoom = watchingRoomId ? hallRoomMap.get(watchingRoomId) || roomForId(watchingRoomId) : null;
  if (watchingRoomId && !watchedRoom) {
    clearWatchingRoom();
    watchedRoom = null;
  }
  const hasPermit = Boolean(state.me.assets?.livestreamPermitOwned);
  reconcileSelection(products, capacity);
  const hosts = availableHosts();
  const selectedHost = resolveSelectedHost();
  const fp = [
    hasPermit ? 1 : 0,
    employeePayrollStatus(state.me, payrollNowMs()), state.me.employeePayroll?.debt || 0,
    activeLivestreamTab,
    watchingRoomId || "",
    draftHostId || "",
    modalHostId || "",
    hostModalOpen ? 1 : 0,
    draftTalkStyle,
    hostDetailsOpen ? 1 : 0,
    replenishOpen ? 1 : 0,
    closeConfirmOpen ? 1 : 0,
    hallSort,
    stockPickerQuery,
    stockPickerFilter,
    stockPickerSort,
    buyConfirm ? `${buyConfirm.roomId}:${buyConfirm.itemId}` : "",
    [...selectedProductIds].join(","),
    [...priceDrafts.entries()].map(([id, price]) => `${id}:${price}`).join("|"),
    products.map((item) => `${item.id}:${item.value ?? item.price ?? ""}`).join("|"),
    JSON.stringify(state.me.systemDemand || {}),
    myRoom
      ? `${myRoom.id}:${(myRoom.items || []).map((item) => `${item.id}:${item.price ?? ""}`).join(",")}:${myRoom.totalSales}:${myRoom.likes}:${myRoom.nextAiVisitAt || ""}:${myRoom.endsAt || ""}:${myRoom.hardEndsAt || ""}:${(myRoom.sales || []).map((s) => s.id).join(",")}`
      : "",
    publicRooms.map((room) => `${room.id}:${room.ownerId}:${(room.items || []).length}:${room.hostName || ""}:${room.likes}:${room.totalSales}:${(room.sales || []).map((s) => s.id || s.soldAt || "").join(",")}`).join("|"),
    watchedRoom
      ? `${watchedRoom.id}:${(watchedRoom.items || []).map((item) => `${item.id}:${item.price ?? ""}`).join(",")}:${watchedRoom.totalSales}:${watchedRoom.likes}`
      : "",
    (state.me.livestreamHistory || []).length,
    hosts.map((host) => `${host.id}:${host.busy ? 1 : 0}`).join(",")
  ].join("::");
  if (fp === lastLivestreamRenderFp && elsRef.livestream.childElementCount) {
    syncSelectionControls();
    return;
  }
  lastLivestreamRenderFp = fp;
  captureChatScroll();
  captureShelfScroll();
  const preservedShelves = capturePreservedShelves();
  pruneChatFeeds([
    myRoom?.id,
    ...publicRooms.map((room) => room.id)
  ].filter(Boolean));
  for (const id of [...shelfScrollByRoom.keys()]) {
    if (id !== myRoom?.id && !publicRooms.some((room) => room.id === id)) {
      shelfScrollByRoom.delete(id);
    }
  }

  const ownerSection = myRoom
    ? `
      <section class="livestream-owner-section">
        <div class="livestream-section-title">
          <div><p class="eyebrow">我的摊位</p><h3>本场营业中</h3></div>
        </div>
        ${ownerDashboardMarkup(myRoom, products, capacity)}
        <button type="button" class="ghost livestream-switch-tab"
          data-livestream-action="goto-hall-tab">去翡翠街看看别人</button>
      </section>
    `
    : hasPermit
      ? `
      <section class="livestream-owner-section" id="livestream-owner-wizard">
        ${startWizardMarkup(hosts, selectedHost, products)}
      </section>
      `
      : `
      <section class="livestream-locked-panel">
        <span class="livestream-live-badge"><i></i> LOCKED</span>
        <h3>还不能开启自己的直播间</h3>
        <p>购买经营许可后，可选 ${MIN_ROOM_ITEMS}–${MAX_ROOM_ITEMS} 件成品开播，主播可稍后安排；逛直播间和购买商品无需许可。</p>
        <button type="button" data-view-link="shop">前往商铺</button>
      </section>
    `;

  const hallSection = `
    <section class="livestream-hall-section">
      <div class="livestream-section-title">
        <div><p class="eyebrow">翡翠街摊位</p><h3>营业中的房间</h3></div>
      </div>
      ${mineEntryCardMarkup({ live: Boolean(myRoom), myRoom })}
      <div class="livestream-hall-toolbar">
        <div class="livestream-hall-sort" role="group" aria-label="大厅排序">
          ${HALL_SORTS.map((entry) => `
            <button type="button" class="${hallSort === entry.id ? "is-active" : ""}"
              data-hall-sort="${entry.id}">${escapeHtml(entry.label)}</button>
          `).join("")}
        </div>
        <span class="livestream-hall-count">${publicRooms.length} 个直播间营业中</span>
      </div>
      <div class="livestream-room-grid">
        ${publicRooms.length
          ? publicRooms.map((room) => visitorRoomCardMarkup(room)).join("")
          : `
            <div class="livestream-hall-empty game-empty-state">
              <span class="game-empty-state-mark" aria-hidden="true">播</span>
              <strong>暂时没有其他直播间营业</strong>
              <p>${myRoom
                ? "你的房间正在营业，可以回到本场摊位查看轮播和成交。"
                : hasPermit
                  ? `准备至少 ${MIN_ROOM_ITEMS} 件成品后，就能开设自己的直播间。`
                  : "逛直播无需许可；若想自己开播，可以先到商铺购买经营许可。"}</p>
              ${myRoom
                ? '<button type="button" data-livestream-action="goto-mine-tab">回到我的摊位</button>'
                : hasPermit
                  ? '<button type="button" data-livestream-action="goto-mine-tab">去准备开播</button>'
                  : '<button type="button" data-view-link="shop">查看经营许可</button>'}
            </div>
          `}
      </div>
    </section>
  `;

  const tabBody = activeLivestreamTab === "mine"
    ? ownerSection
    : watchedRoom
      ? visitorWatchMarkup(watchedRoom)
      : hallSection;

  elsRef.livestream.innerHTML = `
    ${payrollWorkNotice(state.me, { now: payrollNowMs(), formatMoney })}
    <div class="livestream-layout">
      ${tabsMarkup()}
      ${tabBody}
    </div>
  `;
  restorePreservedShelves(preservedShelves);
  syncSelectionControls();
  observeLazyPreviews(elsRef.livestream);
  paintProductCanvases?.();
  restoreChatScroll();
  restoreShelfScroll();
}
