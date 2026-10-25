import { MARKET_TAX } from "../../market-rules.js";
import { KIND_LABELS } from "../../jade-categories.js";
import { WANT_ITEM_TYPES, wantMatchesItem } from "../../jade-rules.js";
import { lazyPreviewMarkup } from "../../lazy-preview.js";
import { KIND_OPTIONS } from "./catalog.js";

export function createMarketWantController({ socketRef, getState, elsRef, getDocument, scope, observeLazyPreviews, ui, helpers, ports }) {
  const { marketUi, wantPostUi } = ui;
  const { formatMoney, escapeHtml, showToast } = helpers;
  const { mlVisual, marketSellables, wantRequirementText, openMarketModal, closeMarketModals } = ports;

function selectMarketWantApplyItem(modal, card) {
  marketUi.applyItemId = card.dataset.mwaId;
  modal.querySelectorAll(".ml-slot[data-mwa-id]").forEach((el) => {
    const selected = el.dataset.mwaId === marketUi.applyItemId;
    el.classList.toggle("selected", selected);
    el.setAttribute("aria-selected", selected ? "true" : "false");
    el.setAttribute("tabindex", selected ? "0" : "-1");
  });
  const confirmBtn = modal.querySelector("#mwaConfirm");
  if (confirmBtn) confirmBtn.disabled = false;
}

function syncWantPostFields() {
  const modal = elsRef.marketWantPostModal;
  if (!modal) return;
  const kindsWrap = modal.querySelector("#mwKindsWrap");
  const qualityWrap = modal.querySelector("#mwQualityWrap");
  const isBracelet = wantPostUi.itemType === "bracelet";
  if (kindsWrap) kindsWrap.hidden = !isBracelet;
  if (qualityWrap) qualityWrap.hidden = isBracelet;
  const budget = Math.max(100, Number(modal.querySelector("#mwBudget")?.value || 0));
  const tax = Math.round(budget * MARKET_TAX);
  const hint = modal.querySelector("#mwEscrowHint");
  if (hint) {
    hint.textContent = `发布将冻结 ${formatMoney(budget + tax)}（预算 ${formatMoney(budget)} + 税 ${formatMoney(tax)}）；成交后结余退回可用现金。`;
  }
}

function setWantPostError(modal, message = "") {
  const err = modal?.querySelector("#mwFormError");
  if (!err) return;
  const text = String(message || "").trim();
  err.hidden = !text;
  err.textContent = text;
}

function openMarketWantPost() {
  const modal = elsRef.marketWantPostModal || getDocument().getElementById("marketWantPostModal");
  if (!modal) { showToast("求购弹窗未就绪，请刷新页面。"); return; }
  wantPostUi.itemType = "bracelet";
  wantPostUi.durationKey = "10m";
  wantPostUi.rule = "lowest";
  wantPostUi.minScore = 3;
  wantPostUi.qualityKey = "";
  wantPostUi.acceptedKinds = new Set(["bracelet"]);
  const title = modal.querySelector("#mwTitle");
  const budget = modal.querySelector("#mwBudget");
  const note = modal.querySelector("#mwNote");
  const typeSel = modal.querySelector("#mwType");
  const scoreSel = modal.querySelector("#mwScore");
  const qualitySel = modal.querySelector("#mwQuality");
  if (title) title.value = "";
  if (budget) budget.value = "10000";
  if (note) note.value = "";
  if (typeSel) typeSel.value = "bracelet";
  if (scoreSel) scoreSel.value = "3";
  if (qualitySel) qualitySel.value = "";
  setWantPostError(modal, "");
  modal.querySelectorAll("[data-mw-duration]").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.mwDuration === wantPostUi.durationKey);
  });
  modal.querySelectorAll("[data-mw-rule]").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.mwRule === wantPostUi.rule);
  });
  const kinds = modal.querySelector("#mwKinds");
  if (kinds) {
    kinds.innerHTML = KIND_OPTIONS.map((k) => `
      <label class="jm-kind-chip">
        <input type="checkbox" value="${k}" ${wantPostUi.acceptedKinds.has(k) ? "checked" : ""}>
        <span class="jm-kind-face">${escapeHtml(KIND_LABELS[k] || k)}</span>
      </label>`).join("");
  }
  syncWantPostFields();
  const confirmBtn = modal.querySelector("[data-action='confirmMarketWantPost']");
  if (confirmBtn) confirmBtn.disabled = false;
  openMarketModal(modal, { initialFocus: "#mwTitle" });
  modal.querySelector(".jm-modal-body")?.scrollTo?.(0, 0);
}

