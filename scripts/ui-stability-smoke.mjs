import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync("public/main.js", "utf8");
const styles = readFileSync("public/styles.css", "utf8");

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

console.log("ui-stability-smoke: stable overview guards ok");
