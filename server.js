import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { productMatchesOrder } from "./public/jade-rules.js";
import {
  resolveTiming,
  productionDuration,
  ledgerEntry,
  repFromCashFlow,
  makeOfflineSummary,
  livestreamOutcome,
  reportSummary
} from "./public/jade-loop.js";
import {
  publicAuctionSnapshot,
  bidDeposit,
  upsertBid,
  aiBidsForRough,
  settleAuctionRound
} from "./public/jade-auction.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const PORT = process.env.PORT || 3000;
const OPEN_WINDOW_RATE = 0.06;
const TIMING_PROFILE = process.env.JADE_TIMING_PROFILE || "normal";
const TIMING = resolveTiming(TIMING_PROFILE);

app.use(express.static(path.join(__dirname, "public")));

const qualities = [
  { key: "bean", name: "豆种", score: 1, color: "灰绿", rep: 1, value: 0.75 },
  { key: "glutinous", name: "糯种", score: 2, color: "青白", rep: 4, value: 1.1 },
  { key: "icy", name: "冰种", score: 3, color: "晴水", rep: 18, value: 2.1 },
  { key: "glass", name: "玻璃种", score: 4, color: "阳绿", rep: 55, value: 4.4 },
  { key: "imperial", name: "玻璃种帝王绿", score: 5, color: "帝王绿", rep: 160, value: 9.5 }
];

const npcProfiles = [
  { name: "普通市民", minRep: 0, minScore: 1, quantity: 1, pay: 2100, rep: 4, taste: "价格实在", acceptedKinds: ["bracelet", "peacePendant", "leafPendant"], preferredKinds: ["peacePendant"], tasteTags: ["budget"] },
  { name: "富商太太", minRep: 35, minScore: 3, quantity: 1, pay: 7600, rep: 18, taste: "种水好、颜色正", acceptedKinds: ["bracelet", "ruyiPendant"], preferredKinds: ["bracelet"], tasteTags: ["color", "gift"] },
  { name: "收藏家", minRep: 100, minScore: 4, quantity: 1, pay: 18800, rep: 42, taste: "要稀有高货", acceptedKinds: ["bracelet", "cabochon"], preferredKinds: ["bracelet"], tasteTags: ["highGrade"] },
  { name: "珠宝商", minRep: 65, minScore: 2, quantity: 2, pay: 9800, rep: 22, taste: "稳定批量供货", acceptedKinds: ["bracelet", "cabochon", "peacePendant", "ruyiPendant", "leafPendant"], preferredKinds: ["cabochon", "leafPendant"], tasteTags: ["batch"] }
];

