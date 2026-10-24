// 聊天/消息系统模块（从 main.js 抽离，依赖注入解耦）
let getState;
let elsRef;
let socketRef;
let openBillViewRef = null;
let activeMessageChannel = "attention";
let chatdockCompact = false;
const CHATDOCK_COMPACT_KEY = "jade-chatdock-compact";
const CHAT_SEEN_KEY = "jade-message-seen-v2";
const CHAT_SEEN_LIMIT = 320;
/** iOS sheet 风格：快起慢停，单通道高度动画 */
const CHATDOCK_MOTION_MS = 420;
const CHATDOCK_MOTION_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const CHATDOCK_HEIGHT_EXPANDED = 270;
const CHATDOCK_HEIGHT_COMPACT = 100; // 3×28 + 2×8
let chatdockAnimating = false;
let chatdockHeightAnim = null;
let seenStoreReady = false;
let forceScrollOnNextRender = true;
let lastRenderedMessageIds = new Set();
let nowMs, formatMoney, formatDuration, escapeHtml, empty, gameClock, auctionPhaseMeta, reminderRows, inventoryCounts, showToast;

function prefersReducedChatdockMotion() {
  return typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function chatdockMotionEnabled() {
  return desktopChatdockEnabled() && !prefersReducedChatdockMotion();
}

function updateChatdockCompactButton(compact) {
  const btn = elsRef?.chatDockCompactBtn;
  if (!btn) return;
  btn.setAttribute("aria-expanded", String(!compact));
  btn.title = compact ? "展开频道" : "收起频道";
  btn.textContent = compact ? "展开" : "收起";
}

function applyChatdockCompactState(compact, { rerender = true } = {}) {
  const mode = compact ? "compact" : "expanded";
  elsRef?.chatDock?.setAttribute("data-chatdock", mode);
  elsRef?.shell?.setAttribute("data-chatdock", mode);
  updateChatdockCompactButton(compact);
  if (rerender && elsRef?.homeMessageLog) renderHomeMessages();
}

function chatdockTargetHeight(compact) {
  return compact ? CHATDOCK_HEIGHT_COMPACT : CHATDOCK_HEIGHT_EXPANDED;
}

function clearChatdockInlineMotion(dock) {
  if (!dock?.style) return;
  dock.style.height = "";
  dock.style.maxHeight = "";
  dock.style.overflow = "";
  dock.style.transition = "";
  if (dock.classList) dock.classList.remove("is-chatdock-animating");
}

function waitMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function runChatdockHeightAnimation(dock, fromPx, toPx) {
  if (typeof dock.animate === "function") {
    chatdockHeightAnim?.cancel?.();
    const anim = dock.animate(
      [
        { height: `${fromPx}px`, maxHeight: `${fromPx}px` },
        { height: `${toPx}px`, maxHeight: `${toPx}px` }
      ],
      {
        duration: CHATDOCK_MOTION_MS,
        easing: CHATDOCK_MOTION_EASE,
        fill: "forwards"
      }
    );
    chatdockHeightAnim = anim;
    return anim.finished
      .catch(() => {})
      .finally(() => {
        try { anim.cancel(); } catch { /* ignore */ }
        if (chatdockHeightAnim === anim) chatdockHeightAnim = null;
      });
  }
  dock.style.transition = `height ${CHATDOCK_MOTION_MS}ms ${CHATDOCK_MOTION_EASE}, max-height ${CHATDOCK_MOTION_MS}ms ${CHATDOCK_MOTION_EASE}`;
  dock.style.height = `${toPx}px`;
  dock.style.maxHeight = `${toPx}px`;
  return waitMs(CHATDOCK_MOTION_MS + 24);
}

/**
 * FLIP 抽屉：先锁当前高度 → 瞬间切布局 → 只动画 height。
 * shell 第三行用 auto，主内容区会跟着丝滑让位。
 */
async function animateChatdockCompact(nextCompact) {
  if (!desktopChatdockEnabled()) {
    chatdockCompact = Boolean(nextCompact);
    applyChatdockCompactState(chatdockCompact);
    return;
  }
  if (chatdockAnimating) return;
  if (Boolean(nextCompact) === chatdockCompact) return;

  const dock = elsRef?.chatDock;
  const btn = elsRef?.chatDockCompactBtn;
  if (!dock) {
    chatdockCompact = Boolean(nextCompact);
    writeStoredChatdockCompact(chatdockCompact);
    applyChatdockCompactState(chatdockCompact);
    return;
  }

  if (!chatdockMotionEnabled()) {
    chatdockCompact = Boolean(nextCompact);
    writeStoredChatdockCompact(chatdockCompact);
    applyChatdockCompactState(chatdockCompact);
    return;
  }

  chatdockAnimating = true;
  if (btn) btn.disabled = true;
  if (dock.classList) dock.classList.add("is-chatdock-animating");

  try {
    const fromPx = Math.round(dock.getBoundingClientRect?.().height || chatdockTargetHeight(chatdockCompact));
    const toPx = chatdockTargetHeight(nextCompact);

    dock.style.transition = "none";
    dock.style.height = `${fromPx}px`;
    dock.style.maxHeight = `${fromPx}px`;
    dock.style.overflow = "hidden";

    chatdockCompact = Boolean(nextCompact);
    writeStoredChatdockCompact(chatdockCompact);
    applyChatdockCompactState(chatdockCompact, { rerender: true });

    // 强制重绘，保证「锁高 + 新布局」已生效后再开动画
    void dock.offsetHeight;

    if (Math.abs(fromPx - toPx) < 1) return;

    await runChatdockHeightAnimation(dock, fromPx, toPx);
  } finally {
    clearChatdockInlineMotion(dock);
    chatdockAnimating = false;
    if (btn) btn.disabled = false;
  }
}

function desktopChatdockEnabled() {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
}

function readStoredChatdockCompact() {
  try {
    const stored = localStorage.getItem(CHATDOCK_COMPACT_KEY);
    return stored == null ? true : stored === "1";
  } catch {
    return true;
  }
}

function writeStoredChatdockCompact(compact) {
  try {
    localStorage.setItem(CHATDOCK_COMPACT_KEY, compact ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}

export function isChatdockCompact() {
  return desktopChatdockEnabled() && chatdockCompact;
}

export function applyChatdockCompact(forceCompact = null) {
  if (forceCompact != null) chatdockCompact = Boolean(forceCompact);
  applyChatdockCompactState(isChatdockCompact());
}

export function toggleChatdockCompact() {
  if (!desktopChatdockEnabled()) return;
  void animateChatdockCompact(!chatdockCompact);
}

function readSeenMessageIds() {
  try {
    const raw = localStorage.getItem(CHAT_SEEN_KEY);
    if (raw == null) return { ids: new Set(), initialized: false };
    const ids = JSON.parse(raw);
    return {
      ids: new Set(Array.isArray(ids) ? ids.map(String).slice(-CHAT_SEEN_LIMIT) : []),
      initialized: true
    };
  } catch {
    return { ids: new Set(), initialized: false };
  }
}

function writeSeenMessageIds() {
  try {
    const ids = [...seenMessageIds].slice(-CHAT_SEEN_LIMIT);
    localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify(ids));
    if (seenMessageIds.size > CHAT_SEEN_LIMIT) seenMessageIds = new Set(ids);
  } catch {
    /* ignore quota / private mode */
  }
}

function chatPanelIsOpenForReading() {
  if (desktopChatdockEnabled()) return !chatdockCompact;
  return elsRef?.shell?.getAttribute?.("data-mobile-pane") === "chat";
}

export function initChatModule(deps) {
  getState = deps.getState;
  elsRef = deps.els;
  socketRef = deps.socket || null;
  openBillViewRef = typeof deps.openBillView === "function" ? deps.openBillView : null;
  ({ nowMs, formatMoney, formatDuration, escapeHtml, empty, gameClock, auctionPhaseMeta, reminderRows, inventoryCounts, showToast } = deps.helpers);
  const storedSeen = readSeenMessageIds();
  seenMessageIds = storedSeen.ids;
  seenStoreReady = storedSeen.initialized;
  chatdockCompact = readStoredChatdockCompact();
  applyChatdockCompact();
  elsRef?.chatDockCompactBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleChatdockCompact();
  });
  if (typeof window !== "undefined") {
    window.matchMedia("(min-width: 768px)").addEventListener("change", () => applyChatdockCompact());
  }
  elsRef?.chatDockToggle?.addEventListener("click", () => {
    const rerender = () => {
      forceScrollOnNextRender = true;
      renderHomeMessages();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(rerender);
    else setTimeout(rerender, 0);
  });
  const register = deps.registerAction;
  if (typeof register === "function") {
    register("selectMessageChannel", ({ target }) => chatSelectChannel(target.dataset.messageChannel));
    register("scrollChatLatest", () => scrollHomeMessagesToLatest());
    register("openMessageBill", () => openBillViewRef?.({ grain: "day" }));
  }
}

const messageChannelDefinitions = [
  { id: "all", label: "全部" },
  { id: "attention", label: "关注" },
  { id: "world", label: "世界" },
  { id: "trade", label: "交易" },
  { id: "announcement", label: "公告" },
  { id: "record", label: "记录" },
];

let seenMessageIds = new Set();

function channelRows(rows, channelId) {
  return channelId === "all" ? rows : rows.filter((row) => row.channel === channelId);
}

function markChannelMessagesRead(rows, channelId) {
  let changed = false;
  for (const row of channelRows(rows, channelId)) {
    if (row?.id == null || row.unreadEligible === false) continue;
    const id = String(row.id);
    if (!seenMessageIds.has(id)) changed = true;
    seenMessageIds.add(id);
  }
  if (changed) writeSeenMessageIds();
}

function unreadCountForChannel(rows, channelId) {
  return channelRows(rows, channelId).filter((row) => (
    row?.id != null
    && row.unreadEligible !== false
    && !seenMessageIds.has(String(row.id))
  )).length;
}

function formatUnreadBadge(count) {
  const unread = Number(count || 0);
  if (!unread) return "";
  const label = unread > 99 ? "99+" : String(unread);
  return `<span class="chatdock-tab-cnt">${escapeHtml(label)}</span>`;
}
export function formatMessageTime(value) {
  const time = Number(value || 0);
  if (!time) return new Date(nowMs()).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return new Date(time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function messageSortAtFromClock(clock, fallback = nowMs()) {
  const fallbackTime = Number(fallback || nowMs());
  const match = String(clock || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallbackTime;

  const sortDate = new Date(nowMs());
  sortDate.setHours(Number(match[1]), Number(match[2]), 0, 0);
  let sortAt = sortDate.getTime();
  if (sortAt > nowMs() + 60 * 1000) sortAt -= 24 * 60 * 60 * 1000;
  return sortAt;
}

export function pushMessageRow(rows, row) {
  const sortAt = Number(row.sortAt ?? messageSortAtFromClock(row.time));
  rows.push({
    id: row.id,
    channel: row.channel || "attention",
    tone: row.tone || "info",
    time: row.time != null ? String(row.time) : formatMessageTime(sortAt),
    sortAt,
    speaker: row.speaker || row.title || "系统",
    title: row.title || "",
    text: row.text || "",
    live: row.live || "",
    mine: Boolean(row.mine),
    unreadEligible: row.unreadEligible !== false,
    action: row.action || null
  });
}

function rowAction(action, fallbackLabel = "前往") {
  if (!action?.payload) return null;
  return {
    name: action.action || "openLocation",
    payload: String(action.payload),
    label: action.label || fallbackLabel
  };
}

export function messageActionKey(action = {}) {
  if (!action?.name || !action?.payload) return "";
  return `${action.name}\u0000${action.payload}`;
}

// 同一频道里，相同目的地只把操作留在最新一条消息上。
export function groupMessageActions(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const key = messageActionKey(row?.action);
    if (!key) continue;
    const current = groups.get(key);
    if (current) {
      current.count += 1;
      continue;
    }
    groups.set(key, { owner: row, count: 1 });
  }
  return groups;
}

function classifyNews(item = {}) {
  const text = String(item.text || "");
  const tone = String(item.tone || "");
  if (tone === "trade" || /交易行|挂出|成交|求购|买下/.test(text)) {
    return {
      channel: "trade",
      speaker: "街市快报",
      action: { name: "openLocation", payload: "playerMarket", label: "去交易" }
    };
  }
  if (/公盘|开标|暗标|拍卖/.test(text)) {
    return {
      channel: "announcement",
      speaker: "公盘使者",
      action: { name: "openLocation", payload: "auction", label: "去公盘" }
    };
  }
  return { channel: "announcement", speaker: "街口告示", action: null };
}

export function aggregateNewsItems(items = [], fallbackNow = Date.now()) {
  const groups = new Map();
  for (const [index, item] of items.slice(0, 20).entries()) {
    const text = String(item?.text || "市场暂无新消息").trim();
    const meta = classifyNews(item);
    const key = `${meta.channel}\u0000${text}`;
    const sortAt = messageSortAtFromClock(item?.at, fallbackNow - index * 60000);
    const current = groups.get(key);
    if (current) {
      current.count += 1;
      if (sortAt > current.sortAt) {
        current.id = item?.id || current.id;
        current.time = item?.at || formatMessageTime(sortAt);
        current.sortAt = sortAt;
      }
      continue;
    }
    groups.set(key, {
      id: item?.id || `news-${index}`,
      channel: meta.channel,
      speaker: meta.speaker,
      action: meta.action,
      tone: item?.tone || "info",
      time: item?.at || formatMessageTime(sortAt),
      sortAt,
      text,
      count: 1
    });
  }
  return [...groups.values()]
    .sort((left, right) => right.sortAt - left.sortAt)
    .slice(0, 8);
}

export function homeMessageRows() {
  if (!getState()?.me) return [];
  const rows = [];
  const state = getState();
  const { me } = state;
  const now = nowMs();

  for (const [index, entry] of (me.ledger || []).slice(0, 12).entries()) {
    const amount = Number(entry.amount || 0);
    const signed = `${amount >= 0 ? "+" : "-"}${formatMoney(Math.abs(amount))}`;
    pushMessageRow(rows, {
      id: `ledger-${entry.id || index}`,
      channel: "record",
      tone: amount >= 0 ? "income" : "expense",
      time: formatMessageTime(entry.at),
      sortAt: Number(entry.at || 0),
      speaker: "账房",
      title: amount >= 0 ? "入账" : "支出",
      text: `${entry.note || "账目变动"} · ${signed}`,
      action: { name: "openMessageBill", payload: "bill", label: "看账单" }
    });
  }

  for (const [index, item] of reminderRows().entries()) {
    const title = item?.title || "提醒";
    const focus = item?.focus ? `${item.focusLabel || ""} ${item.focus}`.trim() : "";
    const text = [item?.detail || "", focus].filter(Boolean).join(" · ");
    const preferredAction = Array.isArray(item?.actions) && item.actions.length
      ? item.actions[0]
      : item?.action;
    pushMessageRow(rows, {
      id: `attention-${item?.id || index}`,
      channel: "attention",
      tone: "reminder",
      time: item?.urgentSoon ? "即将" : "待办",
      sortAt: now - 3000 - index * 1000,
      speaker: "管事",
      title,
      text,
      live: item?.live,
      unreadEligible: item?.tone !== "neutral",
      action: rowAction(preferredAction, "去处理")
    });
  }

  for (const item of aggregateNewsItems(state.news || [], now)) {
    pushMessageRow(rows, {
      id: `news-${item.id}`,
      channel: item.channel,
      tone: item.tone || "info",
      time: item.time,
      sortAt: item.sortAt,
      speaker: item.speaker,
      title: item.count > 1 ? `近期 ${item.count} 次` : "",
      text: item.text,
      action: item.action
    });
  }

  const players = Array.isArray(state.players) ? state.players : [];
  const leader = [...players].sort((left, right) => Number(right.rep || 0) - Number(left.rep || 0))[0];
  pushMessageRow(rows, {
    id: "world-online",
    channel: "world",
    tone: "status",
    time: "在线",
    sortAt: now - 4000,
    speaker: "街口",
    title: "",
    text: `${Math.max(1, Number(state.onlinePlayerCount || 0))} 位掌柜在线${leader ? `，声望榜首是 ${leader.name}` : ""}`,
    unreadEligible: false
  });

  for (const [index, item] of (state.worldChat || []).slice(0, 40).entries()) {
    const chatAt = Number(item.at || 0) || (now - index * 1000);
    const WORLD_CHAT_SORT_BOOST = 1e12;
    const mine = String(item.playerId || "") === String(me.id || "");
    pushMessageRow(rows, {
      id: `world-chat-${item.id || index}`,
      channel: "world",
      tone: "chat",
      time: formatMessageTime(chatAt),
      sortAt: chatAt + WORLD_CHAT_SORT_BOOST,
      speaker: item.speaker || "掌柜",
      title: "",
      text: item.text || "",
      mine
    });
  }

  for (const [index, listing] of (getState().listings || []).slice(0, 8).entries()) {
    const item = listing.item || listing.product || {};
    const itemName = item.name || item.label || listing.itemName || listing.type || "翡翠货品";
    const createdAt = Number(listing.createdAt || 0);
    pushMessageRow(rows, {
      id: `trade-listing-${listing.id || index}`,
      channel: "trade",
      tone: "trade",
      time: createdAt ? formatMessageTime(createdAt) : "在售",
      sortAt: createdAt || now - 7000 - index * 2100,
      speaker: listing.sellerName || listing.ownerName || "玩家交易行",
      title: "挂单",
      text: `${itemName} 正在寄售，标价 ${formatMoney(listing.price)}`,
      action: { name: "openLocation", payload: "playerMarket", label: "去交易" }
    });
  }

  for (const [index, want] of (state.wants || []).slice(0, 6).entries()) {
    const createdAt = Number(want.createdAt || 0);
    pushMessageRow(rows, {
      id: `trade-want-${want.id || index}`,
      channel: "trade",
      tone: "trade",
      time: createdAt ? formatMessageTime(createdAt) : "求购",
      sortAt: createdAt || now - 10000 - index * 1800,
      speaker: want.ownerName || want.buyerName || "求货掌柜",
      title: "求购",
      text: `${want.title || want.request || "合适翡翠"}，预算 ${formatMoney(want.budget)}`,
      action: { name: "openLocation", payload: "playerMarket", label: "去交易" }
    });
  }

  for (const [index, order] of (me.orders || []).slice(0, 5).entries()) {
    pushMessageRow(rows, {
      id: `order-${order.id || index}`,
      channel: "trade",
      tone: "order",
      time: "当前",
      sortAt: now - 12000 - index * 2600,
      speaker: order.client || "客户",
      title: "订单",
      text: `求购 ${order.quantity || 1} 件 ${order.request || order.label || "合适翡翠"}，酬金 ${formatMoney(order.pay)}`,
      unreadEligible: false,
      action: { name: "openLocation", payload: "orders", label: "去订单" }
    });
  }

  const counts = inventoryCounts(me);
  pushMessageRow(rows, {
    id: "system-inventory",
    channel: "record",
    tone: "status",
    time: "当前",
    sortAt: now - 16000,
    speaker: "伙计",
    title: "库存",
    text: `暗料 ${counts.sealed}、明料 ${counts.revealed}、加工 ${counts.jobs}、成品 ${counts.products}、藏品 ${counts.collection}`,
    unreadEligible: false,
    action: { name: "openLocation", payload: "inventory", label: "看库存" }
  });

  return rows.sort((left, right) => Number(right.sortAt || 0) - Number(left.sortAt || 0));
}

export function renderHomeMessages() {
  if (!elsRef?.homeMessageLog || !elsRef?.messageChannelTabs || typeof getState !== "function" || !getState()?.me) return;
  const rows = homeMessageRows();
  const log = elsRef.homeMessageLog;
  const previousScrollTop = Number(log.scrollTop || 0);
  const previousScrollHeight = Number(log.scrollHeight || 0);
  const clientHeight = Number(log.clientHeight || 0);
  const wasNearBottom = lastRenderedMessageIds.size === 0
    || previousScrollHeight - previousScrollTop - clientHeight <= 48;

  // 首次启用新版未读时以当前内容为基线，避免一进游戏就背上几十条“历史未读”。
  if (!seenStoreReady) {
    for (const row of rows) {
      if (row?.id != null && row.unreadEligible !== false) seenMessageIds.add(String(row.id));
    }
    seenStoreReady = true;
    writeSeenMessageIds();
  }

  if (chatPanelIsOpenForReading()) {
    markChannelMessagesRead(rows, activeMessageChannel);
  }

  elsRef.messageChannelTabs.innerHTML = messageChannelDefinitions.map((channel) => {
    const unread = unreadCountForChannel(rows, channel.id);
    const active = channel.id === activeMessageChannel;
    return `
      <button class="${active ? "active" : ""}" data-action="selectMessageChannel" data-message-channel="${escapeHtml(channel.id)}" type="button" role="tab" aria-selected="${active}" aria-pressed="${active}" aria-controls="homeMessageLog" tabindex="${active ? "0" : "-1"}">
        ${escapeHtml(channel.label)}${formatUnreadBadge(unread)}
      </button>
    `;
  }).join("");

  const totalUnread = unreadCountForChannel(rows, "all");
  const unreadLabel = totalUnread > 99 ? "99+" : String(totalUnread);
  if (elsRef.chatDockUnread) {
    elsRef.chatDockUnread.textContent = unreadLabel;
    elsRef.chatDockUnread.hidden = totalUnread === 0;
  }
  if (elsRef.chatDockToggle) {
    elsRef.chatDockToggle.classList?.toggle("has-unread", totalUnread > 0);
    elsRef.chatDockToggle.setAttribute(
      "aria-label",
      totalUnread > 0 ? `消息，${unreadLabel} 条未读` : "消息"
    );
  }
  if (elsRef.chatDockCompactBtn) {
    if (totalUnread > 0 && chatdockCompact) {
      elsRef.chatDockCompactBtn.setAttribute("data-unread", unreadLabel);
      elsRef.chatDockCompactBtn.setAttribute("aria-label", `展开频道，${unreadLabel} 条未读`);
    } else {
      elsRef.chatDockCompactBtn.removeAttribute("data-unread");
      elsRef.chatDockCompactBtn.setAttribute("aria-label", chatdockCompact ? "展开频道" : "收起频道");
    }
  }

  const composing = activeMessageChannel === "world";
  elsRef.chatDock?.setAttribute("data-channel", activeMessageChannel);
  if (elsRef.chatComposer) {
    elsRef.chatComposer.hidden = !composing;
    elsRef.chatComposer.setAttribute("aria-hidden", String(!composing));
  }
  if (elsRef.chatInput) elsRef.chatInput.disabled = !composing;
  if (elsRef.chatSend) elsRef.chatSend.disabled = !composing;

  const visibleRows = channelRows(rows, activeMessageChannel);
  const actionGroups = groupMessageActions(visibleRows);
  // “全部”展示当前聚合出的完整信息流；单频道维持 40 条上限。
  const rowLimit = activeMessageChannel === "all" ? visibleRows.length : 40;
  const renderedRows = visibleRows.slice(0, rowLimit).reverse();
  const nextRenderedIds = new Set(renderedRows.map((row) => String(row.id || "")));
  const hasNewVisibleMessage = lastRenderedMessageIds.size > 0
    && [...nextRenderedIds].some((id) => id && !lastRenderedMessageIds.has(id));
  const emptyLabels = {
    all: "目前没有可展示的消息。",
    attention: "目前没有需要处理的事项。",
    world: "世界频道还没有玩家发言。",
    trade: "当前没有可展示的交易消息。",
    announcement: "目前没有新的街市公告。",
    record: "目前没有经营记录。"
  };
  log.innerHTML = renderedRows.map((row) => {
    const channel = messageChannelDefinitions.find((item) => item.id === row.channel);
    const mineClass = row.mine ? " is-mine" : "";
    const mineTag = row.mine ? `<span class="message-log-mine-tag">我的</span>` : "";
    const actionGroup = actionGroups.get(messageActionKey(row.action));
    const actionCount = Number(actionGroup?.count || 0);
    const ownsGroupedAction = actionGroup?.owner === row;
    const actionCountHtml = actionCount > 1
      ? `<span class="message-log-action-count" aria-hidden="true">${escapeHtml(actionCount)}</span>`
      : "";
    const actionAriaLabel = actionCount > 1
      ? `${row.action?.label}，${actionCount} 条相关消息：${row.title || row.text}`
      : `${row.action?.label}：${row.title || row.text}`;
    const actionHtml = ownsGroupedAction
      ? `<button class="message-log-action" type="button" data-action="${escapeHtml(row.action.name)}" data-payload="${escapeHtml(row.action.payload)}" aria-label="${escapeHtml(actionAriaLabel)}"><span>${escapeHtml(row.action.label)}</span>${actionCountHtml}</button>`
      : "";
    const auctionClock = row.live === "auction-eta" ? auctionPhaseMeta() : null;
    const textHtml = auctionClock
      ? `${escapeHtml(auctionClock.clock)} <span data-remind-auction-eta="1">${escapeHtml(formatDuration(auctionClock.remain))}</span>`
      : escapeHtml(row.text);
    return `
      <article class="message-log-row ${escapeHtml(row.tone || "info")}${mineClass}" data-channel="${escapeHtml(row.channel)}"${row.mine ? ' data-mine="1"' : ""}>
        <span class="message-log-time">${escapeHtml(row.time)}</span>
        <span class="message-log-channel">${escapeHtml(channel?.label || row.title)}</span>
        <span class="message-log-text">
          <strong class="message-log-speaker">${mineTag}${escapeHtml(row.speaker)}：</strong>
          <em>${row.title ? `${escapeHtml(row.title)} · ` : ""}${textHtml}</em>
        </span>
        ${actionHtml}
      </article>
    `;
  }).join("") || empty(emptyLabels[activeMessageChannel] || "暂无消息。");

  lastRenderedMessageIds = nextRenderedIds;
  if (forceScrollOnNextRender || wasNearBottom) {
    scrollHomeMessagesToLatest();
  } else {
    log.scrollTop = previousScrollTop;
    if (elsRef.chatNewMessages) elsRef.chatNewMessages.hidden = !hasNewVisibleMessage;
  }
  forceScrollOnNextRender = false;
}

export function scrollHomeMessagesToLatest() {
  if (!elsRef.homeMessageLog) return;
  elsRef.homeMessageLog.scrollTop = elsRef.homeMessageLog.scrollHeight;
  if (elsRef.chatNewMessages) elsRef.chatNewMessages.hidden = true;
}

export function sendChat() {
  if (!elsRef.chatInput) return;
  const text = elsRef.chatInput.value.trim();
  if (!text) return;
  if (!socketRef?.emit) {
    showToast("聊天连接未就绪");
    return;
  }
  socketRef.emit("sendWorldChat", { text }, (result = {}) => {
    if (!result.ok) {
      if (result.message) showToast(result.message);
      return;
    }
    if (elsRef.chatInput) elsRef.chatInput.value = "";
    if (activeMessageChannel !== "world") {
      activeMessageChannel = "world";
      forceScrollOnNextRender = true;
      renderHomeMessages();
    }
  });
}

export function chatSelectChannel(channelId) {
  activeMessageChannel = messageChannelDefinitions.some((c) => c.id === channelId) ? channelId : "attention";
  forceScrollOnNextRender = true;
  renderHomeMessages();
}
