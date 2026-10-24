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
  settings: { claw: { name: "爪镶", metals: ["gold18k", "silver925"], grams: 3, labor: 600, value: .03 } },
  metals: { gold18k: "18K 金", silver925: "925 银" },
  metalValues: { gold18k: .2, silver925: .08 },
  gems: { diamond: "钻石", ruby: "红宝石" },
  gemValues: { diamond: .06, ruby: .04 },
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
const slotCount = 2;
assert.equal(draft.gemCount, slotCount, "claw rings have one accent on each shoulder");

draft.metalId = "gold18k";
const quote = quoteFinishPlanDraft(draft, catalog);
assert.equal(quote.metalAmount, Number((3 * (1 + slotCount * .05)).toFixed(2)));
assert.equal(quote.gemCount, slotCount);
assert.equal(quote.nominalValueMultiplier, Number((1.33 + slotCount * .06).toFixed(2)));

const valid = validateFinishPlanDraft({
  shape: "cabochon",
  draft,
  catalog,
  materials: { gold18k: 20, diamond: slotCount },
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

const missingStock = validateFinishPlanDraft({
  shape: "cabochon",
  draft,
  catalog,
  materials: { gold18k: 0, diamond: 0 },
  cash: 5000
});
assert.equal(missingStock.canStart, false);
assert.ok(missingStock.reasons.includes("金属库存不足"));
assert.ok(missingStock.reasons.includes("配石库存不足"));
assert.equal(missingStock.stockShortages.length, 2);
assert.equal(missingStock.stockShortages[0].materialId, "gold18k");
assert.equal(missingStock.stockShortages[1].materialId, "diamond");

console.log("finish-plan-model-smoke: progressive material selection ok");
