// shop-module.js — 商铺：建筑 / 设备 / 镶嵌材料
import { EQUIPMENT_PARAM_HELP, formatEquipmentParamValue, renderEquipmentParamPills } from "../../equipment-param-view.js";
import { renderResourceCard } from "../../resource-card-view.js";
import { externalMaterialArtHtml } from "../../inventory-module.js";
import { activateModalLifecycle } from "../../modal-lifecycle.js";
import { quoteMaterialPurchase } from "../../material-pricing.js";
import { operatingReserveFor } from "../../../shared/domain/economy/operating-reserve.js";

let socketRef, getState, elsRef, getActiveView;
let activeShopTab = "building";
let eqShopStage = "carving";
let eqShopBrand = "all";
let eqShopSort = "price";
let eqShopSortDir = "asc";
let eqShopQuery = "";
let formatMoney, escapeHtml, empty, formatNumber, openGameModal, closeGameModal;
let shopModalLifecycleCleanup = null;
let shopTabsBound = false;
let pendingShopPurchase = null;

const EQ_STAGE_ORDER = ["opening", "carving", "finishing"];
const stageNames = { opening: "开料设备", carving: "规划设备", finishing: "精加工设备" };

// Frame the painted metal itself, excluding each PNG's transparent margins.
const SHOP_METAL_ART = Object.freeze({
  goldPure: { file: "gold-pure", frame: "120 367 1039 590" },
  silver925: { file: "silver-925", frame: "138 403 1002 570" },
  gold18k: { file: "gold-18k", frame: "106 323 1054 693" },
  platinum: { file: "platinum-pt950", frame: "120 343 1032 637" }
});

function shopMaterialArtHtml(material, options = {}) {
  const art = SHOP_METAL_ART[material.key || material.id];
  if (!art) return externalMaterialArtHtml(material, { escapeHtml, ...options });
  const sizeClass = options.sizeClass ? ` ${escapeHtml(options.sizeClass)}` : "";
  return `<div class="material-swatch material-swatch-metal shop-metal-swatch${sizeClass}" data-material-key="${escapeHtml(material.key || material.id)}" data-group="metal" aria-hidden="true">
    <svg viewBox="${art.frame}" preserveAspectRatio="xMidYMid meet" focusable="false">
      <image href="/assets/materials/${art.file}-handpainted-v1.png" width="1254" height="1254"/>
    </svg>
  </div>`;
}

function equipmentStageLabel(stage) {
  return { opening: "开料", carving: "规划", finishing: "精加工" }[stage] || "加工";
}

function materialPurchaseQuote(material, amount) {
  return quoteMaterialPurchase(material?.price, material?.packs, amount);
}

function buildEquipmentBrandGroups(equipment) {
  const brandGroups = equipment.reduce((groups, item) => {
    const brandKey = item.brandKey || item.brand || "unknown";
    if (!groups.has(brandKey)) {
      groups.set(brandKey, {
        brandKey,
        brand: item.brand || "未命名品牌",
        brandBasePrice: Number(item.brandBasePrice || 0),
        rows: []
      });
    }
    groups.get(brandKey).rows.push(item);
    return groups;
  }, new Map());
  return [...brandGroups.values()]
    .sort((left, right) => Number(left.brandBasePrice || 0) - Number(right.brandBasePrice || 0));
}

function filterEquipmentByBrand(rows) {
  if (eqShopBrand === "all") return rows;
  return rows.filter((item) => (item.brandKey || item.brand) === eqShopBrand);
}

function equipmentSortValue(item, key) {
  if (key === "price") return Number(item.price || 0);
  const attrs = item?.attrs || {};
  return Number(attrs[key] ?? item[key] ?? 0);
}

function sortEquipmentRows(rows) {
  const list = [...rows];
  const key = eqShopSort;
  const dir = eqShopSortDir === "desc" ? -1 : 1;
  list.sort((a, b) => {
    const diff = equipmentSortValue(a, key) - equipmentSortValue(b, key);
    if (diff !== 0) return diff * dir;
    return String(a.modelKey || a.name || "").localeCompare(String(b.modelKey || b.name || ""), "zh");
  });
  return list;
}

