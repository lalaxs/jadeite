import assert from "node:assert/strict";
import {
  validateFinishPlan,
  quoteFinishPlan,
  reserveFinishMaterials,
  refundFinishMaterials,
  applyInlay
} from "../server/systems/inlay-system.js";

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
assert.equal(quote.laborFee, 410);
assert.equal(quote.valueMultiplier, 1.35);

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
assert.equal(product.value, 13500);
assert.equal(product.inlay.settingId, "claw");

console.log("inlay-system-smoke: ok");