const state = {
  players: new Map(),
  sockets: new Map(),
  roughPool: [],
  listings: [],
  news: [],
  auction: null
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function money(value) {
  const amount = Number(value);
  return Math.max(0, Math.round(Number.isFinite(amount) ? amount : 0));
}

function recordLedger(player, kind, amount, note, meta = {}) {
  player.ledger ||= [];
  const entry = ledgerEntry(kind, amount, note, meta);
  player.ledger.unshift(entry);
  player.ledger = player.ledger.slice(0, 200);
  if (meta.repEligible !== false) {
    const repSource = entry.kind === "expense" ? "expense" : entry.source;
    const repGain = repFromCashFlow(repSource, Math.abs(entry.amount));
    if (repGain) player.rep += repGain;
  }
  refreshPlayerReport(player);
  return entry;
}

function spendCash(player, amount, note, meta = {}) {
  const cost = money(amount);
  if (player.cash < cost) return false;
  player.cash -= cost;
  recordLedger(player, "expense", cost, note, meta);
  return true;
}

function earnCash(player, amount, note, meta = {}) {
  const income = money(amount);
  player.cash += income;
  recordLedger(player, "income", income, note, meta);
  return income;
}

function holdDeposit(player, amount, note, meta = {}) {
  const cost = money(amount);
  if (player.cash < cost) return false;
  player.cash -= cost;
  recordLedger(player, "expense", cost, note, { ...meta, source: meta.source || "auctionDeposit", repEligible: false });
  return true;
}

function releaseDeposit(player, amount, note, meta = {}) {
  const income = money(amount);
  player.cash += income;
  recordLedger(player, "income", income, note, { ...meta, source: meta.source || "auctionRefund", repEligible: false });
  return income;
}

function publicPlayer(player) {
  normalizePlayer(player);
  return {
    id: player.id,
    name: player.name,
    cash: player.cash,
    rep: Math.round(player.rep),
    satisfaction: Math.round(player.satisfaction),
    collectionPower: player.collection.reduce((sum, item) => sum + item.rep, 0),
    inventoryCount: player.rough.length + player.jobs.length + player.polishingJobs.length + player.livestreamJobs.length + player.materials.length + player.slices.length + player.bracelets.length,
    collectionCount: player.collection.length
  };
}

function publicWindowReveal(win = {}) {
  const safe = {};
  for (const field of ["id", "x", "y", "r", "seed", "skin", "vein", "hasBelt", "hasCrack"]) {
    if (win[field] !== undefined) safe[field] = win[field];
  }
  return safe;
}

function publicSourceVisual(visual = {}) {
  const safe = {};
  for (const field of ["seed", "shape", "skin", "vein", "belt", "beltAngle", "crack", "crackAngle", "grain"]) {
    if (visual[field] !== undefined) safe[field] = visual[field];
  }
  return safe;
}

function publicSourceMaterial(sourceMaterial = {}) {
  if (!sourceMaterial || typeof sourceMaterial !== "object") return sourceMaterial;
  const safe = {};
  for (const field of ["roughId", "roughName", "placement", "templateSize", "mass", "qualityKey", "color"]) {
    if (sourceMaterial[field] !== undefined) safe[field] = sourceMaterial[field];
  }
  if (Array.isArray(sourceMaterial.windows)) safe.windows = sourceMaterial.windows.map(publicWindowReveal);
  if (sourceMaterial.visual && typeof sourceMaterial.visual === "object") safe.visual = publicSourceVisual(sourceMaterial.visual);
  return safe;
}

function publicStone(item) {
  if (!item || typeof item !== "object") return item;
  const { trueQualityKey, trueValue, visual, ...safeItem } = item;
  if (Array.isArray(safeItem.windows)) safeItem.windows = safeItem.windows.map(publicWindowReveal);
  if (safeItem.sourceMaterial) safeItem.sourceMaterial = publicSourceMaterial(safeItem.sourceMaterial);
  const isRough = item.type === "rough" || Boolean(item.trueQualityKey);
  if (isRough && !item.revealed) {
    const rawWindows = item.windows ?? visual?.windows;
    const windows = Array.isArray(rawWindows) ? rawWindows.map(publicWindowReveal) : [];
    safeItem.windows = windows;
    safeItem.hint = item.publicHint || `${item.name} · 只见皮壳轮廓`;
    safeItem.visual = {
      seed: visual?.seed,
      shape: visual?.shape,
      masked: true,
      maskTone: visual?.skinRoughness > 0.72 ? "#343936" : "#5b5f59",
      windows
    };
    return safeItem;
  }
  if (visual) {
    const { bestAngle, ...safeVisual } = visual;
    if (Array.isArray(safeVisual.windows)) safeVisual.windows = safeVisual.windows.map(publicWindowReveal);
    safeItem.visual = safeVisual;
  }
  return safeItem;
}

function publicListing(listing) {
  return {
    ...listing,
    item: publicStone(listing.item)
  };
}

function publicProductionJob(job) {
  const { item, rough, ...safeJob } = job;
  if (item) safeJob.item = publicStone(item);
  if (rough) safeJob.rough = publicStone(rough);
  return safeJob;
}

function publicLivestreamJob(job) {
  const { product, ...safeJob } = job;
  if (product) safeJob.product = publicStone(product);
  return safeJob;
}

function privatePlayerSnapshot(player) {
  normalizePlayer(player);
  refreshPlayerReport(player);
  return {
    ...player,
    jobs: player.jobs.map(publicProductionJob),
    rough: player.rough.map(publicStone),
    polishingJobs: player.polishingJobs.map(publicProductionJob),
    materials: player.materials.map(publicStone),
    slices: player.slices.map(publicStone),
    bracelets: player.bracelets.map(publicStone),
    livestreamJobs: player.livestreamJobs.map(publicLivestreamJob),
    livestreamHistory: player.livestreamHistory.map(publicLivestreamJob),
    collection: player.collection.map(publicStone)
  };
}

function snapshotFor(player, now = Date.now()) {
  normalizePlayer(player);
  settleAuctionIfDue(now);
  const auction = ensureAuctionRound(now);
  return {
    me: privatePlayerSnapshot(player),
    roughPool: state.roughPool.map(publicStone),
    listings: state.listings.map(publicListing),
    auction: publicAuctionSnapshot(auction, player.id, now),
    players: [...state.players.values()].map(publicPlayer).sort((a, b) => b.rep - a.rep),
    news: state.news
  };
}

function broadcast() {
  for (const [socketId, playerId] of state.sockets.entries()) {
    const player = state.players.get(playerId);
    const socket = io.sockets.sockets.get(socketId);
    if (player && socket) socket.emit("state", snapshotFor(player));
  }
}

function addNews(text, tone = "info") {
  state.news.unshift({
    id: randomUUID(),
    text,
    tone,
    at: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  });
  state.news = state.news.slice(0, 12);
}

function makeRoughStone() {
  const trueQuality = pickWeightedQuality();
  const mass = Math.round(0.7 * 10 + Math.random() * 2.8 * 10) / 10;
  const fog = pick(["白雾", "黄雾", "黑乌砂", "脱沙", "松花", "蟒带"]);
  const confidence = Math.random();
  const visibleScore = clamp(trueQuality.score + Math.floor(Math.random() * 3) - 1, 1, 5);
  const visibleQuality = qualities.find((item) => item.score === visibleScore);
  const basePrice = 900 + trueQuality.score * trueQuality.score * 720 + mass * 620;
  const noise = 0.68 + Math.random() * 0.88;
  const price = money(basePrice * noise);
  return {
    id: randomUUID(),
    name: `${fog}${pick(["木那", "莫湾基", "会卡", "南齐", "后江"])}料`,
    publicHint: `${fog}皮壳 · ${confidence > 0.55 ? "轮廓饱满" : "皮壳起伏"}`,
    hint: `${visibleQuality.name}迹象 · ${confidence > 0.55 ? "皮壳紧致" : "裂纹需细看"}`,
    mass,
    price,
    trueValue: money(price * (1.78 + trueQuality.score * 0.04)),
    deposit: money(basePrice * 0.18),
    risk: Math.round((1 - confidence + trueQuality.score * 0.07) * 100),
    expertClues: makeExpertClues(fog, trueQuality, confidence, mass),
    windows: [],
    visual: makeStoneVisual(fog, trueQuality, confidence),
    trueQualityKey: trueQuality.key
  };
}

function makeExpertClues(fog, quality, confidence, mass) {
  const clues = [];
  clues.push(`${fog}皮壳`);
  clues.push(confidence > 0.62 ? "皮紧砂细" : confidence > 0.38 ? "表现不匀" : "赌性偏重");
  clues.push(quality.score >= 4 ? "色根有冲高空间" : quality.score >= 3 ? "水头可博" : "底子偏灰");
  clues.push(mass >= 2.4 ? "体量足，可多件规划" : mass >= 1.3 ? "适合稳取一件" : "小料优先避裂");
  return clues;
}

function makeStoneVisual(fog, quality, confidence) {
  const skinMap = {
    白雾: "#b8b7a8",
    黄雾: "#b2915a",
    黑乌砂: "#39413d",
    脱沙: "#8c907a",
    松花: "#6f8366",
    蟒带: "#5e776f"
  };
  const seed = Math.floor(Math.random() * 100000);
  const green = quality.score >= 4 ? "#18a66d" : quality.score >= 3 ? "#4fb58a" : "#789d7b";
  const beltAngle = Math.round(8 + Math.random() * 26);
  const crackAngle = Math.round(82 + Math.random() * 52);
  const bestAngle = confidence > 0.58 ? beltAngle : Math.round((beltAngle + 18 + Math.random() * 42) % 180);
  return {
    seed,
    skin: skinMap[fog] || "#73796f",
    vein: green,
    window: confidence > 0.48,
    crack: Math.random() > 0.58,
    belt: Math.random() > 0.36,
    beltAngle,
    crackAngle,
    bestAngle,
    suggestedAngle: Math.round((beltAngle + (Math.random() * 22 - 11) + 180) % 180),
    shape: pick(["round", "long", "chunk"]),
    grain: Math.round(30 + Math.random() * 70),
    translucency: clamp(quality.score * 0.16 + confidence * 0.22, 0.12, 0.92),
    cotton: clamp(1 - quality.score * 0.13 + Math.random() * 0.18, 0.08, 0.78),
    speckles: Math.round(80 + Math.random() * 120),
    skinRoughness: clamp(0.45 + Math.random() * 0.45, 0.2, 1)
  };
}

function pickWeightedQuality() {
  const roll = Math.random();
  if (roll < 0.48) return qualities[0];
  if (roll < 0.76) return qualities[1];
  if (roll < 0.91) return qualities[2];
  if (roll < 0.985) return qualities[3];
  return qualities[4];
}

function refreshRoughPool() {
  while (state.roughPool.length < 8) state.roughPool.push(makeRoughStone());
}

function ensureAuctionRound(now = Date.now()) {
  if (state.auction && !state.auction.settledAt) return state.auction;
  if (state.auction?.settledAt && now - state.auction.settledAt <= TIMING.auction.preview) return state.auction;
  refreshRoughPool();
  const startsAt = now;
  const biddingEndsAt = now + TIMING.auction.bidding;
  state.auction = {
    id: randomUUID(),
    status: "bidding",
    startsAt,
    biddingEndsAt,
    settlesAt: biddingEndsAt,
    roughs: state.roughPool.slice(0, 8),
    bids: [],
    results: []
  };
  addNews("新一轮公盘暗标开启，投标期间不显示最高价。", "info");
  return state.auction;
}

function settleAuctionIfDue(now = Date.now()) {
  const round = ensureAuctionRound(now);
  if (round.settledAt || now < round.biddingEndsAt) return false;
  const withAi = {
    ...round,
    bids: [
      ...(round.bids || []),
      ...round.roughs.flatMap((rough) => aiBidsForRough(rough, round.bids, 3))
    ]
  };
  const settled = settleAuctionRound(withAi, { now, minIncrement: 100 });
  state.auction = settled;
  const humanWinners = new Set(settled.results
    .filter((result) => result.winnerId && !result.ai)
    .map((result) => `${result.roughId}:${result.winnerId}`));
  for (const bid of settled.bids || []) {
    if (bid.ai || humanWinners.has(`${bid.roughId}:${bid.playerId}`)) continue;
    const bidder = state.players.get(bid.playerId);
    const rough = settled.roughs.find((item) => item.id === bid.roughId);
    if (!bidder || !rough) continue;
    const refund = bidDeposit(bid.amount);
    if (refund > 0) {
      releaseDeposit(bidder, refund, `退回保证金：${rough.name}`, { itemId: rough.id });
    }
  }
  for (const result of settled.results) {
    if (!result.winnerId) continue;
    const rough = settled.roughs.find((item) => item.id === result.roughId);
    if (!rough) continue;
    if (result.ai) {
      state.roughPool = state.roughPool.filter((item) => item.id !== rough.id);
      continue;
    }
    const winner = state.players.get(result.winnerId);
    if (!winner) continue;
    if (winner.cash < result.balanceDue) {
      addNews(`${winner.name} 中标 ${rough.name} 后尾款不足，保证金被没收。`, "bad");
      result.status = "passed";
      result.price = 0;
      result.depositUsed = 0;
      result.balanceDue = 0;
      delete result.winnerId;
      continue;
    }
    if (result.balanceDue > 0) {
      spendCash(winner, result.balanceDue, `公盘尾款：${rough.name}`, { source: "auction", itemId: rough.id });
    }
    state.roughPool = state.roughPool.filter((item) => item.id !== rough.id);
    winner.rough.push({ ...rough, type: "rough", owner: winner.id, revealed: false, polished: false });
    refreshPlayerReport(winner);
    addNews(`${winner.name} 暗标中标 ${rough.name}，成交 ${result.price}。`, "trade");
  }
  refreshRoughPool();
  return true;
}

function submitAuctionBidForPlayer(player, payload, now = Date.now()) {
  if (!player) return { ok: false, message: "未找到玩家。" };
  if (!payload || typeof payload !== "object") return { ok: false, message: "投标参数无效。" };
  normalizePlayer(player);
  if (state.auction && !state.auction.settledAt && now >= state.auction.biddingEndsAt) {
    settleAuctionIfDue(now);
  }
  const round = ensureAuctionRound(now);
  if (round.settledAt || now >= round.biddingEndsAt || round.status !== "bidding") {
    return { ok: false, message: "本轮公盘已截止。" };
  }
  const roughId = payload.roughId;
  const rough = round.roughs.find((item) => item.id === roughId);
  if (!rough) return { ok: false, message: "这块原石不在当前公盘。" };
  const bidAmount = money(payload.amount);
  if (bidAmount < rough.price) return { ok: false, message: "暗标不能低于底价。" };
  const next = upsertBid(round, {
    playerId: player.id,
    roughId,
    amount: bidAmount,
    proxyMax: payload.proxyMax,
    at: now
  });
  if (next.depositDelta > 0 && !holdDeposit(player, next.depositDelta, `公盘保证金：${rough.name}`, { itemId: rough.id })) {
    return { ok: false, message: `保证金还需 ${next.depositDelta}。` };
  }
  if (next.depositDelta < 0) {
    releaseDeposit(player, Math.abs(next.depositDelta), `退回保证金：${rough.name}`, { itemId: rough.id });
  }
  state.auction = next.round;
  addNews(`${player.name} 提交了 ${rough.name} 的密封投标。`, "info");
  return { ok: true, message: "暗标已提交。", bid: next.bid, depositDelta: next.depositDelta };
}

function requestAuctionWindowForPlayer(player, payload, now = Date.now()) {
  if (!player) return { ok: false, message: "未找到玩家。" };
  const { roughId, x, y } = normalizeWindowPayload(payload);
  if (state.auction && !state.auction.settledAt && now >= state.auction.biddingEndsAt) {
    settleAuctionIfDue(now);
  }
  const round = ensureAuctionRound(now);
  if (round.settledAt || now >= round.biddingEndsAt || round.status !== "bidding") {
    return { ok: false, message: "当前公盘已停止开窗。" };
  }
  const rough = round.roughs.find((item) => item.id === roughId);
  if (!rough) return { ok: false, message: "这块原石不在当前公盘。" };
  const fee = money(rough.price * OPEN_WINDOW_RATE);
  if (!spendCash(player, fee, `开窗：${rough.name}`, { source: "window", itemId: rough.id })) {
    return { ok: false, message: `开窗费需要 ${fee}。` };
  }
  rough.windows = [...(rough.windows || []), makeWindowReveal(rough, { x, y })].slice(0, 6);
  addNews(`${player.name} 花 ${fee} 为 ${rough.name} 请求开窗，公盘信息更新。`, "info");
  return { ok: true, message: "开窗完成。", rough };
}

function makePlayer(playerId) {
  const suffix = String(Math.floor(100 + Math.random() * 900));
  return {
    id: playerId,
    name: `新手掌柜${suffix}`,
    cash: 30000,
    rep: 0,
    satisfaction: 72,
    offlineSummary: null,
    ledger: [],
    lastSeenAt: Date.now(),
    reports: [],
    rough: [],
    jobs: [],
    externalMaterials: {
      silverMount: 2,
      goldMount: 0,
      diamondChips: 0
    },
    polishingJobs: [],
    materials: [],
    slices: [],
    bracelets: [],
    livestreamJobs: [],
    livestreamHistory: [],
    collection: [],
    orders: [],
    stats: {
      cutCount: 0,
      craftCount: 0,
      orderCount: 0,
      tradeCount: 0
    }
  };
}

function normalizePlayer(player) {
  player.cash = Number.isFinite(Number(player.cash)) ? Number(player.cash) : 30000;
  player.rep = Number.isFinite(Number(player.rep)) ? Number(player.rep) : 0;
  player.rough ||= [];
  player.jobs ||= [];
  player.externalMaterials ||= { silverMount: 0, goldMount: 0, diamondChips: 0 };
  player.polishingJobs ||= player.cuttingJobs || [];
  player.cuttingJobs = [];
  player.materials ||= [];
  player.slices ||= [];
  player.bracelets ||= [];
  player.livestreamJobs ||= [];
  player.livestreamHistory ||= [];
  player.collection ||= [];
  player.orders ||= [];
  player.ledger ||= [];
  player.offlineSummary ||= null;
  player.reports ||= [];
  player.lastSeenAt ||= Date.now();
  player.stats ||= {};
  player.stats.cutCount ||= 0;
  player.stats.sliceCount ||= 0;
  player.stats.splitCount ||= 0;
  player.stats.craftCount ||= 0;
  player.stats.orderCount ||= 0;
  player.stats.tradeCount ||= 0;
}

function inventoryForReport(player) {
  const activeProductionItems = [
    ...(player.jobs || []),
    ...(player.polishingJobs || [])
  ].map((job) => job?.item || job?.rough).filter(Boolean);
  const activeLivestreamProducts = (player.livestreamJobs || []).map((job) => job?.product).filter(Boolean);
  return [
    ...(player.rough || []),
    ...activeProductionItems,
    ...(player.materials || []),
    ...(player.slices || []),
    ...(player.bracelets || []),
    ...activeLivestreamProducts
  ];
}

function refreshPlayerReport(player, now = Date.now()) {
  if (!player) return null;
  player.ledger ||= [];
  player.reports = [reportSummary(player.ledger, inventoryForReport(player), now)];
  return player.reports[0];
}

function makeOrder(player) {
  const unlocked = npcProfiles.filter((profile) => player.rep >= profile.minRep);
  const profile = pick(unlocked.length ? unlocked : [npcProfiles[0]]);
  const minQuality = qualities.find((quality) => quality.score === profile.minScore);
  const urgency = pick(["今日交付", "三日内交付", "贵客急单", "常规订单"]);
  return {
    id: randomUUID(),
    client: profile.name,
    taste: profile.taste,
    minScore: profile.minScore,
    minQuality: minQuality.name,
    quantity: profile.quantity,
    acceptedKinds: profile.acceptedKinds,
    preferredKinds: profile.preferredKinds,
    tasteTags: profile.tasteTags,
    pay: money(profile.pay * (0.88 + Math.random() * 0.36) * (1 + player.satisfaction / 360)),
    rep: profile.rep,
    urgency,
    expiresAt: Date.now() + 1000 * 60 * (8 + Math.floor(Math.random() * 12))
  };
}

function refillOrders(player) {
  while (player.orders.length < 4) player.orders.push(makeOrder(player));
}

function qualityByKey(key) {
  return qualities.find((quality) => quality.key === key) || qualities[0];
}

function getPlayer(socket) {
  const playerId = state.sockets.get(socket.id);
  return state.players.get(playerId);
}

function playerSocketCount(playerId) {
  let count = 0;
  for (const activePlayerId of state.sockets.values()) {
    if (activePlayerId === playerId) count += 1;
  }
  return count;
}

function isPlayerOnline(player) {
  return Boolean(player?.id) && playerSocketCount(player.id) > 0;
}

function itemValue(item) {
  if (item.type === "rough") return item.price || 1000;
  if (item.type === "material") return item.value || 1000;
  if (item.type === "slice") return item.value || 1000;
  if (item.type === "bracelet") return item.value || 1000;
  return 1000;
}

function takeItem(player, type, itemId) {
  const bucketName = type === "rough" ? "rough" : type === "material" ? "materials" : type === "slice" ? "slices" : "bracelets";
  const bucket = player[bucketName];
  const index = bucket.findIndex((item) => item.id === itemId);
  if (index < 0) return null;
  return bucket.splice(index, 1)[0];
}

function startProductionJob(player, stage, item, options = {}) {
  const stageCost = { rough: 620, refine: 900, inlay: 480 }[stage] || 620;
  if (!spendCash(player, stageCost, `${options.label || stage}：${item.name}`, { source: "production", itemId: item.id })) {
    return null;
  }
  const now = Date.now();
  const job = {
    id: randomUUID(),
    type: "productionJob",
    stage,
    item,
    options,
    fee: stageCost,
    startedAt: now,
    readyAt: now + productionDuration(stage, TIMING_PROFILE)
  };
  player.jobs.push(job);
  return job;
}

function extractProductsFromJob(job) {
  const rough = job.item;
  const normalizedKits = normalizeExtractionKits(job.options?.kits || []);
  const placements = expandKitPlacements(normalizedKits);
  const combinedKits = normalizeExtractionKits(rough.extractionKits || rough.braceletPlacements || []);
  const combinedPlacements = expandKitPlacements(combinedKits.length ? combinedKits : normalizedKits);
  const totalSlots = Math.max(1, combinedPlacements.length);
  const valueBase = Math.max(rough.value || rough.price, rough.price) / Math.max(2, totalSlots + 1);
  return placements.map((placement) => {
    const placementScore = scoreRoughPlacement(rough, placement);
    const productMeta = kitProductMeta(placement);
    return {
      id: randomUUID(),
      type: "bracelet",
      kind: placement.layout,
      name: `${rough.quality}${rough.color}${productMeta.label}`,
      qualityKey: rough.qualityKey,
      quality: rough.quality,
      score: rough.score,
      color: rough.color,
      design: productMeta.label,
      value: money(valueBase * productMeta.mult * placementScore),
      rep: Math.max(1, Math.round((rough.rep * productMeta.rep * 0.35 + rough.score * 2) * clamp(placementScore, 0.72, 1.18))),
      count: productMeta.count,
      sourceRoughId: rough.id,
      plan: placement,
      sourceMaterial: {
        roughId: rough.id,
        roughName: rough.name,
        visual: rough.visual,
        windows: rough.windows || [],
        placement,
        templateSize: { w: placement.templateSize?.w, h: placement.templateSize?.h },
        mass: rough.mass,
        qualityKey: rough.qualityKey,
        color: rough.color
      },
      placementScore: Math.round(placementScore * 100)
    };
  });
}

function restoreRoughToInventory(player, rough) {
  const existingIndex = player.rough.findIndex((item) => item.id === rough.id);
  if (existingIndex >= 0) {
    player.rough[existingIndex] = { ...player.rough[existingIndex], ...rough };
    return;
  }
  player.rough.push(rough);
}

function completeProductionJob(player, job) {
  if (job.stage === "rough") {
    const polished = revealPolishedRough(job.item);
    polished.stage = "material";
    player.rough.push(polished);
    player.rep += Math.max(1, Math.round(polished.rep * 0.45));
    return { text: `${polished.name} 粗加工完成`, item: polished };
  }
  if (job.stage === "refine") {
    const products = extractProductsFromJob(job);
    player.bracelets.push(...products);
    restoreRoughToInventory(player, job.item);
    player.stats.craftCount += products.length;
    return { text: `${job.item.name} 精加工完成`, item: job.item };
  }
  const finished = { ...job.item, inlaid: true, value: money((job.item.value || 0) * 1.18), name: `${job.item.name}镶嵌款` };
  player.bracelets.push(finished);
  return { text: `${finished.name} 镶嵌完成`, item: finished };
}

function scheduleLivestream(player, productId, mode = "autoBalanced") {
  normalizePlayer(player);
  const product = takeItem(player, "bracelet", productId);
  if (!product) return null;
  const now = Date.now();
  const duration = TIMING.livestream.min;
  const job = {
    id: randomUUID(),
    type: "livestreamJob",
    mode,
    product,
    startedAt: now,
    readyAt: now + duration
  };
  player.livestreamJobs.push(job);
  refreshPlayerReport(player, now);
  return job;
}

function sellLivestreamNow(player, productId, seed = Date.now()) {
  normalizePlayer(player);
  const product = takeItem(player, "bracelet", productId);
  if (!product) return null;
  const now = Date.now();
  const priced = livestreamOutcome(product, { mode: "manual", rep: player.rep, seed });
  const outcome = {
    ...priced,
    sold: true,
    price: priced.price || money(Number(product.value || product.price || 0) * Math.max(1, priced.multiplier || 1))
  };
  earnCash(player, outcome.price, `直播成交：${product.name}`, { source: "livestream", itemId: product.id, at: now });
  player.rep += Math.max(1, Math.round(product.rep * 0.18));
  player.livestreamHistory.unshift({
    id: randomUUID(),
    type: "livestreamManual",
    mode: "manual",
    product,
    outcome,
    startedAt: now,
    readyAt: now,
    completedAt: now
  });
  player.livestreamHistory = player.livestreamHistory.slice(0, 20);
  refreshPlayerReport(player, now);
  return { product, outcome };
}

function addItem(player, item) {
  if (item.type === "rough") player.rough.push(item);
  if (item.type === "material") player.materials.push(item);
  if (item.type === "slice") player.slices.push(item);
  if (item.type === "bracelet") player.bracelets.push(item);
}

function normalizeWindowPayload(payload) {
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

function normalizeAngle(value) {
  const angle = Number(value);
  if (!Number.isFinite(angle)) return 0;
  return Math.round(((angle % 180) + 180) % 180);
}

function angleDistance(a, b) {
  const diff = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(diff, 180 - diff);
}

function cutAngleName(angle) {
  return `${normalizeAngle(angle)}度刀线`;
}

function makeSliceBoard(material, index, count) {
  const score = material.score;
  const visual = material.visual || {};
  const seed = Number(visual.seed || 1000) + index * 97;
  const widthBias = material.mass > 1.4 ? 0 : index % 2 === 0 ? -8 : 7;
  const outlinePath = index % 3 === 0
    ? `M12 ${22 + widthBias / 2} C26 8 62 7 112 18 C133 24 139 50 130 74 C118 97 65 96 28 84 C10 78 3 43 12 ${22 + widthBias / 2} Z`
    : index % 3 === 1
      ? `M18 18 C50 5 102 10 127 28 C143 40 134 79 110 91 C75 103 28 88 13 66 C2 49 3 26 18 18 Z`
      : `M10 30 C24 10 74 4 116 18 C139 26 145 61 125 82 C101 103 55 97 25 83 C8 74 -1 48 10 30 Z`;
  const beltAngle = normalizeAngle(visual.beltAngle || material.cutAngle || 18);
  const beltOffset = ((index - (count - 1) / 2) * 14);
  const colorZones = Array.from({ length: Math.max(1, score - 1) }, (_, zoneIndex) => ({
    cx: clamp(72 + beltOffset + zoneIndex * 12 - score * 3, 20, 124),
    cy: clamp(48 + ((seed + zoneIndex * 17) % 25) - 12, 18, 78),
    rx: 18 + score * 4 + zoneIndex * 3,
    ry: 8 + score * 2,
    angle: beltAngle,
    opacity: clamp(0.22 + score * 0.09, 0.24, 0.76)
  }));
  const flaws = visual.crack ? Array.from({ length: Math.max(1, 4 - Math.floor(score / 2)) }, (_, flawIndex) => ({
    x: clamp(72 + beltOffset + ((seed + flawIndex * 29) % 36) - 18, 18, 126),
    y: 18 + ((seed + flawIndex * 23) % 56),
    len: 12 + ((seed + flawIndex * 11) % 18),
    angle: normalizeAngle((visual.crackAngle || 96) + flawIndex * 11)
  })) : [];
  const clarity = clamp(score * 18 + (seed % 18), 18, 96);
  const dirtySpots = Array.from({ length: Math.max(0, 5 - score) }, (_, spotIndex) => ({
    x: 14 + ((seed + spotIndex * 37) % 112),
    y: 14 + ((seed + spotIndex * 41) % 66),
    r: 1.2 + ((seed + spotIndex * 7) % 24) / 10,
    opacity: clamp(0.08 + (5 - score) * 0.025, 0.08, 0.2)
  }));
  const cottonThreads = Array.from({ length: Math.max(4, 18 - score * 2) }, (_, threadIndex) => ({
    x: 8 + ((seed + threadIndex * 17) % 120),
    y: 10 + ((seed + threadIndex * 13) % 70),
    len: 12 + ((seed + threadIndex * 9) % 28),
    angle: normalizeAngle((visual.beltAngle || 18) + threadIndex * 7)
  }));
  return {
    outlinePath,
    flaws,
    colorZones,
    baseColor: visual.vein || "#65a985",
    groundColor: score >= 4 ? "#d9fff0" : score >= 3 ? "#c6eadf" : "#d7ddd0",
    grainAngle: normalizeAngle((material.cutAngle || beltAngle || 20) + index * 4),
    sourceSeed: visual.seed,
    sourceBeltAngle: beltAngle,
    sourceCrackAngle: visual.crackAngle,
    sourceShape: visual.shape,
    sliceIndex: index,
    sliceCount: count,
    cleanScore: clarity,
    clarity,
    water: clamp(score * 0.18 + Math.random() * 0.16, 0.16, 0.96),
    dirtySpots,
    cottonThreads
  };
}

function normalizePlan(rawPlan, layout) {
  const plan = rawPlan && typeof rawPlan === "object" ? rawPlan : {};
  return {
    layout,
    x: clamp(Number(plan.x) || 50, 18, 82),
    y: clamp(Number(plan.y) || 50, 18, 82),
    scale: clamp(Number(plan.scale) || 82, 45, 128),
    rotation: normalizeAngle(plan.rotation || 0)
  };
}

function placementRadius(placement) {
  if (placement.layout === "bracelet") {
    const ringSize = Number(placement.ringSize) || 56;
    return clamp(12 + (ringSize - 52) * 0.55, 12, 18);
  }
  if (placement.layout === "cabochon") return 7;
  if (placement.layout === "peacePendant") return 12;
  if (placement.layout === "ruyiPendant") return 11;
  if (placement.layout === "leafPendant") return 10;
  return 15;
}

const EXTRACTION_KITS = {
  bangle: {
    label: "手镯套件",
    cost: 680,
    w: 34,
    h: 34,
    slots: [{ dx: 0, dy: 0, layout: "bracelet" }]
  },
  cabochon: {
    label: "蛋面套件",
    cost: 520,
    w: 22,
    h: 28,
    slots: [{ dx: 0, dy: 0, layout: "cabochon" }]
  },
  peacePendant: {
    label: "平安扣挂件",
    cost: 580,
    w: 30,
    h: 30,
    slots: [{ dx: 0, dy: 0, layout: "peacePendant" }]
  },
  ruyiPendant: {
    label: "如意挂件",
    cost: 600,
    w: 32,
    h: 30,
    slots: [{ dx: 0, dy: 0, layout: "ruyiPendant" }]
  },
  leafPendant: {
    label: "叶子挂件",
    cost: 560,
    w: 24,
    h: 36,
    slots: [{ dx: 0, dy: 0, layout: "leafPendant" }]
  }
};

function normalizePlacement(rawPlacement, fallbackLayout = "bracelet") {
  const placement = rawPlacement && typeof rawPlacement === "object" ? rawPlacement : {};
  const layout = ["bracelet", "cabochon", "peacePendant", "ruyiPendant", "leafPendant"].includes(placement.layout) ? placement.layout : fallbackLayout;
  const ringSize = clamp(Number(placement.ringSize) || 56, 52, 62);
  const normalized = {
    id: typeof placement.id === "string" ? placement.id.slice(0, 36) : randomUUID(),
    layout,
    x: clamp(Number(placement.x) || 50, 12, 88),
    y: clamp(Number(placement.y) || 50, 12, 88),
    ringSize: layout === "bracelet" ? Math.round(ringSize / 2) * 2 : undefined
  };
  normalized.radius = placementRadius(normalized);
  return normalized;
}

function normalizePlacements(rawPlacements, fallbackLayout, fallbackPlan) {
  const source = Array.isArray(rawPlacements) && rawPlacements.length
    ? rawPlacements
    : [{ ...(fallbackPlan || {}), layout: fallbackLayout || fallbackPlan?.layout || "bracelet" }];
  return source.slice(0, 8).map((placement) => normalizePlacement(placement, fallbackLayout || "bracelet"));
}

function normalizeExtractionKits(rawKits) {
  const source = Array.isArray(rawKits) ? rawKits : [];
  return source.slice(0, 10).map((kit) => {
    const type = EXTRACTION_KITS[kit?.type] ? kit.type : "bangle";
    const ringSize = clamp(Number(kit?.ringSize) || 56, 52, 62);
    return {
      id: typeof kit?.id === "string" ? kit.id.slice(0, 36) : randomUUID(),
      type,
      x: clamp(Number(kit?.x) || 50, 16, 84),
      y: clamp(Number(kit?.y) || 50, 16, 84),
      ringSize: Math.round(ringSize / 2) * 2
    };
  });
}

function expandKitPlacements(kits) {
  return kits.flatMap((kit) => {
    const template = EXTRACTION_KITS[kit.type] || EXTRACTION_KITS.bangle;
    return template.slots.map((slot, slotIndex) => {
      const placement = normalizePlacement({
        id: `${kit.id}-${slotIndex}`,
        layout: slot.layout,
        x: kit.x + slot.dx,
        y: kit.y + slot.dy,
        ringSize: kit.ringSize
      }, slot.layout);
      placement.kitId = kit.id;
      placement.kitType = kit.type;
      placement.templateLabel = template.label;
      placement.templateSize = { w: template.w, h: template.h };
      return placement;
    });
  });
}

function kitProductMeta(placement) {
  const map = {
    bracelet: { label: `${placement.ringSize || 56}圈口手镯`, mult: 1.58, rep: 1, count: 1 },
    cabochon: { label: "蛋面", mult: 0.72, rep: 0.58, count: 1 },
    peacePendant: { label: "平安扣挂件", mult: 0.98, rep: 0.66, count: 1 },
    ruyiPendant: { label: "如意挂件", mult: 1.02, rep: 0.68, count: 1 },
    leafPendant: { label: "叶子挂件", mult: 0.9, rep: 0.62, count: 1 }
  };
  return map[placement.layout] || map.peacePendant;
}

function placementTemplateSize(placement) {
  const kitTypeByLayout = {
    bracelet: "bangle",
    cabochon: "cabochon",
    peacePendant: "peacePendant",
    ruyiPendant: "ruyiPendant",
    leafPendant: "leafPendant"
  };
  const template = EXTRACTION_KITS[placement.kitType] || EXTRACTION_KITS[kitTypeByLayout[placement.layout]];
  const size = placement.templateSize || template || {};
  return {
    w: clamp(Number(size.w) || placementRadius(placement) * 2, 8, 60),
    h: clamp(Number(size.h) || placementRadius(placement) * 2, 8, 60)
  };
}

function placementFootprint(placement) {
  const { w, h } = placementTemplateSize(placement);
  if (placement.layout === "bracelet") return { rx: w * 0.43, ry: h * 0.32 };
  if (placement.layout === "cabochon") return { rx: w * 0.24, ry: h * 0.34 };
  if (placement.layout === "peacePendant") {
    const radius = Math.min(w, h) * 0.38;
    return { rx: radius, ry: radius };
  }
  if (placement.layout === "ruyiPendant") return { rx: w * 0.38, ry: h * 0.42 };
  if (placement.layout === "leafPendant") return { rx: w * 0.3, ry: h * 0.37 };
  return { rx: w * 0.5, ry: h * 0.5 };
}

function placementsOverlap(placements) {
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      if (a.kitId && a.kitId === b.kitId) continue;
      const aFootprint = placementFootprint(a);
      const bFootprint = placementFootprint(b);
      const rx = aFootprint.rx + bFootprint.rx + 1;
      const ry = aFootprint.ry + bFootprint.ry + 1;
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) < 1) return true;
    }
  }
  return false;
}

