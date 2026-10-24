import assert from "node:assert/strict";
import {
  validateFinishPlan,
  quoteFinishPlan,
  reserveFinishMaterials,
  refundFinishMaterials,
  applyInlay,
  inlayCatalog
} from "../server/systems/inlay-system.js";
import { quoteFinishPlanDraft } from "../shared/domain/workshop/finish-plan-model.js";

const cabochon = { id: "jade-1", kind: "cabochon", value: 10000 };
const plan = {
  productType: "ring",
  settingId: "claw",
  metalId: "gold18k",
  gemId: "diamond",
  gemCount: 2,
  polishId: "bright",
  backingId: "open"
};

assert.equal(validateFinishPlan(cabochon, plan).ok, true);
const quote = quoteFinishPlan(cabochon, plan);
assert.equal(quote.metalAmount, 1.65);
assert.equal(quote.laborFee, 0);
assert.equal(quote.nominalValueMultiplier, 1.4);
assert.equal(quote.materialCost, 867);
assert.equal(quote.valueBonus, 1708);
assert.equal(quote.valueMultiplier, 1.1708);

const plainPlan = { ...plan, gemId: null, gemCount: 0 };
const clawQuote = quoteFinishPlan(cabochon, plainPlan, 1235);
const microQuote = quoteFinishPlan(cabochon, { ...plainPlan, settingId: "micro" }, 1235);
const invisibleQuote = quoteFinishPlan(cabochon, { ...plainPlan, settingId: "invisible" }, 1235);
assert.equal(clawQuote.nominalValueMultiplier, 1.28);
assert.equal(microQuote.nominalValueMultiplier, 1.37);
assert.equal(invisibleQuote.nominalValueMultiplier, 1.41);
assert.ok(clawQuote.valueBonus < microQuote.valueBonus);
assert.ok(microQuote.valueBonus < invisibleQuote.valueBonus);

const bezelPlan = { ...plainPlan, settingId: "bezel" };
const pureGoldQuote = quoteFinishPlan(cabochon, { ...bezelPlan, metalId: "goldPure" }, 1235);
const gold18kQuote = quoteFinishPlan(cabochon, { ...bezelPlan, metalId: "gold18k" }, 1235);
assert.ok(pureGoldQuote.valueBonus > gold18kQuote.valueBonus, "premium gold must no longer be dominated by 18K gold");

const deluxeBase = { ...plainPlan, metalId: "platinum", gemCount: 12 };
const diamondQuote = quoteFinishPlan({ ...cabochon, value: 5000 }, { ...deluxeBase, gemId: "diamond" });
const rubyQuote = quoteFinishPlan({ ...cabochon, value: 5000 }, { ...deluxeBase, gemId: "ruby" });
assert.equal(diamondQuote.nominalValueMultiplier, 2.05);
assert.equal(rubyQuote.nominalValueMultiplier, 1.81);
assert.ok(diamondQuote.valueBonus > rubyQuote.valueBonus, "diamond accents should carry a higher resale premium");

const catalog = inlayCatalog();
assert.equal(catalog.productTypeNames.earring, undefined);
assert.ok(Object.values(catalog.productTypes).every((types) => !types.includes("earring")));
assert.equal(catalog.productTypeNames.bracelet, undefined);
assert.ok(Object.values(catalog.productTypes).every((types) => !types.includes("bracelet")));
assert.equal(validateFinishPlan(cabochon, { ...plan, productType: "earring", backingId: null }).ok, false);
for (const candidate of [
  plan,
  { ...plainPlan, settingId: "invisible" },
  { ...bezelPlan, metalId: "goldPure" },
  { ...deluxeBase, gemId: "ruby" }
]) {
  const itemValue = candidate.gemCount === 12 ? 5000 : 10000;
  const serverQuote = quoteFinishPlan({ ...cabochon, value: itemValue }, candidate, 1235);
  const clientQuote = quoteFinishPlanDraft(candidate, catalog, 1235, itemValue);
  for (const key of [
    "metalAmount", "gemCount", "craftLaborFee", "laborFee",
    "nominalValueMultiplier", "valueBonusCap", "valueBonus", "valueMultiplier"
  ]) {
    assert.equal(clientQuote[key], serverQuote[key], `${key} quote must match on client and server`);
  }
}

assert.equal(
  validateFinishPlan(cabochon, { ...plan, metalId: "goldPure" }).ok,
  false
);
assert.equal(
  validateFinishPlan(cabochon, { ...plan, gemCount: 13 }).code,
  "INVALID_QUANTITY"
);

const player = {
  externalMaterials: { gold18k: 2, diamond: 2 }
};
const reserve = reserveFinishMaterials(player, quote);
assert.equal(reserve.ok, true);
assert.equal(player.externalMaterials.gold18k, 0.35);
assert.equal(player.externalMaterials.diamond, 0);
refundFinishMaterials(player, reserve.reservedMaterials);
assert.equal(player.externalMaterials.gold18k, 2);
assert.equal(player.externalMaterials.diamond, 2);

const product = applyInlay({ value: 10000 }, plan, quote);
assert.equal(product.value, 11708);
assert.equal(product.inlay.settingId, "claw");

console.log("inlay-system-smoke: ok");
