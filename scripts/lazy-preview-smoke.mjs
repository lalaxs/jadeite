import assert from "node:assert/strict";
import {
  clearPreviewBitmapCache,
  getPreviewBitmap,
  previewBitmapCacheSize,
  previewBitmapImgMarkup,
  preparePreviewBitmap,
  setPreviewBitmap
} from "../public/preview-bitmap-cache.js";
import {
  hydrateLazyPreview,
  lazyPreviewMarkup,
  observeLazyPreviews
} from "../public/lazy-preview.js";
import { measureColumns, createVirtualGridController, measureRowStride, spaceHeightFor } from "../public/virtual-grid.js";

clearPreviewBitmapCache();
assert.equal(previewBitmapCacheSize(), 0);
setPreviewBitmap("k1", "data:image/png;base64,abc");
assert.equal(getPreviewBitmap("k1"), "data:image/png;base64,abc");
assert.match(previewBitmapImgMarkup("data:image/png;base64,abc"), /lazy-preview-bitmap/);
assert.match(
  lazyPreviewMarkup("<svg data-x=\"1\"></svg>", { cacheKey: "k1" }),
  /lazy-preview-bitmap/
);
assert.match(
  lazyPreviewMarkup("<svg data-x=\"2\"></svg>", { cacheKey: "miss" }),
  /data-preview-cache-key="miss"/
);
assert.match(
  lazyPreviewMarkup("<svg data-x=\"1\"></svg>"),
  /<template><svg data-x="1"><\/svg><\/template>/
);
assert.equal(
  lazyPreviewMarkup("<svg></svg>", { eager: true }),
  "<svg></svg>"
);

const node = {
  dataset: { previewCacheKey: "n1" },
  classList: {
    values: new Set(["lazy-preview", "is-pending"]),
    add(name) { this.values.add(name); },
    remove(name) { this.values.delete(name); },
    contains(name) { return this.values.has(name); }
  },
  children: [],
  querySelector(selector) {
    if (selector === ":scope > template") return this.template || null;
    return null;
  },
  replaceChildren(...nodes) {
    this.children = nodes;
  }
};
node.template = {
  content: {
    cloneNode() {
      return { kind: "frag", html: "<svg data-hydrated=\"1\"></svg>" };
    }
  }
};

assert.equal(hydrateLazyPreview(node), true);
assert.equal(node.dataset.lazyHydrated, "1");
assert.equal(node.classList.contains("is-pending"), false);
assert.equal(node.children[0]?.kind, "frag");
assert.equal(observeLazyPreviews({}), 0);
assert.equal(observeLazyPreviews(null), 0);

// Captures share work, prioritize visible cards and skip shelves already left.
const captureOrder = [];
const bitmapNode = (id) => ({ querySelector(selector) {
  if (selector !== "canvas") return null;
  return { width: 1, height: 1, toDataURL() { captureOrder.push(id); return `data:image/png;base64,${id}`; } };
} });
let sharedFactoryCalls = 0;
const speculative = preparePreviewBitmap("background", () => bitmapNode("background"), { priority: "background" });
const shared = preparePreviewBitmap("shared", () => { sharedFactoryCalls++; return bitmapNode("shared"); }, { priority: "background" });
const visible = preparePreviewBitmap("visible", () => bitmapNode("visible"));
const promoted = preparePreviewBitmap("shared", () => { sharedFactoryCalls++; return bitmapNode("shared"); });
assert.equal(shared, promoted, "hover and entering the same stall must share the pending capture");
const cancelled = preparePreviewBitmap("cancelled", () => { throw Error("left shelf must not render"); }, { isCurrent: () => false });
const failed = preparePreviewBitmap("failed", () => { throw Error("capture failed"); });
await Promise.all([speculative, shared, visible, cancelled, failed]);
assert.equal(sharedFactoryCalls, 1);
assert.deepEqual(captureOrder, ["shared", "visible", "background"]);
assert.equal(await cancelled, null);
assert.equal(await failed, null);
assert.equal(getPreviewBitmap("cancelled"), null);
assert.equal(await preparePreviewBitmap("shared", () => { throw Error("cache must skip rendering"); }), "data:image/png;base64,shared");

// Bitmap-first cards keep filtered SVGs detached until capture finishes.
let inserted = null;
const bitmapClasses = new Set(["is-pending"]);
const bitmapOnlyNode = {
  isConnected: true,
  dataset: { previewCacheKey: "shared", previewBitmapOnly: "1" },
  classList: { add: (name) => bitmapClasses.add(name), remove: (name) => bitmapClasses.delete(name) },
  querySelector: () => ({ content: { cloneNode: () => ({ querySelector: () => ({}) }) } }),
  replaceChildren: () => { throw Error("must not mount the expensive SVG before its bitmap"); },
  set innerHTML(value) { inserted = value; }
};
assert.equal(hydrateLazyPreview(bitmapOnlyNode), true);
assert.equal(hydrateLazyPreview(bitmapOnlyNode), false, "an in-flight card cannot schedule duplicate capture");
await Promise.resolve();
assert.match(inserted, /data:image\/png;base64,shared/);
assert.equal(bitmapOnlyNode.dataset.lazyHydrated, "1");
assert.equal(bitmapClasses.has("is-pending"), false);

