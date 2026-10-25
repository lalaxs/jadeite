import { PRESET_COMMENTS, CHAT_FEED_MAX, CHAT_PIN_THRESHOLD_PX, CHAT_TICK_MIN_MS, CHAT_TICK_MAX_MS, parsePresetComment } from "./catalog.js";

export function createLivestreamChat({ getState, elsRef, scope, ui, helpers, ports }) {
  const { chatScrollByRoom, chatFeedByRoom } = ui;
  const { formatMoney, escapeHtml } = helpers;
  const { roomForId, visibleChatRoomIds } = ports;

function ensureChatFeed(roomId) {
  const id = String(roomId || "");
  if (!id) return [];
  if (!chatFeedByRoom.has(id)) chatFeedByRoom.set(id, []);
  return chatFeedByRoom.get(id);
}

function syncSalesIntoChatFeed(room) {
  const roomId = String(room?.id || "");
  if (!roomId) return [];
  return ensureChatFeed(roomId);
}

function appendLivestreamChatComments(roomId, count = 1, seed = Date.now()) {
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

function buildLivestreamChatFeed(room, _item, _index) {
  return [...syncSalesIntoChatFeed(room)];
}

function resetLivestreamChatFeeds() {
  chatFeedByRoom.clear();
}

function pruneChatFeeds(aliveIds) {
  const alive = new Set([...aliveIds].map(String).filter(Boolean));
  for (const id of chatFeedByRoom.keys()) {
    if (!alive.has(id)) chatFeedByRoom.delete(id);
  }
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
  if (ui.chatTickTimer) scope.clearTimeout(ui.chatTickTimer);
  const span = CHAT_TICK_MAX_MS - CHAT_TICK_MIN_MS;
  const delay = CHAT_TICK_MIN_MS + Math.floor(Math.random() * (span + 1));
  ui.chatTickTimer = scope.setTimeout(() => {
    ui.chatTickTimer = null;
    const roomIds = visibleChatRoomIds();
    if (roomIds.length) {
      ui.chatTickSeq += 1;
      for (const roomId of roomIds) {
        const burst = Math.random() < 0.45 ? 2 : 1;
        appendLivestreamChatComments(roomId, burst, Date.now() + ui.chatTickSeq * 17);
      }
      paintVisibleChatRails();
    }
    scheduleChatTick();
  }, delay);
}

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

  return { ensureChatFeed, syncSalesIntoChatFeed, appendLivestreamChatComments, buildLivestreamChatFeed, resetLivestreamChatFeeds, pruneChatFeeds, chatLinesHtml, paintVisibleChatRails, scheduleChatTick, chatRailMarkup, captureChatScroll, restoreChatScroll };
}
