import { MARKET_LISTING_MIN_PRICE } from "../../market-rules.js";
import { itemCost } from "../../../shared/domain/economy/item-cost.js";
import { openGameModal, closeGameModal } from "../../shell/game-modal.js";

export function createMarketBindings({ socketRef, getState, elsRef, getDocument, scope, ui, helpers, ports }) {
  const { marketUi, marketPriceDraft, wantPostUi, mlUi } = ui;
  const { formatMoney, showToast } = helpers;
  const { marketActiveFilterCount, renderMarket, renderMarketStalls, renderMarketFilters, renderMarketGrid, renderMarketWants, renderMlGrid, updateMlFee, changeMlPrice, selectMlItem, openMarketListModal, confirmMarketList, openMarketBuy, confirmMarketBuy, selectMarketWantApplyItem, syncWantPostFields, openMarketWantPost, confirmMarketWantPost, openMarketApplyWant, confirmMarketApplyWant, closeMarketModals } = ports;

function bindMarketOnce() {
  if (!scope.active) return;
  if (ui.marketFiltersBound) return;
  ui.marketFiltersBound = true;
  const regrid = () => {
    if (marketUi.section === "want") renderMarketWants();
    else if (marketUi.section === "listings") renderMarketGrid(getState().listings || []);
  };
  const applyMarketPriceFilters = () => {
    const minText = String(elsRef.marketPriceMin?.value ?? "").trim();
    const maxText = String(elsRef.marketPriceMax?.value ?? "").trim();
    const min = minText === "" ? null : Math.max(0, Math.floor(Number(minText)));
    const max = maxText === "" ? null : Math.max(0, Math.floor(Number(maxText)));
    if ((minText && !Number.isFinite(min)) || (maxText && !Number.isFinite(max))) {
      showToast("请输入有效的价格区间");
      return;
    }
    if (min != null && max != null && min > max) {
      showToast("最低价不能高于最高价");
      elsRef.marketPriceMax?.focus();
      return;
    }
    marketUi.min = min;
    marketUi.max = max;
    marketPriceDraft.min = min == null ? "" : String(min);
    marketPriceDraft.max = max == null ? "" : String(max);
    syncMarketFilterInputs();
    regrid();
  };
  scope.listen(elsRef.marketSearch, "input", (e) => { marketUi.search = e.target.value.trim(); regrid(); });
  scope.listen(elsRef.marketQFilters, "change", (event) => {
    const key = event.target.dataset.equipmentFilter;
    if (!["equipmentStage", "equipmentBrand", "equipmentTech", "equipmentCondition"].includes(key)) return;
    marketUi[key] = event.target.value;
    regrid();
  });
  scope.listen(elsRef.marketSort, "change", (e) => { marketUi.sort = e.target.value; regrid(); });
  scope.listen(elsRef.marketPriceMin, "input", (e) => { marketPriceDraft.min = e.target.value; });
  scope.listen(elsRef.marketPriceMax, "input", (e) => { marketPriceDraft.max = e.target.value; });
  scope.listen(elsRef.marketPriceApply, "click", applyMarketPriceFilters);
  [elsRef.marketPriceMin, elsRef.marketPriceMax].filter(Boolean).forEach((input) => {
    scope.listen(input, "keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      applyMarketPriceFilters();
    });
  });
  scope.listen(elsRef.marketAfford, "click", () => { marketUi.afford = !marketUi.afford; renderMarketFilters(); regrid(); });
  scope.listen(elsRef.marketReset, "click", resetMarketFilters);
  // 挂牌弹窗：筛选 / 排序 / 选择物品 / 价格步进（事件委托，避免重复绑定）
  const modal = elsRef.marketListModal;
  if (modal) {
    scope.listen(modal.querySelector("#mlSearch"), "input", (e) => { mlUi.search = e.target.value.trim(); renderMlGrid(); });
    scope.listen(modal.querySelector("#mlCategory"), "change", (e) => { mlUi.cat = e.target.value; renderMlGrid(); });
    scope.listen(modal.querySelector("#mlSort"), "change", (e) => { mlUi.sort = e.target.value; renderMlGrid(); });
    scope.listen(modal.querySelector("#mlGrid"), "click", (e) => {
      const card = e.target.closest("[data-ml-id]");
      if (card) selectMlItem(card.dataset.mlId);
    });
    scope.listen(modal.querySelector("#mlGrid"), "keydown", (event) => {
      const card = event.target.closest?.("[data-ml-id]");
      if (!card) return;
      const cards = [...event.currentTarget.querySelectorAll("[data-ml-id]")];
      const index = cards.indexOf(card);
      let next = index;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectMlItem(card.dataset.mlId);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = Math.max(0, index - 1);
      else if (event.key === "ArrowRight" || event.key === "ArrowDown") next = Math.min(cards.length - 1, index + 1);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = cards.length - 1;
      else return;
      event.preventDefault();
      cards[next]?.focus();
      if (cards[next]) selectMlItem(cards[next].dataset.mlId);
    });
    scope.listen(modal.querySelector("#mlDetail"), "click", (e) => {
      const stepBtn = e.target.closest("[data-ml-step]");
      if (stepBtn) changeMlPrice(Number(stepBtn.dataset.mlDir) * (stepBtn.dataset.mlStep === "small" ? mlUi.stepSmall : mlUi.stepLarge));
    });
    scope.listen(modal.querySelector("#mlDetail"), "input", (e) => {
      if (e.target && e.target.id === "mlPrice") { mlUi.priceTouched = true; mlUi.price = Math.max(MARKET_LISTING_MIN_PRICE, Number(e.target.value) || 0); updateMlFee(); }
    });
  }
  const postModal = elsRef.marketWantPostModal || getDocument().getElementById("marketWantPostModal");
  if (postModal) {
    scope.listen(postModal, "click", (e) => {
      if (e.target === postModal) closeMarketModals();
    });
    scope.listen(postModal.querySelector("#mwType"), "change", (e) => {
      wantPostUi.itemType = e.target.value;
      syncWantPostFields();
    });
    scope.listen(postModal.querySelector("#mwBudget"), "input", () => syncWantPostFields());
    scope.listen(postModal.querySelector("#mwDurations"), "click", (e) => {
      const btn = e.target.closest("[data-mw-duration]");
      if (!btn) return;
      wantPostUi.durationKey = btn.dataset.mwDuration;
      postModal.querySelectorAll("[data-mw-duration]").forEach((el) => {
        el.classList.toggle("on", el.dataset.mwDuration === wantPostUi.durationKey);
      });
      if (wantPostUi.durationKey === "long" && wantPostUi.rule === "lowest") {
        wantPostUi.rule = "manual";
        postModal.querySelectorAll("[data-mw-rule]").forEach((el) => {
          el.classList.toggle("on", el.dataset.mwRule === wantPostUi.rule);
        });
      }
    });
    scope.listen(postModal.querySelector("#mwRules"), "click", (e) => {
      const btn = e.target.closest("[data-mw-rule]");
      if (!btn) return;
      wantPostUi.rule = btn.dataset.mwRule;
      postModal.querySelectorAll("[data-mw-rule]").forEach((el) => {
        el.classList.toggle("on", el.dataset.mwRule === wantPostUi.rule);
      });
    });
  }
  const applyModal = elsRef.marketWantApplyModal || getDocument().getElementById("marketWantApplyModal");
  if (applyModal) {
    scope.listen(applyModal.querySelector("#mwaGrid"), "click", (e) => {
      const card = e.target.closest("[data-mwa-id]");
      if (!card) return;
      selectMarketWantApplyItem(applyModal, card);
    });
    scope.listen(applyModal.querySelector("#mwaGrid"), "keydown", (event) => {
      const card = event.target.closest?.("[data-mwa-id]");
      if (!card) return;
      const cards = [...event.currentTarget.querySelectorAll("[data-mwa-id]")];
      const index = cards.indexOf(card);
      let next = index;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectMarketWantApplyItem(applyModal, card);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = Math.max(0, index - 1);
      else if (event.key === "ArrowRight" || event.key === "ArrowDown") next = Math.min(cards.length - 1, index + 1);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = cards.length - 1;
      else return;
      event.preventDefault();
      cards[next]?.focus();
      if (cards[next]) selectMarketWantApplyItem(applyModal, cards[next]);
    });
  }
}

