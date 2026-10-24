function quantityOf(amount) {
  return Math.max(0, Math.floor(Number(amount) || 0));
}

function volumeBreakpoints(packs = []) {
  return packs
    .map((pack) => ({
      amount: quantityOf(pack?.amount),
      discount: Math.max(0, Math.min(0.95, Number(pack?.discount) || 0))
    }))
    .filter((pack) => pack.amount > 1 && pack.discount > 0)
    .sort((left, right) => left.amount - right.amount);
}

/**
 * Smooth the discount between advertised pack sizes so crossing a threshold
 * never makes a larger order cheaper than a smaller one.
 */
export function smoothMaterialDiscount(packs, amount) {
  const quantity = quantityOf(amount);
  const points = volumeBreakpoints(packs);
  if (!points.length || quantity < points[0].amount) return 0;

  let lower = points[0];
  for (let index = 1; index < points.length; index += 1) {
    const upper = points[index];
    if (quantity <= upper.amount) {
      const span = upper.amount - lower.amount;
      const progress = span > 0 ? (quantity - lower.amount) / span : 1;
      return Number((
        lower.discount + (upper.discount - lower.discount) * progress
      ).toFixed(6));
    }
    lower = upper;
  }
  return lower.discount;
}

export function quoteMaterialPurchase(unitPrice, packs, amount) {
  const quantity = quantityOf(amount);
  if (quantity < 1) return { quantity, discount: 0, price: 0 };
  const discount = smoothMaterialDiscount(packs, quantity);
  return {
    quantity,
    discount,
    price: Math.round(Math.max(0, Number(unitPrice) || 0) * quantity * (1 - discount))
  };
}
