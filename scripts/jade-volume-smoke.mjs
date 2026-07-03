import assert from "node:assert/strict";
import {
  createJadeVolume,
  sampleJadeVolume,
  volumeSliceVeinPolygons
} from "../public/jade-volume.js";

const rough = {
  id: "volume-test",
  name: "蟒带木那料",
  score: 4,
  visual: {
    seed: 24680,
    shape: "chunk",
    skin: "#5e776f",
    vein: "#18a66d",
    beltAngle: 24,
    crackAngle: 104,
    translucency: 0.68,
    cotton: 0.22
  }
};

const volume = createJadeVolume(rough);
assert.equal(volume.seed, 24680, "volume should inherit the rough visual seed");
assert.equal(volume.shape, "chunk", "volume should inherit the rough shape");
assert.ok(volume.veins.length >= 2, "volume needs multiple 3D vein strands");

const firstSample = sampleJadeVolume(volume, 0.48, 0.52, 0.25);
const secondSample = sampleJadeVolume(volume, 0.48, 0.52, 0.25);
assert.deepEqual(firstSample, secondSample, "volume samples must be deterministic");
assert.ok(firstSample.green >= 0 && firstSample.green <= 1, "green field should be normalized");
assert.ok(firstSample.cotton >= 0 && firstSample.cotton <= 1, "cotton field should be normalized");

const frontSlice = volumeSliceVeinPolygons(volume, { sliceIndex: 0, sliceCount: 4 }, 288, 176);
const backSlice = volumeSliceVeinPolygons(volume, { sliceIndex: 3, sliceCount: 4 }, 288, 176);

assert.ok(frontSlice.length >= 1, "front slice should expose at least one sampled vein");
assert.ok(frontSlice.length <= 3, "sampled veins should stay readable instead of creating repeated stickers");
assert.ok(frontSlice.every((band) => band.points.length >= 6), "sampled veins should be irregular ribbon polygons");
assert.ok(
  frontSlice.some((band) => {
    const xs = band.points.map((point) => point.x);
    return Math.max(...xs) - Math.min(...xs) > 288 * 0.5;
  }),
  "a sampled vein should span a meaningful part of the slab"
);
assert.notDeepEqual(
  frontSlice.map((band) => band.points.map((point) => [Math.round(point.x), Math.round(point.y)])),
  backSlice.map((band) => band.points.map((point) => [Math.round(point.x), Math.round(point.y)])),
  "different slice depths should sample related but distinct vein geometry"
);

console.log("jade volume smoke test passed");
