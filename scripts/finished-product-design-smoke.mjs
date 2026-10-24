import assert from "node:assert/strict";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";
import { FULL_HALO, SETTING_GEMS, finishedJadeGeometry, fullHaloLayout, settingGemLayout } from "../shared/domain/workshop/finished-product-design.js";
import { inlayCatalog, canonicalizeFinishPlan, validateFinishPlan, quoteFinishPlan, reserveFinishMaterials, refundFinishMaterials, applyInlay } from "../server/systems/inlay-system.js";
import { createFinishPlanDraft, normalizeFinishPlanDraft, validateFinishPlanDraft } from "../public/finish-plan-model.js";
import { buildInlayPreviewBaseItem, buildFinishPreviewProduct } from "../public/inlay-preview-tester.js";
import { componentJewelrySvg } from "../public/inlay-product-renderer.js";

for (const kind of ["cabochon", "buddhaPendant", "plaque", "leafPendant", "peacePendant", "gourdPendant", "guanyinPendant", "fuBeanPendant"]) {
  const counts = [];
  for (const size of ["S", "M", "L"]) {
    const item = { kind, size };
    const layout = fullHaloLayout(item);
    counts.push(layout.count);
    assert.ok(layout.count > 12, `${kind}/${size}: a closed halo exceeds the old manual limit`);
    assert.equal(layout.count, layout.stones.length);
    assert.equal(layout.count % 2, 0, "bilateral symmetry pairs the stones");
    for (let a = 0; a < layout.count; a++) {
      const p = layout.stones[a];
      const next = layout.stones[(a + 1) % layout.count];
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      assert.ok(Math.hypot(p.x - next.x, p.y - next.y) < layout.diameter * 1.65, `${kind}/${size}: no unfilled closing arc`);
      for (let b = a + 1; b < layout.count; b++) {
        const q = layout.stones[b];
        assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= layout.diameter, `${kind}/${size}: stones must not overlap, including at corners`);
      }
    }
    assert.equal(layout.count, fullHaloLayout({ ...item, id: "different-card", color: "紫罗兰" }).count, "display context and color cannot change the consumed quantity");
  }
  assert.ok(counts[0] < counts[1] && counts[1] < counts[2], `${kind}: actual size increases the computed quantity`);
}
assert.notDeepEqual(fullHaloLayout({ kind: "plaque" }).stones, fullHaloLayout({ kind: "peacePendant" }).stones);
assert.equal(finishedJadeGeometry({ kind: "pendant", motifKind: "buddhaPendant" }).kind, "buddhaPendant");

const catalog = inlayCatalog();
const item = buildInlayPreviewBaseItem("carving", "L");
const draft = createFinishPlanDraft("carving", catalog, item);
Object.assign(draft, { settingId: "micro", metalId: "platinum", gemId: "diamond" });
normalizeFinishPlanDraft("carving", draft, catalog, item);
assert.equal(draft.gemLayout, SETTING_GEMS);
const actual = fullHaloLayout(item).count;
assert.equal(draft.gemCount, actual);

// The server derives consumption from the trusted item, never a client's count.
const canonical = canonicalizeFinishPlan(item, { ...draft, gemCount: -999, fakePrice: 0 });
assert.equal(canonical.ok, true);
assert.equal(canonical.plan.gemCount, actual);
assert.equal(canonical.plan.fakePrice, undefined);
assert.equal(canonicalizeFinishPlan(item, { ...draft, gemLayout: "invented" }).ok, false);
const missingMicro = { ...draft, gemId: null, gemCount: 0 };
assert.equal(canonicalizeFinishPlan(item, missingMicro).ok, false, "micro requires actual stones rather than an empty full-circle frame");
assert.ok(validateFinishPlanDraft({ shape: "carving", draft: missingMicro, catalog, item, materials: { platinum: 100 } }).reasons.includes("微镶需选择配石种类"));

