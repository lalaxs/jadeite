export const LIVESTREAM_MIN_ITEMS = 3;
export const LIVESTREAM_MAX_ITEMS = 20;

const MIN_LISTING_PRICE = 100;
const AI_VISIT_MIN_MS = 8_000;
const AI_VISIT_SPREAD_MS = 12_000;

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

function nextAiVisitAt(now, options = {}) {
  return now + AI_VISIT_MIN_MS + Math.round(randomRatio(options) * AI_VISIT_SPREAD_MS);
}

function isFinishedProduct(item, options = {}) {
  if (typeof options.isFinishedProduct === "function") {
    return Boolean(options.isFinishedProduct(item));
  }
  return item?.materialStage === "finished" || item?.type === "bracelet";
}

function normalizePrice(value) {
  const price = Number(value);
  return Number.isInteger(price) && price >= MIN_LISTING_PRICE ? price : null;
}

function activeRoom(player) {
  return player?.livestreamRoom?.status === "live" ? player.livestreamRoom : null;
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
  room.startedAt = Number(room.startedAt) || Date.now();
  room.lastActivityAt = Number(room.lastActivityAt) || room.startedAt;
  room.nextAiVisitAt = Number(room.nextAiVisitAt) || room.startedAt;
  room.items = room.items.slice(0, LIVESTREAM_MAX_ITEMS);
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
    if (price === null) return { ok: false, message: "每件成品售价必须是至少 100 的整数。" };

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
  if (!Array.isArray(listings) || listings.length < LIVESTREAM_MIN_ITEMS) {
    return { ok: false, message: `至少 ${LIVESTREAM_MIN_ITEMS} 件成品才可开启直播间。` };
  }
  if (listings.length > LIVESTREAM_MAX_ITEMS) {
    return { ok: false, message: `单个直播间最多 ${LIVESTREAM_MAX_ITEMS} 件在售成品。` };
  }

  const validation = validateListings(player, listings, options);
  if (!validation.ok) return validation;

  const now = numericNow(options);
  const room = {
    id: makeId(options),
    status: "live",
    startedAt: now,
    lastActivityAt: now,
    nextAiVisitAt: nextAiVisitAt(now, options),
    likes: 0,
    items: [],
    sales: []
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
  return { ok: true, message: `已补货 ${added.length} 件成品。`, room, added };
}

export function closeLivestreamRoom(player, options = {}) {
  normalizeLivestreamRoom(player);
  const room = activeRoom(player);
  if (!room) return { ok: false, message: "直播间已经关闭。" };

  player.bracelets ||= [];
  const returned = room.items.map((item) => item.product).filter(Boolean);
  player.bracelets.push(...returned);
  player.livestreamRoom = null;
  if (typeof options.addNews === "function") {
    options.addNews(`${player.name} 关闭了直播间，${returned.length} 件未售成品已退回库存。`, "info");
  }
  return {
    ok: true,
    message: `直播间已关闭，${returned.length} 件未售成品已退回库存。`,
    returnedCount: returned.length
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

  room.items.splice(itemIndex, 1);
  const now = numericNow(options);
  if (buyerType === "player" && typeof options.addItem === "function") {
    options.addItem(buyer, roomItem.product);
  }
  if (typeof options.earnCash === "function") {
    options.earnCash(
      seller,
      roomItem.price,
      `直播成交：${roomItem.product.name}`,
      { source: "livestream", itemId: roomItem.product.id }
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
    buyerType,
    buyerName,
    soldAt: now
  };
  room.sales.unshift(roomSale);
  room.sales = room.sales.slice(0, 40);
  room.lastActivityAt = now;

  if (typeof options.recordSale === "function") options.recordSale(seller, sale);
  else defaultRecordSale(seller, sale);
  if (typeof options.advanceTask === "function") options.advanceTask(seller, "livestream_sell");
  if (typeof options.addNews === "function") {
    options.addNews(`${buyerName} 在 ${seller.name} 的直播间买下 ${roomItem.product.name}，成交 ${roomItem.price}。`, "trade");
  }

  const autoClosed = room.items.length === 0;
  if (autoClosed) {
    seller.livestreamRoom = null;
    if (typeof options.addNews === "function") {
      options.addNews(`${seller.name} 的直播商品全部售罄，直播间自动关闭。`, "info");
    }
  }

  return {
    ok: true,
    message: autoClosed ? "购买成功，直播间商品已经全部售罄。" : "购买成功。",
    sale,
    roomItem,
    autoClosed
  };
}

function aiPurchaseChance(seller, roomItem) {
  const referenceValue = Math.max(
    1,
    Number(roomItem?.product?.value || roomItem?.product?.price || 1)
  );
  const ratio = roomItem.price / referenceValue;
  const priceChance = ratio <= 0.85 ? 0.72
    : ratio <= 1 ? 0.5
    : ratio <= 1.2 ? 0.28
    : ratio <= 1.5 ? 0.1
    : 0.03;
  const scoreBoost = Math.max(0, Math.min(0.09, Number(roomItem?.product?.score || 0) * 0.015));
  const repBoost = Math.max(0, Math.min(0.12, Number(seller?.rep || 0) / 1_200));
  return Math.min(0.9, priceChance + scoreBoost + repBoost);
}

export function processAiLivestreamRooms(players = [], options = {}) {
  const now = numericNow(options);
  let changed = false;

  for (const seller of players) {
    normalizeLivestreamRoom(seller);
    const room = activeRoom(seller);
    if (!room) continue;
    if (!options.forceVisit && room.nextAiVisitAt > now) continue;

    room.likes += 2 + Math.floor(randomRatio(options) * 7);
    room.lastActivityAt = now;
    room.nextAiVisitAt = nextAiVisitAt(now, options);
    changed = true;

    if (!room.items.length) {
      seller.livestreamRoom = null;
      continue;
    }

    const itemIndex = Math.floor(randomRatio(options) * room.items.length);
    const roomItem = room.items[Math.min(room.items.length - 1, itemIndex)];
    if (randomRatio(options) >= aiPurchaseChance(seller, roomItem)) continue;

    purchaseLivestreamRoomItem({
      seller,
      buyer: null,
      itemId: roomItem.id,
      buyerType: "ai",
      buyerName: "AI翠友"
    }, { ...options, now });
  }

  return changed;
}

export function publicLivestreamRoom(player, options = {}) {
  normalizeLivestreamRoom(player);
  const room = activeRoom(player);
  if (!room) return null;
  const publicProduct = typeof options.publicProduct === "function"
    ? options.publicProduct
    : (item) => item;
  return {
    id: room.id,
    status: room.status,
    ownerId: player.id,
    ownerName: player.name,
    ownerRep: Math.round(Number(player.rep) || 0),
    startedAt: room.startedAt,
    lastActivityAt: room.lastActivityAt,
    likes: room.likes,
    stockCount: room.items.length,
    totalRevenue: room.sales.reduce((sum, sale) => sum + Number(sale.price || 0), 0),
    items: room.items.map((item) => ({
      id: item.id,
      price: item.price,
      listedAt: item.listedAt,
      product: publicProduct(item.product)
    })),
    sales: room.sales.map((sale) => ({ ...sale }))
  };
}
