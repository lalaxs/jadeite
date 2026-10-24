// Instance-owned implementation; legacy entry points remain one directory above.
import {
  BLACKMARKET_MIN_PRICE,
  BLACKMARKET_BLIND_MIN,
  BLACKMARKET_BLIND_CAP,
  BLACKMARKET_BLIND_DRAW_COUNT,
  BLACKMARKET_BLIND_DRAW_TIMEOUT_MS,
  BLACKMARKET_BLIND_EXTRA_RATES
} from "../../../../shared/domain/blackmarket/bm-constants.js";
import { attemptAtomicMutation } from "../../atomic-mutation.js";
import { isBlackmarketResource } from "../../../../shared/domain/blackmarket/bm-resources.js";
import { recordFinanceSale, recordFinanceOtherIncome } from "../../../../shared/domain/economy/finance-book.js";

export function createBlind({
  requireApi,
  denyUnlessBmBuy,
  denyUnlessBmStall,
  bumpBmDeal,
  PLAN_LIST_TYPES,
  ITEM_TYPES,
  findStallByOwner,
  findStallById,
  stallDisplayName,
  takeBmListEntries,
  rollbackBmTaken,
  returnItemToPlayer,
  removeStallFromState,
  tryActivateStall,
  syncBlindPause,
  averageBlindPoolRefPrice,
  paySellerNow,
  pushPendingRatings
}) {
function resolvedBlindStallPrice(stall) {
  if (!stall || stall.type !== "blindbox") return null;
  const current = Math.max(0, Math.round(Number(stall.blindPrice) || 0));
  if (current > BLACKMARKET_MIN_PRICE) return current;
  const avg = averageBlindPoolRefPrice(stall);
  if (avg == null || avg <= BLACKMARKET_MIN_PRICE) return current || BLACKMARKET_MIN_PRICE;
  return avg;
}

function ensureBlindStallResolvedPrice(stall, now = Date.now()) {
  const price = resolvedBlindStallPrice(stall);
  if (price == null) return null;
  const current = Math.max(0, Math.round(Number(stall.blindPrice) || 0));
  if (price !== current) {
    stall.blindPrice = price;
    stall.updatedAt = now;
  }
  return price;
}

function addBlindboxItemsForPlayer(player, entries = [], options = {}) {
  const { getState, addNews, money, randomUUID } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const locked = denyUnlessBmStall(player);
  if (locked) return locked;
  const stall = findStallByOwner(getState(), player.id);
  if (!stall || stall.type !== "blindbox") return { ok: false, message: "当前不是盲盒摊位。" };
  if (stall.blindDraw) {
    return { ok: false, message: "有买家正在抽取盲盒，请稍后再补货。" };
  }
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return { ok: false, message: "请选择要放入盲盒的物品。" };
  if (list.some((entry) => isBlackmarketResource(entry.type))) return { ok: false, message: "员工和设备只能明码挂牌，不能放入盲盒。" };
  stall.pool = stall.pool || [];
  const slotsLeft = BLACKMARKET_BLIND_CAP - stall.pool.length;
  if (slotsLeft <= 0) {
    return { ok: false, message: `盲盒池已满（最多 ${BLACKMARKET_BLIND_CAP} 件）。` };
  }
  if (list.length > slotsLeft) {
    return { ok: false, message: `盲盒池剩余 ${slotsLeft} 格，无法一次放入 ${list.length} 件。` };
  }
  const requestedRaw = options.blindPrice != null && options.blindPrice !== ""
    ? money(Number(options.blindPrice))
    : null;
  if (requestedRaw != null && requestedRaw < BLACKMARKET_MIN_PRICE) {
    return { ok: false, message: `盲盒定价最低 ¥${BLACKMARKET_MIN_PRICE}。` };
  }
  // 占位—1 视为「未设置」，后面用已保存定价或池内均价兜
  const requested = requestedRaw != null && requestedRaw > BLACKMARKET_MIN_PRICE
    ? requestedRaw
    : null;
  const resolved = takeBmListEntries(player, list);
  if (!resolved.ok) {
    rollbackBmTaken(player, resolved.taken || [], resolved.returned || []);
    return { ok: false, message: resolved.message || "放入失败。" };
  }
  const taken = resolved.taken || [];
  for (const row of taken) {
    stall.pool.push({
      id: randomUUID(),
      type: row.type,
      item: row.item,
      createdAt: Date.now()
    });
  }

  // 统一定价优先级：客户端有效价 > 摊位已保存定—> 池内货参考均
  const current = money(Number(stall.blindPrice) || 0);
  const poolAvg = averageBlindPoolRefPrice(stall);
  if (requested != null) {
    stall.blindPrice = requested;
  } else if (current > BLACKMARKET_MIN_PRICE) {
    stall.blindPrice = current;
  } else if (poolAvg != null && poolAvg > BLACKMARKET_MIN_PRICE) {
    stall.blindPrice = poolAvg;
  } else if (requestedRaw != null) {
    stall.blindPrice = requestedRaw;
  }

  const activation = tryActivateStall(stall, player);
  if (!activation.activated && stall.pool.length >= BLACKMARKET_BLIND_MIN && stall.status === "paused") {
    stall.status = "open";
    stall.ownerPaused = false;
  }
  ensureBlindStallResolvedPrice(stall);
  stall.updatedAt = Date.now();
  addNews(`${stallDisplayName(stall)} 盲盒补货 ${taken.length} 件。`, "trade");
  return {
    ok: true,
    message: activation.activated
      ? activation.message
      : `已放入盲盒 ${taken.length} 件（池内 ${stall.pool.length}）。`,
    activated: activation.activated,
    poolCount: stall.pool.length,
    blindPrice: stall.blindPrice,
    clearedParentIds: [...new Set(
      list.filter((e) => PLAN_LIST_TYPES.has(e.type)).map((e) => String(e.parentId || "")).filter(Boolean)
    )]
  };
}

function withdrawBlindboxItemForPlayer(player, poolEntryId) {
  const { getState, addNews } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const stall = findStallByOwner(getState(), player.id);
  if (!stall || stall.type !== "blindbox") return { ok: false, message: "当前不是盲盒摊位。" };
  if (stall.blindDraw) {
    return { ok: false, message: "有买家正在抽取盲盒，请稍后再改池。" };
  }
  const key = String(poolEntryId || "");
  if (!key) return { ok: false, message: "请选择要下架的物品。" };
  const pool = stall.pool || [];
  const idx = pool.findIndex((row) =>
    String(row.id || "") === key || String(row.item?.id || "") === key
  );
  if (idx < 0) return { ok: false, message: "池内找不到该货品。" };
  const row = pool[idx];
  returnItemToPlayer(player, row.type, row.item);
  pool.splice(idx, 1);
  stall.pool = pool;
  const beforeStatus = stall.status;
  syncBlindPause(stall);
  stall.updatedAt = Date.now();
  const n = pool.length;
  const pausedNow = beforeStatus === "open" && stall.status === "paused";
  addNews(`${stallDisplayName(stall)} 盲盒下架 1 件（池内 ${n}）。`, "trade");
  let message = `已下架${row.item?.name || "物品"}」，退回库存（池内 ${n}/${BLACKMARKET_BLIND_CAP}）。`;
  if (pausedNow) {
    message += ` 低于 ${BLACKMARKET_BLIND_MIN} 件，已自动休摊。`;
  } else if (n < BLACKMARKET_BLIND_MIN) {
    message += ` 仍不足 ${BLACKMARKET_BLIND_MIN} 件，暂不可开卖。`;
  }
  return {
    ok: true,
    message,
    poolCount: n,
    paused: stall.status === "paused",
    itemName: row.item?.name || ""
  };
}

function blindExtraCost(price, takeCount) {
  const { money } = requireApi();
  const p = money(price);
  let extra = 0;
  for (let i = 1; i < takeCount; i += 1) {
    const rate = BLACKMARKET_BLIND_EXTRA_RATES[i] || 0;
    extra += money(p * rate);
  }
  return money(extra);
}

function publicBlindDrawCandidate(row, publicStone, index) {
  const item = row?.item;
  const pub = typeof publicStone === "function" ? publicStone(item) : item;
  return {
    slot: index,
    type: row.type,
    itemId: item?.id,
    item: pub
  };
}

function publicBlindDrawSession(draw, publicStone) {
  if (!draw) return null;
  const { money } = requireApi();
  const price = money(Number(draw.price) || 0);
  return {
    id: draw.id,
    stallId: draw.stallId,
    price,
    extraSecond: money(price * (BLACKMARKET_BLIND_EXTRA_RATES[1] ?? 0)),
    extraThird: money(price * (BLACKMARKET_BLIND_EXTRA_RATES[2] ?? 0)),
    expiresAt: draw.expiresAt,
    candidates: (draw.candidates || []).map((row, i) => publicBlindDrawCandidate(row, publicStone, i))
  };
}

function pickBlindCandidatesFromPool(pool, count) {
  const bag = [...(pool || [])];
  const taken = [];
  const n = Math.min(count, bag.length);
  for (let i = 0; i < n; i += 1) {
    const idx = Math.floor(Math.random() * bag.length);
    taken.push(bag.splice(idx, 1)[0]);
  }
  return { taken, remaining: bag };
}

function normalizeBlindSelection(draw, selectedItemIds) {
  const candidates = draw.candidates || [];
  const byId = new Map(candidates.map((row) => [String(row.item?.id), row]));
  const ordered = [];
  const seen = new Set();
  for (const raw of Array.isArray(selectedItemIds) ? selectedItemIds : []) {
    const id = String(raw || "");
    if (!id || seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    ordered.push(byId.get(id));
  }
  if (!ordered.length && candidates[0]) ordered.push(candidates[0]);
  return ordered.slice(0, BLACKMARKET_BLIND_DRAW_COUNT);
}

function startBlindboxDrawForPlayer(player, stallId) {
  const { getState, money, spendCash, addNews, randomUUID } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const locked = denyUnlessBmBuy(player);
  if (locked) return locked;
  const state = getState();
  const stall = findStallById(state, stallId);
  if (!stall || stall.type !== "blindbox") return { ok: false, message: "盲盒摊不存在。" };
  if (stall.ownerId === player.id) return { ok: false, message: "不能抽自己的盲盒。" };
  if (stall.blindDraw) {
    if (stall.blindDraw.buyerId === player.id) {
      return {
        ok: true,
        resumed: true,
        message: "继续完成当前抽选。", draw: publicBlindDrawSession(stall.blindDraw, null),
        poolCount: (stall.pool || []).length
      };
    }
    return { ok: false, message: "有人正在抽取盲盒，稍后再试。" };
  }
  const seller = state.players.get(stall.ownerId);
  if (!seller) {
    removeStallFromState(state, stall);
    return { ok: false, code: "STALE_STALL", message: "摊主已失效，盲盒摊已自动下架。" };
  }
  const pool = Array.isArray(stall.pool) ? stall.pool : [];
  const validPool = pool.filter((row) => row?.item && ITEM_TYPES.has(row.type || row.item.type));
  if (validPool.length !== pool.length) {
    stall.pool = validPool;
    stall.updatedAt = Date.now();
  }
  if (stall.status !== "open") return { ok: false, message: "该盲盒摊暂停售卖。" };
  if ((stall.pool || []).length < BLACKMARKET_BLIND_DRAW_COUNT) {
    return { ok: false, message: `盲盒库存不足 ${BLACKMARKET_BLIND_DRAW_COUNT} 件。` };
  }
  if ((stall.pool || []).length < BLACKMARKET_BLIND_MIN) {
    return { ok: false, message: `盲盒库存不足 ${BLACKMARKET_BLIND_MIN} 件。` };
  }
  const price = money(stall.blindPrice);
  if (price < BLACKMARKET_MIN_PRICE) return { ok: false, message: "盲盒未定价。" };
  return attemptAtomicMutation(
    [player, seller, state.blackStalls, state.news],
    ({ afterCommit }) => {
      if (!spendCash(player, price, `黑市盲盒${stall.title}`, { source: "blackmarket-blind" })) {
        return { ok: false, message: "资金不足。" };
      }

      const { taken, remaining } = pickBlindCandidatesFromPool(stall.pool, BLACKMARKET_BLIND_DRAW_COUNT);
      stall.pool = remaining;
      const now = Date.now();
      const drawId = randomUUID();
      stall.blindDraw = {
        id: drawId,
        stallId: stall.id,
        buyerId: player.id,
        price,
        startedAt: now,
        expiresAt: now + BLACKMARKET_BLIND_DRAW_TIMEOUT_MS,
        candidates: taken,
        entryPaid: true,
        sellerPaidEntry: false
      };
      paySellerNow(seller, price, `黑市盲盒进场${stall.title}`, {
        source: "blackmarket-blind-sale",
        afterCommit
      });
      stall.blindDraw.sellerPaidEntry = true;
      syncBlindPause(stall);
      stall.updatedAt = now;
      addNews(
        stall.anonymous
          ? `黑市盲盒开抽，标价 ${price}。`
          : `${player.name} 开始拆 ${stall.ownerName} 的盲盒。`,
        "trade"
      );
      return {
        ok: true,
        message: "已开抽，请挑选要带走的货品。", draw: publicBlindDrawSession(stall.blindDraw, null),
        poolCount: stall.pool.length,
        total: price
      };
    },
    { message: "盲盒开抽未完成，买卖双方资产已恢复，请重试。" }
  );
}

function settleBlindboxDrawForPlayer(player, payload = {}) {
  const { getState, money, spendCash, addItem, addNews, randomUUID } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const state = getState();
  const stallId = payload.stallId || payload.stall || "";
  const stall = findStallById(state, stallId) || findStallById(state, player._bmDrawStallId);
  // Also find by draw ownership if stallId missing
  let target = stall;
  if (!target || target.type !== "blindbox" || !target.blindDraw) {
    target = (state.blackStalls || []).find(
      (s) => s.type === "blindbox" && s.blindDraw?.buyerId === player.id
    );
  }
  if (!target || target.type !== "blindbox") return { ok: false, message: "盲盒摊不存在。" };
  const draw = target.blindDraw;
  if (!draw) return { ok: false, message: "当前没有进行中的抽选。" };
  if (draw.buyerId !== player.id) return { ok: false, message: "这不是你的抽选。" };
  if (payload.drawId && String(payload.drawId) !== String(draw.id)) {
    return { ok: false, message: "抽选已结束或已更换。" };
  }

  const seller = state.players.get(target.ownerId);
  return attemptAtomicMutation(
    [player, seller, state.blackStalls, state.news],
    ({ afterCommit }) => {
      let takenRows = normalizeBlindSelection(draw, payload.selectedItemIds);
      let extra = blindExtraCost(draw.price, takenRows.length);
      let degraded = false;
      if (extra > 0 && !spendCash(player, extra, `盲盒加购×${takenRows.length - 1}`, { source: "blackmarket-blind-extra" })) {
        // 关窗或余额不足时，保底只带走 1 件。
        takenRows = normalizeBlindSelection(draw, [draw.candidates[0]?.item?.id]);
        extra = 0;
        degraded = true;
      }

      const takenIds = new Set(takenRows.map((row) => String(row.item?.id)));
      const returned = (draw.candidates || []).filter((row) => !takenIds.has(String(row.item?.id)));
      target.pool = target.pool || [];
      for (const row of returned) target.pool.push(row);

      const got = [];
      const totalCost = money(Number(draw.price) + extra);
      if (seller) recordFinanceSale(seller, takenRows.map(row => row.item), totalCost,
        { id: `blind:${draw.id}`, channel: "blackmarket-blind" });
      let remainingCost = totalCost;
      for (const [index, row] of takenRows.entries()) {
        const acquisitionCost = index === takenRows.length - 1 ? remainingCost : Math.floor(totalCost / takenRows.length);
        remainingCost -= acquisitionCost;
        const added = addItem(player, row.item, { type: row.type || row.item.type, acquisitionCost });
        if (!added) throw new Error("blackmarket: buyer inventory rejected blind item");
        got.push(row.item);
      }

      if (seller && extra > 0) {
        paySellerNow(seller, extra, `黑市盲盒加购${target.title}`, {
          source: "blackmarket-blind-extra-sale",
          afterCommit
        });
      }
      if (seller) {
        bumpBmDeal(seller);
        const primary = got[0];
        pushPendingRatings(player, seller, {
          tradeId: randomUUID(),
          tradeKind: "blindbox",
          stallTitle: target.title,
          itemLabel: "盲盒",
          itemName: primary?.name || "盲盒货品",
          price: money(Number(draw.price || 0) + extra),
          anonymous: target.anonymous === true
        });
      }

      target.blindDraw = null;
      syncBlindPause(target);
      target.updatedAt = Date.now();

      const names = got.map((item) => item.name).join("。");
      addNews(
        target.anonymous
          ? `黑市盲盒成交，买入 ${got.length} 件。`
          : `${player.name} 拆盲盒带走 ${got.length} 件：${names}。`,
        "trade"
      );

      return {
        ok: true,
        message: degraded
          ? `加购余额不足，已保底带走${got[0]?.name || "货品"}`
          : `带走 ${got.length} 件：${names}`,
        items: got,
        returnedCount: returned.length,
        extra,
        total: money(Number(draw.price || 0) + extra),
        degraded,
        poolCount: target.pool.length,
        stallId: target.id
      };
    },
    { message: "盲盒结算未完成，资金与货品状态已恢复，请重试。" }
  );
}

function processExpiredBlindDraws(state, now = Date.now()) {
  let changed = false;
  for (const stall of state.blackStalls || []) {
    if (stall.type === "blindbox") {
      const beforePrice = Math.max(0, Math.round(Number(stall.blindPrice) || 0));
      const resolvedPrice = ensureBlindStallResolvedPrice(stall, now);
      if (resolvedPrice != null && resolvedPrice !== beforePrice) changed = true;
    }
    if (stall.type === "blindbox" && !stall.blindDraw) {
      const before = stall.status;
      syncBlindPause(stall);
      if (stall.status !== before) {
        stall.updatedAt = now;
        changed = true;
      }
    }
    const draw = stall.blindDraw;
    if (!draw || Number(draw.expiresAt || 0) > now) continue;
    const buyer = state.players?.get?.(draw.buyerId);
    if (!buyer) {
      // 买家消失：候选退回库存池并解除锁定。
      const seller = state.players?.get?.(stall.ownerId);
      if (seller && draw.sellerPaidEntry === true) recordFinanceOtherIncome(seller, draw.price, `blind-entry:${draw.id}`, now);
      stall.pool = stall.pool || [];
      for (const row of draw.candidates || []) stall.pool.push(row);
      stall.blindDraw = null;
      syncBlindPause(stall);
      stall.updatedAt = now;
      changed = true;
      continue;
    }
    const result = settleBlindboxDrawForPlayer(buyer, {
      stallId: stall.id,
      drawId: draw.id,
      selectedItemIds: [draw.candidates?.[0]?.item?.id]
    });
    if (result.ok) changed = true;
  }
  return changed;
}

function buyBlindboxFromStallForPlayer(player, stallId) {
  const started = startBlindboxDrawForPlayer(player, stallId);
  if (!started.ok) return started;
  const draw = started.draw;
  const firstId = draw?.candidates?.[0]?.itemId || draw?.candidates?.[0]?.item?.id;
  const settled = settleBlindboxDrawForPlayer(player, {
    stallId,
    drawId: draw?.id,
    selectedItemIds: firstId ? [firstId] : []
  });
  if (!settled.ok) return settled;
  return {
    ok: true,
    message: `拆出${settled.items?.[0]?.name || "货品"}`,
    tax: 0,
    total: settled.total,
    item: settled.items?.[0],
    items: settled.items,
    poolCount: settled.poolCount
  };
}

  return {
    resolvedBlindStallPrice,
    ensureBlindStallResolvedPrice,
    addBlindboxItemsForPlayer,
    withdrawBlindboxItemForPlayer,
    publicBlindDrawSession,
    startBlindboxDrawForPlayer,
    settleBlindboxDrawForPlayer,
    processExpiredBlindDraws,
    buyBlindboxFromStallForPlayer
  };
}
