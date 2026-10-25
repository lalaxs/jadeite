import assert from "node:assert/strict";
import { createMarketFeature, initMarketModule, disposeMarketModule } from "../public/market-module.js";
import { createLivestreamFeature, initLivestreamModule, disposeLivestreamModule } from "../public/livestream-module.js";
import { createActionRouter } from "../public/shell/action-router.js";
import { createFeatureScope } from "../public/shell/feature-scope.js";

class Element {
  handlers = new Map();
  fields = new Map();
  dataset = {};
  innerHTML = "";
  childElementCount = 1;
  hidden = true;
  value = "";
  disabled = false;
  lazy = [];
  classList = { toggle() {}, add() {}, remove() {}, contains: () => false };
  addEventListener(name, handler) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(handler);
  }
  removeEventListener(name, handler) { this.handlers.get(name)?.delete(handler); }
  querySelector(selector) { return this.fields.get(selector) || null; }
  querySelectorAll(selector) {
    if (selector === "[data-lazy-preview].is-pending") return this.lazy;
    return this.fields.get(selector) || [];
  }
  closest() { return null; }
  setAttribute() {}
  focus() {}
  fire(name, target = this, fields = {}) {
    for (const handler of [...(this.handlers.get(name) || [])]) handler({
      target, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...fields
    });
  }
  get listenerCount() { return [...this.handlers.values()].reduce((total, rows) => total + rows.size, 0); }
}

function timers() {
  let next = 0;
  const pending = new Map();
  const add = (fn, type) => { const id = ++next; pending.set(id, { fn, type }); return id; };
  return {
    pending, setTimeout: fn => add(fn, "timeout"), clearTimeout: id => pending.delete(id),
    setInterval: fn => add(fn, "interval"), clearInterval: id => pending.delete(id),
    requestAnimationFrame: fn => add(fn, "frame"), cancelAnimationFrame: id => pending.delete(id)
  };
}

const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const document = { querySelector: () => null, getElementById: () => null, activeElement: null };
const fixtures = [], observers = [];
const originalObserver = globalThis.IntersectionObserver, originalCss = globalThis.CSS;
globalThis.CSS = { escape: String };
globalThis.IntersectionObserver = class {
  connected = true;
  constructor() { observers.push(this); }
  observe() {}
  unobserve() {}
  disconnect() { this.connected = false; }
};

function fixture(kind, label, cash = 10000) {
  const products = Array.from({ length: 3 }, (_, index) => ({ id: `product-${index}`,
    name: `${label}玉件${index}`, type: "bracelet", materialStage: "finished", kind: "peacePendant",
    quality: "正冰", qualityKey: "ice", color: "晴水", value: 1000 + index * 100, price: 1000 + index * 100 }));
  const state = { me: { id: "same-player", name: label, cash, bracelets: products, rough: [], materials: [], slices: [],
    jobs: [], assets: { livestreamPermitOwned: true }, workshop: { workers: [], devices: [] } },
    listings: products.map((item, index) => ({ id: `listing-${index}`, item, type: "bracelet", price: item.value,
      ownerId: "seller", ownerName: "玉商", createdAt: 100 + index })), wants: [], players: [], livestreamRooms: [] };
  const root = new Element(), clock = timers(), router = createActionRouter(), commands = [], toasts = [];
  const helpers = { formatMoney: value => `¥${value}`, escapeHtml: esc, empty: text => `<p>${text}</p>`,
    showToast: value => toasts.push(value), typeName: type => type, finishedProducts: () => state.me.bracelets,
    productCanvas: item => `<svg data-item="${item.id}"></svg>`, openingStoneSvg: () => "<svg></svg>",
    openingKitsForRender: () => [], jadeCanvasMarkup: () => "<svg></svg>", paintProductCanvases() {} };
  const els = kind === "market" ? Object.fromEntries([
    "marketGrid", "marketStalls", "marketQFilters", "marketSearch", "marketSort", "marketPriceMin", "marketPriceMax",
    "marketPriceApply", "marketAfford", "marketReset", "marketBuyModal", "marketBuyBody", "marketWantPostModal"
  ].map(name => [name, new Element()])) : { livestream: root };
  const confirmBuy = new Element(), confirmPost = new Element();
  let mineActive = false;
  if (kind === "market") {
    const section = { querySelector: () => ({ classList: { toggle: (_name, value) => { mineActive = value; } } }) };
    els.marketGrid.closest = selector => selector === '[data-view="market"]' ? section : null;
    els.marketBuyModal.fields.set('[data-action="confirmMarketBuy"]', confirmBuy);
    const fields = { "#mwTitle": "求购玉件", "#mwBudget": "2000", "#mwType": "bracelet", "#mwScore": "3", "#mwNote": "", "#mwQuality": "" };
    for (const [name, value] of Object.entries(fields)) { const field = new Element(); field.value = value; els.marketWantPostModal.fields.set(name, field); }
    els.marketWantPostModal.fields.set("#mwKinds input:checked", [{ value: "peacePendant" }]);
    els.marketWantPostModal.fields.set("[data-action='confirmMarketWantPost']", confirmPost);
    els.marketGrid.lazy = [{}];
  } else root.lazy = [{}];
  const deps = { document, helpers, els, timers: clock, getState: () => state, getActiveView: () => kind,
    socket: { emit(event, ...args) { commands.push({ event, payload: args[0], ack: args.find(arg => typeof arg === "function") }); } },
    registerAction: (name, fn) => router.on(name, fn) };
  const feature = kind === "market" ? createMarketFeature(deps) : createLivestreamFeature(deps);
  const row = { state, products, root, clock, router, commands, toasts, deps, feature, els, confirmPost, mineActive: () => mineActive };
  fixtures.push(row);
  assert.equal(clock.pending.size, 0, "constructing a feature must not create timers");
  feature.mount(); feature.render();
  return row;
}