function equipmentSearchHaystack(item) {
  return [
    item.displayName, item.name, item.modelName, item.model, item.brand,
    item.modelKey, item.category, equipmentStageLabel(item.stage), stageNames[item.stage]
  ].filter(Boolean).join(" ").toLowerCase();
}

function filterEquipmentRows(rows) {
  const q = String(eqShopQuery || "").trim().toLowerCase();
  let next = rows;
  if (eqShopStage !== "all") next = next.filter((item) => item.stage === eqShopStage);
  if (q) next = next.filter((item) => equipmentSearchHaystack(item).includes(q));
  return sortEquipmentRows(next);
}

function renderEquipmentListing(item, stageLabel) {
  const brand = item.brand || "—";
  const modelName = item.modelName || item.model || "—";
  const title = item.displayName || item.name;
  const label = stageLabel || stageNames[item.stage] || equipmentStageLabel(item.stage);
  const cash = Number(getState().me?.cash || 0);
  const price = Number(item.price || 0);
  const canBuy = !!getState().me.assets?.workshopOwned && cash >= price;
  return renderResourceCard({
    type: "equipment", name: title, badge: label, className: "equipment-listing",
    attributes: `data-shop-equipment-model="${escapeHtml(item.modelKey)}"`,
    visualAttributes: `data-action="openShopEquipmentDetail" data-payload="${escapeHtml(item.modelKey)}" aria-label="查看${escapeHtml(title)}的设备详情" aria-haspopup="dialog"`,
    summary: [`${brand} · ${modelName}`, "全新设备 · 耐久 100%"],
    body: renderEquipmentParamPills(item, escapeHtml),
    footer: `<span class="inventory-slot-value"><span>售价</span><strong>${formatMoney(item.price)}</strong></span>
      ${getState().me.assets?.workshopOwned ? "" : '<span class="resource-card-summary">先购置工坊</span>'}
      <button data-action="buyWorkshopDevice" data-model-key="${escapeHtml(item.modelKey)}" type="button" ${canBuy ? "" : "disabled"}>${canBuy ? "购买" : "暂不可购买"}</button>`
  });
}

function openShopEquipmentDetail(modelKey) {
  const state = getState();
  const item = (state?.equipmentCatalog || []).find((entry) => String(entry.modelKey) === String(modelKey));
  if (!item) return;
  const price = Number(item.price || 0);
  const cash = Number(state.me?.cash || 0);
  const ownsWorkshop = Boolean(state.me?.assets?.workshopOwned);
  const canBuy = ownsWorkshop && cash >= price;
  const availability = !ownsWorkshop ? "先购置工坊后即可购买设备。" : cash < price ? `现金不足，还差 ${formatMoney(price - cash)}。` : "购买后可在工坊中使用。";
  const facts = [
    ["品牌", item.brand || "—"],
    ["型号", item.modelName || item.model || "—"],
    ["设备类型", item.category || "加工设备"],
    ["适用工序", equipmentStageLabel(item.stage)],
    ["技术等级", `Lv.${item.techLevel || 1}`],
    ["品牌定位", item.brandPositioning || item.focus || "—"]
  ];
  openGameModal?.({
    id: `shop-equipment:${item.modelKey}`,
    title: "设备详情",
    subtitle: `${stageNames[item.stage] || "加工设备"} · 全新设备 · 耐久 100%`,
    size: "standard",
    modalClass: "shop-equipment-detail-modal",
    html: `
      <div class="shop-equipment-detail">
        ${renderResourceCard({
          type: "equipment", name: item.displayName || item.name || "加工设备", badge: "全新设备",
          className: "resource-card--compact",
          summary: [item.focus || "加工设备", item.description].filter(Boolean)
        })}
        <dl class="shop-equipment-detail-facts">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
        <section class="shop-equipment-detail-params" aria-label="设备性能与说明">
          <h4>设备性能</h4>
          <div>${Object.entries(EQUIPMENT_PARAM_HELP).map(([key, help]) => `
            <div class="shop-equipment-detail-param">
              <div><span>${escapeHtml(help.label)}</span><strong>${escapeHtml(formatEquipmentParamValue(key, item.attrs?.[key] ?? item[key]))}</strong></div>
              <p>${escapeHtml(help.description.replace(`${help.label}：`, ""))}</p>
            </div>`).join("")}</div>
        </section>
        ${item.profile ? `<p class="shop-equipment-detail-profile">${escapeHtml(item.profile)}</p>` : ""}
        <p class="shop-equipment-detail-availability">${escapeHtml(availability)}</p>
      </div>`,
    footerHtml: `<div class="shop-equipment-detail-price"><span>售价</span><strong>${formatMoney(price)}</strong></div>`,
    actions: [
      { label: "关闭", variant: "secondary" },
      ...(canBuy ? [{ label: "购买设备", clientAction: "buyWorkshopDevice", payload: item.modelKey }] : [])
    ]
  });
}


