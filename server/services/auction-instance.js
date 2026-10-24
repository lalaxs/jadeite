import { playersMatching } from "../persistence/mutation-scope.js";
import { registerFinanceItem } from "../../shared/domain/economy/finance-book.js";
import {
  AUCTION_HALLS,
  auctionEntryFee,
  auctionHallForId,
  auctionWindowFee,
  enterAuctionRound,
  upsertBid,
  aiBidsForRough,
  settleAuctionRound,
  buildAuctionSettleModalEvent
} from "../../shared/domain/auction/jade-auction.js";
import {
  grantPlayerExp,
  playerLevelForExp
} from "../../shared/domain/progression/player-progression.js";
import { attemptAtomicMutation } from "./atomic-mutation.js";
import { auctionRoundsForState, auctionRoundForHall, storeAuctionRound } from "./auction-rounds.js";
import { createAchievementRewards } from "./achievement-rewards-instance.js";

export function createAuctionService(deps) {
  return createAuctionModule(() => deps, createAchievementRewards({ earnCash: deps?.earnCash }).settlePlayerAchievements);
}

export function createAuctionModule(getApi, settlePlayerAchievements) {
  function requireApi() {
    const api = getApi();
    if (!api) throw new Error("auction-service: bindAuctionApi() was not called");
    return api;
  }

const AUCTION_HALL_LOT_PROFILES = Object.freeze({
  novice: Object.freeze({
    mass: Object.freeze([0.7, 2.2]),
    weights: Object.freeze([0.38, 0.30, 0.18, 0.09, 0.04, 0.01])
  }),
  regular: Object.freeze({
    mass: Object.freeze([0.9, 2.8]),
    weights: Object.freeze([0.24, 0.30, 0.24, 0.14, 0.065, 0.015])
  }),
  premium: Object.freeze({
    mass: Object.freeze([1.1, 3.3]),
    weights: Object.freeze([0, 0.18, 0.32, 0.28, 0.16, 0.06])
  }),
  special: Object.freeze({
    mass: Object.freeze([1.8, 3.5]),
    weights: Object.freeze([0, 0.10, 0.25, 0.30, 0.23, 0.12])
  }),
  legendary: Object.freeze({
    mass: Object.freeze([1.4, 3.5]),
    weights: Object.freeze([0, 0, 0.12, 0.32, 0.34, 0.22])
  })
});

const AUCTION_QUALITY_KEYS = Object.freeze(["bean", "glutinous", "stickyIce", "ice", "highIce", "glass"]);

function auctionQualityKeyForRoll(profile, roll) {
  const value = Math.max(0, Math.min(0.999999, Number(roll) || 0));
  let cursor = 0;
  for (let index = 0; index < AUCTION_QUALITY_KEYS.length; index += 1) {
    cursor += Number(profile.weights[index] || 0);
    if (value < cursor) return AUCTION_QUALITY_KEYS[index];
  }
  return AUCTION_QUALITY_KEYS[AUCTION_QUALITY_KEYS.length - 1];
}

function createAuctionHallRoughs(hallId, makeRoughStone, count = 8, rng = Math.random) {
  if (typeof makeRoughStone !== "function") return [];
  const id = AUCTION_HALL_LOT_PROFILES[hallId] ? hallId : "novice";
  const profile = AUCTION_HALL_LOT_PROFILES[id];
  const total = Math.max(1, Math.round(Number(count) || 8));
  return Array.from({ length: total }, () => {
    const qualityKey = auctionQualityKeyForRoll(profile, rng());
    const [minMass, maxMass] = profile.mass;
    const mass = Math.round((minMass + rng() * (maxMass - minMass)) * 10) / 10;
    return {
      ...makeRoughStone({ qualityKey, mass, rng }),
      sourceHallId: id
    };
  });
}

function normalizeAuctionEscrow(player) {
  const { money } = requireApi();
  if (!player) return [];
  if (!Array.isArray(player.auctionEscrow)) player.auctionEscrow = [];
  player.auctionEscrow = player.auctionEscrow
    .filter((entry) => entry && entry.roughId)
    .map((entry) => ({
      roughId: String(entry.roughId),
      roundId: String(entry.roundId || ""),
      amount: money(entry.amount),
      at: Number(entry.at || 0)
    }))
    .filter((entry) => entry.amount > 0);
  return player.auctionEscrow;
}

function auctionEscrowForRough(player, roughId) {
  const id = String(roughId || "");
  return normalizeAuctionEscrow(player).find((entry) => entry.roughId === id) || null;
}

function setAuctionEscrow(player, { roughId, roundId, amount, at }) {
  const { money } = requireApi();
  normalizeAuctionEscrow(player);
  const id = String(roughId || "");
  if (!id) return null;
  const nextAmount = money(amount);
  const index = player.auctionEscrow.findIndex((entry) => entry.roughId === id);
  if (nextAmount <= 0) {
    if (index >= 0) player.auctionEscrow.splice(index, 1);
    return null;
  }
  const entry = {
    roughId: id,
    roundId: String(roundId || ""),
    amount: nextAmount,
    at: Number(at || Date.now())
  };
  if (index >= 0) player.auctionEscrow[index] = entry;
  else player.auctionEscrow.push(entry);
  return entry;
}

function applyAuctionBidEscrow(player, rough, nextAmount, round, now = Date.now()) {
  const { money, holdDeposit, releaseDeposit } = requireApi();
  const prev = auctionEscrowForRough(player, rough.id);
  const previousAmount = money(prev?.amount || 0);
  const target = money(nextAmount);
  const delta = target - previousAmount;
  if (delta > 0) {
    if (!holdDeposit(player, delta, `公盘抵押${rough.name}`, {
      source: "auctionEscrow",
      itemId: rough.id,
      repEligible: false
    })) {
      return { ok: false, message: `可用现金不足，还需 ${delta}。` };
    }
  } else if (delta < 0) {
    releaseDeposit(player, Math.abs(delta), `公盘退还抵押：${rough.name}`, {
      source: "auctionEscrowRefund",
      itemId: rough.id,
      repEligible: false
    });
  }
  setAuctionEscrow(player, {
    roughId: rough.id,
    roundId: round?.id,
    amount: target,
    at: now
  });
  return { ok: true, escrowed: target, delta, previousAmount };
}

function consumeAuctionEscrow(player, roughId) {
  const { money } = requireApi();
  const prev = auctionEscrowForRough(player, roughId);
  if (!prev) return 0;
  const amount = money(prev.amount);
  setAuctionEscrow(player, { roughId, roundId: prev.roundId, amount: 0 });
  return amount;
}

function refundAuctionEscrow(player, roughId, roughName = "") {
  const { money, releaseDeposit } = requireApi();
  const prev = auctionEscrowForRough(player, roughId);
  if (!prev) return 0;
  const amount = money(prev.amount);
  setAuctionEscrow(player, { roughId, roundId: prev.roundId, amount: 0 });
  if (amount > 0) {
    releaseDeposit(player, amount, `公盘落标退还：${roughName || roughId}`, {
      source: "auctionEscrowRefund",
      itemId: roughId,
      repEligible: false
    });
  }
  return amount;
}

function refundStaleAuctionEscrows(roundId) {
  const { getState, normalizePlayer } = requireApi();
  const id = String(roundId || "");
  for (const player of playersMatching(getState().players, (entry) => Boolean(entry.auctionEscrow?.length))) {
    normalizePlayer(player);
    for (const entry of [...normalizeAuctionEscrow(player)]) {
      if (!id || entry.roundId === id) {
        refundAuctionEscrow(player, entry.roughId, entry.roughId);
      }
    }
  }
}

function reconcileAuctionEscrows() {
  const { getState, normalizePlayer } = requireApi();
  const state = getState();
  const rounds = new Map(auctionRoundsForState(state).filter((round) => !round.settledAt).map((round) => [round.id, round]));
  let count = 0;
  let refunded = 0;

  for (const player of playersMatching(state.players, (entry) => Boolean(entry.auctionEscrow?.length))) {
    normalizePlayer(player);
    for (const entry of [...normalizeAuctionEscrow(player)]) {
      const roughId = String(entry.roughId || "");
      const round = rounds.get(entry.roundId);
      const valid = round?.roughs?.some((rough) => rough.id === roughId)
        && round?.bids?.some((bid) => !bid.ai && bid.playerId === player.id && bid.roughId === roughId);
      if (valid) continue;
      refunded += refundAuctionEscrow(player, roughId, roughId);
      count += 1;
    }
  }

  return { changed: count > 0, count, refunded };
}

function publicAuctionHalls(player) {
  const { getState } = requireApi();
  const level = playerLevelForExp(player?.exp);
  const state = getState();
  return AUCTION_HALLS.map((hall) => {
    const round = auctionRoundForHall(state, hall.id);
    return {
      id: hall.id,
      label: hall.label,
      requiredLevel: hall.requiredLevel,
      windowRate: hall.windowRate,
      windowMin: hall.windowMin,
      deposit: hall.deposit,
      entryFee: auctionEntryFee(hall),
      tone: hall.tone,
      priceNote: hall.priceNote,
      unlocked: level >= hall.requiredLevel,
      active: level >= hall.requiredLevel,
      next: false,
      entered: playerEnteredAuction(round, player?.id),
      startsAt: round?.startsAt,
      endsAt: round?.endsAt ?? round?.biddingEndsAt,
      myBidCount: (round?.bids || []).filter((bid) => bid.playerId === player?.id).length
    };
  });
}

function auctionRoundDuration() {
  const { money, TIMING } = requireApi();
  const configured = TIMING.auction.duration ?? ((TIMING.auction.registration || 0) + (TIMING.auction.bidding || 0));
  return money(configured || 10 * 60 * 1000);
}

function auctionEndsAt(round) {
  return Number(round?.endsAt ?? round?.biddingEndsAt ?? 0);
}

function auctionRoundTiming(now) {
  const rounds = auctionRoundsForState(requireApi().getState()).filter((round) => !round.settledAt);
  const duration = auctionRoundDuration();
  const latestEnd = Math.max(0, ...rounds.map(auctionEndsAt));
  // Keep the latest live deadline when repairing older, staggered halls so no
  // paid round is cut short. Renewals retain the cadence even after downtime.
  const startsAt = latestEnd > now
    ? latestEnd - duration
    : latestEnd > 0 ? latestEnd + Math.floor((now - latestEnd) / duration) * duration : now;
  return { startsAt, endsAt: startsAt + duration };
}

function synchronizeAuctionRoundTimes(now) {
  const timing = auctionRoundTiming(now);
  let changed = false;
  for (const round of auctionRoundsForState(requireApi().getState())) {
    // Expired rounds must settle at their original deadline, never reopen.
    if (round.settledAt || auctionEndsAt(round) <= now) continue;
    if (round.startsAt === timing.startsAt && round.endsAt === timing.endsAt && round.biddingEndsAt === timing.endsAt) continue;
    Object.assign(round, timing, { biddingEndsAt: timing.endsAt });
    changed = true;
  }
  return changed;
}

function playerEnteredAuction(round, playerId) {
  return (round?.entries || []).some((entry) => entry.playerId === playerId);
}

function createAuctionRound(now = Date.now(), hallSlot = null) {
  const {
    getState,
    makeRoughStone,
    randomUUID,
    DEFAULT_AUCTION_HALL_ID,
    addNews
  } = requireApi();
  const requestedHallId = typeof hallSlot === "string" ? hallSlot : hallSlot?.hallId;
  const hall = auctionHallForId(requestedHallId || DEFAULT_AUCTION_HALL_ID);
  const { startsAt, endsAt } = auctionRoundTiming(now);
  const state = getState();
  const roughs = createAuctionHallRoughs(hall.id, makeRoughStone, 8);
  // The shared legacy pool belongs to the primary hall. Additional halls only
  // expose their lots through paid, personalized publicAuctionSnapshots.
  if (!state.auction || (state.auction.hallId || "novice") === hall.id) {
    state.roughPool.splice(0, state.roughPool.length, ...roughs);
  }
  const round = storeAuctionRound(state, {
    id: randomUUID(),
    hallId: hall.id,
    hallLabel: hall.label,
    status: "live",
    startsAt,
    endsAt,
    biddingEndsAt: endsAt,
    entryFee: auctionEntryFee(hall),
    entries: [],
    roughs: [...roughs],
    bids: [],
    results: []
  });
  addNews(`${hall.label}已开场，前 8 分钟明拍，最后 2 分钟暗拍。`, "info");
  return round;
}

function ensureAuctionRound(now = Date.now(), hallId = null) {
  const { getState } = requireApi();
  const state = getState();
  const target = hallId || state.auction?.hallId || "novice";
  const round = auctionRoundForHall(state, target);
  if (round && !round.settledAt && now < auctionEndsAt(round)) {
    synchronizeAuctionRoundTimes(now);
    return round;
  }
  if (round && !round.settledAt && now >= auctionEndsAt(round)) {
    settleAuctionIfDue(now, target);
    return auctionRoundForHall(state, target);
  }
  return createAuctionRound(now, target);
}

function settleAuctionIfDue(now = Date.now(), hallId = null) {
  const state = requireApi().getState();
  const rounds = auctionRoundsForState(state).filter((round) => !hallId || (round.hallId || "novice") === hallId);
  if (!rounds.length) { ensureAuctionRound(now, hallId); return false; }
  let changed = false;
  for (const round of rounds) if (settleAuctionHallIfDue(now, round)) changed = true;
  return changed;
}

function settleAuctionHallIfDue(now, round) {
  const {
    getState,
    money,
    markInventoryItemNew,
    advanceTask,
    queueOfflineEvent,
    refreshPlayerReport,
    addNews,
    isPlayerOnline,
    emitUiEventToPlayer,
    uiMoney
  } = requireApi();
  const state = getState();
  if (round.settledAt || now < auctionEndsAt(round)) return false;
  const withAi = {
    ...round,
    bids: [
      ...(round.bids || []),
      ...round.roughs.flatMap((rough) => aiBidsForRough(rough, round.bids, 3))
    ]
  };
  const settled = settleAuctionRound(withAi, {
    now,
    bidderCanPay: (bid) => {
      if (bid.ai) return true;
      const bidder = state.players.get(bid.playerId);
      if (!bidder) return false;
      const escrow = auctionEscrowForRough(bidder, bid.roughId);
      return Boolean(escrow && money(escrow.amount) >= money(bid.amount));
    }
  });
  const transaction = attemptAtomicMutation([state], ({ afterCommit }) => {
  if (round === state.auction) state.latestAuctionResults = settled.results;
  state.auctionHistory.unshift({
    id: settled.id,
    roundId: settled.id,
    hallId: settled.hallId,
    hallLabel: settled.hallLabel,
    startsAt: settled.startsAt,
    endsAt: settled.endsAt ?? settled.biddingEndsAt,
    settledAt: settled.settledAt,
    results: settled.results
  });
  state.auctionHistory = state.auctionHistory.slice(0, 24);
  const humanBids = (round.bids || []).filter((bid) => bid?.playerId && !bid.ai);

  /** @type {Map<string, { wins: any[], losses: any[], spentTotal: number, refundedTotal: number, bidCount: number }>} */
  const reportMap = new Map();
  const touchReport = (playerId) => {
    const id = String(playerId || "");
    if (!id) return null;
    if (!reportMap.has(id)) {
      reportMap.set(id, { wins: [], losses: [], spentTotal: 0, refundedTotal: 0, bidCount: 0 });
    }
    return reportMap.get(id);
  };
  for (const entry of round.entries || []) touchReport(entry.playerId);
  for (const bid of humanBids) {
    const row = touchReport(bid.playerId);
    if (row) row.bidCount += 1;
  }

  for (const result of settled.results) {
    const rough = settled.roughs.find((item) => item.id === result.roughId);
    if (!rough) continue;
    const bidsOnRough = humanBids.filter((bid) => bid.roughId === rough.id);

    if (result.winnerId && !result.ai) {
      const winner = state.players.get(result.winnerId);
      if (winner) {
        consumeAuctionEscrow(winner, rough.id);
        state.roughPool = state.roughPool.filter((item) => item.id !== rough.id);
        const acquiredRough = markInventoryItemNew({
          ...rough,
          type: "rough",
          owner: winner.id,
          costBasis: { amount: money(result.price), complete: true, components: { acquisition: money(result.price) }, componentsComplete: true },
          revealed: false,
          polished: false,
          materialStage: "rough"
        });
        registerFinanceItem(winner, acquiredRough, { acquisition: true, at: now });
        winner.rough.push(acquiredRough);
        advanceTask(winner, "auction_win");
        if (winner.onboarding?.firstSaleAt && !winner.onboarding.completedAt) winner.onboarding.completedAt = now;
        const hall = auctionHallForId(settled.hallId);
        winner.stats ||= {};
        winner.stats.auctionWins = (winner.stats.auctionWins || 0) + 1;
        if (hall?.id === "legendary") winner.stats.legendaryHallWin = true;
        grantPlayerExp(winner, "auction_win", { hallLevel: hall?.requiredLevel || 1 });
        settlePlayerAchievements(winner);
        const winReport = touchReport(winner.id);
        if (winReport) {
          winReport.wins.push({
            roughId: rough.id,
            roughName: rough.name,
            price: money(result.price)
          });
          winReport.spentTotal += money(result.price);
        }
        queueOfflineEvent(winner, {
          type: "auction",
          text: `公盘已拍得${rough.name}，原石已入库。`,
          income: 0,
          expense: result.price,
          readyAt: settled.settledAt
        });
        refreshPlayerReport(winner);
        addNews(`${winner.name} 竞拍中标 ${rough.name}，成交 ${result.price}。`, "trade");
      }
      for (const bid of bidsOnRough) {
        if (bid.playerId === result.winnerId) continue;
        const loser = state.players.get(bid.playerId);
        if (!loser) continue;
        const refunded = refundAuctionEscrow(loser, rough.id, rough.name);
        const lossReport = touchReport(loser.id);
        if (lossReport) {
          lossReport.losses.push({
            roughId: rough.id,
            roughName: rough.name,
            myBid: money(bid.amount),
            winningPrice: money(result.price)
          });
          lossReport.refundedTotal += money(refunded);
        }
      }
      continue;
    }

    for (const bid of bidsOnRough) {
      const bidder = state.players.get(bid.playerId);
      if (!bidder) continue;
      const refunded = refundAuctionEscrow(bidder, rough.id, rough.name);
      const lossReport = touchReport(bidder.id);
      if (lossReport) {
        lossReport.losses.push({
          roughId: rough.id,
          roughName: rough.name,
          myBid: money(bid.amount),
          winningPrice: money(result.price || 0)
        });
        lossReport.refundedTotal += money(refunded);
      }
    }
    if (result.ai) {
      state.roughPool = state.roughPool.filter((item) => item.id !== rough.id);
    }
  }

  refundStaleAuctionEscrows(settled.id);
  deliverAuctionSettleReports(settled, reportMap, {
    money,
    uiMoney,
    isPlayerOnline,
    emitUiEventToPlayer,
    queueOfflineEvent,
    getState,
    afterCommit
  });
  addNews(`${settled.hallLabel || "公盘"}开标完成，新一场已接续。`, "trade");
  createAuctionRound(now, settled.hallId || "novice");
    return { ok: true };
  }, { message: "公盘结算未完成，所有竞拍资产已恢复。" });
  return transaction.ok === true;
}

function deliverAuctionSettleReports(settled, reportMap, deps) {
  const {
    money,
    uiMoney,
    isPlayerOnline,
    emitUiEventToPlayer,
    queueOfflineEvent,
    getState,
    afterCommit
  } = deps;
  const formatMoney = typeof uiMoney === "function" ? uiMoney : (n) => String(money(n));
  for (const [playerId, data] of reportMap.entries()) {
    const player = getState().players.get(playerId);
    if (!player) continue;
    const report = {
      playerId,
      roundId: settled.id,
      hallId: settled.hallId || "novice",
      hallLabel: settled.hallLabel || "公盘",
      settledAt: settled.settledAt,
      wins: data.wins,
      losses: data.losses,
      spentTotal: money(data.spentTotal),
      refundedTotal: money(data.refundedTotal),
      bidCount: data.bidCount
    };
    const showNow = !player.pendingAuctionSettle;
    if (showNow) player.pendingAuctionSettle = report;
    else (player.pendingAuctionSettles ||= []).push(report);
    const modal = buildAuctionSettleModalEvent(report, formatMoney);
    if (showNow && typeof isPlayerOnline === "function" && isPlayerOnline(player) && typeof emitUiEventToPlayer === "function") {
      const emit = () => emitUiEventToPlayer(player, modal);
      if (typeof afterCommit === "function") afterCommit(emit);
      else emit();
    } else if (typeof queueOfflineEvent === "function" && !data.wins.length) {
      // 中标已有逐条 offline 事件；全场零出价补一条摘要
      queueOfflineEvent(player, {
        type: "auction",
        text: data.bidCount > 0
          ? "公盘未拍得料子，竞拍款已退还。"
          : "公盘已结束，本场未提交出价。", income: money(data.refundedTotal),
        expense: 0,
        readyAt: settled.settledAt
      });
    }
  }
}

function ackAuctionSettleForPlayer(player, roundId = "") {
  if (!player?.pendingAuctionSettle) return { ok: true, cleared: false };
  const pendingId = String(player.pendingAuctionSettle.roundId || "");
  if (roundId && pendingId && pendingId !== String(roundId)) {
    return { ok: true, cleared: false };
  }
  player.pendingAuctionSettle = (player.pendingAuctionSettles || []).shift() || null;
  return { ok: true, cleared: true };
}

function processAuctionLifecycle(now = Date.now()) {
  const { getState } = requireApi();
  const state = getState();
  let changed = settleAuctionIfDue(now);
  for (const hall of AUCTION_HALLS) {
    if (!auctionRoundForHall(state, hall.id)) { ensureAuctionRound(now, hall.id); changed = true; }
  }
  if (synchronizeAuctionRoundTimes(now)) changed = true;
  return changed;
}

function enterAuctionForPlayer(player, payload = {}, now = Date.now()) {
  const {
    getState,
    normalizePlayer,
    money,
    spendCash,
    DEFAULT_AUCTION_HALL_ID,
    addNews
  } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  normalizePlayer(player);
  const state = getState();
  const hallId = payload?.hallId || state.auction?.hallId || DEFAULT_AUCTION_HALL_ID;
  if (!AUCTION_HALLS.some((hall) => hall.id === hallId)) return { ok: false, message: "该公盘不存在。" };
  const hall = auctionHallForId(hallId);
  if (playerLevelForExp(player?.exp) < hall.requiredLevel) {
    return { ok: false, message: `需要经营 Lv.${hall.requiredLevel} 才能进入${hall.label}。` };
  }
  const round = ensureAuctionRound(now, hallId);
  if (round.settledAt || now >= auctionEndsAt(round)) return { ok: false, message: "本场拍卖已截止。" };
  const existing = (round.entries || []).find((entry) => entry.playerId === player.id);
  if (existing) return { ok: true, message: "已入场本场公盘。", entryFee: existing.fee, entry: existing };
  const remainMs = auctionEndsAt(round) - now;
  if (remainMs <= 10_000) {
    return { ok: false, message: "本场剩余不足 10 秒，已停止入场。" };
  }
  const entryFee = money(round.entryFee ?? auctionEntryFee(auctionHallForId(round.hallId)));
  if (entryFee > 0 && !spendCash(player, entryFee, `公盘入场费：${round.hallLabel || "公盘"}`, { source: "auctionEntry", itemId: round.id, repEligible: false })) {
    return { ok: false, message: `入场费需要 ${entryFee}。` };
  }
  const next = enterAuctionRound(round, { playerId: player.id, fee: entryFee, at: now });
  storeAuctionRound(state, next.round);
  addNews(`${player.name} 入场${round.hallLabel || "公盘"}。`, "info");
  return { ok: true, message: "入场成功。", entryFee, entry: next.entry };
}

function joinAuctionForPlayer(player, payload = {}, now = Date.now()) {
  return enterAuctionForPlayer(player, payload, now);
}

function auctionRoundForAction(state, payload) {
  if (payload?.hallId) return auctionRoundForHall(state, payload.hallId);
  const roughId = typeof payload === "string" ? payload : payload?.roughId;
  return auctionRoundsForState(state).find((round) => round.roughs?.some((rough) => rough.id === roughId)) || state.auction;
}

function submitAuctionBidForPlayer(player, payload, now = Date.now()) {
  const { getState, normalizePlayer, money, addNews } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  if (!payload || typeof payload !== "object") return { ok: false, message: "投标参数无效。" };
  normalizePlayer(player);
  const state = getState();
  const round = auctionRoundForAction(state, payload);
  if (!round) return { ok: false, message: "该公盘不存在或尚未开场。" };
  if (!round.settledAt && now >= auctionEndsAt(round)) {
    settleAuctionIfDue(now, round.hallId || "novice");
    return { ok: false, message: "本场拍卖已截止，已进入下一场。" };
  }
  if (round.settledAt || now >= auctionEndsAt(round)) {
    return { ok: false, message: "本轮公盘已截止。" };
  }
  if (!playerEnteredAuction(round, player.id)) {
    return { ok: false, message: "请先入场本场公盘。" };
  }
  const roughId = payload.roughId;
  const rough = round.roughs.find((item) => item.id === roughId);
  if (!rough) return { ok: false, message: "这块原石不在当前公盘。" };
  const bidAmount = money(payload.amount);
  if (bidAmount < rough.price) return { ok: false, message: "出价不能低于底价。" };
  const escrowResult = applyAuctionBidEscrow(player, rough, bidAmount, round, now);
  if (!escrowResult.ok) return escrowResult;
  const next = upsertBid(round, {
    playerId: player.id,
    roughId,
    amount: bidAmount,
    at: now
  });
  storeAuctionRound(state, next.round);
  addNews(`${player.name} 提交了 ${rough.name} 的竞价。`, "info");
  return {
    ok: true,
    message: escrowResult.previousAmount > 0 ? "出价已修改，抵押已按差额调整。" : "出价已提交，出价已抵押。", bid: next.bid,
    escrowed: escrowResult.escrowed,
    escrowDelta: escrowResult.delta
  };
}

function normalizeWindowPayload(payload) {
  const { clamp } = requireApi();
  if (payload && typeof payload === "object") {
    return {
      roughId: payload.roughId,
      x: clamp(Number(payload.x) || 50, 18, 82),
      y: clamp(Number(payload.y) || 50, 18, 82)
    };
  }
  return {
    roughId: payload,
    x: Math.round(18 + Math.random() * 64),
    y: Math.round(18 + Math.random() * 64)
  };
}

function windowTouchesColor(visual, x, y) {
  if (!visual?.belt) return false;
  const angle = Number(visual.beltAngle || 18) * Math.PI / 180;
  const dx = (Number(x || 50) - 50) / 50;
  const dy = (Number(y || 50) - 50) / 50;
  const cross = Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle));
  return cross < 0.28;
}

