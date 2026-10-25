import { activateModalLifecycle } from "../../modal-lifecycle.js";
import { createMutationRequestId } from "../../shell/mutation-socket.js";
import { inlaySummary } from "../../product-meta.js";
import { scratchItemIds, pendingScratchItemIds } from "../../../shared/domain/workshop/delivery-scratch.js";
import { createDeliveryScratchUi } from "./delivery-scratch-ui.js";
import { createDeliveryDetailsUi, openingResultHtml } from "./delivery-details-ui.js";
import { createDeliverySpotlightUi } from "./delivery-spotlight-ui.js";

const STAGES = { opening: "开料", carving: "规划取件", finishing: "精加工" };

export function createWorkshopDeliveryUi({ socket, getState, els, registerAction, helpers, document = globalThis.document }) {
  const { escapeHtml: esc, productCanvas, openingStoneSvg, materialStageLabel, paintJades, showToast } = helpers;
  let active = null;
  const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const allOutputs = (delivery) => [...delivery.items, ...delivery.auxiliaryItems];
  const find = (id, me = getState()?.me) => me?.workshopDeliveries?.find((row) => row.id === id);

  function request(event, deliveryId, fields = {}) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (result) => { if (!done) { done = true; clearTimeout(timer); resolve(result || { ok: false }); } };
      const timer = setTimeout(() => {
        finish({ ok: false, message: "连接暂时中断，领取进度已保留，请重试。" });
        socket.emit("requestState");
      }, 10_000);
      socket.emit(event, { deliveryId, ...fields, requestId: createMutationRequestId(event) }, finish);
    });
  }

  function animate(session, element, frames, options) {
    if (reducedMotion() || !element?.animate) return Promise.resolve();
    const animation = element.animate(frames, options);
    session.animations.push(animation);
    return animation.finished.catch(() => {});
  }

  function bindCasketHover(session) {
    const box = session.q("[data-delivery-box]");
    const visual = session.q(".delivery-casket-visual");
    let animation = null;
    const stop = (settle = false) => {
      if (!animation) return;
      const from = settle ? getComputedStyle(visual).transform : "none";
      animation.cancel();
      animation = null;
      if (settle && from !== "none" && active === session && session.phase === "pending" && !reducedMotion()) {
        animation = visual.animate([{ transform: from }, { transform: "none" }], { duration: 120, easing: "ease-out" });
      }
    };
    box.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "mouse" || active !== session || session.phase !== "pending" || reducedMotion() || !visual?.animate) return;
      stop();
      animation = visual.animate([
        { transform: "none", offset: 0 },
        { transform: "translateX(-1px) rotate(-.8deg)", offset: .15 },
        { transform: "translateX(3px) rotate(2deg)", offset: .32 },
        { transform: "translateX(-3px) rotate(-2deg)", offset: .5 },
        { transform: "translateX(2px) rotate(1.2deg)", offset: .68 },
        { transform: "translateX(-1px) rotate(-.6deg)", offset: .82 },
        { transform: "none", offset: 1 }
      ], { duration: 400, iterations: 1, easing: "ease-in-out" });
    });
    box.addEventListener("pointerleave", () => stop(true));
    return () => stop();
  }

  function cancelAnimations(session) {
    session.stopHover?.();
    session.animations.splice(0).forEach((animation) => animation.cancel());
  }

  function close(force = false) {
    if (!active || (active.phase === "claiming" && !force)) return;
    const session = active;
    active = null;
    cancelAnimations(session);
    session.details.close();
    session.spotlight.dispose();
    session.scratch?.dispose();
    session.cleanup?.();
    session.root.remove();
  }

  function showResults(session, focus = true) {
    if (active !== session) return;
    cancelAnimations(session);
    session.phase = "revealed";
    session.root.classList.add("is-revealed");
    session.root.classList.remove("is-opening");
    session.q("[data-delivery-results]").hidden = false;
    session.q("[data-delivery-box]").disabled = true;
    session.q("[data-delivery-prompt]").hidden = true;
    session.q("[data-delivery-collect]").hidden = false;
    session.q("[data-delivery-collect]").disabled = false;
    session.q("[data-delivery-skip]").hidden = true;
    session.q("[data-delivery-note]").textContent = "";
    session.spotlight.prepare();
    const outcome = session.q("[data-opening-result]");
    if (outcome) outcome.hidden = pendingScratchItemIds(session.delivery).length > 0;
    if (session.scratch) {
      updateScratchControls(session);
      session.scratch.enable(pendingScratchItemIds(session.delivery).length > 0);
      session.scratch.layout();
    }
    updateItemDetailControls(session);
    if (focus) focusResults(session);
  }

  function focusResults(session) {
    const selector = session.spotlight.mode === "review" ? "[data-delivery-return]"
      : pendingScratchItemIds(session.delivery).length ? "[data-delivery-reveal-all]" : "[data-delivery-collect]";
    session.q(selector).focus({ preventScroll: true });
  }

  function updateItemDetailControls(session) {
    const enabled = session.phase === "revealed" && session.spotlight.mode === "dialog";
    for (const card of session.root.querySelectorAll("[data-delivery-item]")) {
      card.tabIndex = enabled ? 0 : -1;
      if (enabled) { card.setAttribute("role", "button"); card.setAttribute("aria-label", `查看${allOutputs(session.delivery).find((item) => item.id === card.dataset.itemId)?.name || "物品"}详情`); }
      else { card.removeAttribute("role"); card.removeAttribute("aria-label"); }
    }
  }

  function updateScratchControls(session) {
    if (active !== session || session.phase !== "revealed" || !session.scratch) return;
    const pending = pendingScratchItemIds(session.delivery).length > 0;
    const outcome = session.q("[data-opening-result]");
    if (outcome) outcome.hidden = pending;
    session.q("[data-delivery-collect]").hidden = pending || session.spotlight.mode !== "dialog";
    const button = session.q("[data-delivery-reveal-all]");
    button.hidden = !pending;
    button.disabled = Boolean(session.scratchSaving);
    button.textContent = session.scratchSaving ? "正在揭晓…" : "一键揭晓";
    session.q("[data-delivery-note]").textContent = session.scratchError || "";
    session.spotlight.sync(pending, session.scratchSaving);
    updateItemDetailControls(session);
    if (!pending && session.spotlight.mode === "dialog" && document.activeElement === button) session.q("[data-delivery-collect]").focus({ preventScroll: true });
  }

  function mergeScratchState(session, state) {
    if (!state) return;
    const previous = session.delivery.scratchReveal?.revealedItemIds || [];
    session.delivery.scratchReveal = { ...state, revealedItemIds: [...new Set([...previous, ...state.revealedItemIds])] };
    if (!pendingScratchItemIds(session.delivery).length) session.scratchError = "";
    session.scratch?.sync(session.delivery.scratchReveal.revealedItemIds);
    updateScratchControls(session);
  }

  async function revealScratch(session, ids) {
    if (active !== session || session.phase !== "revealed" || !ids.length) return;
    session.scratch.reveal(ids);
    ids.forEach((id) => session.scratchQueue.add(id));
    if (session.scratchSaving) return;
    session.scratchSaving = true; session.scratchError = "";
    updateScratchControls(session);
    try {
      while (session.scratchQueue.size && active === session) {
        const itemIds = [...session.scratchQueue].slice(0, 32);
        itemIds.forEach((id) => session.scratchQueue.delete(id));
        const response = await request("revealWorkshopDelivery", session.delivery.id, { itemIds });
        if (active !== session) return;
        if (!response.ok) {
          if (itemIds.every((id) => !pendingScratchItemIds(session.delivery).includes(id))) continue;
          itemIds.forEach((id) => session.scratchQueue.add(id));
          session.scratchError = response.message || "揭晓进度已保留，请点击一键揭晓重试。";
          break;
        }
        mergeScratchState(session, response.scratchReveal);
      }
    } finally {
      session.scratchSaving = false;
      updateScratchControls(session);
    }
  }

  async function reveal() {
    const session = active;
    if (!session || session.phase !== "pending") return;
    session.stopHover?.();
    session.phase = "revealing";
    session.q("[data-delivery-box]").disabled = true;
    session.q("[data-delivery-note]").textContent = "正在开启锦匣…";
    const response = await request("revealWorkshopDelivery", session.delivery.id);
    if (active !== session) return;
    if (!response.ok) {
      session.phase = "pending";
      session.q("[data-delivery-box]").disabled = false;
      session.q("[data-delivery-note]").textContent = response.message || "未能开启，请重试。";
      return;
    }
    session.delivery.revealedAt = response.revealedAt;
    mergeScratchState(session, response.scratchReveal);
    session.phase = "opening";
    session.root.classList.add("is-opening");
    session.q("[data-delivery-prompt]").hidden = true;
    session.q("[data-delivery-skip]").hidden = false;
    session.q("[data-delivery-note]").textContent = "启匣见玉 · 新作即将呈现";
    const box = session.q("[data-delivery-box]");
    await animate(session, box, [{ transform: "translateX(-50%) rotate(0)" }, { transform: "translateX(-50%) rotate(-3deg)", offset: .35 }, { transform: "translateX(-50%) rotate(2deg)", offset: .7 }, { transform: "translateX(-50%) rotate(0)" }], { duration: 180 });
    if (active !== session || session.phase !== "opening") return;
    await animate(session, session.q(".delivery-casket-lid"), [{ transform: "translateY(0) rotateX(0)", opacity: 1 }, { transform: "translateY(-50px) rotateX(55deg)", opacity: .7 }], { duration: 320, fill: "forwards", easing: "cubic-bezier(.2,.8,.2,1)" });
    if (active !== session || session.phase !== "opening") return;
    const origin = box.getBoundingClientRect();
    session.root.classList.add("is-revealed");
    session.q("[data-delivery-results]").hidden = false;
    session.scratch?.layout();
    paintJades(session.root);
    const cards = [...session.root.querySelectorAll("[data-delivery-item]")];
    await Promise.all(cards.map((card, index) => {
      const rect = card.getBoundingClientRect();
      const dx = origin.left + origin.width / 2 - rect.left - rect.width / 2;
      const dy = origin.top + origin.height / 2 - rect.top - rect.height / 2;
      return animate(session, card, [
        { transform: `translate(${dx}px,${dy}px) scale(.12) rotate(${index % 2 ? 12 : -12}deg)`, opacity: 0 },
        { transform: `translate(${dx * .4}px,-22px) scale(.72)`, opacity: 1, offset: .55 },
        { transform: "translate(0,0) scale(1)", opacity: 1 }
      ], { duration: 650, delay: Math.min(index, 7) * 90, fill: "both", easing: "cubic-bezier(.2,.7,.25,1)" });
    }));
    if (active === session && session.phase === "opening") showResults(session);
  }

  async function complete(session) {
    if (active !== session || session.phase === "collecting") return;
    session.phase = "collecting";
    session.root.classList.add("is-collecting");
    session.q("[data-delivery-note]").textContent = "已入库 · 正在收入背包";
    const target = document.querySelector('[data-nav-view="inventory"]');
    const targetRect = target?.getBoundingClientRect();
    const dialogRect = session.q(".delivery-dialog").getBoundingClientRect();
    const x = targetRect?.width ? targetRect.left + targetRect.width / 2 : dialogRect.right - 24;
    const y = targetRect?.height ? targetRect.top + targetRect.height / 2 : dialogRect.top;
    await Promise.all([...session.root.querySelectorAll("[data-delivery-item]")].map((card, index) => {
      const rect = card.getBoundingClientRect();
      return animate(session, card, [{ transform: "translate(0,0) scale(1)", opacity: 1 }, { transform: `translate(${x - rect.left - rect.width / 2}px,${y - rect.top - rect.height / 2}px) scale(.06)`, opacity: 0 }], { duration: 420, delay: Math.min(index, 7) * 50, fill: "forwards", easing: "ease-in" });
    }));
    if (active !== session) return;
    const { items, auxiliaryItems } = session.delivery;
    close(true);
    const bag = document.querySelector('[data-nav-view="inventory"]');
    bag?.animate?.([{ filter: "brightness(1)" }, { filter: "brightness(1.8)" }, { filter: "brightness(1)" }], { duration: reducedMotion() ? 0 : 500 });
    showToast({ text: `已收入背包 · ${items.length} 件产物${auxiliaryItems.length ? "及余料" : ""}`, tone: "success" });
  }

  async function collect() {
    const session = active;
    if (!session || session.phase !== "revealed") return;
    if (session.spotlight.mode !== "dialog") return;
    if (pendingScratchItemIds(session.delivery).length) return;
    session.phase = "claiming";
    session.claimAttempted = true;
    session.q("[data-delivery-close]").disabled = true;
    session.q("[data-delivery-collect]").disabled = true;
    session.q("[data-delivery-note]").textContent = "正在收入背包…";
    const response = await request("claimWorkshopDelivery", session.delivery.id);
    if (active !== session || session.phase === "collecting") return;
    if (response.ok) return complete(session);
    session.phase = "revealed";
    session.q("[data-delivery-close]").disabled = false;
    session.q("[data-delivery-collect]").disabled = false;
    session.q("[data-delivery-note]").textContent = response.message || "领取未完成，请重试。";
    socket.emit("requestState");
  }

  function itemMarkup(item, covered = false, scratch = false) {
    const visual = item.type === "material" || item.type === "rough"
      ? openingStoneSvg(item, { revealed: true, kits: [] }) : productCanvas(item, "finished");
    return `<article class="delivery-item${["S", "A"].includes(item.craftGrade) ? " is-excellent" : ""}${covered ? " is-scratch-covered" : scratch ? " is-scratch-ready" : ""}" data-delivery-item data-item-id="${esc(item.id)}" tabindex="-1">
      <div class="delivery-item-visual">${scratch ? `<div class="delivery-scratch-plane"><div class="delivery-scratch-source"${covered ? ' aria-hidden="true"' : ""}>${visual}</div>${covered ? '<canvas class="delivery-scratch-canvas" data-scratch-canvas role="img" aria-label="待揭晓片料，按住拖动刮开，或使用一键揭晓"></canvas>' : ""}</div>${covered ? '<span class="delivery-scratch-hint">按住拖动，刮开片料</span>' : ""}` : visual}</div>
      ${covered && scratch ? `<div class="delivery-scratch-value" data-scratch-valuation><div><span>已揭露料值</span><strong data-scratch-value data-value="0">${helpers.formatMoney(0)}</strong></div><div><span data-scratch-value-progress>已揭露 0%</span><b data-scratch-value-delta>本笔 +${helpers.formatMoney(0)}</b></div><small>按已擦开的区域估值</small><span class="sr-only" role="status" aria-live="polite" data-scratch-value-status></span></div>` : ""}
      ${covered ? '<div class="delivery-scratch-placeholder"><b>待揭晓片料</b><span>片料 · ×1</span></div>' : ""}
      <div class="delivery-item-info"${covered ? " hidden" : ""}><b>${esc(item.name || "工坊产物")}</b>
      <span>${esc(materialStageLabel(item))}${item.craftGrade ? ` · ${esc(item.craftGrade)}` : ""} · ×1</span>
      ${inlaySummary(item) ? `<span>${esc(inlaySummary(item))}</span>` : ""}
      ${item.escrowOrderId ? '<small class="delivery-escrow">委托物</small>' : ""}</div></article>`;
  }

  function open(id) {
    const delivery = find(id);
    if (!delivery) return showToast("这批产物已领取或已移交。");
    if (active?.delivery.id === id) return;
    if (active?.phase === "claiming") return;
    close();
    const root = document.createElement("div");
    const scratchIds = scratchItemIds(delivery);
    const coveredIds = new Set(pendingScratchItemIds(delivery));
    const hasSpotlight = scratchIds.length === 1 && delivery.items.length === 1;
    root.className = `workshop-delivery-root${hasSpotlight ? " has-scratch-focus" : ""}${hasSpotlight && coveredIds.size ? " is-scratch-spotlight" : ""}`;
    root.innerHTML = `<section class="delivery-dialog" role="dialog" aria-modal="true" aria-labelledby="delivery-title">
      <header class="delivery-head"><div><p class="delivery-eyebrow" id="delivery-title">工坊交付 · ${esc(STAGES[delivery.stage] || "加工")}</p><p>${esc(delivery.inputName)} · ${esc(delivery.workerName)}</p></div><button type="button" class="modal-close" data-delivery-close aria-label="关闭，稍后继续领取">×</button></header>
      <div class="delivery-body"><div class="delivery-theater">
        <div class="delivery-glow" aria-hidden="true"></div>
        <button type="button" class="delivery-casket" data-delivery-box data-modal-initial-focus aria-label="打开锦匣，揭晓本次加工产物"><span class="delivery-casket-shadow"></span><span class="delivery-casket-visual"><span class="delivery-casket-base"></span><span class="delivery-casket-inside"></span><span class="delivery-casket-lid"><span class="delivery-casket-rule"></span><span class="delivery-casket-seal">玉</span></span><span class="delivery-casket-latch"></span></span></button>
        <p class="delivery-prompt" data-delivery-prompt>点击锦匣 · 揭晓新作</p>
        <div class="delivery-results${delivery.items.length <= 1 ? " is-single" : ""}" data-delivery-results hidden>${delivery.items.map((item) => itemMarkup(item, coveredIds.has(item.id), scratchIds.includes(item.id))).join("")}${!delivery.items.length ? delivery.auxiliaryItems.map((item) => itemMarkup(item)).join("") : ""}</div>
      </div><aside class="delivery-reveal-summary" data-delivery-summary hidden></aside>${delivery.stage === "opening" && delivery.items[0] ? `<div data-opening-result hidden>${openingResultHtml(delivery.items[0], helpers)}</div>` : ""}${delivery.auxiliaryItems.length ? `<p class="delivery-offcuts">另有余料：${delivery.auxiliaryItems.map((item) => `<button type="button" data-delivery-detail="${esc(item.id)}">${esc(item.name)}</button>`).join("、")}，随本批一同入包</p>` : ""}</div>
      <footer class="delivery-footer"><p data-delivery-note role="status" aria-live="polite">本次加工已完成 · 共 ${delivery.items.length} 件产物</p><button type="button" class="delivery-collect" data-delivery-collect hidden>收入背包${delivery.items.length ? `（${delivery.items.length}件${delivery.auxiliaryItems.length ? "及余料" : ""}）` : "（余料）"}</button>${scratchIds.length ? '<button type="button" class="delivery-collect" data-delivery-reveal-all hidden>一键揭晓</button>' : ""}<button type="button" class="delivery-skip" data-delivery-skip hidden>跳过动画</button>
      <button type="button" class="delivery-collect delivery-return" data-delivery-return hidden>点击任意位置，返回领取弹窗</button></footer></section>`;
    document.body.append(root);
    const session = { root, q: (selector) => root.querySelector(selector), delivery: structuredClone(delivery), phase: "pending", animations: [] };
    active = session;
    session.details = createDeliveryDetailsUi({ parent: root, helpers });
    session.spotlight = createDeliverySpotlightUi({ session, animate, isActive: () => active === session,
      onDialog: () => { updateScratchControls(session); updateItemDetailControls(session); } });
    if (scratchIds.length) {
      session.scratchQueue = new Set();
      session.scratch = createDeliveryScratchUi({ root, delivery, playerId: getState()?.me?.id || "local",
        itemIds: scratchIds, reducedMotion, onThreshold: (id) => revealScratch(session, [id]) });
      session.scratch.sync(delivery.scratchReveal?.revealedItemIds || []);
      session.q("[data-delivery-reveal-all]").addEventListener("click", () => revealScratch(session, pendingScratchItemIds(session.delivery)));
    }
    session.stopHover = bindCasketHover(session);
    session.q("[data-delivery-close]").addEventListener("click", () => close());
    session.q("[data-delivery-box]").addEventListener("click", reveal);
    session.q("[data-delivery-skip]").addEventListener("click", () => showResults(session));
    session.q("[data-delivery-collect]").addEventListener("click", collect);
    const inspectItem = (target) => {
      if (active !== session || session.phase !== "revealed" || session.spotlight.mode !== "dialog") return;
      const id = target?.dataset.itemId || target?.dataset.deliveryDetail;
      const item = allOutputs(session.delivery).find((row) => row.id === id);
      if (item && !pendingScratchItemIds(session.delivery).includes(id)) session.details.open(item);
    };
    root.addEventListener("click", (event) => inspectItem(event.target.closest("[data-delivery-item], [data-delivery-detail]")));
    root.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      const card = event.target.closest("[data-delivery-item]");
      if (card && session.spotlight.mode === "dialog") { event.preventDefault(); inspectItem(card); }
    });
    if (delivery.revealedAt) showResults(session, false);
    session.cleanup = activateModalLifecycle({ root, dialog: session.q(".delivery-dialog"), shell: els.shell,
      onClose: () => session.spotlight.mode === "review" ? session.spotlight.returnToDialog() : close(), closeOnBackdrop: false });
    if (delivery.revealedAt) focusResults(session);
    paintJades(root);
  }

  function sync(me) {
    if (!active || !me) return;
    const session = active;
    const current = find(session.delivery.id, me);
    if (current) {
      mergeScratchState(session, current.scratchReveal);
      // An expired commission can remove some outputs without consuming the offcuts.
      if (JSON.stringify(allOutputs(current).map((item) => item.id)) !== JSON.stringify(allOutputs(session.delivery).map((item) => item.id))) {
        const id = current.id; close(true); open(id); return;
      }
      if (current.revealedAt && session.phase === "pending") showResults(session);
      return;
    }
    if (session.phase === "collecting") return;
    const ownedIds = new Set([...(me.rough || []), ...(me.materials || []), ...(me.slices || []), ...(me.bracelets || [])].map((item) => item.id));
    if (session.claimAttempted && allOutputs(session.delivery).every((item) => ownedIds.has(item.id))) complete(session);
    else { close(true); showToast("这批产物已领取或已移交。"); }
  }

  registerAction?.("openWorkshopDelivery", ({ payload }) => open(payload));
  socket?.on?.("state", (state) => sync(state?.me));
  socket?.on?.("state:patch", (patch) => sync(patch?.changes?.me));
  return { open, close, sync };
}
