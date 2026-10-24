/**
 * Livestream settle modal event builder — isomorphic (server + client).
 * Pure data: no DOM. Keeps ui:event shape stable for clients.
 */

export function formatLivestreamDuration(ms) {
  const totalSec = Math.max(0, Math.round(Number(ms) / 1000) || 0);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
  return `${seconds} 秒`;
}

/**
 * Build a game-modal ui:event from a livestream settle report.
 * Mirrors auction settle card: title / body / lines / stats / ack action.
 */
export function buildLivestreamSettleModalEvent(report, formatMoneyFn = (n) => String(n)) {
  const roomId = String(report?.roomId || "");
  const playerId = String(report?.playerId || "");
  const id = `livestream-settle:${playerId}:${roomId}`;
  const items = Array.isArray(report?.items) ? report.items : [];
  const soldCount = Math.max(0, Math.round(Number(report?.soldCount ?? items.length) || 0));
  const returnedCount = Math.max(0, Math.round(Number(report?.returnedCount) || 0));
  const reason = ["sold_out", "timeout"].includes(report?.reason) ? report.reason : "manual";
  const durationLabel = formatLivestreamDuration(report?.durationMs);
  const hostName = String(report?.hostName || "");

  const body = [];
  if (soldCount > 0) {
    body.push(`本场共卖出 ${soldCount} 件成品。`);
  } else {
    body.push("本场暂无成交。");
  }
  if (returnedCount > 0) {
    body.push(`${returnedCount} 件未售成品已退回库存。`);
  } else if (reason === "sold_out") {
    body.push("货盘已售罄，直播间自动关闭。");
  } else if (reason === "timeout") {
    body.push("本场直播时段已结束。");
  }

  const lines = items.slice(0, 20).map((item) => {
    const name = item.productName || "翡翠成品";
    const qty = Math.max(1, Math.round(Number(item.quantity) || 1));
    const buyer = item.buyerName || "翠友";
    return `${name} ×${qty} · 买家 ${buyer}`;
  });
  if (items.length > 20) lines.push(`……另有 ${items.length - 20} 笔成交`);

  return {
    id,
    type: "modal",
    tone: soldCount > 0 ? "success" : "info",
    title: "直播已结束",
    subtitle: reason === "sold_out"
      ? (hostName ? `${hostName} · 售罄关播` : "售罄自动关播")
      : reason === "timeout"
        ? (hostName ? `${hostName} · 到时关播` : "直播时段结束")
        : (hostName ? `${hostName} · 手动关播` : "本场直播结算"),
    body,
    lines,
    stats: [
      { label: "成交", value: `${soldCount} 件` },
      { label: "用时", value: durationLabel }
    ],
    confirmText: "知道了",
    actions: [
      { label: "知道了", clientAction: "ackLivestreamSettle" }
    ],
    modalClass: "livestream-settle-modal",
    report
  };
}
