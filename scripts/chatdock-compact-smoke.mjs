import assert from "node:assert/strict";
import { readClientShellSource } from "./load-client-shell.mjs";
import { readFile } from "node:fs/promises";
import { loadResolvedStyles, stylesEntryFromMeta } from "./load-styles.mjs";

const root = new URL("../", import.meta.url);
const css = loadResolvedStyles(stylesEntryFromMeta(import.meta.url));
const [html, chatSource, mainSource] = await Promise.all([
  readFile(new URL("public/index.html", root), "utf8"),
  readFile(new URL("public/features/chat/chat-module.js", root), "utf8"),
  Promise.resolve(readClientShellSource())
]);

assert.match(html, /id="chatDockCompactBtn"/);
assert.match(html, /class="chatdock-compact-btn"/);
assert.match(html, />\s*展开\s*</);
assert.match(html, /title="展开频道"/);
assert.match(html, /data-chatdock="compact"/);
assert.match(html, /id="chatDockUnread"/);
assert.match(html, /id="chatNewMessages"/);
assert.match(html, /id="chatComposer" hidden/);

assert.match(css, /\.chatdock\s*\{[^}]*position:\s*relative/);
assert.match(css, /--desktop-chat-height-compact:/);
assert.match(css, /--chatdock-compact-row-height:\s*28px/);
assert.match(css, /\.shell\[data-chatdock="compact"\]|\.chatdock\[data-chatdock="compact"\]/);
assert.match(css, /\.chatdock\[data-chatdock="compact"\]\s+\.chatdock-tabs/);
assert.match(css, /\.chatdock\[data-chatdock="compact"\]\s+\.chatdock-input/);
assert.match(css, /--chatdock-motion-ms:\s*420ms/);
assert.match(css, /grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
assert.match(css, /max-height:\s*calc\(\s*3\s*\*\s*var\(--chatdock-compact-row-height\)\s*\)/);
assert.match(css, /\.chatdock\[data-chatdock="compact"\]\s+\.chatdock-log\s*\{[^}]*overflow-y:\s*auto/s);
assert.match(chatSource, /“全部”展示当前聚合出的完整信息流/);
assert.doesNotMatch(chatSource, /isChatdockCompact\(\)\s*\?\s*3\s*:\s*40/);

// Desktop grid placement must not leave chatdock as position:static (breaks absolute compact button).
const desktopPlacement = [...css.matchAll(/\.chatdock\s*\{\s*grid-column:\s*2;\s*grid-row:\s*3;\s*align-self:\s*stretch;\s*position:\s*([^;]+);/g)]
  .map((match) => match[1].trim());
assert.ok(desktopPlacement.length >= 1, "expected desktop chatdock grid placement rules");
assert.ok(desktopPlacement.every((value) => value === "relative"), `chatdock grid placement should be relative, got ${desktopPlacement.join(",")}`);

assert.match(html, /class="chatdock-chrome"/);
assert.match(chatSource, /animateChatdockCompact/);
assert.match(chatSource, /runChatdockHeightAnimation|CHATDOCK_MOTION_MS/);
assert.match(chatSource, /activeMessageChannel\s*=\s*"attention"/);
assert.match(chatSource, /\{ id: "all", label: "全部" \}/);
assert.match(chatSource, /label:\s*"关注"/);
assert.match(chatSource, /label:\s*"记录"/);
assert.match(chatSource, /CHAT_SEEN_KEY/);
assert.match(chatSource, /aggregateNewsItems/);
assert.match(chatSource, /groupMessageActions\(visibleRows\)/);
assert.match(chatSource, /channelId\s*===\s*"all"\s*\?\s*rows\s*:\s*rows\.filter/);
assert.match(chatSource, /totalUnread\s*=\s*unreadCountForChannel\(rows,\s*"all"\)/);
assert.match(chatSource, /activeMessageChannel\s*===\s*"all"\s*\?\s*visibleRows\.length\s*:\s*40/);
assert.match(chatSource, /chatComposer\.hidden\s*=\s*!composing/);
assert.match(chatSource, /btn\.title\s*=\s*compact\s*\?\s*"展开频道"\s*:\s*"收起频道"/);
assert.match(chatSource, /updateChatdockCompactButton/);
assert.match(chatSource, /chatDockCompactBtn\?\.addEventListener\(\s*"click"/);
assert.match(mainSource, /chatDockCompactBtn:\s*document\.querySelector\(\s*"#chatDockCompactBtn"\s*\)/);
assert.match(mainSource, /shell:\s*document\.querySelector\(\s*"\.shell"\s*\)/);

function createEl(tag, attrs = {}) {
  const listeners = new Map();
  const el = {
    tagName: tag.toUpperCase(),
    attrs: { ...attrs },
    children: [],
    textContent: attrs.textContent || "",
    style: {},
    getAttribute(name) { return this.attrs[name] ?? null; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    removeAttribute(name) { delete this.attrs[name]; },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type);
      if (!list) return;
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    click() {
      for (const fn of listeners.get("click") || []) fn({ preventDefault() {}, stopPropagation() {} });
    },
    querySelector() { return null; }
  };
  return el;
}

const shell = createEl("main", { class: "shell" });
const chatDock = createEl("footer", { class: "chatdock", id: "chatDock", "data-chatdock": "expanded" });
chatDock.getBoundingClientRect = () => ({ height: 270, width: 800, top: 0, left: 0, bottom: 270, right: 800 });
Object.defineProperty(chatDock, "offsetHeight", { get() { return 270; } });
chatDock.animate = (keyframes, opts) => {
  const duration = Number(opts?.duration) || 0;
  return {
    finished: new Promise((resolve) => setTimeout(resolve, Math.min(duration, 30))),
    cancel() {}
  };
};
const btn = createEl("button", { id: "chatDockCompactBtn", class: "chatdock-compact-btn", textContent: "收起", "aria-expanded": "true" });
const homeMessageLog = createEl("div", { id: "homeMessageLog" });
homeMessageLog.scrollTop = 0;
homeMessageLog.scrollHeight = 100;

const store = new Map();
globalThis.window = {
  matchMedia: (query) => ({
    matches: String(query).includes("min-width: 768px"),
    media: query,
    addEventListener() {},
    removeEventListener() {}
  })
};
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)); }
};

