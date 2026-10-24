import assert from "node:assert/strict";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";
import { claimWorkshopOutputs } from "./workshop-test-utils.mjs";

process.env.JADE_WORLD_PERSIST = "0";
const { __testHooks: H } = await import("../server.js");
H.world.clear();
const player = installOwnedWorkshopFixture(H.makePlayer("value-pool-regression"));
H.normalizePlayer(player);
H.state.players.set(player.id, player);
const material = { id: "value-pool-source", type: "material", materialStage: "opened", stage: "material",
  name: "标准明料", qualityKey: "glutinous", quality: "糯种", color: "青白", score: 2, rep: 4,
  mass: 1.5, price: 12500, value: 12500, baseValue: 10000, visual: { seed: 1968 },
  craftScores: { open: 85 }, craftValueContributions: { open: { process: 1000, equipment: 1500 } },
  costBasis: { amount: 10000, complete: true } };
player.materials = [material];
const carving = player.workshop.devices.find((device) => device.stage === "carving");
const start = H.startWorkshopJobForPlayer(player, carving.id, { itemId: material.id, kits: [
  { type: "peacePendant", x: 35, y: 40, size: "M", rot: 0 },
  { type: "cabochon", x: 70, y: 65, size: "M", rot: 0 }
] });
assert.equal(start.ok, true, start.message);
const random = Math.random;
try { Math.random = () => .999; H.processProductionJobs(start.job.readyAt + 1, { onlineOnly: false, broadcast: false }); }
finally { Math.random = random; }
claimWorkshopOutputs(H, player);
const outputs = [...player.bracelets, ...player.materials];
assert.equal(player.bracelets.length, 2);
assert.equal(player.materials.length, 1);
const sum = (get) => outputs.reduce((total, item) => total + get(item), 0);
const added = sum((item) => Number(item.craftValueContributions?.plan?.process || 0) + Number(item.craftValueContributions?.plan?.equipment || 0));
assert.equal(sum((item) => item.baseValue), 10000, "cutting partitions one material value pool without creating more material");
assert.equal(sum((item) => item.value) - added, 12500, "only the new carving work increases the total output appraisal");
assert.equal(sum((item) => item.costBasis.amount), 10000, "all acquisition cost follows the output pieces and offcut");
assert.ok(Math.abs(sum((item) => Number(item.craftValueContributions?.open?.process || 0)
  + Number(item.craftValueContributions?.open?.equipment || 0)) - 2500) < .001, "past workmanship is partitioned once");
console.log(JSON.stringify({ ok: true, inputBase: 10000, outputBase: sum((item) => item.baseValue),
  inputAppraisal: 12500, outputAppraisal: sum((item) => item.value), newCarvingValue: added,
  costBasis: sum((item) => item.costBasis.amount) }));
process.exit(0);
