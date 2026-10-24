import { recordFinanceSale } from "../../shared/domain/economy/finance-book.js";
import {
  applyHostPurchaseBonuses,
  applyTalkStyleToBonuses,
  hostBonusPreview,
  hostBonusesFromLevels,
  hostBonusesFromWorker,
  hostLikeGain,
  hostVisitIntervalScale,
  normalizeTalkStyle,
  talkStyleMeta
} from "../../shared/domain/livestream/livestream-host-bonuses.js";
import {
  LIVESTREAM_MIN_ITEMS,
  LIVESTREAM_MAX_ITEMS,
  LIVESTREAM_MIN_PRICE,
  LIVESTREAM_BASE_DURATION_MS,
  LIVESTREAM_MAX_DURATION_MS,
  LIVESTREAM_SALE_EXTENSION_MS,
  LIVESTREAM_AI_TUNING,
  LIVESTREAM_AI_PRICE_BANDS
} from "../../shared/domain/livestream/livestream-rules.js";
import { itemCost } from "../../shared/domain/economy/item-cost.js";
import { bookSystemDemand, quoteSystemDemand } from "../../shared/domain/economy/system-demand.js";

export {
  applyHostPurchaseBonuses,
  applyTalkStyleToBonuses,
  hostBonusPreview,
  hostBonusesFromLevels,
  hostBonusesFromWorker,
  hostLikeGain,
  hostVisitIntervalScale,
  normalizeTalkStyle,
  talkStyleMeta,
  LIVESTREAM_MIN_ITEMS,
  LIVESTREAM_MAX_ITEMS,
  LIVESTREAM_MIN_PRICE,
  LIVESTREAM_BASE_DURATION_MS,
  LIVESTREAM_MAX_DURATION_MS,
  LIVESTREAM_SALE_EXTENSION_MS,
  LIVESTREAM_AI_TUNING,
  LIVESTREAM_AI_PRICE_BANDS
};

function numericNow(options = {}) {
  return Number(options.now ?? Date.now());
}

