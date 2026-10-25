import { LIVESTREAM_BASE_DURATION_MS, LIVESTREAM_MAX_DURATION_MS } from "../../livestream-rules.js";
import { livestreamSkillLevel } from "../../livestream-host-bonuses.js";

export const BASE_DURATION_MINUTES = Math.round(LIVESTREAM_BASE_DURATION_MS / 60_000);

export const MAX_DURATION_MINUTES = Math.round(LIVESTREAM_MAX_DURATION_MS / 60_000);

export const CAROUSEL_INTERVAL_MS = 4_000;

export const HALL_SORTS = [
  { id: "newest", label: "最新开播" },
  { id: "stock", label: "在售最多" },
  { id: "sales", label: "成交最热" },
  { id: "likes", label: "点赞" }
];

export const PRESET_COMMENTS = [
  "这件水头看着真舒服",
  "掌柜，能再转一圈看看吗",
  "这个颜色很正，蹲个有缘人",
  "刚进来就看到好货",
  "实物应该更润吧",
  "价格合适我就下手了",
  "还有没有同料的成品",
  "这件做工很细，点赞了",
  "先收藏直播间，慢慢挑",
  "AI翠友：这件我关注很久了"
];

export const CHAT_NICKS = ["阿凯", "小满", "路过翠友", "藏家老周", "新手小叶", "翠友阿杰", "逛摊的", "AI翠友"];

export const CHAT_FEED_MAX = 40;

export const CHAT_PIN_THRESHOLD_PX = 28;

export const CHAT_TICK_MIN_MS = 7_000;

export const CHAT_TICK_MAX_MS = 13_000;

export function requestId(prefix) {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function priceRatioTier(price, value) {
  const ratio = Number(price) / Math.max(1, Number(value) || 1);
  if (ratio < 0.95) return "low";
  if (ratio > 1.1) return "high";
  return "fair";
}

export function tierMeta(tier) {
  if (tier === "low") return { label: "偏低", className: "is-low" };
  if (tier === "high") return { label: "偏高", className: "is-high" };
  return { label: "持平", className: "is-fair" };
}

export function aiDemandMeta(price, value) {
  const ratio = Number(price) / Math.max(1, Number(value) || 1);
  const className = tierMeta(priceRatioTier(price, value)).className;
  if (ratio > 1.25) return { label: "仅等玩家", className, ratio };
  if (ratio > 1.15) return { label: "限量溢价客", className, ratio };
  if (ratio > 1.1) return { label: "偏慢", className, ratio };
  if (ratio < 0.95) return { label: "好卖", className, ratio };
  return { label: "正常", className, ratio };
}

export function parsePresetComment(raw, seed) {
  const text = String(raw || "");
  const sep = text.indexOf("：");
  if (sep > 0 && sep < 10) {
    return { name: text.slice(0, sep), text: text.slice(sep + 1) };
  }
  return {
    name: CHAT_NICKS[Math.abs(seed) % CHAT_NICKS.length],
    text
  };
}

export function skillLevel(worker, key) {
  return livestreamSkillLevel(worker, key);
}

export function formatRelativeMinutes(targetAt, now = Date.now(), expiredLabel = "即将到访") {
  const ms = Number(targetAt) - now;
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return expiredLabel;
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  return `约 ${mins} 分`;
}

export function formatSaleAgo(soldAt, now = Date.now()) {
  const ms = Math.max(0, now - Number(soldAt || now));
  if (ms < 60_000) return "刚刚";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分前`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} 小时前`;
  return `${Math.floor(ms / 86_400_000)} 天前`;
}

export function sortHallRooms(roomList, sortId = "newest") {
  const list = [...(roomList || [])];
  const stock = (room) => Number(room.stockCount ?? room.items?.length ?? 0);
  const sales = (room) => Number(room.totalSales ?? room.sales?.length ?? 0);
  const likes = (room) => Number(room.likes || 0);
  if (sortId === "stock") list.sort((a, b) => stock(b) - stock(a) || likes(b) - likes(a));
  else if (sortId === "sales") list.sort((a, b) => sales(b) - sales(a) || likes(b) - likes(a));
  else if (sortId === "likes") list.sort((a, b) => likes(b) - likes(a) || sales(b) - sales(a));
  else list.sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0));
  return list;
}

export function trimLivestreamSelection(selection, capacity) {
  const limit = Math.max(0, Math.floor(Number(capacity) || 0));
  for (const productId of [...selection].slice(limit)) selection.delete(productId);
  return selection;
}