function scoreSlicePlacement(slice, placement) {
  const board = slice.board || {};
  const radius = placement.radius || placementRadius(placement);
  const edgePenalty = (placement.x - radius < 7 || placement.x + radius > 93 ? 0.18 : 0)
    + (placement.y - radius < 8 || placement.y + radius > 92 ? 0.18 : 0);
  const colorBonus = (board.colorZones || []).some((zone) => {
    const dx = placement.x - zone.cx / 1.44;
    const dy = placement.y - zone.cy / 0.96;
    return Math.hypot(dx, dy) < 22;
  }) ? 0.18 : 0;
  const flawPenalty = (board.flaws || []).some((flaw) => {
    const dx = placement.x - flaw.x / 1.44;
    const dy = placement.y - flaw.y / 0.96;
    return Math.hypot(dx, dy) < radius + 3;
  }) ? 0.24 : 0;
  const grainPenalty = placement.layout === "plaque" ? 0.04 : 0;
  const sizeBonus = placement.layout === "bracelet" && placement.ringSize >= 58 ? 0.06 : 0;
  return clamp(0.82 + colorBonus + sizeBonus - edgePenalty - flawPenalty - grainPenalty, 0.48, 1.24);
}

function scoreSlicePlan(slice, plan) {
  return scoreSlicePlacement(slice, normalizePlacement(plan, plan.layout || "bracelet"));
}

