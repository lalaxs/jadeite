// Game modal + UI event handling (moved from main.js)

import { activateModalLifecycle } from "../modal-lifecycle.js";
import { paintJadeCanvases } from "../jade-renderer.js";
import { buildEmployeePayrollSettleModal } from "./payroll-settle-modal.js";
import {
  escapeHtml,
  formatMoney
} from "./format-utils.js";
import {
  rememberUiEvent,
  spawnFloatingText,
  showToast
} from "./toast-fx.js";

export let getEls = () => null;
export let getState = () => null;
export let getSocket = () => null;
export let clearPendingAuctionBid = null;
export let clearPendingEnterAuctionHall = null;
export let openLocationByView = null;
export let buildAuctionSettle = null;
export let buildLivestreamSettle = null;

let activeModal = null;
let gameModalLifecycleCleanup = null;

export function bindGameModalDeps(deps = {}) {
  if (typeof deps.getEls === "function") getEls = deps.getEls;
  if (typeof deps.getState === "function") getState = deps.getState;
  if (typeof deps.getSocket === "function") getSocket = deps.getSocket;
  if (typeof deps.clearPendingAuctionBid === "function") clearPendingAuctionBid = deps.clearPendingAuctionBid;
  if (typeof deps.clearPendingEnterAuctionHall === "function") clearPendingEnterAuctionHall = deps.clearPendingEnterAuctionHall;
  if (typeof deps.openLocationByView === "function") openLocationByView = deps.openLocationByView;
  if (typeof deps.buildAuctionSettle === "function") buildAuctionSettle = deps.buildAuctionSettle;
  if (typeof deps.buildLivestreamSettle === "function") buildLivestreamSettle = deps.buildLivestreamSettle;
}

export function getActiveModal() {
  return activeModal;
}

export function setActiveModal(value) {
  activeModal = value;
}

export function modalStatsHtml(stats = []) {
  if (!Array.isArray(stats) || !stats.length) return "";
  return stats.map((stat) => `
    <div class="game-modal-stat">
      <span>${escapeHtml(stat.label)}</span>
      <strong>${escapeHtml(stat.value)}</strong>
    </div>
  `).join("");
}

export function modalLinesHtml(lines = []) {
  if (!Array.isArray(lines) || !lines.length) return "";
  return `
    <div class="game-modal-lines">
      ${lines.slice(0, 24).map((line) => `<div class="game-modal-line">${escapeHtml(line)}</div>`).join("")}
    </div>
  `;
}

