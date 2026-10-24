// Overview status / next-actions / pipeline (moved from main.js)

import { formatMoney, signedMoney, escapeHtml } from "../../shell/format-utils.js";
import { button, viewButton } from "../../shell/navigation.js";
import { MARKET_LISTING_PER_PLAYER_CAP } from "../../market-rules.js";

let getState = () => null;
let getEls = () => null;
let productionJobsFor = () => [];
let matchingBracelets = () => [];
let sumValue = () => 0;
let currentReportSummary = () => ({});
let rankBoardById = () => null;
let rankingRowsFor = () => [];
let msUntilNextOrderDailyRefresh = () => 0;
let renderTasks = () => {};
let renderBill = () => {};
let renderCredit = () => {};
let ensureOverviewStatusShell = () => ({});
let patchCurrentGoal = () => {};
let currentGoalViewModel = () => ({});

export function bindOverviewRenderDeps(deps = {}) {
  if (typeof deps.getState === "function") getState = deps.getState;
  if (typeof deps.getEls === "function") getEls = deps.getEls;
  if (typeof deps.productionJobsFor === "function") productionJobsFor = deps.productionJobsFor;
  if (typeof deps.matchingBracelets === "function") matchingBracelets = deps.matchingBracelets;
  if (typeof deps.sumValue === "function") sumValue = deps.sumValue;
  if (typeof deps.currentReportSummary === "function") currentReportSummary = deps.currentReportSummary;
  if (typeof deps.rankBoardById === "function") rankBoardById = deps.rankBoardById;
  if (typeof deps.rankingRowsFor === "function") rankingRowsFor = deps.rankingRowsFor;
  if (typeof deps.msUntilNextOrderDailyRefresh === "function") msUntilNextOrderDailyRefresh = deps.msUntilNextOrderDailyRefresh;
  if (typeof deps.renderTasks === "function") renderTasks = deps.renderTasks;
  if (typeof deps.renderBill === "function") renderBill = deps.renderBill;
  if (typeof deps.renderCredit === "function") renderCredit = deps.renderCredit;
  if (typeof deps.ensureOverviewStatusShell === "function") ensureOverviewStatusShell = deps.ensureOverviewStatusShell;
  if (typeof deps.patchCurrentGoal === "function") patchCurrentGoal = deps.patchCurrentGoal;
  if (typeof deps.currentGoalViewModel === "function") currentGoalViewModel = deps.currentGoalViewModel;
}

export const ACTION_ICONS = {
  livestream: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M6 6a8 8 0 000 12M18 6a8 8 0 010 12"/></svg>`,
  hire: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="3.4"/><path d="M5 20a7 7 0 0 1 14 0M18 9v5M15.5 11.5h5"/></svg>`,
  workshop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4l6 6-9 9-6 1 1-6 8-10z"/></svg>`
};

export function myRankFor(boardId) {
  const board = rankBoardById(boardId);
  const row = rankingRowsFor(board).find((r) => r.mine);
  return row ? row.rank : null;
}

export function assetPriceByPurchase(id, type) {
  const state = getState();

  const list = state.assetListings || [];
  const found = list.find((l) => l.id === id || l.type === type);
  return found?.price ?? 0;
}

export function currentAuctionHall() {
  const state = getState();

  const halls = state.auctionHalls || [];
  const open = halls.filter((h) => h.active && h.unlocked).sort((a, b) => b.requiredLevel - a.requiredLevel);
  if (open.length) {
    const higher = halls.filter((h) => h.active && !h.unlocked).sort((a, b) => a.requiredLevel - b.requiredLevel)[0];
    return { label: open[0].label, nextLevel: higher ? higher.requiredLevel : null };
  }
  const locked = halls.filter((h) => h.active).sort((a, b) => a.requiredLevel - b.requiredLevel)[0];
  return { label: locked ? `经营 Lv.${locked.requiredLevel} 解锁` : "未开放", nextLevel: null };
}

