// 等宽列虚拟网格：只挂载视口附近行，适合库存等长列表。
function measureColumns(width, minItemWidth, gap) {
  const w = Math.max(0, Number(width) || 0);
  const min = Math.max(1, Number(minItemWidth) || 180);
  const g = Math.max(0, Number(gap) || 0);
  return Math.max(1, Math.floor((w + g) / (min + g)));
}

function findScrollRoot(el) {
  let node = el?.parentElement;
  while (node && node !== globalThis.document?.body) {
    const style = globalThis.getComputedStyle?.(node);
    const overflowY = style?.overflowY || "";
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return node;
    node = node.parentElement;
  }
  return globalThis.document?.scrollingElement || globalThis.document?.documentElement || null;
}

function visibleWindow(host, scrollRoot) {
  const hostRect = host.getBoundingClientRect();
  const doc = globalThis.document;
  const isDoc = !scrollRoot
    || scrollRoot === doc?.scrollingElement
    || scrollRoot === doc?.documentElement;
  if (isDoc) {
    return {
      viewTop: Math.max(0, -hostRect.top),
      viewHeight: globalThis.innerHeight || 800
    };
  }
  const rootRect = scrollRoot.getBoundingClientRect();
  return {
    viewTop: Math.max(0, rootRect.top - hostRect.top),
    viewHeight: scrollRoot.clientHeight || rootRect.height || 800
  };
}

/** 用已挂载的首行卡片实测行距（含 gap），避免低估导致滚不到底部。 */
function measureRowStride(windowEl, cols, gap) {
  if (!windowEl?.children?.length) return 0;
  const sampleCount = Math.min(Math.max(1, cols), windowEl.children.length);
  let minTop = Infinity;
  let maxBottom = -Infinity;
  for (let i = 0; i < sampleCount; i += 1) {
    const el = windowEl.children[i];
    const rect = typeof el.getBoundingClientRect === "function"
      ? el.getBoundingClientRect()
      : null;
    if (!rect || !Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) continue;
    minTop = Math.min(minTop, rect.top);
    maxBottom = Math.max(maxBottom, rect.bottom);
  }
  if (!Number.isFinite(minTop) || maxBottom <= minTop) return 0;
  return Math.max(1, Math.round(maxBottom - minTop + Math.max(0, gap)));
}

function spaceHeightFor(rows, stride, gap) {
  if (rows <= 0) return 0;
  return Math.max(rows * stride - (rows > 1 ? gap : 0), 0);
}

