import { inventoryBucketName, restoreInventoryItem } from "./inventory-items.js";
import { recordFinanceSale } from "../../shared/domain/economy/finance-book.js";
import {
  wantMatchesItem,
  WANT_DURATIONS,
  WANT_ITEM_TYPES,
  WANT_RULES
} from "../../shared/domain/jade/jade-rules.js";
import {
  featureAccess,
  grantPlayerExp
} from "../../shared/domain/progression/player-progression.js";
import { applyRepDelta } from "../../shared/domain/economy/metric-history.js";
import { pendingPayoutTotal } from "./economy-service.js";
import { attemptAtomicMutation } from "./atomic-mutation.js";
import { takeMarketEquipment, receiveMarketEquipment } from "./market-equipment.js";
import {
  MARKET_TAX,
  MARKET_TAX_PERCENT,
  MARKET_LISTING_MIN_PRICE,
  MARKET_LISTING_PER_PLAYER_CAP,
  MARKET_LISTING_GLOBAL_CAP,
  WANT_PER_PLAYER_CAP,
  WANT_GLOBAL_CAP,
  WANT_OFFERS_CAP
} from "../../shared/domain/economy/market-rules.js";
import { remainingMarketLiquidity, bookMarketLiquidity } from "./market-liquidity-service.js";
import { createAchievementRewards } from "./achievement-rewards-instance.js";

export function wantBucketName(type) {
  return inventoryBucketName(type) || "bracelets";
}

export function createMarketService(deps) {
  return createMarketModule(() => deps, createAchievementRewards({ earnCash: deps?.earnCash }).settlePlayerAchievements);
}

