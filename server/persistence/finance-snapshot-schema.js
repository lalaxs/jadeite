// Additive validation: old saves omit financeBook; all extra fields are retained.
const nonnegative = ["salesRevenue", "soldCost", "salesFees", "unknownCostSales", "commissionNet", "serviceNet", "operatingExpenses",
  "materialLoss", "unknownLosses", "unknownOperatingCosts", "financeCosts", "equipmentOutflow", "equipmentInflow", "cashIn", "cashOut", "otherOperatingIncome",
  "financingInflow", "debtRepayment", "depositsHeld", "depositsReleased", "nonOperatingIncome"];
const object = value => value && typeof value === "object" && !Array.isArray(value);
function integer(value, label, signed = false) {
  if (!Number.isSafeInteger(value) || (!signed && value < 0)) throw new Error(`world-store: ${label} is invalid`);
}
function totals(row, label, daily = false) {
  if (!object(row)) throw new Error(`world-store: ${label} must be an object`);
  for (const key of nonnegative) if (row[key] != null) integer(row[key], `${label}.${key}`, daily && ["soldCost", "materialLoss"].includes(key));
  if (row.knownSalesProfit != null) integer(row.knownSalesProfit, `${label}.knownSalesProfit`, true);
}
export function validateFinanceBook(player, label) {
  const book = player.financeBook;
  if (book == null) return;
  if (!object(book) || book.version !== 1) throw new Error(`world-store: ${label}.financeBook is invalid`);
  integer(book.startedAt, `${label}.financeBook.startedAt`);
  integer(book.sequence, `${label}.financeBook.sequence`);
  totals(book.totals, `${label}.financeBook.totals`);
  for (const field of ["days", "events", "batches"]) if (!object(book[field])) throw new Error(`world-store: ${label}.financeBook.${field} is invalid`);
  for (const [day, row] of Object.entries(book.days)) totals(row, `${label}.financeBook.days.${day}`, true);
  for (const [id, at] of Object.entries(book.events)) integer(at, `${label}.financeBook.events.${id}`);
  for (const [id, batch] of Object.entries(book.batches)) {
    if (!object(batch) || batch.id !== id || typeof batch.costComplete !== "boolean") throw new Error(`world-store: ${label}.financeBook.batches.${id} is invalid`);
    for (const field of ["startedAt", "directCost", "revenue", "soldCost", "salesFees", "lossCost", "unknownSales", "pendingRevenue"]) integer(batch[field], `${label}.financeBook.batches.${id}.${field}`);
    if (!Array.isArray(batch.sales) || !Array.isArray(batch.losses)) throw new Error(`world-store: ${label}.financeBook.batches.${id} history is invalid`);
  }
  if (!Array.isArray(book.recentSales) || book.recentSales.length > 120) throw new Error(`world-store: ${label}.financeBook.recentSales is invalid`);
}
