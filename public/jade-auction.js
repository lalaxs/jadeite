const DEPOSIT_RATE = 0.2;

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
  if (now < Number(round.startsAt ?? 0)) return "preview";
  if (now < Number(round.biddingEndsAt ?? 0)) return "bidding";
  return "settled";
}

export function bidDeposit(amount) {
  return money(amount * DEPOSIT_RATE);
}

export function upsertBid(round, bid) {
  const amount = money(bid.amount);
  const proxyMax = Math.max(amount, money(bid.proxyMax ?? amount));
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
    depositDelta: bidDeposit(amount) - bidDeposit(previous?.amount ?? 0),
    bid: nextBid
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
    const bids = (round.bids || []).map((bid) => settlementBidForRough(bid, rough.id)).filter(Boolean).sort((a, b) => {
      const maxDiff = b.proxyMax - a.proxyMax;
      return maxDiff || a.at - b.at;
    });
    if (!bids.length) {
      return { roughId: rough.id, status: "passed", price: 0, bids: 0 };
    }
    const winner = bids[0];
    const runnerUp = bids[1];
    const floor = Math.max(money(rough.price ?? 0), winner.amount);
    const justWin = runnerUp ? runnerUp.proxyMax + minIncrement : floor;
    const price = money(Math.max(floor, Math.min(winner.proxyMax, Math.max(floor, justWin))));
    const depositUsed = bidDeposit(winner.amount);
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
  return {
    id: round?.id,
    phase,
    startsAt: round?.startsAt,
    biddingEndsAt: round?.biddingEndsAt,
    roughs: (round?.roughs || []).map(publicRoughForAuction),
    myBids: (round?.bids || [])
      .filter((bid) => bid.playerId === playerId)
      .map((bid) => ({
        roughId: bid.roughId,
        amount: bid.amount,
        proxyMax: bid.proxyMax,
        deposit: bidDeposit(bid.amount),
        at: bid.at
      })),
    results: phase === "settled"
      ? (round?.results || [])
        .filter((result) => result.winnerId === playerId || result.status === "passed")
        .map((result) => publicAuctionResult(result, playerId))
      : []
  };
}