function renderEquipmentShopListings(rows) {
  if (!rows.length) return `
    <div class="game-empty-state equipment-shop-empty">
      <span class="game-empty-state-mark" aria-hidden="true">机</span>
      <strong>没有符合条件的设备</strong>
      <p>清除工序、品牌或搜索条件后查看完整设备目录。</p>
      <button class="secondary" type="button" data-eq-reset>清除设备筛选</button>
    </div>`;
  if (eqShopStage !== "all") {
    const label = stageNames[eqShopStage];
    return `<div class="resource-card-grid">${rows.map((item) => renderEquipmentListing(item, label)).join("")}</div>`;
  }
  const sections = EQ_STAGE_ORDER.map((stage) => {
    const stageRows = rows.filter((item) => item.stage === stage);
    if (!stageRows.length) return "";
    const label = stageNames[stage];
    return `
      <section class="equipment-shop-stage-group">
        <div class="panel-head compact"><h5>${label}</h5><span>${stageRows.length} 款</span></div>
        <div class="resource-card-grid">${stageRows.map((item) => renderEquipmentListing(item, label)).join("")}</div>
      </section>
    `;
  }).filter(Boolean).join("");
  return sections || `
    <div class="game-empty-state equipment-shop-empty">
      <span class="game-empty-state-mark" aria-hidden="true">机</span>
      <strong>没有符合条件的设备</strong>
      <p>清除工序、品牌或搜索条件后查看完整设备目录。</p>
      <button class="secondary" type="button" data-eq-reset>清除设备筛选</button>
    </div>`;
}

function sortChip(key, label) {
  const on = eqShopSort === key;
  const arrow = on ? (eqShopSortDir === "asc" ? " ↑" : " ↓") : "";
  const title = on
    ? (eqShopSortDir === "asc" ? `${label}：小→大，再点切换为大→小` : `${label}：大→小，再点切换为小→大`)
    : `按${label}从小到大排序`;
  return `<button type="button" class="eq-shop-chip ${on ? "is-active" : ""}" data-eq-sort="${key}" aria-pressed="${on}" title="${escapeHtml(title)}">${escapeHtml(label)}${arrow}</button>`;
}