// All supported sizes/types share server, preview and consumption rules.
for (const size of ["S", "M", "L"]) {
  const egg = buildInlayPreviewBaseItem("cabochon", size);
  for (const productType of ["ring", "pendant"]) {
    for (const settingId of ["claw", "bezel", "micro", "channel", "invisible", "cord"]) {
      const raw = { ...draft, productType, settingId, backingId: productType === "ring" ? "open" : null, metalId: settingId === "cord" ? null : "platinum", gemId: "sapphire", gemCount: 999 };
      const result = canonicalizeFinishPlan(egg, raw);
      assert.equal(result.ok, true, `${size}/${productType}/${settingId}: ${result.message}`);
      const plan = result.plan;
      const slots = settingGemLayout(egg, plan);
      const expected = { claw: productType === "ring" ? 2 : 1, bezel: 0, micro: fullHaloLayout(egg).count, channel: slots.count, invisible: 2, cord: 0 }[settingId];
      assert.equal(plan.gemCount, expected);
      assert.equal(quoteFinishPlan(egg, plan).gemCount, expected);
      assert.equal(validateFinishPlan(egg, { ...plan, gemCount: expected + 1 }).ok, false, "current rules reject a mismatched count");
      const markup = componentJewelrySvg(buildFinishPreviewProduct(egg, plan));
      assert.equal((markup.match(/class="craft-accent-stone"/g) || []).length, expected, "render count equals the paid seat count");
      for (const stone of slots.stones) assert.ok(Number.isFinite(stone.x) && Number.isFinite(stone.y), "all seats have finite coordinates");
      if (["bezel", "cord"].includes(settingId)) assert.equal(plan.gemId, null);
      if (settingId === "channel") {
        assert.equal(slots.stones.filter((s) => s.side === -1).length, slots.stones.filter((s) => s.side === 1).length);
        assert.ok(slots.stones.every((s) => Math.abs(s.y) < finishedJadeGeometry(egg).height * .2), "channel stones stay in short side bars rather than a halo");
        for (const channel of slots.channels) {
          const stones = slots.stones.filter((s) => s.side === channel.side);
          for (let i = 1; i < stones.length; i++) assert.ok(Math.hypot(stones[i].x - stones[i-1].x, stones[i].y - stones[i-1].y) >= slots.diameter, "channel stones do not overlap");
        }
      }
      if (expected > 0) {
        assert.ok(markup.indexOf('data-assembly-layer="gem-seats"') < markup.indexOf('data-assembly-layer="gem-faces"'));
        assert.ok(markup.indexOf('data-assembly-layer="gem-faces"') < markup.indexOf('data-assembly-layer="gem-fasteners"'), "metal fasteners occlude the stone edge after the face is drawn");
        assert.equal(validateFinishPlan(egg, { ...plan, gemId: null, gemCount: 0 }).ok, settingId !== "micro", "only micro requires accents");
      }
    }
  }
}
const oldFlagBezel = canonicalizeFinishPlan(item, { ...draft, settingId: "bezel", gemLayout: FULL_HALO });
assert.equal(oldFlagBezel.plan.gemLayout, SETTING_GEMS, "a stale client cannot create more full halos");
assert.equal(oldFlagBezel.plan.gemCount, 0);
const historicHalo = { ...draft, settingId: "claw", gemLayout: FULL_HALO, gemCount: actual };
assert.equal(quoteFinishPlan(item, historicHalo).gemCount, actual, "a saved old job retains its original reserved quantity");
assert.equal((componentJewelrySvg(applyInlay(structuredClone(item), historicHalo, quoteFinishPlan(item, historicHalo))).match(/class="craft-accent-stone"/g) || []).length, actual, "old halo products keep their paid layout");
const quote = quoteFinishPlan(item, canonical.plan);
const materials = { platinum: 100, diamond: actual };
const validated = validateFinishPlanDraft({ shape: "carving", draft, catalog, item, itemValue: item.value, materials });
assert.equal(validated.canStart, true);
for (const key of ["gemCount", "metalAmount", "valueBonus", "valueBonusCap", "valueMultiplier"]) assert.equal(validated.quote[key], quote[key], `${key}: preview and server must agree`);
const poor = { externalMaterials: { platinum: 100, diamond: actual - 1 } };
const poorBefore = structuredClone(poor);
assert.equal(reserveFinishMaterials(poor, quote).ok, false);
assert.deepEqual(poor, poorBefore, "insufficient stock cannot partially consume metal");
const player = { externalMaterials: { ...materials } };
const reservation = reserveFinishMaterials(player, quote);
assert.equal(reservation.ok, true);
assert.equal(player.externalMaterials.diamond, 0);
refundFinishMaterials(player, reservation.reservedMaterials, reservation.reservedMaterialCosts);
assert.deepEqual(player.externalMaterials, materials);