const mod = await import(`../public/chat-module.js?smoke=${Date.now()}`);
let reminders = [];
mod.initChatModule({
  getState: () => ({ me: { cash: 1 } }),
  els: {
    shell,
    chatDock,
    chatDockCompactBtn: btn,
    homeMessageLog,
    messageChannelTabs: createEl("div"),
    chatInput: null
  },
  helpers: {
    nowMs: () => Date.now(),
    formatMoney: (value) => String(value),
    formatDuration: (value) => String(value),
    escapeHtml: (value) => String(value),
    empty: (value) => value,
    gameClock: () => ({}),
    auctionPhaseMeta: () => ({ clock: "本场结束", remain: 61_999 }),
    reminderRows: () => reminders,
    inventoryCounts: () => ({}),
    showToast: () => {}
  }
});

const groupedNews = mod.aggregateNewsItems([
  { id: "n2", at: "10:02", text: "新手公盘已开场", tone: "great" },
  { id: "n1", at: "10:01", text: "新手公盘已开场", tone: "great" }
], Date.now());
assert.equal(groupedNews.length, 1);
assert.equal(groupedNews[0].count, 2);
assert.equal(groupedNews[0].channel, "announcement");

const newestTradeRow = { id: "t2", action: { name: "openLocation", payload: "playerMarket", label: "去交易" } };
const olderTradeRow = { id: "t1", action: { name: "openLocation", payload: "playerMarket", label: "去交易" } };
const orderRow = { id: "o1", action: { name: "openLocation", payload: "orders", label: "去订单" } };
const groupedActions = mod.groupMessageActions([newestTradeRow, olderTradeRow, orderRow]);
assert.equal(groupedActions.size, 2);
assert.equal(groupedActions.get(mod.messageActionKey(newestTradeRow.action)).owner, newestTradeRow);
assert.equal(groupedActions.get(mod.messageActionKey(newestTradeRow.action)).count, 2);
assert.equal(groupedActions.get(mod.messageActionKey(orderRow.action)).count, 1);
assert.match(css, /\.message-log-action-count\s*\{/);
assert.match(
  css,
  /@media \(min-width:\s*768px\)[\s\S]*?\.message-log-row\s*\{[^}]*min-height:\s*34px[^}]*\}[\s\S]*?\.message-log-action\s*\{[^}]*width:\s*88px[^}]*height:\s*28px/s
);

assert.equal(btn.textContent, "展开");
assert.equal(chatDock.getAttribute("data-chatdock"), "compact");
btn.click();
await new Promise((resolve) => setTimeout(resolve, 80));
assert.equal(chatDock.getAttribute("data-chatdock"), "expanded");
assert.equal(shell.getAttribute("data-chatdock"), "expanded");
assert.equal(btn.textContent, "收起");
assert.equal(btn.getAttribute("aria-expanded"), "true");
assert.equal(store.get("jade-chatdock-compact"), "0");
btn.click();
await new Promise((resolve) => setTimeout(resolve, 80));
assert.equal(chatDock.getAttribute("data-chatdock"), "compact");
assert.equal(btn.textContent, "展开");
assert.equal(btn.getAttribute("aria-expanded"), "false");
assert.equal(store.get("jade-chatdock-compact"), "1");

reminders = [{ id: "auction-eta", title: "公盘开标", focusLabel: "本场结束", focus: "stale-clock", live: "auction-eta" }];
mod.renderHomeMessages();
assert.match(homeMessageLog.innerHTML, /本场结束 <span data-remind-auction-eta="1">61999<\/span>/);
assert.doesNotMatch(homeMessageLog.innerHTML, /stale-clock/);

console.log("chatdock-compact-smoke: ok");