function renderEquipmentShopHtml() {
  const equipment = getState().equipmentCatalog || [];
  const brandGroups = buildEquipmentBrandGroups(equipment);

  const stageChip = (key, label) => `
    <button type="button" class="eq-shop-chip ${eqShopStage === key ? "is-active" : ""}" data-eq-stage="${key}" aria-pressed="${eqShopStage === key}">${label}</button>
  `;

  const brandChipHtml = [
    `<button type="button" class="eq-shop-chip ${eqShopBrand === "all" ? "is-active" : ""}" data-eq-brand="all" aria-pressed="${eqShopBrand === "all"}">全部品牌</button>`,
    ...brandGroups.map((brandGroup) => `
      <button type="button" class="eq-shop-chip ${eqShopBrand === brandGroup.brandKey ? "is-active" : ""}" data-eq-brand="${escapeHtml(brandGroup.brandKey)}" aria-pressed="${eqShopBrand === brandGroup.brandKey}">${escapeHtml(brandGroup.brand)}</button>
    `)
  ].join("");

  const rows = filterEquipmentRows(filterEquipmentByBrand(equipment));
  const hasFilters = eqShopStage !== "all" || eqShopBrand !== "all" || Boolean(String(eqShopQuery || "").trim());
  const stageLabel = eqShopStage === "all" ? "全部工序" : (stageNames[eqShopStage] || "当前工序");
  const bodyHtml = !equipment.length
    ? empty("设备目录未加载。")
    : `
      <div class="eq-shop-result-head" aria-live="polite">
        <span>显示 ${rows.length}/${equipment.length} 台 · ${escapeHtml(stageLabel)}</span>
        ${hasFilters ? '<button type="button" class="secondary" data-eq-reset>清除筛选</button>' : ""}
      </div>
      ${renderEquipmentShopListings(rows)}
    `;

  return `
    <div class="eq-shop">
      <div class="eq-shop-toolbar">
        <div class="eq-shop-row">
          <span class="eq-shop-row-label">工序</span>
          <div class="eq-shop-chips">
            ${stageChip("all", "全部")}
            ${stageChip("opening", "开料")}
            ${stageChip("carving", "规划")}
            ${stageChip("finishing", "精加工")}
          </div>
        </div>
        <div class="eq-shop-row">
          <span class="eq-shop-row-label">品牌</span>
          <div class="eq-shop-chips eq-shop-brands">${brandChipHtml}</div>
        </div>
        <div class="eq-shop-row eq-shop-row-tools">
          <div class="eq-shop-sort">
            <span>排序</span>
            <div class="eq-shop-chips">
              ${sortChip("price", "价格")}
              ${sortChip("speed", "速度")}
              ${sortChip("quality", "品质")}
              ${sortChip("risk", "风险")}
            </div>
          </div>
          <label class="eq-shop-search">
            <span class="sr-only">搜索设备</span>
            <input type="search" data-eq-search value="${escapeHtml(eqShopQuery)}" placeholder="搜索型号 / 代号 / 品牌…" aria-label="搜索设备型号、代号或品牌" autocomplete="off">
          </label>
        </div>
      </div>
      <div class="eq-shop-body">${bodyHtml}</div>
    </div>
  `;
}

function refreshEquipmentShop(preserveSearchFocus = false) {
  if (!elsRef?.equipmentShop) return;
  const active = document.activeElement;
  const isSearch = preserveSearchFocus && active?.matches?.("[data-eq-search]");
  const start = isSearch ? active.selectionStart : null;
  const end = isSearch ? active.selectionEnd : null;
  elsRef.equipmentShop.innerHTML = renderEquipmentShopHtml();
  if (isSearch) {
    const input = elsRef.equipmentShop.querySelector("[data-eq-search]");
    if (input) {
      input.focus();
      if (start != null && end != null) {
        try { input.setSelectionRange(start, end); } catch (_) { /* ignore */ }
      }
    }
  }
}

export function initShopModule(deps) {
  socketRef = deps.socket;
  getState = deps.getState;
  elsRef = deps.els;
  getActiveView = deps.getActiveView;
  ({ formatMoney, escapeHtml, empty, formatNumber, openGameModal, closeGameModal } = deps.helpers);
  initShopTabs();
  const register = deps.registerAction;
  if (typeof register === "function") {
    register("buyAssetListing", ({ payload }) => requestAssetPurchase(payload));
    register("buyMaterialPack", ({ payload }) => {
      const [materialId, amount] = String(payload).split("|");
      socketRef.emit("buyMaterialPack", {
        materialId,
        amount: Number(amount),
        requestId: globalThis.crypto?.randomUUID?.() || `material-${Date.now()}`
      });
    });
    register("buyWorkshopDevice", ({ payload, target }) => {
      const modelKey = target.dataset.modelKey || payload;
      requestEquipmentPurchase(modelKey);
    });
    register("openShopEquipmentDetail", ({ payload }) => openShopEquipmentDetail(payload));
    register("confirmShopPurchase", () => confirmShopPurchase());
    register("repairWorkshopDevice", ({ payload }) => {
      socketRef.emit("repairWorkshopDevice", {
        deviceId: payload,
        requestId: globalThis.crypto?.randomUUID?.() || `repair-${Date.now()}`
      });
    });
    register("shopSelectTab", ({ payload }) => setShopTab(payload));
  }
}

