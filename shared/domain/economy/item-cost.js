// Cost records are independent of appraisal value. Missing legacy records stay
// incomplete instead of turning an appraisal into a fictional purchase price.
export function itemCost(item) {
  const record = item?.costBasis;
  if (!record || !Number.isFinite(Number(record.amount))) return { amount: 0, complete: false };
  return { amount: Math.max(0, Math.round(Number(record.amount))), complete: record.complete === true };
}

export function setAcquisitionCost(item, amount) {
  const cost = Math.max(0, Math.round(Number(amount) || 0));
  item.costBasis = { amount: cost, complete: true, components: { acquisition: cost }, componentsComplete: true };
  return item;
}

export function addItemCost(item, amount, complete = true, component = "processing") {
  const current = itemCost(item);
  const details = itemCostComponents(item);
  const extra = Math.max(0, Math.round(Number(amount) || 0));
  const refundableCosts = item.costBasis?.refundableCosts;
  const key = ["acquisition", "processing", "materials", "legacy"].includes(component) ? component : "processing";
  item.costBasis = { amount: current.amount + extra, complete: current.complete && complete,
    components: { ...details.components, [key]: (details.components[key] || 0) + extra }, componentsComplete: details.complete,
    ...(refundableCosts ? { refundableCosts: { ...refundableCosts } } : {}) };
  return item.costBasis;
}

/** Breakdown completeness is separate from whether the total historical cost is known. */
export function itemCostComponents(item) {
  const cost = itemCost(item);
  const raw = item?.costBasis?.components;
  const components = {};
  for (const key of ["acquisition", "processing", "materials", "legacy"]) {
    if (Number.isFinite(Number(raw?.[key]))) components[key] = Math.max(0, Math.round(Number(raw[key])));
  }
  const sum = Object.values(components).reduce((total, amount) => total + amount, 0);
  if (sum !== cost.amount || !raw) return { components: { legacy: cost.amount }, complete: false };
  return { components, complete: item.costBasis.componentsComplete === true };
}

export function distributeItemCost(source, targets) {
  const cost = itemCost(source);
  const details = itemCostComponents(source);
  const weights = targets.map((item) => Math.max(0, Number(item.value ?? item.price) || 0));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let remaining = cost.amount;
  const componentRemaining = { ...details.components };
  targets.forEach((item, index) => {
    const amount = index === targets.length - 1 ? remaining : Math.min(remaining,
      Math.round(cost.amount * (totalWeight > 0 ? weights[index] / totalWeight : 1 / targets.length)));
    // Allocate each component against the same cost share and carry remainders.
    const components = {};
    let unassigned = amount;
    const keys = Object.keys(componentRemaining);
    keys.forEach((key, componentIndex) => {
      const value = index === targets.length - 1 ? componentRemaining[key]
        : componentIndex === keys.length - 1 ? Math.min(unassigned, componentRemaining[key])
          : Math.min(unassigned, componentRemaining[key], Math.round((details.components[key] || 0) * amount / Math.max(1, cost.amount)));
      components[key] = Math.max(0, value);
      unassigned -= components[key];
    });
    for (const key of keys) {
      const extra = Math.min(unassigned, componentRemaining[key] - components[key]);
      components[key] += extra;
      unassigned -= extra;
    }
    for (const key of keys) componentRemaining[key] -= components[key];
    item.costBasis = { amount, complete: cost.complete, components, componentsComplete: details.complete };
    if (source.financeBatchId) {
      item.financeBatchId = source.financeBatchId;
      item.financeOwnerId = source.financeOwnerId;
      if (item.id !== source.id) item.financeParentItemId = source.id;
    }
    remaining -= amount;
  });
  // Refundable service fees follow only their original owner's cost lots.
  // Allocate against unclaimed processing capacity so many small fees cannot
  // overfill a tiny child item after rounding.
  const capacity = targets.map(item => item.costBasis.components.processing || 0);
  for (const [key, rawAmount] of Object.entries(source.costBasis?.refundableCosts || {})) {
    let fee = Math.max(0, Math.round(Number(rawAmount) || 0));
    let available = capacity.reduce((sum, amount) => sum + amount, 0);
    targets.forEach((item, index) => {
      const share = Math.min(capacity[index], available > 0 ? Math.round(fee * capacity[index] / available) : 0);
      if (share > 0) (item.costBasis.refundableCosts ||= {})[key] = share;
      fee -= share;
      available -= capacity[index];
      capacity[index] -= share;
    });
  }
}
