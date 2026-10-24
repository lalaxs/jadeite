// Shell format / clock / text helpers (moved from main.js)

export let getNowMs = () => Date.now();
export let getState = () => null;

export function bindFormatDeps(deps = {}) {
  if (typeof deps.getNowMs === "function") getNowMs = deps.getNowMs;
  if (typeof deps.getState === "function") getState = deps.getState;
}

export function clampClient(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function formatMoney(value) {
  return `¥${Number(value || 0).toLocaleString("zh-CN")}`;
}

/** 顶栏现金紧凑显示：≥1万用万，≥1亿用亿；别处仍用 formatMoney */
export function formatMoneyCompact(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return formatMoney(0);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs < 10_000) {
    return `${sign}¥${Math.round(abs).toLocaleString("zh-CN")}`;
  }
  const trim = (num, digits) => {
    const fixed = Number(num).toFixed(digits);
    return fixed.replace(/\.?0+$/, "");
  };
  if (abs < 100_000_000) {
    return `${sign}¥${trim(abs / 10_000, 1)}万`;
  }
  return `${sign}¥${trim(abs / 100_000_000, 2)}亿`;
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

export function nowMs() {
  return getNowMs();
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (value) => String(value).padStart(2, "0");
  return hours ? `${two(hours)}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

export function gameClock() {
  const state = getState();
  const dayLength = Number(state?.timing?.day || 20 * 60 * 1000);
  const startedAt = Number(state?.worldStartedAt || state?.auction?.startsAt || nowMs());
  const elapsed = Math.max(0, nowMs() - startedAt);
  const day = Math.floor(elapsed / dayLength) + 1;
  const dayProgress = elapsed % dayLength;
  const gameMinutes = Math.floor(dayProgress / dayLength * 24 * 60);
  const hour = Math.floor(gameMinutes / 60);
  const minute = gameMinutes % 60;
  return `第 ${day} 天 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// 把游戏时钟拆成「天数 / 时间」两个独立值，供顶栏 HUD 分两段显示（不上下堆叠）
export function gameClockParts() {
  const state = getState();
  const dayLength = Number(state?.timing?.day || 20 * 60 * 1000);
  const startedAt = Number(state?.worldStartedAt || state?.auction?.startsAt || nowMs());
  const elapsed = Math.max(0, nowMs() - startedAt);
  const day = Math.floor(elapsed / dayLength) + 1;
  const dayProgress = elapsed % dayLength;
  const gameMinutes = Math.floor(dayProgress / dayLength * 24 * 60);
  const hour = Math.floor(gameMinutes / 60);
  const minute = gameMinutes % 60;
  return { day, time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}

export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}


export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

export function empty(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

export function signedMoney(value) {
  const amount = Number(value || 0);
  const sign = amount >= 0 ? "+" : "-";
  return `${sign}${formatMoney(Math.abs(amount))}`;
}

export function uiText(payload) {
  if (typeof payload === "string") return payload;
  return String(payload?.text || payload?.message || payload?.title || "");
}
