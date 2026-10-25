import { isMarketEquipment, equipmentProfile } from "./equipment-view.js";
import { cutoutPreviewSignature } from "../../preview-bitmap-cache.js";
import { lazyPreviewMarkup } from "../../lazy-preview.js";
import { MARKET_TAX_PERCENT, MARKET_TAX, MARKET_LISTING_MIN_PRICE } from "../../market-rules.js";
import { inlaySummary } from "../../product-meta.js";
import { EQUIPMENT_STAGE_LABELS } from "../../equipment-trading.js";
import { paintJadeCanvases } from "../../jade-renderer.js";
import { marketQualityMeta, deriveMaterialProfile, marketGemColor, marketRefValue, marketRarity } from "./catalog.js";

export function createMarketListingView({ elsRef, observeLazyPreviews, ui, helpers, ports }) {
  const { mlUi } = ui;
  const { formatMoney, escapeHtml, typeName } = helpers;
  const { openingKitsForItemVisual, marketProfileChips, mlVisual, marketSellables } = ports;

function mlSlotHtml(item, index = 0) {
  const isSelected = item.id === mlUi.selectedId;
  const selected = isSelected ? " selected" : "";
  const equipment = isMarketEquipment(item);
  const name = equipment ? [item.brand, item.modelName].filter(Boolean).join(" ") || item.name : item.name;
  const stage = item.materialStage || item.stage || "rough";
  const windows = Array.isArray(item.windows) ? item.windows.length : 0;
  const kitsSig = cutoutPreviewSignature(openingKitsForItemVisual(item));
  return `
    <article class="ml-slot${selected}" data-ml-id="${escapeHtml(item.id)}" title="${escapeHtml(name)}" role="option" aria-selected="${isSelected}" tabindex="${isSelected || index === 0 ? "0" : "-1"}">
      <div class="ml-slot-visual">${lazyPreviewMarkup(mlVisual(item), {
        eager: equipment,
        tint: item?.visual?.skin || item?.visual?.vein || "",
        cacheKey: `ml:${item.id}:${stage}:${windows}:${kitsSig}`
      })}</div>
      <div class="ml-slot-copy">
        <div class="ml-slot-name"><strong>${escapeHtml(name)}</strong></div>
      </div>
    </article>`;
}

function renderMlGrid() {
  const grid = elsRef.marketListModal?.querySelector("#mlGrid");
  if (!grid) return;
  let arr = marketSellables();
  if (mlUi.cat !== "all") arr = arr.filter((i) => i._type === mlUi.cat);
  if (mlUi.search) {
    const q = mlUi.search.toLowerCase();
    arr = arr.filter((i) =>
      String(i.name).toLowerCase().includes(q) ||
      String(i.quality || "").toLowerCase().includes(q) ||
      String(i.color || "").toLowerCase().includes(q) ||
      typeName(i._type, i).toLowerCase().includes(q)
    );
  }
  const sorters = {
    valueDesc: (a, b) => marketRefValue(b) - marketRefValue(a),
    valueAsc: (a, b) => marketRefValue(a) - marketRefValue(b),
    name: (a, b) => String(a.name).localeCompare(String(b.name), "zh-CN"),
    rarity: (a, b) => marketRarity(b) - marketRarity(a),
    type: (a, b) => a._type.localeCompare(b._type)
  };
  arr = arr.slice().sort(sorters[mlUi.sort] || sorters.valueDesc);
  grid.innerHTML = arr.length
    ? arr.map((item, index) => mlSlotHtml(item, index)).join("")
    : `<div class="ml-empty modal-empty-state">
        <strong>暂无可挂牌物品</strong>
        <p>${mlUi.cat === "equipment" ? "工坊中暂无可挂牌的闲置设备。" : "可出售玉料、成品或工坊中的闲置设备。"}</p>
      </div>`;
  observeLazyPreviews(grid);
}

function renderMlDetailEmpty() {
  const detail = elsRef.marketListModal?.querySelector("#mlDetail");
  if (detail) detail.innerHTML = `<div class="ml-detail-empty">从左侧选择一个物品进行挂牌</div>`;
}

function updateMlFee() {
  const fee = elsRef.marketListModal?.querySelector("#mlFee");
  if (!fee) return;
  const p = Math.max(100, Number(mlUi.price) || 0);
  fee.innerHTML = `
    <div><span>挂牌价</span><span>${formatMoney(p)}</span></div>
    <div><span>成交市场税（${MARKET_TAX_PERCENT}%，买家付）</span><span>${formatMoney(Math.round(p * MARKET_TAX))}</span></div>`;
}

function renderMlDetail(item) {
  const detail = elsRef.marketListModal?.querySelector("#mlDetail");
  if (!detail) return;
  const q = marketQualityMeta(item);
  const gem = marketGemColor(item);
  const ref = marketRefValue(item);
  const equipment = isMarketEquipment(item);
  const name = equipment ? [item.brand, item.modelName].filter(Boolean).join(" ") || item.name : item.name;
  const suggested = equipment ? ref : Math.max(100, Math.round(ref * 1.18));
  const profile = deriveMaterialProfile(item);
  const profileHtml = marketProfileChips(profile);
  // 是否暗料以 materialStage / revealed / windows 为准，不依赖 _type 分桶
  const isSealed = !equipment && profile.sealed;
  const summary = inlaySummary(item);
  const stage = item.materialStage || item.stage || "rough";
  const stateChip = equipment
    ? `<span class="ml-info-chip">${escapeHtml(EQUIPMENT_STAGE_LABELS[item.stage] || "加工")}设备</span>`
    : isSealed
    ? `<span class="ml-info-chip sealed">暗料原石 · 未揭露</span>`
    : stage === "opened"
      ? `<span class="ml-info-chip opened">明料 · 已开窗</span>`
      : `<span class="ml-info-chip">${escapeHtml(typeName(item._type, item))}</span>`;
  detail.innerHTML = `
    <div class="ml-detail-scroll" role="region" aria-label="物品详情与挂牌价格" tabindex="0">
    <div class="ml-detail-panels${equipment ? " is-equipment" : ""}">
      <div class="ml-detail-info">
        <div class="ml-info-visual ${gem}">${mlVisual(item)}</div>
        <div class="ml-info-copy">
          <b class="ml-info-name">${escapeHtml(name)}</b>
          <div class="ml-info-chips">
            ${stateChip}
            ${equipment ? `<span class="ml-info-chip">耐久 ${Number(item.condition ?? 100)}%</span><span class="ml-info-chip">科技 ${Number(item.techLevel || 1)} 级</span>${Number(item.condition) === 0 ? '<span class="ml-info-chip sealed">需维修后使用</span>' : ""}` : !isSealed ? `<span class="ml-info-chip">${escapeHtml(item.quality || q.name)} ${q.stars}</span>` : ""}
            ${!equipment && !isSealed && item.color ? `<span class="ml-info-chip">${escapeHtml(item.color)}</span>` : ""}
          </div>
          ${profile.hasReference ? `<div class="ml-info-ref">参考估值 <strong>${formatMoney(ref)}</strong></div>` : ""}
          ${summary ? `<p class="ml-info-summary">${escapeHtml(summary)}</p>` : ""}
        </div>
        <div class="ml-info-profile">
          ${equipment ? equipmentProfile(item, escapeHtml, formatMoney) : isSealed ? `<div class="ml-info-sealed">暗料原石：种水与颜色分布未揭露</div>` : profileHtml}
        </div>
      </div>
      <div class="ml-detail-pricing">
        <div class="ml-price-row">
          <label>挂牌价（不低于 ¥100）</label>
          <input id="mlPrice" type="number" inputmode="numeric" min="${MARKET_LISTING_MIN_PRICE}" value="${mlUi.price}">
        </div>
        <div class="ml-stepper">
          <button type="button" data-ml-step="large" data-ml-dir="-1">−${formatMoney(mlUi.stepLarge)}</button>
          <button type="button" data-ml-step="small" data-ml-dir="-1">−${formatMoney(mlUi.stepSmall)}</button>
          <button type="button" data-ml-step="small" data-ml-dir="1">+${formatMoney(mlUi.stepSmall)}</button>
          <button type="button" data-ml-step="large" data-ml-dir="1">+${formatMoney(mlUi.stepLarge)}</button>
        </div>
        ${profile.hasReference ? `<div class="ml-suggest">${equipment ? "建议价 = 同款新机价 ×80% − 修满费用" : "建议价 ≈ 参考价 ×1.18"} = <b>${formatMoney(suggested)}</b>（不低于 ¥100）</div>` : ""}
        ${equipment ? '<p class="jm-equipment-note">挂牌后设备暂停使用，员工留在工坊。撤单退回原设备，耐久保持不变。</p>' : ""}
        <div class="ml-fee" id="mlFee"></div>
      </div>
    </div>
    </div>
    <div class="ml-detail-actions">
      <button class="jm-btn-gold ml-confirm-btn" id="mlConfirm" data-action="confirmMarketList" type="button" disabled>确认挂牌</button>
    </div>`;
  paintJadeCanvases(detail);
  updateMlFee();
}

function setMlConfirm(enabled) {
  const btn = elsRef.marketListModal?.querySelector("#mlConfirm");
  if (btn) btn.disabled = !enabled;
}

  return { mlSlotHtml, renderMlGrid, renderMlDetailEmpty, updateMlFee, renderMlDetail, setMlConfirm };
}
