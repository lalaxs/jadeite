// Instance-owned implementation; legacy entry points remain one directory above.
import {
  NPC_STALLS, NPC_SCHEDULE_VERSION, NPC_SHIFT_MS, NPC_MIN_DISPLAY_MS, NPC_STALE_MS,
  NPC_ROTATION_MIN_MS, NPC_ROTATION_MAX_MS, NPC_TRAVELER_ROTATION_MIN_MS,
  NPC_TRAVELER_ROTATION_MAX_MS, NPC_REFILL_MIN_MS, NPC_REFILL_MAX_MS, NPC_MARKET_REFRESH_MS, NPC_TARGET_STALLS, npcRuleForStall, isNpcBlackStall, isNpcGoodsRow
} from "../../../../shared/domain/blackmarket/npc-rules.js";
import { NPC_PRICING_VERSION } from "../../../../shared/domain/blackmarket/npc-pricing.js";
import { attemptAtomicMutation } from "../../atomic-mutation.js";
import { BLACKMARKET_BLIND_MIN, BLACKMARKET_MIN_PRICE } from "../../../../shared/domain/blackmarket/bm-constants.js";
import { isBlackmarketResource } from "../../../../shared/domain/blackmarket/bm-resources.js";

export function createNpc({
  requireApi,
  denyUnlessBmBuy,
  createNpcGoodsRow,
  npcRandom,
  upgradeNpcOffcutRow,
  repriceNpcGoodsRow,
  completeNpcJadeAppearance,
  npcFinishStyle,
  resourceBuyerBlock,
  receiveResource
}) {
function randomDeadline(now, min, max, deps) {
  return now + min + Math.floor(npcRandom(deps.randomUUID())() * (max - min + 1));
}

function nextRotation(rule, now, deps) {
  return rule.roaming
    ? randomDeadline(now, NPC_TRAVELER_ROTATION_MIN_MS, NPC_TRAVELER_ROTATION_MAX_MS, deps)
    : randomDeadline(now, NPC_ROTATION_MIN_MS, NPC_ROTATION_MAX_MS, deps);
}

function oldestFirst(left, right) {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

function migratePricingQuota(stall, rule) {
  if (stall.npcPricingVersion === NPC_PRICING_VERSION) return false;
  // These merchants previously had no clearance slot. Reuse an existing item
  // once, preserving stock identity, scheduled deadlines and spent quotas.
  if (["employee", "equipment", "traveler"].includes(rule.role)
    && !stall.npcDiscountIssued && !stall.items.some((row) => row.npcDiscount)) {
    const row = stall.items.find((entry) => !entry.npcPremium);
    if (row) {
      row.npcDiscount = true;
      delete row.npcPricingVersion;
      stall.npcDiscountIssued = 1;
    }
  }
  stall.npcPricingVersion = NPC_PRICING_VERSION;
  return true;
}

function createRestockRow(stall, rule, now, flags, deps) {
  if (rule.assortment || isBlackmarketResource(rule.role)) return createNpcGoodsRow(rule, stall, now, flags, deps);
  const categories = rule.role === "stone" ? ["rough", "material"]
    : rule.role === "offcut" ? ["material", "slice", "bracelet"] : [];
  const missingType = categories.find((type) => !stall.items.some((row) => row.type === type));
  const kinds = new Set(stall.items.map((row) => row.item.kind));
  const needNewKind = rule.role === "finished" && kinds.size < 3;
  const styles = new Set(stall.items.map((row) => npcFinishStyle(row.item)));
  const missingStyles = [!styles.has("cord") && "cord", !styles.has("metal") && !styles.has("gem") && "metal"].filter(Boolean);
  const preferredStyles = rule.role === "finished" && rule.stock - stall.items.length <= missingStyles.length
    ? (missingStyles[0] === "cord" ? ["cord"] : ["metal", "gem"]) : [];
  const excludeKinds = [...(needNewKind ? kinds : []), ...(preferredStyles.length ? ["bracelet"] : [])];
  for (let attempt = 0; attempt < 32; attempt += 1) {
    if (missingType) {
      const index = categories.indexOf(missingType);
      stall.npcSequence += (index - stall.npcSequence % categories.length + categories.length) % categories.length;
    }
    const row = createNpcGoodsRow(rule, stall, now, { ...flags, excludeKinds, preferredStyles }, deps);
    if (missingType && row.type !== missingType) continue;
    if (needNewKind && kinds.has(row.item.kind)) continue;
    return row;
  }
  throw new Error("NPC supplier could not restore category coverage");
}

function fillOrdinaryStock(stall, rule, now, deps) {
  while (stall.items.length < rule.stock) {
    stall.items.push(createRestockRow(stall, rule, now, {}, deps));
  }
}

function startBatch(stall, rule, now, deps, { initial = false } = {}) {
  if (rule.roaming || initial) {
    stall.items = [];
  } else {
    const ordinary = stall.items.filter((row) => !row.npcDiscount && !row.npcPremium);
    const remove = new Set(ordinary.filter((row) => now - row.createdAt >= NPC_STALE_MS).map((row) => row.id));
    for (const row of ordinary.filter((entry) => now - entry.createdAt >= NPC_MIN_DISPLAY_MS).sort(oldestFirst)) {
      if (remove.size >= 2) break;
      remove.add(row.id);
    }
    stall.items = ordinary.filter((row) => !remove.has(row.id));
  }
  stall.npcBatch += 1;
  stall.npcDiscountIssued = stall.npcPremiumIssued = 0;
  // Sold special slots may have been filled with ordinary goods during the batch.
  const specialCount = rule.discount + (rule.roaming ? 2 : 0);
  while (stall.items.length > rule.stock - specialCount) {
    const oldest = [...stall.items].sort(oldestFirst).find((row) => now - row.createdAt >= NPC_MIN_DISPLAY_MS);
    // When every slot was just refilled, protect those goods instead of forcing a special offer in.
    if (!oldest) break;
    stall.items.splice(stall.items.indexOf(oldest), 1);
  }
  while (stall.npcDiscountIssued < rule.discount && stall.items.length < rule.stock) {
    stall.items.push(createRestockRow(stall, rule, now, { discount: true }, deps));
    stall.npcDiscountIssued += 1;
  }
  if (rule.roaming) {
    while (stall.npcPremiumIssued < 2) {
      stall.items.push(createNpcGoodsRow(rule, stall, now, { premium: true }, deps));
      stall.npcPremiumIssued += 1;
    }
  }
  fillOrdinaryStock(stall, rule, now, deps);
  stall.npcRotateAt = nextRotation(rule, now, deps);
  stall.npcRefillAt = null;
}

function maintainStall(stall, rule, now, deps) {
  let changed = false;
  const allowed = (stall.items || []).filter((row) => row?.item && isNpcGoodsRow(stall, row));
  if (allowed.length !== (stall.items || []).length) { stall.items = allowed; changed = true; }
  if (stall.items.length > rule.stock) {
    stall.items = [...stall.items].sort(oldestFirst).slice(-rule.stock);
    changed = true;
  }
  if (migratePricingQuota(stall, rule)) changed = true;
  let previousOffcut;
  for (const row of stall.items) {
    if (row.createdAt == null) { row.createdAt = stall.createdAt ?? now; changed = true; }
    if (completeNpcJadeAppearance(row.item)) {
      delete row.npcPricingVersion;
      changed = true;
    }
    if (row.item.leftover && upgradeNpcOffcutRow(row, deps, previousOffcut)) {
      delete row.npcPricingVersion;
      changed = true;
    }
    if (repriceNpcGoodsRow(rule, row)) changed = true;
    if (row.item.npcOffcut) previousOffcut = row.item;
  }
  if (stall.npcScheduleVersion !== NPC_SCHEDULE_VERSION) {
    // Migrate existing shelves without rerolling goods, prices or depleted quotas.
    stall.npcScheduleVersion = NPC_SCHEDULE_VERSION;
    if (stall.npcBatch >= 0) stall.npcRotateAt = nextRotation(rule, now, deps);
    stall.npcRefillAt = null;
    changed = true;
  }
  if (stall.npcBatch < 0 || now >= stall.npcRotateAt) {
    // Catch up once, using current time; downtime never accumulates extra batches.
    startBatch(stall, rule, now, deps, { initial: stall.npcBatch < 0 });
    changed = true;
  } else if (stall.npcRefillAt != null && now >= stall.npcRefillAt) {
    fillOrdinaryStock(stall, rule, now, deps);
    stall.npcRefillAt = null;
    changed = true;
  }
  if (stall.items.length < rule.stock && stall.npcRefillAt == null) {
    stall.npcRefillAt = randomDeadline(now, NPC_REFILL_MIN_MS, NPC_REFILL_MAX_MS, deps);
    changed = true;
  } else if (stall.items.length >= rule.stock && stall.npcRefillAt != null) {
    stall.npcRefillAt = null;
    changed = true;
  }
  if (changed) stall.updatedAt = now;
  return changed;
}

function shuffled(rows, rng) {
  const result = [...rows];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function maintainBlindStock(stall, rule, now, deps, replenish) {
  if (stall.blindDraw) return false;
  let changed = false;
  if (stall.npcBatch < 0 || replenish) {
    while (stall.pool.length < rule.stock) {
      stall.pool.push(createNpcGoodsRow(rule, stall, now, {}, deps));
      changed = true;
    }
    if (changed || stall.npcBatch < 0) {
      stall.blindPrice = Math.max(BLACKMARKET_MIN_PRICE, deps.money(stall.pool.reduce((sum, row) => sum + row.price, 0) / stall.pool.length));
      stall.npcBatch = Math.max(0, stall.npcBatch + 1);
    }
  }
  if (stall.pool.length >= BLACKMARKET_BLIND_MIN && stall.status !== "open") { stall.status = "open"; changed = true; }
  stall.npcScheduleVersion = NPC_SCHEDULE_VERSION;
  stall.npcRotateAt ||= nextRotation(rule, now, deps);
  if (changed) stall.updatedAt = now;
  return changed;
}

function maintainNpcBlackmarket(now = Date.now()) {
  const deps = requireApi();
  const state = deps.getState();
  state.blackStalls ||= [];
  let changed = false;
  for (let index = state.blackStalls.length - 1; index >= 0; index -= 1) {
    if (state.blackStalls[index].npc === true && !isNpcBlackStall(state.blackStalls[index])) {
      state.blackStalls.splice(index, 1);
      changed = true;
    }
  }
  const existing = state.blackStalls.filter(isNpcBlackStall);
  const deadline = existing.find((stall) => stall.npcMarketRefreshAt != null)?.npcMarketRefreshAt ?? now + NPC_MARKET_REFRESH_MS;
  const refresh = now >= deadline;
  const rng = npcRandom(deps.randomUUID());
  const departed = new Set();
  if (refresh) {
    for (const [type, count] of [["goods", 2], ["blindbox", 1]]) {
      const available = NPC_STALLS.filter((rule) => (rule.type || "goods") === type
        && !existing.some((stall) => stall.id === `bm-npc:${rule.key}`));
      const leaving = shuffled(existing.filter((stall) => stall.type === type && !stall.blindDraw && !npcRuleForStall(stall).permanent
        && now - stall.createdAt >= NPC_MARKET_REFRESH_MS), rng).slice(0, Math.min(count, available.length));
      for (const stall of leaving) {
        departed.add(stall.id);
        state.blackStalls.splice(state.blackStalls.indexOf(stall), 1);
        changed = true;
      }
    }
  }
  const refreshAt = refresh ? now + NPC_MARKET_REFRESH_MS : deadline;
  for (const [type, target] of [["goods", NPC_TARGET_STALLS - 6], ["blindbox", 6]]) {
    const active = state.blackStalls.filter((stall) => isNpcBlackStall(stall) && stall.type === type);
    const newcomers = shuffled(NPC_STALLS.filter((rule) => (rule.type || "goods") === type
      && !state.blackStalls.some((stall) => stall.id === `bm-npc:${rule.key}`)
      && !departed.has(`bm-npc:${rule.key}`)), rng)
      .sort((left, right) => Number(Boolean(right.permanent)) - Number(Boolean(left.permanent)))
      .slice(0, target - active.length);
    for (const rule of newcomers) {
      state.blackStalls.push({
        id: `bm-npc:${rule.key}`, ownerId: `npc:blackmarket:${rule.key}`, npc: true, npcRole: rule.role,
        type, title: rule.title, ownerName: rule.ownerName, blurb: rule.blurb, anonymous: false,
        status: "open", items: [], pool: [], offers: [], createdAt: now, updatedAt: now,
        npcSequence: 0, npcBatch: -1, npcDiscountIssued: 0, npcPremiumIssued: 0,
        ...(isBlackmarketResource(rule.role) ? { npcResourceVersion: 1 } : {}),
        npcShiftAt: now + NPC_SHIFT_MS, npcMarketRefreshAt: refreshAt
      });
      changed = true;
    }
  }
  for (const stall of state.blackStalls.filter(isNpcBlackStall)) {
    const rule = npcRuleForStall(stall);
    if (stall.npcMarketRefreshAt !== refreshAt) { stall.npcMarketRefreshAt = refreshAt; changed = true; }
    if (stall.type === "blindbox") {
      if (maintainBlindStock(stall, rule, now, deps, refresh)) changed = true;
      continue;
    }
    if (stall.status !== "open") { stall.status = "open"; changed = true; }
    if (refresh && stall.npcBatch >= 0 && stall.items.length < rule.stock) {
      const count = Math.min(2, rule.stock - stall.items.length);
      for (let index = 0; index < count; index += 1) stall.items.push(createRestockRow(stall, rule, now, {}, deps));
      stall.updatedAt = now;
      changed = true;
    }
    if (maintainStall(stall, rule, now, deps)) changed = true;
  }
  return { changed };
}

function buyNpcBlackmarketGoods(player, stall, listingId, expectedPrice) {
  const deps = requireApi();
  const locked = denyUnlessBmBuy(player);
  if (locked) return locked;
  const state = deps.getState();
  if (!isNpcBlackStall(stall)) return { ok: false, message: "该商贩已收摊，请重新选择摊位。" };
  const existing = stall.items.find((entry) => entry.id === listingId);
  if (existing && (!existing.item || !isNpcGoodsRow(stall, existing))) return { ok: false, message: "该类物品不支持在黑市摆摊出售。" };
  return attemptAtomicMutation([player, state.blackStalls, state.news], () => {
    const now = Date.now();
    // Check scheduled changes before accepting a quote left open in a purchase dialog.
    maintainNpcBlackmarket(now);
    if (!state.blackStalls.includes(stall)) return { ok: false, message: "摊主已经收摊，请重新选择摊位。" };
    const row = stall.items.find((entry) => entry.id === listingId);
    if (!row) return { ok: false, message: "该商品已售出或收摊换货，请选择其他商品。" };
    if (!row.item || !isNpcGoodsRow(stall, row)) return { ok: false, message: "该类物品不支持在黑市摆摊出售。" };
    const total = deps.money(row.price);
    if (expectedPrice != null && Number(expectedPrice) !== total) return { ok: false, code: "PRICE_CHANGED", message: "报价已变化，请重新确认。" };
    if (isBlackmarketResource(row.type)) {
      const blocked = resourceBuyerBlock(player, row.type, row.item, total);
      if (blocked) return { ok: false, message: blocked };
      receiveResource(player, row.type, row.item, total, stall.ownerId);
    } else {
      if (!deps.spendCash(player, total, `黑市购入${row.item.name}`, { source: "blackmarket", itemId: row.item.id })) return { ok: false, message: "资金不足。" };
      if (!deps.addItem(player, row.item, { type: row.type, acquisitionCost: total })) {
      throw new Error("NPC purchase inventory rejected item");
      }
    }
    stall.items.splice(stall.items.indexOf(row), 1);
    stall.updatedAt = now;
    maintainNpcBlackmarket(now);
    deps.refreshPlayerReport?.(player);
    deps.addNews(`${player.name} 在 ${stall.title} 买下 ${row.item.name}。`, "trade");
    return { ok: true, message: row.type === "employee" ? `${row.item.name} 已加入员工名册，加入当天记薪。` : row.type === "equipment" ? "设备已加入工坊。" : "黑市成交。", total, tax: 0, listing: row, stallClosed: false };
  }, { message: "交易未完成，现金与货品已恢复，请重试。" });
}

  return {
    isNpcBlackStall,
    maintainNpcBlackmarket,
    buyNpcBlackmarketGoods
  };
}