export function modalParagraphsHtml(payload = {}) {
  const paragraphs = Array.isArray(payload.body)
    ? payload.body
    : [payload.body || payload.text || payload.message].filter(Boolean);
  return paragraphs.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

export function modalActionHtml(action = {}, index = 0) {
  const label = escapeHtml(action.label || (index ? "取消" : "知道了"));
  const variant = action.variant === "warn" ? "warn" : action.variant === "secondary" ? "secondary" : "";
  const className = variant ? ` class="${variant}"` : "";
  if (action.clientAction) {
    const payloadAttr = action.payload != null && action.payload !== ""
      ? ` data-payload="${escapeHtml(action.payload)}"`
      : "";
    return `<button${className} data-action="${escapeHtml(action.clientAction)}"${payloadAttr} type="button">${label}</button>`;
  }
  if (action.socketAction) {
    const forceEarly = action.forceEarly ? ` data-modal-force-early="1"` : "";
    return `<button${className} data-modal-emit="${escapeHtml(action.socketAction)}" data-modal-payload="${escapeHtml(action.payload || "")}"${forceEarly} type="button">${label}</button>`;
  }
  return `<button${className} data-modal-close type="button">${label}</button>`;
}

export function openGameModal(payload = {}) {
  const els = getEls();
  if (!els?.modalRoot) return;
  gameModalLifecycleCleanup?.();
  gameModalLifecycleCleanup = null;
  activeModal = payload;
  const actions = Array.isArray(payload.actions) && payload.actions.length
    ? payload.actions
    : [{ label: payload.confirmText || "知道了" }];
  const size = ["compact", "standard", "wide"].includes(payload.size)
    ? ` game-modal--${payload.size}`
    : "";
  els.modalRoot.innerHTML = `
    <section class="game-modal${size}${payload.modalClass ? ` ${escapeHtml(payload.modalClass)}` : ""}" data-tone="${escapeHtml(payload.tone || "info")}" role="dialog" aria-modal="true" aria-labelledby="gameModalTitle">
      <div class="game-modal-head">
        <div class="game-modal-title">
          <h3 id="gameModalTitle">${escapeHtml(payload.title || "提示")}</h3>
          ${payload.subtitle ? `<p>${escapeHtml(payload.subtitle)}</p>` : ""}
        </div>
        <button class="modal-close" data-modal-close type="button" aria-label="关闭弹窗">×</button>
      </div>
      <div class="game-modal-body">
        ${payload.previewHtml || ""}
        ${modalParagraphsHtml(payload)}
        ${modalStatsHtml(payload.stats)}
        ${modalLinesHtml(payload.lines)}
        ${payload.html ? payload.html : ""}
      </div>
      <div class="game-modal-actions">
        ${payload.footerHtml || ""}
        ${actions.map(modalActionHtml).join("")}
      </div>
    </section>
  `;
  els.modalRoot.hidden = false;
  if (payload.previewHtml) paintJadeCanvases(els.modalRoot);
  gameModalLifecycleCleanup = activateModalLifecycle({
    root: els.modalRoot,
    dialog: els.modalRoot.querySelector('[role="dialog"]'),
    shell: els.shell,
    onClose: closeGameModal,
    closeOnBackdrop: payload.closeOnBackdrop ?? !["danger", "bad", "expense"].includes(payload.tone)
  });
}

export function closeGameModal() {
  const els = getEls();
  if (!els?.modalRoot) return;
  const closing = activeModal;
  clearPendingAuctionBid?.();
  clearPendingEnterAuctionHall?.();
  activeModal = null;
  gameModalLifecycleCleanup?.();
  gameModalLifecycleCleanup = null;
  els.modalRoot.hidden = true;
  els.modalRoot.innerHTML = "";
  const socket = getSocket();
  const state = getState();
  if (closing?.payrollReceiptId) {
    socket?.emit("ackEmployeePayrollSettle", { receiptId: closing.payrollReceiptId });
    if (state?.me?.employeePayroll?.pendingSettlement?.id === closing.payrollReceiptId) {
      state.me.employeePayroll.pendingSettlement = null;
    }
  }
  if (closing?.report?.roundId || String(closing?.id || "").startsWith("auction-settle:")) {
    const roundId = closing.report?.roundId || "";
    socket?.emit("ackAuctionSettle", { roundId });
    if (state?.me) state.me.pendingAuctionSettle = null;
  }
  if (closing?.report?.roomId || String(closing?.id || "").startsWith("livestream-settle:")) {
    const roomId = closing.report?.roomId || "";
    socket?.emit("ackLivestreamSettle", { roomId });
    if (state?.me) state.me.pendingLivestreamSettle = null;
  }
  if (closing) queueMicrotask(() => { if (!activeModal) maybeShowStateDrivenModals(); });
}

export function ackAuctionSettleModal() {
  const state = getState();
  const socket = getSocket();
  const roundId = activeModal?.report?.roundId || state?.me?.pendingAuctionSettle?.roundId || "";
  socket?.emit("ackAuctionSettle", { roundId });
  if (state?.me) state.me.pendingAuctionSettle = null;
  if (activeModal) {
    activeModal = { ...activeModal, report: null, id: "dismissed" };
  }
  closeGameModal();
}

export function ackLivestreamSettleModal() {
  const state = getState();
  const socket = getSocket();
  const roomId = activeModal?.report?.roomId || state?.me?.pendingLivestreamSettle?.roomId || "";
  socket?.emit("ackLivestreamSettle", { roomId });
  if (state?.me) state.me.pendingLivestreamSettle = null;
  if (activeModal) {
    activeModal = { ...activeModal, report: null, id: "dismissed" };
  }
  closeGameModal();
}

export function openInventoryAfterAuction() {
  ackAuctionSettleModal();
  openLocationByView?.("inventory");
}

export function isGameModalOpenWithId(id) {
  const els = getEls();
  if (!id || !els?.modalRoot || els.modalRoot.hidden) return false;
  return Boolean(activeModal && String(activeModal.id || "") === String(id));
}

export function normalizeUiModalPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  // 公盘结算一律按 report 本地重建，避免旧服务端文案（如「共花费…已退还」）残留
  const report = payload.report;
  if (report && String(payload.id || "").startsWith("auction-settle:")) {
    return buildAuctionSettle?.(report, formatMoney) || payload;
  }
  if (report && String(payload.id || "").startsWith("livestream-settle:")) {
    return buildLivestreamSettle?.(report, formatMoney) || payload;
  }
  return payload;
}

