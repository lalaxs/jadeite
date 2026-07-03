# Source Material Product Cutouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render extracted products as cutouts from the exact polished rough they came from.

**Architecture:** Keep extraction authoritative in `server.js` and keep visual rendering in `public/jade-renderer.js`. Products carry compact source-material metadata, and the product canvas clips a deterministic source texture into the selected product shape.

**Tech Stack:** Native JavaScript, Canvas 2D, Express, Socket.IO, Node smoke tests.

---

## Files

- Modify: `server.js`
  - Add source-material metadata to products produced by `extractFromRough`.
- Modify: `public/jade-renderer.js`
  - Render product canvases from source material when metadata exists.
  - Keep the existing fallback product renderer for legacy products.
- Modify: `scripts/simplified-flow-smoke.mjs`
  - Assert product source-material metadata exists.
  - Assert the renderer has source-material product cutout support.
- Modify: `scripts/jade-renderer-smoke.mjs`
  - Assert product markup accepts source-material products.

## Tasks

- [ ] Add failing smoke assertions for source-material products.
- [ ] Add `sourceMaterial` payloads to extracted products.
- [ ] Add source-material product cutout rendering.
- [ ] Run smoke tests and syntax checks.
- [ ] Run browser flow verification for polish, kit placement, extraction, and finished product rendering.