function openShopPurchaseConfirm(purchase) {
  pendingShopPurchase = purchase;
  const me = getState()?.me;
  const balance = Math.max(0, Number(me?.cash || 0) - purchase.price);
  const reserve = operatingReserveFor(me);
  const device = purchase.kind === "equipment"
    ? (getState()?.equipmentCatalog || []).find((item) => String(item.modelKey) === String(purchase.id)) : null;
  openGameModal?.({
    id: `shop-purchase:${purchase.kind}:${purchase.id}`,
    title: "确认大额购买",
    subtitle: purchase.name,
    tone: "warn",
    previewHtml: device ? renderResourceCard({
      type: "equipment", name: purchase.name, badge: "购买设备", className: "resource-card--compact",
      summary: [`${stageNames[device.stage] || "加工设备"} · 全新设备`, `${device.brand || "—"} · ${device.modelName || device.model || "—"}`]
    }) : "",
    body: balance < reserve ? `购买后剩余 ${formatMoney(balance)}。建议另留两次工资和下一轮进货周转金，合计约 ${formatMoney(reserve)}。` : "购买后立即生效。",
    stats: [
      { label: "价格", value: formatMoney(purchase.price) },
      { label: "购买后余额", value: formatMoney(balance) }
    ],
    actions: [
      { label: `确认购买 · ${formatMoney(purchase.price)}`, clientAction: "confirmShopPurchase", variant: "warn" },
      { label: "再想想", variant: "secondary" }
    ]
  });
}

function requestAssetPurchase(listingId) {
  const listing = (getState()?.assetListings || []).find((item) => String(item.id) === String(listingId));
  if (!listing) return;
  openShopPurchaseConfirm({
    kind: "asset",
    id: listing.id,
    name: listing.name || "功能资产",
    price: Number(listing.price || 0)
  });
}

function requestEquipmentPurchase(modelKey) {
  const item = (getState()?.equipmentCatalog || []).find((entry) => String(entry.modelKey) === String(modelKey));
  if (!item) return;
  if (!getState()?.me?.assets?.workshopOwned || Number(getState().me?.cash || 0) < Number(item.price || 0)) {
    openShopEquipmentDetail(modelKey);
    return;
  }
  openShopPurchaseConfirm({
    kind: "equipment",
    id: item.modelKey,
    name: item.displayName || item.name || item.modelName || "加工设备",
    price: Number(item.price || 0)
  });
}

function confirmShopPurchase() {
  const purchase = pendingShopPurchase;
  pendingShopPurchase = null;
  closeGameModal?.();
  if (!purchase) return;
  if (purchase.kind === "asset") {
    socketRef.emit("buyAssetListing", purchase.id);
    return;
  }
  socketRef.emit("buyWorkshopDevice", {
    modelKey: purchase.id,
    requestId: globalThis.crypto?.randomUUID?.() || `equipment-${Date.now()}`
  });
}

