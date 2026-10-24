import { evaluateLeftoverMaterial } from "../../jade-opening-engine.js";
import { openingStoneFor } from "../opening/opening-render.js";

// Largest remainders keep the displayed area shares at exactly 100.0%.
function areaShares(rows, total) {
  if (!total) return [];
  const shares = rows.filter((row) => row.count > 0).map((row) => {
    const units = row.count / total * 1000;
    return { ...row, units: Math.floor(units), remainder: units % 1 };
  });
  const missing = 1000 - shares.reduce((sum, row) => sum + row.units, 0);
  const ranked = [...shares].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < missing; i++) ranked[i].units += 1;
  return shares.map(({ name, color, count, units }) => ({ name, color, count, percent: units / 10 }));
}

export function analyzeDeliveryMaterial(stone) {
  // Reuse the simulator's 40×40 map, excluding the canvas outside this stone.
  const evaluation = evaluateLeftoverMaterial([], stone, { withinStone: true });
  const colors = areaShares([
    ...stone.palList.map(({ pal }, index) => ({ name: pal.name, color: pal.base, count: evaluation.catCounts[index] || 0 })),
    { name: "废料", color: "#817767", count: evaluation.wasteCount }
  ], evaluation.total);
  return {
    total: evaluation.total,
    // The existing simulator assigns one grade to the jade, not one per color.
    grades: evaluation.goodN ? [{ name: stone.grade.name, percent: 100 }] : [],
    colors,
    crackPercent: evaluation.crackRatio * 100,
    wastePercent: evaluation.wasteRatio * 100
  };
}

export function deliveryMaterialAnalysis(item) {
  // This is the same cached model used by openingStoneSvg for this output.
  return analyzeDeliveryMaterial(openingStoneFor(item));
}