export function createMarketModule(getApi, settlePlayerAchievements) {
  function requireApi() {
    const api = getApi();
    if (!api) throw new Error("market-service: bindMarketApi() was not called");
    return api;
  }

function denyUnlessMarket(player) {
  const access = featureAccess(player, "market");
  if (!access.ok) return { ok: false, message: access.message, code: "FEATURE_LOCKED" };
  return null;
}

function restoreWantOfferItem(player, offer) {
  if (!player || !offer?.item) return;
  const item = offer.item;
  if (!item.type) item.type = offer.type;
  restoreInventoryItem(player, offer.type, item);
}

function refundWantOffers(want, exceptOfferId = null, options = {}) {
  const { getState, notifyPlayerToast } = requireApi();
  for (const offer of want.offers || []) {
    if (exceptOfferId && offer.id === exceptOfferId) continue;
    const seller = getState().players.get(offer.sellerId);
    if (seller) {
      restoreWantOfferItem(seller, offer);
      const notify = () => notifyPlayerToast(seller, "求购应征未成交，货品已退回库。");
      if (typeof options.afterCommit === "function") options.afterCommit(notify);
      else notify();
    }
  }
}

function sortWantOffers(offers = []) {
  return offers.slice().sort((a, b) => {
    const priceDiff = Number(a.price || 0) - Number(b.price || 0);
    if (priceDiff !== 0) return priceDiff;
    return Number(a.createdAt || 0) - Number(b.createdAt || 0);
  });
}

function removeWantById(wantId) {
  const { getState } = requireApi();
  const index = getState().wants.findIndex((want) => want.id === wantId);
  if (index >= 0) getState().wants.splice(index, 1);
}

function wantEscrowAmountForBudget(budget) {
  const { money } = requireApi();
  const b = money(budget);
  return b + money(b * MARKET_TAX);
}

function releaseWantEscrow(want, buyer, note) {
  const { money, releaseDeposit } = requireApi();
  const amount = money(want?.escrowAmount || 0);
  if (!want) return 0;
  want.escrowAmount = 0;
  if (!buyer || amount <= 0) return 0;
  releaseDeposit(buyer, amount, note, {
    source: "market-want-escrow-refund",
    wantId: want.id,
    repEligible: false
  });
  return amount;
}

function payWantFromEscrow(want, buyer, total, itemName) {
  const { money, spendCash, releaseDeposit } = requireApi();
  const need = money(total);
  const escrow = money(want.escrowAmount || 0);
  if (escrow > 0) {
    if (escrow < need) {
      const gap = need - escrow;
      if (!spendCash(buyer, gap, `求购补差${itemName}`, {
        source: "market-want",
        itemId: want.id
      })) {
        return false;
      }
      want.escrowAmount = 0;
      return true;
    }
    const refund = escrow - need;
    if (refund > 0) {
      releaseDeposit(buyer, refund, `求购结余退还：${want.title || itemName}`, {
        source: "market-want-escrow-refund",
        wantId: want.id,
        repEligible: false
      });
    }
    want.escrowAmount = 0;
    return true;
  }
  return spendCash(buyer, need, `求购成交${itemName}`, {
    source: "market-want",
    wantId: want.id
  });
}

function settleWantInternal(want, buyer, options = {}) {
  const {
    getState,
    money,
    uiMoney,
    randomUUID,
    addItem,
    advanceTask,
    addNews,
    emitUiEventToPlayer,
    notifyPlayerToast
  } = requireApi();
  const expired = Boolean(options.expired);
  const pickedOfferId = options.offerId ? String(options.offerId) : "";
  const rule = WANT_RULES[want.rule] ? want.rule : "lowest";

  if (!want || !buyer || want.ownerId !== buyer.id) {
    return { ok: false, reason: "无权结算该求购。" };
  }
  if (want.status !== "open") {
    return { ok: false, reason: "求购正在结算或已关闭。" };
  }

  const state = getState();
  const referencedOffers = (want.offers || []).filter((offer) =>
    offer?.item
    && WANT_ITEM_TYPES.includes(offer.type)
    && state.players.has(offer.sellerId)
  );
  if (referencedOffers.length !== (want.offers || []).length) {
    want.offers = referencedOffers;
  }
  const candidates = sortWantOffers(
    referencedOffers.filter((offer) =>
      wantMatchesItem(want, offer.item, offer.type) && Number(offer.price) <= Number(want.budget)
    )
  );
  const participantRoots = [
    buyer,
    ...referencedOffers.map((entry) => state.players.get(entry.sellerId)).filter(Boolean),
    state.wants,
    state.news
  ];

  if (expired && (rule === "manual" || !candidates.length)) {
    return attemptAtomicMutation(
      participantRoots,
      ({ afterCommit }) => {
        refundWantOffers(want, null, { afterCommit });
        releaseWantEscrow(want, buyer, `求购关闭退还冻结：${want.title}`);
        removeWantById(want.id);
        afterCommit(() => notifyPlayerToast(
          buyer,
          candidates.length
            ? "征集结束，未手选成交，应征已退回，冻结资金已退还。" : "征集结束，无有效应征，冻结资金已退还。"));
        return { ok: true, filled: false };
      },
      { message: "求购关闭未完成，冻结资金与应征货品已恢复，请重试。" }
    );
  }

  if (!candidates.length) {
    return { ok: false, reason: "暂无有效应征。" };
  }

  let offer = candidates[0];
  if (rule === "manual" || pickedOfferId) {
    if (!pickedOfferId) {
      return { ok: false, reason: "请选择一条应征成交。" };
    }
    offer = candidates.find((o) => o.id === pickedOfferId);
    if (!offer) {
      return { ok: false, reason: "所选应征无效或已失效。" };
    }
  }

  const price = money(offer.price);
  const tax = money(price * MARKET_TAX);
  const total = price + tax;
  const isLowest = offer.id === candidates[0].id;
  const seller = state.players.get(offer.sellerId);
  return attemptAtomicMutation(
    participantRoots,
    ({ afterCommit }) => {
      want.status = "settling";
      if (!payWantFromEscrow(want, buyer, total, offer.item.name)) {
        want.status = "open";
        if (expired) {
          refundWantOffers(want, null, { afterCommit });
          releaseWantEscrow(want, buyer, `求购到期退还冻结：${want.title}`);
          removeWantById(want.id);
          afterCommit(() => emitUiEventToPlayer(buyer, {
            type: "modal",
            tone: "warn",
            title: "求购到期结算失败",
            body: `应征需支付 ${uiMoney(total)}（含税），资金不足。求购已关闭，应征已退回，冻结资金已退还。`
          }));
          return { ok: true, filled: false };
        }
        afterCommit(() => emitUiEventToPlayer(buyer, {
          type: "modal",
          tone: "warn",
          title: "资金不足",
          body: `该应征需支付 ${uiMoney(total)}（成交价 ${uiMoney(price)} + 税费 ${uiMoney(tax)}）。请检查冻结与可用现金后再成交，或撤销求购。`
        }));
        return { ok: false, reason: "cash" };
      }

      recordFinanceSale(seller, [offer.item], price, { id: `want:${want.id}:${offer.id}`, channel: "market-want" });
      requireApi().earnCash(seller, price, `交易行成交：${offer.item.name}`, { source: "market-payout", itemId: offer.item.id });
      seller.soldCount = (seller.soldCount || 0) + 1;
      applyRepDelta(seller, 2, `交易行卖出：${offer.item.name}`, { source: "market_sell", itemId: offer.item?.id });
      seller.stats.tradeCount += 1;
      grantPlayerExp(seller, "market_sell");
      settlePlayerAchievements(seller);

      const added = addItem(buyer, offer.item, { type: offer.type, acquisitionCost: total });
      if (!added) throw new Error("market-service: buyer inventory rejected want item");
      buyer.stats.tradeCount += 1;
      grantPlayerExp(buyer, "market_buy");
      settlePlayerAchievements(buyer);
      advanceTask(buyer, "market_buy");

      refundWantOffers(want, offer.id, { afterCommit });
      want.escrowAmount = 0;
      removeWantById(want.id);
      addNews(
        `${buyer.name} 求购成交：从 ${offer.sellerName} 处以 ${uiMoney(price)} 购入 ${offer.item.name}。`,
        "trade"
      );

      const modeLabel = rule === "manual"
        ? (isLowest ? "手选成交（当前最低价）" : "手选成交")
        : "已按最低价成交";
      const saleText = `交易行求购成交「${offer.item.name}」，成交金额 ${uiMoney(price)}，货款已入账。`;
      requireApi().queueOfflineEvent?.(seller, { type: "market", text: saleText, income: price });
      afterCommit(() => notifyPlayerToast(seller, saleText));
      afterCommit(() => emitUiEventToPlayer(buyer, {
        type: "modal",
        tone: "trade",
        title: "求购成交",
        subtitle: offer.item.name,
        body: `${modeLabel}。未用完的冻结资金已退回。`
      }));
      return { ok: true, filled: true, offerId: offer.id };
    },
    { message: "求购成交未完成，买卖双方资产已恢复，请重试。" }
  );
}

function processExpiredWants(now = Date.now()) {
  const { getState } = requireApi();
  const state = getState();
  const due = state.wants.filter((want) => {
    if (want.status !== "open") return false;
    const expiresAt = Number(want.expiresAt || 0);
    if (expiresAt <= 0) return false;
    return expiresAt <= now;
  });
  if (!due.length) return false;
  for (const want of due) {
    const buyer = state.players.get(want.ownerId);
    if (!buyer) {
      refundWantOffers(want);
      removeWantById(want.id);
      continue;
    }
    settleWantInternal(want, buyer, { expired: true });
  }
  return true;
}

function reconcileMarketReferences() {
  const { getState } = requireApi();
  const state = getState();
  let orphanListings = 0;
  let orphanWants = 0;
  let orphanOffers = 0;
  let reopenedWants = 0;

  for (let index = state.listings.length - 1; index >= 0; index -= 1) {
    const listing = state.listings[index];
    if (listing?.item && state.players.has(listing.ownerId)) continue;
    state.listings.splice(index, 1);
    orphanListings += 1;
  }

  for (let index = state.wants.length - 1; index >= 0; index -= 1) {
    const want = state.wants[index];
    const buyer = want?.ownerId ? state.players.get(want.ownerId) : null;
    if (!want || !buyer) {
      if (want) refundWantOffers(want);
      state.wants.splice(index, 1);
      orphanWants += 1;
      continue;
    }
    if (want.status === "settling") {
      want.status = "open";
      reopenedWants += 1;
    }
    if (!Array.isArray(want.offers)) {
      want.offers = [];
      continue;
    }
    for (let offerIndex = want.offers.length - 1; offerIndex >= 0; offerIndex -= 1) {
      const offer = want.offers[offerIndex];
      if (offer?.item && state.players.has(offer.sellerId)) continue;
      want.offers.splice(offerIndex, 1);
      orphanOffers += 1;
    }
  }

  const changed = orphanListings + orphanWants + orphanOffers + reopenedWants > 0;
  return { changed, orphanListings, orphanWants, orphanOffers, reopenedWants };
}

function listItemForPlayer(player, { type, itemId, price } = {}) {
  const { getState, money, takeItem, randomUUID, advanceTask, addNews } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const locked = denyUnlessMarket(player);
  if (locked) return locked;
  const listingPrice = money(Number(price));
  if (!["rough", "material", "slice", "bracelet", "equipment"].includes(type) || !Number.isFinite(Number(price)) || listingPrice < MARKET_LISTING_MIN_PRICE) {
    return { ok: false, message: "挂单参数无效。" };
  }
  const state = getState();
  const mine = state.listings.filter((listing) => listing.ownerId === player.id).length;
  if (mine >= MARKET_LISTING_PER_PLAYER_CAP) {
    return {
      ok: false,
      message: `每位掌柜最多同时挂出 ${MARKET_LISTING_PER_PLAYER_CAP} 件货品。`,
      code: "PLAYER_MARKET_FULL"
    };
  }
  if (state.listings.length >= MARKET_LISTING_GLOBAL_CAP) {
    return { ok: false, message: "交易行货架已满，请稍后再试。", code: "MARKET_FULL" };
  }
  return attemptAtomicMutation([player, state.listings, state.news], () => {
    const equipment = type === "equipment" ? takeMarketEquipment(player, itemId, state) : null;
    if (equipment && !equipment.ok) return equipment;
    const item = equipment ? equipment.item : takeItem(player, type, itemId);
    if (!item) return { ok: false, message: "库存中找不到该货品。" };
    state.listings.unshift({
      id: randomUUID(),
      ownerId: player.id,
      ownerName: player.name,
      type,
      item,
      price: listingPrice,
      createdAt: Date.now()
    });
    advanceTask(player, "market_sell");
    addNews(`${player.name} 在交易行挂出 ${item.name}，标价${listingPrice}。`, "trade");
    return { ok: true, message: "已挂牌。", price: listingPrice, item };
  });
}

function buyListingForPlayer(player, listingId) {
  const {
    getState,
    money,
    spendCash,
    randomUUID,
    addItem,
    advanceTask,
    addNews
  } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const locked = denyUnlessMarket(player);
  if (locked) return locked;
  const state = getState();
  const index = state.listings.findIndex((listing) => listing.id === listingId);
  if (index < 0) return { ok: false, message: "挂单不存在。" };
  const listing = state.listings[index];
  if (listing.ownerId === player.id) return { ok: false, message: "不能购买自己的挂单。" };
  const seller = state.players.get(listing.ownerId);
  if (!seller || !listing.item) {
    state.listings.splice(index, 1);
    return {
      ok: false,
      code: "STALE_LISTING",
      message: "卖家或货品已失效，挂单已自动下架。"
    };
  }
  const tax = money(listing.price * MARKET_TAX);
  const total = listing.price + tax;
  return attemptAtomicMutation(
    [player, seller, state.listings, state.news],
    ({ afterCommit }) => {
      if (!spendCash(player, total, `交易行购入：${listing.item.name}（含税 ${tax}）`, { source: "market", itemId: listing.item.id,
        ...(listing.type === "equipment" ? { financeCategory: "equipment-purchase" } : {}) })) {
        return { ok: false, message: `资金不足（含 ${MARKET_TAX_PERCENT}% 市场税）。` };
      }
      if (listing.type !== "equipment") recordFinanceSale(seller, [listing.item], listing.price, { id: `market:${listing.id}`, channel: "market" });
      requireApi().earnCash(seller, listing.price, `交易行成交：${listing.item.name}`, { source: "market-payout", itemId: listing.item.id,
        ...(listing.type === "equipment" ? { financeCategory: "equipment-sale" } : {}) });
      seller.soldCount = (seller.soldCount || 0) + 1;
      applyRepDelta(seller, 2, `交易行卖出：${listing.item.name}`, { source: "market_sell", itemId: listing.item?.id });
      seller.stats.tradeCount += 1;
      grantPlayerExp(seller, "market_sell");
      settlePlayerAchievements(seller);
      const added = listing.type === "equipment"
        ? receiveMarketEquipment(player, listing.item, total, listing.ownerId)
        : addItem(player, listing.item, { type: listing.type, acquisitionCost: total });
      if (!added) throw new Error("market-service: buyer inventory rejected listing item");
      advanceTask(player, "market_buy");
      player.stats.tradeCount += 1;
      grantPlayerExp(player, "market_buy");
      settlePlayerAchievements(player);
      state.listings.splice(index, 1);
      const saleText = `交易行售出「${listing.item.name}」，成交金额 ${requireApi().uiMoney(listing.price)}，货款已入账。`;
      requireApi().queueOfflineEvent?.(seller, { type: "market", text: saleText, income: listing.price });
      afterCommit(() => requireApi().notifyPlayerToast?.(seller, saleText));
      addNews(`${player.name} 从 ${listing.ownerName} 手里买下 ${listing.item.name}，成交 ${listing.price}。`, "trade");
      return {
        ok: true,
        message: "交易成交。", listing,
        tax,
        total
      };
    },
    { message: "交易未完成，买卖双方资产已恢复，请重试。" }
  );
}

function withdrawListingForPlayer(player, listingId) {
  const { getState, addNews } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const state = getState();
  const index = state.listings.findIndex((listing) => listing.id === listingId);
  if (index < 0) return { ok: false, message: "挂单不存在。" };
  const listing = state.listings[index];
  if (listing.ownerId !== player.id) return { ok: false, message: "只能撤下自己的挂单。" };
  return attemptAtomicMutation([player, state.listings, state.news], () => {
    if (listing.type === "equipment") receiveMarketEquipment(player, listing.item);
    else restoreInventoryItem(player, listing.type, listing.item);
    state.listings.splice(index, 1);
    addNews(`${player.name} 撤回了交易行挂单 ${listing.item.name}。`, "trade");
    return { ok: true, message: listing.type === "equipment" ? "已撤单，设备已退回工坊。" : "已撤单，退回库存。", listing };
  });
}

function acceptMarketOfferForPlayer(player, listingId, offerId) {
  const { getState, earnCash, addNews, uiMoney } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const state = getState();
  const listing = state.listings.find((entry) => entry.id === listingId);
  if (!listing || listing.ownerId !== player.id) return { ok: false, message: "挂单不存在或不属于你。" };
  if (listing.type === "equipment") return { ok: false, message: "设备暂不参与批发商收购。" };
  const offer = listing.npcOffer;
  if (!offer || offer.id !== offerId) return { ok: false, message: "收购报价已失效。" };
  const remaining = remainingMarketLiquidity(player);
  if (remaining.count <= 0 || remaining.cash < offer.amount) {
    return { ok: false, message: "今日批发额度不足，请明日再来或选择其他销售渠道。" };
  }
  return attemptAtomicMutation([player, state.listings, state.news], () => {
    bookMarketLiquidity(player, offer.amount);
    state.listings.splice(state.listings.indexOf(listing), 1);
    recordFinanceSale(player, [listing.item], offer.amount, { id: `wholesale:${listing.id}:${offer.id}`, channel: "wholesale" });
    earnCash(player, offer.amount, `批发商收购：${listing.item.name}`, { source: "market-payout", itemId: listing.item.id });
    player.soldCount = (player.soldCount || 0) + 1;
    player.stats.tradeCount += 1;
    applyRepDelta(player, 1, `批发成交：${listing.item.name}`, { source: "market_sell", itemId: listing.item.id });
    grantPlayerExp(player, "market_sell");
    settlePlayerAchievements(player);
    addNews(`${player.name} 的${listing.item.name}以 ${uiMoney(offer.amount)} 成交给批发商。`, "trade");
    return { ok: true, listing, amount: offer.amount, message: "出售成功。" };
  });
}

function collectMarketPayoutForPlayer(player) {
  const { earnCash, addNews, uiMoney } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const payout = pendingPayoutTotal(player.payouts);
  if (payout.code === "EMPTY_PAYOUT") {
    return { ok: false, message: "没有可领取的交易行收益。" };
  }
  if (!payout.ok) {
    return {
      ok: false,
      code: payout.code,
      message: "交易行收益数据异常，记录已保留，请稍后重试。"
    };
  }
  const total = payout.total;
  earnCash(player, total, "交易行收益领取", { source: "market-payout" });
  player.payouts = [];
  addNews(`${player.name} 领取了交易行收益 ${uiMoney(total)}。`, "trade");
  return { ok: true, message: "已领取。", total };
}

function postWantForPlayer(player, payload = {}) {
  const {
    getState,
    money,
    clamp,
    holdDeposit,
    randomUUID,
    addNews,
    uiMoney
  } = requireApi();
  if (!player) return { ok: false, message: "玩家未就绪，请刷新后重试。" };
  const locked = denyUnlessMarket(player);
  if (locked) return locked;
  const title = String(payload.title || "").trim().slice(0, 40);
  const itemType = String(payload.itemTypes?.[0] || payload.itemType || "").trim();
  const durationKey = String(payload.durationKey || "10m");
  const duration = WANT_DURATIONS[durationKey];
  const rule = WANT_RULES[payload.rule] ? String(payload.rule) : "lowest";
  const budget = money(payload.budget);
  const minScore = clamp(Math.round(Number(payload.minScore) || 1), 1, 6);
  const note = String(payload.note || "").trim().slice(0, 80);
  const qualityKey = payload.qualityKey ? String(payload.qualityKey).trim() : "";
  let acceptedKinds = Array.isArray(payload.acceptedKinds)
    ? payload.acceptedKinds.map((k) => String(k)).filter(Boolean).slice(0, 12)
    : [];

  if (!title) return { ok: false, message: "请填写求购标题。" };
  if (!WANT_ITEM_TYPES.includes(itemType)) return { ok: false, message: "请选择求购品类。" };
  if (!duration) return { ok: false, message: "征集时长无效。" };
  if (budget < 100) return { ok: false, message: "预算至少 ¥100。" };
  if (itemType === "bracelet") {
    if (!acceptedKinds.length) acceptedKinds = ["bracelet"];
  } else {
    acceptedKinds = [];
  }
  if (qualityKey && !["bean", "glutinous", "stickyIce", "ice", "highIce", "glass", "violet", "red", "ink", "icy", "imperial"].includes(qualityKey)) {
    return { ok: false, message: "种水筛选无效。" };
  }
  const state = getState();
  const mineOpen = state.wants.filter((w) => w.ownerId === player.id && w.status === "open").length;
  if (mineOpen >= WANT_PER_PLAYER_CAP) {
    return { ok: false, message: `同时最多发布 ${WANT_PER_PLAYER_CAP} 条进行中求购。` };
  }
  if (state.wants.length >= WANT_GLOBAL_CAP) {
    return { ok: false, message: "求购板已满，稍后再试。" };
  }

  const escrowAmount = wantEscrowAmountForBudget(budget);
  if (!holdDeposit(player, escrowAmount, `求购冻结${title}（预算含税）`, {
    source: "market-want-escrow",
    repEligible: false
  })) {
    return { ok: false, message: `可用现金不足，发布需冻结 ${uiMoney(escrowAmount)}（预留 ${MARKET_TAX_PERCENT}% 税费）。` };
  }

  const now = Date.now();
  const want = {
    id: randomUUID(),
    ownerId: player.id,
    ownerName: player.name,
    title,
    note,
    itemTypes: [itemType],
    acceptedKinds,
    qualityKey: itemType === "bracelet" ? "" : qualityKey,
    minScore,
    budget,
    escrowAmount,
    durationKey,
    rule,
    status: "open",
    createdAt: now,
    expiresAt: duration.ms > 0 ? now + duration.ms : 0,
    offers: []
  };
  state.wants.unshift(want);
  addNews(`${player.name} 发布求购「${title}」，预算 ${uiMoney(budget)}。`, "trade");
  return { ok: true, message: "求购已发布。", want, escrowAmount };
}

function cancelWantForPlayer(player, wantId) {
  const { getState, addNews, uiMoney } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const state = getState();
  const want = state.wants.find((w) => w.id === wantId);
  if (!want) return { ok: false, message: "求购不存在。" };
  if (want.ownerId !== player.id) return { ok: false, message: "只能撤销自己的求购。" };
  if (want.status !== "open") return { ok: false, message: "求购正在结算，无法撤销。" };
  const sellers = (want.offers || [])
    .map((offer) => state.players.get(offer.sellerId))
    .filter(Boolean);
  return attemptAtomicMutation(
    [player, ...sellers, state.wants, state.news],
    ({ afterCommit }) => {
      refundWantOffers(want, null, { afterCommit });
      const refunded = releaseWantEscrow(want, player, `撤销求购退还冻结：${want.title}`);
      removeWantById(want.id);
      addNews(`${player.name} 撤销了求购「${want.title}」。`, "trade");
      return {
        ok: true,
        message: "已撤销求购。",
        refunded
      };
    },
    { message: "求购撤销未完成，冻结资金与应征货品已恢复，请重试。" }
  );
}

function applyWantForPlayer(player, { wantId, type, itemId, price } = {}) {
  const { getState, money, takeItem, randomUUID, uiMoney } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const locked = denyUnlessMarket(player);
  if (locked) return locked;
  const want = getState().wants.find((w) => w.id === wantId && w.status === "open");
  if (!want) return { ok: false, message: "求购不存在或已结束。" };
  if (want.ownerId === player.id) return { ok: false, message: "不能应征自己的求购。" };
  if (!WANT_ITEM_TYPES.includes(type)) return { ok: false, message: "货品类型无效。" };
  if (!(want.itemTypes || []).includes(type)) return { ok: false, message: "品类不符合求购要求。" };
  const offerPrice = money(price);
  if (offerPrice < 100) return { ok: false, message: "报价至少 ¥100。" };
  if (offerPrice > want.budget) {
    return { ok: false, message: `报价不能超过预算 ${uiMoney(want.budget)}。` };
  }
  if ((want.offers || []).length >= WANT_OFFERS_CAP) {
    return { ok: false, message: "该求购应征已满。" };
  }
  if ((want.offers || []).some((o) => o.sellerId === player.id)) {
    return { ok: false, message: "你已应征过该求购，请先撤回再改。" };
  }
  const item = takeItem(player, type, itemId);
  if (!item) return { ok: false, message: "库存中找不到该货品。" };
  if (!wantMatchesItem(want, item, type)) {
    if (!item.type) item.type = type;
    restoreInventoryItem(player, type, item);
    return { ok: false, message: "货品不符合求购条件。" };
  }
  if (!item.type) item.type = type;
  want.offers.push({
    id: randomUUID(),
    sellerId: player.id,
    sellerName: player.name,
    type,
    item,
    price: offerPrice,
    createdAt: Date.now()
  });
  return { ok: true, message: "已应征。", offerPrice };
}

function withdrawWantOfferForPlayer(player, { wantId, offerId } = {}) {
  const { getState } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const want = getState().wants.find((w) => w.id === wantId && w.status === "open");
  if (!want) return { ok: false, message: "求购不存在或已结束。" };
  const index = (want.offers || []).findIndex((o) => o.id === offerId);
  if (index < 0) return { ok: false, message: "应征不存在。" };
  const offer = want.offers[index];
  if (offer.sellerId !== player.id) return { ok: false, message: "只能撤回自己的应征。" };
  want.offers.splice(index, 1);
  restoreWantOfferItem(player, offer);
  return { ok: true, message: "已撤回应征。" };
}

function settleWantForPlayer(player, payload) {
  const { getState } = requireApi();
  if (!player) return { ok: false, reason: "未找到玩家。" };
  const wantId = typeof payload === "string" ? payload : payload?.wantId;
  const offerId = typeof payload === "object" && payload ? payload.offerId : null;
  const want = getState().wants.find((w) => w.id === wantId);
  if (!want) return { ok: false, reason: "求购不存在。" };
  return settleWantInternal(want, player, { expired: false, offerId });
}

  return {
    MARKET_TAX,
    MARKET_TAX_PERCENT,
    MARKET_LISTING_MIN_PRICE,
    MARKET_LISTING_PER_PLAYER_CAP,
    MARKET_LISTING_GLOBAL_CAP,
    WANT_PER_PLAYER_CAP,
    WANT_GLOBAL_CAP,
    WANT_OFFERS_CAP,
    wantBucketName,
    restoreWantOfferItem,
    refundWantOffers,
    sortWantOffers,
    removeWantById,
    wantEscrowAmountForBudget,
    releaseWantEscrow,
    payWantFromEscrow,
    settleWantInternal,
    processExpiredWants,
    reconcileMarketReferences,
    listItemForPlayer,
    buyListingForPlayer,
    withdrawListingForPlayer,
    acceptMarketOfferForPlayer,
    collectMarketPayoutForPlayer,
    postWantForPlayer,
    cancelWantForPlayer,
    applyWantForPlayer,
    withdrawWantOfferForPlayer,
    settleWantForPlayer
  };
}
