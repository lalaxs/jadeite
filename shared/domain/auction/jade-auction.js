const DEPOSIT_RATE = 0.2;
export const AUCTION_SEALED_DURATION_MS = 2 * 60 * 1000;

export function auctionSealedStartsAt(round) {
  const endsAt = Number(round?.endsAt ?? round?.biddingEndsAt ?? 0);
  const duration = Math.max(0, endsAt - Number(round?.startsAt ?? endsAt - 600_000));
  // 加速测试场次按 8:2 缩放；正常十分钟场次最后两分钟密封。
  return endsAt - Math.min(AUCTION_SEALED_DURATION_MS, duration / 5);
}

export function auctionBidPhase(round, now = Date.now()) {
  if (!round || auctionPhase(round, now) !== "live") return "settlement";
  return now < auctionSealedStartsAt(round) ? "open" : "sealed";
}

export const AUCTION_HALLS = [
  { id: "novice", label: "新手公盘", requiredLevel: 1, windowRate: 0.03, windowMin: 100, deposit: 200, entryFee: 200, tone: "稳健", priceNote: "小料练手" },
  { id: "regular", label: "常规公盘", requiredLevel: 2, windowRate: 0.04, windowMin: 150, deposit: 1200, entryFee: 1200, tone: "标准", priceNote: "标准场口" },
  { id: "premium", label: "精品公盘", requiredLevel: 3, windowRate: 0.05, windowMin: 250, deposit: 1800, entryFee: 1800, tone: "冲高", priceNote: "正冰机会" },
  { id: "special", label: "专场公盘", requiredLevel: 4, windowRate: 0.06, windowMin: 400, deposit: 2800, entryFee: 2800, tone: "高压", priceNote: "大料专场" },
  { id: "legendary", label: "传奇公盘", requiredLevel: 5, windowRate: 0.07, windowMin: 600, deposit: 4000, entryFee: 4000, tone: "极限", priceNote: "顶级赌性" }
];

export const AUCTION_AI_TUNING = Object.freeze({
  minCompetitionRatio: 0.88,
  maxCompetitionRatio: 1.36,
  valueFloorRatio: 0.96,
  valueSlope: 0.45,
  valueCapRatio: 1.42
});

// 经营等级用于公盘解锁；声望(rep)仅作口碑，不再驱动厅门。
export const REP_LEVEL_LABELS = {
  1: "新人",
  2: "起势",
  3: "熟行",
  4: "名店",
  5: "宗师"
};

/** @deprecated 公盘解锁请用 player-progression 的经营等级；保留供旧口碑称号对照 */
export function repLevelForRep(rep) {
  if (rep >= 320) return 5;
  if (rep >= 160) return 4;
  if (rep >= 80) return 3;
  if (rep >= 30) return 2;
  return 1;
}

function money(value) {
  const amount = Number(value);
  return Math.max(0, Math.round(Number.isFinite(amount) ? amount : 0));
}