function resetMarketFilters() {
  const hadFilters = marketActiveFilterCount() > 0;
  marketUi.q.clear();
  marketUi.equipmentStage = marketUi.equipmentBrand = marketUi.equipmentTech = marketUi.equipmentCondition = "";
  marketUi.cat = "all";
  marketUi.min = null;
  marketUi.max = null;
  marketPriceDraft.min = "";
  marketPriceDraft.max = "";
  marketUi.afford = false;
  marketUi.search = "";
  renderMarketStalls();
  renderMarketFilters();
  syncMarketFilterInputs();
  if (marketUi.section === "want") renderMarketWants();
  else if (marketUi.section === "listings") renderMarketGrid(getState().listings || []);
  if (hadFilters) showToast("已清除交易行筛选");
}

function syncMarketFilterInputs() {
  if (elsRef.marketSearch && getDocument().activeElement !== elsRef.marketSearch) elsRef.marketSearch.value = marketUi.search;
  if (elsRef.marketSort) elsRef.marketSort.value = marketUi.sort;
  if (elsRef.marketPriceMin && getDocument().activeElement !== elsRef.marketPriceMin) elsRef.marketPriceMin.value = marketPriceDraft.min;
  if (elsRef.marketPriceMax && getDocument().activeElement !== elsRef.marketPriceMax) elsRef.marketPriceMax.value = marketPriceDraft.max;
}

