// ranking-module.js — 从 main.js 解耦（依赖注入模式）
// state→getState()、els→elsRef、socket→socketRef，共享 helper 经 deps.helpers 注入。
// 后端 server.js 不受影响。
import { isFeatureAvailable } from "../../feature-availability.js";

let socketRef, getState, elsRef, getActiveView;
let activeRankBoard = "rep";
let mineRowObserver = null;
const RANKING_DISPLAY_LIMIT = 100;
const RANKING_OVERFLOW_PLACE = "99+";
const rankBoardDefinitions = [
  {
    id: "rep",
    label: "声望榜",
    scoreLabel: "声望",
    value: (player) => Math.round(Number(player.rep || 0)),
    format: (value) => `${formatNumber(value)} 声望`
  },
  {
    id: "cash",
    label: "现金榜",
    scoreLabel: "现金",
    value: (player) => Number(player.cash || 0),
    format: (value) => formatMoney(value)
  },
  {
    id: "collection",
    label: "藏品榜",
    scoreLabel: "价值",
    value: (player) => Number(player.collectionValue || 0),
    format: (value) => `${formatMoney(value)} 价值`
  }
];

let setView, escapeHtml, formatNumber, formatMoney;

export function initRankingModule(deps) {
  socketRef = deps.socket;
  getState = deps.getState;
  elsRef = deps.els;
  getActiveView = deps.getActiveView;
  ({ setView, escapeHtml, formatNumber, formatMoney } = deps.helpers);
  bindDebugPanel();
  const register = deps.registerAction;
  if (typeof register === "function") {
    register("openRankBoard", ({ target }) => rankingOpenBoard(target));
    register("selectRankBoard", ({ target }) => rankingSelectBoard(target));
    register("scrollToMyRank", () => scrollToMyRank());
    register("debugAddAp", () => emitDebugAddAp());
  }
}

// ---- 调试面板（开发用）：直接加现金 / 声望 / 经营经验 / 客户评级 / 成就积分 / 解锁矿山 ----
function bindDebugPanel() {
  const panel = document.getElementById("debugPanel");
  if (!panel || panel.dataset.debugBound === "1") return;
  const unlockMiningButton = panel.querySelector('[data-debug="unlockMining"]');
  if (unlockMiningButton) unlockMiningButton.hidden = !isFeatureAvailable("mining");
  panel.dataset.debugBound = "1";
  panel.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-debug]");
    if (!btn || !panel.contains(btn) || !socketRef) return;
    const kind = btn.dataset.debug;
    const cashInput = document.querySelector("#debugCashInput");
    const repInput = document.querySelector("#debugRepInput");
    const satInput = document.querySelector("#debugSatInput");
    if (kind === "cash") {
      const cash = Number(cashInput?.value) || 0;
      socketRef.emit("debugGrant", { cash, rep: 0 });
      return;
    }
    if (kind === "rep") {
      const rep = Number(repInput?.value) || 0;
      socketRef.emit("debugGrant", { cash: 0, rep });
      return;
    }
    if (kind === "satisfaction") {
      socketRef.emit("debugGrant", { satisfaction: Number(satInput?.value) });
      return;
    }
    if (kind === "clearRating") {
      socketRef.emit("debugGrant", { clearRating: true });
      return;
    }
    if (kind === "exp") {
      socketRef.emit("debugGrant", { exp: 100 });
      return;
    }
    if (kind === "unlockMining") {
      if (!isFeatureAvailable("mining")) return;
      socketRef.emit("debugGrant", { unlockMining: true });
      return;
    }
    if (kind === "spawnFinished") {
      socketRef.emit("debugSpawnFinished", { count: 50 });
    }
  });
}

function emitDebugAddAp() {
  if (!socketRef) return;
  socketRef.emit("debugGrant", { ap: 10, achievementPoints: 10 });
}

// ---- 以下函数原定义于 main.js ----

export function rankBoardById(boardId) {
  return rankBoardDefinitions.find((board) => board.id === boardId) || rankBoardDefinitions[0];
}

export function rankingRowsFor(board) {
  const state = getState();
  if (Array.isArray(state?.rankings?.[board.id])) {
    const rows = new Map(state.rankings[board.id].map((row) => [row.player.id, row]));
    const self = state.rankingSelf?.[board.id];
    for (const row of [self?.previous, self?.row]) if (row) rows.set(row.player.id, row);
    return [...rows.values()].sort((a, b) => a.rank - b.rank)
      .map((row) => ({ ...row, mine: row.player.id === state.me?.id }));
  }
  const players = Array.isArray(getState()?.players) ? getState().players : [];
  return [...players]
    .sort((left, right) => Number(board.value(right) || 0) - Number(board.value(left) || 0))
    .map((player, index) => ({
      player,
      rank: index + 1,
      score: Number(board.value(player) || 0),
      mine: player.id === getState()?.me?.id
    }));
}