export function handleUiEvent(event) {
  if (Array.isArray(event)) {
    event.forEach(handleUiEvent);
    return;
  }
  let payload = typeof event === "string" ? { type: "toast", text: event } : event;
  if (!payload || typeof payload !== "object") return;
  const type = payload.type || payload.kind || "toast";
  if (type === "modal") {
    payload = normalizeUiModalPayload(payload);
    // 已在展示同一弹窗则跳过；若仅被 remember 过但未挂住，仍要补开（避免丢结算窗）
    if (isGameModalOpenWithId(payload.id)) {
      rememberUiEvent(payload);
      return;
    }
    rememberUiEvent(payload);
    openGameModal(payload);
    if (payload.floatText && payload.floatWhileModal) {
      spawnFloatingText({ text: payload.floatText, tone: payload.tone || "info" });
    }
    return;
  }
  if (rememberUiEvent(payload)) return;
  if (type === "float" || type === "floatingText") {
    spawnFloatingText(payload);
    return;
  }
  showToast(payload);
}

export function maybeShowStateDrivenModals(nextState = getState()) {
  if (activeModal) return;
  const pendingPayroll = nextState?.me?.employeePayroll?.pendingSettlement;
  if (pendingPayroll?.id) {
    openGameModal(buildEmployeePayrollSettleModal(pendingPayroll, nextState.me.workshop?.workers));
    return;
  }
  const pendingAuction = nextState?.me?.pendingAuctionSettle;
  if (pendingAuction?.roundId) {
    const modal = buildAuctionSettle?.(pendingAuction, formatMoney);
    // 只在已真正打开时跳过；绝不在此处 ack——ack 只应由用户关闭触发，
    // 否则 ui:event 先标记 seen 后若弹窗未挂住，pending 会被清掉且无法补弹。
    if (!modal) return;
    if (isGameModalOpenWithId(modal.id)) return;
    rememberUiEvent({ id: modal.id });
    openGameModal(modal);
    return;
  }
  const pendingLivestream = nextState?.me?.pendingLivestreamSettle;
  if (pendingLivestream?.roomId) {
    const modal = buildLivestreamSettle?.(pendingLivestream, formatMoney);
    if (!modal) return;
    if (isGameModalOpenWithId(modal.id)) return;
    rememberUiEvent({ id: modal.id });
    openGameModal(modal);
    return;
  }
  const summary = nextState?.me?.offlineSummary;
  if (!summary || !Number(summary.count)) return;
  const offlineLines = Array.isArray(summary.lines) ? summary.lines : [];
  const net = Number(summary.income || 0) - Number(summary.expense || 0);
  const id = `offline:${nextState.me.id}:${summary.count}:${summary.income || 0}:${summary.expense || 0}:${offlineLines.join("|")}`;
  if (rememberUiEvent({ id })) return;
  openGameModal({
    id,
    type: "modal",
    tone: net >= 0 ? "success" : "warn",
    title: "离线结算",
    subtitle: `${Number(summary.count)} 件事已完成`,
    body: "你离开期间，工坊、直播和订单继续推进。",
    lines: offlineLines
  });
}
