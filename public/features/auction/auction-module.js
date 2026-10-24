import { jadeCanvasMarkup } from "../../jade-renderer.js";
import { buildOpeningStone, renderJadeOpeningSvg } from "../../jade-opening-engine.js";
import { lazyPreviewMarkup, observeLazyPreviews } from "../../lazy-preview.js";
import { AUCTION_HALLS, auctionWindowFee, auctionBidPhase } from "../../jade-auction.js";

// 依赖注入容器：main.js 启动时调用 initAuctionModule 注入 socket / state 访问器 / els / 通用 helper，
// 使本模块不再依赖 main.js 的全局变量，达成解耦（样板：公盘系统独立成模块）。
let socketRef = null;
let getState = () => null;
let elsRef = null;
let getActiveView = () => "overview";
let formatMoney, formatDuration, nowMs, escapeHtml, empty, showToast, clampClient, paintJades, setView, CSS, openGameModal, closeGameModal;
let tickHudClock = () => {};

// 公盘模块内部状态（原 main.js 的全局变量迁入此处）
let selectedAuctionHallId = null;
let activeWindowSelection = null;
let activeAuctionRoundId = null;
let activeAuctionHallId = null;
/** 未提交的出价草稿（按 roughId），避免定时/状态重绘冲掉快捷加价与手输金额 */
const draftBidAmounts = new Map();
/** 出价二次确认待提交内容 */
let pendingAuctionBid = null;
/** 临近结束入场二次确认 */
let pendingEnterHallId = null;
/** 已见过的厅堂解锁集合；用于只播放一次解锁提示，初次载入不补播。 */
let knownUnlockedAuctionHallIds = null;
/** 当前跟踪场次是否已入场（换场时用于未入场飘字） */
let trackedEnteredForRound = false;
/** 上一拍是否已在公盘页（避免进页补同步时误飘字） */
let auctionViewWasActive = false;

/** 剩余 ≤1 分钟：入场需二次确认；剩余 ≤10 秒：禁止新入场（已缴费可进） */
const AUCTION_ENTRY_WARN_MS = 60_000;
const AUCTION_ENTRY_LOCK_MS = 10_000;

export function initAuctionModule(deps) {
  socketRef = deps.socket;
  getState = () => {
    const state = deps.getState();
    const auction = state?.auctionRounds?.[selectedAuctionHallId];
    return auction ? { ...state, auction } : state;
  };
  elsRef = deps.els;
  getActiveView = deps.getActiveView;
  ({ formatMoney, formatDuration, nowMs, escapeHtml, empty, showToast, clampClient, paintJades, setView, CSS, openGameModal, closeGameModal } = deps.helpers);
  tickHudClock = deps.helpers.tickHudClock || (() => {});
  const register = deps.registerAction;
  if (typeof register === "function") {
    register("startWindow", ({ payload }) => {
      if (isWindowSelectionActive(payload)) {
        clearWindowSelection();
      } else if (canOpenWindow(payload)) {
        startWindowSelection(payload);
        return;
      } else {
        showToast("当前无法开窗：需已入场、现金足够且本料尚未开窗");
        return;
      }
      renderAuction();
      paintJades?.();
    });
    register("enterAuctionHall", ({ payload }) => enterAuctionHall(payload));
    register("confirmEnterAuctionHall", () => confirmEnterAuctionHall());
    register("openHallHistory", () => setView("auctionHistory"));
    register("openAuctionHistory", () => {
      setView("auctionHistory");
      renderAuctionHistory();
    });
    register("backAuctionHalls", () => backAuctionHalls());
    register("requestWindow", ({ payload }) => {
      startWindowSelection(payload);
      showToast("请选择开窗位置");
    });
    register("enterAuction", ({ payload }) => {
      enterAuctionHall(payload);
    });
    register("joinAuction", ({ payload }) => {
      enterAuctionHall(payload);
    });
    register("increaseBid", ({ payload, target }) => {
      const amountInput = document.querySelector(`[data-bid-amount="${CSS.escape(payload)}"]`);
      const increment = Number(target.dataset.bidIncrement || 0);
      if (amountInput && Number.isFinite(increment)) {
        const minimum = Number(amountInput.dataset.minBid || 0);
        const current = Math.max(minimum, Number(amountInput.value || 0));
        amountInput.value = Math.round(current + increment);
        syncAuctionBidAffordability(amountInput);
      }
    });
    register("submitAuctionBid", ({ payload }) => {
      openAuctionBidConfirm(payload);
    });
    register("confirmAuctionBid", () => {
      confirmAuctionBid();
    });
  }
}

function emitAuctionBid({ roughId, amount, hallId }) {
  socketRef.emit("submitAuctionBid", {
    roughId,
    hallId,
    amount
  });
}