function stableNumber(input = "") {
  let hash = 0;
  for (const char of String(input)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function settlementTime(value) {
  return value == null ? Number.MAX_SAFE_INTEGER : finiteNumber(value, Number.MAX_SAFE_INTEGER);
}

function nextAiIndexForRough(rough, roughBids) {
  const prefix = `ai-${rough.id}-`;
  return roughBids.reduce((nextIndex, bid) => {
    if (!bid.ai || typeof bid.playerId !== "string" || !bid.playerId.startsWith(prefix)) return nextIndex;
    const suffix = Number(bid.playerId.slice(prefix.length));
    return Number.isInteger(suffix) && suffix >= 0 ? Math.max(nextIndex, suffix + 1) : nextIndex;
  }, 0);
}

function publicWindowReveal(win = {}) {
  const safe = {};
  for (const field of ["id", "x", "y", "r", "seed", "skin", "vein", "hasBelt", "hasCrack"]) {
    if (win[field] !== undefined) safe[field] = win[field];
  }
  return safe;
}

function settlementBidForRough(bid, roughId) {
  if (!bid?.playerId || bid?.roughId !== roughId) return null;
  const rawAmount = Number(bid.amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) return null;
  const amount = money(rawAmount);
  if (amount <= 0) return null;
  return {
    ...bid,
    amount,
    at: settlementTime(bid.at)
  };
}

export function publicAuctionResult(result, playerId) {
  const safe = {};
  for (const field of ["roughId", "roughName", "status", "price", "bids", "ai", "skippedBids"]) {
    if (result[field] !== undefined) safe[field] = result[field];
  }
  if (result.winnerId === playerId) safe.winnerId = result.winnerId;
  return safe;
}

export function publicAuctionHistoryEntry(entry = {}, playerId) {
  const hall = auctionHallForId(entry.hallId);
  return {
    id: entry.id || entry.roundId,
    roundId: entry.roundId || entry.id,
    hallId: entry.hallId || hall.id,
    hallLabel: entry.hallLabel || hall.label,
    startsAt: entry.startsAt,
    endsAt: entry.endsAt,
    settledAt: entry.settledAt,
    results: (entry.results || []).map((result) => publicAuctionResult(result, playerId))
  };
}

export function auctionHallForId(hallId = "novice") {
  return AUCTION_HALLS.find((hall) => hall.id === hallId) || AUCTION_HALLS[0];
}

export function auctionEntryFee(hallOrAmount = 0) {
  if (typeof hallOrAmount === "number") return money(hallOrAmount);
  return money(hallOrAmount.entryFee ?? hallOrAmount.deposit ?? 0);
}

export function auctionWindowFee(roughOrPrice = 0, hallOrId = "novice") {
  const hall = typeof hallOrId === "string" ? auctionHallForId(hallOrId) : hallOrId;
  const price = typeof roughOrPrice === "number" ? roughOrPrice : roughOrPrice?.price;
  return money(Math.max(
    Number(hall?.windowMin || 0),
    finiteNumber(price) * finiteNumber(hall?.windowRate, AUCTION_HALLS[0].windowRate)
  ));
}

export function bidIncrementOptions(currentAmount) {
  const amount = money(currentAmount);
  if (amount < 1000) return [50, 100, 200];
  if (amount < 10000) return [100, 500, 1000];
  if (amount < 100000) return [1000, 2000, 5000];
  return [5000, 10000, 20000];
}

function publicRoughForAuction(rough, myBid) {
  const visual = rough.visual || {};
  const rawWindows = rough.windows ?? visual.windows;
  const windows = Array.isArray(rawWindows) ? rawWindows.map(publicWindowReveal) : undefined;
  const publicVisual = {
    masked: true
  };
  if (visual.seed !== undefined) publicVisual.seed = visual.seed;
  if (visual.shape !== undefined) publicVisual.shape = visual.shape;
  if (visual.maskTone !== undefined) publicVisual.maskTone = visual.maskTone;
  if (windows !== undefined) publicVisual.windows = windows;
  return {
    id: rough.id,
    name: rough.name,
    price: rough.price,
    mass: rough.mass,
    hint: rough.publicHint,
    risk: rough.risk,
    expertClues: rough.expertClues,
    windows,
    bidIncrements: bidIncrementOptions(myBid?.amount ?? rough.price),
    visual: publicVisual
  };
}

export function auctionPhase(round, now = Date.now()) {
  if (!round) return "empty";
  if (round.settledAt || round.status === "settled") return "settlement";
  const endsAt = Number(round.endsAt ?? round.biddingEndsAt ?? 0);
  if (!endsAt || now < endsAt) return "live";
  return "settlement";
}

export function bidDeposit(amount) {
  return money(amount * DEPOSIT_RATE);
}

export function enterAuctionRound(round, entry = {}) {
  const playerId = entry.playerId;
  if (!round || !playerId) return { round, entry: null, already: false };
  const existing = (round.entries || []).find((item) => item.playerId === playerId);
  if (existing) return { round, entry: existing, already: true };
  const nextEntry = {
    playerId,
    fee: money(entry.fee),
    at: finiteNumber(entry.at ?? Date.now(), Date.now())
  };
  return {
    round: {
      ...round,
      entries: [...(round.entries || []), nextEntry]
    },
    entry: nextEntry,
    already: false
  };
}

export function registerAuctionBidder(round, registration = {}) {
  const result = enterAuctionRound(round, {
    playerId: registration.playerId,
    fee: registration.deposit ?? registration.fee,
    at: registration.at
  });
  return {
    round: result.round,
    registration: result.entry ? { playerId: result.entry.playerId, deposit: result.entry.fee, at: result.entry.at } : null,
    already: result.already
  };
}

export function upsertBid(round, bid) {
  const amount = money(bid.amount);
  const atFallback = Date.now();
  const previous = (round.bids || []).find((item) => item.playerId === bid.playerId && item.roughId === bid.roughId);
  const nextRound = {
    ...round,
    bids: (round.bids || []).filter((item) => !(item.playerId === bid.playerId && item.roughId === bid.roughId))
  };
  const nextBid = {
    playerId: bid.playerId,
    roughId: bid.roughId,
    amount,
    at: finiteNumber(bid.at ?? atFallback, atFallback),
    ai: Boolean(bid.ai)
  };
  nextRound.bids.push(nextBid);
  nextRound.bids.sort((a, b) => a.at - b.at);
  return {
    round: nextRound,
    previous,
    bid: nextBid,
    depositDelta: 0
  };
}

export function aiBidsForRough(rough, existingBids = [], minBidderCount = 3) {
  const roughBids = existingBids.filter((bid) => bid.roughId === rough.id);
  const current = roughBids.length;
  const aiStartIndex = nextAiIndexForRough(rough, roughBids);
  const needed = Math.max(0, minBidderCount - current);
  return Array.from({ length: needed }, (_, index) => {
    const aiIndex = aiStartIndex + index;
    const seed = stableNumber(`${rough.id}-${aiIndex}`);
    const reserve = money(rough.price ?? 0);
    const hiddenValue = money(rough.trueValue ?? rough.value ?? reserve);
    const valueRatio = reserve > 0 ? hiddenValue / reserve : 1;
    const valueCeiling = Math.min(
      AUCTION_AI_TUNING.valueCapRatio,
      Math.max(
        AUCTION_AI_TUNING.valueFloorRatio,
        AUCTION_AI_TUNING.valueFloorRatio + (valueRatio - 1) * AUCTION_AI_TUNING.valueSlope
      )
    );
    const competitionSteps = Math.round(
      (AUCTION_AI_TUNING.maxCompetitionRatio - AUCTION_AI_TUNING.minCompetitionRatio) * 100
    );
    const competitionRatio = AUCTION_AI_TUNING.minCompetitionRatio
      + (seed % (competitionSteps + 1)) / 100;
    const amount = money(reserve * Math.min(valueCeiling, competitionRatio));
    return {
      playerId: `ai-${rough.id}-${aiIndex}`,
      roughId: rough.id,
      amount,
      at: Number(rough.createdAt ?? 0) + aiIndex + 1,
      ai: true
    };
  });
}

function rankedBidsForRough(round, rough) {
  const reserve = money(rough.price ?? 0);
  return (round.bids || [])
    .map((bid) => settlementBidForRough(bid, rough.id))
    .filter((bid) => bid && bid.amount >= reserve)
    .sort((a, b) => {
      const amountDiff = b.amount - a.amount;
      return amountDiff || a.at - b.at;
    });
}

export function settleAuctionRound(round, options = {}) {
  const bidderCanPay = typeof options.bidderCanPay === "function" ? options.bidderCanPay : () => true;
  const results = (round.roughs || []).map((rough) => {
    const bids = rankedBidsForRough(round, rough);
    let skippedBids = 0;
    const winner = bids.find((bid) => {
      const canPay = Boolean(bid.ai || bidderCanPay(bid, rough));
      if (!canPay) skippedBids += 1;
      return canPay;
    });
    if (!winner) {
      return { roughId: rough.id, roughName: rough.name, status: "passed", price: 0, bids: bids.length, skippedBids };
    }
    const price = money(winner.amount);
    return {
      roughId: rough.id,
      roughName: rough.name,
      winnerId: winner.playerId,
      ai: Boolean(winner.ai),
      status: winner.ai ? "aiWon" : "won",
      price,
      bids: bids.length,
      skippedBids
    };
  });
  return { ...round, status: "settled", settledAt: options.now ?? Date.now(), results };
}

/**
 * Build a game-modal ui:event from a per-player auction settle report.
 * formatMoneyFn(amount) -> display string (e.g. ¥1,200).
 */
export function buildAuctionSettleModalEvent(report, formatMoneyFn = (n) => String(n)) {
  const fmt = typeof formatMoneyFn === "function" ? formatMoneyFn : (n) => String(n);
  const roundId = String(report?.roundId || "");
  const playerId = String(report?.playerId || "");
  const id = `auction-settle:${playerId}:${roundId}`;
  const wins = Array.isArray(report?.wins) ? report.wins : [];
  const losses = Array.isArray(report?.losses) ? report.losses : [];
  const bidCount = Math.max(0, Math.round(Number(report?.bidCount) || 0));
  const hallLabel = String(report?.hallLabel || "公盘");
  const hallId = (AUCTION_HALLS.find((hall) => (
    hall.id === String(report?.hallId || "") || hall.label === hallLabel
  )) || AUCTION_HALLS[0]).id;
  const winNames = wins.map((w) => w.roughName || w.roughId).filter(Boolean);

  if (wins.length) {
    const body = [
      `您已拍得：${winNames.join("、")}`
    ];
    const lines = losses.slice(0, 8).map((row) => {
      const name = row.roughName || row.roughId || "料子";
      const myBid = money(row.myBid);
      const winPrice = money(row.winningPrice);
      if (winPrice > 0) return `${name}：您出价 ${fmt(myBid)} · 成交 ${fmt(winPrice)}`;
      return `${name}：您出价 ${fmt(myBid)} · 流拍`;
    });
    if (losses.length) body.push("未拍成功：");
    return {
      id,
      type: "modal",
      tone: "success",
      modalClass: `auction-settle-modal auction-settle-modal--${hallId} is-win`,
      title: "公盘已结束",
      subtitle: `${hallLabel} · 本场开标`,
      body,
      lines,
      stats: [
        { label: "拍得", value: `${wins.length} 件` }
      ],
      confirmText: "知道了",
      actions: [
        { label: "知道了", clientAction: "ackAuctionSettle" },
        { label: "去库存", clientAction: "openInventoryAfterAuction", variant: "secondary" }
      ],
      report
    };
  }

  const body = bidCount > 0
    ? [
      "您未拍得料子。",
      "未中标的竞拍款已退还。"
    ]
    : [
      "您未拍得料子。",
      "本场未提交出价，无冻结款需退还。"
    ];
  const lines = losses.slice(0, 8).map((row) => {
    const name = row.roughName || row.roughId || "料子";
    const myBid = money(row.myBid);
    const winPrice = money(row.winningPrice);
    if (winPrice > 0) return `${name}：您出价 ${fmt(myBid)} · 成交 ${fmt(winPrice)}`;
    return `${name}：您出价 ${fmt(myBid)} · 流拍`;
  });
  return {
    id,
    type: "modal",
    tone: "info",
    modalClass: `auction-settle-modal auction-settle-modal--${hallId} is-empty`,
    title: "公盘已结束",
    subtitle: `${hallLabel} · 本场开标`,
    body,
    lines,
    stats: [
      { label: "拍得", value: "0 件" }
    ],
    confirmText: "知道了",
    actions: [
      { label: "知道了", clientAction: "ackAuctionSettle" }
    ],
    report
  };
}

export function publicAuctionSnapshot(round, playerId, now = Date.now(), latestResults = []) {
  const phase = auctionPhase(round, now);
  const bidPhase = auctionBidPhase(round, now);
  const hall = auctionHallForId(round?.hallId);
  const entries = round?.entries || [];
  const myBids = (round?.bids || []).filter((bid) => bid.playerId === playerId);
  const entered = entries.some((entry) => entry.playerId === playerId);
  return {
    id: round?.id,
    hallId: hall.id,
    hallLabel: round?.hallLabel || hall.label,
    phase,
    bidPhase,
    sealedStartsAt: auctionSealedStartsAt(round),
    startsAt: round?.startsAt,
    endsAt: round?.endsAt ?? round?.biddingEndsAt,
    settledAt: round?.settledAt,
    entryFee: round?.entryFee ?? auctionEntryFee(hall),
    entered,
    registered: entered,
    roughs: entered ? (round?.roughs || []).map((rough) => {
      const safe = publicRoughForAuction(rough, myBids.find((bid) => bid.roughId === rough.id));
      if (bidPhase === "open") {
        const amounts = (round?.bids || [])
          .filter((bid) => bid.playerId !== playerId && Number(bid.at || 0) <= now)
          .map((bid) => settlementBidForRough(bid, rough.id))
          .filter((bid) => bid && bid.amount >= money(rough.price))
          .map((bid) => bid.amount);
        safe.highestOtherBid = amounts.length ? Math.max(...amounts) : null;
      }
      return safe;
    }) : [],
    myBids: myBids.map((bid) => ({
      roughId: bid.roughId,
      amount: bid.amount,
      escrowed: money(bid.amount),
      at: bid.at
    })),
    results: (latestResults.length ? latestResults : phase === "settlement" ? (round?.results || []) : [])
      .map((result) => publicAuctionResult(result, playerId))
  };
}
