import { jadeCanvasMarkup } from "./jade-renderer.js";
import { buildOpeningStone, renderJadeOpeningSvg } from "./jade-opening-engine.js";

// 依赖注入容器：main.js 启动时调用 initAuctionModule 注入 socket / state 访问器 / els / 通用 helper，
// 使本模块不再依赖 main.js 的全局变量，达成解耦（样板：公盘系统独立成模块）。
let socketRef = null;
let getState = () => null;
let elsRef = null;
let getActiveView = () => "overview";
let formatMoney, formatDuration, nowMs, escapeHtml, empty, showToast, clampClient, paintJades, setView, CSS;

// 公盘模块内部状态（原 main.js 的全局变量迁入此处）
let selectedAuctionHallId = null;
let activeWindowSelection = null;

export function initAuctionModule(deps) {
  socketRef = deps.socket;
  getState = deps.getState;
  elsRef = deps.els;
  getActiveView = deps.getActiveView;
  ({ formatMoney, formatDuration, nowMs, escapeHtml, empty, showToast, clampClient, paintJades, setView, CSS } = deps.helpers);
}

// ---- 阶段元信息 ----
export function currentAuctionPhase(auction = getState()?.auction) {
  if (!auction) return "live";
  if (auction.settledAt || auction.phase === "settlement") return "settlement";
  if (nowMs() < Number(auction.endsAt || auction.biddingEndsAt || 0)) return "live";
  return "settlement";
}

