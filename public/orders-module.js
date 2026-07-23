// orders-module.js — 从 main.js 解耦（依赖注入模式）
// state→getState()、els→elsRef、socket→socketRef，共享 helper 经 deps.helpers 注入。
// 后端 server.js 不受影响。

let socketRef, getState, elsRef, getActiveView;

let finishedProducts, matchingBracelets, productMatchesOrder, productName, productCanvas, formatMoney, escapeHtml, empty, routeRecommendation, liveSaleRange, productOrderFitReasons, button, viewButton;

export function initOrdersModule(deps) {
  socketRef = deps.socket;
  getState = deps.getState;
  elsRef = deps.els;
  getActiveView = deps.getActiveView;
  ({ finishedProducts, matchingBracelets, productMatchesOrder, productName, productCanvas, formatMoney, escapeHtml, empty, routeRecommendation, liveSaleRange, productOrderFitReasons, button, viewButton } = deps.helpers);
}

// ---- 以下函数原定义于 main.js ----

export function selectedByDefault(order, bracelet) {
  const candidates = matchingBracelets(order).slice(0, order.quantity).map((item) => item.id);
  return candidates.includes(bracelet.id) ? "selected" : "";
}

export function orderFitList(order, candidates) {
  if (!candidates.length) return `<div class="fit-list muted">暂无完全匹配的成品。</div>`;
  return `
    <div class="fit-list">
      ${candidates.slice(0, 3).map((product) => `
        <div>
          <strong>${escapeHtml(product.name)}</strong>
          <span>${productOrderFitReasons(product, order).map(escapeHtml).join(" · ")}</span>
        </div>
      `).join("")}
    </div>
  `;
}

export function salesRouteMeta(item) {
  const route = routeRecommendation(item, getState().me.orders, getState().me.rep);
  const range = liveSaleRange(item, getState().me.rep);
  return `
    <div class="route-meta ${route.route}">
      <strong>${escapeHtml(route.label)}</strong>
      <span>${escapeHtml(route.detail)} · 直播 ${formatMoney(range.low)}-${formatMoney(range.high)}</span>
    </div>
  `;
}

export function braceletRow(item) {
  const route = salesRouteMeta(item);
  return `
    <div class="item-row product-row">
      ${productCanvas(item)}
      <div>
        <div class="item-title"><span>${escapeHtml(item.name)}</span><span class="pill">${formatMoney(item.value)}</span></div>
        <p class="item-meta">${escapeHtml(productName(item))} · ${escapeHtml(item.quality)} · 收藏声望 ${item.rep}</p>
        ${route}
        <div class="row-actions">
          ${button("收藏", "collectBracelet", item.id)}
          ${viewButton("去直播", "livestream", "secondary")}
        </div>
      </div>
    </div>
  `;
}

export function renderOrders() {
  const bracelets = finishedProducts();
  const completable = getState().me.orders.filter((order) => matchingBracelets(order).length >= order.quantity).length;
  elsRef.orderBrief.innerHTML = `<span>可完成 ${completable}/${getState().me.orders.length}</span><span>成品库存 ${bracelets.length}</span><span>满意度 ${Math.round(getState().me.satisfaction)}%</span>`;
  elsRef.orders.innerHTML = getState().me.orders.map((order) => {
    const options = bracelets.map((bracelet) => {
      const matched = productMatchesOrder(bracelet, order);
      return `<option value="${bracelet.id}" ${selectedByDefault(order, bracelet)} ${matched ? "" : "disabled"}>${escapeHtml(bracelet.name)} · ${bracelet.quality}${matched ? "" : " · 不匹配"}</option>`;
    }).join("");
    const candidates = matchingBracelets(order);
    const selects = Array.from({ length: order.quantity }, (_, index) => `
      <select data-order-select="${order.id}" data-slot="${index}">
        <option value="">选择成品</option>${options}
      </select>
    `).join("");
    const minutes = Math.max(0, Math.ceil((order.expiresAt - Date.now()) / 60000));
    return `
      <article class="order-card">
        <div>
          <h3>${escapeHtml(order.client)}</h3>
          <p class="card-meta">${escapeHtml(order.urgency)} · 剩余 ${minutes} 分钟</p>
          <p>${escapeHtml(order.taste)}</p>
          <p class="card-meta">要求 ${order.quantity} 件 · 至少 ${escapeHtml(order.minQuality)} · 匹配 ${candidates.length} 件</p>
          ${orderFitList(order, candidates)}
        </div>
        <div>
          <div class="price">${formatMoney(order.pay)}</div>
          <p class="card-meta">完成声望 +${order.rep}</p>
          <div class="card-actions order-selects">${selects}</div>
          <div class="card-actions"><button data-action="completeOrder" data-payload="${order.id}" ${candidates.length < order.quantity ? "disabled" : ""}>交付订单</button></div>
        </div>
      </article>
    `;
  }).join("") || empty("当前没有订单。");
}

// ---- dispatch 动作封装（原 main.js 内联分支迁入）----
export function ordersComplete(target, payload) {
  const values = [...document.querySelectorAll(`[data-order-select="${CSS.escape(payload)}"]`)]
    .map((select) => select.value)
    .filter(Boolean);
  socketRef.emit("completeOrder", { orderId: payload, braceletIds: values });
}
