import { isMarketEquipment, equipmentIdentityCard, equipmentChips, equipmentProfile, equipmentCostRows } from "./equipment-view.js";
import { MARKET_LISTING_PER_PLAYER_CAP, MARKET_TAX, MARKET_TAX_PERCENT } from "../../market-rules.js";
import { equipmentSaleBlockReason } from "../../equipment-trading.js";
import { inlaySummary } from "../../product-meta.js";
import { paintJadeCanvases } from "../../jade-renderer.js";
import { deriveMaterialProfile, marketRefValue, marketElapsed, mlSteps } from "./catalog.js";

export function createMarketListingController({ socketRef, getState, elsRef, getDocument, ui, helpers, ports }) {
  const { marketUi, mlUi } = ui;
  const { formatMoney, escapeHtml, showToast } = helpers;
  const { marketItemVisual, marketCardAttrChips, marketProfileChips, marketPriceDelta, marketSellerLine, marketSellables, marketAffordable, renderMlGrid, renderMlDetailEmpty, updateMlFee, renderMlDetail, setMlConfirm, openMarketModal, closeMarketModals } = ports;

function changeMlPrice(delta) {
  mlUi.price = Math.max(100, (Number(mlUi.price) || 100) + delta);
  mlUi.priceTouched = true;
  const input = elsRef.marketListModal?.querySelector("#mlPrice");
  if (input) input.value = mlUi.price;
  updateMlFee();
}

function selectMlItem(id) {
  const item = marketSellables().find((i) => i.id === id);
  if (!item) return;
  mlUi.selectedId = id;
  mlUi.price = isMarketEquipment(item) ? marketRefValue(item) : Math.max(100, Math.round(marketRefValue(item) * 1.18));
  mlUi.priceTouched = false;
  const steps = mlSteps(mlUi.price);
  mlUi.stepSmall = steps.small;
  mlUi.stepLarge = steps.large;
  // 只切换选中态，不重建整个网格，避免左侧卡片预览闪烁
  const grid = elsRef.marketListModal?.querySelector("#mlGrid");
  if (grid) {
    grid.querySelectorAll(".ml-slot").forEach((el) => {
      const selected = el.getAttribute("data-ml-id") === id;
      el.classList.toggle("selected", selected);
      el.setAttribute("aria-selected", selected ? "true" : "false");
      el.setAttribute("tabindex", selected ? "0" : "-1");
    });
  } else {
    renderMlGrid();
  }
  renderMlDetail(item);
  setMlConfirm(true);
}

function openMarketListModal(preselectedItemId = "") {
  const modal = elsRef.marketListModal || getDocument().getElementById("marketListModal");
  if (!modal) { showToast("交易行弹窗未就绪，请刷新页面后重试。"); return; }
  const state = getState();
  const mine = (state?.listings || []).filter((listing) => listing.ownerId === state?.me?.id).length;
  if (mine >= MARKET_LISTING_PER_PLAYER_CAP) {
    showToast(`交易行栏位已满，每位掌柜最多挂出 ${MARKET_LISTING_PER_PLAYER_CAP} 件。`);
    return;
  }
  const sellables = marketSellables();
  mlUi.search = "";
  mlUi.cat = "all";
  mlUi.sort = "valueDesc";
  mlUi.selectedId = null;
  mlUi.priceTouched = false;
  const search = modal.querySelector("#mlSearch");
  const cat = modal.querySelector("#mlCategory");
  const sort = modal.querySelector("#mlSort");
  if (search) search.value = "";
  if (cat) cat.value = "all";
  if (sort) sort.value = "valueDesc";
  if (!sellables.length) {
    showToast("暂无可挂牌物品，先去公盘拍原石或加工成品。");
    renderMlGrid();
    renderMlDetailEmpty();
    setMlConfirm(false);
    openMarketModal(modal, { initialFocus: "#mlSearch" });
    return;
  }
  renderMlGrid();
  const preselected = preselectedItemId
    ? sellables.find((item) => String(item.id) === String(preselectedItemId))
    : null;
  if (preselected) {
    selectMlItem(preselected.id);
  } else {
    renderMlDetailEmpty();
    setMlConfirm(false);
    if (preselectedItemId) {
      const device = state.me.workshop?.devices?.find((row) => row.id === preselectedItemId);
      showToast(device ? equipmentSaleBlockReason(state.me, device, state) : "这件物品当前不可挂牌。");
    }
  }
  openMarketModal(modal, { initialFocus: preselected ? "#mlPrice" : "#mlSearch" });
}

function confirmMarketList() {
  const item = marketSellables().find((i) => i.id === mlUi.selectedId);
  const type = item?._type;
  if (!item || !type) { showToast("请先选择一个物品。"); return; }
  const price = Math.max(100, Number(mlUi.price) || 0);
  socketRef.emit("listItem", { type, itemId: item.id, price });
  closeMarketModals();
}

function openMarketBuy(id) {
  const modal = elsRef.marketBuyModal || getDocument().getElementById("marketBuyModal");
  const body = elsRef.marketBuyBody || getDocument().getElementById("marketBuyBody");
  if (!modal || !body) { showToast("买入弹窗未就绪，请刷新页面后重试。"); return; }
  elsRef.marketBuyModal = modal;
  elsRef.marketBuyBody = body;
  const l = getState().listings.find((x) => x.id === id);
  if (!l) return;
  const equipment = l.type === "equipment";
  marketUi.buyId = id;
  const summary = inlaySummary(l.item);
  const profile = deriveMaterialProfile(l.item);
  const ref = marketRefValue(l.item);
  const delta = marketPriceDelta(l.price, ref);
  const tax = Math.round(l.price * MARKET_TAX);
  const total = Math.round(l.price + tax);
  const can = marketAffordable(l.price);
  const confirmBtn = modal.querySelector("[data-action='confirmMarketBuy']");
  if (confirmBtn) {
    confirmBtn.disabled = !can;
    confirmBtn.textContent = can ? `支付 ${formatMoney(total)}` : `现金不足 · 需 ${formatMoney(total)}`;
  }
  body.innerHTML = `
    <div class="jm-buy-detail">
      ${equipment ? `${equipmentIdentityCard(l.item, {
        badge: "二手设备", className: "resource-card--compact", body: equipmentChips(l.item, escapeHtml)
      })}<div class="jm-buy-seller">卖家 ${marketSellerLine(l.ownerId, l.ownerName)} · ${marketElapsed(l.createdAt)}</div>` : `<div class="jm-buy-hero">
        <div class="jm-buy-visual">${marketItemVisual(l.item, { eager: true })}</div>
        <div class="jm-buy-copy">
          <div class="jm-nm">${escapeHtml(l.item.name)}</div>
          ${equipment ? equipmentChips(l.item, escapeHtml) : marketCardAttrChips(l.item, l.type, profile)}
          ${summary ? `<p class="inlay-summary">${escapeHtml(summary)}</p>` : ""}
          <div class="jm-buy-seller">卖家 ${marketSellerLine(l.ownerId, l.ownerName)} · ${marketElapsed(l.createdAt)}</div>
        </div>
      </div>`}
      <div class="jm-buy-profile">
        ${equipment ? equipmentProfile(l.item, escapeHtml, formatMoney) : profile.sealed
          ? `<div class="jm-sealed-note">暗料 · 种水与颜色未揭露</div>`
          : marketProfileChips(profile)}
      </div>
      <div class="jm-fee">
        <div><span>挂牌价</span><span>${formatMoney(l.price)}</span></div>
        ${profile.hasReference ? `<div><span>参考估值</span><span>${formatMoney(ref)} <span class="jm-delta ${delta.cls}">${escapeHtml(delta.txt)}</span></span></div>` : ""}
        <div><span>市场税（${MARKET_TAX_PERCENT}%，买家付）</span><span>${formatMoney(tax)}</span></div>
        ${equipment ? equipmentCostRows(l.item, total, formatMoney) : ""}
        <div class="total"><span>你需支付</span><span>${formatMoney(total)}</span></div>
      </div>
      ${equipment ? '<p class="jm-equipment-note">设备将加入工坊，保留当前耐久。请自行安排员工；维修费用另行支付。卖家货款直接入账，自动补薪、还款按现有规则结算。</p>' : ""}
    </div>`;
  paintJadeCanvases(body);
  openMarketModal(modal);
}

function confirmMarketBuy() {
  if (!marketUi.buyId) return;
  socketRef.emit("buyListing", marketUi.buyId);
  closeMarketModals();
  marketUi.buyId = null;
}

  return { changeMlPrice, selectMlItem, openMarketListModal, confirmMarketList, openMarketBuy, confirmMarketBuy };
}