export function myTradeInfo() {
  const state = getState();

  const mine = (state.listings || []).filter((l) => l.ownerId === state.me.id);
  return {
    active: mine.length,
    claimable: state.me.payouts?.length || 0,
    sold: state.me.soldCount || 0,
    slots: MARKET_LISTING_PER_PLAYER_CAP
  };
}

export function guestOrderRefreshText() {
  const ms = msUntilNextOrderDailyRefresh();
  if (ms <= 0) return "即将自动刷新";
  const totalMin = Math.max(1, Math.ceil(ms / 60000));
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  if (hh <= 0) return `${mm} 分钟后自动刷新`;
  return `${hh} 小时 ${mm} 分后自动刷新`;
}

export function statusRow(label, text, action) {
  return `<div class="srow"><span class="s-label">${escapeHtml(label)}</span><span class="s-text">${escapeHtml(text)}</span>${action || ""}</div>`;
}

export function statusRows() {
  const state = getState();

  const { me } = state;
  const rows = [];
  if (!me.assets?.livestreamPermitOwned) {
    rows.push(statusRow("直播间", `未开通 · 直播经营许可 ${formatMoney(assetPriceByPurchase("livestream-permit", "livestreamPermit"))}`, viewButton("前往", "shop", "s-go")));
  }
  if (!me.assets?.workshopOwned) {
    rows.push(statusRow("工坊", `未开通 · 街角小工坊 ${formatMoney(assetPriceByPurchase("starter-workshop", "workshop"))}`, viewButton("前往", "shop", "s-go")));
  }
  const workers = me.workshop?.workers?.length || 0;
  if (workers === 0) {
    rows.push(statusRow("掌柜", "0 名 · 前往员工", viewButton("前往", "hireMarket", "s-go")));
  }
  const hall = currentAuctionHall();
  rows.push(statusRow("公盘", hall ? `可进 ${hall.label}${hall.nextLevel ? ` · 更高档需经营 Lv.${hall.nextLevel}` : ""}` : "未开放", viewButton("查看", "auction", "s-go")));
  const trade = myTradeInfo();
  const tradeBtn = trade.claimable > 0 ? button("领取", "collectPayouts", "", "s-go") : viewButton("查看", "market", "s-go");
  rows.push(statusRow("交易行", `可领取 ${trade.claimable} · 已售出 ${trade.sold} · 栏位 ${trade.slots}`, tradeBtn));
  rows.push(statusRow("客人订单", guestOrderRefreshText(), viewButton("查看", "orders", "s-go")));
  return rows;
}

