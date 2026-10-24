import { readWorkshopSource } from "./load-workshop-source.mjs";
import assert from "node:assert/strict";
import { readClientShellSource } from "./load-client-shell.mjs";
import { readFileSync } from "node:fs";
import { loadResolvedStyles } from "./load-styles.mjs";

const workshop = readWorkshopSource();
const mainEntry = readFileSync("public/main.js", "utf8");
const main = readClientShellSource();
const styles = loadResolvedStyles();
assert.match(workshop, /function buildPlannerShell\b/);
assert.match(workshop, /(?:export )?function workshopOpenPlanner\b/);
assert.match(workshop, /(?:export )?function workshopClosePlanner\b/);
assert.match(workshop, /(?:export )?function workshopRefreshPlanner\b/);
assert.match(workshop, /class="wrs-plan-step/);
assert.doesNotMatch(
  workshop.match(/(?:export )?function workshopRecipeSummary[\s\S]*?\n}\n/)?.[0] || "",
  /roughBoard\(selected\)\s*\+\s*roughPlannerControls/
);
{
  const summary = workshop.match(/(?:export )?function workshopRecipeSummary[\s\S]*?\n}\n/)?.[0] || "";
  assert.match(summary, /const startActions = needsKits/);
  assert.match(summary, /workshop-outcome-preview/);
  assert.doesNotMatch(summary, /开工后现金/);
  assert.match(summary, /cashShort/);
  assert.doesNotMatch(summary, /先摆套件/);
  assert.doesNotMatch(summary, /请先在明料上摆放套件，然后再开工/);
}
assert.match(`${main}\n${workshop}`, /openWorkshopPlanner/);
assert.match(styles, /\.ws-planner-modal/);
assert.match(workshop, /options\.dragging \|\| activeDragKit\?\.roughId === roughId/, "background snapshots must preserve the captured board while dragging");
assert.match(styles, /@media \(max-width: 767px\)[\s\S]*\.ws-planner-modal[\s\S]*100dvh/);

{
  const preview = workshop.match(/function carvingPreviewKits[\s\S]*?\n}\n/)?.[0]
    || workshop.match(/(?:export )?function workshopItemPreview[\s\S]*?\n}\n/)?.[0]
    || "";
  assert.match(workshop, /function carvingPreviewKits\b/);
  assert.match(preview, /openingKitsForRender\(item\)/);
  assert.doesNotMatch(preview, /extractionKits:\s*\[\]/);
  assert.match(
    workshop.match(/(?:export )?function workshopItemPreview[\s\S]*?\n}\n/)?.[0] || "",
    /carvingPreviewKits\(item\)/
  );
  assert.match(
    workshop.match(/(?:export )?function workshopItemPreview[\s\S]*?\n}\n/)?.[0] || "",
    /openingKitsForRender\(item\)/
  );
}

{
  const closeBody = workshop.match(/(?:export )?function workshopClosePlanner[\s\S]*?\n}\n/)?.[0] || "";
  assert.match(closeBody, /请先摆放至少一个套件/);
  assert.match(closeBody, /if \(commit\)/);
  assert.match(closeBody, /draftKits\.length/);
  assert.match(closeBody, /lastWorkshopRenderFp\s*=\s*""/);
}

{
  const renderBody = workshop.match(/(?:export )?function renderWorkshop\(\)[\s\S]*?\n}\n/)?.[0] || "";
  assert.match(renderBody, /planKitsSig/);
  assert.match(renderBody, /kitsFor\((?:ui\.)?selectedWorkshopItemId\)/);
}

{
  const controls = main.match(/function roughPlannerControls\(rough\)[\s\S]*?\n}\n/)?.[0] || "";
  assert.match(controls, /planningBangle/);
  assert.match(controls, /selectedOpeningKitTpl === "bangle"/);
  assert.match(controls, /aria-label="手镯圈口"/);
  assert.match(controls, /aria-label="挂件尺寸"/);
  assert.match(controls, /placement-summary-copy/);
  assert.doesNotMatch(controls, /template\.name\}<span>/);
  assert.equal(
    (controls.match(/aria-label="手镯圈口"/g) || []).length,
    1,
    "bangle ring size row should be rendered in only one branch"
  );
  assert.equal(
    (controls.match(/aria-label="挂件尺寸"/g) || []).length,
    1,
    "pendant size row should be rendered in only one branch"
  );
  assert.match(main, /function applyOpeningKitSizeToSelected\b/);
  assert.match(main, /applyOpeningKitSizeToSelected\(roughId, kind\)/);
  assert.match(main, /selectedOpeningKitId/);
  assert.match(main, /scaleForOpeningKit\(tpl, sizeVal\)/);
  assert.match(main, /analysis-title/);
  assert.match(main, /analysis-metrics/);
  assert.match(styles, /\.kit-choice\.on\b/);
  assert.match(styles, /\.analysis-title\b/);
  assert.match(styles, /\.analysis-metric\b/);
  assert.doesNotMatch(main, /analysis-hero/);
  assert.doesNotMatch(styles, /\.analysis-hero\b/);
  assert.match(workshop, /isWorkshopLeftoverMaterial/);
  assert.match(workshop, /leftover/);
  assert.match(styles, /\.ws-picker-content[\s\S]*flex:\s*1/);
  assert.match(styles, /\.ws-picker-list[\s\S]*overflow:\s*auto/);
}

console.log("workshop-planner-ui-smoke: independent planning step ok");
