const DEPOSIT_RATE = 0.2;

function money(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function stableNumber(input = "") {
  let hash = 0;
  for (const char of String(input)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

export function auctionPhase(round, now = Date.now()) {
  if (!round) return "empty";
  if (now < Number(round.startsAt || 0)) return "preview";
  if (now < Number(round.biddingEndsAt || 0)) return "bidding";
  return "settled";
}

export function bidDeposit(amount) {
  return money(amount * DEPOSIT_RATE);
}

export function upsertBid(round, bid) {
  const amount = money(bid.amount);
  const proxyMax = Math.max(amount, money(bid.proxyMax || amount));
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
    at: Number(bid.at || Date.now()),
    ai: Boolean(bid.ai)
  };
  nextRound.bids.push(nextBid);
  nextRound.bids.sort((a, b) => a.at - b.at);
  return {
    round: nextRound,
    depositDelta: bidDeposit(amount) - bidDeposit(previous?.amount || 0),
    bid: nextBid
  };
}

export function aiBidsForRough(rough, existingBids = [], minBidderCount = 3) {
  const current = existingBids.filter((bid) => bid.roughId === rough.id).length;
  const needed = Math.max(0, minBidderCount - current);
  return Array.from({ length: needed }, (_, index) => {
    const seed = stableNumber(`${rough.id}-${index}`);
    const ratio = 0.6 + (seed % 36) / 100;
    const amount = money((rough.trueValue || rough.value || rough.price) * ratio);
    return {
      playerId: `ai-${rough.id}-${index}`,
      roughId: rough.id,
      amount,
      proxyMax: amount,
      at: Number(rough.createdAt || 0) + index + 1,
      ai: true
    };
  });
}

export function settleAuctionRound(round, options = {}) {
  const minIncrement = money(options.minIncrement || 100);
  const results = (round.roughs || []).map((rough) => {
    const bids = (round.bids || []).filter((bid) => bid.roughId === rough.id).sort((a, b) => {
      const maxDiff = (b.proxyMax || b.amount) - (a.proxyMax || a.amount);
      return maxDiff || a.at - b.at;
    });
    if (!bids.length) {
      return { roughId: rough.id, status: "passed", price: 0, bids: 0 };
    }
    const winner = bids[0];
    const runnerUp = bids[1];
    const floor = Math.max(rough.price || 0, winner.amount || 0);
    const justWin = runnerUp ? (runnerUp.proxyMax || runnerUp.amount) + minIncrement : floor;
    const price = money(Math.min(winner.proxyMax || winner.amount, Math.max(floor, justWin)));
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
  return { ...round, status: "settled", settledAt: options.now || Date.now(), results };
}

export function publicAuctionSnapshot(round, playerId, now = Date.now()) {
  const phase = auctionPhase(round, now);
  return {
    id: round?.id,
    phase,
    startsAt: round?.startsAt,
    biddingEndsAt: round?.biddingEndsAt,
    roughs: (round?.roughs || []).map((rough) => ({
      id: rough.id,
      name: rough.name,
      price: rough.price,
      deposit: bidDeposit(rough.price),
      mass: rough.mass,
      hint: rough.hint,
      risk: rough.risk,
      expertClues: rough.expertClues,
      windows: rough.windows,
      visual: rough.visual
    })),
    myBids: (round?.bids || [])
      .filter((bid) => bid.playerId === playerId)
      .map((bid) => ({
        roughId: bid.roughId,
        amount: bid.amount,
        proxyMax: bid.proxyMax,
        deposit: bidDeposit(bid.amount),
        at: bid.at
      })),
    results: phase === "settled" ? (round?.results || []).filter((result) => result.winnerId === playerId || !result.winnerId) : []
  };
}