export function businessFocusModel() {
  const state = getState();
  const me = state?.me || {};
  const rough = Array.isArray(me.rough) ? me.rough : [];
  const orders = Array.isArray(me.orders) ? me.orders : [];
  const products = (Array.isArray(me.bracelets) ? me.bracelets : [])
    .filter((item) => !["carved", "polished"].includes(item.materialStage || item.stage));
  const jobs = productionJobsFor(me);
  const sealed = rough.filter((item) => !item.revealed);
  const revealed = rough.filter((item) => item.revealed);
  const completable = orders
    .filter((order) => matchingBracelets(order).length >= Number(order.quantity || 1))
    .sort((left, right) => Number(right.pay || 0) - Number(left.pay || 0));
  const affordable = (state?.roughPool || [])
    .filter((item) => Number(item.price || 0) <= Number(me.cash || 0))
    .sort((left, right) => Number(left.price || 0) - Number(right.price || 0));

  if (completable.length) {
    const best = completable[0];
    return {
      stage: "sell",
      tone: "profit",
      kicker: "现在最值得做",
      title: "交付已匹配订单",
      detail: `${best.client || "客人"} · 满额收入 ${formatMoney(best.pay)} · 声望 +${Number(best.rep || 0)}`,
      actionLabel: `去交付 · ${formatMoney(best.pay)}`,
      view: "orders"
    };
  }
  if (products.length) {
    return {
      stage: "sell",
      tone: "profit",
      kicker: "下一步经营",
      title: "让成品开始变现",
      detail: `${products.length} 件成品可用于订单、直播、收藏或挂牌`,
      actionLabel: "去匹配订单",
      view: "orders"
    };
  }
  if (jobs.length) {
    return {
      stage: "craft",
      tone: "craft",
      kicker: "加工进行中",
      title: "查看工序进度",
      detail: `${jobs.length} 项加工正在推进，完成后即可进入成品经营`,
      actionLabel: "查看工坊",
      view: "workshop"
    };
  }
  if (revealed.length) {
    return {
      stage: "open",
      tone: "craft",
      kicker: "下一步经营",
      title: "规划已揭露原料",
      detail: `${revealed.length} 块明料可以规划取件，先确认价值与风险`,
      actionLabel: "继续规划",
      view: "workshop"
    };
  }
  if (sealed.length) {
    return {
      stage: "open",
      tone: "risk",
      kicker: "下一步经营",
      title: "先揭露原料信息",
      detail: `${sealed.length} 块暗料尚未打磨，揭露后再决定加工路线`,
      actionLabel: "去打磨",
      view: "workshop"
    };
  }
  if (affordable.length) {
    return {
      stage: "source",
      tone: "risk",
      kicker: "下一步经营",
      title: "为工坊补充原料",
      detail: `当前最低可参与价 ${formatMoney(affordable[0].price)}，竞拍前先保留周转现金`,
      actionLabel: "查看公盘",
      view: "auction"
    };
  }
  return {
    stage: "sell",
    tone: "warn",
    kicker: "现金周转",
    title: "先寻找低成本收入",
    detail: "当前现金不足以参与最低价原石，优先查看订单和可变现资产",
    actionLabel: "查看订单",
    view: "orders"
  };
}

function businessFocusHtml(model) {
  return `
    <section class="business-focus-card is-${escapeHtml(model.tone)}" aria-label="经营建议">
      <div class="business-focus-copy">
        <span class="business-focus-kicker">${escapeHtml(model.kicker)}</span>
        <h2>${escapeHtml(model.title)}</h2>
        <p>${escapeHtml(model.detail)}</p>
      </div>
      ${viewButton(escapeHtml(model.actionLabel), model.view, "business-focus-action")}
    </section>
  `;
}

export function businessAttentionItems() {
  const state = getState();
  const me = state?.me || {};
  const readyOrders = (Array.isArray(me.orders) ? me.orders : [])
    .filter((order) => matchingBracelets(order).length >= Number(order.quantity || 1));
  const readyMaterials = [
    ...(Array.isArray(me.rough) ? me.rough.filter((item) => item.revealed) : []),
    ...(Array.isArray(me.materials) ? me.materials : []),
    ...(Array.isArray(me.slices) ? me.slices : [])
  ];
  const sealedMaterials = Array.isArray(me.rough) ? me.rough.filter((item) => !item.revealed) : [];
  const jobs = productionJobsFor(me);
  const products = Array.isArray(me.bracelets) ? me.bracelets : [];
  const rawMaterials = [
    ...(Array.isArray(me.rough) ? me.rough : []),
    ...(Array.isArray(me.materials) ? me.materials : []),
    ...(Array.isArray(me.slices) ? me.slices : [])
  ];
  const canSource = (Array.isArray(state?.roughPool) ? state.roughPool : [])
    .some((item) => Number(item.price || 0) <= Number(me.cash || 0));

  const items = readyOrders.map((order) => ({
    id: `order-${order.id || order.client || "ready"}`,
    title: `交付${order.client ? `「${order.client}」` : "客人"}的订单`,
    detail: `满额收入 ${formatMoney(order.pay || 0)} · 声望 +${Number(order.rep || 0)}`,
    action: "去交付",
    view: "orders"
  }));
  if (readyMaterials.length && !jobs.length) {
    items.push({
      id: "ready-materials",
      title: `安排 ${readyMaterials.length} 件材料加工`,
      detail: "工坊当前没有加工任务",
      action: "去加工",
      view: "workshop"
    });
  }
  if (products.length && !readyOrders.length) {
    items.push({
      id: "finished-products",
      title: `为 ${products.length} 件成品匹配变现渠道`,
      detail: "可通过订单、直播、收藏或挂牌处理",
      action: "找订单",
      view: "orders"
    });
  }
  if (sealedMaterials.length && !readyMaterials.length && !jobs.length) {
    items.push({
      id: "sealed-materials",
      title: `揭露 ${sealedMaterials.length} 块暗料信息`,
      detail: "打磨后再决定加工路线",
      action: "去打磨",
      view: "workshop"
    });
  }
  if (!rawMaterials.length && !jobs.length && !products.length && canSource) {
    items.push({
      id: "source-materials",
      title: "为工坊补充原料",
      detail: "当前现金可以参与公盘竞拍",
      action: "去公盘",
      view: "auction"
    });
  }
  return items;
}

