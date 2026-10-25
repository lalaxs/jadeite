import { LIVESTREAM_MAX_ITEMS as MAX_ROOM_ITEMS } from "../../livestream-rules.js";
import { formatRelativeMinutes, formatSaleAgo } from "./catalog.js";

export function createLivestreamOwnerView({ ui, helpers, ports }) {
  const { escapeHtml } = helpers;
  const { hostSubtitle, stockPickerMarkup, hostLiveChips, shelfMarkup, roomHeroMarkup } = ports;

function recentSalesMarkup(room) {
  const sales = (room.sales || []).slice(0, 20);
  if (!sales.length) {
    return `<div class="livestream-recent-sales is-empty">本场还没有成交，AI 翠友会陆续进店。</div>`;
  }
  return `
    <div class="livestream-recent-sales" aria-label="最近成交">
      ${sales.map((sale) => `
        <div>
          <span class="livestream-history-dot"></span>
          <strong>${escapeHtml(sale.productName || "翡翠成品")}</strong>
          <span>${escapeHtml(sale.buyerName || (sale.buyerType === "ai" ? "AI翠友" : "翠友"))}</span>
          <em>${escapeHtml(formatSaleAgo(sale.soldAt))}</em>
        </div>
      `).join("")}
    </div>
  `;
}

function replenishModalMarkup(products, capacity) {
  return `
    <div class="jm-modal-root livestream-replenish-modal-root" role="dialog" aria-modal="true" aria-label="继续补货">
      <div class="jm-modal jm-modal-wide livestream-replenish-modal">
        <div class="jm-modal-head">
          <h3>继续补货</h3>
          <button class="jm-modal-x" type="button" data-livestream-action="close-replenish-modal" aria-label="关闭">×</button>
        </div>
        <div class="jm-modal-body">
          ${stockPickerMarkup(products, { mode: "replenish", capacity })}
        </div>
      </div>
    </div>
  `;
}

function closeConfirmModalMarkup() {
  return `
    <div class="jm-modal-root livestream-close-modal-root" role="dialog" aria-modal="true" aria-label="确认关播">
      <div class="jm-modal livestream-close-modal">
        <div class="jm-modal-head">
          <h3>关闭直播</h3>
          <button class="jm-modal-x" type="button" data-livestream-action="cancel-close" aria-label="关闭">×</button>
        </div>
        <div class="jm-modal-body">
          <p class="livestream-close-modal-copy">确定关闭直播间吗？未售出的成品会退回库存，主播也会被释放。</p>
        </div>
        <div class="jm-modal-foot">
          <button class="jm-btn-ghost" type="button" data-livestream-action="cancel-close">取消</button>
          <button class="danger" type="button" data-livestream-action="confirm-close">确认关闭</button>
        </div>
      </div>
    </div>
  `;
}

function ownerDashboardMarkup(room, products, capacity) {
  const saleCount = Number(room.totalSales ?? room.sales?.length ?? 0);
  const stockCount = Number(room.stockCount ?? room.items?.length ?? 0);
  const listedTotal = Math.max(stockCount + saleCount, saleCount);
  const progressPct = listedTotal > 0 ? Math.min(100, Math.round((saleCount / listedTotal) * 100)) : 0;
  const hostLine = hostSubtitle(room);
  const visitHint = room.nextAiVisitAt
    ? formatRelativeMinutes(room.nextAiVisitAt)
    : "";
  const remainingHint = room.endsAt
    ? formatRelativeMinutes(room.endsAt, Date.now(), "即将结束")
    : "";
  return `
    <article class="livestream-room-card is-mine is-owner-dash" data-room-id="${escapeHtml(room.id)}">
      <header class="livestream-room-head">
        <div>
          <span class="livestream-live-badge"><i></i> LIVE</span>
          <div>
            <h3>${escapeHtml(room.ownerName)}的翡翠直播间</h3>
            <p>${hostLine ? `${escapeHtml(hostLine)} · 离线也会继续营业` : "我的直播间 · 离线也会继续营业"}</p>
            ${hostLiveChips(room.host, { collapsed: true })}
          </div>
        </div>
        <dl class="livestream-room-metrics">
          <div><dt>点赞</dt><dd>♥ ${Number(room.likes || 0).toLocaleString("zh-CN")}</dd></div>
          <div><dt>在售</dt><dd>${stockCount} 件</dd></div>
          <div><dt>已售</dt><dd>${saleCount} 件</dd></div>
        </dl>
      </header>
      <div class="livestream-owner-grid">
        <div class="livestream-room-stage is-compact" data-livestream-stage>
          ${roomHeroMarkup(room, true)}
        </div>
        <aside class="livestream-owner-ops">
          ${visitHint ? `<div class="livestream-owner-stat"><span>下一波客流</span><strong>${escapeHtml(visitHint)}</strong></div>` : ""}
          ${remainingHint ? `<div class="livestream-owner-stat"><span>剩余时段</span><strong>${escapeHtml(remainingHint)}</strong></div>` : ""}
          <div class="livestream-sell-progress" aria-label="售罄进度">
            <div class="livestream-sell-progress-head">
              <span>售罄进度</span>
              <span>${saleCount}/${listedTotal || saleCount}</span>
            </div>
            <div class="livestream-sell-progress-bar"><i style="width:${progressPct}%"></i></div>
          </div>
          <div class="livestream-recent-host">
            <p class="livestream-ops-label">最近成交</p>
            ${recentSalesMarkup(room)}
          </div>
          <div class="livestream-owner-shelf-host" data-livestream-shelf-host>
            ${shelfMarkup(room)}
          </div>
        </aside>
      </div>
      <footer class="livestream-owner-bar">
        <div class="livestream-owner-actions">
          ${capacity > 0
            ? `<button type="button" class="ghost" data-livestream-action="open-replenish-modal">补货</button>`
            : `<span>货盘已满（${MAX_ROOM_ITEMS} 件）</span>`}
          <button class="danger ghost" type="button" data-livestream-action="close">关闭直播</button>
        </div>
      </footer>
    </article>
    ${capacity > 0 && ui.replenishOpen ? replenishModalMarkup(products, capacity) : ""}
    ${ui.closeConfirmOpen ? closeConfirmModalMarkup() : ""}
  `;
}

  return { recentSalesMarkup, replenishModalMarkup, closeConfirmModalMarkup, ownerDashboardMarkup };
}