function windowTouchesCrack(visual, x, y) {
  if (!visual?.crack) return false;
  return Math.abs(Number(x || 50) - 50) < 12 && Math.abs(Number(y || 50) - 50) < 28;
}

function makeWindowReveal(rough, point = {}) {
  const { clamp, randomUUID, qualityByKey } = requireApi();
  const visual = rough.visual || {};
  const quality = qualityByKey(rough.trueQualityKey);
  const x = clamp(Number(point.x) || Math.round(18 + Math.random() * 64), 18, 82);
  const y = clamp(Number(point.y) || Math.round(18 + Math.random() * 64), 18, 82);
  return {
    id: randomUUID(),
    x,
    y,
    r: Math.round(9 + Math.random() * 5),
    seed: Math.floor((visual.seed || 1) + Math.random() * 10000),
    skin: visual.skin,
    vein: visual.vein,
    hasBelt: Boolean(windowTouchesColor(visual, x, y) || (visual.belt && Math.random() < 0.28)),
    hasCrack: Boolean(windowTouchesCrack(visual, x, y) || (visual.crack && Math.random() < 0.16)),
    translucency: clamp(visual.translucency ?? quality.score * 0.16, 0.12, 0.92),
    cotton: clamp(visual.cotton ?? 0.4, 0.08, 0.78)
  };
}

