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
const finishModalRule = styles.match(/\.finish-plan-modal\s*\{[^}]*\}/)?.[0] || "";
const finishBodyRule = styles.match(/\.finish-plan-modal \.game-modal-body\s*\{[^}]*\}/)?.[0] || "";
const finishChromeRule = styles.match(
  /\.finish-plan-modal \.game-modal-head,\s*\.finish-plan-modal \.game-modal-actions\s*\{[^}]*\}/
)?.[0] || "";
assert.match(finishModalRule, /display:\s*flex/);
assert.match(finishModalRule, /flex-direction:\s*column/);
assert.match(finishBodyRule, /flex:\s*1 1 auto/);
assert.match(finishBodyRule, /min-height:\s*0/);
assert.match(finishBodyRule, /overflow:\s*auto/);
assert.match(finishChromeRule, /flex-shrink:\s*0/);
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