export function renderShop() {
  try {
    initShopTabs();
    if (!elsRef.shopListings || !getState()) {
      if (elsRef.shopListings) elsRef.shopListings.innerHTML = empty("等待商铺数据…");
      if (elsRef.equipmentShop) elsRef.equipmentShop.innerHTML = empty("等待设备目录…");
      if (elsRef.materialInventory) elsRef.materialInventory.innerHTML = `<div class="mat-empty">等待商铺数据…<br>若长时间未加载，请重启服务器并强制刷新浏览器(Ctrl+Shift+R)。</div>`;
      return;
    }
    const assetListings = getState().assetListings || [];
    const cash = Number(getState().me?.cash || 0);
    elsRef.shopListings.innerHTML = assetListings.map((listing) => {
      const price = Number(listing.price || 0);
      const canBuy = cash >= price;
      return `
        <div class="item-row asset-listing">
          <div class="item-title"><span>${escapeHtml(listing.name)}</span></div>
          <p class="item-meta">${escapeHtml(listing.description)}</p>
          <div class="card-actions">
            <button data-action="buyAssetListing" data-payload="${listing.id}" ${canBuy ? "" : "disabled"}>${canBuy ? `购买 · ${formatMoney(price)}` : `现金不足 · 需 ${formatMoney(price)}`}</button>
          </div>
        </div>
      `;
    }).join("") || `
      <div class="game-empty-state shop-empty-state">
        <span class="game-empty-state-mark" aria-hidden="true">铺</span>
        <strong>建筑与许可已经购齐</strong>
        <p>可以继续添置加工设备，或补充镶嵌材料。</p>
        <button type="button" data-action="shopSelectTab" data-payload="equipment">查看加工设备</button>
      </div>`;

    if (elsRef.equipmentShop) {
      elsRef.equipmentShop.innerHTML = renderEquipmentShopHtml();
    }

    // ---- 镶嵌材料：材料卡片 + 购买弹窗 ----
    if (!elsRef.materialInventory) return;
    const cat = getState().materialCatalog || [];
    const inv = getState().me.externalMaterials || {};
    if (!cat.length) {
      elsRef.materialInventory.innerHTML = `<div class="mat-empty">商铺材料目录未加载。<br>常见原因：① 服务器未重启；② 浏览器缓存旧 JS。<br>请重启服务器后按 Ctrl+Shift+R 强制刷新。</div>`;
      return;
    }
    const rowHtml = (m) => {
      const held = Math.round(Number(inv[m.key] || 0));
      return `
        <article class="mat-card" data-material-id="${m.id}">
          <div class="mat-art">
            ${shopMaterialArtHtml(m)}
            <span class="mat-art-tag">${escapeHtml(m.unitLabel)}</span>
          </div>
          <div class="mat-info">
            <div class="mat-title-row">
              <h3 class="mat-name">${escapeHtml(m.name)}</h3>
            </div>
            <div class="mat-prices">
              <div class="mat-price">
                <span>当前单价</span>
                <strong>${formatMoney(m.price)}<i>/${m.unitLabel}</i></strong>
              </div>
              <div class="mat-price">
                <span>我的持有</span>
                <strong>${formatNumber(held)}<i>${m.unitLabel}</i></strong>
              </div>
            </div>
            <button class="mat-buy-btn" type="button" data-material-id="${m.id}">购买</button>
          </div>
        </article>
      `;
    };
    elsRef.materialInventory.innerHTML = `<div class="mat-list">${cat.map(rowHtml).join("")}</div>`;
    applyShopTab();
  } catch (err) {
    console.error("[renderShop] 渲染失败:", err);
    if (elsRef.materialInventory) {
      elsRef.materialInventory.innerHTML = `<div class="mat-empty" style="color:#c76046">商铺渲染出错：${escapeHtml(String(err?.message || err))}<br>请按 F12 → Console 查看详情。</div>`;
    }
  }
}
// ---- 商铺页签切换 + 材料自由数量购买 ----
function initShopTabs() {
  const shopView = document.querySelector('section.view[data-view="shop"]');
  if (!shopView) return;
  bindShopTabButtons(shopView);
  if (shopTabsBound) return;
  shopTabsBound = true;
  shopView.addEventListener("click", onShopClick);
  shopView.addEventListener("keydown", onShopTabKeydown);
  shopView.addEventListener("input", (e) => {
    if (!e.target.matches?.("[data-eq-search]")) return;
    eqShopQuery = e.target.value || "";
    refreshEquipmentShop(true);
  });
}

function onShopTabKeydown(event) {
  const current = event.target.closest?.('.shop-tab[role="tab"]');
  if (!current || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...current.closest('[role="tablist"]')?.querySelectorAll('.shop-tab[role="tab"]') || []];
  if (!tabs.length) return;
  const index = tabs.indexOf(current);
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  const next = tabs[nextIndex];
  setShopTab(next.dataset.tab);
  next.focus();
}