function requestAuctionWindowForPlayer(player, payload, now = Date.now()) {
  const {
    getState,
    money,
    spendCash,
    OPEN_WINDOW_RATE,
    addNews
  } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const { roughId, x, y } = normalizeWindowPayload(payload);
  const state = getState();
  const round = auctionRoundForAction(state, payload);
  if (!round) return { ok: false, message: "该公盘不存在或尚未开场。" };
  if (!round.settledAt && now >= auctionEndsAt(round)) {
    settleAuctionIfDue(now, round.hallId || "novice");
    return { ok: false, message: "当前公盘已停止开窗，已进入下一场。" };
  }
  if (round.settledAt || now >= auctionEndsAt(round)) {
    return { ok: false, message: "当前公盘已停止开窗。" };
  }
  if (!playerEnteredAuction(round, player.id)) {
    return { ok: false, message: "请先入场本场公盘。" };
  }
  const rough = round.roughs.find((item) => item.id === roughId);
  if (!rough) return { ok: false, message: "这块原石不在当前公盘。" };
  if (rough.windows && rough.windows.length >= 1) {
    return { ok: false, message: `${rough.name}」每块原石仅可开窗一次，已经开过窗了。` };
  }
  const hall = AUCTION_HALLS.find((h) => h.id === round.hallId) || AUCTION_HALLS[0];
  const fee = auctionWindowFee(rough, {
    ...hall,
    windowRate: hall.windowRate ?? OPEN_WINDOW_RATE
  });
  if (!spendCash(player, fee, `开窗：${rough.name}`, { source: "window", itemId: rough.id })) {
    return { ok: false, message: `开窗费需要 ${fee}。` };
  }
  rough.windows = [...(rough.windows || []), makeWindowReveal(rough, { x, y })].slice(0, 1);
  addNews(`${player.name} 支付 ${fee} 为 ${rough.name} 请求开窗，公盘信息更新。`, "info");
  return { ok: true, message: "开窗完成。", rough };
}

  return {
    AUCTION_HALL_LOT_PROFILES,
    createAuctionHallRoughs,
    normalizeAuctionEscrow,
    auctionEscrowForRough,
    setAuctionEscrow,
    applyAuctionBidEscrow,
    consumeAuctionEscrow,
    refundAuctionEscrow,
    refundStaleAuctionEscrows,
    reconcileAuctionEscrows,
    publicAuctionHalls,
    auctionRoundDuration,
    auctionEndsAt,
    playerEnteredAuction,
    createAuctionRound,
    ensureAuctionRound,
    settleAuctionIfDue,
    ackAuctionSettleForPlayer,
    processAuctionLifecycle,
    enterAuctionForPlayer,
    joinAuctionForPlayer,
    submitAuctionBidForPlayer,
    normalizeWindowPayload,
    windowTouchesColor,
    windowTouchesCrack,
    makeWindowReveal,
    requestAuctionWindowForPlayer
  };
}
