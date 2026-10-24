import { workerDailyWage } from './worker-economy.js';

export const BASE_OPERATING_RESERVE = 4_000;
const PROCUREMENT_SOURCES = new Set(['auction', 'market', 'blackmarket', 'material', 'livestream-buy']);

/** Cash protected from automatic debt collection; voluntary repayments remain possible. */
export function operatingReserveFor(player) {
  const wages = (player?.workshop?.workers || []).reduce((sum, worker) => (
    sum + (worker?.isOwner || worker?.ownerOperator ? 0 : workerDailyWage(worker))
  ), 0);
  const recentPurchases = (player?.ledger || []).filter((row) => (
    PROCUREMENT_SOURCES.has(row?.source) && (row?.kind === 'expense' || Number(row?.amount) < 0)
  )).slice(0, 12);
  const procurement = recentPurchases.reduce((largest, row) => Math.max(largest, Math.abs(Number(row.amount) || 0)), 0);
  return Math.ceil(Math.max(BASE_OPERATING_RESERVE, procurement + wages * 2));
}

export function availableDebtRepayment(player) {
  return Math.max(0, Math.floor(Number(player?.cash) || 0) - operatingReserveFor(player));
}