function bindShopTabButtons(shopView) {
  shopView.querySelectorAll(".shop-tabs > .shop-tab[data-tab]").forEach((button) => {
    if (button.dataset.shopTabBound === "1") return;
    button.dataset.shopTabBound = "1";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setShopTab(button.dataset.tab);
    });
  });
}
function onShopClick(e) {
  const tabBtn = e.target.closest(".shop-tab[data-tab]");
  if (tabBtn && ["building", "equipment", "material"].includes(tabBtn.dataset.tab)) {
    e.stopPropagation();
    setShopTab(tabBtn.dataset.tab);
    return;
  }
  const stageBtn = e.target.closest("[data-eq-stage]");
  if (stageBtn) {
    eqShopStage = stageBtn.dataset.eqStage || "all";
    refreshEquipmentShop();
    return;
  }
  const brandBtn = e.target.closest("[data-eq-brand]");
  if (brandBtn) {
    eqShopBrand = brandBtn.dataset.eqBrand || "all";
    refreshEquipmentShop();
    return;
  }
  const sortBtn = e.target.closest("[data-eq-sort]");
  if (sortBtn) {
    const key = sortBtn.dataset.eqSort || "price";
    if (key === eqShopSort) {
      eqShopSortDir = eqShopSortDir === "asc" ? "desc" : "asc";
    } else {
      eqShopSort = key;
      eqShopSortDir = "asc";
    }
    refreshEquipmentShop();
    return;
  }
  const resetBtn = e.target.closest("[data-eq-reset]");
  if (resetBtn) {
    eqShopStage = "all";
    eqShopBrand = "all";
    eqShopSort = "price";
    eqShopSortDir = "asc";
    eqShopQuery = "";
    refreshEquipmentShop();
    return;
  }
  const buyBtn = e.target.closest(".mat-buy-btn");
  if (buyBtn) {
    openBuyModal(buyBtn.dataset.materialId);
    return;
  }
  const equipmentCard = e.target.closest("[data-shop-equipment-model]");
  if (equipmentCard && !e.target.closest("button, a, input, [data-action]")) {
    equipmentCard.querySelector(".resource-card-visual")?.focus();
    openShopEquipmentDetail(equipmentCard.dataset.shopEquipmentModel);
  }
}

function setShopTab(tab) {
  activeShopTab = ["building", "equipment", "material"].includes(tab) ? tab : "building";
  applyShopTab();
  if (activeShopTab === "equipment") refreshEquipmentShop();
}
function applyShopTab() {
  const shopView = document.querySelector('section.view[data-view="shop"]');
  if (!shopView) return;
  shopView.querySelectorAll(".shop-tab").forEach((b) => {
    const on = b.dataset.tab === activeShopTab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
    b.setAttribute("tabindex", on ? "0" : "-1");
  });
  shopView.querySelectorAll(".tab-panel").forEach((p) => {
    const on = p.dataset.tabPanel === activeShopTab;
    p.classList.toggle("is-hidden", !on);
    p.hidden = !on;
  });
}

// ---- 镶嵌材料：购买弹窗 ----
function getMaterialById(id) {
  const cat = getState().materialCatalog || [];
  return cat.find((m) => m.id === id) || null;
}
function closeShopModal() {
  const cleanup = shopModalLifecycleCleanup;
  shopModalLifecycleCleanup = null;
  cleanup?.();
  const el = document.getElementById("shopModal");
  if (el) { el.classList.add("is-hidden"); el.innerHTML = ""; }
}
function ensureModalShell() {
  let el = document.getElementById("shopModal");
  if (!el) {
    el = document.createElement("div");
    el.id = "shopModal";
    el.className = "modal-overlay is-hidden";
  }
  // Must live on body: finish-plan locks .shell as inert, and body-level
  // overlays (z-index 200+) would otherwise cover a nested shopModal.
  if (typeof document !== "undefined" && el.parentElement !== document.body) {
    document.body.appendChild(el);
  }
  return el;
}
function bindShopModalLifecycle(el) {
  shopModalLifecycleCleanup?.();
  shopModalLifecycleCleanup = activateModalLifecycle({
    root: el,
    dialog: el.querySelector('[role="dialog"]'),
    shell: document.querySelector(".shell"),
    onClose: closeShopModal,
    closeOnBackdrop: true
  });
}
/** Open material purchase dialog by catalog id or inventory key (e.g. silver925). */
export function openMaterialBuyModal(materialIdOrKey) {
  const key = String(materialIdOrKey || "").trim();
  if (!key || !getState) return false;
  const cat = getState().materialCatalog || [];
  const match = cat.find((item) => item.id === key || item.key === key);
  if (!match) return false;
  openBuyModal(match.id);
  return true;
}

