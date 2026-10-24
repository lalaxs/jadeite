// Instance-owned implementation; legacy entry points remain one directory above.
import {
  BLACKMARKET_MIN_PRICE,
  BLACKMARKET_GOODS_CAP,
  BLACKMARKET_BLIND_MIN
} from "../../../../shared/domain/blackmarket/bm-constants.js";
import { attemptAtomicMutation } from "../../atomic-mutation.js";
import { isBlackmarketResource } from "../../../../shared/domain/blackmarket/bm-resources.js";
import { isNpcGoodsRow } from "../../../../shared/domain/blackmarket/npc-rules.js";
import { recordFinanceSale } from "../../../../shared/domain/economy/finance-book.js";

export function createStall({
  requireApi,
  denyUnlessBmBuy,
  denyUnlessBmStall,
  bumpBmDeal,
  STALL_TYPES,
  ITEM_TYPES,
  PLAN_LIST_TYPES,
  blackMaskForPlayerId,
  findStallByOwner,
  findStallById,
  stallDisplayName,
  takeBmListEntries,
  rollbackBmTaken,
  returnItemToPlayer,
  tryActivateStall,
  closeGoodsStallIfEmpty,
  removeStallFromState,
  averageBlindPoolRefPrice,
  paySellerNow,
  pushPendingRatings,
  buildRatingDisplay,
  ownerRawSatisfaction,
  defaultServiceProfile,
  buildServiceSnapshot,
  buildServiceProfileOptions,
  applyServiceCuration,
  buildServiceProof,
  sortServiceOffers,
  publicServiceOffer,
  ensureBlindStallResolvedPrice,
  resolvedBlindStallPrice,
  publicBlindDrawSession,
  isNpcBlackStall,
  buyNpcBlackmarketGoods,
  ownedResource,
  resourceBuyerBlock,
  receiveResource,
  releaseSoldResource
}) {
function stallSummary(stall) {
  if (stall.type === "goods") {
    return { kind: "goods", count: (stall.items || []).filter((row) => row?.item && ITEM_TYPES.has(row.type)).length };
  }
  if (stall.type === "blindbox") {
    const n = (stall.pool || []).length;
    return {
      kind: "blindbox",
      count: n,
      price: resolvedBlindStallPrice(stall) || 0,
      sellable: n >= BLACKMARKET_BLIND_MIN && stall.status === "open"
    };
  }
  return { kind: "service", count: (stall.offers || []).length };
}

function publicGoodsItem(row, publicStone, isMine = false) {
  const { acquisitionPrice, acquiredAt, tradeHistory, costBasis, financeBatchId, financeOwnerId, financeParentItemId, blackmarketListingId, payrollAt, ...resource } = row.item;
  return {
    id: row.id,
    type: row.type,
    price: row.price,
    createdAt: row.createdAt,
    ...(row.referencePrice != null ? { referencePrice: row.referencePrice, note: row.note, npcDiscount: row.npcDiscount, npcPremium: row.npcPremium } : {}),
    item: isBlackmarketResource(row.type) ? resource : (typeof publicStone === "function" ? publicStone(row.item, { privateFinance: isMine }) : resource)
  };
}

function publicBlackStall(stall, viewerId, publicStone) {
  if (!stall) return null;
  if (stall.npc === true && !isNpcBlackStall(stall)) return null;
  const goodsItems = (stall.items || []).filter((row) => row?.item && ITEM_TYPES.has(row.type) && (!stall.npc || isNpcGoodsRow(stall, row)));
  const isMine = Boolean(viewerId && stall.ownerId === viewerId);
  if (stall.status === "setup" && !isMine) return null;
  // Sold-out NPCs stay visible while their delayed replenishment is pending.
  if (
    stall.type === "goods"
    && stall.status !== "setup"
    && !goodsItems.length
    && !isNpcBlackStall(stall)
  ) {
    return null;
  }
  const anonymous = stall.anonymous === true;
  const state = requireApi().getState();
  const rawSatisfaction = ownerRawSatisfaction(state, stall.ownerId);
  const ratingDisplay = buildRatingDisplay(state, stall.ownerId, rawSatisfaction);
  const satisfaction = ratingDisplay.visible ? ratingDisplay.score : null;
  const summary = stallSummary(stall);
  if (stall.type === "goods") summary.count = goodsItems.length;
  const base = {
    id: stall.id,
    type: stall.type,
    title: stall.title || "",
    blurb: stall.blurb || "",
    status: stall.status || "open",
    anonymous,
    maskKey: stall.maskKey,
    maskName: stall.maskName || "匿名摊主",
    displayName: stallDisplayName(stall),
    satisfaction,
    ratingDisplay,
    summary,
    createdAt: stall.createdAt,
    updatedAt: stall.updatedAt,
    isMine
  };
  if (isNpcBlackStall(stall)) {
    base.npc = true;
    base.npcRole = stall.npcRole;
    base.roaming = stall.npcRole === "traveler";
    base.ratingDisplay = { visible: false, label: "NPC 商贩" };
  }
  if (!anonymous || isMine) {
    base.ownerId = stall.ownerId;
    base.ownerName = stall.ownerName;
  }
  if (stall.type === "goods") {
    base.items = goodsItems.map((row) => {
      const resource = !stall.npc && isBlackmarketResource(row.type)
        ? ownedResource(state.players?.get?.(stall.ownerId), row.type, row.item.id) : null;
      return publicGoodsItem(resource ? { ...row, item: resource } : row, publicStone, isMine);
    });
  } else if (stall.type === "blindbox") {
    base.blindPrice = resolvedBlindStallPrice(stall) || 0;
    base.blindDescription = stall.blindDescription || "";
    base.poolCount = (stall.pool || []).length;
    base.drawing = Boolean(stall.blindDraw);
    if (stall.blindDraw && stall.blindDraw.buyerId === viewerId) {
      base.activeBlindDraw = publicBlindDrawSession(stall.blindDraw, publicStone);
    }
    if (isMine) {
      base.pool = (stall.pool || []).map((row) => ({
        id: row.id || row.item?.id,
        type: row.type,
        createdAt: row.createdAt || null,
        item: typeof publicStone === "function" ? publicStone(row.item, { privateFinance: true }) : row.item
      }));
    }
  } else if (stall.type === "service") {
    const owner = state.players?.get?.(stall.ownerId);
    const autoSnap = owner ? buildServiceSnapshot(owner, state) : null;
    base.offers = sortServiceOffers(stall.offers || []).map((o) => publicServiceOffer(o, owner, anonymous));
    base.serviceSnapshot = applyServiceCuration(autoSnap, stall, owner, anonymous && !isMine, publicStone);
    base.serviceProof = buildServiceProof(state, stall);
    if (isMine) {
      base.serviceProfile = stall.serviceProfile || defaultServiceProfile();
      base.serviceProfileOptions = owner ? buildServiceProfileOptions(owner, autoSnap) : null;
    }
  }
  return base;
}

function publicBlackListing() {
  return null;
}

function signedStallListings(stallsOrListings, ownerId) {
  const id = String(ownerId || "");
  const list = stallsOrListings || [];
  if (list[0]?.items || list[0]?.type === "goods" || list[0]?.type === "blindbox" || list[0]?.type === "service") {
    return list.filter((s) => s.ownerId === id && s.anonymous === false);
  }
  return list.filter((l) => l.ownerId === id && l.anonymous === false);
}

function sweepEmptyBlackGoodsStalls(state) {
  let changed = false;
  const stalls = [...(state.blackStalls || [])];
  for (const stall of stalls) {
    if (closeGoodsStallIfEmpty(state, stall)) changed = true;
  }
  return changed;
}

function openBlackStallForPlayer(player, payload = {}) {
  const { getState, randomUUID, addNews } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const locked = denyUnlessBmStall(player);
  if (locked) return locked;
  const type = String(payload.type || "");
  if (!STALL_TYPES.has(type)) {
    return { ok: false, message: "请选择摊位类型：卖物品 / 盲盒 / 技术支持。" };
  }
  const state = getState();
  if (findStallByOwner(state, player.id)) {
    return { ok: false, message: "你已有摊位，请先收摊再换类型。" };
  }
  const title = String(payload.title || "").trim().slice(0, 24) || `${player.name}的摊`;
  const blurb = String(payload.blurb || "").trim().slice(0, 80);
  const anonymous = payload.anonymous === true;
  const mask = blackMaskForPlayerId(player.id);
  const now = Date.now();
  const stall = {
    id: randomUUID(),
    ownerId: player.id,
    ownerName: player.name,
    anonymous,
    maskKey: mask.maskKey,
    maskName: mask.maskName,
    type,
    title,
    blurb,
    status: "setup",
    createdAt: now,
    updatedAt: now,
    items: [],
    pool: [],
    offers: [],
    blindPrice: BLACKMARKET_MIN_PRICE,
    blindDescription: "",
    serviceProfile: type === "service" ? defaultServiceProfile() : undefined
  };
  state.blackStalls = state.blackStalls || [];
  state.blackStalls.unshift(stall);
  const setupHint = type === "goods"
    ? "请上架至少一件物品"
    : type === "blindbox"
      ? `请补货至少${BLACKMARKET_BLIND_MIN} 件`
      : "请添加至少一项服务";
  return {
    ok: true,
    message: `摊位已创建，${setupHint}后才会出现在黑市广场。`,
    stall
  };
}

function closeBlackStallForPlayer(player) {
  const { getState, addNews } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const state = getState();
  const stall = findStallByOwner(state, player.id);
  if (!stall) return { ok: false, message: "你还没有摊位。" };
  if (stall.blindDraw) {
    return { ok: false, message: "有买家正在抽取盲盒，请稍后再收摊。" };
  }
  const openOrders = (state.blackServiceOrders || []).filter(
    (o) => o.sellerId === player.id && (o.status === "escrow" || o.status === "delivered")
  );
  if (openOrders.length) {
    return { ok: false, message: "仍有进行中的技术服务单，请先完成或取消。" };
  }
  if (stall.type === "goods") {
    for (const row of stall.items || []) returnItemToPlayer(player, row.type, row.item);
  }
  if (stall.type === "blindbox") {
    for (const row of stall.pool || []) returnItemToPlayer(player, row.type, row.item);
  }
  removeStallFromState(state, stall);
  addNews(`黑市有摊位收摊了。`, "trade");
  return { ok: true, message: "已收摊，货品退回库存。", stall };
}

function setBlackStallPausedForPlayer(player, paused) {
  const { getState } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const locked = denyUnlessBmStall(player);
  if (locked) return locked;
  const stall = findStallByOwner(getState(), player.id);
  if (!stall) return { ok: false, message: "你还没有摊位。" };
  if (stall.status === "setup") {
    return { ok: false, message: "请先完成上架，摊位才会营业。" };
  }
  if (stall.blindDraw) {
    return { ok: false, message: "有买家正在抽取盲盒，请稍后再休摊或开摊。" };
  }
  if (paused) {
    stall.status = "paused";
    stall.ownerPaused = true;
  } else if (stall.type === "blindbox" && (stall.pool || []).length < BLACKMARKET_BLIND_MIN) {
    return { ok: false, message: `盲盒池不足 ${BLACKMARKET_BLIND_MIN} 件，无法开卖。` };
  } else {
    stall.status = "open";
    stall.ownerPaused = false;
  }
  stall.updatedAt = Date.now();
  return { ok: true, message: paused ? "已休摊。" : "已恢复开摊。", stall };
}

function updateBlackStallMetaForPlayer(player, payload = {}) {
  const { getState, money } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const locked = denyUnlessBmStall(player);
  if (locked) return locked;
  const stall = findStallByOwner(getState(), player.id);
  if (!stall) return { ok: false, message: "你还没有摊位。" };
  if (payload.title != null) stall.title = String(payload.title).trim().slice(0, 24) || stall.title;
  if (payload.listingId != null) {
    const row = stall.type === "goods" && (stall.items || []).find((entry) => entry.id === payload.listingId);
    if (!row) return { ok: false, message: "商品已售出或撤下。" };
    const price = Number(payload.price);
    if (!Number.isSafeInteger(price) || price < BLACKMARKET_MIN_PRICE) return { ok: false, message: `价格须为不低于 ¥${BLACKMARKET_MIN_PRICE} 的整数。` };
    row.price = price;
    row.updatedAt = Date.now();
    stall.updatedAt = row.updatedAt;
    return { ok: true, message: "挂牌价已更新。", stall };
  }
  if (payload.blurb != null) stall.blurb = String(payload.blurb).trim().slice(0, 80);
  let anonChanged = false;
  if (Object.prototype.hasOwnProperty.call(payload, "anonymous")) {
    const nextAnon = payload.anonymous === true;
    if (stall.anonymous !== nextAnon) {
      stall.anonymous = nextAnon;
      anonChanged = true;
      if (nextAnon) {
        const mask = blackMaskForPlayerId(player.id);
        stall.maskKey = mask.maskKey;
        stall.maskName = mask.maskName;
      }
    }
  }
  if (stall.type === "blindbox") {
    if (payload.blindDescription != null) {
      stall.blindDescription = String(payload.blindDescription).trim().slice(0, 200);
    }
    if (payload.blindPrice != null) {
      const p = money(Number(payload.blindPrice));
      if (p < BLACKMARKET_MIN_PRICE) return { ok: false, message: `盲盒定价最低 ¥${BLACKMARKET_MIN_PRICE}。` };
      const current = money(Number(stall.blindPrice) || 0);
      const poolAvg = averageBlindPoolRefPrice(stall);
      // 占位—1：保留已有有效定价，或回退到池内均价，避免刷新后「保存设定」把价写—1
      if (p <= BLACKMARKET_MIN_PRICE) {
        if (current > BLACKMARKET_MIN_PRICE) {
          stall.blindPrice = current;
        } else if (poolAvg != null && poolAvg > BLACKMARKET_MIN_PRICE) {
          stall.blindPrice = poolAvg;
        } else {
          stall.blindPrice = p;
        }
      } else {
        stall.blindPrice = p;
      }
    }
    ensureBlindStallResolvedPrice(stall);
  }
  stall.updatedAt = Date.now();
  if (anonChanged) {
    return {
      ok: true,
      message: stall.anonymous ? "已开启匿名开摊。" : "已取消匿名，对外显示真实摊主。", stall
    };
  }
  return { ok: true, message: "已更新摊位信息。", stall };
}

function addGoodsToStallForPlayer(player, payload = {}) {
  const batch = addGoodsBatchToStallForPlayer(player, [payload]);
  if (!batch.ok) return batch;
  return {
    ok: true,
    message: batch.message,
    activated: batch.activated,
    price: payload.price,
    item: batch.items?.[0] || null,
    itemId: payload.itemId
  };
}

function withdrawGoodsFromStallForPlayer(player, listingId) {
  const { getState, addNews } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const state = getState();
  const stall = findStallByOwner(state, player.id);
  if (!stall || stall.type !== "goods") return { ok: false, message: "货品不存在。" };
  const idx = (stall.items || []).findIndex((r) => r.id === listingId);
  if (idx < 0) return { ok: false, message: "货品不存在。" };
  const row = stall.items[idx];
  returnItemToPlayer(player, row.type, row.item);
  stall.items.splice(idx, 1);
  stall.updatedAt = Date.now();
  if (closeGoodsStallIfEmpty(state, stall, { force: true })) {
    return {
      ok: true,
      message: "已撤下最后一件，摊位已自动收摊。", listing: row,
      stallClosed: true
    };
  }
  addNews("黑市有货品撤回。", "trade");
  return { ok: true, message: "已撤下，退回库存。", listing: row, stallClosed: false };
}

function addGoodsBatchToStallForPlayer(player, entries = []) {
  const { getState, randomUUID, addNews } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const locked = denyUnlessBmStall(player);
  if (locked) return locked;
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return { ok: false, message: "请选择要上架的物品。" };
  const stall = findStallByOwner(getState(), player.id);
  if (!stall) return { ok: false, message: "请先开摊。" };
  if (stall.type !== "goods") return { ok: false, message: "当前不是卖物品摊位。" };
  const slotsLeft = BLACKMARKET_GOODS_CAP - (stall.items || []).length;
  if (list.length > slotsLeft) {
    return { ok: false, message: `货架剩余 ${slotsLeft} 格，无法一次上架${list.length} 件。` };
  }
  const resolved = takeBmListEntries(player, list);
  if (!resolved.ok) {
    rollbackBmTaken(player, resolved.taken || [], resolved.returned || []);
    return { ok: false, message: resolved.message || "上架失败。" };
  }
  const taken = resolved.taken || [];
  if (taken.some((row) => row.price == null || row.price < BLACKMARKET_MIN_PRICE)) {
    rollbackBmTaken(player, taken, resolved.returned || []);
    return { ok: false, message: `上架参数无效（最低 ¥${BLACKMARKET_MIN_PRICE}）。` };
  }
  stall.items = stall.items || [];
  for (const row of taken) {
    stall.items.unshift({
      id: row.listingId || randomUUID(),
      type: row.type,
      item: row.item,
      price: row.price,
      createdAt: Date.now()
    });
  }
  stall.updatedAt = Date.now();
  const activation = tryActivateStall(stall, player);
  addNews(
    stall.anonymous
      ? `黑市货架上新 ${taken.length} 件。`
      : `${player.name} 在黑市一次挂出 ${taken.length} 件货品。`,
    "trade"
  );
  return {
    ok: true,
    message: activation.activated ? activation.message : `已上架${taken.length} 件到摊位。`,
    activated: activation.activated,
    count: taken.length,
    itemIds: list.map((e) => e.itemId),
    items: taken.map((row) => row.item),
    clearedParentIds: [...new Set(
      list.filter((e) => PLAN_LIST_TYPES.has(e.type)).map((e) => String(e.parentId || "")).filter(Boolean)
    )]
  };
}

function buyGoodsFromStallForPlayer(player, stallId, listingId, expectedPrice) {
  const { getState, money, spendCash, addItem, addNews, randomUUID } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const locked = denyUnlessBmBuy(player);
  if (locked) return locked;
  const state = getState();
  const stall = findStallById(state, stallId);
  if (!stall || stall.type !== "goods") return { ok: false, message: "摊位或货品不存在。" };
  if (stall.status !== "open") return { ok: false, message: "该摊位暂停营业。" };
  if (stall.npc === true && !isNpcBlackStall(stall)) return { ok: false, message: "该商贩已收摊，请重新选择摊位。" };
  if (isNpcBlackStall(stall)) return buyNpcBlackmarketGoods(player, stall, listingId, expectedPrice);
  if (stall.ownerId === player.id) return { ok: false, message: "不能购买自己的货。" };
  const seller = state.players.get(stall.ownerId);
  if (!seller) {
    removeStallFromState(state, stall);
    return { ok: false, code: "STALE_STALL", message: "摊主已失效，摊位已自动下架。" };
  }
  const idx = (stall.items || []).findIndex((r) => r.id === listingId);
  if (idx < 0) return { ok: false, message: "货品不存在。" };
  const row = stall.items[idx];
  const itemType = row?.type || row?.item?.type;
  if (!row?.item || !ITEM_TYPES.has(itemType)) {
    stall.items.splice(idx, 1);
    closeGoodsStallIfEmpty(state, stall, { force: true });
    return { ok: false, code: "STALE_LISTING", message: "货品已失效，已自动下架。" };
  }
  const total = money(row.price);
  if (expectedPrice != null && Number(expectedPrice) !== total) return { ok: false, code: "PRICE_CHANGED", message: "挂牌价已变化，请重新确认。" };
  if (isBlackmarketResource(itemType)) {
    const resource = ownedResource(seller, itemType, row.item.id);
    if (!resource || resource.blackmarketListingId !== row.id) return { ok: false, message: "挂牌资源已失效，请刷新黑市。" };
    const blocked = resourceBuyerBlock(player, itemType, resource, total);
    if (blocked) return { ok: false, message: blocked };
    return attemptAtomicMutation([player, seller, state.blackStalls, state.news], ({ afterCommit }) => {
      const sellerCashBefore = seller.cash;
      const acquired = receiveResource(player, itemType, resource, total, seller.id);
      paySellerNow(seller, total, `黑市售出${resource.name}`, { source: "blackmarket-sale", afterCommit,
        financeCategory: itemType === "equipment" ? "equipment-sale" : "personnel-sale" });
      const payroll = releaseSoldResource(seller, itemType, row);
      const netProceeds = seller.cash - sellerCashBefore;
      stall.items.splice(idx, 1);
      stall.updatedAt = Date.now();
      const stallClosed = closeGoodsStallIfEmpty(state, stall, { afterCommit });
      bumpBmDeal(seller);
      pushPendingRatings(player, seller, { tradeId: randomUUID(), tradeKind: "goods", stallTitle: stall.title, itemLabel: resource.name, itemName: resource.name, price: total, anonymous: stall.anonymous === true });
      requireApi().refreshPlayerReport?.(seller);
      requireApi().refreshPlayerReport?.(player);
      addNews(`${player.name} 在黑市${itemType === "employee" ? "转聘" : "买入"} ${resource.name}。`, "trade");
      if (payroll && requireApi().notifyPlayerToast) afterCommit(() => requireApi().notifyPlayerToast(seller, `员工转让价 ${total}，工资结算扣款 ${payroll.paid}，现金变动 ${netProceeds}，剩余欠薪 ${payroll.debt}（含历史账款及自动抵扣）。`));
      return { ok: true, message: itemType === "employee" ? `${acquired.name} 已加入员工名册，加入当天记薪。` : "设备已加入工坊，耐久与型号保持原样。", total, tax: 0, listing: row, stallClosed, payroll, netProceeds };
    });
  }
  return attemptAtomicMutation(
    [player, seller, state.blackStalls, state.news],
    ({ afterCommit }) => {
      if (!spendCash(player, total, `黑市购入${row.item.name}`, { source: "blackmarket", itemId: row.item.id })) {
        return { ok: false, message: "资金不足。" };
      }
      recordFinanceSale(seller, [row.item], total, { id: `blackmarket:${row.id}`, channel: "blackmarket" });
      paySellerNow(seller, total, `黑市售出${row.item.name}`, {
        source: "blackmarket-sale",
        afterCommit
      });
      bumpBmDeal(seller);
      pushPendingRatings(player, seller, {
        tradeId: randomUUID(),
        tradeKind: "goods",
        stallTitle: stall.title,
        itemLabel: row.item.name,
        itemName: row.item.name,
        price: total,
        anonymous: stall.anonymous === true
      });
      // Ensure type so addItem never silently drops the purchase.
      const added = addItem(player, row.item, { type: itemType, acquisitionCost: total });
      if (!added) throw new Error("blackmarket: buyer inventory rejected goods item");
      stall.items.splice(idx, 1);
      stall.updatedAt = Date.now();
      const stallClosed = closeGoodsStallIfEmpty(state, stall, { afterCommit });
      addNews(
        stall.anonymous
          ? `黑市成交${row.item.name}，成交价 ${total}。`
          : `${player.name} 买下 ${stall.ownerName} 摊上架${row.item.name}，成交 ${total}。`,
        "trade"
      );
      return {
        ok: true,
        message: stallClosed ? "黑市成交，卖家摊位已售罄收摊。" : "黑市成交。", tax: 0,
        total,
        listing: row,
        stallClosed
      };
    },
    { message: "黑市成交未完成，买卖双方资产已恢复，请重试。" }
  );
}

function stallInventoryItemsForPlayer(state, playerId) {
  const stall = findStallByOwner(state, playerId);
  if (!stall) return [];
  if (stall.type === "goods") return (stall.items || []).map((r) => r.item).filter(Boolean);
  if (stall.type === "blindbox") return [...(stall.pool || []), ...(stall.blindDraw?.candidates || [])].map((r) => r.item).filter(Boolean);
  return [];
}

function listBlackItemForPlayer(player, payload = {}) {
  const stall = findStallByOwner(requireApi().getState(), player?.id);
  if (!stall) return { ok: false, message: "请先开设卖物品摊位。" };
  if (stall.type !== "goods") return { ok: false, message: "当前摊位不是卖物品类型。" };
  return addGoodsToStallForPlayer(player, payload);
}

function buyBlackListingForPlayer(player, listingId) {
  const state = requireApi().getState();
  for (const stall of state.blackStalls || []) {
    if (stall.type !== "goods") continue;
    if ((stall.items || []).some((r) => r.id === listingId)) {
      return buyGoodsFromStallForPlayer(player, stall.id, listingId);
    }
  }
  return { ok: false, message: "摊位货品不存在。" };
}

function withdrawBlackListingForPlayer(player, listingId) {
  return withdrawGoodsFromStallForPlayer(player, listingId);
}

  return {
    stallSummary,
    publicBlackStall,
    publicBlackListing,
    signedStallListings,
    sweepEmptyBlackGoodsStalls,
    openBlackStallForPlayer,
    closeBlackStallForPlayer,
    setBlackStallPausedForPlayer,
    updateBlackStallMetaForPlayer,
    addGoodsToStallForPlayer,
    withdrawGoodsFromStallForPlayer,
    addGoodsBatchToStallForPlayer,
    buyGoodsFromStallForPlayer,
    stallInventoryItemsForPlayer,
    listBlackItemForPlayer,
    buyBlackListingForPlayer,
    withdrawBlackListingForPlayer
  };
}
