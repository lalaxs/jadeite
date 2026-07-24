import assert from "node:assert/strict";
import {
  createFinishPlanDraft,
  normalizeFinishPlanDraft,
  quoteFinishPlanDraft,
  validateFinishPlanDraft
} from "../public/finish-plan-model.js";

const catalog = {
  productTypes: { cabochon: ["ring"] },
  shapeSettings: { cabochon: ["claw"] },
  productTypeNames: { ring: "戒指" },
  settings: { claw: { name: "爪镶", metals: ["gold18k", "silver925"], grams: 3, labor: 600 } },
  metals: { gold18k: "18K 金", silver925: "925 银" },
  metalValues: { gold18k: .2, silver925: .08 },
  gems: { diamond: "钻石", ruby: "红宝石" },
  polishes: { bright: { labor: 100, value: .1 } },
  polishNames: { bright: "亮光" },
  backings: { open: { labor: 0, value: 0 } },
  backingNames: { open: "开放底托" }
};

const draft = createFinishPlanDraft("cabochon", catalog);
assert.equal(draft.metalId, null, "metal type must be chosen explicitly");
assert.equal(draft.gemId, null);
assert.equal(draft.gemCount, 0);

draft.gemId = "diamond";
normalizeFinishPlanDraft("cabochon", draft, catalog);
assert.equal(draft.gemId, "diamond", "choosing a gem must not be erased while count is zero");
assert.equal(draft.gemCount, 1, "a selected gem starts at one");

draft.metalId = "gold18k";
const quote = quoteFinishPlanDraft(draft, catalog);
assert.equal(quote.metalAmount, 3.15);
assert.equal(quote.gemCount, 1);

const valid = validateFinishPlanDraft({
  shape: "cabochon",
  draft,
  catalog,
  materials: { gold18k: 10, diamond: 4 },
  cash: 5000
});
assert.equal(valid.canStart, true);
assert.equal(valid.showMetalInventory, true);
assert.equal(valid.showGemInventory, true);

const missingType = validateFinishPlanDraft({
  shape: "cabochon",
  draft: { ...draft, metalId: null },
  catalog,
  materials: {},
  cash: 5000
});
assert.equal(missingType.canStart, false);
assert.ok(missingType.reasons.includes("请选择金属种类"));

console.log("finish-plan-model-smoke: progressive material selection ok");
