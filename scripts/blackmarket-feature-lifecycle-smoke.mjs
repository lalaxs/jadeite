import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createBlackmarketFeature, initBlackmarketModule, disposeBlackmarketModule } from "../public/blackmarket-module.js";
import { initMarketModule, disposeMarketModule } from "../public/market-module.js";
import { createActionRouter } from "../public/shell/action-router.js";

class Element extends EventEmitter {
  dataset = {};
  fields = new Map();
  hidden = true;
  value = "";
  disabled = false;
  innerHTML = "";
  lazy = [];
  classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  addEventListener(name, handler) { this.on(name, handler); }
  removeEventListener(name, handler) { this.off(name, handler); }
  querySelector(selector) { return this.fields.get(selector) || null; }
  querySelectorAll(selector) { return selector === "[data-lazy-preview].is-pending" ? this.lazy : []; }
  closest() { return null; }
  setAttribute() {}
  focus() {}
  fire(name, target = this) { this.emit(name, { target, currentTarget: this, preventDefault() {}, stopPropagation() {} }); }
}

class Socket extends EventEmitter {
  commands = [];
  emit(event, ...args) { this.commands.push({ event, args }); return true; }
  receive(event, payload) { super.emit(event, payload); }
}

function timers() {
  let sequence = 0;
  const pending = new Map();
  const add = callback => { const id = ++sequence; pending.set(id, callback); return id; };
  return { pending, setTimeout: add, setInterval: add, requestAnimationFrame: add,
    clearTimeout: id => pending.delete(id), clearInterval: id => pending.delete(id), cancelAnimationFrame: id => pending.delete(id) };
}

const fixtures = [], observers = [];
const originalObserver = globalThis.IntersectionObserver;
globalThis.IntersectionObserver = class {
  connected = true;
  constructor() { observers.push(this); }
  observe() {}
  unobserve() {}
  disconnect() { this.connected = false; }
};

function fixture(label, cash = 10000) {
  const product = { id: "same-product", name: `${label}平安扣`, type: "bracelet", kind: "peacePendant",
    materialStage: "finished", qualityKey: "ice", value: 1000 };
  const mine = { id: "same-mine", isMine: true, type: "goods", status: "open", items: [], title: `${label}货架`, offers: [] };
  const other = { id: "same-other", type: "goods", status: "open", title: `${label}摊位`, items: [
    { id: "same-row", type: "bracelet", price: 1000, item: { ...product, id: "other-product" } }
  ], summary: { count: 1 } };
  const state = { me: { id: "same-player", name: label, cash, achievementPoints: 100, bracelets: [product], rough: [], materials: [],
    slices: [], jobs: [], externalMaterials: {}, workshop: { devices: [], workers: [] } },
    blackStalls: [mine, other], blackServiceOrders: [], listings: [], wants: [] };
  const ids = new Map();
  for (const id of ["mainStage", "bmGrid", "bmStalls", "bmSearch", "bmSort", "bmReset", "bmShop", "bmBuyModal", "bmBuyBody",
    "bmListModal", "bmMlGrid", "bmMlDetail", "bmListConfirmBtn", "bmBlindDrawModal", "bmBlindDrawStage", "bmBlindDrawCards",
    "bmBlindDrawConfirm", "bmBlindDrawHint", "bmBlindDrawPrice", "bmBlindStockPrice", "bmServiceOfferModal", "bmServiceProfileModal",
    "bmOrderServiceModal"]) ids.set(id, new Element());
  const document = new Element(), root = new Element();
  document.defaultView = { innerHeight: 800 };
  document.getElementById = id => ids.get(id) || null;
  document.querySelector = selector => selector.startsWith("section.view") ? root : null;
  const els = Object.fromEntries(ids);
  els.bmGrid.lazy = [{}];
  const socket = new Socket(), clock = timers(), router = createActionRouter(), toasts = [];
  const helpers = { formatMoney: value => `¥${value}`, escapeHtml: value => String(value ?? ""), empty: text => `<p>${text}</p>`,
    showToast: value => toasts.push(value), typeName: type => type, productCanvas: item => `<svg data-product="${item.name}"></svg>`,
    openingStoneSvg: () => "<svg></svg>", openingKitsForRender: () => [], jadeCanvasMarkup: () => "<svg></svg>",
    kitsFor: () => [], openingKitsForServer: () => [], openingKitFromStored: value => value, roughKits: new Map() };
  const deps = { socket, document, els, helpers, timers: clock, getState: () => state, getActiveView: () => "blackmarket",
    setView() {}, registerAction: (name, callback) => router.on(name, callback) };
  const feature = createBlackmarketFeature(deps);
  const row = { feature, deps, document, ids, els, state, mine, other, product, socket, clock, router, toasts };
  fixtures.push(row);
  assert.equal(document.eventNames().length, 0);
  assert.equal(socket.eventNames().length, 0);
  assert.equal(clock.pending.size, 0, "construction has no listeners or scheduled work");
  return row;
}

