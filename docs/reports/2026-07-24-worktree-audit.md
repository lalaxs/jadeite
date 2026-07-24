# 2026-07-24 Worktree Audit

| Path group | Evidence | Decision |
|---|---|---|
| Runtime modules imported by `public/main.js` | Direct ES-module imports | Track |
| Smoke scripts named by `package.json` | Required by `npm test` | Track |
| Deleted historical specs/plans/reports | No equivalent archive exists | Restore |
| Deleted template SVG/PNG assets | Current canvas-only test rejects icon assets; no runtime reference | Keep deletion |
| `public/styles.css*.bak` | Local style snapshots, not runtime inputs | Ignore |
| `server.log` | Runtime log | Ignore |
| `test-task.mjs` | Useful task-rule assertions | Migrate to `scripts/task-smoke.mjs` |
| `test-task-e2e.mjs` | Port-bound exploratory runner outside package scripts | Preserve locally and ignore |

## Evidence summary

- `public/main.js` directly imports the current auction, market, workshop, chat, ranking, order, livestream and extra feature modules, plus `jade-categories.js` and `jade-opening-engine.js`; these files are runtime inputs and must be tracked.
- `package.json` runs `scripts/jade-opening-engine-smoke.mjs` and `scripts/ui-overlay-smoke.mjs` in the main test chain; these smoke scripts are required baseline coverage and must be tracked.
- Runtime source does not reference `public/assets/template-icons/` or `public/assets/templates/`. The only template-icon references are the reproducible generator and the negative canvas-only smoke assertion.
- `npm run test:canvas` and `npm run test:flow` both pass while the template SVG/PNG files are absent, confirming that their deletion is intentional. Historical PNG output can be recreated with `scripts/generate-template-icons.mjs` if ever needed.
- Historical plans, specifications, GDD/UI documents and `.superpowers/sdd` reports were restored because no equivalent archive was present.
- The useful root task assertions were migrated to `scripts/task-smoke.mjs`; the original root script remains a local artifact and is not part of the committed baseline.

## Disposition

- Track the current runtime code, runtime modules, package smoke scripts, migrated task smoke test, README, package metadata, ignore rules and this report.
- Preserve the intentional template SVG/PNG deletions.
- Keep local logs, style snapshots and the port-bound exploratory test outside version control.

## Final actual change list

### Modified

- Root/runtime: `.gitignore`, `README.md`, `package.json`, `server.js`.
- Shared rules/rendering: `public/jade-auction.js`, `public/jade-loop.js`, `public/jade-renderer.js`, `public/jade-rules.js`.
- Main UI shell: `public/index.html`, `public/main.js`, `public/styles.css`.
- Existing smoke coverage: `scripts/jade-auction-smoke.mjs`, `scripts/jade-loop-smoke.mjs`, `scripts/jade-renderer-smoke.mjs`, `scripts/server-idle-smoke.mjs`, `scripts/simplified-flow-smoke.mjs`.

### Created

- Frontend feature modules: `public/auction-module.js`, `public/chat-module.js`, `public/extra-module.js`, `public/livestream-module.js`, `public/market-module.js`, `public/orders-module.js`, `public/ranking-module.js`, `public/workshop-module.js`.
- Shared frontend logic: `public/jade-categories.js`, `public/jade-opening-engine.js`, `public/product-meta.js`.
- Server systems: `server/systems/equipment-system.js`, `server/systems/employee-system.js`, `server/systems/inlay-system.js`.
- New smoke coverage: `scripts/equipment-system-smoke.mjs`, `scripts/employee-system-smoke.mjs`, `scripts/inlay-system-smoke.mjs`, `scripts/jade-opening-engine-smoke.mjs`, `scripts/responsive-layout-smoke.mjs`, `scripts/task-smoke.mjs`, `scripts/ui-overlay-smoke.mjs`.
- Approved design/plan and QA evidence under `docs/superpowers/` and `docs/reports/`.

### Restored

- Historical project references: `docs/design-plan.md`, `docs/project-notes.md`, `docs/翡翠风云_GDD_v2.1.md`, `docs/翡翠风云_UI交互设计文档.md`.
- Historical implementation specifications/plans under `docs/superpowers/plans/` and `docs/superpowers/specs/`.
- Existing tracked review reports under `.superpowers/sdd/`.

### Intentionally deleted

- Ten generated PNG files under `public/assets/template-icons/`.
- Ten legacy SVG files under `public/assets/templates/`.

The runtime uses canvas/SVG generation from code, and `npm run test:canvas` rejects reintroducing these file-based template assets.

### Ignored local artifacts

- `node_modules/`, `.env*`, `dist/`, `coverage/`, `server.log`.
- `public/*.bak`, `public/styles.css.*bak`.
- `.superpowers/` only for untracked local artifacts; already tracked reports remain tracked.
- `test-task-e2e.mjs`; the maintained assertions live in `scripts/task-smoke.mjs`.

### Final invariants

- Every equipment model and owned device has `capacity: 1`.
- No waiting/production queue exists.
- A worker can be occupied by only one workshop or livestream job.
- The free recruit batch is generated once; an exhausted batch remains empty until a paid refresh.
- Cash, inventory and occupancy mutations reject missing or duplicate request IDs.
- Invalid finishing plans and insufficient resources have no partial side effects.
- Incompatible finishing choices remain visible but disabled with a reason.
- Repository-delivered screenshots and reports are intentional QA evidence.
