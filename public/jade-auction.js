const DEPOSIT_RATE = 0.2;

export const AUCTION_HALLS = [
  { id: "novice", label: "新手公盘", requiredLevel: 1, windowRate: 0.06, deposit: 5000, entryFee: 5000, tone: "稳健", priceNote: "小料练手" },
  { id: "regular", label: "常规公盘", requiredLevel: 2, windowRate: 0.07, deposit: 8000, entryFee: 8000, tone: "标准", priceNote: "标准场口" },
  { id: "premium", label: "精品公盘", requiredLevel: 3, windowRate: 0.08, deposit: 16000, entryFee: 16000, tone: "冲高", priceNote: "冰种机会" },
  { id: "special", label: "专场公盘", requiredLevel: 4, windowRate: 0.09, deposit: 30000, entryFee: 30000, tone: "高压", priceNote: "大料专场" },
  { id: "legendary", label: "传奇公盘", requiredLevel: 5, windowRate: 0.10, deposit: 60000, entryFee: 60000, tone: "极限", priceNote: "顶级赌性" }
];

// 声望等级体系：用等级（而非累计数值）作为公盘解锁门槛
export const REP_LEVEL_LABELS = {
  1: "新人",
  2: "起势",
  3: "熟行",
  4: "名店",
  5: "宗师"
};

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
    const ratio = 0.6 + (seed % 36) / 100;
    const amount = money((rough.trueValue ?? rough.value ?? rough.price ?? 0) * ratio);
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

export function publicAuctionSnapshot(round, playerId, now = Date.now(), latestResults = []) {
  const phase = auctionPhase(round, now);
  const hall = auctionHallForId(round?.hallId);
  const entries = round?.entries || [];
  const myBids = (round?.bids || []).filter((bid) => bid.playerId === playerId);
  const entered = entries.some((entry) => entry.playerId === playerId);
  return {
    id: round?.id,
    hallId: hall.id,
    hallLabel: round?.hallLabel || hall.label,
    phase,
    startsAt: round?.startsAt,
    endsAt: round?.endsAt ?? round?.biddingEndsAt,
    settledAt: round?.settledAt,
    entryFee: round?.entryFee ?? auctionEntryFee(hall),
    entered,
    registered: entered,
    roughs: entered ? (round?.roughs || []).map((rough) => publicRoughForAuction(
      rough,
      myBids.find((bid) => bid.roughId === rough.id)
    )) : [],
    myBids: myBids.map((bid) => ({
      roughId: bid.roughId,
      amount: bid.amount,
      at: bid.at
    })),
    results: (latestResults.length ? latestResults : phase === "settlement" ? (round?.results || []) : [])
      .map((result) => publicAuctionResult(result, playerId))
  };
}