function scoreRoughPlacement(rough, placement) {
  const visual = rough.visual || {};
  const radius = placement.radius || placementRadius(placement);
  const edgePenalty = (placement.x - radius < 10 || placement.x + radius > 90 ? 0.22 : 0)
    + (placement.y - radius < 10 || placement.y + radius > 90 ? 0.22 : 0);
  const angle = (visual.beltAngle || 18) * Math.PI / 180;
  const dx = (placement.x - 50) / 50;
  const dy = (placement.y - 50) / 50;
  const cross = Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle));
  const colorBonus = visual.belt && cross < 0.22 ? 0.18 : 0;
  const windowBonus = (rough.windows || []).some((win) => Math.hypot(placement.x - win.x, placement.y - win.y) < radius + win.r) ? 0.08 : 0;
  const crackPenalty = visual.crack && Math.abs(placement.x - 50) < 9 && Math.abs(placement.y - 50) < 34 ? 0.18 : 0;
  const sizeBonus = placement.layout === "bracelet" && placement.ringSize >= 58 ? 0.05 : 0;
  const smallPieceBonus = ["cabochon", "peacePendant", "ruyiPendant", "leafPendant"].includes(placement.layout) ? 0.05 : 0;
  return clamp(0.82 + colorBonus + windowBonus + sizeBonus + smallPieceBonus - edgePenalty - crackPenalty, 0.5, 1.22);
}

