## 2026-07-08 11:23:15 CST - fix: gate internal location links

- Scope:
  - `public/main.js`
  - `scripts/simplified-flow-smoke.mjs`

- Summary:
  - Added `openLocationByView(view)` to resolve views back to location definitions, run `locationGate(location)`, allow direct `overview` entry, and redirect locked or hidden destinations with toasts to `market` or `overview`.
  - Routed `[data-view-link]`, `openLocation`, and `lockedLocation` click flows through the helper so legacy buttons cannot bypass gating.
  - Tightened flow smoke coverage so source checks require helper-based `data-view-link` navigation and forbid direct `setView(viewLink.dataset.viewLink)`.

- Commands and outputs:
  - `npm run test:flow`
    - First red run:
      - `Error: main.js should gate location view transitions through openLocationByView`
    - Green run:
      - `Simplified rough-to-bracelet flow checks passed`
  - `npm test`
    - `Jade idle loop rules checks passed`
    - `Jade sealed auction checks passed`
    - `Server idle behavior checks passed`
    - `Jade expert rules checks passed`
    - `jade renderer smoke test passed`
    - `jade volume smoke test passed`
    - `Canvas-only jade rendering checks passed`
    - `Simplified rough-to-bracelet flow checks passed`
