import { jadeValueFactor, defectPenalty } from "../../../shared/domain/jade/jade-opening-engine.js";

// Calibrate the spatial material weights against this opening's actual appraisal.
export class ScratchValuation {
  constructor(stone, coverage, fullValue) {
    this.coverage = coverage;
    this.fullValue = Math.max(0, Math.round(Number(fullValue) || 0));
    this.weights = new Float64Array(coverage.mask.length);
    this.totalWeight = 0;
    this.revealedWeight = 0;
    const { jadeMap, palList, grade } = stone;
    for (let i = 0; i < coverage.mask.length; i++) {
      if (!coverage.mask[i]) continue;
      const x = Math.floor((i % coverage.size + .5) * jadeMap.RES / coverage.size);
      const y = Math.floor((Math.floor(i / coverage.size) + .5) * jadeMap.RES / coverage.size);
      const cell = jadeMap.grid[y * jadeMap.RES + x];
      const palette = palList[cell.cat].pal;
      const weight = cell.waste ? 0 : jadeValueFactor(palette.cv ?? palette.rarity, grade.water)
        * (1 - defectPenalty(cell.crack ? 1 : 0, 0));
      this.weights[i] = weight;
      this.totalWeight += weight;
      if (coverage.erased[i]) this.revealedWeight += weight;
    }
  }

  revealCell(index) { this.revealedWeight += this.weights[index]; }

  get value() {
    if (this.coverage.count === this.coverage.total) return this.fullValue;
    return this.totalWeight > 0
      ? Math.min(this.fullValue, Math.floor(this.fullValue * this.revealedWeight / this.totalWeight)) : 0;
  }
}
