// 列表预览位图缓存：首次展开 SVG/canvas 后栅格化，之后用 <img> 复用。
const PREVIEW_BITMAP_LIMIT = 96;
const previewBitmapCache = new Map();
// SVG loaded as an <img> cannot fetch linked PNGs. Embed the shared atlases
// before capture, otherwise a cached inventory card silently loses its art.
const svgImageDataCache = new Map();
const bitmapJobs = new Map();
let bitmapJobRunning = false;
let bitmapJobScheduled = false;

// One capture at a time: several SVG filter paints / PNG encodes in the same
// frame can freeze the stall even when the markup itself is quick to build.
function scheduleBitmapJob() {
  if (bitmapJobRunning || bitmapJobScheduled || !bitmapJobs.size) return;
  bitmapJobScheduled = true;
  const run = async () => {
    bitmapJobScheduled = false;
    const jobs = [...bitmapJobs.values()];
    const job = jobs.find((entry) => entry.priority === "visible") || jobs[0];
    if (!job) return;
    bitmapJobRunning = true;
    job.started = true;
    let bitmap = getPreviewBitmap(job.key);
    try {
      if (!bitmap && job.isCurrent()) bitmap = await rasterizePreviewNode(job.createNode(), job.size);
      if (bitmap) setPreviewBitmap(job.key, bitmap);
    } catch {
      // A failed capture must leave the original preview available as fallback.
    } finally {
      bitmapJobs.delete(job.key);
      bitmapJobRunning = false;
      job.resolve(bitmap);
      scheduleBitmapJob();
    }
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 100 });
  else setTimeout(run, 0);
}

/** Share pending work between plaza prewarming and the visible stall. */
export function preparePreviewBitmap(cacheKey, createNode, options = {}) {
  if (!cacheKey || typeof createNode !== "function") return Promise.resolve(null);
  const hit = getPreviewBitmap(cacheKey);
  if (hit) return Promise.resolve(hit);
  const priority = options.priority || "visible";
  const isCurrent = options.isCurrent || (() => true);
  const existing = bitmapJobs.get(cacheKey);
  if (existing) {
    if (!existing.started && (priority === "visible" || existing.priority === "background")) {
      existing.priority = priority;
      existing.isCurrent = isCurrent;
      existing.createNode = createNode;
    }
    return existing.promise;
  }
  // Background work is speculative; bound both retained closures and stock data.
  if (bitmapJobs.size >= PREVIEW_BITMAP_LIMIT) {
    const speculative = priority === "visible" && [...bitmapJobs.values()].find((job) => !job.started && job.priority === "background");
    if (!speculative) return Promise.resolve(null);
    bitmapJobs.delete(speculative.key);
    speculative.resolve(null);
  }
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  bitmapJobs.set(cacheKey, { key: cacheKey, createNode, isCurrent, priority, size: options.size || 256, resolve, promise });
  scheduleBitmapJob();
  return promise;
}

async function previewImageDataUrl(href) {
  const url = new URL(href, document.baseURI);
  if (url.origin !== new URL(document.baseURI).origin) throw new Error("Preview image must be same-origin");
  if (!svgImageDataCache.has(url.href)) {
    const pending = (async () => {
      const response = await fetch(url.href);
      if (!response.ok) throw new Error("Preview image did not load");
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    })();
    svgImageDataCache.set(url.href, pending);
    pending.catch(() => { if (svgImageDataCache.get(url.href) === pending) svgImageDataCache.delete(url.href); });
    if (svgImageDataCache.size > 8) svgImageDataCache.delete(svgImageDataCache.keys().next().value);
  }
  return svgImageDataCache.get(url.href);
}

export async function inlinePreviewImages(svg) {
  await Promise.all([...svg.querySelectorAll("image")].map(async (image) => {
    const href = image.getAttribute("href") || image.getAttributeNS("http://www.w3.org/1999/xlink", "href");
    if (!href || href.startsWith("#") || href.startsWith("data:")) return;
    const dataUrl = await previewImageDataUrl(href);
    image.removeAttributeNS("http://www.w3.org/1999/xlink", "href");
    image.setAttribute("href", dataUrl);
  }));
}

export function cutoutPreviewSignature(kits = []) {
  return `hollow-v2:${kits.map((kit) => [kit.tpl || kit.openingTpl || kit.type, kit.x, kit.y, kit.rot ?? kit.rotation ?? 0, kit.scale, kit.size, Boolean(kit.extracted)].join(",")).join(";")}`;
}

export function getPreviewBitmap(key) {
  if (!key || !previewBitmapCache.has(key)) return null;
  const value = previewBitmapCache.get(key);
  previewBitmapCache.delete(key);
  previewBitmapCache.set(key, value);
  return value;
}

export function setPreviewBitmap(key, dataUrl) {
  if (!key || !dataUrl) return;
  if (previewBitmapCache.has(key)) previewBitmapCache.delete(key);
  previewBitmapCache.set(key, dataUrl);
  while (previewBitmapCache.size > PREVIEW_BITMAP_LIMIT) {
    previewBitmapCache.delete(previewBitmapCache.keys().next().value);
  }
}

export function clearPreviewBitmapCache() {
  previewBitmapCache.clear();
}

export function previewBitmapCacheSize() {
  return previewBitmapCache.size;
}

export function previewBitmapImgMarkup(dataUrl) {
  return `
    <div class="lazy-preview is-bitmap" data-lazy-hydrated="1">
      <img class="lazy-preview-bitmap" alt="" draggable="false" src="${dataUrl}" loading="lazy" decoding="async" />
    </div>
  `;
}

async function rasterizeSvgElement(svg, size = 256) {
  if (!svg || typeof XMLSerializer === "undefined") return null;
  const cloned = svg.cloneNode(true);
  try {
    await inlinePreviewImages(cloned);
  } catch {
    // Leave the live SVG in place on an asset failure; never cache missing art.
    return null;
  }
  return new Promise((resolve) => {
    try {
      if (!cloned.getAttribute("xmlns")) cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      cloned.setAttribute("width", String(size));
      cloned.setAttribute("height", String(size));
      const xml = new XMLSerializer().serializeToString(cloned);
      const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, size, size);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL("image/png"));
        } catch {
          URL.revokeObjectURL(url);
          resolve(null);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    } catch {
      resolve(null);
    }
  });
}

/** 从已插入 DOM 的预览节点生成 dataURL（优先 SVG，其次 canvas）。 */
export function rasterizePreviewNode(node, size = 256) {
  if (!node || typeof node.querySelector !== "function") return Promise.resolve(null);
  const svg = node.querySelector("svg");
  if (svg) return rasterizeSvgElement(svg, size);
  const canvas = node.querySelector("canvas");
  if (canvas && canvas.width > 0 && canvas.height > 0) {
    try {
      return Promise.resolve(canvas.toDataURL("image/png"));
    } catch {
      return Promise.resolve(null);
    }
  }
  return Promise.resolve(null);
}

export function schedulePreviewBitmapCapture(node, cacheKey, size = 256) {
  if (!node || !cacheKey) return;
  const run = () => {
    rasterizePreviewNode(node, size).then((dataUrl) => {
      if (!dataUrl) return;
      setPreviewBitmap(cacheKey, dataUrl);
      if (!node.isConnected) return;
      node.classList.add("is-bitmap");
      node.classList.remove("is-pending");
      node.dataset.lazyHydrated = "1";
      node.innerHTML = `<img class="lazy-preview-bitmap" alt="" draggable="false" src="${dataUrl}" decoding="async" />`;
    });
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 400 });
      else setTimeout(run, 0);
    });
  } else {
    setTimeout(run, 0);
  }
}
