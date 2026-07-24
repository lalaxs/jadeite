import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { handleStartWorkshopJobRequest } from "./workshop-start-handler.js";
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
  AUCTION_HALLS,
  auctionEntryFee,
  auctionHallForId,
  repLevelForRep,
  publicAuctionSnapshot,
  publicAuctionHistoryEntry,
  enterAuctionRound,
  upsertBid,
  aiBidsForRough,
  settleAuctionRound
} from "./public/jade-auction.js";
import {
  EXTRACTION_KITS,
  isSmallPieceKind,
  kitLayout,
  placementRadiusForKind,
  productMetaForKind
} from "./public/jade-categories.js";
import {
  buildOpeningStone,
  computeGrade as computeOpeningGrade,
  evaluateOpeningKit
} from "./public/jade-opening-engine.js";
import {
  equipmentCatalog,
  createDeviceInstance,
  normalizeDevice,
  buyEquipment,
  durabilityLoss,
  repairEquipment,
  repairQuote
} from "./server/systems/equipment-system.js";
import {
  ensureRecruitCandidates,
  refreshRecruitCandidates,
  recruitWorker,
  mergeWorkers,
  isWorkerBusy,
  grantActivityExperience
} from "./server/systems/employee-system.js";
import {
  inlayCatalog,
  validateFinishPlan,
  quoteFinishPlan,
  reserveFinishMaterials,
  refundFinishMaterials,
  applyInlay
} from "./server/systems/inlay-system.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const PORT = process.env.PORT || 3000;
const OPEN_WINDOW_RATE = 0.06;
const DEFAULT_AUCTION_HALL_ID = "novice";
const STARTER_ROUGH_COUNT = 3;
const OPENING_KIT_SERVER_TYPES = {
  egg: "cabochon",
  ping: "peacePendant",
  rect: "plaque",
  drop: "dropPendant",
  leaf: "leafPendant",
  bangle: "bangle",
  buddha: "buddhaPendant"
};
const OPENING_KIT_BY_SERVER_TYPE = Object.fromEntries(
  Object.entries(OPENING_KIT_SERVER_TYPES).map(([tpl, type]) => [type, tpl])
);
const ASSET_LISTINGS = [
  {
    id: "starter-workshop",
    type: "workshop",
    name: "街角小工坊",
    price: 12000,
    description: "解锁自己的打磨与取件工位。"
  },
  {
    id: "livestream-permit",
    type: "livestreamPermit",
    name: "直播经营许可",
    price: 8000,
    description: "解锁直播间和自动直播卖货。"
  }
];
// ===== 镶嵌材料：基准现实价 + 商铺供货目录（§20 / 设计案 §3）=====
// 单位：金属记克(g)、宝石记颗(piece)。价格对标现实金价，不下调。
// 类炒股价格浮动钩子：getMaterialPrice 当前返回基准现实价；后续接入 price-tick 引擎时只改这里。
const MATERIAL_META = {
  goldPure:  { name: "足金(24K)", unit: "g",     unitLabel: "克", unitPrice: 560,  tint: "#d4af37" },
  silver925: { name: "925银",     unit: "g",     unitLabel: "克", unitPrice: 12,   tint: "#c9c9c9" },
  gold18k:   { name: "18K金",     unit: "g",     unitLabel: "克", unitPrice: 380,  tint: "#e6c200" },
  platinum:  { name: "铂金PT950", unit: "g",     unitLabel: "克", unitPrice: 420,  tint: "#dfe6ee" },
  diamond:   { name: "配石钻石",  unit: "piece", unitLabel: "颗", unitPrice: 120,  tint: "#bfe9ff" },
  ruby:      { name: "红宝石",    unit: "piece", unitLabel: "颗", unitPrice: 40,   tint: "#e0556b" },
  sapphire:  { name: "蓝宝石",    unit: "piece", unitLabel: "颗", unitPrice: 40,   tint: "#5b8def" }
};
function getMaterialPrice(key) {
  const meta = MATERIAL_META[key];
  return meta ? meta.unitPrice : 0;
}
// 价格历史（类炒股引擎接入前的基线 + 实时追加）。键为材料 key，值为 [{d,p}]。
const MATERIAL_PRICE_HISTORY = {};
(function seedMaterialHistory() {
  const DAYS = 14;
  Object.keys(MATERIAL_META).forEach((key, ki) => {
    const base = MATERIAL_META[key].unitPrice;
    const arr = [];
    let seed = (ki + 3) * 9301 + 49297;
    for (let i = 0; i < DAYS; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      const r = seed / 233280;
      const wobble = (r - 0.5) * 0.06; // ±3% 基线波动
      arr.push({ d: i - DAYS + 1, p: Math.round(base * (1 + wobble)) });
    }
    MATERIAL_PRICE_HISTORY[key] = arr;
  });
})();
let materialPriceDay = 0;
function recordMaterialPriceTick() {
  materialPriceDay += 1;
  Object.keys(MATERIAL_META).forEach((key) => {
    const arr = MATERIAL_PRICE_HISTORY[key] || (MATERIAL_PRICE_HISTORY[key] = []);
    const p = Math.round(getMaterialPrice(key));
    arr.push({ d: materialPriceDay, p });
    if (arr.length > 90) arr.shift(); // 保留约 90 个游戏日
  });
}
function getMaterialPriceHistory(key) {
  return MATERIAL_PRICE_HISTORY[key] || [];
}
// 原型节奏：每 60 秒记一个游戏日（正式版改为游戏日结算钩子）
setInterval(recordMaterialPriceTick, 60 * 1000);
// 商铺供货规格：金属按斤(500g)/公斤(1000g)，宝石按单颗/10颗包/50颗包。
// 折扣=整批让利（金属公斤-5%；宝石10颗-10%/50颗-20%）。pack 价=基准单价×数量×(1-折扣)。
const MATERIAL_CATALOG = [
  { id: "goldPure",  key: "goldPure",  description: "足金底托、包金边，传统富贵色。" },
  { id: "silver925", key: "silver925", description: "廉价配托，适合练习与低档件。" },
  { id: "gold18k",   key: "gold18k",   description: "主流镶嵌金，硬度适中不易变形。" },
  { id: "platinum",  key: "platinum",  description: "稀有白金，硬度最高、抓石最牢。" },
  { id: "diamond",   key: "diamond",   description: "足反亮钻，戒指/耳饰点缀。" },
  { id: "ruby",      key: "ruby",      description: "红宝石配石，暖色点缀。" },
  { id: "sapphire",  key: "sapphire", description: "蓝宝石配石，冷色点缀。" }
].map((m) => {
  const meta = MATERIAL_META[m.key];
  const isMetal = meta.unit === "g";
  m.name = meta.name;
  m.unit = meta.unit;
  m.unitLabel = meta.unitLabel;
  m.packs = isMetal
    ? [
        { packId: "jin", label: "1斤(500g)",  amount: 500,  discount: 0 },
        { packId: "kg",  label: "1公斤(1000g)", amount: 1000, discount: 0.05 }
      ]
    : [
        { packId: "single", label: "单颗",    amount: 1,  discount: 0 },
        { packId: "pack10", label: "10颗包", amount: 10, discount: 0.10 },
        { packId: "pack50", label: "50颗包", amount: 50, discount: 0.20 }
      ];
  return m;
});
function materialCatalogForPlayer(player) {
  normalizePlayer(player);
  return MATERIAL_CATALOG.map((m) => ({
    id: m.id,
    key: m.key,
    group: m.unit === "g" ? "metal" : "gem",
    tint: m.tint || "#30a669",
    name: m.name,
    unit: m.unit,
    unitLabel: m.unitLabel,
    price: Math.round(getMaterialPrice(m.key)),
    description: m.description,
    packs: m.packs.map((p) => ({
      packId: p.packId,
      label: p.label,
      amount: p.amount,
      discount: p.discount,
      price: Math.round(getMaterialPrice(m.key) * p.amount * (1 - p.discount))
    }))
  }));
}
function buyMaterialPack(player, materialId, amount) {
  if (!player) return { ok: false, message: "未找到玩家。" };
  normalizePlayer(player);
  const cat = MATERIAL_CATALOG.find((m) => m.id === materialId);
  if (!cat) return { ok: false, message: "材料不存在。" };
  const qty = Math.floor(Number(amount));
  if (!Number.isFinite(qty) || qty < 1) return { ok: false, message: "购买数量至少为 1。" };
  const price = Math.round(getMaterialPrice(cat.key) * qty);
  if (!spendCash(player, price, `购入镶嵌材料：${cat.name}×${qty}${cat.unitLabel}`, { source: "material", materialId, qty })) {
    return { ok: false, message: `购买 ${cat.name} ${qty}${cat.unitLabel} 需要 ${price}。` };
  }
  player.externalMaterials[cat.key] = Number(player.externalMaterials[cat.key] || 0) + qty;
  return {
    ok: true,
    message: `购入 ${cat.name} ×${qty}${cat.unitLabel}`,
    listing: { name: `${cat.name} ×${qty}${cat.unitLabel}` },
    price
  };
}

const WORKSHOP_WORKER_DEFS = [
  {
    id: "worker-opening",
    name: "阿成",
    job: "cutter",
    tier: 5,
    tierLevel: 1,
    traits: ["稳手"],
    flaws: ["巧手"],
    skills: {
      cut:    { jieliao: { level: 6, exp: 240 }, damo: { level: 5, exp: 180 } },
      set:    { qieliao: { level: 6, exp: 210 }, xiuxing: { level: 5, exp: 170 } },
      finish: { diaozhuo: { level: 4, exp: 120 }, xiangqian: { level: 4, exp: 110 } },
      speak:  { huashu: { level: 2, exp: 35 }, kongchang: { level: 1, exp: 22 }, cuidan: { level: 2, exp: 18 } }
    }
  },
  {
    id: "worker-carving",
    name: "林师傅",
    job: "finisher",
    tier: 8,
    tierLevel: 1,
    traits: ["按线稳"],
    flaws: ["心细"],
    skills: {
      cut:    { jieliao: { level: 2, exp: 60 }, damo: { level: 2, exp: 40 } },
      set:    { qieliao: { level: 2, exp: 50 }, xiuxing: { level: 2, exp: 45 } },
      finish: { diaozhuo: { level: 6, exp: 200 }, xiangqian: { level: 5, exp: 180 } },
      speak:  { huashu: { level: 1, exp: 20 }, kongchang: { level: 1, exp: 12 }, cuidan: { level: 1, exp: 8 } }
    }
  },
  {
    id: "worker-polishing",
    name: "小周",
    job: "planner",
    tier: 3,
    tierLevel: 1,
    traits: ["细光"],
    flaws: ["手重"],
    skills: {
      cut:    { jieliao: { level: 3, exp: 90 }, damo: { level: 3, exp: 70 } },
      set:    { qieliao: { level: 6, exp: 240 }, xiuxing: { level: 5, exp: 210 } },
      finish: { diaozhuo: { level: 2, exp: 35 }, xiangqian: { level: 2, exp: 25 } },
      speak:  { huashu: { level: 1, exp: 18 }, kongchang: { level: 1, exp: 11 }, cuidan: { level: 1, exp: 6 } }
    }
  },
  {
    id: "worker-finishing",
    name: "许工",
    job: "streamer",
    tier: 6,
    tierLevel: 1,
    traits: ["收口准"],
    flaws: ["易出绵"],
    skills: {
      cut:    { jieliao: { level: 2, exp: 55 }, damo: { level: 2, exp: 45 } },
      set:    { qieliao: { level: 2, exp: 48 }, xiuxing: { level: 2, exp: 42 } },
      finish: { diaozhuo: { level: 2, exp: 38 }, xiangqian: { level: 2, exp: 28 } },
      speak:  { huashu: { level: 6, exp: 190 }, kongchang: { level: 5, exp: 160 }, cuidan: { level: 5, exp: 155 } }
    }
  }
];

// ── 任务系统（每日任务）──────────────────────────────────────────
// 刷新间隔：默认 6 小时；可用环境变量 TASK_REFRESH_MS 覆盖（开发/演示用，如 60000 = 1 分钟）
const TASK_REFRESH_MS = Number(process.env.TASK_REFRESH_MS) || 6 * 60 * 60 * 1000;
const TASK_RESET_COST = 5000;
const TASK_COUNT = 6;