function businessAttentionHtml(items) {
  if (!items.length) {
    return `<div class="is-attention is-empty"><span>待处理事项</span><strong>0<small> 项</small></strong></div>`;
  }
  return `
    <details class="is-attention business-attention">
      <summary aria-label="查看 ${items.length} 项待处理事项">
        <span>待处理事项 <i>查看</i></span>
        <strong>${items.length}<small> 项</small></strong>
      </summary>
      <div class="business-attention-popover">
        <div class="business-attention-head"><b>待处理事项</b><span>按经营优先级排列</span></div>
        <div class="business-attention-list">
          ${items.map((item) => `
            <button type="button" data-view-link="${escapeHtml(item.view)}" aria-label="${escapeHtml(`${item.title}，${item.action}`)}">
              <span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.detail)}</small></span>
              <i>${escapeHtml(item.action)} ›</i>
            </button>
          `).join("")}
        </div>
      </div>
    </details>
  `;
}

export function businessEconomyHtml() {
  const report = currentReportSummary() || {};
  const income = Number(report.income || 0);
  const expense = Number(report.expense || 0);
  const net = Number.isFinite(Number(report.net)) ? Number(report.net) : income - expense;
  const attentionItems = businessAttentionItems();
  return `
    <section class="business-economy-strip" aria-label="本期经营数据">
      <div class="${net >= 0 ? "is-positive" : "is-negative"}"><span>本期净额</span><strong>${signedMoney(net)}</strong></div>
      ${businessAttentionHtml(attentionItems)}
      <div class="is-income"><span>本期收入</span><strong>+${formatMoney(income)}</strong></div>
    </section>
  `;
}

function turnoverEtaText(jobs) {
  const now = Date.now();
  const nextReadyAt = jobs
    .map((job) => Number(job?.readyAt || 0))
    .filter((readyAt) => readyAt > 0)
    .sort((left, right) => left - right)[0];
  if (!nextReadyAt) return jobs.length ? "等待工序完成" : "当前没有加工任务";
  const remainingMinutes = Math.max(0, Math.ceil((nextReadyAt - now) / 60000));
  if (remainingMinutes <= 0) return "最快一项即将完成";
  if (remainingMinutes < 60) return `最快 ${remainingMinutes} 分钟完成`;
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return `最快 ${hours} 小时${minutes ? ` ${minutes} 分` : ""}完成`;
}