export function openRankBoard(boardId = activeRankBoard) {
  activeRankBoard = rankBoardById(boardId).id;
  setView("rankings");
  renderRankingBoard();
}

function rankingMineHint(board, rows, mineIndex) {
  if (mineIndex < 0) return "暂未上榜";
  if (mineIndex === 0) return "当前榜首";
  const prev = rows[mineIndex - 1];
  const mine = rows[mineIndex];
  const gap = Math.max(0, Number(prev.score || 0) - Number(mine.score || 0));
  if (gap === 0) return "与上一名数值相同";
  return `距上一名差 ${board.format(gap)}`;
}

function rankingPlaceLabel(rank) {
  return Number(rank) > RANKING_DISPLAY_LIMIT ? RANKING_OVERFLOW_PLACE : String(rank);
}

function rankingRowHtml(board, row) {
  const podiumClass = row.rank <= 3 ? ` is-podium is-rank-${row.rank}` : "";
  return `
    <div class="ranking-row${podiumClass} ${row.mine ? "mine" : ""}" ${row.mine ? 'data-rank-mine="1"' : ""} role="row" aria-label="第 ${escapeHtml(rankingPlaceLabel(row.rank))} 名，${escapeHtml(row.player.name)}，${escapeHtml(board.format(row.score))}">
      <span class="ranking-place" role="cell">#${escapeHtml(rankingPlaceLabel(row.rank))}</span>
      <span class="ranking-player" role="cell">
        <strong>${escapeHtml(row.player.name)}</strong>
      </span>
      <span class="ranking-score" role="cell">${escapeHtml(board.format(row.score))}</span>
    </div>
  `;
}

function ensureRankingTableShell() {
  const board = elsRef.rankingList?.closest(".ranking-board");
  if (!board || !elsRef.rankingList) return null;
  let context = board.querySelector("#rankingContext");
  if (!context) {
    context = document.createElement("section");
    context.id = "rankingContext";
    context.className = "ranking-context";
    context.setAttribute("aria-label", "我的排行概览");
    context.setAttribute("aria-live", "polite");
    context.setAttribute("aria-atomic", "true");
  }
  let head = board.querySelector("#rankingHead");
  if (!head) {
    head = document.createElement("div");
    head.id = "rankingHead";
    head.className = "ranking-head";
    const scroll = elsRef.rankingList.closest(".ranking-board-scroll") || elsRef.rankingList.parentElement;
    board.insertBefore(head, scroll);
  }
  if (!board.contains(context)) board.insertBefore(context, head);
  if (!elsRef.rankingMineBar) {
    let bar = board.querySelector("#rankingMineBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "rankingMineBar";
      bar.className = "ranking-mine-bar";
      board.appendChild(bar);
    }
    elsRef.rankingMineBar = bar;
  } else if (!board.contains(elsRef.rankingMineBar)) {
    board.appendChild(elsRef.rankingMineBar);
  }
  elsRef.rankingHead = head;
  elsRef.rankingContext = context;
  return { context, head, bar: elsRef.rankingMineBar };
}

function disconnectMineObserver() {
  mineRowObserver?.disconnect();
  mineRowObserver = null;
}

function observeMineRowVisibility() {
  disconnectMineObserver();
  const bar = elsRef.rankingMineBar;
  const scrollRoot = elsRef.rankingList?.closest(".ranking-board-scroll");
  const mineRow = elsRef.rankingList?.querySelector(".ranking-row.mine");
  if (!bar || !scrollRoot || !mineRow || typeof IntersectionObserver !== "function") return;

  mineRowObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0.35);
      bar.classList.toggle("is-row-visible", visible);
    },
    { root: scrollRoot, threshold: [0, 0.35, 0.7] }
  );
  mineRowObserver.observe(mineRow);
}