const before = structuredClone(item);
const preview = buildFinishPreviewProduct(item, draft);
const finished = applyInlay(structuredClone(item), canonical.plan, quote);
assert.deepEqual(item, before, "rendering a draft cannot mutate the source jade");
assert.equal(preview.components.find((c) => c.type === "jade").kind, "buddhaPendant");
assert.equal(finished.components.find((c) => c.type === "jade").kind, "buddhaPendant");
assert.equal(finished.inlay.gemCount, actual);
for (const product of [preview, finished]) {
  const markup = componentJewelrySvg(product);
  assert.equal((markup.match(/class="craft-accent-stone"/g) || []).length, actual, "every paid stone is drawn exactly once");
  assert.match(markup, /class="craft-source-material"/);
  assert.match(markup, /data-jade-relief="buddha"/);
  assert.ok(markup.indexOf('data-product-layer="assembly-back"') < markup.indexOf('data-product-layer="jade"'));
  assert.ok(markup.indexOf('data-product-layer="jade"') < markup.indexOf('data-product-layer="assembly-front"'));
}
for (const polishId of ["bright", "soft", "matte"]) {
  const markup = componentJewelrySvg(buildFinishPreviewProduct(item, { ...draft, polishId }));
  assert.match(markup, new RegExp(`data-jade-polish="${polishId}"`));
}
const cordDraft = { ...draft, settingId: "cord", metalId: null };
normalizeFinishPlanDraft("carving", cordDraft, catalog, item);
assert.equal(cordDraft.gemCount, 0);
assert.equal(cordDraft.gemId, null);
const cordMarkup = componentJewelrySvg(buildFinishPreviewProduct(item, cordDraft));
assert.match(cordMarkup, /craft-drill-rim/);
assert.doesNotMatch(cordMarkup, /class="craft-accent-stone"/);
const historicCord = buildFinishPreviewProduct(item, { ...cordDraft, gemLayout: undefined, gemId: "ruby", gemCount: 2 });
assert.equal((componentJewelrySvg(historicCord).match(/class="craft-accent-stone"/g) || []).length, 2, "historic cord items retain their paid stones");

// Exercise the real workshop start/completion boundary in an isolated test world.
const { __testHooks: H } = await import("../server.js");
const workshopPlayer = installOwnedWorkshopFixture(H.makePlayer("finished-product-design-workflow"));
H.normalizePlayer(workshopPlayer);
H.state.players.set(workshopPlayer.id, workshopPlayer);
const device = H.workshopDevicesForPlayer(workshopPlayer).find((d) => d.stage === "finishing");
const blank = { ...structuredClone(item), type: "bracelet", materialStage: "carved", stage: "carved" };
workshopPlayer.bracelets.push(blank);
workshopPlayer.externalMaterials = { platinum: 100, diamond: actual };
const started = H.startWorkshopJobForPlayer(workshopPlayer, device.id, { itemId: blank.id, workerId: device.workerId, finishPlan: { ...draft, gemCount: 1 } });
assert.equal(started.ok, true, started.message);
assert.equal(started.job.finishPlan.gemCount, actual);
assert.equal(workshopPlayer.externalMaterials.diamond, 0);
started.job.readyAt = Date.now() - 1;
const random = Math.random;
try {
  Math.random = () => .99;
  H.processProductionJobs(Date.now(), { onlineOnly: false });
} finally {
  Math.random = random;
}
const delivery = workshopPlayer.workshopDeliveries[0];
assert.equal(H.revealWorkshopDeliveryForPlayer(workshopPlayer, delivery.id).ok, true);
assert.equal(H.claimWorkshopDeliveryForPlayer(workshopPlayer, delivery.id).ok, true);
const completed = workshopPlayer.bracelets.find((p) => p.id === blank.id);
assert.equal(completed?.materialStage, "finished");
assert.equal(completed.inlay.gemCount, actual);
assert.equal((componentJewelrySvg(completed).match(/class="craft-accent-stone"/g) || []).length, actual);
console.log("finished-product-design-smoke: setting-specific seats, embedded stones, legacy layouts, quotes, reservations and real workshop completion ok");
process.exit(0);
