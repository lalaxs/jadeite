/**
 * Last-resort economy recovery for genuinely stuck saves.
 *
 * Recovery is automatic on the next connection, but only when the player has
 * almost no cash, no usable stock, no work in progress and no money waiting in
 * another system. The advance is repaid gradually from future earned income.
 */
import { inventoryRecyclePayout } from "../../shared/domain/economy/inventory-recycle.js";
import { getMaterialPrice } from "./materials-service.js";
import { availableDebtRepayment } from "../../shared/domain/economy/operating-reserve.js";
import { recordFinanceBorrowingFee } from "../../shared/domain/economy/finance-book.js";

export const RECOVERY_CASH_THRESHOLD = 2_000;
export const RECOVERY_CASH_TARGET = 12_000;
export const RECOVERY_COOLDOWN_MS = 30 * 60 * 1000;
export const RECOVERY_DEBT_MULTIPLIER = 1.05;
export const RECOVERY_REPAY_RATE = 0.1;

export function normalizeRecovery(player) {
  const raw = player?.recovery && typeof player.recovery === "object"
    ? player.recovery
    : {};
  const recovery = {
    debt: Math.max(0, Math.round(Number(raw.debt) || 0)),
    lastGrantedAt: Math.max(0, Math.round(Number(raw.lastGrantedAt) || 0)),
    grantCount: Math.max(0, Math.round(Number(raw.grantCount) || 0)),
    repaidTotal: Math.max(0, Math.round(Number(raw.repaidTotal) || 0))
  };
  if (player) player.recovery = recovery;
  return recovery;
}

export function recoveryRepaymentFor(player, income, meta = {}) {
  if (!player || meta.recoveryDebtExempt === true) return 0;
  const recovery = normalizeRecovery(player);
  const gross = Math.max(0, Math.round(Number(income) || 0));
  if (gross <= 0 || recovery.debt <= 0) return 0;
  return Math.min(recovery.debt, Math.max(1, Math.round(gross * RECOVERY_REPAY_RATE)), availableDebtRepayment(player));
}

function collectionHasItems(value) {
  return Array.isArray(value) && value.length > 0;
}

export function recoveryLiquidAssets(player) {
  let total = Math.max(0, Number(player?.cash) || 0);
  for (const field of ["rough", "materials", "slices", "bracelets", "collection"]) {
    for (const item of player?.[field] || []) {
      const value = Number(item.value ?? item.price);
      if (!Number.isFinite(value) || value < 0) return Infinity;
      total += inventoryRecyclePayout(value);
    }
  }
  for (const [key, quantity] of Object.entries(player?.externalMaterials || {})) {
    if (Number(quantity) <= 0) continue;
    const unitPrice = getMaterialPrice(key);
    if (!unitPrice) return Infinity;
    total += inventoryRecyclePayout(unitPrice * Number(quantity));
  }
  return total;
}

function hasAuctionEscrow(player) {
  const escrow = player?.auctionEscrow;
  if (Array.isArray(escrow)) return escrow.some((row) => Number(row?.amount) > 0);
  if (escrow && typeof escrow === "object") {
    return Object.values(escrow).some((row) => Number(row?.amount ?? row) > 0);
  }
  return false;
}

