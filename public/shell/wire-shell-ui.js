// Shell UI listeners + 1s tick (moved from main.js initShell)
import { nowMs } from "./format-utils.js";

export function initShell(deps = {}) {
  const {
    els,
    socket,
    getState,
    setView,
    renderMainNav,
    setMobileResourcesOpen,
    toggleMobilePanel,
    closeMobileTransientUi,
    selectHomeTab,
    getSidePanelFilter,
    setSidePanelFilter,
    applySidePanelFilter,
    sendChat,
    syncAuctionBidAffordability,
    openGameModal,
    formatMoney,
    tickHudClock,
    tickSidePanelProgress,
    tickWorkshopJobProgress,
    tickAuctionClock,
    updateTaskCountdown,
    confirmBatchRefreshOrders
  } = deps;

  const activeView = deps.getActiveView?.() ?? "overview";
  setView(activeView);
  renderMainNav();
  els.mobileResourcesToggle?.addEventListener("click", () => {
    const open = els.mobileResourcesToggle.getAttribute("aria-expanded") !== "true";
    setMobileResourcesOpen(open);
  });
  document.addEventListener("pointerdown", (event) => {
    if (
      els.topHud?.classList.contains("is-mobile-open")
      && !els.topHud.contains(event.target)
      && !els.mobileResourcesToggle?.contains(event.target)
    ) {
      setMobileResourcesOpen(false);
    }
  });
  window.addEventListener("popstate", closeMobileTransientUi);
  els.sidePanelToggle?.addEventListener("click", () => {
    toggleMobilePanel("side");
  });
  els.chatDockToggle?.addEventListener("click", () => {
    toggleMobilePanel("chat");
  });
  if (els.chatSend) els.chatSend.addEventListener("click", sendChat);
  if (els.chatInput) {
    els.chatInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        sendChat();
      }
    });
  }
  // 主页四标签切换
  if (els.homeTabs) {
    els.homeTabs.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => selectHomeTab(btn.dataset.homeTab));
    });
    els.homeTabs.addEventListener("keydown", (event) => {
      const current = event.target.closest?.('[role="tab"][data-home-tab]');
      if (!current) return;
      const tabs = [...els.homeTabs.querySelectorAll('[role="tab"][data-home-tab]')];
      const index = tabs.indexOf(current);
      if (index < 0) return;
      let next = index;
      if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      selectHomeTab(tabs[next].dataset.homeTab);
      tabs[next].focus();
    });
  }
  // 右侧面板分类切换（筛选页签：默认选中「工坊」；点击切换筛选，再点已选中页签可取消=显示全部）
  if (els.panelTabs) {
    els.panelTabs.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.dataset.ptab;
        if (getSidePanelFilter() === t) {
          // 再次点击已选中的页签 → 取消筛选
          setSidePanelFilter(null);
          els.panelTabs.querySelectorAll("button").forEach((b) => {
            b.classList.remove("on");
            b.setAttribute("aria-pressed", "false");
          });
        } else {
          // 选中该页签 → 仅筛选显示对应内容
          setSidePanelFilter(t);
          els.panelTabs.querySelectorAll("button").forEach((b) => {
            const on = b === btn;
            b.classList.toggle("on", on);
            b.setAttribute("aria-pressed", on ? "true" : "false");
          });
        }
        applySidePanelFilter();
      });
    });
  }
  // 公盘出价：输入即时校验现金是否足够
  document.addEventListener("input", (event) => {
    const input = event.target?.closest?.("[data-bid-amount]");
    if (!input) return;
    syncAuctionBidAffordability(input);
  });
  // 任务面板：点击重置/领取/前往
  if (els.homeTaskPane) {
    els.homeTaskPane.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-task-action]");
      if (!btn) return;
      const action = btn.dataset.taskAction;
      const uid = btn.dataset.uid;
      if (action === "go") {
        setView(btn.dataset.view);
      } else if (action === "reset") {
        const resetCost = Math.max(0, Number(btn.dataset.resetCost) || 0);
        const resetCostLabel = resetCost > 0 ? formatMoney(resetCost) : "免费";
        openGameModal({
          title: "重置任务",
          subtitle: resetCost > 0 ? `花费 ${resetCostLabel}` : "本轮首次免费",
          tone: "warn",
          body: "确定重置该任务？将换成一个新任务，已有进度不会保留。",
          stats: [{ label: "重置费用", value: resetCostLabel }],
          actions: [
            { label: "确定重置", variant: "warn", socketAction: "task:reset", payload: uid },
            { label: "取消", variant: "secondary" }
          ]
        });
      } else if (action === "claim") {
        socket.emit("task:claim", { uid });
      }
    });
  }
  window.matchMedia("(min-width: 768px)").addEventListener("change", (event) => {
    if (!event.matches) return;
    closeMobileTransientUi();
  });
  // 顶栏时钟/公盘倒计时 + 右侧加工进度条：只做轻量 patch，不重建业务视图
  setInterval(() => {
    if (!getState()) return;
    const now = nowMs();
    tickHudClock(now);
    tickSidePanelProgress(now);
    tickWorkshopJobProgress();
    tickAuctionClock(now);
    updateTaskCountdown();
  }, 1000);

  if (els.saveNameBtn && els.nameInput) {
    els.saveNameBtn.addEventListener("click", () => {
      socket.emit("setName", els.nameInput.value);
    });
  }

  els.refreshOrders.addEventListener("click", () => {
    confirmBatchRefreshOrders();
  });
}

export const wireShellUi = initShell;
