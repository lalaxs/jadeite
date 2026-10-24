import { randomUUID } from "node:crypto";
import { COMMISSION_OFFERS, MAX_COMMISSION_NET_PAY, quoteCommission } from "../../shared/domain/economy/commission-rules.js";
import { grantPlayerExp } from "../../shared/domain/progression/player-progression.js";
import { OWNER_OPERATOR_ID } from "../../shared/domain/economy/public-workstations.js";

export function normalizeCommissions(player) {
  const current = player.commissions && typeof player.commissions === "object" ? player.commissions : {};
  current.version = 1;
  current.completedCount = Math.max(0, Math.floor(Number(current.completedCount) || 0));
  current.totalEarned = Math.max(0, Math.round(Number(current.totalEarned) || 0));
  current.history = (Array.isArray(current.history) ? current.history : []).slice(0, 12);
  const active = current.active;
  if (!active || typeof active.id !== "string" || !COMMISSION_OFFERS.some((offer) => offer.id === active.offerId)
    || !Number.isFinite(Number(active.readyAt)) || !Number.isFinite(Number(active.startedAt))
    || Number(active.readyAt) <= Number(active.startedAt) || !Number.isSafeInteger(active.netPay) || active.netPay <= 0
    || active.netPay > MAX_COMMISSION_NET_PAY) current.active = null;
  player.commissions = current;
  return current;
}

export function createCommissionService({ normalizePlayer, earnCash, refreshPlayerReport, advanceTask,
  TIMING_PROFILE = "normal", makeId = randomUUID } = {}) {
  function prepare(player) {
    normalizePlayer?.(player);
    return normalizeCommissions(player);
  }

  function commissionSnapshotForPlayer(player, now = Date.now()) {
    // Snapshot reads must not normalize rosters, create payroll bills or add
    // persistence fields. Mutating preparation belongs only to commands.
    const state = player?.commissions || {};
    const busyDeviceIds = (player.jobs || []).map((job) => job.deviceId);
    return {
      version: 1,
      offers: COMMISSION_OFFERS.map((offer) => quoteCommission(player.workshop?.devices || [], offer.id, TIMING_PROFILE, busyDeviceIds)),
      active: state.active ? { ...structuredClone(state.active), ready: Number(state.active.readyAt) <= now } : null,
      completedCount: Math.max(0, Math.floor(Number(state.completedCount) || 0)),
      totalEarned: Math.max(0, Math.round(Number(state.totalEarned) || 0)),
      history: structuredClone((Array.isArray(state.history) ? state.history : []).slice(0, 12))
    };
  }

  function startCommissionForPlayer(player, payload = {}, now = Date.now()) {
    if (!player) return { ok: false, code: "NOT_FOUND", message: "未找到玩家。" };
    const state = prepare(player);
    if (state.active) return { ok: false, code: "BUSY", message: "请先完成并领取当前来料单。" };
    if ((player.jobs || []).some((job) => job.workerId === OWNER_OPERATOR_ID)) {
      return { ok: false, code: "WORKER_BUSY", message: "掌柜正在加工自己的货，完成后再接来料单。" };
    }
    const busyDeviceIds = (player.jobs || []).map((job) => job.deviceId);
    const quote = quoteCommission(player.workshop?.devices || [], payload.offerId, TIMING_PROFILE, busyDeviceIds);
    if (!quote) return { ok: false, code: "NOT_FOUND", message: "来料单不存在。" };
    const id = String(makeId() || "").trim();
    if (!id) return { ok: false, code: "ID_CONFLICT", message: "接单编号生成失败，请重试。" };
    state.active = { ...quote, id, offerId: quote.offerId, startedAt: now, readyAt: now + quote.durationMs };
    refreshPlayerReport?.(player);
    return { ok: true, message: `${quote.name} 已接单。无需垫资，完成后预计净得 ¥${quote.netPay}。`, commission: structuredClone(state.active) };
  }

  function claimCommissionForPlayer(player, payload = {}, now = Date.now()) {
    if (!player) return { ok: false, code: "NOT_FOUND", message: "未找到玩家。" };
    const state = prepare(player);
    const active = state.active;
    if (!active || payload.commissionId !== active.id) return { ok: false, code: "NOT_FOUND", message: "没有这笔待领取的来料单。" };
    if (active.readyAt > now) return { ok: false, code: "NOT_READY", message: "来料加工尚未完成。" };
    const paid = earnCash(player, active.netPay, `来料加工：${active.name}`, {
      source: "commission", itemId: active.id, repEligible: false, at: now
    });
    const receipt = { id: active.id, offerId: active.offerId, name: active.name, amount: paid,
      grossPay: active.grossPay, stationFee: active.stationFee, consumables: active.consumables,
      maintenanceFee: active.maintenanceFee, completedAt: now };
    state.active = null;
    state.completedCount += 1;
    state.totalEarned += paid;
    state.history.unshift(receipt);
    state.history = state.history.slice(0, 12);
    player.stats ||= {};
    player.stats.commissionCount = (Number(player.stats.commissionCount) || 0) + 1;
    advanceTask?.(player, "commission_complete", 1);
    const exp = grantPlayerExp(player, "commission_done", { now });
    refreshPlayerReport?.(player);
    return { ok: true, message: `${active.name} 已交付，净报酬 ¥${paid}（工位、耗材和维护已结清）。`, receipt, finalPay: paid, exp };
  }

  return { normalizeCommissions, commissionSnapshotForPlayer, startCommissionForPlayer, claimCommissionForPlayer };
}
