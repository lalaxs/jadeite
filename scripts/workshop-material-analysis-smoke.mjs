import assert from "node:assert/strict";
import { analyzeDeliveryMaterial, deliveryMaterialAnalysis } from "../public/features/workshop/delivery-material-analysis.js";
import { createDeliveryDetailsUi } from "../public/features/workshop/delivery-details-ui.js";
import { openingStoneFor } from "../public/features/opening/opening-render.js";
import { evaluateLeftoverMaterial } from "../shared/domain/jade/jade-opening-engine.js";

const stone = {
  stonePath: "M0 0 C0 0 300 0 300 0 C300 0 300 300 300 300 C300 300 0 300 0 300 C0 300 0 0 0 0 Z",
  grade: { name: "正冰", water: .75 },
  palList: [{ pal: { name: "白冰", base: "#eee", rarity: 3 } }, { pal: { name: "阳绿", base: "#0f0", rarity: 5 } }],
  jadeMap: { RES: 4, CELL: 150, grid: Array.from({ length: 16 }, () => ({ cat: 1, waste: false, crack: true })) }
};
// Only four cells belong to the visible quarter-canvas stone; the other twelve
// deliberately carry different colors and defects and must never be counted.
stone.jadeMap.grid[0] = { cat: 0, waste: false, crack: true };
stone.jadeMap.grid[1] = { cat: 0, waste: false, crack: false };
stone.jadeMap.grid[4] = { cat: 1, waste: false, crack: false };
stone.jadeMap.grid[5] = { cat: 0, waste: true, crack: true };
const before = structuredClone(stone);
const report = analyzeDeliveryMaterial(stone);
assert.equal(report.total, 4);
assert.deepEqual(report.grades, [{ name: "正冰", percent: 100 }]);
assert.deepEqual(report.colors.map(({ name, percent }) => [name, percent]), [["白冰", 50], ["阳绿", 25], ["废料", 25]]);
assert.equal(report.crackPercent, 25, "waste and off-stone cracks do not count as cracks on jade");
assert.equal(report.wastePercent, 25);
assert.deepEqual(stone, before, "analysis does not change material or generation");

for (let seed = 0; seed < 40; seed++) {
  const item = { id: `analysis-${seed}`, name: "测试片料", qualityKey: "ice", color: "晴水", visual: { seed: seed + 1 } };
  const model = openingStoneFor(item);
  const expected = evaluateLeftoverMaterial([], model, { withinStone: true });
  const actual = deliveryMaterialAnalysis(item);
  assert.equal(actual.total, expected.total);
  assert.equal(actual.crackPercent, expected.crackRatio * 100);
  assert.equal(actual.wastePercent, expected.wasteRatio * 100);
  assert.equal(Math.round(actual.colors.reduce((sum, row) => sum + row.percent, 0) * 10), 1000);
  assert.deepEqual(deliveryMaterialAnalysis(item), actual, "reopening uses the same rendered material model");
}

stone.jadeMap.grid.forEach((cell) => { cell.waste = true; });
assert.deepEqual(analyzeDeliveryMaterial(stone).grades, [], "all-waste pieces have no invented jade quality");
assert.deepEqual(analyzeDeliveryMaterial(stone).colors.map(({ name, percent }) => [name, percent]), [["废料", 100]]);
const ui = createDeliveryDetailsUi({ helpers: { escapeHtml: String } });
const markup = ui.summary({ id: "analysis-card", name: "测试片料", qualityKey: "ice", color: "晴水" });
assert.match(markup, /颜色分布/);
assert.match(markup, /裂纹覆盖/);
assert.match(markup, /正冰/);
assert.doesNotMatch(markup, /估值|工分|阶段|原件尺寸/);
console.log("workshop-material-analysis: visible outline, actual color map, single jade grade, crack/waste areas, 100% rounding and deterministic rendering parity ok");