function makeId(options = {}) {
  return typeof options.makeId === "function"
    ? options.makeId()
    : `livestream-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function randomRatio(options = {}) {
  const value = typeof options.rng === "function" ? options.rng() : Math.random();
  return Math.max(0, Math.min(0.999999, Number(value) || 0));
}

function roomHostBonuses(room) {
  if (room?.hostSnapshot?.bonuses) return room.hostSnapshot.bonuses;
  if (room?.hostSnapshot?.skills) return hostBonusesFromLevels(room.hostSnapshot.skills);
  return hostBonusesFromLevels();
}

function nextAiVisitAt(now, options = {}, bonuses = null) {
  const scale = hostVisitIntervalScale(bonuses || options.bonuses || {});
  const base = LIVESTREAM_AI_TUNING.visitMinMs
    + Math.round(randomRatio(options) * LIVESTREAM_AI_TUNING.visitSpreadMs);
  return now + Math.max(LIVESTREAM_AI_TUNING.minVisitMs, Math.round(base * scale));
}

function isFinishedProduct(item, options = {}) {
  if (typeof options.isFinishedProduct === "function") {
    return Boolean(options.isFinishedProduct(item));
  }
  return item?.materialStage === "finished" || item?.type === "bracelet";
}

function normalizePrice(value) {
  const price = Number(value);
  return Number.isInteger(price) && price >= LIVESTREAM_MIN_PRICE ? price : null;
}

function activeRoom(player) {
  return player?.livestreamRoom?.status === "live" ? player.livestreamRoom : null;
}

function normalizeHostSnapshot(host, talkStyle = "balanced") {
  if (!host || typeof host !== "object") return null;
  const id = String(host.id || "").trim();
  const name = String(host.name || "").trim();
  if (!id || !name) return null;
  const styleId = normalizeTalkStyle(talkStyle || host.talkStyle);
  const { skills, bonuses: computed } = hostBonusesFromWorker(host);
  const baseBonuses = host.bonuses && typeof host.bonuses === "object" && host.bonusesStyled !== true
    ? {
      premium: Math.max(0, Number(host.bonuses.premium) || 0),
      premiumSoft: Math.max(0, Number(host.bonuses.premiumSoft) || 0),
      traffic: Math.max(0, Number(host.bonuses.traffic) || 0),
      likes: Math.max(0, Number(host.bonuses.likes) || 0),
      convert: Math.max(0, Number(host.bonuses.convert) || 0)
    }
    : computed;
  // 已带风格的快照（bonusesStyled）直接沿用，避免 normalize 时重复乘风格
  const bonuses = host.bonusesStyled
    ? {
      premium: Math.max(0, Number(host.bonuses?.premium) || 0),
      premiumSoft: Math.max(0, Number(host.bonuses?.premiumSoft) || 0),
      traffic: Math.max(0, Number(host.bonuses?.traffic) || 0),
      likes: Math.max(0, Number(host.bonuses?.likes) || 0),
      convert: Math.max(0, Number(host.bonuses?.convert) || 0)
    }
    : applyTalkStyleToBonuses(baseBonuses, styleId);
  const style = talkStyleMeta(styleId);
  return {
    id,
    name,
    job: String(host.job || "").trim() || "streamer",
    tier: Math.max(1, Math.round(Number(host.tier) || 1)),
    skills,
    talkStyle: styleId,
    talkStyleLabel: style.label,
    bonuses,
    bonusesStyled: true,
    preview: hostBonusPreview(bonuses)
  };
}

export function normalizeLivestreamRoom(player) {
  if (!player || typeof player !== "object") return null;
  const room = player.livestreamRoom;
  if (!room || room.status !== "live" || !Array.isArray(room.items) || room.items.length === 0) {
    player.livestreamRoom = null;
    return null;
  }
  room.likes = Math.max(0, Math.round(Number(room.likes) || 0));
  room.sales = Array.isArray(room.sales) ? room.sales.slice(0, 40) : [];
  const recordedRevenue = room.sales.reduce((sum, sale) => sum + Number(sale?.price || 0), 0);
  room.totalSales = Math.max(room.sales.length, Math.round(Number(room.totalSales) || 0));
  room.totalRevenue = Math.max(recordedRevenue, Math.round(Number(room.totalRevenue) || 0));
  room.startedAt = Number(room.startedAt) || Date.now();
  room.hardEndsAt = Number(room.hardEndsAt) || room.startedAt + LIVESTREAM_MAX_DURATION_MS;
  room.endsAt = Math.min(
    room.hardEndsAt,
    Number(room.endsAt) || room.startedAt + LIVESTREAM_BASE_DURATION_MS
  );
  room.lastActivityAt = Number(room.lastActivityAt) || room.startedAt;
  room.nextAiVisitAt = Number(room.nextAiVisitAt) || room.startedAt;
  room.items = room.items.slice(0, LIVESTREAM_MAX_ITEMS);
  const styleId = normalizeTalkStyle(room.talkStyle || room.hostSnapshot?.talkStyle);
  room.talkStyle = styleId;
  const host = normalizeHostSnapshot(
    room.hostSnapshot || { id: room.hostWorkerId, name: room.hostName, talkStyle: styleId },
    styleId
  );
  if (host) {
    room.hostWorkerId = host.id;
    room.hostSnapshot = host;
  } else {
    room.hostWorkerId = null;
    room.hostSnapshot = null;
  }
  return room;
}

function validateListings(player, listings, options = {}) {
  if (!Array.isArray(listings)) {
    return { ok: false, message: "请选择要上架的成品。" };
  }

  const seen = new Set();
  const resolved = [];
  const inventory = Array.isArray(player?.bracelets) ? player.bracelets : [];

  for (const listing of listings) {
    const productId = String(listing?.productId || "").trim();
    if (!productId) return { ok: false, message: "上架商品信息不完整。" };
    if (seen.has(productId)) return { ok: false, message: "同一件成品不能重复上架。" };
    seen.add(productId);

    const price = normalizePrice(listing?.price);
    if (price === null) return { ok: false, message: `每件成品售价必须是不低于 ${LIVESTREAM_MIN_PRICE} 元的整数。` };

    const product = inventory.find((item) => item?.id === productId);
    if (!product || !isFinishedProduct(product, options)) {
      return { ok: false, message: "有商品不在可售成品库存中，请刷新后重试。" };
    }
    resolved.push({ product, price });
  }

  return { ok: true, resolved };
}

function moveListingsIntoRoom(player, resolved, room, options = {}) {
  const now = numericNow(options);
  const productIds = new Set(resolved.map(({ product }) => product.id));
  player.bracelets = player.bracelets.filter((item) => !productIds.has(item.id));
  const roomItems = resolved.map(({ product, price }) => ({
    id: makeId(options),
    product,
    price,
    listedAt: now
  }));
  room.items.push(...roomItems);
  room.lastActivityAt = now;
  return roomItems;
}

export function startLivestreamRoom(player, listings, options = {}) {
  normalizeLivestreamRoom(player);
  if (!player?.assets?.livestreamPermitOwned) {
    return { ok: false, message: "请先取得直播经营许可。" };
  }
  if (activeRoom(player)) {
    return { ok: false, message: "你的直播间正在营业，请直接补货。" };
  }
  const host = options.host
    ? normalizeHostSnapshot(options.host, options.talkStyle)
    : null;
  if (options.host && !host) {
    return { ok: false, message: "主播信息不完整，请重新选择。" };
  }
  if (!Array.isArray(listings) || listings.length < LIVESTREAM_MIN_ITEMS) {
    return { ok: false, message: `至少 ${LIVESTREAM_MIN_ITEMS} 件成品才可开启直播间。` };
  }
  if (listings.length > LIVESTREAM_MAX_ITEMS) {
    return { ok: false, message: `单个直播间最多 ${LIVESTREAM_MAX_ITEMS} 件在售成品。` };
  }

  const validation = validateListings(player, listings, options);
  if (!validation.ok) return validation;

  const now = numericNow(options);
  const styleId = host?.talkStyle || normalizeTalkStyle(options.talkStyle);
  const room = {
    id: makeId(options),
    status: "live",
    startedAt: now,
    endsAt: now + LIVESTREAM_BASE_DURATION_MS,
    hardEndsAt: now + LIVESTREAM_MAX_DURATION_MS,
    lastActivityAt: now,
    nextAiVisitAt: nextAiVisitAt(now, options, host?.bonuses),
    likes: 0,
    items: [],
    sales: [],
    totalSales: 0,
    totalRevenue: 0,
    talkStyle: styleId,
    hostWorkerId: host?.id || null,
    hostSnapshot: host
  };
  moveListingsIntoRoom(player, validation.resolved, room, options);
  player.livestreamRoom = room;
  return { ok: true, message: "直播间已开启。", room };
}

export function replenishLivestreamRoom(player, listings, options = {}) {
  normalizeLivestreamRoom(player);
  const room = activeRoom(player);
  if (!room) return { ok: false, message: "直播间没有营业，无法补货。" };
  if (!Array.isArray(listings) || listings.length < 1) {
    return { ok: false, message: "请至少选择 1 件补货成品。" };
  }
  if (room.items.length + listings.length > LIVESTREAM_MAX_ITEMS) {
    return {
      ok: false,
      message: `补货后不能超过 ${LIVESTREAM_MAX_ITEMS} 件在售成品。`
    };
  }

  const validation = validateListings(player, listings, options);
  if (!validation.ok) return validation;
  const added = moveListingsIntoRoom(player, validation.resolved, room, options);
  return { ok: true, message: `已补上 ${added.length} 件成品。`, room, added };
}

function grantHostExperience(seller, workerId, activity, options = {}) {
  if (!workerId || typeof options.grantHostExperience !== "function") return null;
  return options.grantHostExperience(seller, workerId, activity) || null;
}

function formatHostXpNote(xpResult, workerName) {
  if (!xpResult?.grants) return "";
  const ups = (xpResult.levelUps || [])
    .map((entry) => `${entry.key}→Lv.${entry.level}`)
    .join("。");
  if (ups) return `${workerName || "主播"}直播技能提升：${ups}`;
  return `${workerName || "主播"}获得直播经验`;
}

/** Sold-stock margin; fixed investments belong to the cash ledger. */
export function buildLivestreamSettleReport(room, details = {}) {
  const endedAt = Number(details.endedAt || Date.now());
  const startedAt = Number(room?.startedAt || endedAt);
  // sales — newest-first；明细按时间正序展示
  const sales = [...(room?.sales || [])].reverse();
  const items = sales.map((sale) => {
    const price = Math.max(0, Math.round(Number(sale?.price) || 0));
    const costValue = Math.max(
      0,
      Math.round(Number(sale?.costValue ?? 0) || 0)
    );
    return {
      id: sale?.id || "",
      productId: sale?.productId || null,
      productName: sale?.productName || "翡翠成品",
      quantity: Math.max(1, Math.round(Number(sale?.quantity) || 1)),
      price,
      costValue,
      costComplete: sale?.costComplete === true,
      buyerName: sale?.buyerName || (sale?.buyerType === "ai" ? "AI翠友" : "翠友"),
      buyerType: sale?.buyerType || "ai",
      soldAt: sale?.soldAt || null
    };
  });
  const soldCount = items.length;
  const revenueTotal = items.reduce((sum, row) => sum + row.price, 0);
  const costTotal = items.reduce((sum, row) => sum + row.costValue, 0);
  return {
    roomId: String(room?.id || details.roomId || ""),
    playerId: String(details.playerId || ""),
    reason: ["sold_out", "timeout"].includes(details.reason) ? details.reason : "manual",
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
    hostName: String(room?.hostSnapshot?.name || details.hostName || ""),
    soldCount,
    returnedCount: Math.max(0, Math.round(Number(details.returnedCount) || 0)),
    revenueTotal,
    costTotal,
    costComplete: items.every((row) => row.costComplete),
    netProfit: items.every((row) => row.costComplete) ? revenueTotal - costTotal : null,
    items
  };
}

export function closeLivestreamRoom(player, options = {}) {
  normalizeLivestreamRoom(player);
  const room = activeRoom(player);
  if (!room) return { ok: false, message: "直播间已经关闭。" };

  const hostWorkerId = room.hostWorkerId;
  const hostName = room.hostSnapshot?.name;
  const endedAt = numericNow(options);
  const reason = options.reason === "timeout" ? "timeout" : "manual";
  player.bracelets ||= [];
  const returned = room.items.map((item) => item.product).filter(Boolean);
  const settleReport = buildLivestreamSettleReport(room, {
    playerId: player.id,
    endedAt,
    reason,
    returnedCount: returned.length,
    hostName
  });
  player.bracelets.push(...returned);
  player.livestreamRoom = null;
  const sessionXp = grantHostExperience(player, hostWorkerId, "livestreamSession", options);
  if (reason === "timeout" && typeof options.onRoomAutoClosed === "function") {
    options.onRoomAutoClosed(player, {
      salesCount: room.totalSales,
      settleReport
    });
  }
  const xpNote = formatHostXpNote(sessionXp, hostName);
  if (typeof options.addNews === "function") {
    options.addNews(
      reason === "timeout"
        ? `${player.name} 的直播时段结束，${returned.length} 件未售成品已退回库存${xpNote ? `，${xpNote}` : ""}。`
        : `${player.name} 关闭了直播间，${returned.length} 件未售成品已退回库存${xpNote ? `，${xpNote}` : ""}。`,
      "info"
    );
  }
  return {
    ok: true,
    message: xpNote
      ? `直播间已关闭，${returned.length} 件未售成品已退回库存，${xpNote}。`
      : `直播间已关闭，${returned.length} 件未售成品已退回库存。`,
    returnedCount: returned.length,
    sessionXp,
    settleReport
  };
}

function defaultRecordSale(seller, sale) {
  seller.livestreamHistory ||= [];
  seller.livestreamHistory.unshift(sale);
  seller.livestreamHistory = seller.livestreamHistory.slice(0, 40);
}

export function purchaseLivestreamRoomItem(details = {}, options = {}) {
  const { seller, buyer, itemId, buyerType = "player" } = details;
  const buyerName = String(details.buyerName || (buyerType === "ai" ? "AI翠友" : buyer?.name) || "翠友");
  normalizeLivestreamRoom(seller);
  const room = activeRoom(seller);
  if (!room) return { ok: false, message: "直播间已经关闭。" };
  if (buyerType === "player" && buyer?.id === seller?.id) {
    return { ok: false, message: "不能购买自己的商品。" };
  }

  const itemIndex = room.items.findIndex((item) => item.id === itemId);
  if (itemIndex < 0) return { ok: false, message: "这件商品刚刚售罄，请看看其他商品。" };
  const roomItem = room.items[itemIndex];
  const now = numericNow(options);
  const demandQuote = buyerType === "ai"
    ? quoteSystemDemand(seller, [roomItem.product], roomItem.price, now)
    : null;
  if (demandQuote && !demandQuote.ok) return { ok: false, code: demandQuote.code, message: demandQuote.message };

  if (buyerType === "player") {
    if (!buyer) return { ok: false, message: "未找到购买玩家。" };
    if (typeof options.spendCash !== "function" || !options.spendCash(
      buyer,
      roomItem.price,
      `直播间购入：${roomItem.product.name}`,
      { source: "livestream-buy", itemId: roomItem.product.id }
    )) {
      return { ok: false, message: "资金不足，无法购买这件直播商品。" };
    }
  }

  recordFinanceSale(seller, [roomItem.product], roomItem.price, { id: `livestream:${room.id}:${roomItem.id}`, channel: "livestream", at: now });
  room.items.splice(itemIndex, 1);
  if (demandQuote) bookSystemDemand(seller, demandQuote, "livestream");
  if (buyerType === "player" && typeof options.addItem === "function") {
    const added = options.addItem(buyer, structuredClone(roomItem.product), { type: "bracelet", acquisitionCost: roomItem.price });
    if (!added) throw new Error("livestream-room: buyer inventory rejected purchased item");
  }
  if (typeof options.earnCash === "function") {
    options.earnCash(
      seller,
      roomItem.price,
      `直播成交${roomItem.product.name}`,
      { source: "livestream", itemId: roomItem.product.id, at: now }
    );
  }

  const sale = {
    id: makeId(options),
    type: "livestreamRoomSale",
    mode: "stall",
    roomId: room.id,
    buyerType,
    buyerName,
    product: roomItem.product,
    outcome: {
      sold: true,
      price: roomItem.price
    },
    startedAt: room.startedAt,
    readyAt: now,
    completedAt: now,
    soldAt: now
  };
  const roomSale = {
    id: sale.id,
    productId: roomItem.product.id,
    productName: roomItem.product.name,
    price: roomItem.price,
    costValue: itemCost(roomItem.product).amount,
    costComplete: itemCost(roomItem.product).complete,
    quantity: 1,
    buyerType,
    buyerName,
    soldAt: now
  };
  room.sales.unshift(roomSale);
  room.sales = room.sales.slice(0, 40);
  room.totalSales += 1;
  room.totalRevenue += roomItem.price;
  room.lastActivityAt = now;
  room.endsAt = Math.min(
    Number(room.hardEndsAt) || room.startedAt + LIVESTREAM_MAX_DURATION_MS,
    Math.max(Number(room.endsAt) || now, now) + LIVESTREAM_SALE_EXTENSION_MS
  );

  if (typeof options.recordSale === "function") options.recordSale(seller, sale);
  else defaultRecordSale(seller, sale);
  if (typeof options.advanceTask === "function") options.advanceTask(seller, "livestream_sell");
  const saleXp = grantHostExperience(seller, room.hostWorkerId, "livestreamSale", options);
  // 成交信息不进世界新闻 / 公屏；买家与卖家各自收私有提示。

  const hostWorkerId = room.hostWorkerId;
  const hostName = room.hostSnapshot?.name;
  const autoClosed = room.items.length === 0;
  let sessionXp = null;
  let settleReport = null;
  if (autoClosed) {
    settleReport = buildLivestreamSettleReport(room, {
      playerId: seller.id,
      endedAt: now,
      reason: "sold_out",
      returnedCount: 0,
      hostName
    });
    seller.livestreamRoom = null;
    sessionXp = grantHostExperience(seller, hostWorkerId, "livestreamSession", options);
    if (typeof options.onRoomAutoClosed === "function") {
      options.onRoomAutoClosed(seller, {
        salesCount: room.totalSales,
        settleReport
      });
    }
    const xpNote = formatHostXpNote(sessionXp, hostName);
    if (typeof options.addNews === "function") {
      options.addNews(
        `${seller.name} 的直播商品全部售罄，直播间自动关闭${xpNote ? `${xpNote}` : ""}。`,
        "info"
      );
    }
  }

  return {
    ok: true,
    message: autoClosed ? "购买成功，直播间商品已经全部售罄。" : "购买成功。", sale,
    roomItem,
    autoClosed,
    saleXp,
    sessionXp,
    settleReport
  };
}

export function aiBasePurchaseChance(priceRatio) {
  const ratio = Math.max(0, Number(priceRatio) || 0);
  const index = LIVESTREAM_AI_PRICE_BANDS.findIndex((row) => ratio <= row.maxRatio);
  if (index < 0) return 0;
  const band = LIVESTREAM_AI_PRICE_BANDS[index];
  if (index === 0) return band.chance;
  const previous = LIVESTREAM_AI_PRICE_BANDS[index - 1];
  const progress = (ratio - previous.maxRatio) / (band.maxRatio - previous.maxRatio);
  return previous.chance + (band.chance - previous.chance) * progress;
}

export function aiReputationBoost(rep) {
  const normalized = Math.max(0, Number(rep) || 0) / LIVESTREAM_AI_TUNING.repFullValue;
  return Math.min(
    LIVESTREAM_AI_TUNING.maxRepBoost,
    Math.sqrt(normalized) * LIVESTREAM_AI_TUNING.maxRepBoost
  );
}

function aiDesirabilityScale(priceRatio) {
  const ratio = Math.max(0, Number(priceRatio) || 0);
  return Math.max(0.35, Math.min(1, 1 - Math.max(0, ratio - 1.05) * 3));
}

export function aiPurchaseChance(seller, roomItem, room = seller?.livestreamRoom, now = Date.now()) {
  const referenceValue = Math.max(
    1,
    Number(roomItem?.product?.value || roomItem?.product?.price || 1)
  );
  const ratio = roomItem.price / referenceValue;
  if (ratio > LIVESTREAM_AI_TUNING.maxPriceRatio) return 0;
  if (!quoteSystemDemand(seller, [roomItem.product], roomItem.price, now).ok) return 0;
  const priceChance = aiBasePurchaseChance(ratio);
  const scoreBoost = Math.max(
    0,
    Math.min(
      LIVESTREAM_AI_TUNING.maxScoreBoost,
      Number(roomItem?.product?.score || 0) * LIVESTREAM_AI_TUNING.scoreBoostPerPoint
    )
  );
  const repBoost = aiReputationBoost(seller?.rep);
  const desirabilityBoost = (scoreBoost + repBoost) * aiDesirabilityScale(ratio);
  const base = Math.min(
    LIVESTREAM_AI_TUNING.maxPurchaseChance,
    priceChance + desirabilityBoost
  );
  const bonuses = roomHostBonuses(room);
  const chance = applyHostPurchaseBonuses(base, ratio, bonuses, {
    minChance: LIVESTREAM_AI_TUNING.minPurchaseChance,
    maxChance: LIVESTREAM_AI_TUNING.maxPurchaseChance
  });
  if (ratio < 1.5) return chance;
  const premiumCap = ratio <= 1.65 ? 0.025 : 0.015;
  return Math.min(chance, Math.min(0.03, premiumCap * (1 + (Number(bonuses.premium) || 0)) * (1 + (Number(bonuses.convert) || 0))));
}

export function processAiLivestreamRooms(players = [], options = {}) {
  const now = numericNow(options);
  let changed = false;
  const maxVisits = Math.max(1, Math.min(240, Math.floor(Number(options.catchUpMaxVisits) || 1)));

  for (const seller of players) {
    normalizeLivestreamRoom(seller);
    const expiringRoom = activeRoom(seller);
    if (expiringRoom && Number(expiringRoom.endsAt || 0) <= now) {
      const closed = closeLivestreamRoom(seller, { ...options, now, reason: "timeout" });
      if (closed.ok) changed = true;
      continue;
    }
    let visits = 0;
    while (visits < maxVisits) {
      const room = activeRoom(seller);
      if (!room) break;
      if (!options.forceVisit && room.nextAiVisitAt > now) break;

      const visitAt = options.forceVisit
        ? now
        : Math.min(now, Math.max(Number(room.nextAiVisitAt) || now, Number(room.startedAt) || 0));
      const bonuses = roomHostBonuses(room);
      const baseLikes = 2 + Math.floor(randomRatio(options) * 7);
      room.likes += hostLikeGain(baseLikes, bonuses);
      room.lastActivityAt = visitAt;
      room.nextAiVisitAt = nextAiVisitAt(visitAt, options, bonuses);
      changed = true;
      visits += 1;

      if (!room.items.length) {
        seller.livestreamRoom = null;
        break;
      }

      const itemIndex = Math.floor(randomRatio(options) * room.items.length);
      const roomItem = room.items[Math.min(room.items.length - 1, itemIndex)];
      if (randomRatio(options) < aiPurchaseChance(seller, roomItem, room, visitAt)) {
        purchaseLivestreamRoomItem({
          seller,
          buyer: null,
          itemId: roomItem.id,
          buyerType: "ai",
          buyerName: "AI翠友"
        }, { ...options, now: visitAt });
      }

      if (options.forceVisit) break;
    }

    const remainingRoom = activeRoom(seller);
    if (remainingRoom && visits >= maxVisits && remainingRoom.nextAiVisitAt <= now) {
      remainingRoom.nextAiVisitAt = nextAiVisitAt(now, options, roomHostBonuses(remainingRoom));
    }
  }

  return changed;
}

export function publicLivestreamRoom(player, options = {}) {
  const room = activeRoom(player);
  if (!room) return null;
  const publicProduct = typeof options.publicProduct === "function"
    ? options.publicProduct
    : (item) => item;
  // includeSales：仅房主私有快照带成交明细；大厅公开房不带，避免公屏/访客看到成交。
  const includeSales = options.includeSales !== false;
  return {
    id: room.id,
    status: room.status,
    ownerId: player.id,
    ownerName: player.name,
    ownerRep: Math.round(Number(player.rep) || 0),
    startedAt: room.startedAt,
    endsAt: room.endsAt,
    hardEndsAt: room.hardEndsAt,
    lastActivityAt: room.lastActivityAt,
    likes: room.likes,
    stockCount: room.items.length,
    totalSales: room.totalSales,
    totalRevenue: room.totalRevenue,
    hostWorkerId: room.hostWorkerId || null,
    talkStyle: room.talkStyle || room.hostSnapshot?.talkStyle || "balanced",
    talkStyleLabel: room.hostSnapshot?.talkStyleLabel || talkStyleMeta(room.talkStyle).label,
    host: room.hostSnapshot ? { ...room.hostSnapshot } : null,
    items: room.items.map((item) => ({
      id: item.id,
      price: item.price,
      listedAt: item.listedAt,
      product: publicProduct(item.product)
    })),
    sales: includeSales ? room.sales.map((sale) => ({ ...sale })) : []
  };
}