export function businessTurnoverModel() {
  const state = getState();
  const me = state?.me || {};
  const rough = Array.isArray(me.rough) ? me.rough : [];
  const materials = Array.isArray(me.materials) ? me.materials : [];
  const slices = Array.isArray(me.slices) ? me.slices : [];
  const productStock = Array.isArray(me.bracelets) ? me.bracelets : [];
  const unfinished = productStock.filter((item) => ["carved", "polished"].includes(item.materialStage || item.stage));
  const products = productStock.filter((item) => !unfinished.includes(item));
  const orders = Array.isArray(me.orders) ? me.orders : [];
  const jobs = productionJobsFor(me);
  const sealed = rough.filter((item) => !item.revealed);
  const opened = rough.filter((item) => item.revealed);
  const readyMaterials = [...opened, ...materials, ...slices, ...unfinished];
  const rawMaterials = [...rough, ...materials, ...slices, ...unfinished];
  const completableOrders = orders.filter((order) => (
    matchingBracelets(order).length >= Number(order.quantity || 1)
  ));

  let bottleneckId = "";
  let summary = "周转正常，各环节可以并行推进";
  if (products.length) {
    bottleneckId = "sell";
    summary = completableOrders.length
      ? `${products.length} 件成品待变现，其中 ${completableOrders.length} 单可立即交付`
      : `${products.length} 件成品待匹配变现渠道`;
  } else if (readyMaterials.length && !jobs.length) {
    bottleneckId = "ready";
    summary = `${readyMaterials.length} 件材料待安排加工`;
  } else if (sealed.length && !readyMaterials.length && !jobs.length) {
    bottleneckId = "stock";
    summary = `${sealed.length} 块暗料待开料揭露`;
  } else if (jobs.length) {
    summary = `${jobs.length} 项加工正在推进`;
  } else if (!rawMaterials.length) {
    summary = "当前没有在途资产，可以补充原料";
  }

  const cards = [
    {
      id: "stock",
      mark: "料",
      label: "原料库存",
      count: rawMaterials.length,
      detail: `暗料 ${sealed.length} · 明料 ${opened.length + materials.length} · 片料 ${slices.length} · 毛坯 ${unfinished.length}`,
      meta: `库存估值 ${formatMoney(sumValue(rawMaterials))}`,
      action: rawMaterials.length ? "查看库存" : "去公盘补货",
      view: rawMaterials.length ? "inventory" : "auction"
    },
    {
      id: "ready",
      mark: "工",
      label: "待加工",
      count: readyMaterials.length,
      detail: `明料 ${opened.length + materials.length} · 片料 ${slices.length} · 毛坯 ${unfinished.length}`,
      meta: `待加工估值 ${formatMoney(sumValue(readyMaterials))}`,
      action: readyMaterials.length ? "安排加工" : "查看工坊",
      view: "workshop"
    },
    {
      id: "progress",
      mark: "进",
      label: "加工中",
      count: jobs.length,
      detail: turnoverEtaText(jobs),
      meta: `在制估值 ${formatMoney(sumValue(jobs.map((job) => job.item).filter(Boolean)))}`,
      action: jobs.length ? "查看队列" : "查看设备",
      view: "workshop"
    },
    {
      id: "sell",
      mark: "售",
      label: "待变现",
      count: products.length,
      detail: `可交订单 ${completableOrders.length} · 当前订单 ${orders.length}`,
      meta: `成品估值 ${formatMoney(sumValue(products))}`,
      action: completableOrders.length ? "去交订单" : "寻找订单",
      view: "orders"
    }
  ];

  return {
    cards: cards.map((card) => ({
      ...card,
      status: card.id === bottleneckId
        ? "bottleneck"
        : card.id === "progress" && card.count
          ? "progress"
          : card.count
            ? "ready"
            : "idle"
    })),
    bottleneckId,
    summary,
    empty: !rawMaterials.length && !jobs.length && !products.length
  };
}