// 任务池：每项对应一个真实的游戏内动作（已在对应 socket handler 中埋点进度）
const TASK_DEFINITIONS = [
  { type: "market_buy", title: "交易行购买原石", desc: "在交易行购入任意一块原石或中间物", target: 1, reward: 2000, rep: 0, color: "#12a594", view: "market" },
  { type: "auction_win", title: "拍卖成功竞得", desc: "在公盘暗标拍卖中成功中标至少 1 块原石", target: 1, reward: 3500, rep: 0, color: "#e0913a", view: "auction" },
  { type: "workshop_craft", title: "工坊打磨加工", desc: "在工坊完成打磨或取件操作", target: 3, reward: 2800, rep: 0, color: "#5285d0", view: "workshop" },
  { type: "livestream_sell", title: "直播间售出商品", desc: "在直播间成功售出成品", target: 2, reward: 5000, rep: 50, color: "#c264a0", view: "livestream" },
  { type: "market_sell", title: "交易行挂牌出售", desc: "在交易行上架一件商品", target: 1, reward: 1500, rep: 0, color: "#2fa36b", view: "market" },
  { type: "order_complete", title: "完成客户订单", desc: "交付一单客户定制订单", target: 1, reward: 3000, rep: 20, color: "#d1725a", view: "orders" },
  { type: "collection_collect", title: "收藏精品", desc: "将一件成品收入藏品阁", target: 1, reward: 2500, rep: 15, color: "#8a72c9", view: "collection" },
  { type: "window_open", title: "公盘开窗", desc: "对公盘原石执行开窗操作", target: 1, reward: 1800, rep: 0, color: "#3aa6c0", view: "auction" }
];

function makeTaskInstance(def) {
  return {
    uid: randomUUID(),
    type: def.type,
    title: def.title,
    desc: def.desc,
    target: def.target,
    reward: def.reward,
    rep: def.rep,
    color: def.color,
    view: def.view,
    progress: 0,
    status: "active" // active | complete | claimed
  };
}

function pickTaskDefinitions(count) {
  const pool = [...TASK_DEFINITIONS];
  const chosen = [];
  while (chosen.length < count && pool.length) {
    const idx = Math.floor(Math.random() * pool.length);
    chosen.push(pool.splice(idx, 1)[0]);
  }
  return chosen;
}

function refreshTasksIfDue(player, now = Date.now()) {
  const due = !player.tasks || player.tasks.length === 0 || now - (player.taskRefreshedAt || 0) >= TASK_REFRESH_MS;
  if (!due) return false;
  player.tasks = pickTaskDefinitions(TASK_COUNT).map(makeTaskInstance);
  player.taskRefreshedAt = now;
  return true;
}

function advanceTask(player, type, amount = 1) {
  if (!player.tasks) return;
  let changed = false;
  for (const task of player.tasks) {
    if (task.status !== "active" || task.type !== type) continue;
    task.progress = Math.min(task.target, task.progress + amount);
    if (task.progress >= task.target) task.status = "complete";
    changed = true;
  }
  if (changed) refreshPlayerReport(player);
  return changed;
}

function claimTask(player, uid) {
  const task = (player.tasks || []).find((item) => item.uid === uid);
  if (!task) return { ok: false, message: "任务不存在。" };
  if (task.status === "claimed") return { ok: false, message: "该任务奖励已领取。" };
  if (task.status !== "complete") return { ok: false, message: "任务尚未完成，无法领取。" };
  earnCash(player, task.reward, `任务奖励：${task.title}`, { source: "taskReward", itemId: task.uid });
  if (task.rep > 0) player.rep += task.rep;
  task.status = "claimed";
  refreshPlayerReport(player);
  return { ok: true, reward: task.reward, rep: task.rep, title: task.title };
}

function resetTask(player, uid) {
  const task = (player.tasks || []).find((item) => item.uid === uid);
  if (!task) return { ok: false, message: "任务不存在。" };
  if (task.status !== "active") return { ok: false, message: "已完成/已领取的任务不可重置。" };
  if (!spendCash(player, TASK_RESET_COST, `重置任务：${task.title}`, { source: "taskReset", repEligible: false })) {
    return { ok: false, message: `重置需要 ¥${TASK_RESET_COST} 现金。` };
  }
  const next = pickTaskDefinitions(TASK_COUNT).map(makeTaskInstance);
  const replacement = next.find((item) => item.type !== task.type) || next[0];
  player.tasks = player.tasks.map((item) => (item.uid === uid ? replacement : item));
  refreshPlayerReport(player);
  return { ok: true, task: replacement };
}
function starterDevices() {
  return [
    createDeviceInstance("opening", "rough", randomUUID()),
    createDeviceInstance("carving", "carve", randomUUID()),
    createDeviceInstance("finishing", "polish", randomUUID())
  ];
}
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
  { name: "普通市民", minRep: 0, minScore: 1, quantity: 1, pay: 2100, rep: 4, taste: "价格实在", acceptedKinds: ["bracelet", "peacePendant", "leafPendant", "dropPendant", "gourdPendant", "fuBeanPendant"], preferredKinds: ["peacePendant"], tasteTags: ["budget"] },
  { name: "富商太太", minRep: 35, minScore: 3, quantity: 1, pay: 7600, rep: 18, taste: "种水好、颜色正", acceptedKinds: ["bracelet", "ruyiPendant", "buddhaPendant", "guanyinPendant"], preferredKinds: ["bracelet"], tasteTags: ["color", "gift"] },
  { name: "收藏家", minRep: 100, minScore: 4, quantity: 1, pay: 18800, rep: 42, taste: "要稀有高货", acceptedKinds: ["bracelet", "cabochon", "plaque", "beads"], preferredKinds: ["bracelet"], tasteTags: ["highGrade"] },
  { name: "珠宝商", minRep: 65, minScore: 2, quantity: 2, pay: 9800, rep: 22, taste: "稳定批量供货", acceptedKinds: ["bracelet", "cabochon", "peacePendant", "ruyiPendant", "leafPendant", "dropPendant", "plaque", "fuBeanPendant", "gourdPendant", "beads"], preferredKinds: ["cabochon", "leafPendant", "beads"], tasteTags: ["batch"] }
];

const state = {
  startedAt: Date.now(),
  players: new Map(),
  sockets: new Map(),
  roughPool: [],
  listings: [],
  news: [],
  auction: null,
  latestAuctionResults: [],
  auctionHistory: []
};
const recentRequestIdsByPlayer = new Map();

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

function uiMoney(value) {
  return `¥${money(value).toLocaleString("zh-CN")}`;
}

// 交易行市场税：成交时买家在挂牌价之外额外支付 3%，卖家仍收全额（对齐设计文档 §34）
const MARKET_TAX = 0.03;

function emitUiEvent(socket, event = {}) {
  if (!socket || !event || typeof event !== "object") return;
  socket.emit("ui:event", {
    id: event.id || randomUUID(),
    ...event
  });
}