function revealPolishedRough(rough) {
  const quality = qualityByKey(rough.trueQualityKey);
  return {
    ...rough,
    type: "rough",
    revealed: true,
    polished: true,
    qualityKey: quality.key,
    quality: quality.name,
    score: quality.score,
    color: quality.color,
    value: money(rough.price * quality.value * (0.88 + Math.random() * 0.34)),
    rep: quality.rep,
    braceletPlacements: rough.braceletPlacements || []
  };
}

function resolveCuttingJob(player, job) {
  const rough = job.rough;
  const quality = qualityByKey(rough.trueQualityKey);
  const bestAngle = rough.visual?.bestAngle ?? rough.visual?.suggestedAngle ?? 0;
  const crackAngle = rough.visual?.crackAngle ?? 95;
  const bestDelta = angleDistance(job.angle, bestAngle);
  const crackDelta = angleDistance(job.angle, crackAngle);
  const angleModifier = bestDelta <= 12 ? -0.16 : bestDelta <= 28 ? -0.06 : bestDelta >= 58 ? 0.13 : 0.03;
  const crackModifier = rough.visual?.crack && crackDelta <= 12 ? 0.16 : rough.visual?.crack && crackDelta <= 24 ? 0.07 : 0;
  const breakChance = clamp(0.29 - quality.score * 0.035 + rough.risk / 520 + angleModifier + crackModifier, 0.06, 0.62);
  player.stats.cutCount += 1;

  if (Math.random() < breakChance) {
    const salvage = money(rough.price * (0.08 + Math.random() * 0.2));
    earnCash(player, salvage, `切垮回收：${rough.name}`, { source: "salvage", itemId: rough.id });
    player.rep = Math.max(0, player.rep - 2);
    addNews(`${player.name} 用${cutAngleName(job.angle)}切垮 ${rough.name}，只回收 ${salvage}。`, "bad");
    return;
  }

  const smartCut = bestDelta <= 18;
  const yieldRate = smartCut ? 0.7 + Math.random() * 0.18 : 0.44 + Math.random() * 0.26;
  const material = {
    id: randomUUID(),
    type: "material",
    name: `${quality.name}${quality.color}明料`,
    qualityKey: quality.key,
    quality: quality.name,
    score: quality.score,
    color: quality.color,
    mass: Math.max(0.25, Math.round((rough.mass * yieldRate) * 10) / 10),
    value: money(rough.price * quality.value * (smartCut ? 1.05 : 0.82) * (0.86 + Math.random() * 0.38)),
    rep: quality.rep,
    visual: rough.visual,
    cutAngle: job.angle,
    cutDelta: bestDelta,
    slicePotential: Math.max(1, Math.round(quality.score + rough.mass / 1.4))
  };

  player.materials.push(material);
  player.rep += quality.rep;
  if (quality.score >= 4) {
    addNews(`${player.name} 用${cutAngleName(job.angle)}切出 ${material.name}，全场轰动，声望 +${quality.rep}。`, "great");
  } else {
    addNews(`${player.name} 切出 ${material.name}，估值 ${material.value}。`, "info");
  }
}