export function recoveryBlockers(player, state = {}) {
  const blockers = [];
  if (!player) return ["missing-player"];
  const completedBusiness = Number(player.stats?.orderCount || 0) + Number(player.stats?.tradeCount || 0)
    + Number(player.stats?.bmDeals || 0) + Number(player.stats?.livestreamSales || 0) + Number(player.stats?.commissionCount || 0);
  if (completedBusiness <= 0 || (player.onboarding && !player.onboarding.completedAt)) blockers.push("new-player");
  if (Number(player.cash) >= RECOVERY_CASH_THRESHOLD) blockers.push("cash");

  if (recoveryLiquidAssets(player) >= RECOVERY_CASH_THRESHOLD) blockers.push("liquid-assets");
  if (collectionHasItems(player.jobs) || collectionHasItems(player.polishingJobs)) blockers.push("jobs");
  if (collectionHasItems(player.workshopDeliveries)) blockers.push("workshop-deliveries");
  if (collectionHasItems(player.livestreamRoom?.items)) blockers.push("livestream-stock");
  if (collectionHasItems(player.payouts) || collectionHasItems(player.blackPayouts)) blockers.push("payouts");
  if (hasAuctionEscrow(player)) blockers.push("auction-escrow");

  const playerId = String(player.id || "");
  if ((state.listings || []).some((listing) => String(listing?.ownerId || "") === playerId)) {
    blockers.push("market-listing");
  }
  if ((state.wants || []).some((want) => (
    String(want?.ownerId || "") === playerId && Number(want?.escrowAmount) > 0
  ))) {
    blockers.push("market-want");
  }
  if ((state.blackStalls || []).some((stall) => (
    String(stall?.ownerId || "") === playerId
    && (collectionHasItems(stall.items) || collectionHasItems(stall.pool))
  ))) {
    blockers.push("blackmarket-stock");
  }
  if ((state.blackServiceOrders || []).some((order) => (
    (String(order?.buyerId || "") === playerId || String(order?.sellerId || "") === playerId)
    && !["complete", "cancelled", "expired"].includes(String(order?.status || ""))
  ))) {
    blockers.push("blackmarket-order");
  }
  return [...new Set(blockers)];
}

export function createRecoveryService({ getState, earnCash, refreshPlayerReport } = {}) {
  if (typeof getState !== "function") throw new Error("recovery-service: getState is required");
  if (typeof earnCash !== "function") throw new Error("recovery-service: earnCash is required");

  function recoveryStatus(player, now = Date.now()) {
    const recovery = normalizeRecovery(player);
    const blockers = recoveryBlockers(player, getState());
    const nextEligibleAt = recovery.lastGrantedAt > 0
      ? recovery.lastGrantedAt + RECOVERY_COOLDOWN_MS
      : 0;
    if (nextEligibleAt > now) blockers.push("cooldown");
    if (recovery.debt > 0) blockers.push("outstanding-debt");
    return {
      eligible: blockers.length === 0,
      blockers,
      nextEligibleAt,
      debt: recovery.debt,
      repayRate: RECOVERY_REPAY_RATE
    };
  }

  function recoverPlayerIfNeeded(player, now = Date.now(), { requested = false } = {}) {
    const status = recoveryStatus(player, now);
    if (!status.eligible) return { ok: false, applied: false, ...status };
    if (!requested) return { ok: false, applied: false, ...status, message: "可在经营账房申请周转借款。" };

    const grant = Math.max(0, RECOVERY_CASH_TARGET - Math.max(0, Math.round(Number(player.cash) || 0)));
    if (grant <= 0) return { ok: false, applied: false, ...status };
    earnCash(player, grant, "经营纾困周转金", {
      source: "recovery-advance",
      repEligible: false,
      recoveryDebtExempt: true
    });
    const recovery = normalizeRecovery(player);
    const debtAdded = Math.round(grant * RECOVERY_DEBT_MULTIPLIER);
    recordFinanceBorrowingFee(player, debtAdded - grant, `recovery:${now}`, now);
    recovery.debt += debtAdded;
    recovery.lastGrantedAt = now;
    recovery.grantCount += 1;
    if (typeof refreshPlayerReport === "function") refreshPlayerReport(player, now);
    return {
      ok: true,
      applied: true,
      grant,
      debtAdded,
      debt: recovery.debt,
      nextEligibleAt: now + RECOVERY_COOLDOWN_MS,
      repayRate: RECOVERY_REPAY_RATE
    };
  }

  return { recoveryStatus, recoverPlayerIfNeeded };
}
