import assert from "node:assert/strict";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";
import { claimWorkshopOutputs } from "./workshop-test-utils.mjs";
import { openingPlanningValuePreview, openingKitForValuePreview, placementAnalysisRows } from "../public/features/opening/opening-render.js";
import { clampOpeningKitPosition, bindOpeningKitsRenderDeps } from "../public/features/opening/opening-kits.js";

process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
H.world.clear();
const player = installOwnedWorkshopFixture(H.makePlayer("opening-value-preview"));
H.normalizePlayer(player);
H.state.players.set(player.id, player);
const source = { id: "opening-preview-source", type: "material", materialStage: "opened", stage: "material",
  name: "糯种明料", qualityKey: "glutinous", quality: "糯种", color: "青白", score: 2, rep: 4,
  mass: 1.5, price: 12500, value: 12500, baseValue: 10000, visual: { seed: 1968 },
  craftScores: { open: 85 }, craftValueContributions: { open: { process: 1000, equipment: 1500 } },
  costBasis: { amount: 10000, complete: true } };
player.materials = [source];
const cases = [];
function verify(source, drafts) {
  const historicalCuts = (source.extractionKits || source.braceletPlacements || []).length;
  const preview = openingPlanningValuePreview(source, drafts);
  const html = placementAnalysisRows(source, drafts);
  assert.match(html, /取件料值/);
  assert.match(html, /未含本次加工与精修增值/);
  assert.equal((html.match(/data-value-kind="material"/g) || []).length, drafts.length);
  const payload = drafts.map((raw) => {
    const opening = openingKitForValuePreview(raw);
    return { id: raw.id, type: opening.type, openingTpl: opening.tpl, x: opening.x / 6, y: opening.y / 6,
      rot: opening.rot, size: opening.tpl === "bangle" ? undefined : opening.size,
      ringSize: opening.tpl === "bangle" ? opening.size : undefined };
  });
  const device = player.workshop.devices.find((row) => row.stage === "carving");
  const start = H.startWorkshopJobForPlayer(player, device.id, { itemId: source.id, kits: payload });
  assert.equal(start.ok, true, start.message);
  const random = Math.random;
  try { Math.random = () => .999; H.processProductionJobs(start.job.readyAt + 1, { onlineOnly: false, broadcast: false }); }
  finally { Math.random = random; }
  const delivery = player.workshopDeliveries[0];
  assert.equal(delivery.items.length, preview.partition.pieces.length);
  for (let index = 0; index < delivery.items.length; index += 1) {
    const product = delivery.items[index];
    const step = product.craftValueContributions.plan;
    assert.equal(product.value - step.process - step.equipment, preview.partition.pieces[index].value,
      "displayed material share equals actual output before the new carving contribution");
    assert.equal(product.baseValue, preview.partition.pieces[index].baseValue);
  }
  const leftover = delivery.auxiliaryItems[0];
  assert.equal(leftover.value, preview.partition.leftover.value, "historical cut-outs participate in both predictions");
  assert.equal(leftover.baseValue, preview.partition.leftover.baseValue);
  cases.push({ cuts: drafts.length, historicalCuts,
    displayedMaterialValues: preview.partition.pieces.map((piece) => piece.value), leftover: leftover.value });
  claimWorkshopOutputs(H, player);
  return player.materials.find((item) => item.id === source.id);
}
const leftover = verify(source, [
  { id: "preview-ping", tpl: "ping", x: 181, y: 241, size: "M", rot: 181, scale: 99, svgSpace: true },
  { id: "preview-egg", tpl: "egg", x: 421, y: 391, size: "M", rot: 0, svgSpace: true }
]);
const nextDrafts = [{ id: "preview-leaf", tpl: "leaf", x: 390, y: 210, size: "S", rot: 0, svgSpace: true }];
const legacyFlagged = structuredClone(leftover);
legacyFlagged.extractionKits.forEach((kit) => { kit.svgSpace = true; });
assert.deepEqual(openingPlanningValuePreview(legacyFlagged, nextDrafts).partition,
  openingPlanningValuePreview(leftover, nextDrafts).partition,
  "saved percentage records ignore stale svgSpace flags exactly as server normalization does");
verify(leftover, nextDrafts);
bindOpeningKitsRenderDeps({ openingKitTemplate: () => ({ r: 34 }) });
assert.deepEqual(clampOpeningKitPosition("egg", 1, 599, 1), { x: 72, y: 528 }, "the interactive center cannot drift outside the server's 12%–88% range");
console.log(JSON.stringify({ ok: true, cases }));
process.exit(0);
