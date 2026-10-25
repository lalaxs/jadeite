import { SCRATCH_REVEAL_THRESHOLD } from "../../../shared/domain/workshop/delivery-scratch.js";
import { ScratchCoverage, SCRATCH_BRUSH_RADIUS } from "./scratch-coverage.js";
import { ScratchValuation } from "./scratch-valuation.js";
import { openingStoneFor } from "../opening/opening-render.js";
import { formatMoney } from "../../shell/format-utils.js";

const SIZE = 600, GRID = 160;

export function createDeliveryScratchUi({ root, delivery, playerId, itemIds, onThreshold, reducedMotion }) {
  const entries = new Map();
  const events = new AbortController();
  let enabled = false, disposed = false;
  function layout() {
    for (const card of root.querySelectorAll("[data-delivery-item]")) {
      const plane = card.querySelector(".delivery-scratch-plane");
      const outline = plane?.querySelector('[id$="stoneOutline"]');
      if (!outline) continue;
      const bounds = outline.getBBox();
      if (!bounds.width || !bounds.height) continue;
      // Move the actual outline to the center, retaining one shared 600px space
      // for the material, mask, brush coordinates and persisted scratch marks.
      const scale = SIZE * .9 / Math.max(bounds.width, bounds.height);
      const visual = card.querySelector(".delivery-item-visual");
      const side = Math.min(visual.clientWidth, visual.clientHeight);
      const x = (.5 - (bounds.x + bounds.width / 2) / SIZE) * scale * side;
      const y = (.5 - (bounds.y + bounds.height / 2) / SIZE) * scale * side;
      plane.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    }
  }
  const resize = new ResizeObserver(layout);
  for (const visual of root.querySelectorAll(".delivery-item-visual")) resize.observe(visual);
  for (const id of itemIds) {
    const card = [...root.querySelectorAll("[data-delivery-item]")].find((node) => node.dataset.itemId === id);
    const canvas = card?.querySelector("[data-scratch-canvas]");
    if (!canvas) continue;
    const source = card.querySelector(".delivery-scratch-source");
    const pathData = source.querySelector('[id$="stoneOutline"]')?.getAttribute("d") || "M0 0H600V600H0Z";
    const path = new Path2D(pathData);
    const key = `jade:delivery-scratch:v1:${playerId}:${delivery.id}:${id}`;
    let saved = "";
    try {
      const local = JSON.parse(localStorage.getItem(key) || "null");
      if (local?.path === pathData) saved = local.erased;
    } catch { /* The one-click path also works without local storage. */ }
    const sample = document.createElement("canvas");
    sample.width = sample.height = GRID;
    const sampler = sample.getContext("2d", { willReadFrequently: true });
    sampler.scale(GRID / SIZE, GRID / SIZE);
    sampler.fill(path);
    const pixels = sampler.getImageData(0, 0, GRID, GRID).data;
    const mask = Uint8Array.from({ length: GRID * GRID }, (_, i) => pixels[i * 4 + 3] >= 128 ? 1 : 0);
    const coverage = new ScratchCoverage(mask, GRID, saved);
    const item = delivery.items.find((item) => item.id === id);
    const valuation = new ScratchValuation(openingStoneFor(item), coverage, item.value ?? item.price);
    const valuePanel = card.querySelector("[data-scratch-valuation]");
    const valueText = valuePanel.querySelector("[data-scratch-value]");
    const deltaText = valuePanel.querySelector("[data-scratch-value-delta]");
    const progressText = valuePanel.querySelector("[data-scratch-value-progress]");
    const statusText = valuePanel.querySelector("[data-scratch-value-status]");
    let strokeStartValue = valuation.value;
    const updateValue = () => {
      const value = valuation.value;
      const delta = value - strokeStartValue;
      valueText.textContent = formatMoney(value);
      valueText.dataset.value = value;
      deltaText.textContent = `本笔 +${formatMoney(delta)}`;
      progressText.textContent = `已揭露 ${Math.floor(coverage.ratio * 100)}%`;
      valuePanel.classList.toggle("is-gaining", delta > 0);
    };
    updateValue();
    const onErase = (index) => valuation.revealCell(index);
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.clip(path);
    const dust = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    dust.addColorStop(0, "#cec4b0"); dust.addColorStop(1, "#a99e88");
    ctx.fillStyle = dust;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = "rgba(73,62,44,.12)";
    for (let n = 0; n < 800; n++) ctx.fillRect((n * 149) % SIZE, (n * 233 + Math.floor(n / 7) * 17) % SIZE, 1.5, 1.5);
    ctx.restore();
    ctx.globalCompositeOperation = "destination-out";
    for (let n = 0; n < coverage.erased.length; n++) if (coverage.erased[n]) {
      ctx.fillRect((n % GRID) * SIZE / GRID, Math.floor(n / GRID) * SIZE / GRID, SIZE / GRID + .1, SIZE / GRID + .1);
    }
    const entry = { id, card, source, canvas, ctx, coverage, key, pathData, revealed: false, saved: false, pointer: null, timer: null };
    entries.set(id, entry);
    const persist = () => {
      clearTimeout(entry.timer);
      if (entry.saved) return;
      try { localStorage.setItem(key, JSON.stringify({ path: pathData, erased: coverage.serialize() })); } catch { /* Best-effort partial progress. */ }
    };
    entry.persist = persist;
    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      const side = Math.min(rect.width, rect.height);
      return { x: (event.clientX - rect.left - (rect.width - side) / 2) / side,
        y: (event.clientY - rect.top - (rect.height - side) / 2) / side };
    };
    const erase = (next) => {
      const before = coverage.count;
      coverage.erase(entry.last, next, SCRATCH_BRUSH_RADIUS, onErase);
      ctx.lineWidth = SIZE * SCRATCH_BRUSH_RADIUS * 2;
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(entry.last.x * SIZE, entry.last.y * SIZE);
      ctx.lineTo(next.x * SIZE + .001, next.y * SIZE + .001); ctx.stroke();
      entry.last = next;
      if (coverage.count === before) return;
      updateValue();
      card.classList.add("has-scratch-marks");
      clearTimeout(entry.timer); entry.timer = setTimeout(persist, 200);
      if (coverage.ratio >= SCRATCH_REVEAL_THRESHOLD) { persist(); onThreshold(id); }
    };
    const finish = (event) => {
      if (entry.pointer !== event.pointerId) return;
      entry.pointer = null;
      statusText.textContent = `已揭露料值 ${formatMoney(valuation.value)}，本笔增加 ${formatMoney(valuation.value - strokeStartValue)}`;
      persist();
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener("pointerdown", (event) => {
      if (!enabled || entry.revealed || entry.pointer != null || (event.pointerType === "mouse" && event.button !== 0)) return;
      event.preventDefault();
      strokeStartValue = valuation.value;
      updateValue();
      entry.pointer = event.pointerId; entry.last = point(event);
      canvas.setPointerCapture(event.pointerId); erase(entry.last);
    }, { signal: events.signal });
    canvas.addEventListener("pointermove", (event) => {
      if (entry.pointer !== event.pointerId || entry.revealed || !enabled) return;
      event.preventDefault(); erase(point(event));
    }, { signal: events.signal });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(type, finish, { signal: events.signal });
    if (coverage.count) card.classList.add("has-scratch-marks");
    card.classList.add("is-scratch-ready");
  }
  globalThis.addEventListener("pagehide", () => {
    for (const entry of entries.values()) entry.persist();
  }, { signal: events.signal });

  function reveal(ids) {
    for (const id of ids) {
      const entry = entries.get(id);
      if (!entry || entry.revealed) continue;
      entry.revealed = true;
      entry.coverage.erased.set(entry.coverage.mask);
      entry.coverage.count = entry.coverage.total;
      entry.persist();
      entry.source.removeAttribute("aria-hidden");
      entry.card.querySelector(".delivery-item-info").hidden = false;
      entry.card.querySelector(".delivery-scratch-placeholder").hidden = true;
      entry.card.classList.remove("is-scratch-covered");
      entry.canvas.style.pointerEvents = "none";
      entry.canvas.setAttribute("aria-hidden", "true");
      const fade = !reducedMotion() && entry.canvas.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" });
      entry.fade = fade;
      if (fade) fade.finished.then(() => { if (!disposed) entry.canvas.hidden = true; }).catch(() => {});
      else entry.canvas.hidden = true;
    }
  }

  return {
    reveal,
    layout,
    enable(value) {
      if (value) layout();
      enabled = value;
      root.classList.toggle("is-scratch-enabled", value);
      if (value) for (const entry of entries.values()) {
        if (!entry.revealed && entry.coverage.ratio >= SCRATCH_REVEAL_THRESHOLD) onThreshold(entry.id);
      }
    },
    sync(revealedIds) {
      reveal(revealedIds);
      for (const id of revealedIds) {
        const entry = entries.get(id);
        if (!entry) continue;
        entry.saved = true; clearTimeout(entry.timer);
        try { localStorage.removeItem(entry.key); } catch { /* No storage access. */ }
      }
    },
    dispose() {
      disposed = true; events.abort(); resize.disconnect();
      for (const entry of entries.values()) { entry.persist(); entry.fade?.cancel?.(); }
    }
  };
}
