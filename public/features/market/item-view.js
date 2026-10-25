import { createProductView } from "../../commerce/product-view.js";
import { equipmentCard } from "./equipment-view.js";
import { MARKET_TAX } from "../../market-rules.js";
import { inlaySummary } from "../../product-meta.js";
import { marketQualityKey, marketQualityMeta, deriveMaterialProfile } from "./catalog.js";

export function createMarketItemView({ getState, getDocument, helpers, ports, isCurrent }) {
  const { formatMoney, escapeHtml } = helpers;
  const { marketAffordable } = ports;
  const { openingKitsForItemVisual, itemPreviewKey: marketItemPreviewKey, prepareItemVisual: prepareMarketItemVisual, itemVisual: marketItemVisual, itemStageLabel: marketStageLabel, itemAttributeChips: marketCardAttrChips, itemProfile: marketCardProfile, materialProfileChips: marketProfileChips, priceDelta: marketPriceDelta, listingItemVisual: mlVisual } = createProductView({ getDocument, helpers, isCurrent });

function marketSellerMeta(ownerId, ownerName = "") {
  const players = getState()?.players || [];
  const hit = getState()?.marketPlayers?.[ownerId] || players.find((p) => p.id === ownerId);
  if (!hit) return { name: ownerName || "未知卖家", rep: null, level: null };
  return {
    name: hit.name || ownerName || "未知卖家",
    rep: Number.isFinite(Number(hit.rep)) ? Math.round(Number(hit.rep)) : null,
    level: Number.isFinite(Number(hit.level)) ? Number(hit.level) : null
  };
}

function marketSellerLine(ownerId, ownerName = "", options = {}) {
  const seller = marketSellerMeta(ownerId, ownerName);
  const bits = [escapeHtml(seller.name)];
  if (!options.compact) {
    if (seller.level != null) bits.push(`Lv.${seller.level}`);
    if (seller.rep != null) bits.push(`声望 ${seller.rep}`);
  }
  return bits.join(" · ");
}

function marketCardHtml(listing, isMine = false) {
  const item = listing.item;
  if (listing.type === "equipment") return equipmentCard(listing, isMine, { escapeHtml, formatMoney, total: listing.price + Math.round(listing.price * MARKET_TAX), can: marketAffordable(listing.price), seller: marketSellerLine(listing.ownerId, listing.ownerName, { compact: true }) });
  const q = marketQualityMeta(item);
  const qk = marketQualityKey(item);
  const can = marketAffordable(listing.price);
  const summary = inlaySummary(item);
  const profile = deriveMaterialProfile(item);
  const taxPay = Math.round(Number(listing.price) * (1 + MARKET_TAX));
  const badges = [];
  if (isMine) {
    badges.push(`<span class="jm-badge mine">我的挂单</span>`);
  } else if (Date.now() - Number(listing.createdAt || 0) < 3600000) {
    badges.push(`<span class="jm-badge new">新上</span>`);
  }
  if (profile.sealed) {
    badges.push(`<span class="jm-badge sealed">暗料</span>`);
  } else if (listing.type === "material" || listing.type === "rough" || item.materialStage === "opened" || item.materialStage === "rough") {
    // 与集市卡一致：明料/原石阶段角标
    const stage = item.materialStage || (listing.type === "material" ? "opened" : "rough");
    const opened = stage === "opened" || listing.type === "material" || Boolean(item.revealed || item.windows?.length);
    badges.push(opened
      ? `<span class="jm-badge opened">明料</span>`
      : `<span class="jm-badge sealed">暗料</span>`);
  } else if (listing.type === "slice") {
    badges.push(`<span class="jm-badge stage">片料</span>`);
  } else if (listing.type === "bracelet") {
    badges.push(`<span class="jm-badge stage">成品</span>`);
  }
  const actionBtn = isMine
    ? `${listing.npcOffer ? `<button class="jm-buy" data-action="openMarketOffer" data-payload="${escapeHtml(listing.id)}" type="button">批发商报价 · ${formatMoney(listing.npcOffer.amount)}</button>` : ""}<button class="jm-buy jm-buy-mine" data-action="withdrawListing" data-payload="${escapeHtml(listing.id)}" type="button">撤单</button>`
    : `<button class="jm-buy${can ? "" : " jm-buy-preview"}" data-action="openMarketBuy" data-payload="${escapeHtml(listing.id)}" type="button" aria-label="${escapeHtml(can
      ? `买入${item.name}，需支付${formatMoney(taxPay)}`
      : `查看${item.name}交易详情，现金不足，需支付${formatMoney(taxPay)}`)}">${can ? `买入 · ${formatMoney(taxPay)}` : `${formatMoney(taxPay)} · 现金不足`}</button>`;
  const ribbon = !profile.sealed && q.score >= 4
    ? `<div class="jm-ribbon" style="background:${q.color}">${escapeHtml(item.quality || q.name)}<span class="stars">${q.stars}</span></div>`
    : "";
  const cardAction = isMine
    ? ""
    : ` data-action="openMarketBuy" data-payload="${escapeHtml(listing.id)}"`;
  return `
  <article class="jm-card ${can ? "" : "locked"} q-score-${q.score} ${q.score >= 5 ? "q-legend" : ""} ${isMine ? "is-mine" : ""} ${profile.sealed ? "is-sealed" : ""}${isMine ? "" : " is-buyable"}" data-q="${qk}"${cardAction}>
    <div class="jm-art">
      ${ribbon}
      ${badges.length ? `<div class="jm-badges">${badges.join("")}</div>` : ""}
      ${marketItemVisual(item)}
    </div>
    <div class="jm-body">
      <div class="jm-nm">${escapeHtml(item.name)}</div>
      ${marketCardAttrChips(item, listing.type, profile)}
      ${summary ? `<p class="inlay-summary">${escapeHtml(summary)}</p>` : ""}
      ${marketCardProfile(item, profile)}
      ${isMine ? `<div class="jm-price-block">
        <span class="jm-price">${formatMoney(listing.price)}</span>
      </div>` : ""}
      <div class="jm-seller">
        <span class="who" title="${escapeHtml(listing.ownerName || "")}">🏪 ${marketSellerLine(listing.ownerId, listing.ownerName, { compact: true })}</span>
      </div>
      ${actionBtn}
    </div>
  </article>`;
}

  return { openingKitsForItemVisual, marketItemPreviewKey, prepareMarketItemVisual, marketItemVisual, marketStageLabel, marketCardAttrChips, marketCardProfile, marketProfileChips, marketPriceDelta, mlVisual, marketSellerMeta, marketSellerLine, marketCardHtml };
}