function openAuctionBidConfirm(roughId) {
  const state = getState();
  const amountInput = document.querySelector(`[data-bid-amount="${CSS.escape(roughId)}"]`);
  const amount = Number(String(amountInput?.value || "").replace(/[^\d]/g, "")) || 0;
  const controls = amountInput?.closest?.(".bid-controls");
  const liquidCash = Number(controls?.dataset?.bidCash ?? state?.me?.cash ?? 0);
  const escrowed = Number(controls?.dataset?.bidEscrowed || 0);
  const budget = liquidCash + escrowed;
  const minBid = Number(amountInput?.dataset?.minBid || 0);
  const rough = (state?.auction?.roughs || []).find((item) => item.id === roughId);
  const existing = myBidFor(roughId);
  const isModify = Boolean(existing);

  if (!amount || amount <= 0) {
    showToast("请先填写出价金额");
    return;
  }
  if (minBid && amount < minBid) {
    showToast(`出价不能低于起拍价 ${formatMoney(minBid)}`);
    return;
  }
  if (amount > budget) {
    showToast(`可用现金不足，还差 ${formatMoney(amount - budget)}`);
    syncAuctionBidAffordability(amountInput);
    return;
  }
  if (isModify && Number(existing.amount) === amount) {
    showToast("出价未变化");
    return;
  }

  pendingAuctionBid = {
    roughId,
    amount,
    hallId: state?.auction?.hallId
  };

  if (typeof openGameModal !== "function") {
    confirmAuctionBid();
    return;
  }

  const lines = [
    isModify
      ? `当前出价 ${formatMoney(existing.amount)}，确认后改为新金额。`
      : "提交后本场结束前仍可修改出价。",
    `可用预算 ${formatMoney(budget)}（含已冻结保证金）`,
    "自购暗料有开亏风险，参考估值不保证回本。"
  ];
  openGameModal({
    title: isModify ? "确认修改出价" : "确认提交出价",
    subtitle: rough?.name ? String(rough.name) : "公盘竞价",
    tone: "warn",
    stats: [
      { label: "本次出价", value: formatMoney(amount) },
      ...(minBid ? [{ label: "起拍价", value: formatMoney(minBid) }] : []),
      ...(isModify ? [{ label: "原出价", value: formatMoney(existing.amount) }] : [])
    ],
    lines,
    actions: [
      { label: isModify ? "确认修改" : "确认提交", clientAction: "confirmAuctionBid" },
      { label: "再看看", variant: "secondary" }
    ]
  });
}

function confirmAuctionBid() {
  const pending = pendingAuctionBid;
  pendingAuctionBid = null;
  if (!pending?.roughId) {
    if (typeof closeGameModal === "function") closeGameModal();
    return;
  }
  if (typeof closeGameModal === "function") closeGameModal();
  emitAuctionBid(pending);
}

export function clearPendingAuctionBid() {
  pendingAuctionBid = null;
}

export function clearPendingEnterAuctionHall() {
  pendingEnterHallId = null;
}

function clearAuctionBidDrafts() {
  draftBidAmounts.clear();
}

export function rememberAuctionBidDraft(roughId, amount) {
  const id = String(roughId || "");
  if (!id) return;
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) {
    draftBidAmounts.delete(id);
    return;
  }
  draftBidAmounts.set(id, Math.round(n));
}

export function auctionBidDraftFor(roughId) {
  const id = String(roughId || "");
  if (!id || !draftBidAmounts.has(id)) return null;
  return draftBidAmounts.get(id);
}

export function syncAuctionRoundSelection(auction = getState()?.auction) {
  const nextRoundId = auction?.id || null;
  const onAuctionView = getActiveView() === "auction";
  const justEnteredView = onAuctionView && !auctionViewWasActive;
  auctionViewWasActive = onAuctionView;

  if (activeAuctionRoundId === null) {
    activeAuctionRoundId = nextRoundId;
    activeAuctionHallId = auction?.hallId || null;
    trackedEnteredForRound = Boolean(auction?.entered);
    return false;
  }
  if (auction?.hallId && auction.hallId !== activeAuctionHallId) {
    activeAuctionHallId = auction.hallId;
    activeAuctionRoundId = nextRoundId;
    trackedEnteredForRound = Boolean(auction.entered);
    activeWindowSelection = null;
    clearAuctionBidDrafts();
    return false;
  }
  if (!nextRoundId || nextRoundId === activeAuctionRoundId) {
    trackedEnteredForRound = Boolean(auction?.entered);
    return false;
  }
  const missedEntry = !trackedEnteredForRound;
  activeAuctionRoundId = nextRoundId;
  selectedAuctionHallId = null;
  activeWindowSelection = null;
  clearAuctionBidDrafts();
  trackedEnteredForRound = Boolean(auction?.entered);
  if (pendingEnterHallId) {
    pendingEnterHallId = null;
    if (typeof closeGameModal === "function") closeGameModal();
  }
  // 仅「已在公盘页停留时」换场才飘字；从其他页点进来补同步不提示
  if (onAuctionView && !justEnteredView && missedEntry) {
    showToast({ text: "该轮公盘已结束。", tone: "info" });
  }
  return true;
}

// ---- 阶段元信息 ----
export function currentAuctionPhase(auction = getState()?.auction, now = nowMs()) {
  if (!auction) return "live";
  if (auction.settledAt || auction.phase === "settlement") return "settlement";
  if (now < Number(auction.endsAt || auction.biddingEndsAt || 0)) return "live";
  return "settlement";
}

export function auctionPhaseMeta(auction = getState()?.auction, now = nowMs()) {
  const phase = currentAuctionPhase(auction, now);
  const meta = {
    live: { label: auctionBidPhase(auction, now) === "open" ? "明拍中 · 最后两分钟转暗拍" : "暗拍中 · 他人出价已隐藏", clock: "本场结束", target: auction?.endsAt || auction?.biddingEndsAt },
    settlement: { label: "开标中", clock: "下场接续", target: auction?.endsAt || auction?.biddingEndsAt }
  }[phase] || { label: "本场拍卖进行中", clock: "本场结束", target: auction?.endsAt || auction?.biddingEndsAt };
  return {
    ...meta,
    remain: Math.max(0, Number(meta.target || now) - now)
  };
}

export function auctionCountdownPct(auction = getState()?.auction, now = nowMs()) {
  const startsAt = Number(auction?.startsAt || 0);
  const endsAt = Number(auction?.endsAt || auction?.biddingEndsAt || 0);
  const timing = getState()?.timing?.auction || {};
  const fallback = Number(timing.cadence || timing.duration || 10 * 60 * 1000);
  const total = Math.max(1, endsAt > startsAt ? endsAt - startsAt : fallback);
  const remain = auctionPhaseMeta(auction, now).remain;
  return Math.max(0, Math.min(100, (remain / total) * 100));
}