try {
  const a = fixture("甲"), b = fixture("乙", 100);
  let outsiderEvents = 0;
  const outsider = () => outsiderEvents++;
  a.socket.on("bmListResult", outsider);
  a.feature.mount().render(); b.feature.mount().render();
  a.feature.bmUi.detailStallId = a.other.id; a.feature.renderBmDetail();
  b.feature.bmUi.detailStallId = b.other.id; b.feature.renderBmDetail();
  assert.equal(a.feature.bmAffordable(1000), true);
  assert.equal(b.feature.bmAffordable(1000), false);
  assert.equal(a.socket.listenerCount("bmListResult"), 2, "mount preserves another socket consumer");
  assert.equal(a.document.listenerCount("keydown"), 1);
  a.feature.mount().render();
  assert.equal(a.document.listenerCount("keydown"), 1, "mount is idempotent");
  assert.equal(a.els.bmSearch.listenerCount("input"), 1);
  a.els.bmSearch.value = "甲"; a.els.bmSearch.fire("input");
  assert.equal(a.feature.bmUi.search, "甲");
  assert.equal(b.feature.bmUi.search, "");
  a.feature.bmUi.goodsSelectedIds.add(a.product.id);
  a.feature.bmUi.goodsPriceById.set(a.product.id, 700);
  assert.equal(b.feature.bmUi.goodsSelectedIds.size, 0);
  assert.equal(b.feature.bmUi.goodsPriceById.size, 0);

  // Market/default-instance rebindings cannot redirect private product rendering or commands.
  initMarketModule({ ...a.deps, registerAction: () => {}, helpers: { ...a.deps.helpers, productCanvas: () => "MARKET-ONLY" } });
  assert.match(a.feature.goodsRowHtml(a.other, a.other.items[0], false), /甲平安扣/);
  assert.doesNotMatch(a.feature.goodsRowHtml(a.other, a.other.items[0], false), /MARKET-ONLY|乙平安扣/);
  initBlackmarketModule(b.deps);
  a.feature.openBmBuy("same-row", "same-other"); a.feature.confirmBmBuy();
  assert.deepEqual(a.socket.commands.at(-1), { event: "bmBuyListing", args: [{ stallId: "same-other", listingId: "same-row", expectedPrice: 1000 }] });
  assert.equal(b.socket.commands.length, 0);
  disposeBlackmarketModule();
  assert.equal(b.socket.listenerCount("bmListResult"), 1, "default disposal retains the private instance's subscription");

  a.feature.confirmBmList();
  assert.equal(a.socket.commands.at(-1).event, "bmListItem");
  assert.deepEqual(a.socket.commands.at(-1).args[0].entries, [{ type: "bracelet", itemId: "same-product", price: 700 }]);
  assert.equal(a.feature.bmUi.goodsSubmitting, true);
  assert.equal(a.clock.pending.size, 1);
  a.socket.receive("bmListResult", { ok: false, message: "报价未提交" });
  assert.equal(a.feature.bmUi.goodsSubmitting, false);
  assert.equal(a.clock.pending.size, 0, "a server result cancels its submission fallback");
  a.feature.confirmBmList();
  b.feature.bmUi.goodsSelectedIds.add(b.product.id);
  b.feature.confirmBmList();
  const draw = { id: "same-draw", stallId: "same-other", price: 100, candidates: [{ itemId: "same-product", item: a.product }] };
  a.other.activeBlindDraw = draw;
  a.feature.openBmBlindDrawModal(draw); b.feature.openBmBlindDrawModal(draw);
  assert.equal(a.clock.pending.size, 2);
  assert.equal(b.clock.pending.size, 2);
  const staleResult = a.socket.listeners("bmListResult").find(fn => fn !== outsider);
  const commandsBefore = a.socket.commands.length, toastsBefore = a.toasts.length;
  const aObserver = observers[0], bObserver = observers[1];
  a.feature.dispose(); a.feature.dispose();
  assert.equal(a.clock.pending.size, 0);
  assert.equal(b.clock.pending.size, 2);
  assert.equal(a.document.eventNames().length, 0);
  assert.equal(a.els.bmSearch.listenerCount("input"), 0);
  assert.deepEqual(a.router.list(), []);
  assert.equal(a.socket.listenerCount("bmListResult"), 1);
  assert.equal(aObserver.connected, false);
  assert.equal(bObserver.connected, true);
  assert.equal(a.ids.get("bmBlindDrawModal").hidden, true);
  assert.equal(b.ids.get("bmBlindDrawModal").hidden, false);
  assert.equal(a.socket.commands.length, commandsBefore, "teardown does not close a stall or settle a draw");
  assert.equal(a.other.activeBlindDraw, draw, "the server-owned pending draw survives view disposal");
  a.socket.receive("bmListResult", { ok: true, message: "迟到结果", clearedParentIds: ["parent"] });
  assert.equal(outsiderEvents, 2);
  assert.equal(a.toasts.length, toastsBefore);
  a.feature.mount().render();
  staleResult({ ok: true, message: "旧挂载结果" });
  assert.equal(a.toasts.length, toastsBefore, "callbacks from an earlier mount remain invalid after remount");
  assert.equal(a.feature.bmUi.search, "甲");
  assert.equal(a.feature.bmUi.blindDraw.drawId, draw.id);
  assert.equal(a.feature.bmUi.blindDraw.phase, "pick", "remount resumes the authoritative pending draw");
  assert.equal(a.els.bmSearch.listenerCount("input"), 1);
  assert.equal(a.socket.listenerCount("bmListResult"), 2);
} finally {
  for (const row of fixtures) row.feature.dispose();
  disposeBlackmarketModule(); disposeMarketModule();
  globalThis.IntersectionObserver = originalObserver;
}

console.log("blackmarket-feature-lifecycle-smoke: product independence, private drafts, commands, subscriptions, timers, previews, stale results and remount ok");
