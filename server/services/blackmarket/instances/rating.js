// Instance-owned implementation; legacy entry points remain one directory above.
import {
  applySatisfactionDelta,
  CUSTOMER_RATING_PUBLIC_MIN_SAMPLES,
  customerRatingSampleTotal,
  customerRatingStarsFromScore,
  customerRatingTierInfo,
  customerRatingView,
  bmRatingRateSortPenalty,
  bmSellerRatingRate,
  isCustomerRatingPublic
} from "../../../../shared/domain/economy/metric-history.js";
import { pendingPayoutTotal } from "../../economy-service.js";

export function createRating({
  requireApi,
  clamp
}) {
const BM_RATING_MIN_SAMPLES = CUSTOMER_RATING_PUBLIC_MIN_SAMPLES;

const RATING_DELTA = { 5: 2, 4: 1, 3: 0, 2: -2, 1: -4 };

const SATISFACTION_BASELINE = 70;

function ownerRawSatisfaction(state, ownerId) {
  const owner = customerRatingView(state.players?.get?.(ownerId));
  if (!owner) return null;
  if (owner.satisfaction == null || owner.satisfaction === "") return null;
  return clamp(Math.round(Number(owner.satisfaction)), 0, 100);
}

function ownerPublicSatisfaction(state, ownerId) {
  const owner = customerRatingView(state.players?.get?.(ownerId));
  const bmSamples = bmRatingSampleCountForPlayer(state, ownerId);
  if (!isCustomerRatingPublic(owner, bmSamples)) return null;
  return ownerRawSatisfaction(state, ownerId) ?? SATISFACTION_BASELINE;
}

function bmRatingSampleCountForPlayer(state, playerId) {
  const id = String(playerId || "");
  const player = state.players?.get?.(id);
  const fromGoods = Number(player?.bmRatingSampleCount) || 0;
  const fromService = (state.blackServiceOrders || []).filter(
    (order) => order.sellerId === id && order.buyerRating?.stars
  ).length;
  return fromGoods + fromService;
}

function buildRatingDisplay(state, ownerId, satisfaction = null) {
  const owner = customerRatingView(state.players?.get?.(ownerId));
  const bmSamples = bmRatingSampleCountForPlayer(state, ownerId);
  const sampleCount = customerRatingSampleTotal(owner, bmSamples);
  const visible = isCustomerRatingPublic(owner, bmSamples);
  const raw = satisfaction ?? ownerRawSatisfaction(state, ownerId);
  const score = visible ? (raw ?? SATISFACTION_BASELINE) : null;
  const tier = customerRatingTierInfo(score);
  const ratingRate = bmSellerRatingRate(owner, bmSamples);
  return {
    visible,
    label: visible ? null : "暂无评级",
    score,
    stars: score == null ? null : customerRatingStarsFromScore(score),
    title: visible ? tier.title : null,
    orderSat: owner && owner.orderSat != null && owner.orderSat !== ""
      ? clamp(Math.round(Number(owner.orderSat)), 0, 100)
      : null,
    bmSat: owner && owner.bmSat != null && owner.bmSat !== ""
      ? clamp(Math.round(Number(owner.bmSat)), 0, 100)
      : null,
    sampleCount,
    bmSamples,
    minSamples: CUSTOMER_RATING_PUBLIC_MIN_SAMPLES,
    ratingRate,
    ratePenalty: bmRatingRateSortPenalty(owner, bmSamples),
    reason: visible ? "ok" : "insufficient"
  };
}

function submitBlackmarketRatingForPlayer(player, { ratingId, stars } = {}) {
  const { getState } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const star = Math.round(Number(stars));
  if (star < 1 || star > 5) return { ok: false, message: "请选择 1–5 星。" };
  player.pendingBmRatings = player.pendingBmRatings || [];
  const idx = player.pendingBmRatings.findIndex((r) => r.id === ratingId);
  if (idx < 0) return { ok: false, message: "评价不存在或已过期。" };
  const pending = player.pendingBmRatings[idx];
  if (Date.now() > Number(pending.expiresAt || 0)) {
    player.pendingBmRatings.splice(idx, 1);
    return { ok: false, message: "评价已过期。" };
  }
  const state = getState();
  const target = state.players.get(pending.counterpartyId);
  if (!target) {
    player.pendingBmRatings.splice(idx, 1);
    return { ok: false, message: "对方已离线丢失。" };
  }
  if (target.id === player.id) {
    player.pendingBmRatings.splice(idx, 1);
    return { ok: false, message: "不能评价自己。" };
  }
  const delta = RATING_DELTA[star] ?? 0;
  const isBuyerRatingSeller = pending.role === "buyer";
  const note = isBuyerRatingSeller
    ? `黑市摊评 ${star} 星`
    : `买家信誉 ${star} 星`;
  const reasonTag = star <= 2 ? "低星" : star >= 5 ? "好评" : null;
  const applied = applySatisfactionDelta(target, delta, note, {
    source: isBuyerRatingSeller ? "bm_rating" : "bm_buyer_credit",
    track: isBuyerRatingSeller ? "bm" : "buyer",
    baseline: SATISFACTION_BASELINE,
    itemId: pending.tradeId,
    reasonTag: reasonTag || undefined,
    forceRecord: true
  });
  if (pending.tradeKind === "service" && pending.tradeId) {
    const order = (state.blackServiceOrders || []).find((row) => row.id === pending.tradeId);
    if (order) {
      const rating = { stars: star, ratedAt: Date.now(), reasonTag: reasonTag || undefined };
      if (pending.role === "buyer") order.buyerRating = rating;
      else if (pending.role === "seller") order.sellerRating = rating;
    }
  }
  if (isBuyerRatingSeller && pending.tradeKind !== "service") {
    target.bmRatingSampleCount = (Number(target.bmRatingSampleCount) || 0) + 1;
  }
  player.pendingBmRatings.splice(idx, 1);
  return {
    ok: true,
    message: isBuyerRatingSeller ? `已评价摊主 ${star} 星。` : `已评价买家 ${star} 星。`,
    stars: star,
    delta: applied.delta,
    track: applied.track,
    targetSatisfaction: target.satisfaction,
    targetBuyerCredit: target.buyerCredit
  };
}

function collectBlackmarketPayoutForPlayer(player) {
  const { earnCash, addNews, uiMoney } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const payout = pendingPayoutTotal(player.blackPayouts);
  if (payout.code === "EMPTY_PAYOUT") {
    return { ok: false, message: "没有可领取的黑市收益。" };
  }
  if (!payout.ok) {
    return {
      ok: false,
      code: payout.code,
      message: "黑市收益数据异常，记录已保留，请稍后重试。"
    };
  }
  const total = payout.total;
  earnCash(player, total, "黑市收益领取", { source: "blackmarket-payout" });
  player.blackPayouts = [];
  addNews(`${player.name} 领取了黑市收益 ${uiMoney(total)}。`, "trade");
  return { ok: true, message: "已领取。", total };
}

  return {
    BM_RATING_MIN_SAMPLES,
    SATISFACTION_BASELINE,
    ownerRawSatisfaction,
    ownerPublicSatisfaction,
    bmRatingSampleCountForPlayer,
    buildRatingDisplay,
    submitBlackmarketRatingForPlayer,
    collectBlackmarketPayoutForPlayer
  };
}
