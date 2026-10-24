// 黑市 actions：initBlackmarketModule + registerAction

import {
  socketRef,
  getState,
  bmUi,
  bindBlackmarketDeps,
  bmMyStall,
  bmStallById,
  guardBmFeature,
  showToast,
  closeGameModal,
  formatMoney
} from "./shared.js";
import { setView } from "../../shell/navigation.js";
import { openGameModal } from "./shared.js";
import {
  openBmSetupModal,
  guardBmPlazaLeave,
  renderBlackmarket,
  openBmOpenModal,
  syncBmOpenTypeHint,
  confirmBmOpenStall,
  openBmBuy,
  openBmItemDetail,
  confirmBmBuy,
  openBmRatingModal,
  openBmRatingForm,
  closeBmModals
} from "./plaza.js";
import {
  openBmListModal,
  toggleBmListItem,
  confirmBmList,
  finishGoodsList,
  requestBmWithdraw,
  confirmBmWithdraw
} from "./goods.js";
import {
  isBmBlindStockModalOpen,
  applyBmBlindSuggestedPrice,
  confirmBmBlindStockPrice,
  confirmBmBlindManageMeta,
  openBmBlindStockModal,
  toggleBmBlindItem,
  confirmBmBlindStock,
  finishBlindStock,
  setBmBlindManageTab,
  openBmBlindManageModal,
  closeBmBlindManageModal,
  selectBmBlindManageItem,
  openBmBlindStockFromManage,
  openBmBlindMetaModal,
  confirmBmBlindMeta,
  promptBmToggleAnonymous,
  confirmBmToggleAnonymous,
  bmBlindManageBuyerPreview,
  requestBmBlindManageWithdraw,
  finishBmBlindManageWithdraw,
  openBmBlindDrawModal,
  skipBmBlindDrawAnim,
  toggleBmBlindDrawPick,
  renderBmBlindDrawModal,
  settleBmBlindDraw,
  requestBmBlindDrawClose,
  confirmBmBlindDrawClose,
  finishBmBlindDrawUi
} from "./blind-ui.js";
import {
  openBmServiceOfferModal,
  openBmServiceInfoModal,
  confirmBmServiceOffer,
  setBmProfileTab,
  confirmBmServiceProfile,
  bindBmServiceProfileModal,
  openBmOrderServiceModal,
  setBmOrderFilter,
  bindBmOrderServiceModal,
  confirmBmOrderService,
  promptBmEarlySubmit
} from "./service-ui.js";

let blackmarketTabKeyboardBound = false;

function bindBlackmarketTabKeyboard() {
  if (blackmarketTabKeyboardBound) return;
  blackmarketTabKeyboardBound = true;
  document.addEventListener("keydown", (event) => {
    const current = event.target.closest?.(
      "#bmBlindManageModal .bm-blind-manage-tab[role='tab'], #bmProfileTabs [role='tab']"
    );
    if (!current) return;
    const tabs = [...current.closest('[role="tablist"]')?.querySelectorAll('[role="tab"]') || []];
    if (!tabs.length) return;
    const index = tabs.indexOf(current);
    let next = index;
    if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[next].click();
    tabs[next].focus();
  });
}