function openBuyModal(id) {
  const m = getMaterialById(id);
  if (!m) return;
  const el = ensureModalShell();
  const held = Math.round(Number((getState().me.externalMaterials || {})[m.key] || 0));
  const cash = Number(getState().me.cash || 0);
  const quick = m.unit === "g" ? [1, 5, 10, 50, 100] : [1, 5, 10, 20, 50];
  el.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <button class="modal-close" type="button" aria-label="关闭">×</button>
      <div class="modal-head">
        <div class="mat-thumb lg">${shopMaterialArtHtml(m, { sizeClass: "is-compact" })}</div>
        <div>
          <h3>${escapeHtml(m.name)}</h3>
          <p class="modal-sub">商铺供货 · 现实金价</p>
        </div>
      </div>
      <div class="modal-body">
        <p class="modal-desc">${escapeHtml(m.description)}</p>
        <div class="modal-stats">
          <div><span>当前单价</span><b>${formatMoney(m.price)} / ${m.unitLabel}</b></div>
          <div><span>我的持有</span><b>${formatNumber(held)}${m.unitLabel}</b></div>
        </div>
        <div class="qty-block">
          <label>购买数量（${m.unitLabel}，≥1）</label>
          <div class="qty-input-row">
            <input type="number" class="modal-qty" min="1" step="1" value="1" />
            <span class="modal-unit">${m.unitLabel}</span>
          </div>
          <div class="quick-row">
            ${quick.map((q) => `<button class="quick-qty" data-q="${q}">${q}</button>`).join("")}
          </div>
        </div>
        <div class="modal-total">合计：<b class="total-val">${formatMoney(m.price)}</b><span class="material-discount"></span></div>
        <div class="modal-warn is-hidden">现金不足，无法购买。</div>
      </div>
      <div class="modal-foot">
        <button class="modal-cancel">取消</button>
        <button class="modal-confirm">确认购买</button>
      </div>
    </div>
  `;
  el.classList.remove("is-hidden");
  const qtyInput = el.querySelector(".modal-qty");
  const totalVal = el.querySelector(".total-val");
  const discountVal = el.querySelector(".material-discount");
  const warn = el.querySelector(".modal-warn");
  const confirmBtn = el.querySelector(".modal-confirm");
  const recompute = () => {
    const q = Math.floor(Number(qtyInput.value)) || 0;
    const quote = materialPurchaseQuote(m, q);
    const total = quote.price;
    totalVal.textContent = formatMoney(total);
    discountVal.textContent = quote.discount > 0
      ? ` · 批采优惠 ${Math.round(quote.discount * 100)}%`
      : "";
    const insufficient = q >= 1 && total > cash;
    warn.classList.toggle("is-hidden", !insufficient);
    confirmBtn.disabled = q < 1 || total > cash;
    confirmBtn.textContent = q >= 1 ? `确认购买 · ${formatMoney(total)}` : "请输入数量";
  };
  qtyInput.addEventListener("input", recompute);
  el.querySelectorAll(".quick-qty").forEach((b) => {
    b.addEventListener("click", () => { qtyInput.value = b.dataset.q; recompute(); });
  });
  confirmBtn.addEventListener("click", () => {
    const q = Math.floor(Number(qtyInput.value)) || 0;
    if (q < 1) return;
    if (socketRef) socketRef.emit("buyMaterialPack", {
      materialId: id,
      amount: q,
      requestId: globalThis.crypto?.randomUUID?.() || `material-${Date.now()}`
    });
    closeShopModal();
  });
  el.querySelector(".modal-close").addEventListener("click", closeShopModal);
  el.querySelector(".modal-cancel").addEventListener("click", closeShopModal);
  bindShopModalLifecycle(el);
  recompute();
}
