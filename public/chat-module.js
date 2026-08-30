// 聊天/消息系统模块（从 main.js 抽离，依赖注入解耦）
let getState;
let elsRef;
let activeMessageChannel = "all";
let chatdockCompact = false;
const CHATDOCK_COMPACT_KEY = "jade-chatdock-compact";
let nowMs, formatMoney, formatDuration, escapeHtml, empty, gameClock, auctionPhaseMeta, reminderRows, inventoryCounts, showToast;

function desktopChatdockEnabled() {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
}

function readStoredChatdockCompact() {
  try {
    return localStorage.getItem(CHATDOCK_COMPACT_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStoredChatdockCompact(compact) {
  try {
    localStorage.setItem(CHATDOCK_COMPACT_KEY, compact ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}

export function applyChatdockCompact(forceCompact = null) {
  if (forceCompact != null) chatdockCompact = Boolean(forceCompact);
  const compact = desktopChatdockEnabled() && chatdockCompact;
  const mode = compact ? "compact" : "expanded";
  elsRef?.chatDock?.setAttribute("data-chatdock", mode);
  elsRef?.shell?.setAttribute("data-chatdock", mode);
  const btn = elsRef?.chatDockCompactBtn;
  if (btn) {
    btn.setAttribute("aria-expanded", String(!compact));
    btn.title = compact ? "展开频道" : "收起频道";
    btn.textContent = compact ? "展开" : "收起";
  }
  if (!compact) scrollHomeMessagesToLatest();
}

export function toggleChatdockCompact() {
  if (!desktopChatdockEnabled()) return;
  chatdockCompact = !chatdockCompact;
  writeStoredChatdockCompact(chatdockCompact);
  applyChatdockCompact();
}

export function initChatModule(deps) {
  getState = deps.getState;
  elsRef = deps.els;
  ({ nowMs, formatMoney, formatDuration, escapeHtml, empty, gameClock, auctionPhaseMeta, reminderRows, inventoryCounts, showToast } = deps.helpers);
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
}

const messageChannelDefinitions = [
  { id: "all", label: "综合" },
  { id: "system", label: "系统" },
  { id: "world", label: "世界" },
  { id: "trade", label: "交易" },
  { id: "announcement", label: "通告" },
];

const seenMessageIds = new Set();

function channelRows(rows, channelId) {
  return channelId === "all" ? rows : rows.filter((row) => row.channel === channelId);
}

function markChannelMessagesRead(rows, channelId) {
  for (const row of channelRows(rows, channelId)) {
    if (row?.id != null) seenMessageIds.add(String(row.id));
  }
}

function unreadCountForChannel(rows, channelId) {
  return channelRows(rows, channelId).filter((row) => row?.id != null && !seenMessageIds.has(String(row.id))).length;
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
    channel: row.channel || "system",
    tone: row.tone || "info",
    time: row.time || formatMessageTime(sortAt),
    sortAt,
    speaker: row.speaker || row.title || "系统",
    title: row.title || "",
    text: row.text || ""
  });
}

export function homeMessageRows() {
  if (!getState()?.me) return [];
  const rows = [];
  const { me } = getState();
  const now = nowMs();

  for (const [index, entry] of (me.ledger || []).slice(0, 12).entries()) {
    const amount = Number(entry.amount || 0);
    const signed = `${amount >= 0 ? "+" : "-"}${formatMoney(Math.abs(amount))}`;
    pushMessageRow(rows, {
      id: `ledger-${entry.id || index}`,
      channel: "system",
      tone: amount >= 0 ? "income" : "expense",
      time: formatMessageTime(entry.at),
      sortAt: Number(entry.at || 0),
      speaker: "账房",
      title: amount >= 0 ? "入账" : "支出",
      text: `${entry.note || "账目变动"} · ${signed}`
    });
  }

  if (me.offlineSummary?.count) {
    pushMessageRow(rows, {
      id: "offline-summary",
      channel: "system",
      tone: "info",
      time: formatMessageTime(now),
      sortAt: now,
      speaker: "系统",
      title: "离线",
      text: `离线期间发生 ${me.offlineSummary.count} 件事，净现金 ${formatMoney((me.offlineSummary.income || 0) - (me.offlineSummary.expense || 0))}`
    });
  }

  const auctionMeta = auctionPhaseMeta();
  pushMessageRow(rows, {
    id: "system-clock",
    channel: "system",
    tone: "info",
    time: formatMessageTime(now),
    sortAt: now - 2,
    speaker: "更夫",
    title: "提示",
    text: `${gameClock()} · ${auctionMeta.label}，${auctionMeta.clock} ${formatDuration(auctionMeta.remain)}`
  });

  for (const [index, [title, text]] of reminderRows().entries()) {
    pushMessageRow(rows, {
      id: `reminder-${index}`,
      channel: "system",
      tone: "reminder",
      time: formatMessageTime(now - 3000 - index * 1000),
      sortAt: now - 3000 - index * 1000,
      speaker: "管事",
      title,
      text
    });
  }

  for (const [index, item] of (getState().news || []).slice(0, 8).entries()) {
    const newsSortAt = messageSortAtFromClock(item.at, now - index * 60000);
    pushMessageRow(rows, {
      id: `news-${item.id || index}`,
      channel: "announcement",
      tone: item.tone || "info",
      time: item.at || formatMessageTime(newsSortAt),
      sortAt: newsSortAt,
      speaker: "公盘使者",
      title: "公盘",
      text: item.text || "市场暂无新消息"
    });
  }

  const players = Array.isArray(getState().players) ? getState().players : [];
  const leader = [...players].sort((left, right) => Number(right.rep || 0) - Number(left.rep || 0))[0];
  pushMessageRow(rows, {
    id: "world-online",
    channel: "world",
    tone: "info",
    time: formatMessageTime(now),
    sortAt: now - 1,
    speaker: "街口",
    title: "",
    text: `${players.length || 1} 位掌柜正在翡翠街经营${leader ? `，声望榜首是 ${leader.name}` : ""}`
  });

  for (const [index, player] of [...players]
    .sort((left, right) => Number(right.cash || 0) - Number(left.cash || 0))
    .slice(0, 4)
    .entries()) {
    pushMessageRow(rows, {
      id: `world-player-${player.id || index}`,
      channel: "world",
      tone: "rumor",
      time: formatMessageTime(now - 5000 - index * 1700),
      sortAt: now - 5000 - index * 1700,
      speaker: "街坊传闻",
      title: "传闻",
      text: `${player.name || "一位掌柜"} 今日现金 ${formatMoney(player.cash)}，声望 ${Math.round(player.rep || 0)}`
    });
  }

  for (const [index, listing] of (getState().listings || []).slice(0, 8).entries()) {
    const item = listing.item || listing.product || {};
    const itemName = item.name || item.label || listing.itemName || listing.type || "翡翠货品";
    pushMessageRow(rows, {
      id: `trade-listing-${listing.id || index}`,
      channel: "trade",
      tone: "trade",
      time: formatMessageTime(now - 7000 - index * 2100),
      sortAt: now - 7000 - index * 2100,
      speaker: listing.sellerName || listing.ownerName || "玩家交易行",
      title: "挂单",
      text: `${itemName} 正在寄售，标价 ${formatMoney(listing.price)}`
    });
  }

  for (const [index, listing] of (getState().assetListings || []).slice(0, 4).entries()) {
    pushMessageRow(rows, {
      id: `trade-asset-${listing.id || index}`,
      channel: "trade",
      tone: "trade",
      time: formatMessageTime(now - 26000 - index * 2000),
      sortAt: now - 26000 - index * 2000,
      speaker: "商铺掌柜",
      title: "商铺",
      text: `${listing.name || "功能建筑"} 可购买，价格 ${formatMoney(listing.price)}`
    });
  }

  for (const [index, order] of (me.orders || []).slice(0, 5).entries()) {
    pushMessageRow(rows, {
      id: `order-${order.id || index}`,
      channel: "trade",
      tone: "order",
      time: formatMessageTime(now - 12000 - index * 2600),
      sortAt: now - 12000 - index * 2600,
      speaker: order.client || "客户",
      title: "订单",
      text: `求购 ${order.quantity || 1} 件 ${order.request || order.label || "合适翡翠"}，酬金 ${formatMoney(order.pay)}`
    });
  }

  const counts = inventoryCounts(me);
  pushMessageRow(rows, {
    id: "system-inventory",
    channel: "system",
    tone: "info",
    time: formatMessageTime(now - 16000),
    sortAt: now - 16000,
    speaker: "伙计",
    title: "库存",
    text: `暗料 ${counts.sealed}、明料 ${counts.revealed}、加工 ${counts.jobs}、成品 ${counts.products}、藏品 ${counts.collection}`
  });

  if (!rows.length) {
    pushMessageRow(rows, {
      id: "system-welcome",
      channel: "system",
      tone: "info",
      time: formatMessageTime(now),
      sortAt: now,
      speaker: "系统",
      title: "提示",
      text: "欢迎来到翡翠街，先看看公盘或商铺。"
    });
  }

  return rows.sort((left, right) => Number(right.sortAt || 0) - Number(left.sortAt || 0));
}

export function renderHomeMessages() {
  if (!elsRef.homeMessageLog || !elsRef.messageChannelTabs || !getState()?.me) return;
  const rows = homeMessageRows();

  // 进入具体频道时清该频道未读；停在「综合」只汇总展示，不清空各频道
  if (activeMessageChannel !== "all") {
    markChannelMessagesRead(rows, activeMessageChannel);
  }

  elsRef.messageChannelTabs.innerHTML = messageChannelDefinitions.map((channel) => {
    const unread = unreadCountForChannel(rows, channel.id);
    return `
      <button class="${channel.id === activeMessageChannel ? "active" : ""}" data-action="selectMessageChannel" data-message-channel="${escapeHtml(channel.id)}" type="button">
        ${escapeHtml(channel.label)}${formatUnreadBadge(unread)}
      </button>
    `;
  }).join("");

  const visibleRows = activeMessageChannel === "all"
    ? rows
    : rows.filter((row) => row.channel === activeMessageChannel);
  elsRef.homeMessageLog.innerHTML = visibleRows.slice(0, 40).reverse().map((row) => {
    const channel = messageChannelDefinitions.find((item) => item.id === row.channel);
    return `
      <div class="message-log-row ${escapeHtml(row.tone || "info")}" data-channel="${escapeHtml(row.channel)}">
        <span class="message-log-time">${escapeHtml(row.time)}</span>
        <span class="message-log-channel">${escapeHtml(channel?.label || row.title)}</span>
        <span class="message-log-text">
          <strong class="message-log-speaker">${escapeHtml(row.speaker)}</strong>
          <em>${row.title ? `${escapeHtml(row.title)} · ` : ""}${escapeHtml(row.text)}</em>
        </span>
      </div>
    `;
  }).join("") || empty("暂无消息。");
  scrollHomeMessagesToLatest();
}

export function scrollHomeMessagesToLatest() {
  if (!elsRef.homeMessageLog) return;
  elsRef.homeMessageLog.scrollTop = elsRef.homeMessageLog.scrollHeight;
}

export function sendChat() {
  if (!elsRef.chatInput) return;
  const text = elsRef.chatInput.value.trim();
  if (!text) return;
  elsRef.chatInput.value = "";
  showToast("世界聊天即将开放，敬请期待");
}

export function chatSelectChannel(channelId) {
  activeMessageChannel = messageChannelDefinitions.some((c) => c.id === channelId) ? channelId : "all";
  renderHomeMessages();
}
