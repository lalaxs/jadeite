import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [html, css, chatSource, mainSource] = await Promise.all([
  readFile(new URL("public/index.html", root), "utf8"),
  readFile(new URL("public/styles.css", root), "utf8"),
  readFile(new URL("public/chat-module.js", root), "utf8"),
  readFile(new URL("public/main.js", root), "utf8")
]);

assert.match(html, /id="chatDockCompactBtn"/);
assert.match(html, /class="chatdock-compact-btn"/);
assert.match(html, />\s*收起\s*</);
assert.match(html, /title="收起频道"/);
assert.match(html, /data-chatdock="expanded"/);

assert.match(css, /\.chatdock\s*\{[^}]*position:\s*relative/);
assert.match(css, /--desktop-chat-height-compact:\s*110px/);
assert.match(css, /--chatdock-compact-row-height:\s*34px/);
assert.match(css, /\.shell\[data-chatdock="compact"\]/);
assert.match(css, /\.chatdock\[data-chatdock="compact"\]\s+\.chatdock-tabs/);
assert.match(css, /\.chatdock\[data-chatdock="compact"\]\s+\.chatdock-input/);
assert.match(css, /max-height:\s*calc\(\s*3\s*\*\s*var\(--chatdock-compact-row-height\)\s*\)/);

// Desktop grid placement must not leave chatdock as position:static (breaks absolute compact button).
const desktopPlacement = [...css.matchAll(/\.chatdock\s*\{\s*grid-column:\s*2;\s*grid-row:\s*3;\s*align-self:\s*stretch;\s*position:\s*([^;]+);/g)]
  .map((match) => match[1].trim());
assert.ok(desktopPlacement.length >= 1, "expected desktop chatdock grid placement rules");
assert.ok(desktopPlacement.every((value) => value === "relative"), `chatdock grid placement should be relative, got ${desktopPlacement.join(",")}`);

assert.match(chatSource, /btn\.textContent\s*=\s*compact\s*\?\s*"展开"\s*:\s*"收起"/);
assert.match(chatSource, /btn\.title\s*=\s*compact\s*\?\s*"展开频道"\s*:\s*"收起频道"/);
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
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
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
    auctionPhaseMeta: () => ({}),
    reminderRows: () => [],
    inventoryCounts: () => ({}),
    showToast: () => {}
  }
});

assert.equal(btn.textContent, "收起");
assert.equal(chatDock.getAttribute("data-chatdock"), "expanded");
btn.click();
assert.equal(chatDock.getAttribute("data-chatdock"), "compact");
assert.equal(shell.getAttribute("data-chatdock"), "compact");
assert.equal(btn.textContent, "展开");
assert.equal(btn.getAttribute("aria-expanded"), "false");
assert.equal(store.get("jade-chatdock-compact"), "1");
btn.click();
assert.equal(chatDock.getAttribute("data-chatdock"), "expanded");
assert.equal(btn.textContent, "收起");
assert.equal(btn.getAttribute("aria-expanded"), "true");
assert.equal(store.get("jade-chatdock-compact"), "0");

console.log("chatdock-compact-smoke: ok");