export function businessTurnoverHtml() {
  const model = businessTurnoverModel();
  return `
    <section class="business-turnover${model.empty ? " is-empty" : ""}" aria-label="经营周转">
      <div class="business-turnover-head">
        <div>
          <strong>经营流程</strong>
          <span>点击环节查看详情</span>
        </div>
        <p class="business-turnover-summary${model.bottleneckId ? " is-bottleneck" : ""}">
          <b>${model.bottleneckId ? "当前瓶颈" : "周转状态"}</b>
          ${escapeHtml(model.summary)}
        </p>
      </div>
      ${model.empty ? `
        <div class="business-turnover-empty">
          <span class="business-turnover-mark" aria-hidden="true">闲</span>
          <div><strong>经营链路空闲</strong><p>当前没有原料、加工任务或待售成品。</p></div>
          ${viewButton("去公盘补充原料", "auction", "business-turnover-empty-action")}
        </div>
      ` : `
        <div class="business-turnover-grid">
          ${model.cards.map((card) => `
            <button class="business-turnover-card is-${card.status}" type="button" data-view-link="${escapeHtml(card.view)}" aria-label="${escapeHtml(`${card.label} ${card.count} 件，${card.detail}，${card.action}`)}">
              <span class="business-turnover-card-head">
                <span class="business-turnover-mark" aria-hidden="true">${escapeHtml(card.mark)}</span>
                <span class="business-turnover-label">${escapeHtml(card.label)}</span>
              </span>
              <strong class="business-turnover-count">${card.count}<small>件</small></strong>
              <span class="business-turnover-link">${escapeHtml(
                card.status === "bottleneck"
                  ? card.action
                  : card.status === "progress"
                    ? card.detail
                    : card.count
                      ? "可处理"
                      : "暂无"
              )}</span>
            </button>
          `).join("")}
        </div>
      `}
    </section>
  `;
}

export function renderOverview() {
  const state = getState();
  const els = getEls();

  if (!state?.me) return;

  if (els.homeStatusPane) {
    const rankBoards = [
      { id: "rep", label: "声望榜" },
      { id: "collection", label: "藏品榜" },
      { id: "cash", label: "现金榜" }
    ];
    const { goalSlot, focusSlot, economySlot, pipelineSlot, ranksSlot, rowsSlot } = ensureOverviewStatusShell();
    const focus = businessFocusModel();
    if (focusSlot) focusSlot.innerHTML = businessFocusHtml(focus);
    if (goalSlot) patchCurrentGoal(goalSlot, currentGoalViewModel());
    if (economySlot) {
      const keepAttentionOpen = Boolean(economySlot.querySelector(".business-attention")?.open);
      economySlot.innerHTML = businessEconomyHtml();
      if (keepAttentionOpen) {
        const attention = economySlot.querySelector(".business-attention");
        if (attention) attention.open = true;
      }
    }
    if (pipelineSlot) pipelineSlot.innerHTML = businessTurnoverHtml();
    if (ranksSlot) {
      ranksSlot.innerHTML = rankBoards.map((board) => {
        let rank = "—";
        try { rank = myRankFor(board.id) ?? "—"; } catch (_) { /* keep placeholder */ }
        return `<span class="rank-pill">${escapeHtml(board.label)} 第 <b class="rank-num">${rank}</b> 名</span>`;
      }).join("");
    }
    if (rowsSlot) {
      rowsSlot.innerHTML = viewButton("查看完整排行", "rankings", "overview-glance-action");
    }
  }
  if (els.homeTaskPane) {
    renderTasks();
  }
  if (els.homeBillPane) {
    renderBill();
  }
  if (els.homeCreditPane) {
    renderCredit();
  }
}

// ===== 目标 / 成就系统（游戏化：给玩家"下一步做什么"的牵引）=====

