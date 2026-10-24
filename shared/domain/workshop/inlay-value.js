// Reference material content is preserved in the finished article. Work earns a
// bounded additive value; a low-priced jade piece does not destroy costly metal.
export const INLAY_MATERIAL_UNIT_VALUES = Object.freeze({
  goldPure: 560, silver925: 12, gold18k: 380, platinum: 420,
  diamond: 120, ruby: 40, sapphire: 40
});

export function inlayValueBreakdown({
  baseValue = 0, metalId = null, metalAmount = 0, gemId = null, gemCount = 0,
  craftValueRate = 0, craftLabor = 0, valueBonusBase = 1200, valueBonusLaborRate = 0.6,
  materialUnitValues = INLAY_MATERIAL_UNIT_VALUES
} = {}) {
  const base = Math.max(0, Number(baseValue) || 0);
  const materialCost = Math.round(
    Math.max(0, Number(metalAmount) || 0) * Math.max(0, Number(materialUnitValues[metalId]) || 0)
      + Math.max(0, Number(gemCount) || 0) * Math.max(0, Number(materialUnitValues[gemId]) || 0));
  const materialValue = materialCost;
  const processingValueCap = Math.max(0, Math.round(Number(valueBonusBase || 0)
    + Math.max(0, Number(craftLabor) || 0) * Math.max(0, Number(valueBonusLaborRate) || 0)));
  const processingValue = base > 0 ? Math.min(processingValueCap,
    Math.max(0, Math.round(base * Math.max(0, Number(craftValueRate) || 0)
      + Math.max(0, Number(craftLabor) || 0) * 0.1))) : 0;
  const valueBonus = materialValue + processingValue;
  return { materialCost, materialValue, processingValue, processingValueCap,
    valueBonus, valueBonusCap: materialValue + processingValueCap,
    valueMultiplier: base > 0 ? Number((1 + valueBonus / base).toFixed(4)) : 1 };
}