export function auctionRoundLabel(auction = getState()?.auction) {
  const timing = getState()?.timing?.auction || {};
  const cadence = Number(timing.cadence || timing.duration || 10 * 60 * 1000);
  const worldStartedAt = Number(getState()?.worldStartedAt || auction?.startsAt || nowMs());
  const startsAt = Number(auction?.startsAt || nowMs());
  const round = Math.max(1, Math.floor(Math.max(0, startsAt - worldStartedAt) / Math.max(1, cadence)) + 1);
  return `第 ${round} 场`;
}

// ---- 开窗 ----
export function windowCount(rough) {
  return rough.visual?.windows?.length || rough.windows?.length || 0;
}

function auctionWindowReveals(rough = {}) {
  const windows = Array.isArray(rough.windows) ? rough.windows : rough.visual?.windows;
  return Array.isArray(windows) ? windows : [];
}

/** Public, qualitative-only interpretation of a window reveal. */
export function auctionWindowClues(rough = {}) {
  const reveal = auctionWindowReveals(rough)[0];
  if (!reveal) return null;
  const expertClues = Array.isArray(rough.expertClues) ? rough.expertClues : [];
  const waterClue = expertClues.find((clue) => /(水头|底子|种)/.test(String(clue || "")));
  const color = reveal.hasBelt ? "见色带，有延伸" : "未见明显色带";
  const water = waterClue || (Number(rough.risk || 0) <= 48 ? "窗口表现较活" : "窗口水感仍偏朦");
  const crack = reveal.hasCrack ? "窗口见裂，留损耗" : "窗口暂未见裂";
  let assessment = "中性";
  let advice = "信息有限，不宜追高";
  let tone = "neutral";
  if (reveal.hasCrack) {
    assessment = "偏谨慎";
    advice = "裂风险显露，出价需留余量";
    tone = "warn";
  } else if (reveal.hasBelt && /(水头可博|较活)/.test(water)) {
    assessment = "偏利好";
    advice = "色水都有表现，但仍非定论";
    tone = "good";
  }
  return { color, water, crack, assessment, advice, impact: `${assessment}：${advice}`, tone };
}

export function auctionWindowClueHtml(rough = {}) {
  const clue = auctionWindowClues(rough);
  if (!clue) return "";
  return `
    <div class="lot-window-clues tone-${clue.tone}" aria-label="开窗观察">
      <div class="lot-window-assessment" aria-label="综合判断">
        <span class="lot-window-tone">${escapeHtml(clue.assessment)}</span>
        <p>${escapeHtml(clue.advice)}</p>
      </div>
      <dl class="lot-window-clue-grid">
        <div><dt>色带</dt><dd>${escapeHtml(clue.color)}</dd></div>
        <div><dt>水头</dt><dd>${escapeHtml(clue.water)}</dd></div>
        <div><dt>裂纹</dt><dd>${escapeHtml(clue.crack)}</dd></div>
      </dl>
    </div>
  `;
}

export function isWindowSelectionActive(roughId) {
  return activeWindowSelection === roughId;
}

export function canOpenWindow(roughId) {
  const auction = getState().auction;
  const rough = (auction?.roughs || []).find((r) => r.id === roughId);
  if (!rough) return false;
  const hall = (getState().auctionHalls || []).find((h) => h.id === auction?.hallId);
  const fee = auctionWindowFee(rough, hall || "novice");
  return currentAuctionPhase(auction) === "live" && auction?.entered && fee <= getState().me.cash && windowCount(rough) < 1;
}

export function startWindowSelection(roughId) {
  activeWindowSelection = roughId;
  renderAuction();
  paintJades();
}

export function clearWindowSelection() {
  activeWindowSelection = null;
  renderAuction();
  paintJades();
}

export function requestAuctionWindowAt(roughId, x, y) {
  const point = {
    x: clampClient(Math.round(x), 16, 84),
    y: clampClient(Math.round(y), 16, 84)
  };
  socketRef.emit("requestWindow", { roughId, hallId: getState().auction?.hallId, x: point.x, y: point.y });
  activeWindowSelection = null;
  showToast("开窗请求已提交。");
  renderAuction();
  paintJades();
}

export function auctionStoneSizeClass(rough) {
  const mass = Number(rough?.mass || 0);
  if (mass >= 2.4) return "auction-stone-large";
  if (mass <= 1.2) return "auction-stone-small";
  return "auction-stone-medium";
}

// 石头视觉缩放：按真实质量 0.7kg~3.5kg 连续映射到 0.5~1.12，
// 让小料明显小、大料明显大（覆盖原固定的三档 CSS scale）。
export function auctionStoneScale(rough) {
  const mass = Number(rough?.mass || 0.7);
  const lo = 0.7;
  const hi = 3.5;
  const t = Math.min(1, Math.max(0, (mass - lo) / (hi - lo)));
  return (0.5 + t * 0.62).toFixed(3);
}

export function auctionStoneSizeLabel(rough) {
  const sizeClass = auctionStoneSizeClass(rough);
  if (sizeClass === "auction-stone-large") return "大料";
  if (sizeClass === "auction-stone-small") return "小料";
  return "中料";
}

export function auctionStoneBoard(rough, { hasBid = false, bidAmount = null } = {}) {
  const selecting = isWindowSelectionActive(rough.id);
  const windows = Array.isArray(rough.windows) ? rough.windows.length : 0;
  const stoneHtml = stoneSvg(rough);
  const visual = selecting
    ? stoneHtml
    : lazyPreviewMarkup(stoneHtml, {
      tint: rough?.visual?.skin || rough?.visual?.vein || "",
      cacheKey: `auction:${rough.id || rough.name}:${windows}`
    });
  const boardClass = [
    "auction-window-board",
    auctionStoneSizeClass(rough),
    selecting ? "selecting" : "",
    windows ? "is-windowed" : "",
    hasBid && bidAmount != null ? "has-bid-chip" : ""
  ].filter(Boolean).join(" ");
  const bidChip = hasBid && bidAmount != null
    ? `<span class="lot-bid-chip" aria-label="我的出价 ${formatMoney(bidAmount)}">我的出价 <b>${formatMoney(bidAmount)}</b></span>`
    : "";
  return `
    <div class="${boardClass}" style="--auction-stone-scale:${auctionStoneScale(rough)}" data-window-board="${rough.id}" title="${selecting ? "点击料子表面选位开窗" : "点右侧「开窗」按钮后可在此选位"}">
      ${visual}
      ${hasBid ? `<span class="lot-seal" aria-label="已提交出价">已出价</span>` : ""}
      ${bidChip}
      ${windows ? `<span class="lot-window-bar">已开窗 · ${windows} 处</span>` : ""}
      ${selecting ? `<span class="window-selection-hint">点击料子表面开窗</span>` : ""}
    </div>
  `;
}