export function auctionPhaseMeta(auction = getState()?.auction) {
  const phase = currentAuctionPhase(auction);
  const meta = {
    live: { label: "本场拍卖进行中", clock: "本场结束", target: auction?.endsAt || auction?.biddingEndsAt },
    settlement: { label: "开标中", clock: "下场接续", target: auction?.endsAt || auction?.biddingEndsAt }
  }[phase] || { label: "本场拍卖进行中", clock: "本场结束", target: auction?.endsAt || auction?.biddingEndsAt };
  return {
    ...meta,
    remain: Math.max(0, Number(meta.target || nowMs()) - nowMs())
  };
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

export function isWindowSelectionActive(roughId) {
  return activeWindowSelection === roughId;
}

export function canOpenWindow(roughId) {
  const auction = getState().auction;
  const rough = (auction?.roughs || []).find((r) => r.id === roughId);
  if (!rough) return false;
  const hall = (getState().auctionHalls || []).find((h) => h.id === auction?.hallId);
  const fee = Math.round(rough.price * (hall?.windowRate ?? 0.06));
  return currentAuctionPhase(auction) === "live" && auction?.entered && fee <= getState().me.cash && windowCount(rough) < 6;
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

export function auctionStoneBoard(rough) {
  const selecting = isWindowSelectionActive(rough.id);
  return `
    <div class="auction-window-board ${auctionStoneSizeClass(rough)} ${selecting ? "selecting" : ""}" style="--auction-stone-scale:${auctionStoneScale(rough)}" data-window-board="${rough.id}" title="${selecting ? "点击料子表面选位开窗" : "点右侧「开窗」按钮后可在此选位"}">
      ${stoneSvg(rough)}
      ${selecting ? `<span class="window-selection-hint">点击料子表面开窗</span>` : ""}
    </div>
  `;
}

export function myBidFor(roughId) {
  return (getState().auction?.myBids || []).find((bid) => bid.roughId === roughId);
}

// ---- 出价暗标 ----
export function renderAuctionBidControls(rough) {
  const bid = myBidFor(rough.id);
  const canBid = currentAuctionPhase(getState().auction) === "live" && getState().auction?.entered;
  const disabled = canBid ? "" : "disabled";
  const amount = bid?.amount || rough.price;
  const countdown = auctionPhaseMeta(getState().auction);
  const increments = Array.isArray(rough.bidIncrements) && rough.bidIncrements.length
    ? rough.bidIncrements
    : amount < 1000
      ? [50, 100, 200]
      : amount < 10000
        ? [100, 500, 1000]
        : amount < 100000
          ? [1000, 2000, 5000]
          : [5000, 10000, 20000];
  const status = bid
    ? `<div class="bid-status success"><strong>已封存暗标</strong><span>我的出价 ${formatMoney(bid.amount)} · ${countdown.clock} ${formatDuration(countdown.remain)}</span></div>`
    : "";
  return `
    <div class="bid-controls">
      ${status}
      <label class="bid-amount-field">
        <span class="bid-field-head"><span>我的出价</span><em class="bid-cash">现金 ${formatMoney(getState().me.cash)}</em></span>
        <input data-bid-amount="${escapeHtml(rough.id)}" data-min-bid="${rough.price}" type="text" inputmode="numeric" pattern="[0-9]*" value="${amount}" ${disabled}>
      </label>
      <div class="bid-increment-row" aria-label="快捷加价">
        <span>快捷加价</span>
        ${increments.map((increment) => `
          <button class="secondary" data-action="increaseBid" data-payload="${escapeHtml(rough.id)}" data-bid-increment="${increment}" ${disabled}>+${formatMoney(increment)}</button>
        `).join("")}
      </div>
      <button data-action="submitAuctionBid" data-payload="${escapeHtml(rough.id)}" ${disabled}>${bid ? "修改暗标" : "提交暗标"}</button>
    </div>
  `;
}

// ---- 会场 / 入场 ----
export function selectedAuctionHall() {
  if (!selectedAuctionHallId) return null;
  return (getState().auctionHalls || []).find((hall) => hall.id === selectedAuctionHallId) || null;
}

export function enterAuctionHall(hallId) {
  const hall = (getState().auctionHalls || []).find((item) => item.id === hallId);
  if (!hall) return;
  selectedAuctionHallId = hallId;
  activeWindowSelection = null;
  const enteredHere = getState().auction?.entered && hall.id === getState().auction?.hallId;
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

export function renderAuctionHalls() {
  const { me } = getState();
  const selectedHall = selectedAuctionHall();
  if (selectedHall) {
    elsRef.auctionHalls.innerHTML = "";
    return;
  }
  const halls = getState().auctionHalls || [];
  const roughs = getState().auction?.roughs || [];
  const affordable = roughs.filter((rough) => rough.price <= me.cash).length;
  const myBids = getState().auction?.myBids?.length || 0;
  elsRef.auctionHalls.innerHTML = halls.map((hall) => {
    const active = hall.active ? "active" : "";
    const locked = hall.unlocked ? "" : "locked";
    const fee = hall.entryFee ?? getState().auction?.entryFee ?? hall.deposit;
    const entered = hall.id === getState().auction?.hallId && getState().auction?.entered;
    const enough = me.cash >= fee;
    const unlockNote = hall.unlocked ? "" : `声望 Lv.${hall.requiredLevel} 解锁`;
    const selected = selectedAuctionHallId === hall.id ? "selected" : "";
    const disabled = hall.active && hall.unlocked ? "" : "disabled";
    const showEnter = hall.unlocked && hall.active && !entered;
    let enterRow;
    if (showEnter) {
      enterRow = `
        <div class="auction-hall-enter">
          <div class="auction-hall-fee ${enough ? "" : "short"}">
            <span>入场费 <b>${formatMoney(fee)}</b></span>
            <span class="cash">现金 <b>${formatMoney(me.cash)}</b></span>
          </div>
          <span class="auction-hall-enter-btn">入场</span>
        </div>`;
    } else if (entered) {
      enterRow = `<div class="auction-hall-enter"><span class="auction-hall-enter-btn solo">已入场 · 查看料子</span></div>`;
    } else if (!hall.active) {
      enterRow = `<div class="auction-hall-enter"><span class="auction-hall-status">本场未开放</span></div>`;
    } else {
      enterRow = "";
    }
    return `
      <button class="auction-hall-card ${active} ${locked} ${selected}" data-action="enterAuctionHall" data-payload="${escapeHtml(hall.id)}" type="button" ${disabled}>
        <span class="auction-hall-art" aria-hidden="true"></span>
        <div class="auction-hall-overlay">
          <strong class="auction-hall-title">${escapeHtml(hall.label)}</strong>
          ${unlockNote ? `<span class="auction-hall-unlock">${escapeHtml(unlockNote)}</span>` : ""}
        </div>
        <div class="auction-hall-card-body">
          ${enterRow}
          <div class="auction-hall-meta">
            <span>我的暗标 <b>${myBids}</b></span>
            <span title="当前现金够拍下的原石数量（可拍 = 现金 ≥ 料子底价）">现金可拍 <b>${affordable}/${roughs.length}</b></span>
            <span>开窗费 <b>${Math.round((hall.windowRate ?? 0.06) * 100)}%</b></span>
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
  const fee = Math.round(rough.price * (hall?.windowRate ?? 0.06));
  const canWin = canOpenWindow(rough.id);
  return `
    <article class="rough-card ${rough.price > me.cash ? "locked" : ""}">
      ${auctionStoneBoard(rough)}
      <div class="lot-info">
        <div class="lot-title-row">
          <h3 class="lot-name">${escapeHtml(rough.name)}</h3>
          <button class="lot-window-btn secondary" data-action="startWindow" data-payload="${escapeHtml(rough.id)}" ${canWin ? "" : "disabled"} title="开窗费 ${formatMoney(fee)}">开窗</button>
        </div>
        <p class="lot-weight">重量 ${rough.mass}kg</p>
        <div class="lot-prices">
          <div class="lot-price">
            <span>起拍价</span>
            <strong>${formatMoney(rough.price)}</strong>
          </div>
          <div class="lot-price ${bid ? "is-bid" : ""}">
            <span>当前出价</span>
            <strong>${bid ? formatMoney(bid.amount) : "未出价"}</strong>
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
  elsRef.auctionHistoryBrief.innerHTML = `
    <span>历史场次 ${entries.length}</span>
    <span>开标料子 ${totalLots}</span>
    <span>我的中标 ${myWins}</span>
  `;
  elsRef.auctionHistoryList.innerHTML = entries.map((entry) => `
    <section class="auction-result-board auction-history-card">
      <div class="panel-head">
        <h3>${escapeHtml(entry.hallLabel || "公盘")}</h3>
        <span>${formatHistoryTime(entry.settledAt)} 开标</span>
      </div>
      <div class="auction-result-list">
        ${(entry.results || []).map((result) => auctionResultRow(result)).join("")}
      </div>
    </section>
  `).join("") || empty("暂无历史拍卖成功记录。");
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
export function renderAuction() {
  const { me } = getState();
  const auction = getState().auction;
  const roughs = auction?.roughs || [];
  const affordable = roughs.filter((rough) => rough.price <= me.cash).length;
  const opened = roughs.reduce((sum, rough) => sum + windowCount(rough), 0);
  const phaseMeta = auctionPhaseMeta(auction);
  const phaseLabel = phaseMeta.label;
  const canRequestWindow = currentAuctionPhase(auction) === "live";
  const selectedHall = selectedAuctionHall();
  renderAuctionHalls();
  elsRef.auctionBrief.innerHTML = `
    <section class="auction-round-hero">
      <div class="auction-round-main">
        <span class="auction-round-label">${phaseMeta.clock}</span>
        <strong class="auction-round-clock">${formatDuration(phaseMeta.remain)}</strong>
        <small>今日${auctionRoundLabel()}</small>
      </div>
      <button class="auction-history-btn" data-action="openHallHistory" type="button">历史拍卖</button>
    </section>
  `;
  if (!selectedHall) {
    elsRef.roughPool.innerHTML = "";
    updateAuctionChrome();
    return;
  }
  const hallStatus = selectedHall.id !== auction?.hallId
    ? "本轮未开放"
    : auction?.entered
      ? "已入场"
      : "入场处理中";
  const enteredHere = auction?.entered && selectedHall.id === auction?.hallId;
  let pageBody = "";
  if (selectedHall.id !== auction?.hallId) {
    pageBody = empty("这个公盘当前场次未开放，请返回选择正在进行的公盘。");
  } else if (!auction?.entered) {
    pageBody = empty("正在确认入场，成功后会显示本场料子。");
  } else if (!roughs.length) {
    pageBody = empty("本场料子正在整理。");
  } else {
    pageBody = `
      <div class="auction-lot-grid">
        ${roughs.map((rough) => renderAuctionLotCard(rough, canRequestWindow)).join("")}
      </div>
    `;
  }
  elsRef.roughPool.innerHTML = pageBody;
  updateAuctionChrome();
}

export function updateAuctionChrome() {
  if (getActiveView() !== "auction") return;
  const hall = selectedAuctionHall();
  const inHall = Boolean(hall);
  if (inHall) {
    const entered = getState().auction?.entered && hall.id === getState().auction?.hallId;
    if (elsRef.auctionHeadTitle) elsRef.auctionHeadTitle.textContent = hall.label;
    if (elsRef.auctionHeadDesc) elsRef.auctionHeadDesc.textContent = entered ? "已入场" : "入场中";
  } else {
    if (elsRef.auctionHeadTitle) elsRef.auctionHeadTitle.textContent = "公盘会场";
    if (elsRef.auctionHeadDesc) elsRef.auctionHeadDesc.textContent = "10 分钟暗拍";
  }
}

export function jadeIconSvg() {
  return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path d="M12 2C7 6 5 10 5 14a7 7 0 0 0 14 0c0-4-2-8-7-12z" fill="#1f9b72" opacity="0.92"/>
    <path d="M9 13c1 2 2 3 4 4" stroke="#e7f6ef" stroke-width="1.4" fill="none" stroke-linecap="round"/>
  </svg>`;
}