export function createVirtualGridController(options = {}) {
  const minItemWidth = Number(options.minItemWidth) || 180;
  const gap = Number(options.gap) || 12;
  const estimateRowHeight = Number(options.estimateRowHeight) || 248;
  const overscanRows = Number(options.overscanRows) || 2;
  let host = null;
  let space = null;
  let windowEl = null;
  let items = [];
  let renderItem = () => "";
  let onAfterRender = null;
  let scrollRoot = null;
  let cols = 1;
  let rowStride = estimateRowHeight;
  let frame = 0;
  let measureFrame = 0;
  let bound = false;
  let remeasurePass = false;
  let resizeObserver = null;
  let lastColCount = 0;

  function totalRows() {
    return Math.ceil(items.length / Math.max(1, cols)) || 0;
  }

  function syncColumns() {
    const width = host?.clientWidth || scrollRoot?.clientWidth || 360;
    const responsiveWidth = Number.parseFloat(globalThis.getComputedStyle?.(host)?.getPropertyValue?.("--grid-card-min"));
    const nextCols = measureColumns(width, responsiveWidth || minItemWidth, gap);
    if (nextCols !== cols) {
      cols = nextCols;
      // 列数变化后旧行距失效，回到估算值再实测。
      rowStride = estimateRowHeight;
    }
    if (windowEl) windowEl.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  }

  function applyMeasuredStride() {
    if (!host || !space || !windowEl) return false;
    const measured = measureRowStride(windowEl, cols, gap);
    if (!(measured > 0)) return false;
    // 行高只增不减（同列数下），避免 content-visibility/尚未布局时的低估把占位锁死。
    const sameCols = lastColCount === cols;
    const next = sameCols ? Math.max(rowStride, measured) : measured;
    lastColCount = cols;
    if (Math.abs(next - rowStride) <= 2) return false;
    rowStride = next;
    space.style.height = `${spaceHeightFor(totalRows(), rowStride, gap)}px`;
    return true;
  }

  function scheduleRemeasure() {
    if (measureFrame) return;
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === "function") {
      measureFrame = raf(() => {
        measureFrame = 0;
        if (!applyMeasuredStride()) return;
        // 行距抬高后重算窗口，避免底部仍按旧低估切行。
        if (!remeasurePass) {
          remeasurePass = true;
          try {
            paint();
          } finally {
            remeasurePass = false;
          }
        }
      });
    } else if (applyMeasuredStride() && !remeasurePass) {
      remeasurePass = true;
      try {
        paint();
      } finally {
        remeasurePass = false;
      }
    }
  }

  function paint() {
    if (!host || !space || !windowEl) return;
    syncColumns();
    const rows = totalRows();
    const stride = Math.max(1, rowStride || estimateRowHeight);
    space.style.height = `${spaceHeightFor(rows, stride, gap)}px`;

    const root = scrollRoot || findScrollRoot(host);
    const { viewTop, viewHeight } = visibleWindow(host, root);
    const startRow = Math.max(0, Math.floor(viewTop / stride) - overscanRows);
    const endRow = Math.min(rows, Math.ceil((viewTop + viewHeight) / stride) + overscanRows);
    const startIndex = startRow * cols;
    const endIndex = Math.min(items.length, endRow * cols);
    const offsetY = startRow * stride;

    windowEl.style.transform = `translateY(${offsetY}px)`;
    const slice = items.slice(startIndex, endIndex);
    windowEl.innerHTML = slice.map((item, index) => renderItem(item, startIndex + index)).join("");
    onAfterRender?.(windowEl, slice);

    // 等一帧布局完成后再量行高；ResizeObserver 兜底懒加载撑高。
    if (!remeasurePass) scheduleRemeasure();
    else applyMeasuredStride();
  }

  function schedulePaint() {
    if (frame) return;
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === "function") {
      frame = raf(() => {
        frame = 0;
        paint();
      });
    } else {
      paint();
    }
  }

  function onScroll() {
    schedulePaint();
  }

  function onResize() {
    schedulePaint();
  }

  function bind() {
    if (bound || !host) return;
    scrollRoot = options.scrollRoot || findScrollRoot(host);
    scrollRoot?.addEventListener?.("scroll", onScroll, { passive: true });
    globalThis.addEventListener?.("resize", onResize);
    if (typeof globalThis.ResizeObserver === "function" && windowEl) {
      resizeObserver = new globalThis.ResizeObserver(() => scheduleRemeasure());
      resizeObserver.observe(windowEl);
    }
    bound = true;
  }

  function unbind() {
    if (!bound) return;
    scrollRoot?.removeEventListener?.("scroll", onScroll);
    globalThis.removeEventListener?.("resize", onResize);
    resizeObserver?.disconnect?.();
    resizeObserver = null;
    if (measureFrame && typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(measureFrame);
    }
    measureFrame = 0;
    bound = false;
  }

  return {
    mount(nextHost) {
      host = nextHost;
      if (!host) return;
      rowStride = estimateRowHeight;
      lastColCount = 0;
      host.classList.add("virtual-grid-host");
      host.innerHTML = `
        <div class="virtual-grid-space">
          <div class="virtual-grid-window"></div>
        </div>
      `;
      space = host.querySelector(".virtual-grid-space");
      windowEl = host.querySelector(".virtual-grid-window");
      bind();
    },
    setItems(nextItems, nextRenderItem, nextOnAfterRender = null) {
      items = Array.isArray(nextItems) ? nextItems : [];
      renderItem = typeof nextRenderItem === "function" ? nextRenderItem : () => "";
      onAfterRender = nextOnAfterRender;
      if (!host) return;
      if (!space || !windowEl) this.mount(host);
      schedulePaint();
    },
    refresh() {
      schedulePaint();
    },
    destroy() {
      unbind();
      if (host) {
        host.classList.remove("virtual-grid-host");
        host.innerHTML = "";
      }
      host = null;
      space = null;
      windowEl = null;
      items = [];
      rowStride = estimateRowHeight;
      lastColCount = 0;
    },
    get columnCount() {
      return cols;
    },
    get rowStride() {
      return rowStride;
    }
  };
}

export { measureColumns, findScrollRoot, measureRowStride, spaceHeightFor };