function emitUiEventToPlayer(player, event = {}) {
  if (!player) return;
  for (const [socketId, playerId] of state.sockets.entries()) {
    if (playerId !== player.id) continue;
    emitUiEvent(io.sockets.sockets.get(socketId), event);
  }
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

function consumeRequestId(player, requestId) {
  const id = String(requestId || "").trim();
  if (!player || !id) return false;
  const key = player.id || player.name || "anonymous";
  const recent = recentRequestIdsByPlayer.get(key) || [];
  if (recent.includes(id)) return false;
  recent.push(id);
  recentRequestIdsByPlayer.set(key, recent.slice(-100));
  return true;
}

function normalizeMutationPayload(payload) {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : {};
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

function publicAuctionHalls(player) {
  const rep = Number(player?.rep || 0);
  return AUCTION_HALLS.map((hall) => ({
    id: hall.id,
    label: hall.label,
    requiredLevel: hall.requiredLevel,
    windowRate: hall.windowRate,
    deposit: hall.deposit,
    entryFee: auctionEntryFee(hall),
    tone: hall.tone,
    priceNote: hall.priceNote,
    unlocked: repLevelForRep(rep) >= hall.requiredLevel,
    active: hall.id === DEFAULT_AUCTION_HALL_ID
  }));
}

function normalizeAssets(player) {
  player.assets ||= {};
  player.assets.workshopOwned = Boolean(player.assets.workshopOwned);
  player.assets.livestreamPermitOwned = Boolean(player.assets.livestreamPermitOwned);
  return player.assets;
}

function materialStageFor(item) {
  if (!item || typeof item !== "object") return "unknown";
  if (item.materialStage) return item.materialStage;
  if (item.type === "rough") return item.revealed || item.polished ? "opened" : "rough";
  if (item.stage === "opened" || item.stage === "material") return "opened";
  if (item.stage === "carved") return "carved";
  if (item.stage === "polished") return "polished";
  if (item.stage === "finished" || item.inlaid) return "finished";
  if (item.type === "bracelet") return "finished";
  return "unknown";
}

function mergeWorkerSkills(defSkills, existingSkills) {
  const out = {};
  for (const dir of ["cut", "set", "finish", "speak"]) {
    out[dir] = {};
    const defDir = defSkills?.[dir] || {};
    const exDir = existingSkills?.[dir] || {};
    for (const key of Object.keys(defDir)) {
      const ex = exDir[key] || {};
      const defSkill = defDir[key] || { level: 1, exp: 0 };
      out[dir][key] = {
        level: clamp(Math.round(Number(ex.level ?? defSkill.level) || 1), 1, 10),
        exp: Math.max(0, Number(ex.exp ?? defSkill.exp) || 0)
      };
    }
  }
  return out;
}

function normalizeWorkshop(player) {
  player.workshop ||= {};
  if (Array.isArray(player.workshop.devices) && player.workshop.devices.length) {
    // 返回玩家：保留设备实例，但强制统一为固定 1 阶、容量 1。
    player.workshop.devices = player.workshop.devices.map(normalizeDevice);
  } else {
    // 新玩家：每工序赠送 1 台固定 1 阶默认型号。
    player.workshop.devices = starterDevices();
  }
  player.workshop.workers = mergeWorkers(
    WORKSHOP_WORKER_DEFS,
    player.workshop.workers || []
  ).map((worker) => {
    const definition = WORKSHOP_WORKER_DEFS.find((item) => item.id === worker.id);
    return {
      ...worker,
      job: worker.job || definition?.job || "cutter",
      tier: Math.max(1, Math.min(10, Number(worker.tier ?? definition?.tier) || 1)),
      tierLevel: Math.max(1, Math.round(Number(worker.tierLevel ?? definition?.tierLevel) || 1)),
      traits: Array.isArray(worker.traits) ? worker.traits : (definition?.traits || []),
      flaws: Array.isArray(worker.flaws) ? worker.flaws : (definition?.flaws || []),
      skills: mergeWorkerSkills(definition?.skills || worker.skills, worker.skills)
    };
  });
  ensureRecruitCandidates(player, {
    rng: Math.random,
    makeId: randomUUID
  });
  if (!player.workshop.selectedDeviceId || !player.workshop.devices.some((device) => device.id === player.workshop.selectedDeviceId)) {
    player.workshop.selectedDeviceId = player.workshop.devices[0]?.id;
  }
  return player.workshop;
}

function workshopDevicesForPlayer(player) {
  normalizeWorkshop(player);
  return player.workshop.devices;
}

function workshopDeviceForPlayer(player, deviceId) {
  const devs = workshopDevicesForPlayer(player);
  return devs.find((device) => device.id === deviceId) || devs.find((device) => device.stage === deviceId) || null;
}

function workshopWorkerForPlayer(player, workerId) {
  normalizeWorkshop(player);
  return player.workshop.workers.find((worker) => worker.id === workerId) || null;
}

// ===== 员工技能 → 加工属性派生（与前端 public/workshop-module.js 共用同一套公式）=====
// 品阶 = 数字 1~10 阶（替代原有的 白/绿/蓝/紫/金 颜色名）
const WS_TIER_MULT = { 1: 1.0, 2: 1.07, 3: 1.15, 4: 1.24, 5: 1.35, 6: 1.47, 7: 1.6, 8: 1.72, 9: 1.85, 10: 2.0 };
const WS_K_CURVE = [0, 0.12, 0.24, 0.37, 0.5, 0.63, 0.74, 0.83, 0.9, 0.95, 1.0];
const WS_SKILL_DEFS = {
  jieliao:   { name: "解料", attr: "完整度",     full: 18, dir: "cut" },
  damo:      { name: "打磨", attr: "光泽度",     full: 15, dir: "cut" },
  qieliao:   { name: "切料", attr: "瑕疵控制",   full: 12, dir: "set" },
  xiuxing:   { name: "修形", attr: "造型精度",   full: 14, dir: "set" },
  diaozhuo:  { name: "雕琢", attr: "雕琢精细度", full: 22, dir: "finish" },
  xiangqian: { name: "镶嵌", attr: "镶嵌贴合度", full: 16, dir: "finish" },
  huashu:    { name: "话术", attr: "溢价力",     full: 12, dir: "speak" },
  kongchang: { name: "控场", attr: "控场流速",   full: 10, dir: "speak" },
  cuidan:    { name: "催单", attr: "逼单转化",   full: 10, dir: "speak" }
};
const WS_PROCESS_SKILLS = ["jieliao", "damo", "qieliao", "xiuxing", "diaozhuo", "xiangqian"];
const WS_STEP_ATTRS = { open: ["jieliao", "damo"], plan: ["qieliao", "xiuxing"], finish: ["diaozhuo", "xiangqian"] };
const WS_FLAW_DEFS = { 易裂: -0.08, 易出绵: -0.06, 易脏: -0.05, 手重: -0.04, 巧手: 0.05, 净料: 0.06, 稳手: 0.04, 心细: 0.04 };
const WS_FLAW_POOL = ["裂", "绵", "棉", "脏点", "崩口"];
// 碎裂防御：员工词条 + 技能均可影响碎裂概率（见 completeProductionJob）
const WS_SHATTER_SKILLS = ["jieliao", "qieliao", "xiuxing"]; // 解料(完整度)/切料(瑕疵控制)/修形(造型精度)：物理稳定相关，越高越不易碎
const WS_SHATTER_SKILL_UNIT = 0.02; // 每条防碎技能满级满阶贡献 2 个百分点减碎裂（占位，待调）
// 完美度（= 工分）标签阈值：工分≥此值标「完美」，≤此值标「瑕疵」，中间为普通（无标签）；占位，待调
const WS_PERFECT_SCORE = 100;
const WS_FLAW_SCORE = 35;
// 瑕疵件确定性标签映射（不随机）：员工负面天赋 → 显示瑕疵名，否则默认「绵」
const WS_FLAW_TAG_MAP = { 易裂: "裂", 易出绵: "绵", 易脏: "脏点", 手重: "崩口" };

// ===== 加工「工分」评分体系（方案A：加权合成 + 评级 + 中间产物按已完成工序评分）=====
// 单工序内：两个属性按权重加权，技能×品阶映射到 0~120 的工分子分
const WS_STEP_ATTR_WEIGHTS = {
  open:   { jieliao: 0.55, damo: 0.45 },   // 开料：完整度 55% + 光泽度 45%
  plan:   { qieliao: 0.40, xiuxing: 0.60 }, // 规划：瑕疵控制 40% + 造型精度 60%
  finish: { diaozhuo: 0.55, xiangqian: 0.45 } // 精加工：雕琢精细度 55% + 镶嵌贴合度 45%
};
// 总工分中各工序的权重（仅「已完成」的工序参与聚合，权重自动归一化）
const WS_STEP_OVERALL_WEIGHTS = { open: 0.30, plan: 0.35, finish: 0.35 };
// 工分 → 价格加成上限：工分100 ≈ 成品价 +50%（即加工环节约占成品 1/3，封顶可控）
const WS_PROCESS_BONUS_CAP = 0.3;
// 评级阈值与溢价/折扣（工分驱动主加成，评级再微调价格；占位，待调）
const WS_GRADE_RULES = [
  { grade: "S", min: 100, mult: 1.04 },
  { grade: "A", min: 85,  mult: 1.00 },
  { grade: "B", min: 70,  mult: 0.97 },
  { grade: "C", min: 55,  mult: 0.94 },
  { grade: "D", min: 0,   mult: 0.90 }
];

function wsSkillThreshold(level) { return 50 * level; }
function wsSkillK(level, exp) {
  const L = clamp(Math.round(Number(level) || 1), 1, 10);
  const p = clamp((Number(exp) || 0) / wsSkillThreshold(L), 0, 1);
  const k0 = WS_K_CURVE[L];
  const k1 = L < 10 ? WS_K_CURVE[L + 1] : WS_K_CURVE[10];
  return k0 + p * (k1 - k0);
}
function wsTierM(worker) {
  const base = WS_TIER_MULT[worker?.tier] ?? 1.0;
  const tl = Number(worker?.tierLevel || 1);
  return base * (1 + 0.06 * (tl - 1));
}
function wsWorkerSkill(worker, key) {
  const dir = WS_SKILL_DEFS[key]?.dir;
  return (worker?.skills?.[dir]?.[key]) || { level: 1, exp: 0 };
}
function wsAttrValue(worker, key) {
  const sk = wsWorkerSkill(worker, key);
  return (WS_SKILL_DEFS[key]?.full || 0) * wsSkillK(sk.level, sk.exp) * wsTierM(worker);
}
// 员工对碎裂概率的防御值（概率增量，正=降低碎裂，负=升高碎裂）
function employeeShatterDefense(worker) {
  if (!worker) return 0;
  const flawProb = -(worker.flaws || []).reduce((s, f) => s + (WS_FLAW_DEFS[f] || 0), 0);
  let skillProb = 0;
  for (const key of WS_SHATTER_SKILLS) {
    const sk = wsWorkerSkill(worker, key);
    skillProb += WS_SHATTER_SKILL_UNIT * wsSkillK(sk.level, sk.exp) * wsTierM(worker);
  }
  return flawProb - skillProb; // 正=减碎裂概率
}
// 服务端工序 → 设计步骤：开料(open) / 规划(plan) / 精加工(finish)（统一为 3 步）
function wsStageToStep(stage) {
  if (stage === "rough" || stage === "opening") return "open";
  if (stage === "refine" || stage === "carving") return "plan";
  return "finish";
}
// 单工序「工分子分」（0~120）：本工序两个属性按权重加权，技能×品阶映射；词条净修正并入工分
function wsStepScore(worker, step) {
  const w = WS_STEP_ATTR_WEIGHTS[step];
  if (!w || !worker) return 0;
  let s = 0;
  for (const key in w) {
    const sk = wsWorkerSkill(worker, key);
    s += w[key] * wsSkillK(sk.level, sk.exp) * wsTierM(worker) * 100;
  }
  // 词条净修正并入工分（完美度=工分，故原「完美率词条」现在直接抬升/压低工分；正负均生效，封顶 120）
  let flawNet = 0;
  for (const f of (worker?.flaws || [])) flawNet += (WS_FLAW_DEFS[f] || 0);
  if (flawNet) s *= (1 + flawNet);
  return clamp(s, 0, 120);
}
// 总工分：仅「已完成」工序参与，按 WS_STEP_OVERALL_WEIGHTS 自动归一化聚合
function wsOverallScore(item) {
  const scores = (item && item.craftScores) || {};
  let wsum = 0, acc = 0;
  for (const step in WS_STEP_OVERALL_WEIGHTS) {
    if (scores[step] == null) continue;
    const w = WS_STEP_OVERALL_WEIGHTS[step];
    wsum += w; acc += w * scores[step];
  }
  return wsum > 0 ? acc / wsum : 0;
}
function wsCraftGrade(score) {
  for (const r of WS_GRADE_RULES) if (score >= r.min) return r.grade;
  return "D";
}
function wsGradeMult(score) {
  for (const r of WS_GRADE_RULES) if (score >= r.min) return r.mult;
  return 0.82;
}
// 加工速度时间缩放：6 技能各 +4%×k×M，耗时 ÷(1+Σ)
function wsSpeedTimeScale(worker) {
  let speed = 0;
  for (const key of WS_PROCESS_SKILLS) {
    const sk = wsWorkerSkill(worker, key);
    speed += 0.04 * wsSkillK(sk.level, sk.exp) * wsTierM(worker);
  }
  return 1 / (1 + speed);
}
// 完美度标签：工分即完美度，不再掷骰。工分≥WS_PERFECT_SCORE 标「完美」，≤WS_FLAW_SCORE 标「瑕疵」，中间无特殊标签。
function wsCraftPerfectLabel(score) {
  if (score >= WS_PERFECT_SCORE) return "完美";
  if (score <= WS_FLAW_SCORE) return "瑕疵";
  return "";
}
// 瑕疵件确定性标签（不随机）：优先取员工负面天赋映射的瑕疵名，否则默认「绵」
function wsCraftFlawTag(worker) {
  for (const f of (worker?.flaws || [])) if (WS_FLAW_TAG_MAP[f]) return WS_FLAW_TAG_MAP[f];
  return "绵";
}
// 把加工结果落到单个产物上：工分加成 + 评级倍率 + 完美/瑕疵结算
// 基数用 item.baseValue（本阶段纯料值，已剥离历史工分加成），避免多工序间工分加成重复复利
// bonus = 已算好的总价格加成系数（工分/100×CAP + 设备品质%）；gradeMult = 评级倍率
function wsApplyWorker(item, bonus, gradeMult, worker) {
  const base = Number(item.baseValue ?? item.value ?? item.price ?? 0);
  if (base <= 0) return item;
  const v = base * (1 + (bonus || 0)) * (gradeMult || 1);
  item.value = money(v);
  // 完美度标签：工分即完美度，确定性、无随机。完美件/瑕疵件不再有额外价格跳变（价格已完全由工分平滑决定）。
  const score = Number(item.craftScore || 0);
  item.craftPerfect = score >= WS_PERFECT_SCORE;
  item.craftFlaw = (score <= WS_FLAW_SCORE) ? wsCraftFlawTag(worker) : null;
  return item;
}

function legacyDeviceIdForStage(stage) {
  if (stage === "rough") return "opening";
  if (stage === "refine") return "carving";
  if (stage === "inlay") return "finishing";
  return stage;
}

function workshopJobsForDevice(player, deviceId) {
  normalizePlayer(player);
  return (player.jobs || []).filter((job) => (job.deviceId || legacyDeviceIdForStage(job.stage)) === deviceId);
}

function workshopProcessableItems(player, deviceId) {
  normalizePlayer(player);
  const device = workshopDeviceForPlayer(player, deviceId);
  if (!device) return [];
  const bucket = device.inputType === "rough" ? player.rough : player.bracelets;
  return bucket.filter((item) => materialStageFor(item) === device.inputStage);
}

function playerOwnsWorkshop(player) {
  normalizePlayer(player);
  return Boolean(player.assets.workshopOwned);
}

function playerCanLivestream(player) {
  normalizePlayer(player);
  return Boolean(player.assets.livestreamPermitOwned);
}

function assetListingsForPlayer(player) {
  normalizePlayer(player);
  return ASSET_LISTINGS.filter((listing) => {
    if (listing.type === "workshop") return !player.assets.workshopOwned;
    if (listing.type === "livestreamPermit") return !player.assets.livestreamPermitOwned;
    return false;
  });
}

function buyAssetListingForPlayer(player, listingId) {
  if (!player) return { ok: false, message: "未找到玩家。" };
  normalizePlayer(player);
  const listing = ASSET_LISTINGS.find((item) => item.id === listingId);
  if (!listing) return { ok: false, message: "资产挂单不存在。" };
  if (listing.type === "workshop" && player.assets.workshopOwned) {
    return { ok: false, message: "你已经拥有自己的工坊。" };
  }
  if (listing.type === "livestreamPermit" && player.assets.livestreamPermitOwned) {
    return { ok: false, message: "你已经拥有直播经营许可。" };
  }
  if (!spendCash(player, listing.price, `购入资产：${listing.name}`, { source: "asset", itemId: listing.id })) {
    return { ok: false, message: `购买 ${listing.name} 需要 ${listing.price}。` };
  }
  if (listing.type === "workshop") player.assets.workshopOwned = true;
  if (listing.type === "livestreamPermit") player.assets.livestreamPermitOwned = true;
  refreshPlayerReport(player);
  return { ok: true, message: `${listing.name} 已归入名下。`, listing };
}

function queueOfflineEvent(player, event) {
  if (!player || isPlayerOnline(player)) return;
  player.pendingOfflineEvents ||= [];
  player.pendingOfflineEvents.push({
    type: event.type || "system",
    text: String(event.text || ""),
    income: money(event.income),
    expense: money(event.expense),
    readyAt: Number(event.readyAt || Date.now())
  });
  player.pendingOfflineEvents = player.pendingOfflineEvents.slice(-40);
}

function consumePendingOfflineEvents(player, offlineSince, now) {
  player.pendingOfflineEvents ||= [];
  const consumed = [];
  const future = [];
  for (const event of player.pendingOfflineEvents) {
    const readyAt = Number(event.readyAt || 0);
    if (readyAt > offlineSince && readyAt <= now) {
      consumed.push(event);
    } else if (readyAt > now) {
      future.push(event);
    }
  }
  player.pendingOfflineEvents = future;
  return consumed;
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
  const { pendingOfflineEvents, ...safePlayer } = player;
  return {
    ...safePlayer,
    workshop: {
      ...player.workshop,
      devices: player.workshop.devices,
      workers: player.workshop.workers.map((worker) => ({
        ...worker,
        busy: isWorkerBusy(player, worker.id)
      }))
    },
    recruitCandidates: structuredClone(player.recruitCandidates || []),
    jobs: player.jobs.map(publicProductionJob),
    rough: player.rough.map(publicStone),
    polishingJobs: player.polishingJobs.map(publicProductionJob),
    materials: player.materials.map(publicStone),
    slices: player.slices.map(publicStone),
    bracelets: player.bracelets.map(publicStone),
    livestreamJobs: player.livestreamJobs.map(publicLivestreamJob),
    livestreamHistory: player.livestreamHistory.map(publicLivestreamJob),
    collection: player.collection.map(publicStone),
    tasks: (player.tasks || []).map((task) => ({ ...task })),
    taskRefreshedAt: player.taskRefreshedAt || Date.now(),
    taskRefreshMs: TASK_REFRESH_MS
  };
}

function snapshotFor(player, now = Date.now()) {
  normalizePlayer(player);
  settleAuctionIfDue(now);
  const auction = ensureAuctionRound(now);
  return {
    serverNow: now,
    worldStartedAt: state.startedAt,
    timing: {
      day: TIMING.day,
      auction: TIMING.auction
    },
    me: privatePlayerSnapshot(player),
    roughPool: state.roughPool.map(publicStone),
    listings: state.listings.map(publicListing),
    assetListings: assetListingsForPlayer(player),
    materialCatalog: materialCatalogForPlayer(player),
    equipmentCatalog: equipmentCatalog(),
    inlayCatalog: inlayCatalog(),
    auction: publicAuctionSnapshot(auction, player.id, now, state.latestAuctionResults),
    auctionHistory: state.auctionHistory.map((entry) => publicAuctionHistoryEntry(entry, player.id)),
    auctionHalls: publicAuctionHalls(player),
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
    trueQualityKey: trueQuality.key,
    materialStage: "rough"
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

function makeStarterRough(playerId) {
  return {
    ...makeRoughStone(),
    type: "rough",
    owner: playerId,
    revealed: false,
    polished: false,
    materialStage: "rough",
    starter: true
  };
}

function makeStarterRoughs(playerId, count = STARTER_ROUGH_COUNT) {
  return Array.from({ length: count }, () => makeStarterRough(playerId));
}

function auctionRoundDuration() {
  const configured = TIMING.auction.duration ?? ((TIMING.auction.registration || 0) + (TIMING.auction.bidding || 0));
  return money(configured || 10 * 60 * 1000);
}

function auctionEndsAt(round) {
  return Number(round?.endsAt ?? round?.biddingEndsAt ?? 0);
}

function playerEnteredAuction(round, playerId) {
  return (round?.entries || []).some((entry) => entry.playerId === playerId);
}

function createAuctionRound(now = Date.now()) {
  refreshRoughPool();
  const hall = auctionHallForId(DEFAULT_AUCTION_HALL_ID);
  const startsAt = now;
  const endsAt = startsAt + auctionRoundDuration();
  state.auction = {
    id: randomUUID(),
    hallId: hall.id,
    hallLabel: hall.label,
    status: "live",
    startsAt,
    endsAt,
    biddingEndsAt: endsAt,
    entryFee: auctionEntryFee(hall),
    entries: [],
    roughs: state.roughPool.slice(0, 8),
    bids: [],
    results: []
  };
  addNews(`${hall.label}已开场，10 分钟内可入场暗标。`, "info");
  return state.auction;
}

function ensureAuctionRound(now = Date.now()) {
  if (state.auction && !state.auction.settledAt && now < auctionEndsAt(state.auction)) return state.auction;
  if (state.auction && !state.auction.settledAt && now >= auctionEndsAt(state.auction)) {
    settleAuctionIfDue(now);
    return state.auction;
  }
  return createAuctionRound(now);
}

function settleAuctionIfDue(now = Date.now()) {
  const round = state.auction;
  if (!round) {
    ensureAuctionRound(now);
    return false;
  }
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
      return Boolean(bidder && bidder.cash >= money(bid.amount));
    }
  });
  state.latestAuctionResults = settled.results;
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
  for (const result of settled.results) {
    const rough = settled.roughs.find((item) => item.id === result.roughId);
    if (!rough) continue;
    if (!result.winnerId) continue;
    if (result.ai) {
      state.roughPool = state.roughPool.filter((item) => item.id !== rough.id);
      continue;
    }
    const winner = state.players.get(result.winnerId);
    if (!winner) continue;
    spendCash(winner, result.price, `公盘成交：${rough.name}`, { source: "auction", itemId: rough.id });
    state.roughPool = state.roughPool.filter((item) => item.id !== rough.id);
    winner.rough.push({ ...rough, type: "rough", owner: winner.id, revealed: false, polished: false, materialStage: "rough" });
    advanceTask(winner, "auction_win");
    queueOfflineEvent(winner, {
      type: "auction",
      text: `公盘中标：${rough.name} 成交 ${money(result.price)}，已入库`,
      income: 0,
      expense: result.price,
      readyAt: settled.settledAt
    });
    refreshPlayerReport(winner);
    addNews(`${winner.name} 暗标中标 ${rough.name}，成交 ${result.price}。`, "trade");
  }
  refreshRoughPool();
  addNews(`${settled.hallLabel || "公盘"}开标完成，新一场已接续。`, "trade");
  createAuctionRound(now);
  return true;
}

function processAuctionLifecycle(now = Date.now()) {
  const settled = settleAuctionIfDue(now);
  if (!state.auction) ensureAuctionRound(now);
  return settled;
}

function enterAuctionForPlayer(player, payload = {}, now = Date.now()) {
  if (!player) return { ok: false, message: "未找到玩家。" };
  normalizePlayer(player);
  const hallId = payload?.hallId || DEFAULT_AUCTION_HALL_ID;
  if (hallId !== DEFAULT_AUCTION_HALL_ID) return { ok: false, message: "该公盘入口暂未开放。" };
  if (state.auction && !state.auction.settledAt && now >= auctionEndsAt(state.auction)) {
    settleAuctionIfDue(now);
  }
  const round = ensureAuctionRound(now);
  if (round.settledAt || now >= auctionEndsAt(round)) return { ok: false, message: "本场拍卖已截止。" };
  const existing = (round.entries || []).find((entry) => entry.playerId === player.id);
  if (existing) return { ok: true, message: "已入场本场公盘。", entryFee: existing.fee, entry: existing };
  const entryFee = money(round.entryFee ?? auctionEntryFee(auctionHallForId(round.hallId)));
  if (entryFee > 0 && !spendCash(player, entryFee, `公盘入场费：${round.hallLabel || "公盘"}`, { source: "auctionEntry", itemId: round.id, repEligible: false })) {
    return { ok: false, message: `入场费需要 ${entryFee}。` };
  }
  const next = enterAuctionRound(round, { playerId: player.id, fee: entryFee, at: now });
  state.auction = next.round;
  addNews(`${player.name} 入场了${round.hallLabel || "公盘"}。`, "info");
  return { ok: true, message: "入场成功。", entryFee, entry: next.entry };
}

function joinAuctionForPlayer(player, payload = {}, now = Date.now()) {
  return enterAuctionForPlayer(player, payload, now);
}

function submitAuctionBidForPlayer(player, payload, now = Date.now()) {
  if (!player) return { ok: false, message: "未找到玩家。" };
  if (!payload || typeof payload !== "object") return { ok: false, message: "投标参数无效。" };
  normalizePlayer(player);
  if (state.auction && !state.auction.settledAt && now >= auctionEndsAt(state.auction)) {
    settleAuctionIfDue(now);
    return { ok: false, message: "本场拍卖已截止，已进入下一场。" };
  }
  const round = ensureAuctionRound(now);
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
  if (bidAmount < rough.price) return { ok: false, message: "暗标不能低于底价。" };
  const next = upsertBid(round, {
    playerId: player.id,
    roughId,
    amount: bidAmount,
    at: now
  });
  state.auction = next.round;
  addNews(`${player.name} 提交了 ${rough.name} 的密封投标。`, "info");
  return { ok: true, message: "暗标已提交。", bid: next.bid };
}

function requestAuctionWindowForPlayer(player, payload, now = Date.now()) {
  if (!player) return { ok: false, message: "未找到玩家。" };
  const { roughId, x, y } = normalizeWindowPayload(payload);
  if (state.auction && !state.auction.settledAt && now >= auctionEndsAt(state.auction)) {
    settleAuctionIfDue(now);
    return { ok: false, message: "当前公盘已停止开窗，已进入下一场。" };
  }
  const round = ensureAuctionRound(now);
  if (round.settledAt || now >= auctionEndsAt(round)) {
    return { ok: false, message: "当前公盘已停止开窗。" };
  }
  if (!playerEnteredAuction(round, player.id)) {
    return { ok: false, message: "请先入场本场公盘。" };
  }
  const rough = round.roughs.find((item) => item.id === roughId);
  if (!rough) return { ok: false, message: "这块原石不在当前公盘。" };
  const hall = AUCTION_HALLS.find((h) => h.id === round.hallId) || AUCTION_HALLS[0];
  const fee = money(rough.price * (hall.windowRate ?? OPEN_WINDOW_RATE));
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
    assets: {
      workshopOwned: true,
      livestreamPermitOwned: false
    },
    offlineSummary: null,
    ledger: [],
    lastSeenAt: Date.now(),
    reports: [],
    rough: makeStarterRoughs(playerId),
    starterRoughGranted: true,
    jobs: [],
    externalMaterials: {
      goldPure: 0,
      silver925: 0,
      gold18k: 0,
      platinum: 0,
      diamond: 0,
      ruby: 0,
      sapphire: 0
    },
    polishingJobs: [],
    materials: [],
    slices: [],
    bracelets: [],
    livestreamJobs: [],
    livestreamHistory: [],
    collection: [],
    orders: [],
    payouts: [],
    soldCount: 0,
    pendingOfflineEvents: [],
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
  normalizeAssets(player);
  player.rough ||= [];
  if (player.starterRoughGranted !== true && player.rough.length === 0) {
    player.rough.push(...makeStarterRoughs(player.id));
  }
  player.rough = player.rough.map((rough) => ({
    ...rough,
    type: "rough",
    materialStage: materialStageFor(rough)
  }));
  player.starterRoughGranted = true;
  player.jobs ||= [];
  const em = player.externalMaterials ||= {};
  player.externalMaterials = {
    goldPure:  Number(em.goldPure) || 0,
    silver925: Number(em.silver925 ?? em.silverMount) || 0,
    gold18k:   Number(em.gold18k ?? em.goldMount) || 0,
    platinum:  Number(em.platinum) || 0,
    diamond:   Number(em.diamond ?? em.diamondChips) || 0,
    ruby:      Number(em.ruby) || 0,
    sapphire:  Number(em.sapphire) || 0
  };
  player.polishingJobs ||= player.cuttingJobs || [];
  player.cuttingJobs = [];
  player.materials ||= [];
  player.slices ||= [];
  player.bracelets ||= [];
  player.bracelets = player.bracelets.map((product) => ({
    ...product,
    materialStage: materialStageFor(product)
  }));
  player.livestreamJobs ||= [];
  player.livestreamHistory ||= [];
  player.collection ||= [];
  player.orders ||= [];
  player.ledger ||= [];
  player.offlineSummary ||= null;
  player.pendingOfflineEvents ||= [];
  player.reports ||= [];
  player.lastSeenAt ||= Date.now();
  player.stats ||= {};
  player.stats.cutCount ||= 0;
  player.stats.sliceCount ||= 0;
  player.stats.splitCount ||= 0;
  player.stats.craftCount ||= 0;
  player.stats.orderCount ||= 0;
  player.stats.tradeCount ||= 0;
  player.tasks ||= [];
  player.taskRefreshedAt ||= Date.now();
  refreshTasksIfDue(player);
  normalizeWorkshop(player);
}

function inventoryForReport(player) {
  const activeProductionItems = [
    ...(player.jobs || []),
    ...(player.polishingJobs || [])
  ].map((job) => job?.item || job?.rough).filter(Boolean);
  const activeLivestreamProducts = (player.livestreamJobs || []).map((job) => job?.product).filter(Boolean);
  const ownedListings = state.listings
    .filter((listing) => listing.ownerId === player.id)
    .map((listing) => listing.item)
    .filter(Boolean);
  return [
    ...(player.rough || []),
    ...activeProductionItems,
    ...(player.materials || []),
    ...(player.slices || []),
    ...(player.bracelets || []),
    ...activeLivestreamProducts,
    ...ownedListings
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

function restoreWorkshopItem(player, item) {
  if (!item) return;
  if (item.type === "rough") {
    restoreRoughToInventory(player, item);
    return;
  }
  player.bracelets.push(item);
}

function findWorkshopItem(player, device, itemId) {
  const bucket = device.inputType === "rough" ? player.rough : player.bracelets;
  return bucket.find((item) => item.id === itemId) || null;
}

function startProductionJob(player, stage, item, options = {}) {
  const stageCost = money(options.fee ?? ({ rough: 620, refine: 900, inlay: 680 }[stage] || 620));
  if (!options.feeAlreadyPaid && !spendCash(
    player,
    stageCost,
    `${options.label || stage}：${item.name}`,
    { source: "production", itemId: item.id }
  )) {
    return null;
  }
  const now = Date.now();
  const durationStage = options.durationStage || stage;
  const job = {
    id: randomUUID(),
    type: "productionJob",
    stage,
    deviceId: options.deviceId,
    deviceAttrs: options.deviceAttrs,
    workerId: options.workerId,
    outputStage: options.outputStage,
    outputPreview: options.outputPreview,
    item,
    options,
    fee: stageCost,
    startedAt: now,
    readyAt: now + Math.round(productionDuration(durationStage, TIMING_PROFILE) * (options.timeScale || 1))
  };
  player.jobs.push(job);
  return job;
}

function startRoughOpeningForPlayer(player, roughId) {
  return startWorkshopJobForPlayer(player, "opening", { itemId: roughId });
}

function startWorkshopJobForPlayer(player, deviceId, payload = {}) {
  if (!player) return { ok: false, message: "未找到玩家。" };
  normalizePlayer(player);
  if (!playerOwnsWorkshop(player)) return { ok: false, message: "先去交易行买下街角小工坊。" };
  const device = workshopDeviceForPlayer(player, deviceId);
  if (!device) return { ok: false, message: "这台设备不存在。" };
  if (Number(device.condition ?? 100) <= 0) {
    return { ok: false, message: "这台设备耐久已耗尽，请先维修。" };
  }
  if (workshopJobsForDevice(player, device.id).length >= 1) {
    return { ok: false, message: "这台设备正在加工；每台设备容量固定为 1，不设等待队列。" };
  }
  const worker = workshopWorkerForPlayer(player, payload.workerId || device.workerId);
  if (!worker) {
    return { ok: false, code: "NOT_FOUND", message: "这位师傅不存在。" };
  }
  if (isWorkerBusy(player, worker.id)) {
    return { ok: false, code: "WORKER_BUSY", message: "这位师傅正在执行其他任务。" };
  }
  const itemId = payload?.itemId || payload?.roughId || payload?.productId || payload?.braceletId;
  if (device.stage === "finishing") {
    const previewItem = findWorkshopItem(player, device, itemId);
    if (!previewItem) {
      return { ok: false, code: "NOT_FOUND", message: "找不到可加工物料。" };
    }
    if (materialStageFor(previewItem) !== device.inputStage) {
      return {
        ok: false,
        code: "INVALID_COMBINATION",
        message: "这台设备不能处理当前阶段的物料。"
      };
    }
    const validation = validateFinishPlan(previewItem, payload.finishPlan);
    if (!validation.ok) return validation;
    const quote = quoteFinishPlan(previewItem, payload.finishPlan);
    if (player.cash < quote.laborFee) {
      return {
        ok: false,
        code: "INSUFFICIENT_CASH",
        message: `精加工人工费需要 ¥${quote.laborFee}。`
      };
    }
    const item = takeItem(player, device.inputType, itemId);
    const reserve = reserveFinishMaterials(player, quote);
    if (!reserve.ok) {
      restoreWorkshopItem(player, item);
      return reserve;
    }
    if (!spendCash(
      player,
      quote.laborFee,
      `精加工：${item.name}`,
      { source: "workshop", itemId: item.id }
    )) {
      refundFinishMaterials(player, reserve.reservedMaterials);
      restoreWorkshopItem(player, item);
      return {
        ok: false,
        code: "INSUFFICIENT_CASH",
        message: "现金不足，无法开工。"
      };
    }
    const devSpeed = Number(device.attrs?.speed || 0);
    const devTimeScale = Math.max(0.2, 1 - Math.min(0.8, devSpeed / 100));
    const job = startProductionJob(player, device.stage, item, {
      label: device.name,
      fee: quote.laborFee,
      feeAlreadyPaid: true,
      durationStage: device.durationStage,
      deviceId: device.id,
      deviceAttrs: device.attrs,
      workerId: worker.id,
      timeScale: wsSpeedTimeScale(worker) * devTimeScale,
      outputStage: device.outputStage,
      outputPreview: { materialStage: device.outputStage }
    });
    job.finishPlan = structuredClone(payload.finishPlan);
    job.inlayQuote = quote;
    job.reservedMaterials = reserve.reservedMaterials;
    refreshPlayerReport(player);
    return { ok: true, message: `${device.name} 已开工。`, job, device, worker, fee: job.fee };
  }
  const item = takeItem(player, device.inputType, itemId);
  if (!item) return { ok: false, message: "找不到可加工物料。" };
  const inputStage = materialStageFor(item);
  if (inputStage !== device.inputStage) {
    restoreWorkshopItem(player, item);
    return { ok: false, message: "这台设备不能处理当前阶段的物料。" };
  }

  let normalizedKits = [];
  if (device.needsKits) {
    normalizedKits = normalizeExtractionKits(payload?.kits || []);
    const legacyKits = !normalizedKits.length && Array.isArray(payload?.placements)
      ? payload.placements.map((placement) => ({ ...placement, type: "bangle" }))
      : [];
    normalizedKits = normalizedKits.length ? normalizedKits : normalizeExtractionKits(legacyKits);
    const placements = expandKitPlacements(normalizedKits);
    if (!placements.length) {
      restoreWorkshopItem(player, item);
      return { ok: false, message: "请先在明料上摆放套件。" };
    }
    const existingKits = normalizeExtractionKits(item.extractionKits || item.braceletPlacements || []);
    const existingPlacements = expandKitPlacements(existingKits);
    if (placementsOverlap([...existingPlacements, ...placements])) {
      restoreWorkshopItem(player, item);
      return { ok: false, message: "套件位置互相重叠，重新摆一下。" };
    }
    item.extractionKits = [...existingKits, ...normalizedKits].slice(0, 10);
    item.braceletPlacements = item.extractionKits;
  }

  const devSpeed = Number(device.attrs?.speed || 0);
  const devTimeScale = Math.max(0.2, 1 - Math.min(0.8, devSpeed / 100));
  const job = startProductionJob(player, device.stage, item, {
    label: device.name,
    fee: device.fee,
    durationStage: device.durationStage,
    deviceId: device.id,
    deviceAttrs: device.attrs,
    workerId: worker?.id || device.workerId,
    timeScale: (worker ? wsSpeedTimeScale(worker) : 1) * devTimeScale,
    outputStage: device.outputStage,
    outputPreview: { materialStage: device.outputStage },
    kits: normalizedKits
  });
  if (!job) {
    restoreWorkshopItem(player, item);
    return { ok: false, message: "现金不足，无法开工。" };
  }
  refreshPlayerReport(player);
  return { ok: true, message: `${device.name} 已开工。`, job, device, worker, fee: job.fee };
}

function openingStoneForRough(rough) {
  return buildOpeningStone({
    seed: `${rough.id}:${rough.openingSeed || rough.visual?.openingSeed || rough.visual?.seed || rough.id}`,
    roughId: rough.id
  });
}

function openingKitForPlacement(placement) {
  return {
    uid: placement.kitId || placement.id,
    tpl: placement.openingTpl || openingTplForKit(placement, placement.kitType),
    x: clamp(Number(placement.x) || 50, 4, 96) * 6,
    y: clamp(Number(placement.y) || 50, 4, 96) * 6,
    rot: Number(placement.rot || 0),
    scale: Number(placement.scale || 1)
  };
}

function extractProductsFromJob(job) {
  const rough = job.item;
  const normalizedKits = normalizeExtractionKits(job.options?.kits || []);
  const placements = expandKitPlacements(normalizedKits);
  const combinedKits = normalizeExtractionKits(rough.extractionKits || rough.braceletPlacements || []);
  const combinedPlacements = expandKitPlacements(combinedKits.length ? combinedKits : normalizedKits);
  const totalSlots = Math.max(1, combinedPlacements.length);
  const valueBase = Math.max(rough.value || rough.price, rough.price) / Math.max(2, totalSlots + 1);
  const openingStone = openingStoneForRough(rough);
  return placements.map((placement) => {
    const placementScore = scoreRoughPlacement(rough, placement);
    const productMeta = kitProductMeta(placement);
    const openingEval = evaluateOpeningKit(openingKitForPlacement(placement), openingStone);
    const openingGrade = computeOpeningGrade(openingEval, openingStone);
    const openingValue = openingEval.price > 0
      ? openingEval.price
      : money(valueBase * productMeta.mult * placementScore);
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
      value: money(openingValue),
      rep: Math.max(1, Math.round((rough.rep * productMeta.rep * 0.35 + rough.score * 2 + openingGrade.score * 0.08) * clamp(placementScore, 0.72, 1.18))),
      count: productMeta.count,
      sourceRoughId: rough.id,
      plan: placement,
      openingGrade,
      openingEval: {
        price: openingEval.price,
        crackRatio: openingEval.crackRatio,
        wasteRatio: openingEval.wasteRatio,
        avgCv: openingEval.avgCv,
        avgRar: openingEval.avgRar
      },
      sourceMaterial: {
        roughId: rough.id,
        roughName: rough.name,
        visual: rough.visual,
        windows: rough.windows || [],
        placement,
        openingTpl: placement.openingTpl,
        openingGrade,
        templateSize: { w: placement.templateSize?.w, h: placement.templateSize?.h },
        mass: rough.mass,
        qualityKey: rough.qualityKey,
        color: rough.color
      },
      placementScore: Math.round(placementScore * 100),
      baseName: `${rough.quality}${rough.color}${productMeta.label}`,
      materialStage: "carved",
      stage: "carved"
    };
  });
}

function productBaseName(product) {
  if (product.baseName) return product.baseName;
  return String(product.name || "翡翠成品").replace(/(?:精雕毛坯|抛光半成品|成品|镶嵌款)+$/u, "");
}

function stagedProduct(product, materialStage, suffix, valueMultiplier = 1, extra = {}) {
  const baseName = productBaseName(product);
  return {
    ...product,
    ...extra,
    baseName,
    name: suffix ? `${baseName}${suffix}` : baseName,
    materialStage,
    stage: materialStage,
    value: money(Number(product.value || product.price || 0) * valueMultiplier)
  };
}

function restoreRoughToInventory(player, rough) {
  const existingIndex = player.rough.findIndex((item) => item.id === rough.id);
  if (existingIndex >= 0) {
    player.rough[existingIndex] = { ...player.rough[existingIndex], ...rough };
    return;
  }
  player.rough.push(rough);
}

function applyJobDurability(player, job) {
  if (!job?.deviceId || job.durabilityApplied) return 0;
  job.durabilityApplied = true;
  const device = workshopDeviceForPlayer(player, job.deviceId);
  if (!device) return 0;
  const loss = durabilityLoss(device);
  device.condition = clamp(Number(device.condition ?? 100) - loss, 0, 100);
  return loss;
}

function completeProductionJob(player, job) {
  applyJobDurability(player, job);
  const activity = workshopDeviceForPlayer(player, job.deviceId)?.stage
    || ({ rough: "opening", refine: "carving", inlay: "finishing" }[job.stage])
    || job.stage;
  const worker = job.workerId ? workshopWorkerForPlayer(player, job.workerId) : null;
  const xpResult = worker
    ? grantActivityExperience(worker, activity)
    : { grants: {}, levelUps: [] };
  const step = wsStageToStep(job.stage);
  const applyWorker = Boolean(worker && step);
  const stepScore = applyWorker ? wsStepScore(worker, step) : 0;

  // 设备属性（固定阶数道具，加工时生效）：品质加成%（抬高价格）+ 完美保底%（抬高工分下限，即「完美度保底」）；风险仅影响碎裂（见下方）
  const devAttrs = job.deviceAttrs || (job.deviceId ? (workshopDeviceForPlayer(player, job.deviceId)?.attrs) : null);
  const deviceQualityBonus = devAttrs ? (Number(devAttrs.quality) || 0) / 100 : 0;
  const deviceScoreFloor = devAttrs ? ((Number(devAttrs.perfectFloor) || 0) / 100) * 120 : 0;

  // 碎裂判定（员工 + 设备共同决定）：设备风险>1 触发基础碎裂率，员工词条/技能上调或下调
  let shattered = false;
  if (devAttrs && (Number(devAttrs.risk) || 1) > 1) {
    const baseShatter = Math.max(0, (Number(devAttrs.risk) || 1) - 1) * 0.08;
    const defense = employeeShatterDefense(worker);
    const shatterProb = clamp(baseShatter + defense, 0, 0.95);
    if (Math.random() < shatterProb) shattered = true;
  }
  if (shattered) {
    if (activity === "finishing") {
      restoreWorkshopItem(player, job.item);
      refundFinishMaterials(player, job.reservedMaterials);
      job.reservedMaterials = {};
      return {
        text: `${job.item.name} 精加工失败，翡翠与镶嵌材料已退回`,
        item: null,
        shattered: true,
        refunded: true,
        xpResult
      };
    }
    return { text: `碎裂！${job.item?.name || "物料"} 材料全损`, item: null, shattered: true, xpResult };
  }

  // 把本工序工分子分累计到产物，并按「仅已完成工序」聚合出总工分（=完美度）+ 评级；
  // 价格 = baseValue(本阶段纯料值，已剥离历史工分加成) × (1 + 总工分/100×占比上限 + 设备品质%) × 评级倍率。
  // 工分即完美度，不再有完美/瑕疵的随机价格跳变；设备「完美保底」作为工分下限兜底。
  // 用 baseValue 而非 item.value 作基数，避免工分加成在多个工序间重复复利。
  function priceByCraft(item) {
    item.craftScores = { ...(item.craftScores || {}), [step]: stepScore };
    item.craftWorkers = { ...(item.craftWorkers || {}), [step]: worker?.name || "无" };
    let overall = Math.round(wsOverallScore(item));
    if (deviceScoreFloor > 0) overall = Math.max(overall, Math.round(deviceScoreFloor));
    item.craftScore = overall;
    item.craftGrade = wsCraftGrade(overall);
    const bonus = (overall / 100) * WS_PROCESS_BONUS_CAP + deviceQualityBonus;
    wsApplyWorker(item, bonus, wsGradeMult(overall), worker);
    return item;
  }

  if (job.stage === "rough" || job.stage === "opening") {
    const polished = revealPolishedRough(job.item);
    polished.baseValue = Number(polished.value || polished.price || 0); // 开料首步：料值即纯料值
    priceByCraft(polished);
    polished.stage = "material";
    polished.materialStage = "opened";
    player.rough.push(polished);
    player.rep += Math.max(1, Math.round(polished.rep * 0.45));
    return { text: `${polished.name} 开料完成`, item: polished, xpResult };
  }
  if (job.stage === "refine" || job.stage === "carving") {
    const prevScores = job.item.craftScores || {};
    const prevWorkers = job.item.craftWorkers || {};
    const inBase = Number(job.item.baseValue ?? job.item.value ?? job.item.price ?? 0);
    const inVal = Number(job.item.value ?? job.item.price ?? 0);
    const products = extractProductsFromJob(job).map((product) => {
      const p = stagedProduct(product, "carved", "精雕毛坯");
      const tf = inVal > 0 ? (Number(p.value || 0) / inVal) : 1;
      p.baseValue = inBase * tf; // 纯料值（剥离上一步工分加成）
      p.craftScores = { ...prevScores, [step]: stepScore };
      p.craftWorkers = { ...prevWorkers, [step]: worker?.name || "无" };
      let overall = Math.round(wsOverallScore(p));
      if (deviceScoreFloor > 0) overall = Math.max(overall, Math.round(deviceScoreFloor));
      p.craftScore = overall;
      p.craftGrade = wsCraftGrade(overall);
      const bonus = (overall / 100) * WS_PROCESS_BONUS_CAP + deviceQualityBonus;
      wsApplyWorker(p, bonus, wsGradeMult(overall), worker);
      return p;
    });
    player.bracelets.push(...products);
    restoreRoughToInventory(player, { ...job.item, materialStage: "opened", stage: "material" });
    player.stats.craftCount += products.length;
    return { text: `${job.item.name} 精雕完成`, item: job.item, xpResult };
  }
  // 精加工 = 员工工分结算 + 玩家镶嵌方案，材料与工艺倍率由权威报价统一应用。
  const hasFinishPlan = Boolean(job.finishPlan && job.inlayQuote);
  const finished = stagedProduct(
    job.item,
    "finished",
    "",
    hasFinishPlan ? 1 : 1.2096,
    { inlaid: hasFinishPlan, polished: true }
  );
  const finInBase = Number(job.item.baseValue ?? job.item.value ?? job.item.price ?? 0);
  const finInVal = Number(job.item.value ?? job.item.price ?? 0);
  const finTf = finInVal > 0 ? (Number(finished.value || 0) / finInVal) : 1;
  finished.baseValue = finInBase * finTf; // 纯料值（剥离上一步工分加成）
  priceByCraft(finished);
  if (hasFinishPlan) {
    applyInlay(finished, job.finishPlan, job.inlayQuote);
    job.reservedMaterials = {};
  }
  player.bracelets.push(finished);
  return { text: `${finished.name} 精加工完成`, item: finished, xpResult };
}

function livestreamWorkerForPlayer(player, requestedWorkerId) {
  const workers = player.workshop?.workers || [];
  const requested = workers.find((worker) => worker.id === requestedWorkerId);
  if (requested && !isWorkerBusy(player, requested.id)) return requested;
  return workers.find(
    (worker) => worker.job === "streamer" && !isWorkerBusy(player, worker.id)
  ) || workers.find((worker) => !isWorkerBusy(player, worker.id)) || null;
}

function scheduleLivestream(player, productId, mode = "autoBalanced", workerId = null) {
  normalizePlayer(player);
  if (!playerCanLivestream(player)) return null;
  const worker = livestreamWorkerForPlayer(player, workerId);
  if (!worker) return null;
  const product = takeItem(player, "bracelet", productId);
  if (!product) return null;
  if (materialStageFor(product) !== "finished") {
    restoreWorkshopItem(player, product);
    return null;
  }
  const now = Date.now();
  const duration = TIMING.livestream.min;
  const job = {
    id: randomUUID(),
    type: "livestreamJob",
    mode,
    product,
    workerId: worker.id,
    startedAt: now,
    readyAt: now + duration
  };
  player.livestreamJobs.push(job);
  refreshPlayerReport(player, now);
  return job;
}

function sellLivestreamNow(player, productId, seed = Date.now(), workerId = null) {
  normalizePlayer(player);
  if (!playerCanLivestream(player)) return null;
  const worker = livestreamWorkerForPlayer(player, workerId);
  if (!worker) return null;
  const product = takeItem(player, "bracelet", productId);
  if (!product) return null;
  if (materialStageFor(product) !== "finished") {
    restoreWorkshopItem(player, product);
    return null;
  }
  const now = Date.now();
  const priced = livestreamOutcome(product, { mode: "manual", rep: player.rep, seed });
  const outcome = {
    ...priced,
    sold: true,
    price: priced.price || money(Number(product.value || product.price || 0) * Math.max(1, priced.multiplier || 1))
  };
  earnCash(player, outcome.price, `直播成交：${product.name}`, { source: "livestream", itemId: product.id, at: now });
  player.rep += Math.max(1, Math.round(product.rep * 0.18));
  const xpResult = grantActivityExperience(worker, "livestream");
  player.livestreamHistory.unshift({
    id: randomUUID(),
    type: "livestreamManual",
    mode: "manual",
    workerId: worker.id,
    product,
    outcome,
    startedAt: now,
    readyAt: now,
    completedAt: now
  });
  player.livestreamHistory = player.livestreamHistory.slice(0, 20);
  refreshPlayerReport(player, now);
  return { product, outcome, worker, xpResult };
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
  return placementRadiusForKind(placement.layout || placement.kind || "bracelet", placement);
}

const KIT_BOARD_REFERENCE = { width: 412, height: 148 };

function templateWidthOnBoard(width) {
  return (Number(width) || 28) * KIT_BOARD_REFERENCE.height / KIT_BOARD_REFERENCE.width;
}

function normalizePlacement(rawPlacement, fallbackLayout = "bracelet") {
  const placement = rawPlacement && typeof rawPlacement === "object" ? rawPlacement : {};
  const allowedLayouts = new Set(Object.values(EXTRACTION_KITS).flatMap((kit) => kit.slots.map((slot) => slot.layout)));
  const layout = allowedLayouts.has(placement.layout) ? placement.layout : fallbackLayout;
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

function openingTplForKit(kit, type) {
  if (kit?.openingTpl && OPENING_KIT_SERVER_TYPES[kit.openingTpl]) return kit.openingTpl;
  return OPENING_KIT_BY_SERVER_TYPE[type] || "ping";
}

function normalizeExtractionKits(rawKits) {
  const source = Array.isArray(rawKits) ? rawKits : [];
  return source.slice(0, 10).map((kit) => {
    const type = EXTRACTION_KITS[kit?.type] ? kit.type : "bangle";
    const ringSize = clamp(Number(kit?.ringSize) || 56, 52, 62);
    return {
      id: typeof kit?.id === "string" ? kit.id.slice(0, 36) : randomUUID(),
      type,
      openingTpl: openingTplForKit(kit, type),
      x: clamp(Number(kit?.x) || 50, 4, 96),
      y: clamp(Number(kit?.y) || 50, 4, 96),
      rot: normalizeAngle(Number(kit?.rot ?? kit?.rotation ?? 0)),
      scale: clamp(Number(kit?.scale) || 1, 0.45, 1.45),
      ringSize: type === "bangle" ? Math.round(ringSize / 2) * 2 : undefined
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
      placement.openingTpl = kit.openingTpl;
      placement.rot = kit.rot || 0;
      placement.scale = kit.scale || 1;
      placement.templateLabel = template.label;
      placement.templateSize = { w: template.w, h: template.h };
      return placement;
    });
  });
}

function kitProductMeta(placement) {
  return productMetaForKind(placement.layout, placement);
}

function placementTemplateSize(placement) {
  const kitTypeByLayout = Object.fromEntries(Object.entries(EXTRACTION_KITS).map(([type, kit]) => [kitLayout(type), type]));
  const template = EXTRACTION_KITS[placement.kitType] || EXTRACTION_KITS[kitTypeByLayout[placement.layout]];
  const size = placement.templateSize || template || {};
  return {
    w: clamp(Number(size.w) || placementRadius(placement) * 2, 8, 60),
    h: clamp(Number(size.h) || placementRadius(placement) * 2, 8, 60)
  };
}

function placementFootprint(placement) {
  const { w, h } = placementTemplateSize(placement);
  const boardWidth = templateWidthOnBoard(w);
  if (placement.layout === "bracelet") return { rx: boardWidth * 0.46, ry: h * 0.46 };
  if (placement.layout === "cabochon") return { rx: boardWidth * 0.24, ry: h * 0.34 };
  if (placement.layout === "peacePendant") {
    return { rx: boardWidth * 0.42, ry: h * 0.42 };
  }
  if (placement.layout === "ruyiPendant") return { rx: boardWidth * 0.38, ry: h * 0.42 };
  if (placement.layout === "leafPendant") return { rx: boardWidth * 0.3, ry: h * 0.37 };
  if (placement.layout === "dropPendant") return { rx: boardWidth * 0.31, ry: h * 0.38 };
  if (placement.layout === "plaque") return { rx: boardWidth * 0.34, ry: h * 0.36 };
  if (placement.layout === "buddhaPendant") return { rx: boardWidth * 0.32, ry: h * 0.38 };
  if (placement.layout === "guanyinPendant") return { rx: boardWidth * 0.3, ry: h * 0.39 };
  if (placement.layout === "fuBeanPendant") return { rx: boardWidth * 0.3, ry: h * 0.34 };
  if (placement.layout === "gourdPendant") return { rx: boardWidth * 0.3, ry: h * 0.34 };
  if (placement.layout === "beads") return { rx: boardWidth * 0.46, ry: h * 0.34 };
  return { rx: boardWidth * 0.5, ry: h * 0.5 };
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
  const smallPieceBonus = isSmallPieceKind(placement.layout) ? 0.05 : 0;
  return clamp(0.82 + colorBonus + windowBonus + sizeBonus + smallPieceBonus - edgePenalty - crackPenalty, 0.5, 1.22);
}

function revealPolishedRough(rough) {
  const quality = qualityByKey(rough.trueQualityKey);
  return {
    ...rough,
    type: "rough",
    revealed: true,
    polished: true,
    materialStage: "opened",
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
    events.push({
      type: "production",
      text: result.text,
      income: 0,
      expense: 0,
      readyAt: job.readyAt,
      levelUps: result.xpResult?.levelUps || []
    });
    if (result.xpResult?.levelUps?.length) {
      const worker = workshopWorkerForPlayer(player, job.workerId);
      emitUiEventToPlayer(player, {
        type: "float",
        tone: "craft",
        text: `${worker?.name || "员工"} 技能升级`,
        x: 58,
        y: 56
      });
    }
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
    const worker = workshopWorkerForPlayer(player, job.workerId);
    const outcome = livestreamOutcome(job.product, { mode: job.mode, rep: player.rep, seed: job.readyAt });
    if (outcome.sold) {
      earnCash(player, outcome.price, `直播成交：${job.product.name}`, { source: "livestream", itemId: job.product.id, at: now });
      const repGain = Math.max(1, Math.round(job.product.rep * 0.18));
      player.rep += repGain;
      const xpResult = worker
        ? grantActivityExperience(worker, "livestream")
        : { grants: {}, levelUps: [] };
      events.push({
        type: "livestream",
        text: `${job.product.name} 自动直播成交 ${outcome.price}`,
        income: outcome.price,
        expense: 0,
        readyAt: job.readyAt,
        levelUps: xpResult.levelUps
      });
      if (xpResult.levelUps.length) {
        emitUiEventToPlayer(player, {
          type: "float",
          tone: "trade",
          text: `${worker.name} 直播技能升级`,
          x: 62,
          y: 58
        });
      }
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
  if (state.auction && !state.auction.settledAt && now >= auctionEndsAt(state.auction)) {
    settleAuctionIfDue(now);
  }
  events.push(...consumePendingOfflineEvents(player, offlineSince, now));
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
  if (!wasOnline) settleOfflinePlayer(player);
  state.sockets.set(socket.id, playerId);
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
    socket.emit("toast", result.message);
    emitUiEvent(socket, {
      type: "float",
      tone: "trade",
      text: result.message,
      x: 70,
      y: 62
    });
    broadcast();
  });

  socket.on("joinAuction", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    const result = joinAuctionForPlayer(player, payload);
    socket.emit("toast", result.message);
    if (result.ok) {
      emitUiEvent(socket, {
        type: "float",
        tone: "expense",
        text: result.entryFee ? `入场费 -${uiMoney(result.entryFee)}` : "已入场本场公盘",
        x: 66,
        y: 68
      });
      broadcast();
    }
  });

  socket.on("enterAuction", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    const result = enterAuctionForPlayer(player, payload);
    socket.emit("toast", result.message);
    if (result.ok) {
      emitUiEvent(socket, {
        type: "float",
        tone: "expense",
        text: result.entryFee ? `入场费 -${uiMoney(result.entryFee)}` : "已入场本场公盘",
        x: 66,
        y: 68
      });
      broadcast();
    }
  });

  socket.on("buyRough", () => {
    socket.emit("toast", "公盘已改为暗标，请提交密封投标。");
  });

  socket.on("requestWindow", (payload) => {
    const player = getPlayer(socket);
    const result = requestAuctionWindowForPlayer(player, payload);
    if (!result.ok) return socket.emit("toast", result.message);
    emitUiEvent(socket, {
      type: "float",
      tone: "craft",
      text: "开窗完成",
      x: 58,
      y: 52
    });
    advanceTask(player, "window_open");
    broadcast();
  });

  socket.on("startPolish", (rawPayload) => {
    const player = getPlayer(socket);
    if (!player) return;
    const { roughId, requestId } = normalizeMutationPayload(rawPayload);
    if (!consumeRequestId(player, requestId)) {
      return socket.emit("toast", "该开工请求缺少有效编号或已处理，请勿重复提交。");
    }
    const result = startRoughOpeningForPlayer(player, roughId);
    if (!result.ok) return socket.emit("toast", result.message);
    addNews(`${player.name} 将 ${result.job.item.name} 安排到开料机。`, "craft");
    advanceTask(player, "workshop_craft");
    emitUiEvent(socket, {
      type: "float",
      tone: "expense",
      text: `出加工 -${uiMoney(result.fee)}`,
      x: 62,
      y: 64
    });
    broadcast();
  });

  socket.on("refreshRecruitCandidates", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!consumeRequestId(player, payload.requestId)) {
      return socket.emit("toast", "该刷新请求已处理，请勿重复提交。");
    }
    const result = refreshRecruitCandidates(player, {
      rng: Math.random,
      makeId: randomUUID,
      spendCash
    });
    socket.emit("toast", result.message);
    if (result.ok) broadcast();
  });

  socket.on("recruitWorker", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!consumeRequestId(player, payload.requestId)) {
      return socket.emit("toast", "该招聘请求已处理，请勿重复提交。");
    }
    normalizePlayer(player);
    const result = recruitWorker(player, payload.candidateId, { spendCash });
    socket.emit("toast", result.message);
    if (!result.ok) return;
    addNews(`${player.name} 招聘了 ${result.worker.name}。`, "craft");
    broadcast();
  });

  socket.on("buyWorkshopDevice", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!consumeRequestId(player, payload.requestId)) {
      return socket.emit("toast", "该购买请求已处理，请勿重复提交。");
    }
    normalizePlayer(player);
    if (!playerOwnsWorkshop(player)) return socket.emit("toast", "先购买街角小工坊，再添置设备。");
    const result = buyEquipment(player, payload.modelKey, {
      spendCash,
      makeId: randomUUID
    });
    if (!result.ok) return socket.emit("toast", result.message);
    addNews(`${player.name} 为工坊购入 ${result.device.name}。`, "craft");
    socket.emit("toast", result.message);
    broadcast();
  });

  socket.on("repairWorkshopDevice", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!consumeRequestId(player, payload.requestId)) {
      return socket.emit("toast", "该维修请求已处理，请勿重复提交。");
    }
    normalizePlayer(player);
    if (workshopJobsForDevice(player, payload.deviceId).length) {
      return socket.emit("toast", "设备加工中，完成后才能维修。");
    }
    const result = repairEquipment(player, payload.deviceId, { spendCash });
    if (!result.ok) return socket.emit("toast", result.message);
    addNews(`${player.name} 维修了 ${result.device.name}。`, "craft");
    socket.emit("toast", result.message);
    broadcast();
  });

  socket.on("startWorkshopJob", (payload = {}, acknowledge) => {
    const player = getPlayer(socket);
    const result = handleStartWorkshopJobRequest({
      player,
      payload,
      acknowledge,
      consumeRequestId,
      startWorkshopJob: startWorkshopJobForPlayer,
      emitToast: (message) => socket.emit("toast", message),
      onSuccess: (started) => {
        addNews(`${player.name} 将 ${started.job.item.name} 安排到${started.device.name}。`, "craft");
        advanceTask(player, "workshop_craft");
        emitUiEvent(socket, {
          type: "modal",
          tone: "craft",
          title: `${started.device.name}已开工`,
          subtitle: started.job.item.name,
          body: "设备和师傅已经按当前工序开始处理，完成后会回到对应阶段库存。",
          stats: [
            { label: "员工", value: started.worker?.name || "默认师傅" },
            { label: "加工费", value: `-${uiMoney(started.fee)}` }
          ],
          floatText: `加工 -${uiMoney(started.fee)}`
        });
      }
    });
    if (result.ok) broadcast();
  });

  socket.on("assignWorkshopWorker", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    normalizePlayer(player);
    if (!playerOwnsWorkshop(player)) return socket.emit("toast", "先去交易行买下街角小工坊。");
    const device = workshopDeviceForPlayer(player, payload.deviceId);
    if (!device) return socket.emit("toast", "这台设备不存在。");
    const worker = workshopWorkerForPlayer(player, payload.workerId);
    if (!worker) return socket.emit("toast", "这位师傅不存在。");
    if (isWorkerBusy(player, worker.id)) return socket.emit("toast", "这位师傅正在执行其他任务。");
    if (device.workerId === worker.id) return socket.emit("toast", `${worker.name} 已在本台。`);
    device.workerId = worker.id;
    addNews(`${player.name} 把 ${worker.name} 排到 ${device.name}。`, "craft");
    socket.emit("toast", `${worker.name} 已排到 ${device.name}。`);
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

  socket.on("extractFromRough", (rawPayload) => {
    const player = getPlayer(socket);
    if (!player) return;
    const {
      roughId,
      kits: rawKits,
      placements: rawPlacements,
      requestId
    } = normalizeMutationPayload(rawPayload);
    if (!consumeRequestId(player, requestId)) {
      return socket.emit("toast", "该开工请求缺少有效编号或已处理，请勿重复提交。");
    }
    normalizePlayer(player);
    const kits = normalizeExtractionKits(rawKits);
    const legacyKits = !kits.length && Array.isArray(rawPlacements)
      ? rawPlacements.map((placement) => ({ ...placement, type: "bangle" }))
      : [];
    const normalizedKits = kits.length ? kits : normalizeExtractionKits(legacyKits);
    const result = startWorkshopJobForPlayer(player, "carving", { itemId: roughId, kits: normalizedKits });
    if (!result.ok) return socket.emit("toast", result.message);
    addNews(`${player.name} 为 ${result.job.item.name} 安排 ${normalizedKits.length} 件精雕。`, "craft");
    emitUiEvent(socket, {
      type: "modal",
      tone: "craft",
      title: "精雕已安排",
      subtitle: result.job.item.name,
      body: "师傅已经按你的套件位置开工，完成后会得到精雕毛坯。",
      stats: [
        { label: "套件", value: `${normalizedKits.length} 件` },
        { label: "加工费", value: `-${uiMoney(result.fee)}` }
      ],
      floatText: `精雕 -${uiMoney(result.fee)}`
    });
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

  socket.on("collectBracelet", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    const braceletId = typeof payload === "object" ? payload.braceletId : payload;
    const requestId = typeof payload === "object" ? payload.requestId : null;
    if (!consumeRequestId(player, requestId)) {
      return socket.emit("toast", "该收藏请求已处理，请勿重复提交。");
    }
    const bracelet = takeItem(player, "bracelet", braceletId);
    if (!bracelet) return;
    if (materialStageFor(bracelet) !== "finished") {
      restoreWorkshopItem(player, bracelet);
      return socket.emit("toast", "只有最终成品才能收入藏宝阁。");
    }
    player.collection.push({ ...bracelet, collectedAt: Date.now() });
    advanceTask(player, "collection_collect");
    player.rep += bracelet.rep;
    addNews(`${player.name} 把 ${bracelet.name} 收进藏宝阁，声望 +${bracelet.rep}。`, "great");
    emitUiEvent(socket, {
      type: "modal",
      tone: "great",
      title: "收入藏宝阁",
      subtitle: bracelet.name,
      body: "这件成品已成为门面藏品，会持续提升店铺气势。",
      stats: [
        { label: "声望", value: `+${bracelet.rep}` },
        { label: "估值", value: uiMoney(bracelet.value) }
      ],
      floatText: `声望 +${bracelet.rep}`
    });
    broadcast();
  });

  socket.on("scheduleLivestream", ({ productId, mode, workerId, requestId } = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!consumeRequestId(player, requestId)) {
      return socket.emit("toast", "该直播请求已处理，请勿重复提交。");
    }
    const job = scheduleLivestream(player, productId, mode, workerId);
    if (!job) return socket.emit("toast", playerCanLivestream(player) ? "没有空闲员工或找不到可直播成品。" : "先去交易行购买直播经营许可。");
    addNews(`${player.name} 安排 ${job.product.name} 自动直播。`, "trade");
    emitUiEvent(socket, {
      type: "float",
      tone: "trade",
      text: "已排入直播",
      x: 62,
      y: 62
    });
    broadcast();
  });

  socket.on("livestreamSell", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    const mutation = normalizeMutationPayload(payload);
    const braceletId = mutation.productId || mutation.braceletId;
    const workerId = mutation.workerId || null;
    const requestId = mutation.requestId;
    if (!consumeRequestId(player, requestId)) {
      return socket.emit("toast", "该直播请求缺少有效编号或已处理，请勿重复提交。");
    }
    const sale = sellLivestreamNow(player, braceletId, Date.now(), workerId);
    if (!sale) return socket.emit("toast", playerCanLivestream(player) ? "没有空闲员工或找不到可直播成品。" : "先去交易行购买直播经营许可。");
    addNews(`${player.name} 直播卖出 ${sale.product.name}，成交 ${sale.outcome.price}。`, "trade");
    advanceTask(player, "livestream_sell");
    emitUiEvent(socket, {
      type: "modal",
      tone: "success",
      title: "直播成交",
      subtitle: sale.product.name,
      body: "买家当场拍下，现金已经入账。",
      stats: [
        { label: "成交价", value: uiMoney(sale.outcome.price) },
        { label: "员工", value: sale.worker.name },
        { label: "技能升级", value: `${sale.xpResult.levelUps.length} 项` }
      ],
      floatText: `+${uiMoney(sale.outcome.price)}`
    });
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
    if (selected.some((bracelet) => materialStageFor(bracelet) !== "finished")) {
      return socket.emit("toast", "只有最终成品才能交付订单。");
    }

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
    advanceTask(player, "order_complete");
    refillOrders(player);
    addNews(`${player.name} 完成 ${order.client} 的订单，收入 ${finalPay}，声望 ${repGain >= 0 ? "+" : ""}${repGain}。`, qualityOk ? "trade" : "bad");
    emitUiEvent(socket, {
      type: "modal",
      tone: qualityOk ? "success" : "bad",
      title: qualityOk ? "订单交付成功" : "订单勉强交付",
      subtitle: order.client,
      body: qualityOk ? "客户很满意，这单给店里添了口碑。" : "客户接受了交付，但满意度和声望都受到了影响。",
      stats: [
        { label: "收入", value: `+${uiMoney(finalPay)}` },
        { label: "声望", value: `${repGain >= 0 ? "+" : ""}${repGain}` },
        { label: "满意度", value: `${Math.round(player.satisfaction)}%` }
      ],
      floatText: `+${uiMoney(finalPay)}`
    });
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
    advanceTask(player, "market_sell");
    addNews(`${player.name} 在交易行挂出 ${item.name}，标价 ${listingPrice}。`, "trade");
    emitUiEvent(socket, {
      type: "float",
      tone: "trade",
      text: `已挂牌 ${uiMoney(listingPrice)}`,
      x: 66,
      y: 66
    });
    broadcast();
  });

  socket.on("buyAssetListing", (listingId) => {
    const player = getPlayer(socket);
    const result = buyAssetListingForPlayer(player, listingId);
    socket.emit("toast", result.message);
    if (result.ok) {
      addNews(`${player.name} 买下 ${result.listing.name}。`, "trade");
      emitUiEvent(socket, {
        type: "modal",
        tone: "success",
        title: "资产入手",
        subtitle: result.listing.name,
        body: result.listing.description,
        stats: [
          { label: "花费", value: `-${uiMoney(result.listing.price)}` }
        ],
        floatText: `-${uiMoney(result.listing.price)}`
      });
      broadcast();
    }
  });

  socket.on("buyMaterialPack", ({ materialId, amount, requestId } = {}) => {
    const player = getPlayer(socket);
    if (!consumeRequestId(player, requestId)) {
      return socket.emit("toast", "该材料购买请求已处理，请勿重复提交。");
    }
    if (!player || !materialId || !Number.isFinite(Number(amount))) return;
    const result = buyMaterialPack(player, materialId, Number(amount));
    socket.emit("toast", result.message);
    if (result.ok) {
      addNews(`${player.name} 购入镶嵌材料 ${result.listing.name}。`, "trade");
      emitUiEvent(socket, {
        type: "modal",
        tone: "success",
        title: "材料入手",
        subtitle: result.listing.name,
        stats: [{ label: "花费", value: `-${uiMoney(result.price)}` }],
        floatText: `-${uiMoney(result.price)}`
      });
      broadcast();
    }
  });

  socket.on("getMaterialHistory", (key, cb) => {
    if (typeof cb !== "function") return;
    const meta = MATERIAL_META[key];
    if (!meta) return cb({ ok: false });
    cb({
      ok: true,
      key,
      name: meta.name,
      unitLabel: meta.unitLabel,
      base: meta.unitPrice,
      current: Math.round(getMaterialPrice(key)),
      history: getMaterialPriceHistory(key)
    });
  });

  socket.on("buyListing", (listingId) => {
    const player = getPlayer(socket);
    if (!player) return;
    const index = state.listings.findIndex((listing) => listing.id === listingId);
    if (index < 0) return;
    const listing = state.listings[index];
    if (listing.ownerId === player.id) return socket.emit("toast", "不能购买自己的挂单。");
    const seller = state.players.get(listing.ownerId);
    const tax = money(listing.price * MARKET_TAX);
    const total = listing.price + tax;
    if (!spendCash(player, total, `交易行购入：${listing.item.name}（含税 ${tax}）`, { source: "market", itemId: listing.item.id })) {
      return socket.emit("toast", "资金不足（含 3% 市场税）。");
    }
    if (seller) {
      seller.payouts.push({ id: randomUUID(), itemName: listing.item.name, amount: listing.price, at: Date.now() });
      seller.soldCount = (seller.soldCount || 0) + 1;
      seller.rep += 2;
      seller.stats.tradeCount += 1;
    }
    addItem(player, listing.item);
    advanceTask(player, "market_buy");
    player.stats.tradeCount += 1;
    state.listings.splice(index, 1);
    addNews(`${player.name} 从 ${listing.ownerName} 手里买下 ${listing.item.name}，成交 ${listing.price}。`, "trade");
    emitUiEvent(socket, {
      type: "modal",
      tone: "trade",
      title: "交易成交",
      subtitle: listing.item.name,
      body: `你从 ${listing.ownerName} 的摊位买下了这件货。`,
      stats: [
        { label: "挂牌价", value: `${uiMoney(listing.price)}` },
        { label: "市场税 3%", value: `-${uiMoney(tax)}` },
        { label: "实付", value: `-${uiMoney(total)}` }
      ],
      floatText: `-${uiMoney(total)}`
    });
    broadcast();
  });

  socket.on("withdrawListing", (listingId) => {
    const player = getPlayer(socket);
    if (!player) return;
    const index = state.listings.findIndex((listing) => listing.id === listingId);
    if (index < 0) return;
    const listing = state.listings[index];
    if (listing.ownerId !== player.id) return socket.emit("toast", "只能撤下自己的挂单。");
    // 按挂单记录的类型退回对应库存桶（不依赖 item.type，保证成品/明料/片料都能正确归位）
    const bucketName = listing.type === "rough" ? "rough"
      : listing.type === "material" ? "materials"
      : listing.type === "slice" ? "slices" : "bracelets";
    player[bucketName].push(listing.item);
    state.listings.splice(index, 1);
    addNews(`${player.name} 撤回了交易行挂单 ${listing.item.name}。`, "trade");
    emitUiEvent(socket, {
      type: "float",
      tone: "trade",
      text: "已撤单，退回库存",
      x: 66,
      y: 66
    });
    broadcast();
  });

  socket.on("refreshOrders", () => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!spendCash(player, 300, "刷新客户", { source: "orderRefresh" })) return socket.emit("toast", "刷新客户需要 300。");
    player.orders = [];
    refillOrders(player);
    emitUiEvent(socket, {
      type: "float",
      tone: "expense",
      text: "刷新客户 -¥300",
      x: 66,
      y: 70
    });
    broadcast();
  });

  socket.on("collectPayout", () => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!player.payouts || !player.payouts.length) return socket.emit("toast", "没有可领取的交易行收益。");
    const total = player.payouts.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    player.payouts = [];
    earnCash(player, total, "交易行收益领取", { source: "market-payout" });
    addNews(`${player.name} 领取了交易行收益 ${uiMoney(total)}。`, "trade");
    emitUiEvent(socket, { type: "float", tone: "profit", text: `领取 ${uiMoney(total)}`, x: 66, y: 66 });
    broadcast();
  });

  socket.on("task:claim", ({ uid } = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    const result = claimTask(player, uid);
    if (!result.ok) return socket.emit("toast", result.message);
    socket.emit("toast", `任务完成：${result.title}，奖励 +${uiMoney(result.reward)}${result.rep ? ` 声望 +${result.rep}` : ""}`);
    emitUiEvent(socket, { type: "float", tone: "profit", text: `任务 +${uiMoney(result.reward)}`, x: 62, y: 60 });
    broadcast();
  });

  socket.on("task:reset", ({ uid } = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    const result = resetTask(player, uid);
    if (!result.ok) return socket.emit("toast", result.message);
    socket.emit("toast", `已花费 ${uiMoney(TASK_RESET_COST)} 重置任务。`);
    emitUiEvent(socket, { type: "float", tone: "expense", text: `重置 -${uiMoney(TASK_RESET_COST)}`, x: 62, y: 60 });
    broadcast();
  });

  // ---- 调试工具：直接增加现金 / 声望（开发用，生产可移除）----
  socket.on("debugGrant", ({ cash = 0, rep = 0 } = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    const addCash = Number(cash) || 0;
    const addRep = Number(rep) || 0;
    if (addCash) earnCash(player, addCash, "调试加现金", { source: "debug" });
    if (addRep) player.rep = Math.max(0, (Number(player.rep) || 0) + addRep);
    socket.emit("toast", `调试：现金 ${addCash >= 0 ? "+" : ""}${addCash}，声望 ${addRep >= 0 ? "+" : ""}${addRep}`);
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
    processAuctionLifecycle(now);
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
    if (processAuctionLifecycle()) broadcast();
  }, 1000);

  return httpServer.listen(PORT, () => {
    console.log(`Jade Market Prototype running at http://localhost:${PORT}`);
  });
}

