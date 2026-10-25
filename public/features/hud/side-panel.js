// Side panel reminders / jobs (moved from main.js)

import { formatMoney, formatDuration, nowMs, escapeHtml } from "../../shell/format-utils.js";
import { achievementViewModels } from "../../player-progression.js";
import { isFeatureAvailable } from "../../feature-availability.js";
import { employeePayrollQuote, employeePayrollStatus } from "../../worker-economy.js";
import { KIND_LABELS } from "../../jade-categories.js";
import { setMobileContentPane } from "../../shell/navigation.js";
import { showToast } from "../../shell/toast-fx.js";

let getState = () => null;
let getEls = () => null;
let productionJobsFor = () => [];
let matchingBracelets = () => [];
let workshopJobs = () => [];
let auctionPhaseMeta = () => ({ remain: 0, clock: "" });
let achievementsHtml = () => "";
let renderPlayerSidebar = () => {};
let requestState = () => {};
let sidePanelFilter = "workshop";
let renderedWorkshopDeliveries = null;
let lastWorkshopStateRequestAt = null;
let focusedDeliveryId = null;

export function focusWorkshopDelivery(deliveryId) {
  if (!(getState()?.me?.workshopDeliveries || []).some((delivery) => delivery.id === deliveryId)) return;
  focusedDeliveryId = deliveryId;
  sidePanelFilter = "workshop";
  const els = getEls();
  setMobileContentPane("side");
  els.panelTabs?.querySelectorAll("[data-ptab]").forEach((button) => {
    const selected = button.dataset.ptab === "workshop";
    button.classList.toggle("on", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  renderSidePanel();
  const card = [...(els.sidePanelBody?.querySelectorAll("[data-side-delivery]") || [])]
    .find((node) => node.dataset.sideDelivery === deliveryId);
  card?.scrollIntoView({ block: "center", behavior: "auto" });
  card?.focus({ preventScroll: true });
}

function syncWorkshopNotices(deliveries) {
  if (!globalThis.document?.body) return;
  const host = getEls()?.toast || document.querySelector("#toast");
  if (!host) return;
  const alive = new Set(deliveries.map((delivery) => delivery.id));
  for (const notice of host.querySelectorAll("[data-delivery-notice]")) {
    if (!alive.has(notice.dataset.deliveryNotice)) notice.remove();
  }
  for (const delivery of deliveries) {
    const label = delivery.stage === "finishing" ? "成品" : delivery.stage === "carving" ? "取件产物" : "开料产物";
    const notice = showToast({
      dedupeKey: `workshop-delivery:${delivery.id}`,
      title: `${delivery.items.length} 件${label}待领取`, text: delivery.inputName,
      tone: "success", sticky: true,
      onClick: () => focusWorkshopDelivery(delivery.id)
    });
    if (notice) notice.dataset.deliveryNotice = delivery.id;
  }
}

function sideWorkshopJobs(me) {
  const active = me?.commissions?.active;
  return [...workshopJobs(), ...(active ? [{ id: active.id, type: "commissionJob", commission: true,
    item: { name: active.name }, startedAt: active.startedAt, readyAt: active.readyAt }] : [])];
}

function workshopDeliverySignature(deliveries = []) {
  return JSON.stringify([...(deliveries || [])].sort((a, b) => b.completedAt - a.completedAt).map((delivery) => [
    delivery.id, delivery.stage, delivery.inputName, delivery.workerName,
    Boolean(delivery.revealedAt), delivery.items.length, delivery.auxiliaryItems.length
  ]));
}

function itemStage(item = {}) {
  if (item.materialStage) return item.materialStage;
  if (item.type === "rough") return item.revealed || item.polished ? "opened" : "rough";
  if (item.stage === "material") return "opened";
  if (item.stage === "carved" || item.stage === "polished" || item.stage === "finished") return item.stage;
  if (item.type === "bracelet") return "finished";
  return "unknown";
}

function pendingWorkshopResults(me = {}) {
  return [...(me.materials || []), ...(me.bracelets || [])]
    .filter((item) => item?.seen === false && Number(item.acquiredAt || 0) > 0)
    .filter((item) => Boolean(item.craftScores || item.craftWorkers || item.craftGrade))
    .sort((a, b) => Number(b.acquiredAt || 0) - Number(a.acquiredAt || 0));
}

export function getSidePanelFilter() { return sidePanelFilter; }
export function setSidePanelFilter(v) { sidePanelFilter = v; }

export function bindSidePanelDeps(deps = {}) {
  if (typeof deps.getState === "function") getState = deps.getState;
  if (typeof deps.getEls === "function") getEls = deps.getEls;
  if (typeof deps.productionJobsFor === "function") productionJobsFor = deps.productionJobsFor;
  if (typeof deps.matchingBracelets === "function") matchingBracelets = deps.matchingBracelets;
  if (typeof deps.workshopJobs === "function") workshopJobs = deps.workshopJobs;
  if (typeof deps.auctionPhaseMeta === "function") auctionPhaseMeta = deps.auctionPhaseMeta;
  if (typeof deps.achievementsHtml === "function") achievementsHtml = deps.achievementsHtml;
  if (typeof deps.renderPlayerSidebar === "function") renderPlayerSidebar = deps.renderPlayerSidebar;
  if (typeof deps.requestState === "function") requestState = deps.requestState;
  renderedWorkshopDeliveries = null;
  lastWorkshopStateRequestAt = null;
}

export function reminderRows() {
  const state = getState();

  if (!state?.me) return [];
  const { me } = state;
  const reminders = [];
  const jobs = productionJobsFor(me);
  const workshopResults = pendingWorkshopResults(me);
  const deliveries = me.workshopDeliveries || [];
  const completable = (me.orders || []).filter((order) => matchingBracelets(order).length >= (order.quantity || 1));
  const bmSubmitReady = (state.blackServiceOrders || []).filter((o) => o.isSeller && o.status === "escrow" && o.isFinished);
  const payroll = employeePayrollQuote(me, nowMs());
  const payrollStatus = employeePayrollStatus(me, nowMs());
  if (payrollStatus === "stopped" || payroll.totalDue > 0) {
    reminders.push({
      id: "employee-payroll", title: payrollStatus === "stopped" ? "员工已停工" : payroll.debt > 0 ? "员工欠薪宽限中" : "登录日工资已记账",
      detail: payrollStatus === "stopped" ? `欠薪 ${formatMoney(payroll.debt)}，结清后请主动复工；停工期间不新增工资`
        : payroll.debt > 0 ? `欠薪 ${formatMoney(payroll.debt)}，保留周转金后按经营收入20%补薪；下一个营业日仍未补齐将停工`
        : `下一个登录日应付 ${formatMoney(payroll.totalDue)}；离线日期不计薪`,
      focus: formatMoney(payroll.debt > 0 ? payroll.debt : payroll.totalDue), tone: "action",
      action: { label: "查看工资", payload: "hireMarket" }
    });
  }
  if (me.offlineSummary) {
    reminders.push({
      id: "offline",
      title: "离线结算",
      detail: "离线期间已发生多件事",
      focus: String(me.offlineSummary.count),
      tone: "neutral"
    });
  }
  if (deliveries.length) {
    const latest = [...deliveries].sort((a, b) => b.completedAt - a.completedAt)[0];
    reminders.push({
      id: "workshop-delivery", title: "工坊产物待领取", detail: `${deliveries.length} 批加工已完成，启匣领取新作`,
      focus: String(deliveries.length), tone: "action",
      actions: [{ label: "领取产物", action: "openWorkshopDelivery", payload: latest.id }]
    });
  }
  if (me.commissions?.active) {
    const active = me.commissions.active;
    const ready = Number(active.readyAt) <= nowMs();
    reminders.push({ id: "commission", title: ready ? "来料单可以结算" : "来料加工中",
      detail: `${active.name} · 净报酬 ${formatMoney(active.netPay)}`,
      focus: ready ? "待领取" : formatDuration(Math.max(0, active.readyAt - nowMs())),
      tone: ready ? "action" : "neutral",
      actions: ready ? [{ label: "领取报酬", action: "claimCommission", payload: active.id }] : [] });
  }
  if (workshopResults.length) {
    const latest = workshopResults[0];
    const stage = itemStage(latest);
    const isEscrowResult = Boolean(latest.escrowOrderId || latest.isEscrow);
    const nextLabel = isEscrowResult && stage === "finished"
      ? "去处理委托"
      : stage === "opened"
        ? "继续规划"
        : stage === "carved" || stage === "polished"
          ? "继续精加工"
          : "去匹配订单";
    const nextDestination = isEscrowResult && stage === "finished"
      ? "blackmarket"
      : stage === "finished"
        ? "orders"
        : "workshop";
    reminders.push({
      id: "workshop-result",
      title: isEscrowResult && stage === "finished" ? "委托加工完成" : "加工完成",
      detail: isEscrowResult && stage === "finished"
        ? `${latest.name || "委托产物"}已完成，等待交还委托方`
        : `${latest.name || "新产物"}已入库，等待查看结果`,
      focus: String(workshopResults.length),
      tone: "action",
      actions: [
        { label: "查看结果", action: "routeInventoryItem", payload: `inspect|${latest.id}` },
        { label: nextLabel, action: "routeInventoryItem", payload: `${nextDestination}|${latest.id}` }
      ]
    });
  }
  if (!me.assets?.workshopOwned) {
    reminders.push({
      id: "workshop",
      title: "工坊未开",
      detail: "去商铺买下街角小工坊",
      tone: "action",
      action: { label: "去商铺", payload: "shop" }
    });
  }
  if (!me.assets?.livestreamPermitOwned && (me.bracelets || []).length) {
    reminders.push({
      id: "livestream",
      title: "直播未开",
      detail: "成品可卖，先买直播许可",
      tone: "action",
      action: { label: "去商铺", payload: "shop" }
    });
  }
  if (completable.length) {
    reminders.push({
      id: "orders",
      title: "订单可交付",
      detail: "库存已有符合要求的成品",
      focus: String(completable.length),
      tone: "action",
      action: { label: "去订单", payload: "orders" }
    });
  }
  if (bmSubmitReady.length) {
    reminders.push({
      id: "bm-submit",
      title: "加工单可交",
      detail: "黑市技术单已完成可提交",
      focus: String(bmSubmitReady.length),
      tone: "action",
      action: { label: "去黑市", payload: "blackmarket" }
    });
  }
  if (jobs.length) {
    reminders.push({
      id: "jobs",
      title: "加工中",
      detail: "工坊任务进行中",
      focus: String(jobs.length),
      tone: "neutral",
      action: { label: "去工坊", payload: "workshop" }
    });
  }
  if (me.cash < 1000) {
    reminders.push({
      id: "cash",
      title: "现金紧张",
      detail: "可整理库存，挂牌出售暂不加工的物品，补充周转金",
      tone: "warn",
      action: { label: "查看库存", payload: "inventory" }
    });
  }
  // 公盘时间提醒：开标倒计时实时跟随
  if (state?.auction) {
    const a = auctionPhaseMeta(state.auction);
    reminders.unshift({
      id: "auction-eta",
      title: "公盘开标",
      focusLabel: a.clock || "本场结束",
      focus: formatDuration(a.remain),
      tone: "urgent",
      urgentSoon: a.remain < 60_000,
      live: "auction-eta",
      action: { label: "去公盘", payload: "auction" }
    });
  }
  const mining = isFeatureAvailable("mining") ? (state.mining || {}) : {};
  if (mining.acceptingApplications && mining.playerQualified) {
    const remain = Math.max(0, Number(mining.applicationClosesAt || 0) - nowMs());
    const targetRound = Math.max(1, Number(mining.targetRound) || 1);
    const skippedRounds = Math.max(0, Number(mining.skippedApplicationRounds) || 0);
    const maxSkippedRounds = Math.max(1, Number(mining.maxSkippedApplicationRounds) || 3);
    const applicationDetail = mining.myApplication
      ? skippedRounds > 0
        ? "志愿已保存，本轮分配后连续未报名记录将清零"
        : "志愿已保存，截止前仍可调整"
      : skippedRounds >= maxSkippedRounds - 1
        ? "尚未提交志愿，本轮再缺席将释放竞租席位"
        : skippedRounds > 0
          ? `尚未提交志愿；此前已连续 ${skippedRounds}/${maxSkippedRounds} 轮未报名`
          : "尚未提交志愿，截止后将不参与本轮分配";
    reminders.unshift({
      id: `mining-application-${targetRound}`,
      title: `第 ${targetRound} 轮矿权申请`,
      detail: applicationDetail,
      focusLabel: "申请截止",
      focus: formatDuration(remain),
      tone: mining.myApplication ? "neutral" : "urgent",
      urgentSoon: remain < 30_000,
      live: "mining-application",
      action: { label: mining.myApplication ? "查看志愿" : "去报名", payload: "mining" }
    });
  } else if (mining.playerQualified && Number(mining.skippedApplicationRounds) > 0) {
    const skippedRounds = Math.max(0, Number(mining.skippedApplicationRounds) || 0);
    const maxSkippedRounds = Math.max(1, Number(mining.maxSkippedApplicationRounds) || 3);
    reminders.unshift({
      id: "mining-roster-warning",
      title: "竞租席位参与提醒",
      detail: skippedRounds >= maxSkippedRounds - 1
        ? "下一轮仍未报名将释放席位，并转入候补队尾"
        : "连续未报名达到上限后，席位会让给候补玩家",
      focusLabel: "未报名",
      focus: `${skippedRounds}/${maxSkippedRounds}`,
      tone: skippedRounds >= maxSkippedRounds - 1 ? "urgent" : "warn",
      action: { label: "查看矿区", payload: "mining" }
    });
  }
  return reminders.slice(0, 5);
}

export function reminderCardHtml(item) {
  const tone = item.tone || "neutral";
  const urgentSoon = item.urgentSoon ? " is-urgent-soon" : "";
  const focusAttr = item.live === "auction-eta"
    ? ' data-remind-auction-eta="1"'
    : item.live === "mining-application"
      ? ' data-remind-mining-eta="1"'
      : "";
  const focusBubble = Boolean(item.focusBubble)
    || (!item.focusLabel && /^\d+$/.test(String(item.focus || "")));
  const focusHtml = item.focus
    ? `<span class="side-remind-focus-wrap">
        ${item.focusLabel ? `<span class="side-remind-focus-label">${escapeHtml(item.focusLabel)}</span>` : ""}
        <span class="side-remind-focus${focusBubble ? " is-bubble" : ""}"${focusAttr}>${escapeHtml(item.focus)}</span>
      </span>`
    : "";
  const actions = Array.isArray(item.actions) && item.actions.length
    ? item.actions
    : item.action ? [{ ...item.action, action: "openLocation" }] : [];
  const actionHtml = actions.length
    ? `<div class="side-remind-actions">${actions.map((action) => `
        <button class="side-remind-go" type="button" data-action="${escapeHtml(action.action || "openLocation")}" data-payload="${escapeHtml(action.payload)}">${escapeHtml(action.label)}</button>
      `).join("")}</div>`
    : "";
  const detailHtml = item.detail
    ? `<p class="side-remind-detail">${escapeHtml(item.detail)}</p>`
    : "";
  return `
    <article class="side-remind-card tone-${escapeHtml(tone)}${urgentSoon}" data-remind-id="${escapeHtml(item.id || "")}">
      <div class="side-remind-top">
        <strong class="side-remind-title">${escapeHtml(item.title)}</strong>
        ${focusHtml}
      </div>
      ${detailHtml}
      ${actionHtml}
    </article>
  `;
}

export function applySidePanelFilter() {
  const els = getEls();

  if (!els.sidePanelBody) return;
  els.sidePanelBody.querySelectorAll("[data-pplane]").forEach((p) => {
    p.hidden = sidePanelFilter ? (p.dataset.pplane !== sidePanelFilter) : false;
  });
}

export function renderSidePanel() {
  const state = getState();
  const els = getEls();

  if (!els.sidePanelBody || !state?.me) return;
  const { me } = state;
  const jobs = sideWorkshopJobs(me);
  const bmOrders = (state.blackServiceOrders || []).filter((o) => (
    o.isSeller && (o.status === "pending" || o.status === "escrow")
  ));
  const reminders = reminderRows();
  const readyOrders = (me.orders || []).filter((order) => matchingBracelets(order).length >= (order.quantity || 1));
  const orderTab = els.panelTabs?.querySelector('[data-ptab="order"]');
  if (orderTab) {
    orderTab.innerHTML = `订单${readyOrders.length ? `<span class="workshop-delivery-count">${readyOrders.length}</span>` : ""}`;
    orderTab.setAttribute("aria-label", `订单${readyOrders.length ? `，${readyOrders.length} 单库存已备齐` : ""}`);
  }

  const deliveries = [...(me.workshopDeliveries || [])].sort((a, b) => b.completedAt - a.completedAt);
  if (!deliveries.some((delivery) => delivery.id === focusedDeliveryId)) focusedDeliveryId = null;
  syncWorkshopNotices(deliveries);
  const stageNames = { opening: "开料", carving: "规划取件", finishing: "精加工" };
  const deliveryHtml = deliveries.map((delivery) => `<article class="side-workshop-delivery${focusedDeliveryId === delivery.id ? " is-highlighted" : ""}" tabindex="-1" data-side-delivery="${escapeHtml(delivery.id)}">
    <div class="side-delivery-heading"><b>${escapeHtml(stageNames[delivery.stage] || "加工")}完成</b><span>待领取</span></div>
    <p>${escapeHtml(delivery.inputName)}</p>
    <div class="side-delivery-foot"><small>${escapeHtml(delivery.workerName)} · ${delivery.items.length} 件${delivery.auxiliaryItems.length ? " + 余料" : ""}</small>
      <button type="button" data-action="openWorkshopDelivery" data-payload="${escapeHtml(delivery.id)}">${delivery.revealedAt ? "继续领取" : "领取"}</button></div>
  </article>`).join("");
  const workshopTab = els.panelTabs?.querySelector('[data-ptab="workshop"]');
  if (workshopTab) {
    workshopTab.innerHTML = `工坊${deliveries.length ? `<span class="workshop-delivery-count">${deliveries.length}</span><span class="workshop-ready-dot" aria-hidden="true"></span>` : ""}`;
    workshopTab.classList?.toggle("has-workshop-delivery", deliveries.length > 0);
    workshopTab.setAttribute("aria-label", `工坊${deliveries.length ? `，${deliveries.length} 批待领取` : ""}`);
  }
  if (els.sidePanelToggle) {
    els.sidePanelToggle.dataset.workshopCount = deliveries.length || "";
    els.sidePanelToggle.setAttribute("aria-label", `进行事项${deliveries.length ? `，${deliveries.length} 批工坊产物待领取` : ""}`);
  }
  const workshopHtml = deliveryHtml + (jobs.length ? jobs.map((job) => {
    const total = Math.max(1, Number(job.readyAt || 0) - Number(job.startedAt || nowMs()));
    const elapsed = Math.max(0, nowMs() - Number(job.startedAt || nowMs()));
    const pct = Math.max(2, Math.min(100, Math.round((elapsed / total) * 100)));
    const remain = Math.max(0, Math.ceil((Number(job.readyAt || nowMs()) - nowMs()) / 60000));
    const name = job.item?.name || "物料";
    const jobKey = escapeHtml(job.id || `${job.deviceId || ""}-${job.startedAt || ""}-${name}`);
    return `<div class="side-prog" data-side-job="${jobKey}">
        <div class="side-prog-top"><span>${escapeHtml(name)}</span><span class="side-prog-eta" data-side-job-eta>${remain} min</span></div>
        <div class="side-prog-bar"><i class="${pct >= 100 ? "done" : ""}" data-side-job-bar style="width:${pct}%"></i></div>
        ${job.commission ? `<button class="secondary small" type="button" data-action="claimCommission" data-payload="${escapeHtml(job.id)}" ${nowMs() < Number(job.readyAt) ? "disabled" : ""}>${nowMs() < Number(job.readyAt) ? "加工中" : "领取报酬"}</button>` : ""}
      </div>`;
  }).join("") : deliveries.length ? "" : `<div class="side-empty">暂无加工任务</div>`);

  const npcOrdersHtml = readyOrders.map((order) => `<article class="side-order side-npc-order" data-side-npc-order="${escapeHtml(order.id)}">
    <div class="side-order-head"><b>${escapeHtml(order.hard?.kindLabel || KIND_LABELS[order.hard?.kind] || "成品")} × ${Number(order.quantity || 1)}</b><span class="side-order-status ready">可交付</span></div>
    <div class="side-order-req">${escapeHtml(order.client || "街坊客人")}</div>
    <div class="side-order-foot"><span class="side-order-meta">库存已备齐</span><button class="side-order-submit" type="button" data-view-link="orders">去交付</button></div>
  </article>`).join("");
  const ordersHtml = npcOrdersHtml + (bmOrders.length ? bmOrders.map((order) => {
    const isPending = order.status === "pending";
    const deadline = isPending ? order.acceptExpiresAt : order.expiresAt;
    const minutes = Math.max(0, Math.ceil((Number(deadline || nowMs()) - nowMs()) / 60000));
    const itemLabel = order.inputItem?.name || "托管物料";
    const noteBit = order.note ? ` · ${order.note}` : "";
    const statusCls = isPending ? "pending" : (order.isFinished ? "ready" : "processing");
    const statusText = isPending ? "待接单" : (order.isFinished ? "可提交" : "加工中");
    const metaLabel = isPending ? `确认剩 ${minutes} 分钟` : `剩 ${minutes} 分钟`;
    return `<div class="side-order">
        <div class="side-order-head"><span class="side-order-who">${escapeHtml(order.buyerDisplayName || order.buyerName || "买家")}</span></div>
        <div class="side-order-req">${escapeHtml(order.title)} · ${escapeHtml(itemLabel)}${escapeHtml(noteBit)}</div>
        <div class="side-order-pay">加工费 ${formatMoney(order.price)} <span class="side-order-meta" data-side-order-eta>${metaLabel}</span></div>
        <p class="side-order-hint">${isPending ? "确认接单后，委托物才会进入「库存 → 委托」。" : "委托物在「库存 → 委托」；可去工坊加工后在此提交。"}</p>
        <div class="side-order-foot">
          <span class="side-order-status ${statusCls}">${statusText}</span>
          <div class="side-order-actions">
            ${isPending
              ? `<button class="side-order-submit" data-action="bmAcceptService" data-payload="${escapeHtml(order.id)}" type="button">确认接单</button>
                 <button class="side-order-link" data-action="bmCancelService" data-payload="${escapeHtml(order.id)}" type="button">拒绝</button>`
              : `<button class="side-order-link" data-action="openInventoryEscrow" data-payload="${escapeHtml(itemLabel)}" type="button">查看委托物</button>
                 <button class="side-order-submit" data-action="bmSubmitService" data-payload="${escapeHtml(order.id)}" type="button">提交</button>`}
          </div>
        </div>
      </div>`;
  }).join("") : readyOrders.length ? "" : `<div class="side-empty">暂无待处理订单</div>`);

  const remindHtml = reminders.length
    ? `<div class="side-remind-list">${reminders.map(reminderCardHtml).join("")}</div>`
    : `<div class="side-empty">暂无提醒</div>`;

  els.sidePanelBody.innerHTML = `
    ${readyOrders.length ? `<div class="side-order-ready-notice"><span><strong>${readyOrders.length} 单可交付</strong> · 库存已备齐</span><button type="button" class="side-order-link" data-view-link="orders">查看</button></div>` : ""}
    <div data-pplane="workshop">${workshopHtml}</div>
    <div data-pplane="order" hidden>${ordersHtml}</div>
    <div data-pplane="remind" hidden>${remindHtml}</div>
    <div data-pplane="achv" hidden>${achievementsHtml()}</div>
  `;
  renderedWorkshopDeliveries = workshopDeliverySignature(deliveries);
  syncAchievementTabDot();
  syncMiningReminderDot();
  applySidePanelFilter();
}

export function syncAchievementTabDot() {
  const state = getState();
  const els = getEls();

  const btn = els.panelTabs?.querySelector('[data-ptab="achv"]');
  if (!btn) return;
  const claimableCount = achievementViewModels(state?.me || {}).filter((item) => item.claimable).length;
  let dot = btn.querySelector(".panel-tab-dot");
  if (claimableCount > 0) {
    if (!dot) {
      dot = document.createElement("span");
      dot.className = "panel-tab-dot";
      dot.setAttribute("aria-label", "有未领取的成就奖励");
      btn.appendChild(dot);
    }
    return;
  }
  if (dot) dot.remove();
}

export function syncMiningReminderDot() {
  const state = getState();
  const els = getEls();
  const btn = els.panelTabs?.querySelector('[data-ptab="remind"]');
  if (!btn) return;
  const mining = isFeatureAvailable("mining") ? (state?.mining || {}) : {};
  const needsApplication = Boolean(
    mining.acceptingApplications
    && mining.playerQualified
    && !mining.myApplication
  );
  const rosterWarning = Boolean(
    mining.playerQualified
    && Number(mining.skippedApplicationRounds) > 0
    && !(mining.acceptingApplications && mining.myApplication)
  );
  const readyOrderCount = (state?.me?.orders || []).filter((order) => matchingBracelets(order).length >= (order.quantity || 1)).length;
  const needsAttention = needsApplication || rosterWarning || readyOrderCount > 0;
  let dot = btn.querySelector(".panel-tab-dot");
  if (needsAttention) {
    if (!dot) {
      dot = document.createElement("span");
      dot.className = "panel-tab-dot";
      btn.appendChild(dot);
    }
    const attentionLabel = needsApplication ? "矿权申请等待提交" : rosterWarning ? "竞租席位参与提醒" : `${readyOrderCount} 单库存已备齐，可交付`;
    dot.setAttribute("aria-label", attentionLabel);
    if (els.sidePanelUnread) {
      els.sidePanelUnread.hidden = false;
      els.sidePanelUnread.textContent = "!";
      els.sidePanelUnread.setAttribute("aria-label", attentionLabel);
    }
    return;
  }
  if (dot) dot.remove();
  if (els.sidePanelUnread) {
    els.sidePanelUnread.hidden = true;
    els.sidePanelUnread.textContent = "";
    els.sidePanelUnread.removeAttribute("aria-label");
  }
}

export function tickReminderCountdowns(now = nowMs()) {
  const state = getState();
  const els = getEls();

  const auctionNodes = document.querySelectorAll("[data-remind-auction-eta]");
  if (auctionNodes.length && !state?.auction) {
    // 公盘状态消失时整刷，避免留下过期倒计时行
    if (els.sidePanelBody?.querySelector('[data-pplane="remind"]')) renderSidePanel();
    if (els.sidebarStatus?.querySelector("[data-remind-auction-eta]")) renderPlayerSidebar();
  } else if (auctionNodes.length) {
    const a = auctionPhaseMeta(state.auction, now);
    const text = formatDuration(a.remain);
    const urgentSoon = a.remain < 60_000;
    auctionNodes.forEach((el) => {
      if (el.textContent !== text) el.textContent = text;
      const card = el.closest(".side-remind-card, .reminder-row");
      if (card) card.classList.toggle("is-urgent-soon", urgentSoon);
    });
  }

  const miningNodes = document.querySelectorAll("[data-remind-mining-eta]");
  if (miningNodes.length && !state?.mining?.acceptingApplications) {
    if (els.sidePanelBody?.querySelector('[data-pplane="remind"]')) renderSidePanel();
    if (els.sidebarStatus?.querySelector("[data-remind-mining-eta]")) renderPlayerSidebar();
  } else if (miningNodes.length) {
    const remain = Math.max(0, Number(state.mining.applicationClosesAt || 0) - nowMs());
    const text = formatDuration(remain);
    const urgentSoon = remain < 30_000;
    miningNodes.forEach((el) => {
      if (el.textContent !== text) el.textContent = text;
      const card = el.closest(".side-remind-card, .reminder-row");
      if (card) card.classList.toggle("is-urgent-soon", urgentSoon);
    });
  }
}

export function tickSidePanelProgress(now = nowMs()) {
  const state = getState();
  const els = getEls();

  tickReminderCountdowns(now);
  if (!els.sidePanelBody || !state?.me) return;
  const jobs = sideWorkshopJobs(state.me);
  // A delayed completion update must not leave a finished job stuck at 0 min.
  const overdue = jobs.some((job) => !job.commission && Number(job.readyAt) > 0 && now - Number(job.readyAt) >= 2000);
  if (!overdue) {
    lastWorkshopStateRequestAt = null;
  } else if (lastWorkshopStateRequestAt === null || now < lastWorkshopStateRequestAt || now - lastWorkshopStateRequestAt >= 10000) {
    if (requestState() !== false) lastWorkshopStateRequestAt = now;
  }
  if (renderedWorkshopDeliveries !== workshopDeliverySignature(state.me.workshopDeliveries)) {
    renderSidePanel();
    return;
  }
  const plane = els.sidePanelBody.querySelector('[data-pplane="workshop"]');
  if (!plane) {
    renderSidePanel();
    return;
  }
  const nodes = [...plane.querySelectorAll("[data-side-job]")];
  if (!jobs.length) {
    if (nodes.length || (!(state.me.workshopDeliveries || []).length && !plane.querySelector(".side-empty"))) renderSidePanel();
    return;
  }
  if (nodes.length !== jobs.length) {
    renderSidePanel();
    return;
  }
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    const node = nodes[index];
    const name = job.item?.name || "物料";
    const jobKey = String(job.id || `${job.deviceId || ""}-${job.startedAt || ""}-${name}`);
    if (node.dataset.sideJob !== jobKey) {
      renderSidePanel();
      return;
    }
    const total = Math.max(1, Number(job.readyAt || 0) - Number(job.startedAt || nowMs()));
    const elapsed = Math.max(0, nowMs() - Number(job.startedAt || nowMs()));
    const pct = Math.max(2, Math.min(100, Math.round((elapsed / total) * 100)));
    const remain = Math.max(0, Math.ceil((Number(job.readyAt || nowMs()) - nowMs()) / 60000));
    const eta = node.querySelector("[data-side-job-eta]");
    const bar = node.querySelector("[data-side-job-bar]");
    if (eta) eta.textContent = `${remain} min`;
    if (bar) {
      bar.style.width = `${pct}%`;
      bar.classList.toggle("done", pct >= 100);
    }
    if (job.commission) {
      const claim = node.querySelector('[data-action="claimCommission"]');
      if (claim && !claim.dataset?.submitting) {
        const ready = Number(job.readyAt) <= now;
        claim.disabled = !ready;
        claim.textContent = ready ? "领取报酬" : "加工中";
      }
    }
  }

  // 订单页签：确认/提交剩余分钟也跟着秒级刷新
  const orderPlane = els.sidePanelBody.querySelector('[data-pplane="order"]');
  if (orderPlane && !orderPlane.hidden) {
    const bmOrders = (state.blackServiceOrders || []).filter((o) => (
      o.isSeller && (o.status === "pending" || o.status === "escrow")
    ));
    const metas = [...orderPlane.querySelectorAll("[data-side-order-eta]")];
    if (metas.length !== bmOrders.length) {
      renderSidePanel();
      return;
    }
    for (let index = 0; index < bmOrders.length; index += 1) {
      const order = bmOrders[index];
      const isPending = order.status === "pending";
      const deadline = isPending ? order.acceptExpiresAt : order.expiresAt;
      const minutes = Math.max(0, Math.ceil((Number(deadline || nowMs()) - nowMs()) / 60000));
      const label = isPending ? `确认剩 ${minutes} 分钟` : `剩 ${minutes} 分钟`;
      if (metas[index].textContent !== label) metas[index].textContent = label;
    }
  }
}
