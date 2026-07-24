import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workshop = readFileSync("public/workshop-module.js", "utf8");
const main = readFileSync("public/main.js", "utf8");
const styles = readFileSync("public/styles.css", "utf8");

assert.match(workshop, /function buildPlannerShell\b/);
assert.match(workshop, /export function workshopOpenPlanner\b/);
assert.match(workshop, /export function workshopClosePlanner\b/);
assert.match(workshop, /export function workshopRefreshPlanner\b/);
assert.match(workshop, /class="wrs-plan-step/);
assert.doesNotMatch(
  workshop.match(/export function workshopRecipeSummary[\s\S]*?\n}\n/)?.[0] || "",
  /roughBoard\(selected\)\s*\+\s*roughPlannerControls/
);
assert.match(main, /openWorkshopPlanner/);
assert.match(styles, /\.ws-planner-modal/);
assert.match(styles, /@media \(max-width: 767px\)[\s\S]*\.ws-planner-modal[\s\S]*100dvh/);

console.log("workshop-planner-ui-smoke: independent planning step ok");