export { materialCatalogForPlayer, buyMaterialPack };
export const __testHooks = {
  state,
  makePlayer,
  normalizePlayer,
  recordLedger,
  spendCash,
  consumeRequestId,
  normalizeMutationPayload,
  earnCash,
  holdDeposit,
  releaseDeposit,
  settleOfflinePlayer,
  enterAuctionForPlayer,
  submitAuctionBidForPlayer,
  joinAuctionForPlayer,
  requestAuctionWindowForPlayer,
  ensureAuctionRound,
  settleAuctionIfDue,
  processAuctionLifecycle,
  snapshotFor,
  startRoughOpeningForPlayer,
  normalizeWorkshop,
  materialStageFor,
  workshopDevicesForPlayer,
  workshopDeviceForPlayer,
  workshopJobsForDevice,
  workshopProcessableItems,
  startWorkshopJobForPlayer,
  startProductionJob,
  completeProductionJob,
  applyJobDurability,
  validateFinishPlan,
  quoteFinishPlan,
  reserveFinishMaterials,
  refundFinishMaterials,
  applyInlay,
  equipmentCatalog,
  buyEquipment,
  repairEquipment,
  repairQuote,
  ensureRecruitCandidates,
  refreshRecruitCandidates,
  recruitWorker,
  mergeWorkers,
  isWorkerBusy,
  grantActivityExperience,
  livestreamWorkerForPlayer,
  scheduleLivestream,
  sellLivestreamNow,
  assetListingsForPlayer,
  buyAssetListingForPlayer,
  playerOwnsWorkshop,
  playerCanLivestream,
  extractProductsFromJob,
  normalizeExtractionKits,
  expandKitPlacements,
  placementsOverlap,
  processProductionJobs,
  settleLivestreamJobsForPlayer,
  processLivestreamJobs,
  processPolishingJobs,
  playerSocketCount,
  isPlayerOnline,
  revealPolishedRough,
  inventoryForReport,
  refreshPlayerReport,
  refreshTasksIfDue,
  advanceTask,
  claimTask,
  resetTask,
  TASK_RESET_COST,
  TASK_COUNT
};

if (isDirectRun()) startServer();