function renderRankingMineBar(board, rows) {
  const bar = elsRef.rankingMineBar;
  if (!bar) return;
  const mineIndex = rows.findIndex((row) => row.mine);
  bar.hidden = false;
  bar.classList.remove("is-row-visible");
  if (mineIndex < 0) {
    bar.innerHTML = `
      <div class="ranking-mine-bar-inner is-empty">
        <span class="ranking-place">#—</span>
        <span class="ranking-player"><strong>我的名次</strong><em>同步中或暂未上榜</em></span>
        <span class="ranking-score">—</span>
      </div>
    `;
    return;
  }
  const mine = rows[mineIndex];
  const hint = rankingMineHint(board, rows, mineIndex);
  const place = rankingPlaceLabel(mine.rank);
  bar.innerHTML = `
    <button class="ranking-mine-bar-inner" data-action="scrollToMyRank" type="button" title="回到我的名次">
      <span class="ranking-place">#${escapeHtml(place)}</span>
      <span class="ranking-player">
        <strong>${escapeHtml(mine.player.name)}</strong>
        <em class="ranking-mine-hint" data-base-hint="${escapeHtml(hint)}">${escapeHtml(hint)}</em>
      </span>
      <span class="ranking-score">${escapeHtml(board.format(mine.score))}</span>
    </button>
  `;
}

function renderRankingContext(board, rows) {
  const context = elsRef.rankingContext;
  if (!context) return;
  const mineIndex = rows.findIndex((row) => row.mine);
  if (mineIndex < 0) {
    context.innerHTML = `
      <div class="ranking-context-copy">
        <span>我的排行</span>
        <strong>正在同步名次</strong>
      </div>
      <div class="ranking-context-stat"><span>参榜掌柜</span><strong>${formatNumber((getState()?.rankingPlayerCount ?? rows.length))}</strong></div>
    `;
    return;
  }
  const mine = rows[mineIndex];
  const hint = rankingMineHint(board, rows, mineIndex);
  context.innerHTML = `
    <div class="ranking-context-copy">
      <span>我的排行 · ${escapeHtml(board.label)}</span>
      <strong>#${escapeHtml(rankingPlaceLabel(mine.rank))}</strong>
      <small>${escapeHtml(hint)}</small>
    </div>
    <div class="ranking-context-stat"><span>当前${escapeHtml(board.scoreLabel)}</span><strong>${escapeHtml(board.format(mine.score))}</strong></div>
    <div class="ranking-context-stat"><span>参榜掌柜</span><strong>${formatNumber((getState()?.rankingPlayerCount ?? rows.length))}</strong></div>
  `;
}

export function scrollToMyRank() {
  const scrollRoot = elsRef.rankingList?.closest(".ranking-board-scroll");
  const mineRow = elsRef.rankingList?.querySelector(".ranking-row.mine");
  if (!scrollRoot || !mineRow) return;
  mineRow.scrollIntoView({ block: "center", behavior: "smooth" });
  mineRow.classList.remove("is-flash");
  void mineRow.offsetWidth;
  mineRow.classList.add("is-flash");
  window.setTimeout(() => mineRow.classList.remove("is-flash"), 1200);
}

export function renderRankingBoard() {
  if (!elsRef.rankingList || !getState()?.me) return;
  const board = rankBoardById(activeRankBoard);
  activeRankBoard = board.id;
  const allRows = rankingRowsFor(board);
  const visibleRows = allRows.filter((row) => row.rank <= RANKING_DISPLAY_LIMIT);
  if (elsRef.rankingTitle) elsRef.rankingTitle.textContent = board.label;
  if (elsRef.rankingTabs) {
    elsRef.rankingTabs.innerHTML = rankBoardDefinitions.map((item) => `
      <button class="${item.id === activeRankBoard ? "active" : ""}" data-action="selectRankBoard" data-rank-board="${escapeHtml(item.id)}" type="button" aria-pressed="${item.id === activeRankBoard}">${escapeHtml(item.label)}</button>
    `).join("");
  }
  const shell = ensureRankingTableShell();
  const scoreLabel = board.scoreLabel || "数值";
  if (shell?.head) {
    shell.head.innerHTML = `
      <span class="ranking-place">排名</span>
      <span class="ranking-player">名称</span>
      <span class="ranking-score">${escapeHtml(scoreLabel)}</span>
    `;
  }
  elsRef.rankingList.innerHTML = visibleRows.length
    ? visibleRows.map((row) => rankingRowHtml(board, row)).join("")
    : `
      <div class="game-empty-state ranking-empty-state">
        <span class="game-empty-state-mark" aria-hidden="true">榜</span>
        <strong>排行榜正在整理</strong>
        <p>有掌柜加入经营后，这里会显示同行名次。</p>
      </div>`;
  renderRankingContext(board, allRows);
  renderRankingMineBar(board, allRows);
  observeMineRowVisibility();
}

// ---- dispatch 动作封装（原 main.js 内联分支迁入）----
export function rankingOpenBoard(target) {
  openRankBoard(target.dataset.rankBoard || activeRankBoard);
}
export function rankingSelectBoard(target) {
  activeRankBoard = rankBoardById(target.dataset.rankBoard).id;
  renderRankingBoard();
}