export function renderNextActions() {
  const state = getState();
  const els = getEls();

  const { me } = state;
  const productionJobs = productionJobsFor(me);
  const sealed = me.rough.filter((rough) => !rough.revealed);
  const revealed = me.rough.filter((rough) => rough.revealed);
  const completable = me.orders.filter((order) => matchingBracelets(order).length >= order.quantity);
  const affordable = state.roughPool.filter((rough) => rough.price <= me.cash).sort((a, b) => a.price - b.price);
  const report = currentReportSummary();
  const primary = [];

  if (completable.length) {
    const best = completable.sort((a, b) => b.pay - a.pay)[0];
    primary.push({ tone: "profit", title: "先交付可完成订单", meta: `${best.client} · 收入 ${formatMoney(best.pay)} · 声望 +${best.rep}`, action: viewButton("去交付", "orders") });
  } else if (me.bracelets.length) {
    primary.push({ tone: "profit", title: "处理成品库存", meta: `${me.bracelets.length} 件成品可接单、收藏、直播或挂牌`, action: viewButton("看成品", "workshop") });
  } else if (revealed.length) {
    primary.push({ tone: "craft", title: "在已揭露原料上规划取件", meta: `${revealed.length} 块料可摆放套件，规划手镯和挂件`, action: viewButton("去取件", "workshop") });
  } else if (productionJobs.length) {
    primary.push({ tone: "craft", title: "加工正在进行", meta: `${productionJobs.length} 件粗加工、精加工或镶嵌等待完成`, action: viewButton("看工坊", "workshop") });
  } else if (sealed.length) {
    primary.push({ tone: "risk", title: "拍下的原料还没揭露", meta: `${sealed.length} 块原料需要全料打磨`, action: viewButton("去打磨", "workshop", "warn") });
  } else if (affordable.length) {
    primary.push({ tone: "risk", title: "公盘只见轮廓，先开窗再决策", meta: `最低 ${formatMoney(affordable[0].price)}，开窗会公开信息`, action: viewButton("看公盘", "auction") });
  } else {
    primary.push({ tone: "danger", title: "现金不足，先靠订单或市场回笼", meta: "当前买不起最低价原石，避免继续冒险", action: viewButton("看市场", "market", "secondary") });
  }

  primary.push({ tone: "info", title: "开窗信息全员可见", meta: "你花钱开的窗口，会影响所有人的竞拍判断", action: viewButton("看公盘", "auction", "secondary") });
  primary.push({
    tone: report.net >= 0 ? "profit" : "risk",
    title: "轻量现金流",
    meta: `收入 ${formatMoney(report.income)} · 支出 ${formatMoney(report.expense)} · 净额 ${formatMoney(report.net)}`,
    action: ""
  });
  els.nextActions.innerHTML = primary.map((item) => `
    <article class="action-card ${item.tone}">
      <div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.meta)}</p></div>
      ${item.action}
    </article>
  `).join("");
}

export function renderPipeline() {
  const state = getState();
  const els = getEls();

  const { me } = state;
  const productionJobs = productionJobsFor(me);
  const sealed = me.rough.filter((rough) => !rough.revealed);
  const revealed = me.rough.filter((rough) => rough.revealed);
  const stages = [
    ["暗料", sealed.length, sumValue(sealed), "待打磨"],
    ["加工", productionJobs.length, sumValue(productionJobs.map((job) => job.item)), "粗加工/精加工/镶嵌"],
    ["明料", revealed.length, sumValue(revealed), "可取件"],
    ["成品", me.bracelets.length, sumValue(me.bracelets), "可变现"],
    ["藏品", me.collection.length, sumValue(me.collection), "涨声望"]
  ];
  els.pipeline.innerHTML = stages.map(([name, count, value, hint]) => `
    <div class="pipeline-step">
      <span>${name}</span><strong>${count}</strong><small>${formatMoney(value)} · ${hint}</small>
    </div>
  `).join("");
}

export function rankPosition(players, scoreFor, direction = "desc") {
  const state = getState();

  const ordered = [...players].sort((left, right) => {
    const diff = Number(scoreFor(right) || 0) - Number(scoreFor(left) || 0);
    return direction === "desc" ? diff : -diff;
  });
  const index = ordered.findIndex((player) => player.id === state.me.id);
  return index >= 0 ? index + 1 : null;
}
