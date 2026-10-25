import { jadeValueFactor } from "../jade/jade-opening-engine.js";

/** Additive intrinsic cell weight. Whole-object defect penalties are not a
 * partition measure: cutting a crack away can improve that appraisal. */
export function materialEvaluationWeight(evaluation, stone) {
  return (evaluation?.catCounts || []).reduce((sum, count, index) => {
    const palette = stone?.palList?.[index]?.pal || {};
    const cv = Number(palette.cv ?? palette.rarity) || 0;
    return sum + Math.max(0, Number(count) || 0) * jadeValueFactor(cv, Number(stone?.grade?.water) || 0);
  }, 0);
}

// Appraisals of a cut piece and its leftover use one material pool. Geometry
// supplies only the division weights; it cannot mint another full stone value.
export function partitionMaterialValue(material, nextRemainingRatio, weights = [], options = {}) {
  const asMoney = (value) => Math.max(0, Math.round(Number(value) || 0));
  const inputValue = asMoney(material?.value ?? material?.price);
  const inputBase = asMoney(material?.baseValue ?? material?.value ?? material?.price);
  const previousRatio = Math.max(.0001, Math.min(1, Number(material?.remainingRatio ?? material?.openingEval?.remainRatio ?? 1) || 0));
  const remainingRatio = Math.max(0, Math.min(previousRatio, Number(nextRemainingRatio) || 0));
  const retainedRatio = remainingRatio / previousRatio;
  const valueRetainedRatio = Number.isFinite(Number(options.valueRetainedRatio))
    ? Math.max(0, Math.min(1, Number(options.valueRetainedRatio))) : retainedRatio;
  const contributionFor = (ratio) => Object.fromEntries(Object.entries(material?.craftValueContributions || {}).map(([step, contribution]) => [step, {
    process: Math.max(0, Number(contribution.process) || 0) * ratio,
    equipment: Math.max(0, Number(contribution.equipment) || 0) * ratio
  }]));
  const sourceWeight = Number(options.sourceWeight) || 0;
  const independent = sourceWeight > 0;
  const fractions = weights.map((weight) => Math.max(0, Number(weight) || 0) / sourceWeight);
  const leftoverValue = independent ? Math.max(0, inputValue - fractions.reduce((sum, fraction) => sum + Math.floor(inputValue * fraction), 0)) : asMoney(inputValue * valueRetainedRatio);
  const leftoverBase = independent ? Math.max(0, inputBase - fractions.reduce((sum, fraction) => sum + Math.floor(inputBase * fraction), 0)) : asMoney(inputBase * valueRetainedRatio);
  let valueRest = inputValue - leftoverValue;
  let baseRest = inputBase - leftoverBase;
  const consumedValue = valueRest;
  const consumedBase = baseRest;
  const totalWeight = weights.reduce((sum, weight) => sum + Math.max(0, Number(weight) || 0), 0);
  const pieces = weights.map((weight, index) => {
    const fraction = totalWeight > 0 ? Math.max(0, Number(weight) || 0) / totalWeight : 0;
    const isLastValuedPiece = totalWeight > 0 && fraction > 0 && !weights.slice(index + 1).some((next) => Number(next) > 0);
    const value = independent ? Math.min(valueRest, Math.floor(inputValue * fractions[index])) : isLastValuedPiece ? valueRest : Math.min(valueRest, asMoney(consumedValue * fraction));
    const baseValue = independent ? Math.min(baseRest, Math.floor(inputBase * fractions[index])) : isLastValuedPiece ? baseRest : Math.min(baseRest, asMoney(consumedBase * fraction));
    valueRest -= value;
    baseRest -= baseValue;
    return { value, baseValue, craftValueContributions: contributionFor(inputValue > 0 ? value / inputValue : 0) };
  });
  return { pieces, remainingRatio, retainedRatio, valueRetainedRatio,
    discardedValue: valueRest, discardedBaseValue: baseRest,
    leftover: { value: leftoverValue, baseValue: leftoverBase, craftValueContributions: contributionFor(inputValue > 0 ? leftoverValue / inputValue : valueRetainedRatio) } };
}
