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