function processCuttingJobs() {
  let changed = false;
  for (const player of state.players.values()) {
    normalizePlayer(player);
    const ready = player.cuttingJobs.filter((job) => job.readyAt <= Date.now());
    if (!ready.length) continue;
    player.cuttingJobs = player.cuttingJobs.filter((job) => job.readyAt > Date.now());
    ready.forEach((job) => resolveCuttingJob(player, job));
    changed = true;
  }
  if (changed) broadcast();
}

function normalizeProductionJob(job) {
  if (job?.stage && job.item) return job;
  if (job?.rough) {
    return {
      ...job,
      type: "productionJob",
      stage: "rough",
      item: job.rough,
      options: { label: "粗加工", ...(job.options || {}) }
    };
  }
  return job;
}

function settleProductionJobsForPlayer(player, now = Date.now()) {
  normalizePlayer(player);
  const events = [];
  const readyJobs = player.jobs.filter((job) => job.readyAt <= now);
  const readyLegacyJobs = player.polishingJobs.filter((job) => job.readyAt <= now);
  if (!readyJobs.length && !readyLegacyJobs.length) return events;

  player.jobs = player.jobs.filter((job) => job.readyAt > now);
  player.polishingJobs = player.polishingJobs.filter((job) => job.readyAt > now);

  for (const rawJob of [...readyJobs, ...readyLegacyJobs]) {
    const job = normalizeProductionJob(rawJob);
    if (!job?.item) continue;
    const result = completeProductionJob(player, job);
    events.push({ type: "production", text: result.text, income: 0, expense: 0, readyAt: job.readyAt });
    addNews(`${player.name} 的 ${result.text}。`, job.stage === "rough" && result.item?.score >= 4 ? "great" : "craft");
  }

  refreshPlayerReport(player, now);
  return events;
}

