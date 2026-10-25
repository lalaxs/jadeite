// 列表重预览懒加载：先占位，进入视口后再插入 SVG/canvas；可写入位图缓存供下次直出。
import { paintJadeCanvases } from "./jade-renderer.js";
import {
  getPreviewBitmap,
  preparePreviewBitmap,
  previewBitmapImgMarkup,
  schedulePreviewBitmapCapture
} from "./preview-bitmap-cache.js";

const HYDRATED = "1";

function escapeAttr(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function createObserver() {
  if (typeof IntersectionObserver === "undefined") return null;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      hydrateLazyPreview(entry.target);
      observer.unobserve(entry.target);
    }
  }, {
    root: null,
    rootMargin: "160px 0px",
    threshold: 0.01
  });
  return observer;
}

export function createLazyPreviewObserver() {
  let observer = null;
  return {
    observe(root = document) {
      if (!root?.querySelectorAll) return 0;
      const nodes = [...root.querySelectorAll("[data-lazy-preview].is-pending")];
      if (!nodes.length) return 0;
      observer ||= createObserver();
      if (observer) nodes.forEach(node => observer.observe(node));
      else nodes.forEach(node => hydrateLazyPreview(node));
      return nodes.length;
    },
    unobserve(node) { observer?.unobserve(node); },
    disconnect() { observer?.disconnect(); observer = null; }
  };
}

const defaultObserver = createLazyPreviewObserver();

/** 把重预览包进懒加载壳；有位图缓存时直接出图；eager 时原样返回。 */
export function lazyPreviewMarkup(innerHtml, options = {}) {
  const html = String(innerHtml || "");
  if (!html || options.eager) return html;
  const cacheKey = options.cacheKey ? String(options.cacheKey) : "";
  if (cacheKey) {
    const hit = getPreviewBitmap(cacheKey);
    if (hit) return previewBitmapImgMarkup(hit);
  }
  const aspect = options.aspect || "1 / 1";
  const tint = options.tint ? `;--lazy-tint:${options.tint}` : "";
  const keyAttr = cacheKey ? ` data-preview-cache-key="${escapeAttr(cacheKey)}"` : "";
  const bitmapAttr = options.bitmapOnly && cacheKey ? ' data-preview-bitmap-only="1"' : "";
  return `
    <div class="lazy-preview is-pending" data-lazy-preview${keyAttr}${bitmapAttr} style="--lazy-aspect:${aspect}${tint}">
      <div class="lazy-preview-ph" aria-hidden="true"></div>
      <template>${html}</template>
    </div>
  `;
}

export function hydrateLazyPreview(node) {
  if (!node || node.dataset.lazyHydrated === HYDRATED || node.dataset.lazyHydrating === HYDRATED) return false;
  const tpl = node.querySelector(":scope > template");
  if (!tpl) {
    node.dataset.lazyHydrated = HYDRATED;
    node.classList.remove("is-pending");
    return false;
  }
  const fragment = tpl.content.cloneNode(true);
  const cacheKey = node.dataset.previewCacheKey || "";
  if (node.dataset.previewBitmapOnly && fragment.querySelector?.("svg")) {
    node.dataset.lazyHydrating = HYDRATED;
    preparePreviewBitmap(cacheKey, () => fragment, { isCurrent: () => node.isConnected }).then((bitmap) => {
      delete node.dataset.lazyHydrating;
      if (!node.isConnected || node.dataset.lazyHydrated === HYDRATED) return;
      if (bitmap) {
        node.innerHTML = `<img class="lazy-preview-bitmap" alt="" draggable="false" src="${bitmap}" decoding="async" />`;
        node.classList.add("is-bitmap");
      } else {
        // Missing assets / unsupported SVG capture retain the full original art.
        node.replaceChildren(fragment);
        paintJadeCanvases(node);
      }
      node.classList.remove("is-pending");
      node.dataset.lazyHydrated = HYDRATED;
    });
    return true;
  }
  node.replaceChildren(fragment);
  node.classList.remove("is-pending");
  node.dataset.lazyHydrated = HYDRATED;
  if (typeof node.querySelectorAll === "function") paintJadeCanvases(node);
  if (cacheKey) schedulePreviewBitmapCapture(node, cacheKey);
  return true;
}

/** 观察 root 内尚未 hydrate 的懒预览；无 IO 时立即全部展开。 */
export function observeLazyPreviews(root = document) {
  return defaultObserver.observe(root);
}

/** 强制 hydrate（选中态、开窗中等必须立刻可见的场景）。 */
export function hydrateLazyPreviewsNow(root = document) {
  if (!root?.querySelectorAll) return 0;
  const nodes = [...root.querySelectorAll("[data-lazy-preview].is-pending")];
  nodes.forEach((node) => {
    defaultObserver.unobserve(node);
    hydrateLazyPreview(node);
  });
  return nodes.length;
}