export function initBlackmarketModule(deps) {
  bindBlackmarketDeps(deps);
  bindBlackmarketTabKeyboard();
  const register = deps.registerAction;
  if (typeof register !== "function") return;

  socketRef.off("bmWithdrawResult");
  socketRef.on("bmWithdrawResult", (res = {}) => {
    if (res.stallClosed) bmUi.section = "plaza";
    renderBlackmarket();
  });

  socketRef.off("bmWithdrawBlindResult");
  socketRef.on("bmWithdrawBlindResult", (res = {}) => {
    finishBmBlindManageWithdraw(res);
  });

  socketRef.off("bmStallResult");
  socketRef.on("bmStallResult", (res = {}) => {
    if (!res.ok || res.action !== "open") return;
    bmUi.section = "mine";
    bmUi.pendingSetupType = res.stallType || bmUi.openType;
    renderBlackmarket();
  });

  socketRef.off("bmListResult");
  socketRef.on("bmListResult", (res = {}) => {
    if (bmUi.goodsSubmitting) {
      finishGoodsList(res);
      return;
    }
    if (bmUi.blindSubmitting || isBmBlindStockModalOpen()) {
      finishBlindStock(res);
      return;
    }
    if (!res.ok) return;
    bmUi.section = "mine";
    renderBlackmarket();
  });

  socketRef.off("bmServiceOfferResult");
  socketRef.on("bmServiceOfferResult", (res = {}) => {
    if (!res.ok) return;
    const modal = document.getElementById("bmServiceOfferModal");
    if (modal) modal.hidden = true;
    bmUi.section = "mine";
    renderBlackmarket();
    if (!res.activated) openBmServiceOfferModal();
  });

  register("bmTypeFilter", ({ target }) => {
    if (!guardBmPlazaLeave()) return;
    bmUi.typeFilter = target?.dataset?.bmType || "all";
    bmUi.section = "plaza";
    bmUi.detailStallId = null;
    renderBlackmarket();
    const stage = document.getElementById("mainStage");
    if (stage) stage.scrollTop = 0;
  });
  register("bmResetFilters", () => {
    if (!guardBmPlazaLeave()) return;
    bmUi.search = "";
    bmUi.sort = "latest";
    bmUi.typeFilter = "all";
    bmUi.section = "plaza";
    bmUi.detailStallId = null;
    const search = document.getElementById("bmSearch");
    const sort = document.getElementById("bmSort");
    if (search) search.value = "";
    if (sort) sort.value = "latest";
    renderBlackmarket();
    showToast("已清除黑市筛选");
  });
  register("bmSection", ({ target }) => {
    if (target?.dataset?.bmSection === "plaza" && !guardBmPlazaLeave()) return;
    bmUi.section = target?.dataset?.bmSection || "plaza";
    bmUi.detailStallId = null;
    renderBlackmarket();
  });
  register("bmBackPlaza", () => {
    if (!guardBmPlazaLeave()) return;
    bmUi.section = "plaza";
    bmUi.detailStallId = null;
    renderBlackmarket();
    const stage = document.getElementById("mainStage");
    if (stage) stage.scrollTop = 0;
  });
  register("openBmStallDetail", ({ payload }) => {
    const stall = bmStallById(payload);
    if (stall?.isMine && stall.type === "blindbox") {
      openBmBlindManageModal();
      return;
    }
    bmUi.section = "detail";
    bmUi.detailStallId = payload;
    renderBlackmarket();
    const stage = document.getElementById("mainStage");
    if (stage) stage.scrollTop = 0;
  });
  register("openBmBlindManageModal", () => openBmBlindManageModal());
  register("closeBmBlindManage", () => closeBmBlindManageModal());
  register("bmBlindManageTab", ({ target }) => {
    const tab = target?.dataset?.bmBlindTab || "pool";
    if (tab === "stock") openBmBlindStockFromManage();
    else setBmBlindManageTab("pool");
  });
  register("bmSelectBlindManageItem", ({ payload }) => selectBmBlindManageItem(payload));
  register("bmWithdrawBlindManageItem", ({ payload }) => requestBmBlindManageWithdraw(payload));
  register("openBmBlindStockFromManage", () => openBmBlindStockFromManage());
  register("bmBlindManageBuyerPreview", () => bmBlindManageBuyerPreview());
  register("confirmBmBlindManageMeta", () => confirmBmBlindManageMeta());
  register("openBmOpenModal", () => openBmOpenModal());
  register("bmPickOpenType", ({ target }) => {
    bmUi.openType = target?.dataset?.bmOpenType || "goods";
    document.querySelectorAll("#bmOpenModal [data-bm-open-type]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.bmOpenType === bmUi.openType);
    });
    syncBmOpenTypeHint();
  });
  register("confirmBmOpenStall", () => confirmBmOpenStall());
  register("openBmSetupFlow", () => openBmSetupModal());
  register("bmCloseStall", () => {
    showToast({ text: "收摊后货品退回库存，类型将清空。", tone: "warn" });
    socketRef.emit("bmCloseStall");
  });
  register("bmTogglePause", () => {
    if (!guardBmFeature("bmStall")) return;
    const mine = bmMyStall();
    socketRef.emit("bmPauseStall", mine?.status !== "paused");
  });
  register("bmToggleAnonymous", () => {
    if (!guardBmFeature("bmStall")) return;
    promptBmToggleAnonymous();
  });
  register("bmConfirmToggleAnonymous", () => confirmBmToggleAnonymous());
  register("applyBmBlindSuggestedPrice", () => applyBmBlindSuggestedPrice());
  register("openBmListModal", () => {
    if (!guardBmFeature("bmStall")) return;
    openBmListModal();
  });
  register("bmToggleListItem", ({ payload }) => toggleBmListItem(payload));
  register("sellBmResource", ({ payload }) => {
    document.querySelector('[data-action="closeOwnedWorkerDetail"]')?.click();
    closeGameModal?.();
    bmUi.resourceSaleFocusId = payload;
    bmUi.section = "mine";
    setView("blackmarket");
    const mine = bmMyStall();
    if (!mine) { bmUi.openType = "goods"; openBmOpenModal(); }
    else if (mine.type !== "goods") showToast("请先完成现有摊位经营，再开设卖物品摊位。");
    else openBmListModal();
  });
  register("bmReprice", ({ payload }) => {
    const row = bmMyStall()?.items?.find((item) => item.id === payload);
    if (!row) return;
    openGameModal({ id: "bm-reprice", title: "修改挂牌价", subtitle: row.item.name,
      html: `<label for="bmRepriceInput">新价格（最低 ¥100）</label><input id="bmRepriceInput" type="number" inputmode="numeric" min="100" step="1" value="${Number(row.price)}">`,
      actions: [{ label: "保存价格", clientAction: "bmConfirmReprice", payload: row.id }, { label: "取消", variant: "secondary" }] });
  });
  register("bmConfirmReprice", ({ payload }) => {
    const price = Number(document.getElementById("bmRepriceInput")?.value);
    if (!Number.isSafeInteger(price) || price < 100) return showToast("请输入不低于 ¥100 的整数价格。");
    socketRef.emit("bmUpdateStallMeta", { listingId: payload, price });
    closeGameModal();
  });
  register("confirmBmList", () => {
    if (!guardBmFeature("bmStall")) return;
    confirmBmList();
  });
  register("openBmBuyGoods", ({ payload, target }) => openBmBuy(payload, target?.dataset?.stall));
  register("openBmItemDetail", ({ payload, target }) => openBmItemDetail(payload, target?.dataset?.stall));
  register("openBmBuyFromDetail", ({ payload }) => {
    const [stallId, listingId] = String(payload || "").split("|");
    closeGameModal();
    openBmBuy(listingId, stallId);
  });
  register("confirmBmBuy", () => confirmBmBuy());
  register("closeBmModal", () => closeBmModals());
  register("bmWithdraw", ({ payload }) => requestBmWithdraw(payload));
  register("confirmBmWithdraw", () => confirmBmWithdraw());
  register("bmCollectPayouts", () => socketRef.emit("bmCollectPayout"));
  register("openBmBlindStockModal", () => {
    if (!guardBmFeature("bmStall")) return;
    openBmBlindStockModal();
  });
  register("bmToggleBlindItem", ({ payload }) => toggleBmBlindItem(payload));
  register("confirmBmBlindStock", () => {
    if (!guardBmFeature("bmStall")) return;
    confirmBmBlindStock();
  });
  register("confirmBmBlindStockPrice", () => {
    if (!guardBmFeature("bmStall")) return;
    confirmBmBlindStockPrice();
  });
  register("openBmBlindMetaModal", () => {
    if (!guardBmFeature("bmStall")) return;
    openBmBlindMetaModal();
  });
  register("confirmBmBlindMeta", () => {
    if (!guardBmFeature("bmStall")) return;
    confirmBmBlindMeta();
  });
  register("openBmServiceOfferModal", () => {
    if (!guardBmFeature("bmStall")) return;
    openBmServiceOfferModal();
  });
  register("openBmServiceInfo", ({ payload }) => openBmServiceInfoModal(payload));
  register("confirmBmServiceOffer", () => {
    if (!guardBmFeature("bmStall")) return;
    confirmBmServiceOffer();
  });
  // 编辑服务橱窗入口已下线；保留确认/页签逻辑供内部预览复用
  register("confirmBmServiceProfile", () => {
    if (!guardBmFeature("bmStall")) return;
    confirmBmServiceProfile();
  });
  register("bmProfileTab", ({ target }) => setBmProfileTab(target?.dataset?.bmProfileTab));
  bindBmServiceProfileModal();
  register("bmRemoveOffer", ({ payload }) => socketRef.emit("bmRemoveServiceOffer", payload));
  register("bmBuyBlind", ({ payload }) => {
    if (!guardBmFeature("bmBuy")) return;
    socketRef.emit("bmBuyBlindbox", payload);
  });
  register("bmBlindDrawToggle", ({ payload }) => toggleBmBlindDrawPick(payload));
  register("bmBlindDrawSkip", () => skipBmBlindDrawAnim());
  register("bmBlindDrawConfirm", () => settleBmBlindDraw());
  register("bmBlindDrawClose", () => requestBmBlindDrawClose());
  register("bmConfirmBlindDrawClose", () => confirmBmBlindDrawClose());

  socketRef.off("bmBlindDrawStart");
  socketRef.on("bmBlindDrawStart", (res = {}) => {
    if (!res.ok || !res.draw) {
      if (res.message) showToast({ text: res.message, tone: "warn" });
      return;
    }
    openBmBlindDrawModal(res.draw, { skipAnim: Boolean(res.resumed) });
  });
  socketRef.off("bmBlindDrawSettle");
  socketRef.on("bmBlindDrawSettle", (res = {}) => {
    if (!res.ok) {
      bmUi.suppressBlindDrawResume = false;
      if (bmUi.blindDraw) {
        bmUi.blindDraw.settling = false;
        renderBmBlindDrawModal();
      }
      return;
    }
    finishBmBlindDrawUi();
    bmUi.section = "detail";
    if (res.stallId) bmUi.detailStallId = res.stallId;
    renderBlackmarket();
    // 结算后状态广播可能仍短暂带有 activeBlindDraw；再关一次避免弹窗被 resume 拉回
    finishBmBlindDrawUi();
    bmUi.suppressBlindDrawResume = false;
  });

  register("bmOrderService", ({ payload, target }) => {
    if (!guardBmFeature("bmBuy")) return;
    openBmOrderServiceModal(target?.dataset?.stall, payload);
  });
  register("bmOrderFilter", ({ target }) => setBmOrderFilter(target?.dataset?.bmOrderFilter));
  register("confirmBmOrderService", () => confirmBmOrderService());
  bindBmOrderServiceModal();
  register("bmAcceptService", ({ payload }) => {
    const orderId = String(payload || "");
    if (!orderId) {
      showToast({ text: "订单无效。", tone: "warn" });
      return;
    }
    socketRef.emit("bmAcceptService", orderId);
  });
  register("bmSubmitService", ({ payload }) => {
    const orderId = String(payload || "");
    if (!orderId) {
      showToast({ text: "订单无效。", tone: "warn" });
      return;
    }
    const order = (getState()?.blackServiceOrders || []).find((o) => String(o.id) === orderId);
    // 未完成加工：本地立即提醒，不依赖浏览器原生确认框 / 服务端往返
    if (order && order.status === "escrow" && !order.isFinished) {
      promptBmEarlySubmit(orderId, {
        message: "该订单尚未完成加工。",
        penalty: order.price
      });
      return;
    }
    socketRef.emit("bmSubmitService", { orderId });
  });
  register("bmDeliverService", ({ payload }) => {
    socketRef.emit("bmSubmitService", { orderId: payload });
  });
  register("bmConfirmService", ({ payload }) => socketRef.emit("bmConfirmService", payload));
  register("bmCancelService", ({ payload }) => {
    showToast({ text: "取消后物品与加工费将退回买家。", tone: "warn" });
    socketRef.emit("bmCancelService", payload);
  });

  socketRef.off("bmSubmitServiceConfirm");
  socketRef.on("bmSubmitServiceConfirm", ({ orderId, message, penalty } = {}) => {
    promptBmEarlySubmit(orderId, { message, penalty });
  });
  register("openBmRatingModal", () => openBmRatingModal());
  register("openBmRatingForm", ({ payload }) => openBmRatingForm(payload));
  register("bmPickStar", ({ payload, target }) => {
    bmUi.ratingStars = Number(payload) || 5;
    const rid = target?.dataset?.ratingId;
    if (!rid) return;
    document.querySelectorAll(`.bm-rate-card[data-rating-id="${rid}"] .bm-star-btn, .bm-rate-row[data-rating-id="${rid}"] .bm-star-btn`).forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.payload) === bmUi.ratingStars);
    });
  });
  register("bmSubmitRating", ({ payload }) => {
    socketRef.emit("bmSubmitRating", { ratingId: payload, stars: bmUi.ratingStars || 5 });
    closeBmModals();
  });

  document.addEventListener("click", (e) => {
    const modal = document.getElementById("bmListModal");
    if (!modal || modal.hidden || !modal.contains(e.target)) return;
    if (e.target.closest("[data-action='confirmBmList']")) {
      e.preventDefault();
      e.stopPropagation();
      confirmBmList();
    }
  }, true);
}