function processProductionJobs(now = Date.now(), options = {}) {
  const onlineOnly = options.onlineOnly !== false;
  let changed = false;
  for (const player of state.players.values()) {
    normalizePlayer(player);
    if (onlineOnly && !isPlayerOnline(player)) continue;
    const events = settleProductionJobsForPlayer(player, now);
    if (events.length) changed = true;
  }
  if (changed) broadcast();
  return changed;
}

function settleLivestreamJobsForPlayer(player, now = Date.now()) {
  normalizePlayer(player);
  const events = [];
  const ready = player.livestreamJobs.filter((job) => job.readyAt <= now);
  if (!ready.length) return events;

  player.livestreamJobs = player.livestreamJobs.filter((job) => job.readyAt > now);
  for (const job of ready) {
    if (!job?.product) continue;
    const outcome = livestreamOutcome(job.product, { mode: job.mode, rep: player.rep, seed: job.readyAt });
    if (outcome.sold) {
      earnCash(player, outcome.price, `直播成交：${job.product.name}`, { source: "livestream", itemId: job.product.id, at: now });
      const repGain = Math.max(1, Math.round(job.product.rep * 0.18));
      player.rep += repGain;
      events.push({ type: "livestream", text: `${job.product.name} 自动直播成交 ${outcome.price}`, income: outcome.price, expense: 0, readyAt: job.readyAt });
      addNews(`${player.name} 自动直播卖出 ${job.product.name}，成交 ${outcome.price}。`, "trade");
    } else {
      player.bracelets.push(job.product);
      events.push({ type: "livestream", text: `${job.product.name} 直播未成交，已退回库存`, income: 0, expense: 0, readyAt: job.readyAt });
      addNews(`${player.name} 的 ${job.product.name} 直播未成交，已退回库存。`, "info");
    }
    player.livestreamHistory.unshift({ ...job, outcome, completedAt: now });
    player.livestreamHistory = player.livestreamHistory.slice(0, 20);
  }

  refreshPlayerReport(player, now);
  return events;
}

function processLivestreamJobs(now = Date.now(), options = {}) {
  const onlineOnly = options.onlineOnly !== false;
  let changed = false;
  for (const player of state.players.values()) {
    normalizePlayer(player);
    if (onlineOnly && !isPlayerOnline(player)) continue;
    const events = settleLivestreamJobsForPlayer(player, now);
    if (events.length) changed = true;
  }
  if (changed) broadcast();
  return changed;
}

function processPolishingJobs(now = Date.now()) {
  let changed = false;
  for (const player of state.players.values()) {
    normalizePlayer(player);
    if (!isPlayerOnline(player)) continue;
    const events = settleProductionJobsForPlayer(player, now);
    if (events.length) changed = true;
  }
  if (changed) broadcast();
  return changed;
}

function settleOfflinePlayer(player, now = Date.now()) {
  normalizePlayer(player);
  const offlineSince = player.lastSeenAt || now;
  const events = [];
  const productionEvents = settleProductionJobsForPlayer(player, now);
  for (const event of productionEvents) {
    if (event.readyAt > offlineSince && event.readyAt <= now) {
      events.push({ type: "production", text: event.text, income: 0, expense: 0 });
    }
  }
  const livestreamEvents = settleLivestreamJobsForPlayer(player, now);
  for (const event of livestreamEvents) {
    if (event.readyAt > offlineSince && event.readyAt <= now) {
      events.push({ type: "livestream", text: event.text, income: event.income, expense: event.expense });
    }
  }
  player.orders = player.orders.filter((order) => order.expiresAt > now);
  refillOrders(player);
  player.offlineSummary = events.length ? makeOfflineSummary(events) : null;
  player.lastSeenAt = now;
  refreshPlayerReport(player, now);
  return events;
}

