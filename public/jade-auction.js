const DEPOSIT_RATE = 0.2;

export const AUCTION_HALLS = [
  { id: "novice", label: "新手公盘", requiredRep: 0, deposit: 5000, tone: "稳健", priceNote: "小料练手" },
  { id: "regular", label: "常规公盘", requiredRep: 30, deposit: 8000, tone: "标准", priceNote: "标准场口" },
  { id: "premium", label: "精品公盘", requiredRep: 80, deposit: 16000, tone: "冲高", priceNote: "冰种机会" },
  { id: "special", label: "专场公盘", requiredRep: 160, deposit: 30000, tone: "高压", priceNote: "大料专场" },
  { id: "legendary", label: "传奇公盘", requiredRep: 320, deposit: 60000, tone: "极限", priceNote: "顶级赌性" }
];

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
  const proxyMax = Math.max(amount, money(bid.proxyMax ?? amount));
  return {
    ...bid,
    amount,
    proxyMax,
    at: settlementTime(bid.at)
  };
}

function publicAuctionResult(result, playerId) {
  const safe = {};
  for (const field of ["roughId", "status", "price", "depositUsed", "balanceDue", "bids", "ai"]) {
    if (result[field] !== undefined) safe[field] = result[field];
  }
  if (result.winnerId === playerId) safe.winnerId = result.winnerId;
  return safe;
}

export function auctionHallForId(hallId = "novice") {
  return AUCTION_HALLS.find((hall) => hall.id === hallId) || AUCTION_HALLS[0];
}

function publicRoughForAuction(rough) {
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
    deposit: bidDeposit(rough.price),
    mass: rough.mass,
    hint: rough.publicHint,
    risk: rough.risk,
    expertClues: rough.expertClues,
    windows,
    visual: publicVisual
  };
}

export function auctionPhase(round, now = Date.now()) {
  if (!round) return "empty";
  if (round.settledAt || round.status === "settled") return "settlement";
  if (now < Number(round.startsAt ?? 0)) return "registration";
  if (now < Number(round.biddingEndsAt ?? 0)) return "bidding";
  return "settlement";
}

export function bidDeposit(amount) {
  return money(amount * DEPOSIT_RATE);
}

function bidExposureAmount(bid = {}) {
  const safeBid = bid && typeof bid === "object" ? bid : {};
  const amount = money(safeBid.amount);
  return Math.max(amount, money(safeBid.proxyMax ?? amount));
}

export function upsertBid(round, bid) {
  const amount = money(bid.amount);
  const proxyMax = bidExposureAmount({ amount, proxyMax: bid.proxyMax });
  const atFallback = Date.now();
  const nextRound = {
    ...round,
    bids: (round.bids || []).filter((item) => !(item.playerId === bid.playerId && item.roughId === bid.roughId))
  };
  const previous = (round.bids || []).find((item) => item.playerId === bid.playerId && item.roughId === bid.roughId);
  const nextBid = {
    playerId: bid.playerId,
    roughId: bid.roughId,
    amount,
    proxyMax,
    at: finiteNumber(bid.at ?? atFallback, atFallback),
    ai: Boolean(bid.ai)
  };
  nextRound.bids.push(nextBid);
  nextRound.bids.sort((a, b) => a.at - b.at);
  return {
    round: nextRound,
    depositDelta: bidDeposit(proxyMax) - bidDeposit(previous ? bidExposureAmount(previous) : 0),
    bid: nextBid
  };
}

export function registerAuctionBidder(round, registration = {}) {
  const playerId = registration.playerId;
  if (!round || !playerId) return { round, registration: null, already: false };
  const existing = (round.registrations || []).find((item) => item.playerId === playerId);
  if (existing) return { round, registration: existing, already: true };
  const nextRegistration = {
    playerId,
    deposit: money(registration.deposit),
    at: finiteNumber(registration.at ?? Date.now(), Date.now())
  };
  return {
    round: {
      ...round,
      registrations: [...(round.registrations || []), nextRegistration]
    },
    registration: nextRegistration,
    already: false
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
      proxyMax: amount,
      at: Number(rough.createdAt ?? 0) + aiIndex + 1,
      ai: true
    };
  });
}

export function settleAuctionRound(round, options = {}) {
  const minIncrement = money(options.minIncrement ?? 100);
  const results = (round.roughs || []).map((rough) => {
    const reserve = money(rough.price ?? 0);
    const bids = (round.bids || [])
      .map((bid) => settlementBidForRough(bid, rough.id))
      .filter((bid) => bid && bid.proxyMax >= reserve)
      .sort((a, b) => {
      const maxDiff = b.proxyMax - a.proxyMax;
      return maxDiff || a.at - b.at;
    });
    if (!bids.length) {
      return { roughId: rough.id, status: "passed", price: 0, bids: 0 };
    }
    const winner = bids[0];
    const runnerUp = bids[1];
    const floor = Math.max(reserve, winner.amount);
    const justWin = runnerUp ? runnerUp.proxyMax + minIncrement : floor;
    const price = money(Math.max(floor, Math.min(winner.proxyMax, Math.max(floor, justWin))));
    const depositUsed = Math.min(price, bidDeposit(winner.proxyMax));
    return {
      roughId: rough.id,
      winnerId: winner.playerId,
      ai: Boolean(winner.ai),
      status: winner.ai ? "aiWon" : "won",
      price,
      depositUsed,
      balanceDue: Math.max(0, price - depositUsed),
      bids: bids.length
    };
  });
  return { ...round, status: "settled", settledAt: options.now ?? Date.now(), results };
}

export function publicAuctionSnapshot(round, playerId, now = Date.now()) {
  const phase = auctionPhase(round, now);
  const hall = auctionHallForId(round?.hallId);
  const registrations = round?.registrations || [];
  return {
    id: round?.id,
    hallId: hall.id,
    hallLabel: round?.hallLabel || hall.label,
    phase,
    registrationStartsAt: round?.registrationStartsAt,
    startsAt: round?.startsAt,
    biddingEndsAt: round?.biddingEndsAt,
    settledAt: round?.settledAt,
    settlementEndsAt: round?.settlementEndsAt,
    registrationDeposit: round?.registrationDeposit ?? hall.deposit,
    registered: registrations.some((registration) => registration.playerId === playerId),
    registeredCount: registrations.length,
    roughs: (round?.roughs || []).map(publicRoughForAuction),
    myBids: (round?.bids || [])
      .filter((bid) => bid.playerId === playerId)
      .map((bid) => ({
        roughId: bid.roughId,
        amount: bid.amount,
        proxyMax: bid.proxyMax,
        deposit: bidDeposit(bidExposureAmount(bid)),
        at: bid.at
      })),
    results: phase === "settlement"
      ? (round?.results || [])
        .map((result) => publicAuctionResult(result, playerId))
      : []
  };
}