export function myBidFor(roughId) {
  return (getState().auction?.myBids || []).find((bid) => bid.roughId === roughId);
}

/** 公盘料子默认顺序：已出价 → 已开窗 → 现金可拍 → 价/金额 → id */
export function sortAuctionLots(roughs, me = getState()?.me) {
  const cash = Number(me?.cash || 0);
  return [...(roughs || [])].sort((a, b) => {
    const bidA = myBidFor(a.id);
    const bidB = myBidFor(b.id);
    const hasBidA = bidA ? 1 : 0;
    const hasBidB = bidB ? 1 : 0;
    if (hasBidA !== hasBidB) return hasBidB - hasBidA;

    const winA = windowCount(a) > 0 ? 1 : 0;
    const winB = windowCount(b) > 0 ? 1 : 0;
    if (winA !== winB) return winB - winA;

    const budgetA = cash + Number(bidA?.escrowed ?? bidA?.amount ?? 0);
    const budgetB = cash + Number(bidB?.escrowed ?? bidB?.amount ?? 0);
    const affordA = Number(a.price || 0) <= budgetA ? 1 : 0;
    const affordB = Number(b.price || 0) <= budgetB ? 1 : 0;
    if (affordA !== affordB) return affordB - affordA;

    if (hasBidA) {
      const amtDiff = Number(bidB.amount || 0) - Number(bidA.amount || 0);
      if (amtDiff) return amtDiff;
    } else {
      const priceDiff = Number(a.price || 0) - Number(b.price || 0);
      if (priceDiff) return priceDiff;
    }

    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

// ---- 竞价 ----
function parseBidAmount(value) {
  const n = Number(String(value ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function syncAuctionBidAffordability(inputEl) {
  if (!inputEl || typeof inputEl.closest !== "function") return false;
  const controls = inputEl.closest(".bid-controls");
  if (!controls) return false;
  const liquidCash = Number(controls.dataset.bidCash ?? getState()?.me?.cash ?? 0);
  const escrowed = Number(controls.dataset.bidEscrowed || 0);
  const budget = liquidCash + escrowed;
  const amount = parseBidAmount(inputEl.value);
  const roughId = inputEl.dataset.bidAmount;
  if (roughId) rememberAuctionBidDraft(roughId, amount);
  const short = amount > budget;
  const shortfall = Math.max(0, amount - budget);
  const hasBid = controls.dataset.hasBid === "1";
  const canBid = currentAuctionPhase(getState()?.auction) === "live" && getState()?.auction?.entered;

  controls.classList.toggle("is-short", short);
  const hint = controls.querySelector(".bid-short-hint");
  if (hint) {
    hint.hidden = !short;
    if (short) hint.textContent = `还差 ${formatMoney(shortfall)}`;
  }
  const submit = controls.querySelector('[data-action="submitAuctionBid"]');
  if (submit) {
    submit.disabled = !canBid || short;
    submit.textContent = short
      ? `现金不足 · 还差 ${formatMoney(shortfall)}`
      : `${hasBid ? "修改出价" : "提交出价"} · ${formatMoney(amount)}`;
  }
  return short;
}

export function renderAuctionBidControls(rough) {
  const { me } = getState();
  const bid = myBidFor(rough.id);
  const canBid = currentAuctionPhase(getState().auction) === "live" && getState().auction?.entered;
  const highestBid = Math.max(Number(bid?.amount) || 0, Number(rough.highestOtherBid) || 0);
  const phaseDisabled = canBid ? "" : "disabled";
  const draft = auctionBidDraftFor(rough.id);
  const committed = bid?.amount;
  if (draft != null && committed != null && Number(draft) === Number(committed)) {
    draftBidAmounts.delete(String(rough.id));
  }
  const amount = auctionBidDraftFor(rough.id) ?? committed ?? rough.price;
  const liquidCash = Number(me?.cash || 0);
  const escrowed = bid ? Number(bid.escrowed ?? bid.amount ?? 0) : 0;
  const budget = liquidCash + escrowed;
  const short = Number(amount) > budget;
  const shortfall = Math.max(0, Number(amount) - budget);
  const submitDisabled = (!canBid || short) ? "disabled" : "";
  const submitLabel = short
    ? `现金不足 · 还差 ${formatMoney(shortfall)}`
    : `${bid ? "修改出价" : "提交出价"} · ${formatMoney(amount)}`;
  const increments = Array.isArray(rough.bidIncrements) && rough.bidIncrements.length
    ? rough.bidIncrements
    : amount < 1000
      ? [50, 100, 200]
      : amount < 10000
        ? [100, 500, 1000]
        : amount < 100000
          ? [1000, 2000, 5000]
          : [5000, 10000, 20000];
  return `
    <div class="bid-controls ${short ? "is-short" : ""}" data-bid-cash="${liquidCash}" data-bid-escrowed="${escrowed}" data-has-bid="${bid ? "1" : "0"}">
      <div class="auction-competing-bid">${auctionBidPhase(getState()?.auction, nowMs()) === "open"
        ? `当前最高出价：<strong>${highestBid > 0 ? formatMoney(highestBid) : "暂无出价"}</strong>`
        : "暗拍阶段 · 他人最高出价已隐藏"}</div>
      <label class="bid-amount-field">
        <span class="bid-field-head">
          <span>我的出价</span>
          <span class="bid-short-hint" ${short ? "" : "hidden"}>还差 ${formatMoney(shortfall)}</span>
        </span>
        <span class="bid-amount-shell">
          <span class="bid-currency" aria-hidden="true">¥</span>
          <input data-bid-amount="${escapeHtml(rough.id)}" data-min-bid="${rough.price}" type="text" inputmode="numeric" pattern="[0-9]*" value="${amount}" ${phaseDisabled}>
        </span>
      </label>
      <div class="bid-increment-row" aria-label="快捷加价">
        <span>快捷加价</span>
        ${increments.map((increment) => `
          <button class="secondary" data-action="increaseBid" data-payload="${escapeHtml(rough.id)}" data-bid-increment="${increment}" ${phaseDisabled}>+${formatMoney(increment)}</button>
        `).join("")}
      </div>
      <button data-action="submitAuctionBid" data-payload="${escapeHtml(rough.id)}" ${submitDisabled}>${submitLabel}</button>
    </div>
  `;
}

// ---- 会场 / 入场 ----
export function selectedAuctionHall() {
  if (!selectedAuctionHallId) return null;
  return (getState().auctionHalls || []).find((hall) => hall.id === selectedAuctionHallId) || null;
}

function openEnterAuctionWarnConfirm(hallId) {
  pendingEnterHallId = hallId;
  if (typeof openGameModal !== "function") {
    enterAuctionHall(hallId, { confirmed: true });
    return;
  }
  const state = getState();
  const remain = auctionPhaseMeta(state?.auctionRounds?.[hallId] || state?.auction).remain;
  openGameModal({
    id: "auction-enter-warn",
    title: "确认入场",
    tone: "warn",
    body: ["当前剩余时间不足，确认要进入该公盘吗？"],
    html: `<p class="auction-enter-remain-line">本场还剩 <strong data-auction-enter-remain>${escapeHtml(formatDuration(remain))}</strong>。</p>`,
    actions: [
      { label: "确认进入", variant: "warn", clientAction: "confirmEnterAuctionHall" },
      { label: "再等等", variant: "secondary" }
    ]
  });
}

function confirmEnterAuctionHall() {
  const hallId = pendingEnterHallId;
  pendingEnterHallId = null;
  if (typeof closeGameModal === "function") closeGameModal();
  if (hallId) enterAuctionHall(hallId, { confirmed: true });
}

export function enterAuctionHall(hallId, options = {}) {
  const confirmed = Boolean(options.confirmed);
  const state = getState();
  const hall = (state?.auctionHalls || []).find((item) => item.id === hallId);
  if (!hall) return;
  if (!hall.unlocked || !hall.active) {
    showToast({ text: !hall.unlocked ? `需要经营 Lv.${hall.requiredLevel} 才能进入${hall.label}。` : "该公盘暂未开放。", tone: "warn" });
    return;
  }
  const targetAuction = state.auctionRounds?.[hallId] || state.auction;
  const enteredHere = hall.entered ?? (targetAuction?.entered && hall.id === targetAuction?.hallId);
  if (hall.active && hall.unlocked && !enteredHere) {
    const fee = Number(hall.entryFee ?? state.auction?.entryFee ?? hall.deposit ?? 0);
    const cash = Number(state.me?.cash || 0);
    if (fee > 0 && cash < fee) {
      showToast({
        text: `现金不足，入场费需要 ${formatMoney(fee)}（当前 ${formatMoney(cash)}）`,
        tone: "warn"
      });
      return;
    }
    const remain = auctionPhaseMeta(targetAuction).remain;
    if (remain <= AUCTION_ENTRY_LOCK_MS) {
      showToast({
        text: "本场剩余不足 10 秒，已停止入场。",
        tone: "warn"
      });
      return;
    }
    if (remain <= AUCTION_ENTRY_WARN_MS && !confirmed) {
      openEnterAuctionWarnConfirm(hallId);
      return;
    }
  }
  selectedAuctionHallId = hallId;
  activeWindowSelection = null;
  if (hall.active && hall.unlocked && !enteredHere) {
    socketRef.emit("enterAuction", { hallId });
  }
  renderAuction();
  paintJades();
}

export function backAuctionHalls() {
  selectedAuctionHallId = null;
  activeWindowSelection = null;
  renderAuction();
  paintJades();
}

export function renderAuctionHalls(now = nowMs()) {
  const { me } = getState();
  const selectedHall = selectedAuctionHall();
  if (selectedHall) {
    elsRef.auctionHalls.innerHTML = "";
    return;
  }
  const halls = [...(getState().auctionHalls || [])].sort((a, b) => (
    Number(Boolean(b.active)) - Number(Boolean(a.active))
    || Number(Boolean(b.next)) - Number(Boolean(a.next))
    || Number(a.requiredLevel || 0) - Number(b.requiredLevel || 0)
  ));
  const unlockedIds = new Set(halls.filter((hall) => hall.unlocked).map((hall) => hall.id));
  const justUnlockedIds = new Set();
  if (knownUnlockedAuctionHallIds) {
    for (const hall of halls) {
      if (hall.unlocked && !knownUnlockedAuctionHallIds.has(hall.id)) justUnlockedIds.add(hall.id);
    }
  }
  knownUnlockedAuctionHallIds = unlockedIds;
  if (justUnlockedIds.size) {
    const labels = halls.filter((hall) => justUnlockedIds.has(hall.id)).map((hall) => hall.label);
    showToast(`新会场已解锁：${labels.join("、")}`);
  }
  const state = getState();
  elsRef.auctionHalls.innerHTML = halls.map((hall) => {
    const auction = state.auctionRounds?.[hall.id] || (state.auction?.hallId === hall.id ? state.auction : null);
    const roughs = auction?.roughs || [];
    const affordable = roughs.filter((rough) => rough.price <= me.cash).length;
    const myBids = auction?.myBids?.length || 0;
    const entryLocked = auction ? auctionPhaseMeta(auction, now).remain <= AUCTION_ENTRY_LOCK_MS : false;
    const active = hall.active ? "active" : "";
    const locked = hall.unlocked ? "" : "locked";
    const preview = hall.active && hall.unlocked ? "" : "is-preview";
    const next = hall.next ? "is-next" : "";
    const justUnlocked = justUnlockedIds.has(hall.id) ? "is-just-unlocked" : "";
    const fee = hall.entryFee ?? getState().auction?.entryFee ?? hall.deposit;
    const entered = hall.entered ?? Boolean(auction?.entered);
    const enough = me.cash >= fee;
    const unlockNote = hall.unlocked ? "" : `经营 Lv.${hall.requiredLevel} 解锁`;
    const selected = selectedAuctionHallId === hall.id ? "selected" : "";
    const canOpenHall = hall.active && hall.unlocked && (entered || !entryLocked);
    const disabled = canOpenHall ? "" : "disabled";
    const showEnter = hall.unlocked && hall.active && !entered && !entryLocked;
    let enterRow;
    if (showEnter) {
      enterRow = `
        <div class="auction-hall-enter">
          <div class="auction-hall-fee ${enough ? "" : "short"}">
            <span>入场费 <b>${formatMoney(fee)}</b></span>
          </div>
          <span class="auction-hall-enter-btn">入场</span>
        </div>`;
    } else if (entered) {
      enterRow = `<div class="auction-hall-enter"><span class="auction-hall-enter-btn solo">已入场 · 查看料子</span></div>`;
    } else if (hall.active && hall.unlocked && entryLocked) {
      enterRow = `<div class="auction-hall-enter"><span class="auction-hall-status">剩余不足 10 秒，停止入场</span></div>`;
    } else if (!hall.active) {
      enterRow = "";
    } else if (!hall.unlocked) {
      enterRow = `<div class="auction-hall-enter"><span class="auction-hall-status">本场开放 · 经营 Lv.${hall.requiredLevel} 可入场</span></div>`;
    } else {
      enterRow = "";
    }
    const metaRow = hall.active && hall.unlocked
      ? `
          <span>我的出价 <b>${myBids}</b></span>
          <span title="当前现金够拍下的原石数量（可拍 = 现金 ≥ 料子底价）">现金可拍 <b>${affordable}/${roughs.length}</b></span>
          <span>开窗费 <b>${Math.round((hall.windowRate ?? 0.04) * 100)}%</b></span>`
      : `
          <span class="auction-hall-promise">${escapeHtml(hall.priceNote || hall.tone || "会场预告")}</span>
          <span>入场费 <b>${formatMoney(fee)}</b></span>
          <span>开窗费 <b>${Math.round((hall.windowRate ?? 0.04) * 100)}%</b></span>`;
    return `
      <button class="auction-hall-card ${active} ${locked} ${preview} ${next} ${justUnlocked} ${selected}" data-auction-hall="${escapeHtml(hall.id)}" data-action="enterAuctionHall" data-payload="${escapeHtml(hall.id)}" type="button" ${disabled}>
        <span class="auction-hall-art" aria-hidden="true"></span>
        <div class="auction-hall-overlay">
          <strong class="auction-hall-title">${escapeHtml(hall.label)}</strong>
          ${unlockNote ? `<span class="auction-hall-unlock">${escapeHtml(unlockNote)}</span>` : ""}
          ${hall.next ? `<span class="auction-hall-next">下一场开放</span>` : ""}
        </div>
        <div class="auction-hall-card-body">
          ${enterRow}
          <div class="auction-hall-meta">
            ${metaRow}
          </div>
        </div>
      </button>
    `;
  }).join("");
}

// ---- 料子卡片 ----
export function renderAuctionLotCard(rough, canRequestWindow) {
  const { me } = getState();
  const auction = getState().auction;
  const bid = myBidFor(rough.id);
  const hall = (getState().auctionHalls || []).find((h) => h.id === auction?.hallId);
  const fee = auctionWindowFee(rough, hall || "novice");
  const canWin = canOpenWindow(rough.id);
  const windows = windowCount(rough);
  const lotBudget = Number(me.cash || 0) + Number(bid?.escrowed ?? bid?.amount ?? 0);
  const locked = rough.price > lotBudget;
  const cardClass = [
    "rough-card",
    bid ? "is-mine-bid" : "",
    windows ? "is-windowed" : "",
    locked ? "locked" : ""
  ].filter(Boolean).join(" ");
  const statusMeta = windows ? "开窗信息已更新" : "";
  return `
    <article class="${cardClass}" ${bid ? `data-mine-bid="1"` : ""}>
      ${auctionStoneBoard(rough, { hasBid: Boolean(bid), bidAmount: bid?.amount ?? null })}
      <div class="lot-info">
        <div class="lot-title-row">
          <div class="lot-title-main">
            <h3 class="lot-name">${escapeHtml(rough.name)}</h3>
            ${statusMeta ? `<p class="lot-status-meta">${statusMeta}</p>` : ""}
          </div>
          <button class="lot-window-btn secondary" data-action="startWindow" data-payload="${escapeHtml(rough.id)}" ${canWin ? "" : "disabled"} title="开窗费 ${formatMoney(fee)}">开窗 · ${formatMoney(fee)}</button>
        </div>
        <p class="lot-weight">重量 ${rough.mass}kg</p>
        ${auctionWindowClueHtml(rough)}
        <div class="lot-prices">
          <div class="lot-price">
            <span>起拍价</span>
            <strong>${formatMoney(rough.price)}</strong>
          </div>
        </div>
        ${renderAuctionBidControls(rough)}
      </div>
    </article>
  `;
}

// ---- 历史拍卖 ----
export function formatHistoryTime(value) {
  const time = Number(value || 0);
  if (!time) return "时间未知";
  return new Date(time).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function auctionResultRow(result) {
  const isMine = result.winnerId === getState().me.id;
  const winnerName = result.ai
    ? "AI 买手"
    : ((getState().players || []).find((p) => p.id === result.winnerId)?.name || "其他玩家");
  const status = result.status === "passed"
    ? "流拍"
    : result.status === "aiWon" || result.ai
      ? "AI 买手中标"
      : isMine
        ? "恭喜中标"
        : "他人中标";
  const tone = result.status === "passed" ? "muted" : isMine ? "success" : "risk";
  return `
    <div class="auction-history-row ${tone}">
      <span class="result-icon" aria-hidden="true">${jadeIconSvg()}</span>
      <div class="result-main">
        <strong>${escapeHtml(result.roughName || result.roughId)}</strong>
        <small>成交 ${formatMoney(result.price)} · 拍卖人 ${escapeHtml(winnerName)}</small>
      </div>
      <span class="result-status">${status}</span>
    </div>`;
}

export function renderAuctionHistory() {
  if (!elsRef.auctionHistoryBrief || !elsRef.auctionHistoryList || !getState()) return;
  const entries = getState().auctionHistory || [];
  const totalLots = entries.reduce((sum, entry) => sum + (entry.results || []).length, 0);
  const myWins = entries.reduce((sum, entry) => sum + (entry.results || []).filter((result) => result.winnerId === getState().me.id).length, 0);
  const mySpend = entries.reduce((sum, entry) => sum + (entry.results || [])
    .filter((result) => result.winnerId === getState().me.id)
    .reduce((entrySum, result) => entrySum + Number(result.price || 0), 0), 0);
  elsRef.auctionHistoryBrief.innerHTML = `
    <span>历史场次 ${entries.length}</span>
    <span>开标料子 ${totalLots}</span>
    <span>我的中标 ${myWins}</span>
    <span>我的成交 ${formatMoney(mySpend)}</span>
  `;
  elsRef.auctionHistoryList.innerHTML = entries.map((entry) => {
    const hasMyWin = (entry.results || []).some((result) => result.winnerId === getState().me.id);
    const hallId = (AUCTION_HALLS.find((hall) => (
      hall.id === String(entry.hallId || "") || hall.label === String(entry.hallLabel || "")
    )) || AUCTION_HALLS[0]).id;
    return `
    <section class="auction-result-board auction-history-card${hasMyWin ? " has-my-win" : ""}" data-auction-hall="${escapeHtml(hallId)}">
      <div class="panel-head">
        <h3>${escapeHtml(entry.hallLabel || "公盘")}</h3>
        <span>${formatHistoryTime(entry.settledAt)} 开标</span>
      </div>
      <div class="auction-result-list">
        ${(entry.results || []).map((result) => auctionResultRow(result)).join("")}
      </div>
    </section>`;
  }).join("") || `
    <div class="game-empty-state auction-history-empty">
      <span class="game-empty-state-mark" aria-hidden="true">盘</span>
      <strong>还没有公盘开标记录</strong>
      <p>进入公盘参与竞价，开标后会在这里保留成交结果。</p>
      <button type="button" data-action="openLocation" data-payload="auction">前往公盘会场</button>
    </div>`;
}

// 公盘开窗预览必须和「真实游戏中石头开出来之后」使用同一套渲染引擎（jade-opening-engine），
// 否则窗口里看到的石料颜色/质感会和实际开料不一致。这里用同一 seed 构建同一块 opening stone，
// 并以「只在该窗口位置露出内部玉料、其余保留原石皮壳」的方式渲染，保证视觉一致。
const auctionOpeningCache = new Map();

function auctionOpeningSeedOf(rough) {
  return rough.openingSeed || rough.visual?.openingSeed || rough.visual?.seed || rough.id || rough.name;
}

function auctionOpeningStoneFor(rough) {
  const key = `${rough.id || rough.name}:${auctionOpeningSeedOf(rough)}`;
  if (!auctionOpeningCache.has(key)) {
    auctionOpeningCache.set(key, buildOpeningStone({ seed: key, roughId: rough.id || rough.name }));
  }
  return auctionOpeningCache.get(key);
}

export function stoneSvg(item, size = "large") {
  const windows = Array.isArray(item.windows) && item.windows.length
    ? item.windows
    : (Array.isArray(item.visual?.windows) ? item.visual.windows : []);
  const stone = auctionOpeningStoneFor(item);
  return renderJadeOpeningSvg(stone, { revealed: false, windows, label: item.name });
}

// ---- 顶层渲染 / chrome ----
let lastAuctionRenderFp = "";
let lastRenderedBidPhase = null;

function auctionRenderFingerprint(auction = getState()?.auction, me = getState()?.me, now = nowMs()) {
  const roughs = auction?.roughs || [];
  const halls = getState()?.auctionHalls || [];
  return [
    auction?.id || "",
    auction?.hallId || "",
    auction?.entered ? 1 : 0,
    selectedAuctionHallId || "",
    activeWindowSelection || "",
    currentAuctionPhase(auction, now),
    auctionBidPhase(auction, now),
    me?.cash ?? 0,
    halls.map((hall) => [hall.id, hall.unlocked, hall.active, hall.entered, hall.endsAt, hall.myBidCount].join(":")).join(","),
    roughs.map((rough) => {
      const bid = myBidFor(rough.id);
      return [
        rough.id,
        rough.price,
        rough.highestOtherBid ?? "",
        windowCount(rough),
        bid?.amount ?? "",
        bid?.escrowed ?? "",
        auctionBidDraftFor(rough.id) ?? ""
      ].join(":");
    }).join("|")
  ].join("::");
}

export function tickAuctionClock(now = nowMs()) {
  if (getActiveView() !== "auction") {
    auctionViewWasActive = false;
    return;
  }
  if (getState()?.auction && lastRenderedBidPhase !== auctionBidPhase(getState().auction, now)) {
    renderAuction(now);
    return;
  }
  tickHudClock(now);
  const phaseMeta = auctionPhaseMeta(undefined, now);
  const clockEl = elsRef.auctionBrief?.querySelector("[data-auction-clock]");
  const labelEl = elsRef.auctionBrief?.querySelector("[data-auction-clock-label]");
  const barEl = elsRef.auctionBrief?.querySelector("[data-auction-clock-bar]");
  if (clockEl) clockEl.textContent = formatDuration(phaseMeta.remain);
  if (labelEl) labelEl.textContent = phaseMeta.clock;
  if (barEl) {
    const pct = auctionCountdownPct(undefined, now);
    barEl.style.width = `${pct}%`;
    barEl.classList.toggle("urgent", pct > 0 && pct <= 10);
    barEl.classList.toggle("done", pct <= 0);
    const meter = barEl.closest("[role='progressbar']");
    if (meter) meter.setAttribute("aria-valuenow", String(Math.round(pct)));
  }
  const enterRemainEl = document.querySelector("[data-auction-enter-remain]");
  if (enterRemainEl) {
    const state = getState();
    const remain = auctionPhaseMeta(state?.auctionRounds?.[pendingEnterHallId] || state?.auction, now).remain;
    enterRemainEl.textContent = formatDuration(remain);
    if (pendingEnterHallId && remain <= AUCTION_ENTRY_LOCK_MS) {
      pendingEnterHallId = null;
      if (typeof closeGameModal === "function") closeGameModal();
      showToast({
        text: "本场剩余不足 10 秒，已停止入场。",
        tone: "warn"
      });
    }
  }
  updateAuctionChrome();
}

export function renderAuction(now = nowMs()) {
  const state = getState();
  if (!state?.me || !elsRef.auctionBrief || !elsRef.roughPool) return;
  const { me } = state;
  const auction = state.auction;
  syncAuctionRoundSelection(auction);
  const fp = auctionRenderFingerprint(auction, me, now);
  if (fp === lastAuctionRenderFp && elsRef.auctionBrief?.childElementCount) {
    tickAuctionClock(now);
    return;
  }
  lastAuctionRenderFp = fp;
  lastRenderedBidPhase = auctionBidPhase(auction, now);
  const roughs = auction?.roughs || [];
  const canRequestWindow = currentAuctionPhase(auction, now) === "live";
  const selectedHall = selectedAuctionHall();
  const phaseMeta = auctionPhaseMeta(auction, now);
  tickHudClock(now);
  renderAuctionHalls(now);
  const countdownPct = auctionCountdownPct(auction, now);
  elsRef.auctionBrief.innerHTML = `
    <section class="auction-round-hero">
      <div class="auction-round-main">
        <div class="auction-round-countdown">
          <span class="auction-round-label" data-auction-clock-label>${phaseMeta.clock}</span>
          <div class="auction-round-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(countdownPct)}" aria-label="本场剩余时间">
            <i data-auction-clock-bar class="${countdownPct <= 0 ? "done" : countdownPct <= 10 ? "urgent" : ""}" style="width:${countdownPct}%"></i>
          </div>
        </div>
        <strong class="auction-round-clock" data-auction-clock>${formatDuration(phaseMeta.remain)}</strong>
        <small>今日${auctionRoundLabel()} · ${phaseMeta.label}</small>
      </div>
      <button class="auction-history-btn" data-action="openHallHistory" type="button">历史拍卖</button>
    </section>
  `;
  if (!selectedHall) {
    elsRef.roughPool.innerHTML = "";
    updateAuctionChrome();
    return;
  }
  let pageBody = "";
  if (selectedHall.id !== auction?.hallId) {
    pageBody = empty("这个公盘当前场次未开放，请返回选择正在进行的公盘。");
  } else if (!auction?.entered) {
    pageBody = empty("正在确认入场，成功后会显示本场料子。");
  } else if (!roughs.length) {
    pageBody = empty("本场料子正在整理。");
  } else {
    const sortedLots = sortAuctionLots(roughs, me);
    pageBody = `
      <div class="auction-lot-grid">
        ${sortedLots.map((rough) => renderAuctionLotCard(rough, canRequestWindow)).join("")}
      </div>
    `;
  }
  elsRef.roughPool.innerHTML = pageBody;
  observeLazyPreviews(elsRef.roughPool);
  updateAuctionChrome();
}

export function updateAuctionChrome() {
  if (getActiveView() !== "auction") return;
  const hall = selectedAuctionHall();
  const inHall = Boolean(hall);
  const auctionView = elsRef.auctionHalls?.closest?.('.view[data-view="auction"]');
  if (auctionView) {
    if (hall?.id) auctionView.dataset.auctionHall = hall.id;
    else delete auctionView.dataset.auctionHall;
  }
  if (inHall) {
    if (elsRef.auctionHeadTitle) elsRef.auctionHeadTitle.textContent = hall.label;
  } else {
    if (elsRef.auctionHeadTitle) elsRef.auctionHeadTitle.textContent = "公盘会场";
  }
  if (elsRef.auctionHeadDesc) {
    elsRef.auctionHeadDesc.hidden = true;
    elsRef.auctionHeadDesc.textContent = "";
  }
  if (elsRef.auctionBackBtn) elsRef.auctionBackBtn.hidden = !inHall;
  const head = elsRef.auctionHeadDesc?.closest?.(".section-head");
  if (head) head.hidden = !inHall;
}

export function jadeIconSvg() {
  return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path d="M12 2C7 6 5 10 5 14a7 7 0 0 0 14 0c0-4-2-8-7-12z" fill="#1f9b72" opacity="0.92"/>
    <path d="M9 13c1 2 2 3 4 4" stroke="#e7f6ef" stroke-width="1.4" fill="none" stroke-linecap="round"/>
  </svg>`;
}
