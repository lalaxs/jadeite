import assert from "node:assert/strict";
import { ScratchCoverage, SCRATCH_BRUSH_RADIUS } from "../public/features/workshop/scratch-coverage.js";
import { openingScratchItemIds, scratchItemIds, pendingScratchItemIds, SCRATCH_REVEAL_THRESHOLD } from "../shared/domain/workshop/delivery-scratch.js";
import { validateSocketEventPayload } from "../server/protocol/socket-event-schemas.js";

const size = 160;
assert.equal(SCRATCH_BRUSH_RADIUS, .04 * 1.2, "brush width is 1.2 times the previous setting");
const mask = Uint8Array.from({ length: size * size }, (_, i) =>
  Math.hypot((i % size + .5) / size - .5, (Math.floor(i / size) + .5) / size - .5) < .4 ? 1 : 0);
const coverage = new ScratchCoverage(mask, size);
coverage.erase({ x: -.5, y: 0 }, { x: -.5, y: 1 });
assert.equal(coverage.ratio, 0, "blank preview margins never count");
coverage.erase({ x: .2, y: .3 }, { x: .8, y: .3 });
assert.ok(coverage.ratio > 0 && coverage.ratio < SCRATCH_REVEAL_THRESHOLD);
const partial = coverage.ratio;
coverage.erase({ x: .2, y: .3 }, { x: .8, y: .3 });
assert.equal(coverage.ratio, partial, "overlapping strokes cannot inflate coverage");
const resumed = new ScratchCoverage(mask, size, coverage.serialize());
assert.equal(resumed.ratio, partial, "partial scratch survives local serialization");
assert.equal(new ScratchCoverage(mask, size, "invalid").ratio, 0);
resumed.erase({ x: .2, y: .5 }, { x: .8, y: .5 });
resumed.erase({ x: .2, y: .7 }, { x: .8, y: .7 });
assert.ok(resumed.ratio < SCRATCH_REVEAL_THRESHOLD, "three strokes with the adjusted brush must not prematurely reveal the stone");
for (const y of [.2, .4, .6, .8]) resumed.erase({ x: .1, y }, { x: .9, y });
assert.ok(resumed.ratio >= SCRATCH_REVEAL_THRESHOLD, "scratching across the surface still reaches automatic reveal");
assert.ok(resumed.ratio <= 1);
const item = { id: "slice", type: "material", materialStage: "opened" };
const opening = { stage: "opening", items: [item], auxiliaryItems: [{ ...item, id: "offcut", leftover: true }] };
assert.deepEqual(openingScratchItemIds(opening), ["slice"]);
assert.deepEqual(scratchItemIds(opening), ["slice"]);
for (const stage of ["carving", "finishing"]) assert.deepEqual(scratchItemIds({ ...opening, stage }), []);
assert.deepEqual(scratchItemIds({ ...opening, items: [{ ...item, leftover: true }] }), []);
assert.deepEqual(scratchItemIds({ ...opening, revealedAt: 123 }), [], "opened legacy batches remain unchanged");
const saved = { ...opening, revealedAt: 123, scratchReveal: { version: 1, itemIds: ["slice"], revealedItemIds: [] } };
assert.deepEqual(pendingScratchItemIds(saved), ["slice"]);
saved.scratchReveal.revealedItemIds.push("slice");
assert.deepEqual(pendingScratchItemIds(saved), []);
const valid = { deliveryId: "batch", requestId: "scratch-request-001", itemIds: ["slice"] };
assert.equal(validateSocketEventPayload("revealWorkshopDelivery", valid, { requireRequestId: true }).success, true);
for (const itemIds of [[], [1], Array(33).fill("slice")]) {
  assert.equal(validateSocketEventPayload("revealWorkshopDelivery", { ...valid, itemIds }).success, false);
}
assert.equal(validateSocketEventPayload("claimWorkshopDelivery", valid).success, false);
console.log("workshop-scratch-smoke: effective area, unique coverage, threshold, saved strokes, opening-only eligibility and strict protocol ok");