function confirmMarketWantPost() {
  const modal = elsRef.marketWantPostModal || getDocument().getElementById("marketWantPostModal");
  if (!modal) return;
  const titleInput = modal.querySelector("#mwTitle");
  const title = String(titleInput?.value || "").trim();
  const budget = Number(modal.querySelector("#mwBudget")?.value || 0);
  const note = String(modal.querySelector("#mwNote")?.value || "").trim();
  const minScore = Number(modal.querySelector("#mwScore")?.value || 3);
  const itemType = String(modal.querySelector("#mwType")?.value || wantPostUi.itemType);
  const qualityKey = String(modal.querySelector("#mwQuality")?.value || "");
  const acceptedKinds = [...modal.querySelectorAll("#mwKinds input:checked")].map((el) => el.value);
  const fail = (message, focusEl = null) => {
    setWantPostError(modal, message);
    showToast(message);
    focusEl?.focus?.();
  };
  if (!title) { fail("请填写求购标题。", titleInput); return; }
  if (!WANT_ITEM_TYPES.includes(itemType)) { fail("请选择品类。", modal.querySelector("#mwType")); return; }
  if (budget < 100) { fail("预算至少 ¥100。", modal.querySelector("#mwBudget")); return; }
  if (itemType === "bracelet" && !acceptedKinds.length) { fail("请至少选择一个成品题材。"); return; }
  if (!socketRef) { fail("连接未就绪，请刷新后重试。"); return; }

  const confirmBtn = modal.querySelector("[data-action='confirmMarketWantPost']");
  if (confirmBtn) confirmBtn.disabled = true;
  setWantPostError(modal, "");
  let settled = false;
  let releaseCleanup;
  const finish = (res = {}) => {
    if (settled) return;
    settled = true;
    releaseCleanup?.();
    scope.clearTimeout(timeoutId);
    if (confirmBtn) confirmBtn.disabled = false;
    if (!res?.ok) {
      fail(res?.message || "发布求购失败，请稍后重试。");
      return;
    }
    closeMarketModals();
    showToast(res.message || "求购已发布。");
  };
  const timeoutId = scope.setTimeout(() => {
    finish({ ok: false, message: "发布超时，请检查连接后重试。" });
  }, 8000);
  releaseCleanup = scope.addCleanup(() => {
    settled = true;
    scope.clearTimeout(timeoutId);
    if (confirmBtn) confirmBtn.disabled = false;
  });
  socketRef.emit("postWant", {
    title,
    itemTypes: [itemType],
    acceptedKinds: itemType === "bracelet" ? acceptedKinds : [],
    qualityKey: itemType === "bracelet" ? "" : qualityKey,
    minScore,
    budget,
    note,
    durationKey: wantPostUi.durationKey,
    rule: wantPostUi.rule
  }, (res = {}) => finish(res));
}

function openMarketApplyWant(wantId) {
  const want = (getState().wants || []).find((w) => w.id === wantId);
  if (!want) { showToast("求购不存在。"); return; }
  if (want.ownerId === getState().me?.id) { showToast("不能应征自己的求购。"); return; }
  const modal = elsRef.marketWantApplyModal || getDocument().getElementById("marketWantApplyModal");
  if (!modal) { showToast("应征弹窗未就绪，请刷新页面。"); return; }
  marketUi.applyWantId = wantId;
  marketUi.applyItemId = null;
  marketUi.applyPrice = Math.min(want.budget, Math.max(100, Math.round(want.budget * 0.9)));
  const matchables = marketSellables().filter((item) => wantMatchesItem(want, item, item._type));
  const grid = modal.querySelector("#mwaGrid");
  const summary = modal.querySelector("#mwaSummary");
  const priceInput = modal.querySelector("#mwaPrice");
  if (summary) summary.textContent = wantRequirementText(want);
  if (priceInput) {
    priceInput.max = want.budget;
    priceInput.value = marketUi.applyPrice;
  }
  if (grid) {
    grid.innerHTML = matchables.length
      ? matchables.map((item, index) => `
        <article class="ml-slot" data-mwa-id="${escapeHtml(item.id)}" title="${escapeHtml(item.name)}" role="option" aria-selected="false" tabindex="${index === 0 ? "0" : "-1"}">
          <div class="ml-slot-visual">${lazyPreviewMarkup(mlVisual(item), {
            tint: item?.visual?.skin || item?.visual?.vein || "",
            cacheKey: `mwa:${item.id}`
          })}</div>
          <div class="ml-slot-copy"><div class="ml-slot-name"><strong>${escapeHtml(item.name)}</strong></div></div>
        </article>`).join("")
      : `<div class="ml-empty modal-empty-state">
          <strong>没有符合条件的货品</strong>
          <p>检查求购所需的品类与品质；备齐对应货品后再来应征。</p>
        </div>`;
    observeLazyPreviews(grid);
  }
  const confirmBtn = modal.querySelector("#mwaConfirm");
  if (confirmBtn) confirmBtn.disabled = true;
  openMarketModal(modal);
}

function confirmMarketApplyWant() {
  const want = (getState().wants || []).find((w) => w.id === marketUi.applyWantId);
  if (!want || !marketUi.applyItemId) { showToast("请选择应征货品。"); return; }
  const item = marketSellables().find((i) => i.id === marketUi.applyItemId);
  if (!item) { showToast("货品不存在。"); return; }
  const modal = elsRef.marketWantApplyModal;
  const price = Math.max(100, Number(modal?.querySelector("#mwaPrice")?.value || marketUi.applyPrice));
  if (price > want.budget) { showToast(`报价不能超过预算 ${formatMoney(want.budget)}。`); return; }
  socketRef.emit("applyWant", {
    wantId: want.id,
    type: item._type,
    itemId: item.id,
    price
  });
  closeMarketModals();
  marketUi.applyWantId = null;
  marketUi.applyItemId = null;
}

  return { selectMarketWantApplyItem, syncWantPostFields, setWantPostError, openMarketWantPost, confirmMarketWantPost, openMarketApplyWant, confirmMarketApplyWant };
}