const control = (selector, fields = {}) => {
  const node = { ...fields, closest: query => query === selector ? node : null };
  return node;
};

try {
  const a = fixture("market", "甲"), b = fixture("market", "乙", 100);
  assert.equal(a.feature.marketAffordable(1000), true);
  assert.equal(b.feature.marketAffordable(1000), false);
  const count = a.els.marketSearch.listenerCount;
  a.feature.mount(); a.feature.bindMarketOnce();
  assert.equal(a.els.marketSearch.listenerCount, count, "mount and lazy binding are idempotent");
  a.els.marketSearch.fire("input", { value: "甲玉件1" });
  assert.deepEqual(a.feature.marketFilterSort(a.state.listings).map(row => row.id), ["listing-1"]);
  assert.equal(b.feature.marketFilterSort(b.state.listings).length, 3, "filters stay private with identical player and item IDs");
  a.feature.marketSetSection({ dataset: { marketSection: "mine" } });
  assert.equal(a.mineActive(), true);
  assert.equal(b.mineActive(), false, "section highlighting belongs to the instance's market root");
  a.feature.marketSetSection({ dataset: { marketSection: "listings" } });
  a.feature.openMarketBuy("listing-1"); a.feature.confirmMarketBuy();
  assert.equal(a.commands.at(-1).event, "buyListing");
  assert.equal(a.commands.at(-1).payload, "listing-1");
  assert.equal(b.commands.length, 0);
  a.feature.confirmMarketWantPost(); b.feature.confirmMarketWantPost();
  const pending = a.commands.at(-1), staleAction = a.router;
  assert.equal(pending.event, "postWant");
  assert.deepEqual(pending.payload.itemTypes, ["bracelet"]);
  assert.equal(a.confirmPost.disabled, true);
  assert.equal(a.clock.pending.size, 1);
  assert.equal(b.clock.pending.size, 1);
  const aObserver = observers[0], bObserver = observers[1];
  const toastCount = a.toasts.length;
  a.feature.dispose(); a.feature.dispose();
  assert.equal(a.clock.pending.size, 0);
  assert.equal(a.confirmPost.disabled, false, "teardown releases the abandoned submitting control");
  assert.equal(a.els.marketSearch.listenerCount, 0);
  a.feature.bindMarketOnce();
  assert.equal(a.els.marketSearch.listenerCount, 0, "an unmounted feature cannot install filter listeners");
  assert.equal(staleAction.has("confirmMarketBuy"), false);
  assert.equal(aObserver.connected, false);
  assert.equal(bObserver.connected, true);
  pending.ack({ ok: true, message: "延迟成功" });
  assert.equal(a.toasts.length, toastCount, "late acknowledgements do not update a disposed view");
  a.feature.mount(); a.feature.render();
  assert.equal(a.els.marketSearch.listenerCount, count);
  assert.equal(a.feature.marketFilterSort(a.state.listings)[0].id, "listing-1", "remount retains the instance's filter draft");

  const liveA = fixture("livestream", "甲"), liveB = fixture("livestream", "乙");
  const listenerCount = liveA.root.listenerCount;
  liveA.feature.mount();
  assert.equal(liveA.root.listenerCount, listenerCount);
  assert.equal(liveA.clock.pending.size, 2, "a live feature owns one carousel and one chat timer");
  for (const row of [liveA, liveB]) {
    for (const item of row.products) row.root.fire("change", control("[data-livestream-select]", {
      dataset: { livestreamSelect: item.id }, checked: true
    }));
  }
  liveA.root.fire("input", control("[data-livestream-price]", { dataset: { livestreamPrice: "product-0" }, value: "777" }));
  const start = control("[data-livestream-action]", { dataset: { livestreamAction: "start" } });
  liveA.root.fire("click", start); liveB.root.fire("click", start);
  assert.equal(liveA.commands.at(-1).event, "startLivestreamRoom");
  assert.deepEqual(liveA.commands.at(-1).payload.items.map(item => item.price), [777, 1155, 1260]);
  assert.deepEqual(liveB.commands.at(-1).payload.items.map(item => item.price), [1050, 1155, 1260]);
  assert.equal(liveA.commands.at(-1).payload.workerId, null);
  liveA.feature.appendLivestreamChatComments("same-room", 2, 100);
  assert.equal(liveA.feature.buildLivestreamChatFeed({ id: "same-room" }).length, 2);
  assert.equal(liveB.feature.buildLivestreamChatFeed({ id: "same-room" }).length, 0);
  const oldClick = [...liveA.root.handlers.get("click")][0];
  const oldTimers = [...liveA.clock.pending.values()].map(row => row.fn);
  let capturedPointer = null;
  const scroller = new Element();
  Object.assign(scroller, { scrollWidth: 800, clientWidth: 200, scrollLeft: 0,
    setPointerCapture: id => { capturedPointer = id; }, releasePointerCapture: () => { capturedPointer = null; } });
  const shelf = control("[data-livestream-shelf-scroll]", scroller);
  liveA.root.fire("pointerdown", shelf, { pointerId: 9, button: 0, clientX: 100 });
  liveA.root.fire("pointermove", shelf, { pointerId: 9, clientX: 70 });
  assert.equal(capturedPointer, 9);
  assert.equal(shelf.scrollLeft, 30);
  liveA.feature.dispose();
  assert.equal(capturedPointer, null, "disposing a dragged shelf releases its pointer capture");
  assert.equal(liveA.root.listenerCount, 0);
  assert.equal(liveA.clock.pending.size, 0);
  assert.equal(liveB.clock.pending.size, 2);
  liveA.feature.mount();
  const sent = liveA.commands.length;
  oldClick({ target: start }); oldTimers.forEach(fn => fn());
  assert.equal(liveA.commands.length, sent, "callbacks from a prior mount remain inert after remount");
  assert.equal(liveA.clock.pending.size, 2);
  liveA.root.fire("click", start);
  assert.equal(liveA.commands.length, sent + 1, "remount submits a single command per click");
  liveB.state.me.livestreamRoom = { id: "owner-room", items: [] };
  liveB.root.fire("click", control("[data-livestream-action]", { dataset: { livestreamAction: "replenish" } }));
  assert.equal(liveB.commands.at(-1).event, "replenishLivestreamRoom");
  assert.equal(liveB.commands.at(-1).payload.items.length, 3);
  liveB.root.fire("click", control("[data-livestream-action]", { dataset: { livestreamAction: "confirm-close" } }));
  assert.equal(liveB.commands.at(-1).event, "closeLivestreamRoom");
  liveB.root.fire("click", control("[data-livestream-action]", {
    dataset: { livestreamAction: "confirm-buy", roomId: "seller-room", itemId: "product-0" }
  }));
  assert.equal(liveB.commands.at(-1).event, "buyLivestreamRoomItem");
  assert.equal(liveB.commands.at(-1).payload.roomId, "seller-room");
  assert.equal(liveB.commands.at(-1).payload.itemId, "product-0");

  const cancelled = [], scope = createFeatureScope({ timers: {
    setInterval: () => 1, clearInterval: id => cancelled.push(["interval", id]),
    requestAnimationFrame: () => 1, cancelAnimationFrame: id => cancelled.push(["frame", id])
  } });
  scope.activate();
  scope.setInterval(() => {}, 4000);
  scope.requestAnimationFrame(() => {});
  scope.dispose();
  assert.deepEqual(cancelled, [["interval", 1], ["frame", 1]], "native timer and animation-frame IDs belong to separate cancellation domains");

  initMarketModule({ ...b.deps, registerAction: undefined });
  initLivestreamModule({ ...liveB.deps, els: { livestream: new Element() }, timers: timers() });
  assert.equal(a.feature.marketFilterSort(a.state.listings).length, 1);
  assert.equal(liveA.feature.buildLivestreamChatFeed({ id: "same-room" }).length, 2, "rebinding legacy entries does not replace private instances");
} finally {
  disposeMarketModule(); disposeLivestreamModule();
  for (const { feature, clock, root, els, router } of fixtures) {
    feature.dispose();
    assert.equal(clock.pending.size, 0);
    assert.equal(root.listenerCount, 0);
    assert.deepEqual(router.list(), []);
    for (const el of Object.values(els)) assert.equal(el.listenerCount, 0);
  }
  globalThis.IntersectionObserver = originalObserver;
  globalThis.CSS = originalCss;
}
console.log("commerce-feature-lifecycle-smoke: private filters, prices, chat, commands, acknowledgement disposal, listeners, timers, observers and remount passed");
