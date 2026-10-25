

export function createLivestreamHallView({ getState, ui, helpers, ports }) {
  const { escapeHtml } = helpers;
  const { roomForId, roomHeroMarkup } = ports;

function visitorRoomCardMarkup(room) {
  const saleCount = Number(room.totalSales ?? room.sales?.length ?? 0);
  const mine = room.ownerId === getState()?.me?.id;
  return `
    <article class="livestream-room-card is-hall-card ${mine ? "is-mine" : ""}"
      data-room-id="${escapeHtml(room.id)}"
      data-livestream-action="enter-hall-room"
      data-owner-id="${escapeHtml(room.ownerId || "")}"
      role="button"
      tabindex="0"
      aria-label="${escapeHtml(mine ? "进入我的直播间" : `进入${room.ownerName || "玩家"}的直播间`)}">
      <header class="livestream-room-head">
        <div class="livestream-room-head-main">
          <h3>${escapeHtml(room.ownerName)}的直播间${mine ? "（我的）" : ""}</h3>
        </div>
        <dl class="livestream-room-metrics">
          <div><dt>点赞</dt><dd>♥ ${Number(room.likes || 0).toLocaleString("zh-CN")}</dd></div>
          <div><dt>在售</dt><dd>${room.stockCount || room.items.length} 件</dd></div>
          <div><dt>已售</dt><dd>${saleCount} 件</dd></div>
        </dl>
      </header>
      <div class="livestream-room-stage" data-livestream-stage>
        ${roomHeroMarkup(room, mine, { showChat: false, showFooter: false, showShelf: false })}
      </div>
    </article>
  `;
}

function visitorWatchMarkup(room) {
  const saleCount = Number(room.totalSales ?? room.sales?.length ?? 0);
  return `
    <section class="livestream-watch-section">
      <article class="livestream-room-card is-visitor-watch" data-room-id="${escapeHtml(room.id)}">
        <header class="livestream-room-head">
          <div class="livestream-room-head-main">
            <h3>${escapeHtml(room.ownerName)}的翡翠直播间</h3>
          </div>
          <dl class="livestream-room-metrics">
            <div><dt>点赞</dt><dd>♥ ${Number(room.likes || 0).toLocaleString("zh-CN")}</dd></div>
            <div><dt>在售</dt><dd>${room.stockCount || room.items.length} 件</dd></div>
            <div><dt>已售</dt><dd>${saleCount} 件</dd></div>
          </dl>
        </header>
        <div class="livestream-room-stage" data-livestream-stage>
          ${roomHeroMarkup(room, false)}
        </div>
      </article>
    </section>
  `;
}

function tabsMarkup() {
  const onMine = ui.activeLivestreamTab === "mine";
  if (onMine) {
    const liveHint = getState()?.me?.livestreamRoom
      ? `<span class="livestream-nav-hint">售罄自动关闭 · 离线继续营业</span>`
      : "";
    return `
    <div class="livestream-top-nav is-mine-nav">
      <button type="button" class="livestream-back-btn" data-livestream-action="goto-hall-tab">返回</button>
      ${liveHint}
    </div>
    `;
  }
  if (ui.watchingRoomId) {
    const room = roomForId(ui.watchingRoomId);
    const label = room?.ownerName ? `${room.ownerName}的翡翠直播间` : "直播间";
    return `
    <div class="livestream-top-nav is-mine-nav">
      <button type="button" class="livestream-back-btn" data-livestream-action="goto-hall-tab">返回</button>
      <span class="livestream-nav-hint">${escapeHtml(label)}</span>
    </div>
    `;
  }
  return `
    <div class="livestream-top-nav">
      <div class="shop-tabs livestream-tabs" role="tablist" aria-label="直播间分区">
        <button class="shop-tab active"
          type="button" role="tab" aria-selected="true"
          data-livestream-tab="hall">翡翠街</button>
      </div>
    </div>
  `;
}

function mineEntryCardMarkup({ live = false, myRoom = null } = {}) {
  const title = "我的直播";
  const desc = myRoom
    ? `在售 ${Number(myRoom.items?.length || 0)} 件 · 点进来看摊位`
    : "挑选货盘开播，主播可选";
  const cta = myRoom ? "查看摊位" : "点击开播";
  return `
    <button type="button" class="livestream-mine-entry${live ? " is-live" : ""}"
      data-livestream-action="goto-mine-tab"
      aria-label="${myRoom ? "查看我的直播" : "去我的直播开播"}">
      <span class="lme-photo" aria-hidden="true"></span>
      <span class="lme-tint" aria-hidden="true"></span>
      <span class="lme-shade" aria-hidden="true"></span>
      <span class="lme-content">
        <span class="lme-top">
          <span class="lme-title">${title}</span>
          ${live ? '<span class="livestream-tab-live"><i></i>LIVE</span>' : ""}
        </span>
        <span class="lme-desc">${escapeHtml(desc)}</span>
      </span>
      <span class="lme-cta">${cta}<span aria-hidden="true"> →</span></span>
    </button>
  `;
}

  return { visitorRoomCardMarkup, visitorWatchMarkup, tabsMarkup, mineEntryCardMarkup };
}
