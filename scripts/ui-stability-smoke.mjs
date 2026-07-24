import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync("public/main.js", "utf8");
const styles = readFileSync("public/styles.css", "utf8");
const workshop = readFileSync("public/workshop-module.js", "utf8");
const server = readFileSync("server.js", "utf8");

assert.match(main, /function currentGoalViewModel\b/);
assert.match(main, /function ensureOverviewStatusShell\b/);
assert.match(main, /function patchCurrentGoal\b/);
assert.match(main, /data-overview-slot="goal"/);
assert.doesNotMatch(
  main.match(/function renderOverview\(\)[\s\S]*?\n}\n\n\/\/ ===== 目标/)?.[0] || "",
  /homeStatusPane\.innerHTML\s*=/
);
assert.match(styles, /\.goal-card\.is-entering/);
assert.match(styles, /prefers-reduced-motion:\s*reduce/);
assert.match(workshop, /function mountFinishPlanShell\b/);
assert.match(workshop, /function patchFinishPlanModal\b/);
assert.doesNotMatch(
  workshop.match(/export function renderWorkshop\(\)[\s\S]*?\n}\n/)?.[0] || "",
  /renderFinishPlanModal/
);
assert.doesNotMatch(
  workshop.match(/function patchFinishPlanModal\(\)[\s\S]*?\n}\n/)?.[0] || "",
  /root\.innerHTML\s*=/
);
assert.match(workshop, /data-finish-stock="metal"/);
assert.match(workshop, /data-finish-stock="gem"/);
assert.match(server, /socket\.on\("startWorkshopJob",\s*\(payload = \{\}, acknowledge\)/);

console.log("ui-stability-smoke: stable overview guards ok");
