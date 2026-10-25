import { hostBonusPreview, talkStyleMeta, livestreamSkillLevel } from "../../livestream-host-bonuses.js";

export function createLivestreamRoomView({ getState, ui, helpers, ports }) {
  const { productCanvas, formatMoney, escapeHtml } = helpers;
  const { itemValue, currentSlideIndex, chatRailMarkup } = ports;

function hostLiveChips(host, { collapsed = false } = {}) {
  if (!host) return "";
  const preview = host.preview || hostBonusPreview(host.bonuses || {});
  const skills = host.skills || {};
  const styleLabel = host.talkStyleLabel || talkStyleMeta(host.talkStyle).label;
  if (collapsed && !ui.hostDetailsOpen) {
    return `
      <div class="livestream-host-chips is-compact">
        <span class="livestream-host-chip is-style">${escapeHtml(styleLabel)}</span>
        <span class="livestream-host-chip is-bonus">转化 +${Number(preview.convertPct) || 0}%</span>
        <button type="button" class="livestream-host-chip is-link" data-livestream-action="toggle-host-details">主播详情</button>
      </div>
    `;
  }
  return `
    <div class="livestream-host-chips">
      <span class="livestream-host-chip is-style">${escapeHtml(styleLabel)}</span>
      <span class="livestream-host-chip">话术 Lv.${livestreamSkillLevel(skills.huashu ?? 1)}</span>
      <span class="livestream-host-chip">控场 Lv.${livestreamSkillLevel(skills.kongchang ?? 1)}</span>
      <span class="livestream-host-chip">催单 Lv.${livestreamSkillLevel(skills.cuidan ?? 1)}</span>
      <span class="livestream-host-chip is-bonus">转化 +${Number(preview.convertPct) || 0}%</span>
      <span class="livestream-host-chip is-bonus">流速 +${Number(preview.trafficPct) || 0}%</span>
      ${collapsed ? `<button type="button" class="livestream-host-chip is-link" data-livestream-action="toggle-host-details">收起</button>` : ""}
    </div>
  `;
}

function shelfMarkup(room) {
  const index = currentSlideIndex(room);
  if (!room.items?.length) return "";
  const itemsKey = room.items.map((item) => `${item.id}:${item.price ?? ""}`).join(",");
  return `
    <div class="livestream-shelf" aria-label="本场货盘">
      <p class="livestream-shelf-label">本场货盘</p>
      <div class="livestream-shelf-scroll" data-livestream-shelf-scroll
        data-room-id="${escapeHtml(room.id)}"
        data-shelf-items="${escapeHtml(itemsKey)}">
        <div class="livestream-shelf-track">
          ${room.items.map((item, itemIndex) => `
            <button type="button"
              class="livestream-shelf-thumb ${itemIndex === index ? "is-current" : ""}"
              data-livestream-action="select-slide"
              data-room-id="${escapeHtml(room.id)}"
              data-slide-index="${itemIndex}"
              aria-label="${escapeHtml(item.product?.name || "成品")}"
              aria-current="${itemIndex === index ? "true" : "false"}">
              <span class="livestream-shelf-art">${productCanvas(item.product)}</span>
              <span class="livestream-shelf-price">${formatMoney(item.price)}</span>
            </button>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function buyConfirmMarkup(room) {
  if (!ui.buyConfirm || ui.buyConfirm.roomId !== room.id) return "";
  const roomItem = room.items?.find((item) => item.id === ui.buyConfirm.itemId);
  if (!roomItem) return "";
  const cash = Number(getState()?.me?.cash || 0);
  const price = Number(roomItem.price || 0);
  const value = itemValue(roomItem.product);
  const enough = cash >= price;
  return `
    <div class="livestream-buy-confirm" role="dialog" aria-label="确认购买">
      <div>
        <strong>确认购买「${escapeHtml(roomItem.product?.name || "翡翠成品")}」？</strong>
        <p>直播价 ${formatMoney(price)} · 估值 ${formatMoney(value)} · ${enough ? "余额足够" : "余额不足"}</p>
      </div>
      <div class="livestream-buy-confirm-actions">
        <button type="button" class="ghost" data-livestream-action="cancel-buy">取消</button>
        <button type="button" data-livestream-action="confirm-buy"
          data-room-id="${escapeHtml(room.id)}"
          data-item-id="${escapeHtml(roomItem.id)}"
          ${enough ? "" : "disabled"}>${enough ? "确认支付" : "余额不足"}</button>
      </div>
    </div>
  `;
}

function roomHeroMarkup(room, mine, { showShelf = !mine, showChat = true, showFooter = true } = {}) {
  const index = currentSlideIndex(room);
  const roomItem = room.items[index];
  if (!roomItem) return `<div class="livestream-soldout">本场商品已经售罄</div>`;
  const itemNumber = `${index + 1}/${room.items.length}`;
  return `
    <div class="livestream-room-carousel">
      <div class="livestream-product-visual">
        ${productCanvas(roomItem.product)}
        <span class="livestream-item-count">${itemNumber}</span>
      </div>
      ${showChat ? chatRailMarkup(room) : ""}
      <button class="livestream-slide-control previous" type="button"
        data-livestream-action="previous" data-room-id="${escapeHtml(room.id)}"
        aria-label="上一件商品">‹</button>
      <button class="livestream-slide-control next" type="button"
        data-livestream-action="next" data-room-id="${escapeHtml(room.id)}"
        aria-label="下一件商品">›</button>
    </div>
    ${showFooter ? `
    <div class="livestream-room-footer">
      <div class="livestream-product-copy">
        <div>
          <p class="livestream-product-kicker">当前讲品 · ${itemNumber}</p>
          <h4>${escapeHtml(roomItem.product.name || "翡翠成品")}</h4>
          <p>参考估值 ${formatMoney(roomItem.product.value || roomItem.product.price || 0)}</p>
        </div>
        <div class="livestream-live-offer">
          <span>直播价</span>
          <strong>${formatMoney(roomItem.price)}</strong>
          ${mine
            ? '<span class="livestream-owner-note">自己的直播商品</span>'
            : `<button type="button" data-livestream-action="buy"
                data-room-id="${escapeHtml(room.id)}"
                data-item-id="${escapeHtml(roomItem.id)}">立即购买</button>`}
        </div>
      </div>
      ${showShelf ? shelfMarkup(room) : ""}
    </div>
    ${mine ? "" : buyConfirmMarkup(room)}
    ` : ""}
  `;
}

  return { hostLiveChips, shelfMarkup, buyConfirmMarkup, roomHeroMarkup };
}