let resolveFallback;
const fallbackReady = new Promise((done) => { resolveFallback = done; });
const fallbackNode = {
  ...bitmapOnlyNode, dataset: { previewCacheKey: "unsupported-svg", previewBitmapOnly: "1" },
  querySelectorAll: () => [],
  replaceChildren(fragment) { assert.ok(fragment); resolveFallback(); }
};
assert.equal(hydrateLazyPreview(fallbackNode), true);
await fallbackReady;
assert.equal(fallbackNode.dataset.lazyHydrated, "1", "failed capture must fall back to the original art");

const oldShelf = preparePreviewBitmap("replaced-shelf", () => { throw Error("stale shelf"); }, { priority: "background", isCurrent: () => false });
const refreshedShelf = preparePreviewBitmap("replaced-shelf", () => bitmapNode("refreshed"), { priority: "background" });
assert.equal(oldShelf, refreshedShelf);
assert.equal(await refreshedShelf, "data:image/png;base64,refreshed", "snapshot refresh keeps pending prewarming useful");

assert.equal(measureColumns(600, 180, 12), 3);
assert.equal(measureColumns(180, 180, 12), 1);
assert.equal(measureColumns(0, 180, 12), 1);

const host = {
  classList: {
    values: new Set(),
    add(name) { this.values.add(name); },
    remove(name) { this.values.delete(name); },
    contains(name) { return this.values.has(name); }
  },
  clientWidth: 600,
  style: {},
  innerHTML: "",
  querySelector(sel) {
    if (sel === ".virtual-grid-space") return this.space;
    if (sel === ".virtual-grid-window") return this.window;
    return null;
  },
  getBoundingClientRect() {
    return { top: 0, left: 0, width: 600, height: 800 };
  },
  parentElement: null
};
host.space = { style: {} };
host.window = { style: {}, innerHTML: "" };

const controller = createVirtualGridController({
  minItemWidth: 180,
  gap: 12,
  estimateRowHeight: 100,
  overscanRows: 0,
  scrollRoot: {
    clientHeight: 200,
    getBoundingClientRect() { return { top: 0, height: 200 }; },
    addEventListener() {},
    removeEventListener() {}
  }
});
controller.mount(host);
const rendered = [];
controller.setItems(
  Array.from({ length: 20 }, (_, i) => ({ id: i })),
  (item) => {
    rendered.push(item.id);
    return `<div data-id="${item.id}"></div>`;
  }
);
assert.ok(host.classList.contains("virtual-grid-host"));
assert.ok(rendered.length > 0);
assert.ok(rendered.length < 20, "virtual grid should not mount every item at once");

assert.equal(spaceHeightFor(11, 248, 12), 11 * 248 - 12);
assert.equal(measureRowStride({ children: [] }, 5, 12), 0);
const fakeWindow = {
  children: [
    { getBoundingClientRect: () => ({ top: 10, bottom: 300 }) },
    { getBoundingClientRect: () => ({ top: 10, bottom: 310 }) }
  ]
};
assert.equal(measureRowStride(fakeWindow, 5, 12), 312);

const measureHost = {
  classList: {
    _set: new Set(),
    add(name) { this._set.add(name); },
    remove(name) { this._set.delete(name); },
    contains(name) { return this._set.has(name); }
  },
  clientWidth: 600,
  style: {},
  innerHTML: "",
  querySelector(sel) {
    if (sel === ".virtual-grid-space") return this.space;
    if (sel === ".virtual-grid-window") return this.window;
    return null;
  },
  getBoundingClientRect() {
    return { top: 0, left: 0, width: 600, height: 800 };
  },
  parentElement: null
};
measureHost.space = { style: {} };
measureHost.window = {
  style: {},
  innerHTML: "",
  children: [
    { getBoundingClientRect: () => ({ top: 0, bottom: 300 }) },
    { getBoundingClientRect: () => ({ top: 0, bottom: 300 }) },
    { getBoundingClientRect: () => ({ top: 0, bottom: 300 }) }
  ]
};
Object.defineProperty(measureHost.window, "innerHTML", {
  set() {},
  get() { return ""; }
});
const measuredController = createVirtualGridController({
  minItemWidth: 180,
  gap: 12,
  estimateRowHeight: 200,
  overscanRows: 0,
  scrollRoot: {
    clientHeight: 400,
    getBoundingClientRect() { return { top: 0, height: 400 }; },
    addEventListener() {},
    removeEventListener() {}
  }
});
measuredController.mount(measureHost);
measuredController.setItems(
  Array.from({ length: 30 }, (_, i) => ({ id: i })),
  () => "<div></div>"
);
// 行高改为 rAF 后实测；无 rAF 的环境仍同步完成。
await new Promise((resolve) => {
  const raf = globalThis.requestAnimationFrame;
  if (typeof raf === "function") raf(() => raf(resolve));
  else resolve();
});
assert.equal(measuredController.rowStride, 312, "should adopt measured card stride");
assert.equal(measureHost.space.style.height, `${spaceHeightFor(10, 312, 12)}px`);
measuredController.destroy();

controller.destroy();
assert.equal(host.classList.contains("virtual-grid-host"), false);

console.log("lazy-preview-smoke: bitmap cache + virtual grid ok");