function marketSetStall(target) {
  marketUi.section = "listings";
  marketUi.cat = (target && target.dataset && target.dataset.marketCat) || "all";
  marketUi.q.clear();
  marketUi.equipmentStage = marketUi.equipmentBrand = marketUi.equipmentTech = marketUi.equipmentCondition = "";
  renderMarket();
}

function marketSetSection(target) {
  marketUi.section = (target && target.dataset && target.dataset.marketSection) || "listings";
  renderMarket();
}

function marketToggleQ(target) {
  const k = target && target.dataset && target.dataset.marketQ;
  if (!k) return;
  marketUi.q.has(k) ? marketUi.q.delete(k) : marketUi.q.add(k);
  renderMarketFilters();
  if (marketUi.section === "want") renderMarketWants();
  else if (marketUi.section === "listings") renderMarketGrid(getState().listings || []);
}

function registerMarketActions() {
  const register = scope.register;
  if (typeof register === "function") {
    register("marketStall", ({ target }) => marketSetStall(target));
    register("marketSection", ({ target }) => marketSetSection(target));
    register("marketQ", ({ target }) => marketToggleQ(target));
    register("resetMarketFilters", () => resetMarketFilters());
    register("openMarketListModal", ({ payload }) => openMarketListModal(payload || ""));
    register("confirmMarketList", () => confirmMarketList());
    register("openMarketBuy", ({ payload }) => openMarketBuy(payload));
    register("confirmMarketBuy", () => confirmMarketBuy());
    register("closeMarketModal", () => closeMarketModals());
    register("withdrawListing", ({ payload }) => socketRef.emit("withdrawListing", payload));
    register("openMarketOffer", ({ payload }) => {
      const listing = (getState().listings || []).find((entry) => entry.id === payload);
      if (!listing?.npcOffer) return;
      marketUi.offerId = listing.npcOffer.id;
      const cost = itemCost(listing.item);
      const difference = Number(listing.npcOffer.amount) - cost.amount;
      openGameModal({
        title: "批发商收购报价", subtitle: listing.item.name,
        body: [
          `收购价 ${formatMoney(listing.npcOffer.amount)}。成交后货款直接入账，挂单下架。`,
          "系统批发按不高于估值 65% 收购，属于急售折价，不保证回本。",
          ...(cost.complete ? [`已记货品成本 ${formatMoney(cost.amount)}；本次回款与该成本差额 ${difference > 0 ? "+" : difference < 0 ? "−" : ""}${formatMoney(Math.abs(difference))}（未含未记账的经营费用）。`] : [])
        ],
        confirmText: "接受报价", cancelText: "返回",
        actions: [{ label: "接受报价", clientAction: "acceptMarketOffer", payload: listing.id }, { label: "返回", variant: "secondary" }]
      });
    });
    register("acceptMarketOffer", ({ payload, target }) => {
      const listing = (getState().listings || []).find((entry) => entry.id === payload);
      if (!listing?.npcOffer) return;
      socketRef.emit("acceptMarketOffer", { listingId: payload, offerId: marketUi.offerId });
      closeGameModal();
    });
    register("collectPayouts", () => socketRef.emit("collectPayout"));
    register("openMarketWantPost", () => openMarketWantPost());
    register("confirmMarketWantPost", () => confirmMarketWantPost());
    register("marketApplyWant", ({ payload }) => openMarketApplyWant(payload));
    register("confirmMarketApplyWant", () => confirmMarketApplyWant());
    register("cancelWant", ({ payload }) => socketRef.emit("cancelWant", payload));
    register("settleWant", ({ payload, target }) => {
      socketRef.emit("settleWant", { wantId: payload, offerId: target.dataset.offerId || null });
    });
    register("withdrawWantOffer", ({ payload, target }) => {
      socketRef.emit("withdrawWantOffer", { wantId: target.dataset.wantId, offerId: payload });
    });
  }

}


  return { bindMarketOnce, resetMarketFilters, syncMarketFilterInputs, marketSetStall, marketSetSection, marketToggleQ, registerMarketActions };
}
