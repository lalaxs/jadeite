// ranking-module.js — 从 main.js 解耦（依赖注入模式）
// state→getState()、els→elsRef、socket→socketRef，共享 helper 经 deps.helpers 注入。
// 后端 server.js 不受影响。

let socketRef, getState, elsRef, getActiveView;
let activeRankBoard = "rep";
const rankBoardDefinitions = [
  {
    id: "rep",
    label: "声望榜",
    value: (player) => Math.round(Number(player.rep || 0)),
    format: (value) => `${formatNumber(value)} 声望`
  },
  {
    id: "cash",
    label: "现金榜",
    value: (player) => Number(player.cash || 0),
    format: (value) => formatMoney(value)
  },
  {
    id: "collection",
    label: "藏品榜",
    value: (player) => Number(player.collectionPower || player.collectionCount || 0),
    format: (value) => `${formatNumber(value)} 门面`
  },
  {
    id: "inventory",
    label: "库存榜",
    value: (player) => Number(player.inventoryCount || 0),
    format: (value) => `${formatNumber(value)} 件`
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
}

// ---- 调试面板（开发用）：直接加现金 / 加声望 ----
function bindDebugPanel() {
  const cashBtn = document.querySelector('[data-debug="cash"]');
  const repBtn = document.querySelector('[data-debug="rep"]');
  const cashInput = document.querySelector("#debugCashInput");
  const repInput = document.querySelector("#debugRepInput");
  if (cashBtn && cashInput) {
    cashBtn.addEventListener("click", () => {
      const cash = Number(cashInput.value) || 0;
      if (socketRef) socketRef.emit("debugGrant", { cash, rep: 0 });
    });
  }
  if (repBtn && repInput) {
    repBtn.addEventListener("click", () => {
      const rep = Number(repInput.value) || 0;
      if (socketRef) socketRef.emit("debugGrant", { cash: 0, rep });
    });
  }
}

// ---- 以下函数原定义于 main.js ----

export function rankBoardById(boardId) {
  return rankBoardDefinitions.find((board) => board.id === boardId) || rankBoardDefinitions[0];
}

export function rankingRowsFor(board) {
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

export function renderRankingBoard() {
  if (!elsRef.rankingList || !getState()?.me) return;
  const board = rankBoardById(activeRankBoard);
  activeRankBoard = board.id;
  const rows = rankingRowsFor(board);
  if (elsRef.rankingTitle) elsRef.rankingTitle.textContent = board.label;
  if (elsRef.rankingTabs) {
    elsRef.rankingTabs.innerHTML = rankBoardDefinitions.map((item) => `
      <button class="${item.id === activeRankBoard ? "active" : ""}" data-action="selectRankBoard" data-rank-board="${escapeHtml(item.id)}" type="button">${escapeHtml(item.label)}</button>
    `).join("");
  }
  elsRef.rankingList.innerHTML = rows.map((row) => `
    <div class="ranking-row ${row.mine ? "mine" : ""}">
      <span class="ranking-place">#${row.rank}</span>
      <span class="ranking-player"><strong>${escapeHtml(row.player.name)}</strong><em>${row.mine ? "我的排行" : "同行"}</em></span>
      <span class="ranking-score">${escapeHtml(board.format(row.score))}</span>
    </div>
  `).join("");
}

// ---- dispatch 动作封装（原 main.js 内联分支迁入）----
export function rankingOpenBoard(target) {
  openRankBoard(target.dataset.rankBoard || activeRankBoard);
}
export function rankingSelectBoard(target) {
  activeRankBoard = rankBoardById(target.dataset.rankBoard).id;
  renderRankingBoard();
}