io.on("connection", (socket) => {
  const requestedId = socket.handshake.auth?.playerId;
  const playerId = requestedId || randomUUID();
  if (!state.players.has(playerId)) {
    const player = makePlayer(playerId);
    state.players.set(playerId, player);
    refillOrders(player);
    addNews(`${player.name} 来到翡翠街。`);
  }

  const player = state.players.get(playerId);
  const wasOnline = isPlayerOnline(player);
  state.sockets.set(socket.id, playerId);
  if (!wasOnline) settleOfflinePlayer(player);
  socket.emit("hello", { playerId });
  broadcast();

  socket.on("setName", (name) => {
    const player = getPlayer(socket);
    const cleanName = String(name || "").trim().slice(0, 10);
    if (!player || !cleanName) return;
    player.name = cleanName;
    addNews(`${player.name} 换上了新招牌。`);
    broadcast();
  });

  socket.on("submitAuctionBid", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    const result = submitAuctionBidForPlayer(player, payload);
    if (!result.ok) return socket.emit("toast", result.message);
    broadcast();
  });

  socket.on("buyRough", () => {
    socket.emit("toast", "公盘已改为暗标，请提交密封投标。");
  });

  socket.on("requestWindow", (payload) => {
    const player = getPlayer(socket);
    const result = requestAuctionWindowForPlayer(player, payload);
    if (!result.ok) return socket.emit("toast", result.message);
    broadcast();
  });

  socket.on("startPolish", (roughId) => {
    const player = getPlayer(socket);
    if (!player) return;
    normalizePlayer(player);
    const rough = takeItem(player, "rough", roughId);
    if (!rough) return;
    if (rough.revealed) {
      player.rough.push(rough);
      return socket.emit("toast", "这块料已经全料打磨完成。");
    }
    const job = startProductionJob(player, "rough", rough, { label: "粗加工" });
    if (!job) {
      player.rough.push(rough);
      return socket.emit("toast", "粗加工费用不够。");
    }
    addNews(`${player.name} 将 ${rough.name} 送入粗加工。`, "craft");
    broadcast();
  });

  socket.on("startCut", ({ roughId, angle }) => {
    socket.emit("toast", "当前流程已改为全料打磨后直接取手镯。");
    socket.emit("state", snapshotFor(getPlayer(socket)));
  });

  socket.on("cutRough", (roughId) => {
    socket.emit("toast", "当前流程已改为全料打磨后直接取手镯。");
    socket.emit("state", snapshotFor(getPlayer(socket)));
  });

  socket.on("extractFromRough", ({ roughId, kits: rawKits, placements: rawPlacements }) => {
    const player = getPlayer(socket);
    if (!player) return;
    normalizePlayer(player);
    const rough = takeItem(player, "rough", roughId);
    if (!rough) return;
    if (!rough.revealed) {
      player.rough.push(rough);
      return socket.emit("toast", "先做全料打磨，揭露料性后才能取手镯。");
    }
    const kits = normalizeExtractionKits(rawKits);
    const legacyKits = !kits.length && Array.isArray(rawPlacements)
      ? rawPlacements.map((placement) => ({ ...placement, type: "bangle" }))
      : [];
    const normalizedKits = kits.length ? kits : normalizeExtractionKits(legacyKits);
    const placements = expandKitPlacements(normalizedKits);
    if (!placements.length) {
      player.rough.push(rough);
      return socket.emit("toast", "请先在原料上选择取件套件。");
    }
    const existingKits = normalizeExtractionKits(rough.extractionKits || rough.braceletPlacements || []);
    const existingPlacements = expandKitPlacements(existingKits);
    if (placementsOverlap([...existingPlacements, ...placements])) {
      player.rough.push(rough);
      return socket.emit("toast", "套件位置互相重叠，重新摆一下。");
    }
    const job = startProductionJob(player, "refine", rough, { label: "精加工", kits: normalizedKits });
    if (!job) {
      player.rough.push(rough);
      return socket.emit("toast", "精加工费用不够。");
    }
    rough.extractionKits = [...existingKits, ...normalizedKits].slice(0, 10);
    rough.braceletPlacements = rough.extractionKits;
    job.item = rough;
    addNews(`${player.name} 为 ${rough.name} 安排 ${normalizedKits.length} 件精加工。`, "craft");
    broadcast();
  });

  socket.on("cutSlice", (materialId) => {
    socket.emit("toast", "当前流程不再切片，请在已揭露原料上直接取手镯。");
    socket.emit("state", snapshotFor(getPlayer(socket)));
  });

  socket.on("splitSlice", ({ sliceId, layout, plan: rawPlan, placements: rawPlacements }) => {
    socket.emit("toast", "当前流程不再分割片料，请在已揭露原料上直接取手镯。");
    socket.emit("state", snapshotFor(getPlayer(socket)));
  });

  socket.on("craftBracelet", (materialId) => {
    socket.emit("toast", "当前流程请在已揭露原料上选择位置取手镯。");
    socket.emit("state", snapshotFor(getPlayer(socket)));
  });

  socket.on("collectBracelet", (braceletId) => {
    const player = getPlayer(socket);
    if (!player) return;
    const bracelet = takeItem(player, "bracelet", braceletId);
    if (!bracelet) return;
    player.collection.push({ ...bracelet, collectedAt: Date.now() });
    player.rep += bracelet.rep;
    addNews(`${player.name} 把 ${bracelet.name} 收进藏宝阁，声望 +${bracelet.rep}。`, "great");
    broadcast();
  });

  socket.on("scheduleLivestream", ({ productId, mode } = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    const job = scheduleLivestream(player, productId, mode);
    if (!job) return socket.emit("toast", "找不到可直播的成品。");
    addNews(`${player.name} 安排 ${job.product.name} 自动直播。`, "trade");
    broadcast();
  });

  socket.on("livestreamSell", (braceletId) => {
    const player = getPlayer(socket);
    if (!player) return;
    const sale = sellLivestreamNow(player, braceletId);
    if (!sale) return;
    addNews(`${player.name} 直播卖出 ${sale.product.name}，成交 ${sale.outcome.price}。`, "trade");
    broadcast();
  });

  socket.on("completeOrder", ({ orderId, braceletIds }) => {
    const player = getPlayer(socket);
    if (!player) return;
    const order = player.orders.find((item) => item.id === orderId);
    if (!order) return;
    const selectedIds = [...new Set(Array.isArray(braceletIds) ? braceletIds : [])].slice(0, order.quantity);
    const selected = selectedIds.map((id) => player.bracelets.find((bracelet) => bracelet.id === id)).filter(Boolean);
    if (selected.length < order.quantity) return socket.emit("toast", "交付数量不够。");

    const minScore = Math.min(...selected.map((bracelet) => bracelet.score));
    const onTime = Date.now() <= order.expiresAt;
    const qualityOk = selected.every((bracelet) => productMatchesOrder(bracelet, order));
    const multiplier = qualityOk ? 1 : 0.45;
    const timePenalty = onTime ? 1 : 0.72;
    const finalPay = money(order.pay * multiplier * timePenalty);
    const repGain = qualityOk && onTime ? order.rep : Math.max(-8, -Math.round(order.rep * 0.35));

    selectedIds.forEach((id) => takeItem(player, "bracelet", id));
    earnCash(player, finalPay, `订单交付：${order.client}`, { source: "order", itemId: order.id });
    player.rep = Math.max(0, player.rep + repGain);
    player.satisfaction = clamp(player.satisfaction + (qualityOk && onTime ? 8 : -16), 0, 100);
    player.stats.orderCount += 1;
    player.orders = player.orders.filter((item) => item.id !== order.id);
    refillOrders(player);
    addNews(`${player.name} 完成 ${order.client} 的订单，收入 ${finalPay}，声望 ${repGain >= 0 ? "+" : ""}${repGain}。`, qualityOk ? "trade" : "bad");
    broadcast();
  });

  socket.on("listItem", ({ type, itemId, price }) => {
    const player = getPlayer(socket);
    if (!player) return;
    const listingPrice = money(Number(price));
    if (!["rough", "material", "slice", "bracelet"].includes(type) || listingPrice < 100) return;
    const item = takeItem(player, type, itemId);
    if (!item) return;
    state.listings.unshift({
      id: randomUUID(),
      ownerId: player.id,
      ownerName: player.name,
      type,
      item,
      price: listingPrice,
      createdAt: Date.now()
    });
    state.listings = state.listings.slice(0, 40);
    addNews(`${player.name} 在交易行挂出 ${item.name}，标价 ${listingPrice}。`, "trade");
    broadcast();
  });

  socket.on("buyListing", (listingId) => {
    const player = getPlayer(socket);
    if (!player) return;
    const index = state.listings.findIndex((listing) => listing.id === listingId);
    if (index < 0) return;
    const listing = state.listings[index];
    if (listing.ownerId === player.id) return socket.emit("toast", "不能购买自己的挂单。");
    const seller = state.players.get(listing.ownerId);
    if (!spendCash(player, listing.price, `交易行购入：${listing.item.name}`, { source: "market", itemId: listing.item.id })) {
      return socket.emit("toast", "资金不足。");
    }
    if (seller) {
      earnCash(seller, listing.price, `交易行成交：${listing.item.name}`, { source: "market", itemId: listing.item.id });
      seller.rep += 2;
      seller.stats.tradeCount += 1;
    }
    addItem(player, listing.item);
    player.stats.tradeCount += 1;
    state.listings.splice(index, 1);
    addNews(`${player.name} 从 ${listing.ownerName} 手里买下 ${listing.item.name}，成交 ${listing.price}。`, "trade");
    broadcast();
  });

  socket.on("refreshOrders", () => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!spendCash(player, 300, "刷新客户", { source: "orderRefresh" })) return socket.emit("toast", "刷新客户需要 300。");
    player.orders = [];
    refillOrders(player);
    broadcast();
  });

  socket.on("disconnect", () => {
    const playerId = state.sockets.get(socket.id);
    state.sockets.delete(socket.id);
    if (playerId && playerSocketCount(playerId) === 0) {
      const player = state.players.get(playerId);
      if (player) player.lastSeenAt = Date.now();
    }
    broadcast();
  });
});

function isDirectRun() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;
}

function startServer() {
  refreshRoughPool();
  addNews("本地翡翠街开市，公盘、工坊、订单与交易行已开放。", "great");

  setInterval(() => {
    processPolishingJobs();
    refreshRoughPool();
    const now = Date.now();
    settleAuctionIfDue(now);
    if (state.auction?.settledAt && now - state.auction.settledAt > TIMING.auction.preview) {
      state.auction = null;
      ensureAuctionRound(now);
    }
    for (const player of state.players.values()) {
      if (!isPlayerOnline(player)) continue;
      player.orders = player.orders.filter((order) => order.expiresAt > Date.now());
      refillOrders(player);
      if (player.rep > 5) player.rep = Math.max(5, player.rep - 0.35);
    }
    broadcast();
  }, 25000);

  setInterval(() => {
    processProductionJobs();
    processLivestreamJobs();
  }, 1000);

  return httpServer.listen(PORT, () => {
    console.log(`Jade Market Prototype running at http://localhost:${PORT}`);
  });
}

export const __testHooks = {
  state,
  makePlayer,
  normalizePlayer,
  recordLedger,
  spendCash,
  earnCash,
  holdDeposit,
  releaseDeposit,
  settleOfflinePlayer,
  submitAuctionBidForPlayer,
  requestAuctionWindowForPlayer,
  ensureAuctionRound,
  settleAuctionIfDue,
  snapshotFor,
  startProductionJob,
  completeProductionJob,
  scheduleLivestream,
  sellLivestreamNow,
  extractProductsFromJob,
  processProductionJobs,
  settleLivestreamJobsForPlayer,
  processLivestreamJobs,
  processPolishingJobs,
  playerSocketCount,
  isPlayerOnline,
  revealPolishedRough,
  inventoryForReport,
  refreshPlayerReport
};

if (isDirectRun()) startServer();
