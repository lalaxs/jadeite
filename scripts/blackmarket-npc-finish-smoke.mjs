import assert from "node:assert/strict";
import { __testHooks as H } from "../server.js";
import { maintainNpcBlackmarket } from "../server/services/blackmarket/npc.js";
import { requireApi } from "../server/services/blackmarket/context.js";
import { createNpcGoodsRow } from "../server/services/blackmarket/npc-catalog.js";
import { NPC_STALLS } from "../shared/domain/blackmarket/npc-rules.js";
import { productCanvas } from "../public/features/opening/opening-render.js";
import { jadePieceFor } from "../shared/domain/jade/jade-piece.js";
import { validateFinishPlan } from "../server/systems/inlay-system.js";

H.state.blackStalls.length = 0;
maintainNpcBlackmarket();
const rule = NPC_STALLS.find((entry) => entry.role === "finished");
const stall = H.state.blackStalls.find((entry) => entry.npcRole === "finished");
const kinds = new Set();
for (let index = 0; index < 84; index += 1) {
  const row = createNpcGoodsRow(rule, stall, Date.now(), {}, requireApi());
  const item = row.item;
  kinds.add(item.kind);
  assert.ok(jadePieceFor(item), "a finished NPC product needs an immutable original jade piece");
  assert.equal(item.materialStage, "finished");
  assert.equal(item.polished, true);
  assert.ok(["bright", "soft", "matte"].includes((item.finish || item.inlay).polishId));
  assert.equal(validateFinishPlan(item, { ...(item.finish || item.inlay), productType: item.productType }).ok, true);
  assert.ok(item.components.some((component) => component.type === "jade"));
  assert.equal(item.components.some((component) => component.type === "cord"), item.inlay?.settingId === "cord");
  assert.equal(item.jadePiece.kit.x, item.sourceMaterial.placement.x * 6);
  assert.equal(item.jadePiece.kit.y, item.sourceMaterial.placement.y * 6);
  const markup = productCanvas(item);
  assert.match(markup, /data-jade-view="finished"/);
  assert.ok(markup.includes(`data-jewelry-product-type="${item.productType}"`));
  assert.ok(markup.includes(`data-jewelry-polish="${(item.finish || item.inlay).polishId}"`));
  assert.ok(markup.includes(`data-jewelry-metal="${item.inlay?.metalId || ""}"`));
  assert.ok(markup.includes(`data-jewelry-gem="${item.inlay?.gemId || ""}"`));
  if (["cabochon", "buddhaPendant"].includes(item.kind)) {
    assert.ok(markup.includes(`data-jade-body-art="${item.kind}"`), "painted jade retains its finished surface artwork");
  } else {
    assert.match(markup, /craft-polish-highlight/);
  }
  assert.match(markup, /craft-source-material/);
  assert.doesNotMatch(markup, /class="jade-opening-product /, "finished stock must not use the raw-cutout fallback");
  if (item.kind === "buddhaPendant") assert.match(markup, /data-jade-relief="buddha"/);
  if (item.kind === "leafPendant") assert.match(markup, /data-jade-relief="leaf"/);
}
assert.equal(kinds.size, 7);
const blank = H.state.blackStalls.find((entry) => entry.npcRole === "offcut").items.find((row) => row.item.materialStage === "carved").item;
assert.ok(jadePieceFor(blank));
assert.equal(blank.polished, false);
assert.equal(blank.components, undefined);
assert.match(productCanvas(blank), /data-jade-view="original"/, "a real blank must retain its unfinished appearance");
assert.ok(!blank.baseName.endsWith("毛坯"), "finishing a purchased blank must not retain its temporary stage name");

function legacyItem(item) {
  const old = structuredClone(item);
  for (const field of ["jadePiece", "components", "inlay", "finish", "npcOrigin", "productType", "motifKind"]) delete old[field];
  old.inlaid = false;
  old.plan.svgSpace = old.sourceMaterial.placement.svgSpace = true;
  return old;
}
const legacyRow = stall.items[0];
legacyRow.item = legacyItem(legacyRow.item);
const before = structuredClone({ id: legacyRow.item.id, value: legacyRow.item.value, price: legacyRow.price, ref: legacyRow.referencePrice, sequence: stall.npcSequence, discounts: stall.npcDiscountIssued });
assert.match(productCanvas(legacyRow.item), /class="jade-opening-product /, "reproduce the reported finished-label/raw-cutout mismatch");
assert.equal(maintainNpcBlackmarket().changed, true);
assert.match(productCanvas(legacyRow.item), /data-jade-view="finished"/);
assert.deepEqual({ id: legacyRow.item.id, value: legacyRow.item.value, price: legacyRow.price, ref: legacyRow.referencePrice, sequence: stall.npcSequence, discounts: stall.npcDiscountIssued }, before,
  "repairing existing stock must not change IDs, prices, appraisals or offer budgets");
assert.equal(maintainNpcBlackmarket().changed, false, "the compatibility repair runs only once");

const buyer = H.makePlayer("legacy-npc-product-buyer");
const bought = legacyItem(legacyRow.item);
bought.costBasis = { amount: 850, complete: true };
buyer.bracelets = [bought];
buyer.ledger = [{ kind: "expense", amount: -850, source: "blackmarket", itemId: bought.id, at: Date.now() }];
const oldValue = bought.value;
const oldCash = buyer.cash;
H.normalizePlayer(buyer);
assert.match(productCanvas(buyer.bracelets[0]), /data-jade-view="finished"/);
assert.equal(buyer.bracelets[0].value, oldValue);
assert.deepEqual(buyer.bracelets[0].costBasis, bought.costBasis);
assert.equal(buyer.cash, oldCash);
const unrelated = H.makePlayer("ordinary-legacy-product");
unrelated.bracelets = [legacyItem(legacyRow.item)];
H.normalizePlayer(unrelated);
assert.equal(unrelated.bracelets[0].jadePiece, undefined, "do not rewrite unrelated legacy products without NPC purchase evidence");
console.log("blackmarket-npc-finish-smoke: seven motifs, finished/blank rendering, exact crop, existing-stock and purchased-item compatibility ok");
