// Shell data-action handlers + document body click dispatch (moved from main.js)

export function wireShellActions(deps = {}) {
  const {
    registerAction,
    actions,
    socket,
    els,
    getState,
    locationDefinitions,
    openLocationByView,
    closeGameModal,
    ackAuctionSettleModal,
    ackLivestreamSettleModal,
    openInventoryAfterAuction,
    focusInventoryEscrow,
    isWindowSelectionActive,
    requestAuctionWindowAt,
    boardPointFromEvent,
    handleOpeningClick,
    setMobileResourcesOpen,
    closeMarketModals,
    routeInventoryItem
  } = deps;

  registerAction("openLocation", ({ payload }) => {
    const location = locationDefinitions.find((item) => item.id === payload);
    openLocationByView(location?.view || payload);
  });
  registerAction("ackAuctionSettle", () => ackAuctionSettleModal());
  registerAction("ackLivestreamSettle", () => ackLivestreamSettleModal());
  registerAction("openInventoryAfterAuction", () => openInventoryAfterAuction());
  registerAction("openInventoryEscrow", ({ payload }) => {
    openLocationByView("inventory");
    focusInventoryEscrow({ query: payload || "" });
  });
  registerAction("lockedLocation", ({ payload }) => {
    const location = locationDefinitions.find((item) => item.id === payload);
    openLocationByView(location?.view || payload);
  });
  registerAction("goFeatureUnlock", ({ payload }) => {
    closeGameModal();
    openLocationByView(payload || "overview");
  });
  registerAction("routeInventoryItem", ({ payload }) => routeInventoryItem?.(payload));
  registerAction("claimAchievement", ({ payload, target }) => {
    if (!payload) return;
    if (target) target.disabled = true;
    socket.emit("achievement:claim", { id: payload });
  });
  registerAction("claimAllAchievements", ({ target }) => {
    if (target) target.disabled = true;
    socket.emit("achievement:claimAll", {});
  });
  registerAction("requestRecovery", () => socket.emit("requestRecovery", {}));

  document.body.addEventListener("click", (event) => {
    if (els.modalRoot && !els.modalRoot.hidden && event.target === els.modalRoot) {
      closeGameModal();
      return;
    }

    const modalClose = event.target.closest("[data-modal-close]");
    if (modalClose) {
      closeGameModal();
      return;
    }

    const modalEmit = event.target.closest("[data-modal-emit]");
    if (modalEmit) {
      const actionName = modalEmit.dataset.modalEmit;
      const rawPayload = modalEmit.dataset.modalPayload || "";
      // 任务重置等接口需要对象参数；收藏等接口可直接收字符串 id
      let payload = rawPayload;
      if (actionName === "task:reset") {
        payload = { uid: rawPayload };
      } else if (actionName === "collectBracelet") {
        payload = {
          braceletId: rawPayload,
          requestId: globalThis.crypto?.randomUUID?.() || `collect-${Date.now()}`
        };
      } else if (actionName === "bmSubmitService") {
        payload = {
          orderId: rawPayload,
          forceEarly: modalEmit.dataset.modalForceEarly === "1"
        };
      } else if (actionName === "recycleInventoryItem") {
        try {
          payload = JSON.parse(rawPayload);
        } catch {
          payload = {};
        }
      }
      socket.emit(actionName, payload);
      closeGameModal();
      return;
    }

    const viewLink = event.target.closest("[data-view-link]");
    if (viewLink) {
      openLocationByView(viewLink.dataset.viewLink);
      return;
    }

    if (typeof handleOpeningClick === "function" && handleOpeningClick(event.target, event)) {
      return;
    }

    const windowBoard = event.target.closest("[data-window-board]");
    if (windowBoard) {
      const roughId = windowBoard.dataset.windowBoard;
      if (isWindowSelectionActive(roughId)) {
        const point = boardPointFromEvent(windowBoard, event, true);
        requestAuctionWindowAt(roughId, point.x, point.y);
      }
      return;
    }

    const target = event.target.closest("[data-action]");
    if (!target || !getState()) return;
    const action = target.dataset.action;
    const payload = target.dataset.payload;
    if (actions.dispatch(action, { action, payload, target, event, socket, getState })) return;
    socket.emit(action, payload);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setMobileResourcesOpen(false);
      closeMarketModals();
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target.closest?.('[role="button"][data-action], [role="button"][data-view-link]');
    if (!target || target.matches("button, a, input, select, textarea")) return;
    event.preventDefault();
    target.click();
  });
}
