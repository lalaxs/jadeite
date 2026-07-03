# Jade Realistic Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat SVG jade visuals with deterministic Canvas 2D rough-stone and slice textures while preserving all existing gameplay controls.

**Architecture:** Add a focused front-end renderer module that paints Canvas elements from existing item data. `main.js` continues to own UI strings and event handling, while `server.js` only adds lightweight material traits used by the renderer.

**Tech Stack:** Native HTML/CSS/JavaScript, Canvas 2D, Express, Socket.IO.

---

## File Structure

- Create: `public/jade-renderer.js`
  - Owns deterministic random helpers, Canvas setup, rough rendering, slice rendering, and paint orchestration.
- Modify: `public/main.js`
  - Imports renderer helpers, emits Canvas wrappers instead of SVG bodies, and calls the painter after DOM render.
- Modify: `public/styles.css`
  - Styles Canvas wrappers so rough cards, planner stones, and slice boards retain stable dimensions.
- Modify: `server.js`
  - Adds non-authoritative visual traits to rough and slice data.

## Task 1: Renderer Module

**Files:**
- Create: `public/jade-renderer.js`

- [ ] **Step 1: Add deterministic helpers and public paint API**

Create a module exporting:

```js
export function jadeCanvasMarkup(kind, item, className = "") {
  const payload = encodeURIComponent(JSON.stringify(item));
  return `<canvas class="jade-canvas ${className}" data-jade-kind="${kind}" data-jade-payload="${payload}" aria-label="${escapeAttr(item.name || "翡翠")}"></canvas>`;
}

export function paintJadeCanvases(root = document) {
  root.querySelectorAll("canvas[data-jade-kind][data-jade-payload]").forEach((canvas) => {
    const kind = canvas.dataset.jadeKind;
    const item = JSON.parse(decodeURIComponent(canvas.dataset.jadePayload));
    if (kind === "rough") renderRoughCanvas(canvas, item);
    if (kind === "slice") renderSliceCanvas(canvas, item);
  });
}
```

Include local helpers for seeded random numbers, path clipping, color mixing, Canvas scaling, speckles, cloud strokes, cracks, and cotton fibers.

- [ ] **Step 2: Implement rough rendering**

`renderRoughCanvas(canvas, item)` should:

- Draw the existing rough silhouette variants.
- Clip all material layers to the silhouette.
- Paint base skin, cloudy volume, high-frequency pores, green hints, optional window, optional crack, highlight, and shadow.
- Use `item.visual.seed` so rerenders are stable.

- [ ] **Step 3: Implement slice rendering**

`renderSliceCanvas(canvas, slice)` should:

- Use `slice.board.outlinePath` for clipping.
- Draw ground color, grain, color zones, cotton fibers, dirty spots, flaws, glow, and edge shadow.
- Use existing `board.colorZones` and `board.flaws` so gameplay-relevant areas remain readable.

## Task 2: UI Integration

**Files:**
- Modify: `public/main.js`

- [ ] **Step 1: Import renderer helpers**

Add:

```js
import { jadeCanvasMarkup, paintJadeCanvases } from "./jade-renderer.js";
```

- [ ] **Step 2: Replace rough SVG body**

Update `stoneSvg(item, size)` to return:

```js
return jadeCanvasMarkup("rough", item, size);
```

- [ ] **Step 3: Replace slice material body**

Update `boardSvg(slice)` so the board surface is a wrapper containing `jadeCanvasMarkup("slice", slice, "slice")` plus the existing SVG planning overlay.

- [ ] **Step 4: Paint after render**

At the end of `render()`, call:

```js
paintJadeCanvases();
```

## Task 3: Styling

**Files:**
- Modify: `public/styles.css`

- [ ] **Step 1: Add stable Canvas dimensions**

Define `.jade-canvas`, `.jade-canvas.large`, `.jade-canvas.small`, `.jade-canvas.planner`, and `.slice-board-wrap` so existing layouts keep their sizes.

- [ ] **Step 2: Layer slice overlay above Canvas**

Ensure the slice planning SVG is positioned absolutely above the Canvas and pointer events still reach the existing board click handler.

## Task 4: Server Visual Traits

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Extend rough visual data**

Add traits in `makeStoneVisual()`:

```js
grain: Math.round(30 + Math.random() * 70),
translucency: clamp(quality.score * 0.16 + confidence * 0.22, 0.12, 0.92),
cotton: clamp(1 - quality.score * 0.13 + Math.random() * 0.18, 0.08, 0.78),
speckles: Math.round(80 + Math.random() * 120),
skinRoughness: clamp(0.45 + Math.random() * 0.45, 0.2, 1)
```

- [ ] **Step 2: Extend slice board data**

Add traits in `makeSliceBoard()`:

```js
clarity: clamp(score * 18 + Math.floor(Math.random() * 18), 18, 96),
water: clamp(score * 0.18 + Math.random() * 0.16, 0.16, 0.96),
dirtySpots: [...],
cottonThreads: [...]
```

## Task 5: Verification

**Files:**
- Existing app files only.

- [ ] **Step 1: Start or reuse dev server**

Run:

```bash
npm start
```

Expected: server listens on `http://localhost:3000`.

- [ ] **Step 2: Browser smoke check**

Open `http://localhost:3000/` and verify:

- Page title is `翡翠街多人经营原型`.
- `#connectionText` is `已连接`.
- Rough Canvas elements exist.
- At least one rough Canvas contains non-empty pixels.
- Browser console has no errors.

- [ ] **Step 3: Gameplay smoke check**

In browser:

- Buy one rough stone.
- Start cutting with an angle.
- Confirm the planner overlay still appears above the rough Canvas.
- If enough time passes for cutting, cut a material into slices and confirm slice Canvas plus overlay render together.
