# Slice Placement Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make slice visuals inherit rough-stone material cues and replace single-plan splitting with multi-placement cutting, including bracelet size selection.

**Architecture:** Keep Canvas rendering and Socket.IO, but make `board` data derive more directly from rough `visual`. Frontend stores per-slice placement arrays and sends them to the server; server validates and produces multiple products from one slice.

**Tech Stack:** Native JavaScript, Canvas 2D, Express, Socket.IO, Node assert smoke tests.

---

## Files

- Modify: `server.js`
  - Derive slice boards from rough material cues.
  - Accept `placements[]` in `splitSlice`.
  - Validate placement bounds and overlap.
  - Produce multiple products.
- Modify: `public/main.js`
  - Replace one `slicePlans` plan with per-slice placement lists.
  - Add active tool and bracelet size selection.
  - Draw all placements on the slice overlay.
  - Repaint Canvas after workshop-only rerenders.
- Modify: `public/jade-renderer.js`
  - Remove white slice outline emphasis.
  - Use shared visual-derived features for rough and slice rendering.
- Modify: `public/styles.css`
  - Style placement toolbar and active placement markers.
- Modify: `scripts/jade-renderer-smoke.mjs`
  - Add assertions that rendering helpers stay flat and branching.

## Tasks

### Task 1: Renderer And Slice Visual Consistency

- [ ] Remove white slice-edge highlight from `boardSvg()` overlay.
- [ ] Make `makeSliceBoard()` use `visual.seed`, `visual.beltAngle`, `visual.crackAngle`, `visual.vein`, and `visual.crack` as primary data, reducing fresh randomness.
- [ ] Ensure slice board color zones line up with the rough stone belt direction.
- [ ] Ensure flaws are absent unless rough visual has cracks, except low-quality dirty spots.
- [ ] Run `npm run test:renderer` and `node --check server.js`.

### Task 2: Multi-Placement Client State

- [ ] Replace `slicePlans` usage for slice boards with `slicePlacements` and `sliceTools`.
- [ ] On board click, append a placement for the active tool at the clicked position.
- [ ] For bracelets, include selected `ringSize`.
- [ ] Remove size and rotation sliders from the planner UI.
- [ ] Keep a clear/reset button per slice.
- [ ] Paint all placements in the overlay.
- [ ] Call `paintJadeCanvases()` after `renderWorkshop()`.

### Task 3: Multi-Placement Server Split

- [ ] Add `normalizePlacement()` and `normalizePlacements()`.
- [ ] Add simple overlap validation using center distance and placement radius.
- [ ] Change `scoreSlicePlan()` into placement scoring that works for each placement.
- [ ] Change `splitSlice` to consume all placements in one request and create multiple products.
- [ ] Include bracelet `ringSize` in product name/design.
- [ ] Run syntax checks and browser smoke verification.

### Task 4: Verification

- [ ] Run `npm run test:renderer`.
- [ ] Run `node --check public/jade-renderer.js && node --check public/main.js && node --check server.js`.
- [ ] Confirm `curl -I http://localhost:3000/` returns 200.
- [ ] In browser, confirm公盘 loads,工坊 slice board renders, placement clicks add multiple items, and console has no errors.
