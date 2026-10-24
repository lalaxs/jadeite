import { existsSync, readFileSync } from "node:fs";

// Transitional source checks must follow responsibility moves. Behavioral and
// visual regression tests independently compare the frozen original module.
const ROOT = "public/features/workshop/";
const PARTS = ["catalog.js", "state.js", "selectors.js", "worker-view.js", "item-preview.js", "view.js",
  "picker-controller.js", "planner-controller.js", "finish-controller.js", "inlay-preview-controller.js",
  "actions.js", "create-workshop-feature.js", "workshop-module.js"];

export function readWorkshopSource() {
  return PARTS.filter(file => existsSync(ROOT + file)).map(file => readFileSync(ROOT + file, "utf8")).join("\n");
}
