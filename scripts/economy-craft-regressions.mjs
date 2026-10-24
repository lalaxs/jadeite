import assert from "node:assert/strict";
import { equipmentCatalog, createDeviceInstance, durabilityLoss } from "../server/systems/equipment-system.js";
import { equipmentRepairRate } from "../shared/domain/economy/equipment-maintenance.js";
import { applyCraftStepValue, equipmentCraftBonus, PROCESS_STEP_VALUE_CAP } from "../shared/domain/workshop/workshop-craft-scoring.js";
import { previewBangleFinish } from "../shared/domain/workshop/bangle-finish.js";
import { quoteFinishPlan, applyInlay, inlayCatalog } from "../server/systems/inlay-system.js";
import { quoteFinishPlanDraft } from "../shared/domain/workshop/finish-plan-model.js";
import { MATERIAL_META } from "../server/services/materials-service.js";
import { INLAY_MATERIAL_UNIT_VALUES } from "../shared/domain/workshop/inlay-value.js";

const catalog = equipmentCatalog();
assert.deepEqual(catalog.filter((row) => row.brandKey === "used").map((row) => row.price), [3200, 4600, 6200]);
assert.equal(catalog.find((row) => row.modelKey === "cuijie-opening-1").price, 6800);
const novice = { name: "新助手", tier: 1, skills: {}, flaws: [] };
const plan = { process: "bangle", productType: "bangle", refinementId: "standard", polishId: "bright" };
const comparisons = [];
for (const baseValue of [5000, 50000, 100000, 500000]) {
  const blank = { kind: "bracelet", materialStage: "carved", baseValue, value: Math.round(baseValue * 1.317),
    craftScores: { open: 95, plan: 88 } };
  const preview = previewBangleFinish(blank, plan, novice, createDeviceInstance("finishing", "zhuoguang-finishing-1", "finish").attrs);
  assert.ok(preview.value >= blank.value, "successful finishing must preserve all prior work even with an untrained worker");
  assert.equal(blank.materialStage, "carved", "preview must leave the source untouched");
  const actual = structuredClone(blank);
  applyCraftStepValue(actual, { step: "finish", score: 12, worker: novice,
    deviceAttrs: { quality: 5, valueBonusCap: 250 }, previousValue: blank.value });
  const once = actual.value;
  for (let i = 0; i < 20; i += 1) applyCraftStepValue(actual, { step: "finish", score: 12, worker: novice,
    deviceAttrs: { quality: 5, valueBonusCap: 250 } });
  assert.equal(actual.value, once, "retrying the same step must not grow value");
  assert.ok(actual.craftValueContributions.finish.process <= PROCESS_STEP_VALUE_CAP);
  comparisons.push({ baseValue, blank: blank.value, successfulFinish: preview.value });
}

const caps = [];
for (const key of ["cuijie-opening-1", "cuijie-opening-2", "cuijie-opening-3", "jingong-finishing-3"]) {
  const device = createDeviceInstance(null, key, key);
  const bonus = equipmentCraftBonus(1_000_000_000, device.attrs);
  assert.ok(bonus <= device.basePrice * 0.02, "a single high-value piece cannot repay equipment purchase");
  const upkeep = device.basePrice * equipmentRepairRate(device) * durabilityLoss(device) / 100;
  caps.push({ key, price: device.basePrice, maxEquipmentValuePerStep: bonus, upkeep });
}
for (const [key, value] of Object.entries(INLAY_MATERIAL_UNIT_VALUES)) {
  assert.equal(value, MATERIAL_META[key].unitPrice, "appraised material content must use the shop reference price");
}
const inlayRows = [];
for (const [settingId, metalId, gemId, gemCount] of [
  ["claw", "gold18k", null, 0], ["bezel", "goldPure", null, 0],
  ["micro", "gold18k", "ruby", 8], ["micro", "platinum", "diamond", 8]
]) {
  const draft = { productType: "pendant", settingId, metalId, gemId, gemCount, polishId: "bright", backingId: null };
  const item = { kind: "cabochon", value: 1000 };
  const quote = quoteFinishPlan(item, draft);
  const client = quoteFinishPlanDraft(draft, inlayCatalog(), 0, item.value, item);
  for (const field of ["materialCost", "materialValue", "processingValue", "valueBonus", "valueBonusCap", "valueMultiplier"]) {
    assert.equal(client[field], quote[field], `client/server ${field}`);
  }
  assert.ok(quote.valueBonus >= quote.materialCost, "costly metal/gems retain their intrinsic material value on cheap jade");
  assert.ok(quote.processingValue > 0);
  const finished = applyInlay(structuredClone(item), draft, quote);
  const once = finished.value;
  applyInlay(finished, draft, quote);
  assert.equal(finished.value, once, "the same finish quote cannot be applied repeatedly for compound value");
  inlayRows.push({ settingId, metalId, gemId, materials: quote.materialCost, craft: quote.processingValue, bonus: quote.valueBonus });
}
console.log(JSON.stringify({ ok: true, comparisons, caps, inlayRows }, null, 2));
