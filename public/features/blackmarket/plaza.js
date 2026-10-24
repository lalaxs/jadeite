// 黑市 plaza：广场 / 我的摊 / 卡片 / renderBlackmarket

import { paintJadeCanvases } from "../../jade-renderer.js";
import { lazyPreviewMarkup, observeLazyPreviews } from "../../lazy-preview.js";
import { materialStageForClient, materialStageLabel } from "../inventory-helpers.js";
import { inlaySummary } from "../../product-meta.js";
import {
  marketRefValue,
  marketPriceDelta,
  marketElapsed,
  marketItemVisual,
  marketCardAttrChips,
  deriveMaterialProfile,
  mlVisual
} from "../../market-module.js";
import { PROCESS_SKILLS, WORKER_SKILL_DEFS } from "../../workshop-craft-scoring.js";
import { bmServiceTemplateById } from "../../bm-service-templates.js";
import {
  BLACKMARKET_GOODS_CAP as BM_GOODS_CAP,
  BLACKMARKET_BLIND_MIN as BM_BLIND_MIN,
  BLACKMARKET_BLIND_CAP as BM_BLIND_CAP,
  BLACKMARKET_BLIND_EXTRA_RATES as BM_BLIND_EXTRA_RATES
} from "../../bm-constants.js";
import {
  socketRef,
  getState,
  elsRef,
  getActiveView,
  leaveLockedBlackmarket,
  formatMoney,
  escapeHtml,
  empty,
  showToast,
  openGameModal,
  bmUi,
  bmFiltersBound,
  setBmFiltersBound,
  BM_TYPE_META,
  BM_FILTERS,
  bmSellables,
  bmFeatureGate,
  guardBmFeature,
  syncBmFeatureChrome,
  bmStalls,
  bmPublishedStalls,
  bmMyStall,
  bmStallInSetup,
  bmSetupHint,
  bmStallById,
  bmClaimable,
  bmPendingRatings,
  bmPendingRatingLine,
  bmPendingRatingsSummary,
  bmServiceOrders,
  bmAffordable,
  starsHtml,
  satisfactionStars,
  bmRatingPublicHtml,
  bmRatingSortScore,
  typeLabel
} from "./shared.js";
import { openBmListModal } from "./goods.js";
import {
  syncBmBlindStockModalIfOpen,
  bmBlindDisplayPrice,
  reconcileBmBlindPlaceholderPrice,
  confirmBmBlindManageMeta,
  isBmBlindManageModalOpen,
  syncBmBlindManageModalIfOpen,
  openBmBlindManageModal,
  closeBmBlindManageModal,
  requestBmBlindDrawClose,
  resumeBmBlindDrawFromState
} from "./blind-ui.js";
import { openBmServiceOfferModal } from "./service-ui.js";
import { bindBlackmarketController } from "./controller.js";
import { npcRoleLabel, isSpecialGoods, specialGoodsVisual, specialGoodsChips, npcGoodsInfo, npcPurchaseDestination, specialGoodsLabel, employeeSkillStats, goodsPriceComparison, resourceCardName, resourceCardSummary, blackmarketResourceCard } from "./goods-display.js";
import { renderResourceCard } from "../../resource-card-view.js";
import { workerDailyWage, equipmentRepairQuote } from "../../../shared/domain/blackmarket/bm-resources.js";
import { bindBmPreviewPrewarming, prewarmBmVisibleStalls } from "./previews.js";
import { blackmarketItemDetailHtml } from "./item-detail-view.js";

const STALL_ART_ROLES = new Set(["stone", "offcut", "finished", "supplies", "equipment", "traveler"]);
let lastDetailRender = null;

bindBlackmarketController({
  renderBlackmarket,
  openBmSetupModal,
  closeBmModals,
  serviceProfileHtml,
  serviceOfferCapabilityHtml,
  serviceOfferBasisHtml
});

export function openBmSetupModal(type = bmMyStall()?.type || bmUi.openType) {
  if (type === "goods") openBmListModal();
  else if (type === "blindbox") openBmBlindManageModal({ tab: "stock" });
  else openBmServiceOfferModal();
}

export function guardBmPlazaLeave() {
  const mine = bmMyStall();
  if (!bmStallInSetup(mine)) return true;
  showToast({ text: bmSetupHint(mine.type), tone: "warn" });
  bmUi.section = "mine";
  renderBlackmarket();
  openBmSetupModal(mine.type);
  return false;
}

export function renderBlackmarket() {
  if (getActiveView() !== "blackmarket") return;
  const browse = bmFeatureGate("bmBrowse");
  if (!browse.ok) {
    // 兜底：未达浏览门槛时不应停留在黑市视图（主入口已锁）
    showToast?.({ text: browse.message || "成就积分不足，暂无法查看黑市。", tone: "warn" });
    leaveLockedBlackmarket?.();
    return;
  }
  bindBlackmarketOnce();
  // 刷新后若摊位仍停在占位 ¥1，用池均价回填并写回服务端
  reconcileBmBlindPlaceholderPrice(bmMyStall());
  syncBmPlazaChrome();
  syncBmFeatureChrome();
  const stalls = bmPublishedStalls();
  const mine = bmMyStall();
  const claimable = bmClaimable();
  const pendingCount = bmPendingRatings().length;
  if (elsRef.bmMineCnt) elsRef.bmMineCnt.textContent = mine ? "1" : "0";
  if (elsRef.bmRatingCnt) elsRef.bmRatingCnt.textContent = String(pendingCount);
  if (elsRef.bmRatingBtn) elsRef.bmRatingBtn.classList.toggle("has-pending", pendingCount > 0);
  if (elsRef.bmCollectBtn) {
    elsRef.bmCollectBtn.disabled = claimable <= 0;
    elsRef.bmCollectBtn.textContent = claimable > 0 ? `领取货款 ${formatMoney(claimable)}` : "暂无货款";
  }
  renderBmTypeFilters();
  renderBmMain(stalls, mine);
  syncBmBlindStockModalIfOpen();
  syncBmBlindManageModalIfOpen();
  resumeBmBlindDrawFromState();
  if (bmUi.pendingSetupType && mine?.status === "setup") {
    const type = bmUi.pendingSetupType;
    bmUi.pendingSetupType = null;
    queueMicrotask(() => openBmSetupModal(type));
  }
}

export function syncBmPlazaChrome() {
  const inStallFocus = bmUi.section === "detail" || (bmUi.section === "mine" && bmMyStall());
  document.querySelector('section.view[data-view="blackmarket"]')?.classList.toggle("bm-stall-focus", inStallFocus);
  elsRef.bmShop?.classList.toggle("solo", inStallFocus);
  const mineButton = document.querySelector('[data-bm-section="mine"]');
  mineButton?.classList.toggle("active", bmUi.section === "mine");
  mineButton?.setAttribute("aria-pressed", bmUi.section === "mine" ? "true" : "false");
}

export function renderBmTypeFilters() {
  if (!elsRef.bmStalls) return;
  const stalls = bmPublishedStalls();
  const counts = { all: stalls.length, goods: 0, blindbox: 0, service: 0, jade: 0, employee: 0, equipment: 0 };
  for (const s of stalls) {
    if (counts[s.type] != null) counts[s.type] += 1;
    for (const type of ["jade", "employee", "equipment"]) if ((s.items || []).some((row) => goodsMatchesFilter(row, type))) counts[type] += 1;
  }
  elsRef.bmStalls.innerHTML = BM_FILTERS.map((f) => `
    <button class="jm-stall${bmUi.typeFilter === f.id && bmUi.section === "plaza" ? " active" : ""}" data-action="bmTypeFilter" data-bm-type="${f.id}" type="button" aria-pressed="${bmUi.typeFilter === f.id && bmUi.section === "plaza"}">
      ${f.label}<span class="jm-stall-cnt">${counts[f.id] || 0}</span>
    </button>`).join("");
}

export function filterSortStalls(list) {
  let arr = list.slice();
  if (["jade", "employee", "equipment"].includes(bmUi.typeFilter)) arr = arr.filter((s) => s.type === "goods" && (s.items || []).some((row) => goodsMatchesFilter(row, bmUi.typeFilter)));
  else if (bmUi.typeFilter !== "all") arr = arr.filter((s) => s.type === bmUi.typeFilter);
  if (bmUi.search) {
    const q = bmUi.search.toLowerCase();
    arr = arr.filter((s) =>
      String(s.title || "").toLowerCase().includes(q) ||
      String(s.displayName || "").toLowerCase().includes(q) ||
      String(s.ownerName || "").toLowerCase().includes(q) ||
      String(s.maskName || "").toLowerCase().includes(q) ||
      String(s.blurb || "").toLowerCase().includes(q) ||
      (s.items || []).some((row) => String(row.item?.name || "").toLowerCase().includes(q)));
  }
  const byRecency = (a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0);
  const byPrimary = bmUi.sort === "rating"
    ? (a, b) => bmRatingSortScore(b) - bmRatingSortScore(a) || byRecency(a, b)
    : bmUi.sort === "type"
      ? (a, b) => String(a.type).localeCompare(String(b.type)) || byRecency(a, b)
      : byRecency;
  // 休摊沉底，营业中优先；同状态内再按当前排序
  arr.sort((a, b) => Number(a.status === "paused") - Number(b.status === "paused") ||
    Number(Boolean(a.npc)) - Number(Boolean(b.npc)) || byPrimary(a, b));
  return arr;
}

function goodsMatchesFilter(row, filter = bmUi.typeFilter) {
  if (filter === "jade") return ["rough", "material", "slice", "bracelet"].includes(row.type);
  return !["employee", "equipment"].includes(filter) || row.type === filter;
}

export function summaryText(stall) {
  const s = stall.summary || {};
  if (stall.type === "goods") return `在售 ${s.count || 0} 件`;
  if (stall.type === "blindbox") {
    const n = s.count ?? stall.poolCount ?? 0;
    return `盲盒剩 ${n} · ${formatMoney(stall.blindPrice || s.price || 0)}`;
  }
  const snap = stall.serviceSnapshot;
  if (snap?.serviceCompleted) {
    return `服务 ${s.count || 0} 项 · 已完成 ${snap.serviceCompleted} 单`;
  }
  return `服务 ${s.count || 0} 项`;
}

export function serviceProfileChips(stall, limit = 4) {
  const snap = stall.serviceSnapshot;
  if (!snap) return [];
  const chips = [];
  for (const tag of snap.headlineTags || []) {
    if (chips.length >= limit) break;
    chips.push(tag.label);
  }
  const featured = snap.featuredWorkers?.[0]?.topSkills?.[0];
  if (featured && chips.length < limit) {
    chips.push(`${featured.name} L${featured.level}`);
  } else {
    const top = snap.topSkills?.[0];
    if (top && chips.length < limit) chips.push(`${top.name} L${top.level}`);
  }
  if (snap.acceptScopes?.[0] && chips.length < limit) {
    chips.push(snap.acceptScopes[0].label);
  }
  if (snap.serviceCompleted > 0 && chips.length < limit) {
    chips.push(`已完成 ${snap.serviceCompleted} 单`);
  }
  if (snap.showcaseItems?.length && chips.length < limit) {
    chips.push(`${snap.showcaseItems.length} 个案例`);
  } else if (snap.deviceCount > 0 && chips.length < limit) {
    chips.push(`${snap.deviceCount} 台设备`);
  }
  return chips.slice(0, limit);
}

export function serviceSkillBarsHtml(snap) {
  if (!snap?.skillPeaks) return "";
  return PROCESS_SKILLS.map((key) => {
    const level = Math.max(1, Math.min(10, Number(snap.skillPeaks[key] || 1)));
    const name = WORKER_SKILL_DEFS[key]?.name || key;
    const pct = level * 10;
    return `<div class="bm-svc-skill">
      <span class="bm-svc-skill-name">${escapeHtml(name)}</span>
      <span class="bm-svc-skill-lv">L${level}</span>
      <span class="bm-svc-skill-bar"><i style="width:${pct}%"></i></span>
    </div>`;
  }).join("");
}

export function serviceDevicesHtml(snap) {
  const devices = snap?.topDevices || [];
  if (!devices.length) {
    return `<div class="bm-svc-empty">尚未购置可展示设备</div>`;
  }
  return `<div class="bm-svc-devices resource-card-grid">${devices.map((device) => renderResourceCard({
    type: "equipment", name: [device.brand, device.modelName].filter(Boolean).join(" ") || "工坊设备",
    badge: device.stageLabel || "招牌设备", className: "bm-svc-device",
    summary: [device.focus].filter(Boolean)
  })).join("")}</div>`;
}

export function serviceFeaturedWorkersHtml(snap) {
  const rows = snap?.featuredWorkers || [];
  if (!rows.length) return "";
  return `<div class="bm-svc-workers resource-card-grid">${rows.map((worker) => renderResourceCard({
    type: "employee", name: worker.label, badge: "招牌员工", className: "bm-svc-worker",
    summary: [(worker.topSkills || []).map((s) => `${s.name} L${s.level}`).join(" · ")].filter(Boolean)
  })).join("")}</div>`;
}

export function serviceShowcaseHtml(snap) {
  const items = snap?.showcaseItems || [];
  if (!items.length) return "";
  return `<div class="bm-svc-showcase">${items.map((row) => `
    <div class="bm-svc-showcase-item">
      <div class="bm-svc-showcase-visual">${lazyPreviewMarkup(mlVisual(row.item || { name: row.name, type: row.type }), { eager: false })}</div>
      <span>${escapeHtml(row.name)}</span>
    </div>`).join("")}</div>`;
}

export function bmOwnerLinkHtml(stall) {
  return `<button type="button" class="bm-owner-link" data-action="openBmServiceInfo" data-payload="${escapeHtml(stall.id)}" title="查看详细资料">查看详细资料</button>`;
}

export function serviceProfileHtml(stall, { ownerHint = false } = {}) {
  const snap = stall.serviceSnapshot;
  if (!snap) return "";
  const repLine = (() => {
    const rd = stall.ratingDisplay;
    if (rd && !rd.visible) {
      const hint = ownerHint ? ` · 样本 ${rd.sampleCount}/${rd.minSamples} 后公开` : "";
      return `客户评级 · ${rd.label || "暂无评级"}${hint}`;
    }
    const score = Math.round(snap.satisfaction ?? rd?.score ?? 0);
    const title = snap.ratingTitle || rd?.title;
    const parts = [`★ ${score}${title ? ` · ${title}` : ""}`];
    if (rd?.orderSat != null || snap.orderSat != null) {
      parts.push(`订单 ${Math.round(rd?.orderSat ?? snap.orderSat)}%`);
    }
    if (rd?.bmSat != null || snap.bmSat != null) {
      parts.push(`黑市 ${Math.round(rd?.bmSat ?? snap.bmSat)}%`);
    }
    if (snap.serviceCompleted > 0) parts.push(`已完成 ${snap.serviceCompleted} 单`);
    if (snap.serviceCompleted > 0) parts.push(`取消率 ${snap.serviceCancelRate || 0}%`);
    return parts.join(" · ");
  })();
  const tagLine = (snap.headlineTags || []).map((tag) => tag.label).join(" · ") || "暂无自动主打标签";
  const scopeLine = (snap.acceptScopes || []).map((scope) => scope.label).join(" · ");
  const teamLabel = stall.anonymous && !stall.isMine ? `${snap.workerCount} 名师傅` : `${snap.workerCount} 名员工`;
  const workshopLine = snap.workshopOwned
    ? `${teamLabel} · ${snap.deviceCount} 台设备`
    : "尚未购置工坊";
  const featuredWorkers = serviceFeaturedWorkersHtml(snap);
  const showcase = serviceShowcaseHtml(snap);
  return `
    <section class="bm-service-profile">
      ${ownerHint
        ? `<p class="bm-svc-hint">自动数据实时更新；你可选择展示哪些标签、员工、设备与案例，不能手填等级或单数。</p>`
        : ""}
      <div class="bm-svc-row">
        <span class="bm-svc-label">客户评级</span>
        <span>${escapeHtml(repLine)}</span>
      </div>
      <div class="bm-svc-row">
        <span class="bm-svc-label">主打</span>
        <span>${escapeHtml(tagLine)}</span>
      </div>
      ${scopeLine ? `<div class="bm-svc-row"><span class="bm-svc-label">接单</span><span>${escapeHtml(scopeLine)}</span></div>` : ""}
      <div class="bm-svc-skills">${serviceSkillBarsHtml(snap)}</div>
      ${featuredWorkers ? `<div class="bm-svc-row bm-svc-row-stack"><span class="bm-svc-label">台柱子</span>${featuredWorkers}</div>` : ""}
      <div class="bm-svc-row bm-svc-row-stack">
        <span class="bm-svc-label">招牌设备</span>
        ${serviceDevicesHtml(snap)}
      </div>
      ${showcase ? `<div class="bm-svc-row bm-svc-row-stack"><span class="bm-svc-label">案例</span>${showcase}</div>` : ""}
      <div class="bm-svc-row">
        <span class="bm-svc-label">产能</span>
        <span>${escapeHtml(snap.capacity?.acceptHint || "暂无可接产能")} · ${escapeHtml(workshopLine)}</span>
      </div>
    </section>`;
}

export function serviceOfferCapabilityHtml(offer) {
  const labels = offer.capabilityLabels || [];
  if (!labels.length) return "";
  return `<div class="bm-offer-bind">${labels.map((label) => `<span class="bm-svc-chip">${escapeHtml(label)}</span>`).join("")}</div>`;
}

export function serviceOfferBasisHtml(offer) {
  const basis = offer.capabilityBasis;
  if (!basis || (!(basis.skills || []).length && !(basis.devices || []).length)) return "";
  const skillLines = (basis.skills || []).map((s) => `${escapeHtml(s.name)} L${s.level}`).join(" · ");
  const deviceLines = (basis.devices || [])
    .map((d) => `${escapeHtml(d.stageLabel)} · ${escapeHtml(d.brand)} ${escapeHtml(d.modelName)}`.trim())
    .join(" · ");
  const workerLines = (basis.workers || [])
    .map((w) => `${escapeHtml(w.label)}${w.topSkill ? ` · ${escapeHtml(w.topSkill)}` : ""}`)
    .join(" · ");
  return `
    <details class="bm-offer-basis">
      <summary>查看能力依据</summary>
      <div class="bm-offer-basis-body">
        ${skillLines ? `<div><span class="bm-svc-label">技能</span>${skillLines}</div>` : ""}
        ${deviceLines ? `<div><span class="bm-svc-label">设备</span>${deviceLines}</div>` : ""}
        ${workerLines ? `<div><span class="bm-svc-label">师傅</span>${workerLines}</div>` : ""}
      </div>
    </details>`;
}

export function serviceOfferCardHtml(offer, { stall, isMine = false } = {}) {
  const tpl = bmServiceTemplateById(offer.templateId);
  const templateTag = tpl
    ? `<span class="bm-offer-template">${escapeHtml(offer.templateLabel || tpl.title)}</span>`
    : "";
  const removeBtn = isMine
    ? `<button class="bm-offer-remove" data-action="bmRemoveOffer" data-payload="${escapeHtml(offer.id)}" type="button" title="移除服务">移除</button>`
    : "";
  return `
    <div class="bm-offer-card">
      <div class="bm-offer-head">
        <b>${escapeHtml(offer.title)}</b>
        ${templateTag}
        ${removeBtn}
      </div>
      <span class="bm-offer-meta">${formatMoney(offer.price)} · 约 ${offer.etaMinutes || 0} 分</span>
      ${serviceOfferCapabilityHtml(offer)}
      ${isMine
        ? ""
        : (() => {
          const buy = bmFeatureGate("bmBuy");
          if (!buy.ok) {
            return `<button class="jm-buy" disabled type="button" title="${escapeHtml(buy.message)}">积分未解锁</button>`;
          }
          return `<button class="jm-buy" data-action="bmOrderService" data-stall="${escapeHtml(stall.id)}" data-payload="${escapeHtml(offer.id)}" type="button">下单托管</button>`;
        })()}
    </div>`;
}

export function stallCardHtml(stall) {
  const meta = BM_TYPE_META[stall.type] || BM_TYPE_META.goods;
  const artRole = stall.npc && STALL_ART_ROLES.has(stall.npcRole)
    ? stall.npcRole
    : stall.type === "service" ? "equipment" : "traveler";
  const paused = stall.status === "paused";
  const badges = [];
  if (stall.isMine) badges.push(`<span class="jm-badge mine">我的</span>`);
  if (stall.anonymous) badges.push(`<span class="jm-badge sealed">匿名</span>`);
  if (paused) badges.push(`<span class="jm-badge stage">休摊</span>`);
  badges.push(`<span class="jm-badge opened">${escapeHtml(meta.label)}</span>`);
  const svcChips = stall.type === "service" ? serviceProfileChips(stall) : [];
  const chipHtml = svcChips.length
    ? `<div class="bm-svc-card-chips">${svcChips.map((chip) => `<span class="bm-svc-chip">${escapeHtml(chip)}</span>`).join("")}</div>`
    : "";
  const enterAction = stall.isMine
    ? `data-action="bmSection" data-bm-section="mine"`
    : `data-action="openBmStallDetail" data-payload="${escapeHtml(stall.id)}"`;
  const enterLabel = stall.isMine
    ? `管理${stall.title || "我的摊位"}`
    : `进入${stall.title || "未命名摊位"}`;
  return `
  <article class="jm-card bm-stall-card ${stall.isMine ? "is-mine" : ""}" ${enterAction}>
    <div class="jm-art bm-stall-art" data-stall-art="${artRole}">
      <img class="bm-stall-illustration" src="/assets/blackmarket/stall-${artRole}.svg" alt="" aria-hidden="true" width="320" height="180" decoding="async" draggable="false" />
      ${badges.length ? `<div class="jm-badges">${badges.join("")}</div>` : ""}
      <div class="bm-stall-mark">${escapeHtml(stall.npc ? npcRoleLabel(stall) : meta.label.slice(0, 2))}</div>
    </div>
    <div class="jm-body">
      <div class="jm-nm">${escapeHtml(stall.title || "未命名摊位")}</div>
      <div class="bm-stall-who">${escapeHtml(stall.displayName || stall.ownerName || "摊主")}${stall.npc ? "" : ` · ${bmRatingPublicHtml(stall)}`}</div>
      <p class="bm-stall-blurb">${escapeHtml(stall.blurb || "暂无简介")}</p>
      ${chipHtml}
      <div class="jm-price-meta"><span>${escapeHtml(summaryText(stall))} · ${marketElapsed(stall.updatedAt || stall.createdAt)}</span></div>
      <button class="jm-buy" ${enterAction} type="button" aria-label="${escapeHtml(enterLabel)}">进入摊位</button>
    </div>
  </article>`;
}

export function renderBmMain(stalls, mine) {
  if (!elsRef.bmGrid) return;
  const resultStatus = document.getElementById("bmResultStatus");
  if (bmUi.section === "detail") {
    if (resultStatus) resultStatus.textContent = "";
    renderBmDetail();
    return;
  }
  if (bmUi.section === "mine") {
    if (resultStatus) resultStatus.textContent = "";
    renderBmMine(mine);
    return;
  }
  const arr = filterSortStalls(stalls);
  if (resultStatus) {
    const filtering = Boolean(bmUi.search || bmUi.typeFilter !== "all");
    resultStatus.textContent = filtering
      ? `找到 ${arr.length} 个摊位 · 共 ${stalls.length} 个`
      : `${arr.length} 个摊位`;
  }
  if (!arr.length) {
    const stallGate = bmFeatureGate("bmStall");
    elsRef.bmGrid.innerHTML = stalls.length
      ? `
        <div class="jm-empty game-empty-state">
          <span class="game-empty-state-mark" aria-hidden="true">筛</span>
          <strong>没有符合条件的摊位</strong>
          <p>清除搜索和分类条件，重新查看黑市全部摊位。</p>
          <button type="button" data-action="bmResetFilters">清除筛选</button>
        </div>`
      : `
        <div class="jm-empty game-empty-state">
          <span class="game-empty-state-mark" aria-hidden="true">巷</span>
          <strong>黑市还没有摊位</strong>
          <p>${stallGate.ok ? "可以成为今天第一个开摊的掌柜。" : "继续经营、积累成就积分后即可开设自己的摊位。"}</p>
          ${stallGate.ok
            ? '<button type="button" data-action="openBmOpenModal">＋ 开设摊位</button>'
            : '<button type="button" data-view-link="orders">先去订单经营</button>'}
        </div>`;
    return;
  }
  elsRef.bmGrid.innerHTML = arr.map((s) => stallCardHtml(s)).join("");
  prewarmBmVisibleStalls();
}

export function renderBmMine(mine) {
  if (!mine) {
    const stallGate = bmFeatureGate("bmStall");
    elsRef.bmGrid.innerHTML = `
      <div class="jm-mine-empty game-empty-state">
        <span class="game-empty-state-mark" aria-hidden="true">摊</span>
        <strong>还没有自己的摊位</strong>
        <p>每人同时只能开一个摊，开摊时选择卖物品 / 盲盒 / 技术支持（不可中途换类型，须收摊重开）。</p>
        <button class="jm-hero-btn primary" data-action="openBmOpenModal" type="button" ${stallGate.ok ? "" : "disabled"}>${stallGate.ok ? "＋ 开设摊位" : `成就积分 ${stallGate.current}/${stallGate.required}`}</button>
      </div>`;
    return;
  }
  // 仅展示卖家仍需操作的单：待接单 / 加工中；已提交待买家确认的不占「待处理」
  const orders = bmServiceOrders().filter((o) => o.isSeller && (o.status === "pending" || o.status === "escrow"));
  const inSetup = bmStallInSetup(mine);
  const statusLabel = inSetup ? "待上架" : mine.status === "paused" ? "休摊中" : "营业中";
  const mineOwnerMeta = mine.type === "service"
    ? `${escapeHtml(mine.displayName || mine.ownerName || "摊主")} · ${typeLabel(mine.type)} · ${bmRatingPublicHtml(mine, { ownerView: true })} · ${statusLabel}${mine.anonymous ? " · 匿名" : ""} · ${bmOwnerLinkHtml(mine)}`
    : `${typeLabel(mine.type)} · ${bmRatingPublicHtml(mine, { ownerView: true })} · ${statusLabel}${mine.anonymous ? " · 匿名" : ""}`;
  elsRef.bmGrid.innerHTML = `
    ${inSetup ? `<div class="jm-mine-summary jm-mine-summary-span bm-setup-banner">
      <div class="jm-mine-summary-copy"><strong>摆摊未完成</strong><span>${escapeHtml(bmSetupHint(mine.type))}</span></div>
      <button class="jm-hero-btn primary" data-action="openBmSetupFlow" type="button">继续完成</button>
    </div>` : ""}
    <div class="bm-page-head jm-mine-summary-span">
      <button class="back-link" data-action="bmBackPlaza" type="button">← 返回广场</button>
      <div class="bm-page-head-main">
        <div class="jm-mine-summary-copy">
          <strong>${escapeHtml(mine.title)}</strong>
          <div class="jm-mine-summary-meta">${mineOwnerMeta}</div>
        </div>
        <div class="bm-mine-actions">
          ${inSetup ? "" : `<button class="jm-hero-btn" data-action="bmToggleAnonymous" type="button">${mine.anonymous ? "取消匿名" : "开启匿名"}</button>`}
          ${mine.type === "blindbox"
            ? `<button class="jm-hero-btn" data-action="openBmBlindManageModal" type="button">管理</button>`
            : `<button class="jm-hero-btn" data-action="openBmStallDetail" data-payload="${escapeHtml(mine.id)}" type="button">管理</button>`}
          ${inSetup ? "" : `<button class="jm-hero-btn" data-action="bmTogglePause" type="button">${mine.status === "paused" ? "恢复开摊" : "休摊"}</button>`}
          <button class="jm-hero-btn" data-action="bmCloseStall" type="button">收摊</button>
        </div>
      </div>
    </div>
    ${mineManageHtml(mine)}
    ${orders.length ? `<div class="bm-orders-block"><b>待处理服务单</b>${orders.map(serviceOrderRow).join("")}</div>` : ""}`;
  observeLazyPreviews(elsRef.bmGrid);
}

export function mineManageHtml(mine) {
  if (mine.type === "goods") {
    const items = mine.items || [];
    return `
      <div class="bm-manage-head">
        <span>货架 ${items.length}/${BM_GOODS_CAP}</span>
        <button class="jm-hero-btn primary" data-action="openBmListModal" type="button">＋ 上架物品</button>
      </div>
      <div class="bm-manage-grid inventory-grid">${items.length ? items.map((row) => goodsRowHtml(mine, row, true)).join("") : `
        <div class="jm-empty game-empty-state is-compact">
          <span class="game-empty-state-mark" aria-hidden="true">货</span>
          <strong>货架还是空的</strong>
          <p>从库存挑一件物品上架，摊位才会出现在广场。</p>
          <button type="button" data-action="openBmListModal">＋ 上架物品</button>
        </div>`}</div>`;
  }
  if (mine.type === "blindbox") {
    const n = mine.poolCount ?? mine.pool?.length ?? 0;
    return `
      <div class="bm-manage-head">
        <span>盲盒池 ${n}/${BM_BLIND_CAP}（满 ${BM_BLIND_MIN} 可卖）· 定价 ${formatMoney(bmBlindDisplayPrice(mine))}</span>
      </div>
      <p class="bm-stall-blurb">${escapeHtml(mine.blindDescription || "尚未填写盲盒描述")}</p>
      <div class="bm-manage-grid">${(mine.pool || []).length
        ? (mine.pool || []).map((row) => `<div class="bm-pool-chip">${escapeHtml(row.item?.name || "物品")}</div>`).join("")
        : `<div class="jm-empty game-empty-state is-compact">
            <span class="game-empty-state-mark" aria-hidden="true">盒</span>
            <strong>盲盒池还是空的</strong>
            <p>加入至少 ${BM_BLIND_MIN} 件物品后才可对外出售。</p>
            <button type="button" data-action="openBmBlindManageModal">管理盲盒池</button>
          </div>`}</div>
      <p class="bm-batch-hint">共 ${(mine.pool || []).length} 件 · 点击「管理」上架、下架与改价</p>`;
  }
  const offers = mine.offers || [];
  return `
    <div class="bm-manage-head">
      <button class="jm-hero-btn primary" data-action="openBmServiceOfferModal" type="button">＋ 添加服务</button>
    </div>
    <div class="bm-manage-grid">${offers.length ? offers.map((o) => serviceOfferCardHtml(o, { stall: mine, isMine: true })).join("") : `
      <div class="jm-empty game-empty-state is-compact">
        <span class="game-empty-state-mark" aria-hidden="true">技</span>
        <strong>还没有服务条目</strong>
        <p>添加一项技术服务，让其他掌柜可以委托加工。</p>
        <button type="button" data-action="openBmServiceOfferModal">＋ 添加服务</button>
      </div>`}</div>
    ${serviceProofHtml(mine)}`;
}

export function goodsRowHtml(stall, row, isMine) {
  const item = row.item;
  const resource = row.type === "employee" || row.type === "equipment";
  const stage = materialStageForClient(item);
  const category = isSpecialGoods(row) ? specialGoodsLabel(row.type) : stage === "rough" ? "原石" : stage === "finished" ? "成品" : "阶段产物";
  const summary = inlaySummary(item);
  const detailAction = `data-action="openBmItemDetail" data-stall="${escapeHtml(stall.id)}" data-payload="${escapeHtml(row.id)}"`;
  const can = bmAffordable(row.price);
  const buy = bmFeatureGate("bmBuy");
  let buyBtn;
  if (isMine) {
    buyBtn = `<button class="jm-buy jm-buy-mine" data-action="bmReprice" data-payload="${escapeHtml(row.id)}" type="button">改价</button><button class="jm-buy jm-buy-mine" data-action="bmWithdraw" data-payload="${escapeHtml(row.id)}" type="button">撤下</button>`;
  } else if (!buy.ok) {
    buyBtn = `<button class="jm-buy" disabled type="button" title="${escapeHtml(buy.message)}">积分未解锁</button>`;
  } else {
    buyBtn = `<button class="jm-buy" data-action="openBmBuyGoods" data-stall="${escapeHtml(stall.id)}" data-payload="${escapeHtml(row.id)}" ${can ? "" : "disabled"} type="button">${can ? "买入" : "现金不足"}</button>`;
  }
  return `
  <article class="inventory-slot bm-goods-card" ${detailAction}>
    <button class="inventory-slot-visual bm-goods-preview" ${detailAction} type="button" aria-label="查看${escapeHtml(item?.name || "物品")}详情">
      <span class="inventory-slot-badge">${category}</span>
      ${isSpecialGoods(row) ? specialGoodsVisual(row) : marketItemVisual(item, { bitmapOnly: true })}
    </button>
    <div class="inventory-slot-copy">
      <div class="inventory-slot-name"><strong>${escapeHtml(resource ? resourceCardName(row) : item?.name || "")}</strong></div>
      ${resource ? resourceCardSummary(row, stall.npc) : `<p>${escapeHtml(isSpecialGoods(row) ? specialGoodsLabel(row.type) : materialStageLabel(item))} · ${stall.npc ? "NPC 供货" : "玩家转售"}</p>`}
      ${summary ? `<p class="inventory-finish-summary">${escapeHtml(summary)}</p>` : ""}
      <div class="inventory-slot-value"><span>${row.type === "employee" ? "转聘费" : "售价"}</span><strong>${formatMoney(row.price)}</strong></div>
      ${buyBtn}
    </div>
  </article>`;
}

export function openBmItemDetail(listingId, stallId) {
  if (!guardBmFeature("bmBrowse")) return;
  const stall = bmStallById(stallId);
  const row = stall?.items?.find((entry) => entry.id === listingId);
  if (!row) {
    showToast({ text: "该物品已下架，请查看摊位最新货品。", tone: "warn" });
    return;
  }
  const item = row.item || {};
  const buy = bmFeatureGate("bmBuy");
  const comparison = goodsPriceComparison(row);
  const stats = [
    { label: "阶段", value: isSpecialGoods(row) ? specialGoodsLabel(row.type) : materialStageLabel(item) },
    { label: "售价", value: formatMoney(row.price) },
    { label: comparison.referenceLabel, value: formatMoney(comparison.referencePrice) },
    { label: "摊位", value: stall.title || stall.displayName || "黑市摊位" }
  ];
  if (row.type === "employee") stats.push({ label: "登录日日薪", value: formatMoney(workerDailyWage(item)) }, ...employeeSkillStats(item), { label: "优点", value: (item.traits || []).join("、") || "无" }, { label: "缺点", value: (item.flaws || []).join("、") || "无" });
  if (row.type === "equipment") stats.push({ label: "耐久", value: `${item.condition} / 100` }, { label: "维修报价", value: formatMoney(comparison.repair) }, { label: "修满后总投入", value: formatMoney(comparison.totalCost) });
  if (comparison.savings > 0) stats.push({ label: comparison.savingsLabel, value: formatMoney(comparison.savings) });
  const lines = [item.hint, !stall.npc ? row.note : "", isSpecialGoods(row) ? npcPurchaseDestination(row) : ""].filter(Boolean);
  const actions = [];
  if (!stall.isMine) {
    if (!buy.ok) lines.push(buy.message);
    else if (!bmAffordable(row.price)) lines.push(`现金不足，购买需要 ${formatMoney(row.price)}。`);
    else if (stall.status === "open") actions.push({
      label: `买入 · ${formatMoney(row.price)}`,
      clientAction: "openBmBuyFromDetail",
      payload: `${stall.id}|${row.id}`
    });
  }
  actions.push({ label: "关闭", variant: "secondary" });
  openGameModal({
    id: `blackmarket-item:${row.id}`, title: item.name || "黑市物品详情", subtitle: "黑市物品详情", size: "wide", modalClass: "inventory-detail-modal blackmarket-detail-modal",
    previewHtml: blackmarketItemDetailHtml(row, { previewHtml: isSpecialGoods(row) ? specialGoodsVisual(row) : marketItemVisual(item, { eager: true }), stats, lines }), actions
  });
}

export function serviceProofHtml(stall) {
  const proof = stall.serviceProof;
  if (!proof?.completedCount) return "";
  const avgLine = proof.avgStars != null ? ` · 均 ${proof.avgStars} 星` : "";
  const rows = (proof.recent || []).map((row) => {
    const stars = row.stars != null ? `${row.stars}★` : "待评";
    const bind = row.bindLabels?.length ? row.bindLabels.join(" · ") : "";
    return `
      <div class="bm-proof-row">
        <div class="bm-proof-head">
          <b>${escapeHtml(row.title)}</b>
          <span>${formatMoney(row.price)} · ${escapeHtml(row.buyerLabel)} · ${stars}</span>
        </div>
        ${bind ? `<span class="bm-proof-bind">${escapeHtml(bind)}</span>` : ""}
        <span class="bm-proof-time">${escapeHtml(marketElapsed(row.completedAt))}</span>
      </div>`;
  }).join("");
  return `
    <details class="bm-service-proof">
      <summary>口碑证明 · 已完成 ${proof.completedCount} 单${avgLine}</summary>
      <div class="bm-proof-list">${rows || `<div class="bm-svc-empty">暂无展示记录。</div>`}</div>
    </details>`;
}

export function orderCapabilityDetailHtml(order) {
  const snap = order.capabilitySnapshot;
  if (!snap) return "";
  const svc = snap.serviceSnapshot;
  const lines = [];
  if (snap.bindLabels?.length) lines.push(`绑定：${snap.bindLabels.join(" · ")}`);
  if (svc?.headlineTags?.length) {
    lines.push(`主打：${svc.headlineTags.map((tag) => tag.label).join(" · ")}`);
  }
  if (svc?.topSkills?.length) {
    lines.push(`技能峰值：${svc.topSkills.map((skill) => `${skill.name} L${skill.level}`).join(" · ")}`);
  }
  if (svc?.capacity?.acceptHint) lines.push(`产能：${svc.capacity.acceptHint}`);
  if (!lines.length) return "";
  return `
    <details class="bm-order-basis">
      <summary>下单能力快照</summary>
      <div class="bm-order-basis-body">${lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div>
    </details>`;
}

export function serviceOrderRow(o) {
  const snap = o.capabilitySnapshot;
  const snapLine = snap?.bindLabels?.length
    ? `<span class="bm-order-snap">下单依据：${escapeHtml(snap.bindLabels.join(" · "))}</span>`
    : "";
  const ratingLine = o.buyerRating?.stars
    ? `<span class="bm-order-snap">买家评价：${o.buyerRating.stars}★</span>`
    : "";
  const itemLine = o.inputItem?.name
    ? `<span class="bm-order-snap">物料：${escapeHtml(o.inputItem.name)}</span>`
    : "";
  const statusLabel = o.status === "pending"
    ? "待接单"
    : o.status === "delivered"
      ? "待确认"
      : o.status === "completed"
        ? "已完成"
        : o.isFinished
          ? "可提交"
          : "加工中";
  const acceptLeft = o.status === "pending" && o.acceptExpiresAt
    ? Math.max(0, Math.ceil((Number(o.acceptExpiresAt) - Date.now()) / 60000))
    : null;
  const acceptHint = acceptLeft != null
    ? `<span class="bm-order-snap">确认剩余 ${acceptLeft} 分钟</span>`
    : "";
  return `
  <div class="bm-order-row">
    <div><b>${escapeHtml(o.title)}</b> · ${formatMoney(o.price)} · ${statusLabel}
      <span>${escapeHtml(o.isBuyer ? `卖家 ${o.sellerName}` : `买家 ${o.buyerDisplayName || o.buyerName}`)}</span>
      ${itemLine}
      ${acceptHint}
      ${snapLine}
      ${ratingLine}
      ${orderCapabilityDetailHtml(o)}
    </div>
    <div class="bm-order-actions">
      ${o.isSeller && o.status === "pending" ? `<button class="jm-hero-btn primary" data-action="bmAcceptService" data-payload="${escapeHtml(o.id)}" type="button">确认接单</button>` : ""}
      ${o.isSeller && o.status === "pending" ? `<button class="jm-hero-btn" data-action="bmCancelService" data-payload="${escapeHtml(o.id)}" type="button">拒绝</button>` : ""}
      ${o.isBuyer && o.status === "pending" ? `<button class="jm-hero-btn" data-action="bmCancelService" data-payload="${escapeHtml(o.id)}" type="button">取消</button>` : ""}
      ${o.isSeller && o.status === "escrow" ? `<button class="jm-hero-btn" data-action="openInventoryEscrow" data-payload="${escapeHtml(o.inputItem?.name || "")}" type="button">查看委托物</button>` : ""}
      ${o.isSeller && o.status === "escrow" ? `<button class="jm-hero-btn primary" data-action="bmSubmitService" data-payload="${escapeHtml(o.id)}" type="button">提交</button>` : ""}
      ${o.isBuyer && o.status === "delivered" ? `<button class="jm-hero-btn primary" data-action="bmConfirmService" data-payload="${escapeHtml(o.id)}" type="button">确认收货</button>` : ""}
      ${(o.isBuyer || o.isSeller) && o.status === "escrow" ? `<button class="jm-hero-btn" data-action="bmCancelService" data-payload="${escapeHtml(o.id)}" type="button">取消</button>` : ""}
    </div>
  </div>`;
}

/** 盲盒摊桌：按池内件数决定可视问号盒数量与疏密档 */
export function bmBlindPileVisibleCount(n) {
  const count = Math.max(0, Number(n) || 0);
  if (count <= 0) return 0;
  if (count < BM_BLIND_MIN) return Math.min(count, 5);
  if (count < 20) return 8;
  if (count < 35) return 12;
  return 16;
}

export function bmBlindPileDensity(n) {
  const count = Math.max(0, Number(n) || 0);
  if (count <= 0) return "empty";
  if (count < BM_BLIND_MIN) return "sparse";
  if (count < 20) return "low";
  if (count < 35) return "mid";
  return "full";
}

export function bmBlindPileHtml(n) {
  const count = Math.max(0, Number(n) || 0);
  const visible = bmBlindPileVisibleCount(count);
  const density = bmBlindPileDensity(count);
  const more = Math.max(0, count - visible);
  const boxes = Array.from({ length: visible }, () => (
    `<span class="bm-blind-box" aria-hidden="true">
      <span class="bm-blind-crate">
        <span class="bm-blind-crate-top"></span>
        <span class="bm-blind-crate-side"></span>
        <span class="bm-blind-crate-face"><span class="bm-blind-box-mark">?</span></span>
      </span>
    </span>`
  )).join("");
  return `
    <div class="bm-blind-pile" data-density="${density}" data-count="${count}" aria-label="盲盒池 ${count} 件">
      ${boxes || `<span class="bm-blind-pile-empty">暂无盲盒</span>`}
      ${more > 0 ? `<span class="bm-blind-pile-more">+${more}</span>` : ""}
    </div>`;
}

export function renderBmDetail() {
  const stall = bmStallById(bmUi.detailStallId);
  if (!stall) {
    bmUi.section = "plaza";
    renderBlackmarket();
    return;
  }
  const fingerprint = JSON.stringify([
    stall, getState()?.me?.cash, bmUi.typeFilter, bmFeatureGate("bmBuy"),
    stall.type === "service" ? bmServiceOrders().filter((order) => order.stallId === stall.id && (order.isBuyer || order.isSeller)) : null
  ]);
  // Experience / workshop ticks do not change this shelf. Keep decoded images,
  // in-flight captures and focused controls instead of rebuilding their DOM.
  if (lastDetailRender?.root === elsRef.bmGrid && lastDetailRender.head === elsRef.bmGrid.firstElementChild
    && lastDetailRender.fingerprint === fingerprint) return;
  let body = "";
  if (stall.type === "goods") {
    const items = (stall.items || []).filter((row) => stall.isMine || goodsMatchesFilter(row));
    body = items.length
      ? `<div class="bm-manage-grid inventory-grid">${items.map((row) => goodsRowHtml(stall, row, stall.isMine)).join("")}</div>`
      : `<div class="jm-empty game-empty-state is-compact">
          <span class="game-empty-state-mark" aria-hidden="true">货</span>
          <strong>这个摊位暂时空着</strong>
          <p>当前没有在售物品，可以返回广场看看其他摊位。</p>
        </div>`;
  } else if (stall.type === "blindbox") {
    const n = stall.poolCount ?? 0;
    const drawing = Boolean(stall.drawing);
    const buyGate = bmFeatureGate("bmBuy");
    const can = !stall.isMine && buyGate.ok && stall.status === "open" && n >= BM_BLIND_MIN && !drawing && bmAffordable(stall.blindPrice);
    const locked = !stall.isMine && !can;
    let buyLabel = `拆盲盒 ${formatMoney(stall.blindPrice)}`;
    if (stall.isMine) buyLabel = "";
    else if (!buyGate.ok) buyLabel = "积分未解锁";
    else if (drawing) buyLabel = "有人正在抽取…";
    else if (stall.status !== "open" || n < BM_BLIND_MIN) buyLabel = "暂不可买";
    else if (!bmAffordable(stall.blindPrice)) buyLabel = "现金不足";
    const poolLabel = n < BM_BLIND_MIN ? `池内 ${n}（需 ≥${BM_BLIND_MIN}）` : `池内 ${n}`;
    const panelClass = [
      "bm-blind-panel",
      stall.isMine ? "is-mine" : "",
      drawing ? "is-drawing" : "",
      locked ? "is-locked" : ""
    ].filter(Boolean).join(" ");
    body = `
      <div class="${panelClass}">
        <p class="bm-blind-desc">${escapeHtml(stall.blindDescription || "摊主未填写描述")}</p>
        <div class="bm-blind-table">
          ${bmBlindPileHtml(n)}
          <div class="bm-blind-price-rail" aria-label="定价信息">
            <span>${formatMoney(stall.blindPrice || 0)} / 次</span>
            <span>${escapeHtml(poolLabel)}</span>
            <span>手续费 ${formatMoney(0)}</span>
          </div>
        </div>
        ${stall.isMine
          ? `<p class="jm-suggest bm-blind-hint">买家看不到池内具体货品。可在「管理」中上架、下架与改价。拆盒时抽出 3 件候选，买家任选 1 件，加选另计。</p>`
          : `<button class="jm-buy" data-action="bmBuyBlind" data-payload="${escapeHtml(stall.id)}" ${can ? "" : "disabled"} type="button" title="${buyGate.ok ? "" : escapeHtml(buyGate.message)}">${buyLabel}</button>
             ${drawing ? `<p class="jm-suggest bm-blind-hint">有人正在抽取盲盒，稍后再试。</p>` : `<p class="jm-suggest bm-blind-hint">支付后抽出 3 件，默认带走第 1 件；第 2 / 第 3 件加价 ${BM_BLIND_EXTRA_RATES[1]}× / ${BM_BLIND_EXTRA_RATES[2]}×。</p>`}`}
      </div>`;
  } else {
    const offers = stall.offers || [];
    const myOrders = bmServiceOrders().filter((o) => o.stallId === stall.id && (o.isBuyer || o.isSeller));
    body = `
      <div class="bm-manage-head"><span>服务菜单</span></div>
      <div class="bm-manage-grid">${offers.length ? offers.map((o) => serviceOfferCardHtml(o, { stall })).join("") : `
        <div class="jm-empty game-empty-state is-compact">
          <span class="game-empty-state-mark" aria-hidden="true">技</span>
          <strong>暂时没有可下单服务</strong>
          <p>摊主还没有发布服务，可以返回广场寻找其他师傅。</p>
        </div>`}</div>
      ${serviceProofHtml(stall)}
      ${myOrders.length ? `<div class="bm-orders-block"><b>相关服务单</b>${myOrders.map(serviceOrderRow).join("")}</div>` : ""}`;
  }
  const detailOwnerMeta = stall.type === "service"
    ? `${escapeHtml(stall.displayName || stall.ownerName || "摊主")} · ${typeLabel(stall.type)} · ${bmRatingPublicHtml(stall, { ownerView: stall.isMine })} · ${escapeHtml(summaryText(stall))} · ${bmOwnerLinkHtml(stall)}`
    : `${escapeHtml(stall.displayName)} · ${typeLabel(stall.type)} · ${bmRatingPublicHtml(stall, { ownerView: stall.isMine })} · ${escapeHtml(summaryText(stall))}`;
  elsRef.bmGrid.innerHTML = `
    <div class="bm-page-head jm-mine-summary-span">
      <button class="back-link" data-action="bmBackPlaza" type="button">← 返回广场</button>
      <div class="bm-page-head-main">
        <div class="jm-mine-summary-copy">
          <strong>${escapeHtml(stall.title)}</strong>
          <div class="jm-mine-summary-meta">${detailOwnerMeta}</div>
          <p class="bm-stall-blurb">${escapeHtml(stall.blurb || "")}</p>
        </div>
      </div>
    </div>
    ${body}`;
  lastDetailRender = { root: elsRef.bmGrid, head: elsRef.bmGrid.firstElementChild, fingerprint };
  observeLazyPreviews(elsRef.bmGrid);
}

export function bindBlackmarketOnce() {
  if (bmFiltersBound) return;
  setBmFiltersBound(true);
  bindBmPreviewPrewarming();
  elsRef.bmSearch?.addEventListener("input", () => {
    bmUi.search = elsRef.bmSearch.value.trim();
    renderBlackmarket();
  });
  elsRef.bmSort?.addEventListener("change", () => {
    bmUi.sort = elsRef.bmSort.value;
    renderBlackmarket();
  });
  elsRef.bmReset?.addEventListener("click", () => {
    bmUi.search = "";
    bmUi.sort = "latest";
    bmUi.typeFilter = "all";
    if (elsRef.bmSearch) elsRef.bmSearch.value = "";
    if (elsRef.bmSort) elsRef.bmSort.value = "latest";
    renderBlackmarket();
  });
  document.getElementById("bmBlindStockPrice")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    confirmBmBlindManageMeta();
  });
  document.getElementById("bmBlindStockPrice")?.addEventListener("input", () => {
    bmUi.blindPriceTouched = true;
  });
}

/* ——— Modals ——— */

export function openBmOpenModal() {
  if (!guardBmFeature("bmStall")) return;
  if (bmMyStall()) {
    showToast("你已有摊位，请先收摊。");
    bmUi.section = "mine";
    renderBlackmarket();
    return;
  }
  const modal = document.getElementById("bmOpenModal");
  if (!modal) return;
  bmUi.openType = "goods";
  bmUi.openTitle = "";
  bmUi.openBlurb = "";
  bmUi.openAnonymous = false;
  const title = modal.querySelector("#bmOpenTitle");
  const blurb = modal.querySelector("#bmOpenBlurb");
  const anon = modal.querySelector("#bmOpenAnonymous");
  if (title) title.value = "";
  if (blurb) blurb.value = "";
  if (anon) anon.checked = false;
  modal.querySelectorAll("[data-bm-open-type]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.bmOpenType === bmUi.openType);
  });
  syncBmOpenTypeHint();
  modal.hidden = false;
}

export function syncBmOpenTypeHint() {
  const hint = document.getElementById("bmOpenTypeHint");
  if (!hint) return;
  const show = bmUi.openType === "blindbox";
  hint.hidden = !show;
  if (!show) return;
  const n = bmSellables().length;
  hint.textContent = n >= BM_BLIND_MIN
    ? `盲盒需可售库存 ≥${BM_BLIND_MIN} 件（当前 ${n} 件，可开摊）。`
    : `盲盒需可售库存 ≥${BM_BLIND_MIN} 件（当前 ${n} 件，不足无法开摊）。`;
}

export function confirmBmOpenStall() {
  if (!guardBmFeature("bmStall")) return;
  const modal = document.getElementById("bmOpenModal");
  if (bmUi.openType === "blindbox" && bmSellables().length < BM_BLIND_MIN) {
    showToast({
      text: `库存不足 ${BM_BLIND_MIN} 件，无法开设盲盒摊。请先去公盘/交易行备料。`,
      tone: "warn"
    });
    syncBmOpenTypeHint();
    return;
  }
  const title = modal?.querySelector("#bmOpenTitle")?.value?.trim() || "";
  const blurb = modal?.querySelector("#bmOpenBlurb")?.value?.trim() || "";
  const anonymous = Boolean(modal?.querySelector("#bmOpenAnonymous")?.checked);
  socketRef.emit("bmOpenStall", {
    type: bmUi.openType,
    title,
    blurb,
    anonymous
  });
  if (modal) modal.hidden = true;
}

export function openBmBuy(listingId, stallId) {
  if (!guardBmFeature("bmBuy")) return;
  const stall = bmStallById(stallId);
  const row = (stall?.items || []).find((r) => r.id === listingId);
  if (!stall || !row || stall.isMine) return;
  bmUi.buyStallId = stallId;
  bmUi.buyListingId = listingId;
  bmUi.buyPrice = row.price;
  const modal = elsRef.bmBuyModal || document.getElementById("bmBuyModal");
  const body = elsRef.bmBuyBody || document.getElementById("bmBuyBody");
  if (!modal || !body) return;
  const roster = getState()?.me?.workshop?.workers || [];
  const payroll = getState()?.me?.employeePayroll;
  const blocked = row.type === "employee" && (roster.length >= 8 ? "员工名额已满（8/8）" : payroll?.debt > 0 || payroll?.status === "stopped" ? "请先结清欠薪并复工" : "");
  const can = bmAffordable(row.price) && !blocked;
  const cash = Number(getState()?.me?.cash || 0);
  const balanceAfter = cash - Number(row.price || 0);
  const confirmBtn = modal.querySelector("[data-action='confirmBmBuy']");
  if (confirmBtn) {
    confirmBtn.disabled = !can;
    confirmBtn.textContent = can
      ? `支付 ${formatMoney(row.price)}`
      : blocked || `现金不足 · 还差 ${formatMoney(Math.abs(balanceAfter))}`;
  }
  const item = row.item;
  const profile = deriveMaterialProfile(item);
  const comparison = goodsPriceComparison(row);
  const delta = marketPriceDelta(comparison.totalCost, comparison.referencePrice);
  body.innerHTML = `
    <div class="jm-buy-detail">
      ${["employee", "equipment"].includes(row.type) ? `${blackmarketResourceCard(row, {
        npc: stall.npc, className: "resource-card--compact", body: specialGoodsChips(row)
      })}<div class="jm-buy-seller">${escapeHtml(stall.displayName)} · ${bmRatingPublicHtml(stall)}</div>${npcGoodsInfo(row, { npc: stall.npc, showSavings: true })}` : `<div class="jm-buy-hero">
        <div class="jm-buy-visual">${isSpecialGoods(row) ? specialGoodsVisual(row) : marketItemVisual(item, { eager: true })}</div>
        <div class="jm-buy-copy">
          <div class="jm-nm">${escapeHtml(item.name)}</div>
          ${isSpecialGoods(row) ? specialGoodsChips(row) : marketCardAttrChips(item, row.type, profile)}
          <div class="jm-buy-seller">${escapeHtml(stall.displayName)} · ${bmRatingPublicHtml(stall)}</div>
          ${npcGoodsInfo(row, { npc: stall.npc, showSavings: true })}
        </div>
      </div>`}
      <div class="jm-fee">
        <div><span>挂牌价</span><span>${formatMoney(row.price)}</span></div>
        <div><span>${comparison.referenceLabel}</span><span>${formatMoney(comparison.referencePrice)} <span class="jm-delta ${delta.cls}">${escapeHtml(delta.txt)}</span></span></div>
        <div class="total"><span>你需支付</span><span>${formatMoney(row.price)}</span></div>
      </div>
      ${row.type === "employee" ? `<p class="bm-npc-note">接收后员工人数 ${roster.length + 1}/8 · ${blocked || "保留技能和经验，加入当天记薪"}</p>` : ""}
      ${isSpecialGoods(row) || stall.npc ? `<p class="bm-npc-note">${escapeHtml(npcPurchaseDestination(row))}</p>` : ""}
      ${row.type === "rough" && !item.revealed && (item.materialStage || item.stage || "rough") === "rough" ? '<p class="bm-npc-note">自购暗料有开亏风险，参考估值不保证回本。</p>' : ""}
    </div>`;
  paintJadeCanvases(body);
  modal.hidden = false;
}

export function confirmBmBuy() {
  if (!guardBmFeature("bmBuy")) return;
  if (!bmUi.buyStallId || !bmUi.buyListingId) return;
  socketRef.emit("bmBuyListing", { stallId: bmUi.buyStallId, listingId: bmUi.buyListingId, expectedPrice: bmUi.buyPrice });
  closeBmModals();
  bmUi.buyStallId = null;
  bmUi.buyListingId = null;
}

export function resolveBmRatingPrice(rating) {
  const direct = Number(rating?.price ?? rating?.amount ?? 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const tradeId = String(rating?.tradeId || "");
  if (tradeId) {
    const order = (getState()?.blackServiceOrders || []).find((row) => String(row.id) === tradeId);
    const fromOrder = Number(order?.price || 0);
    if (Number.isFinite(fromOrder) && fromOrder > 0) return fromOrder;
  }
  const label = String(rating?.itemName || rating?.itemLabel || "").trim();
  if (label) {
    const ledger = getState()?.me?.ledger || [];
    for (let i = ledger.length - 1; i >= 0; i -= 1) {
      const entry = ledger[i];
      const note = String(entry?.note || "");
      if (!note.includes(label)) continue;
      const amount = Math.abs(Number(entry.amount || entry.total || 0));
      if (Number.isFinite(amount) && amount > 0) return amount;
    }
  }
  return 0;
}

export function bmRatingModalShell() {
  const modal = document.getElementById("bmRatingModal");
  const body = document.getElementById("bmRatingBody");
  const title = modal?.querySelector(".jm-modal-head h3");
  const sub = modal?.querySelector(".bm-rate-modal-sub");
  const countEl = modal?.querySelector(".bm-rate-modal-count");
  return { modal, body, title, sub, countEl };
}

export function bmRatingKindLabel(tradeKind) {
  return ({
    goods: "卖物品成交",
    blindbox: "盲盒成交",
    service: "技术委托完成"
  })[tradeKind] || "黑市成交";
}

export function bmRatingOrderTitle(r) {
  return bmPendingRatingLine(r) || r.itemName || r.itemLabel || "成交订单";
}

export function bmRatingOrderMeta(r) {
  const kind = bmRatingKindLabel(r.tradeKind);
  const peer = r.anonymous
    ? `${r.counterpartyName || "对方"}（匿名）`
    : (r.counterpartyName || "对方");
  const price = resolveBmRatingPrice(r);
  const when = r.createdAt ? marketElapsed(r.createdAt) : "刚刚";
  const bits = [kind, peer];
  if (price > 0) bits.push(formatMoney(price));
  bits.push(when);
  return bits.join(" · ");
}

export function bmRateListHtml(pending) {
  const rows = pending.map((r) => `
    <div class="bm-rate-order-row">
      <div class="bm-rate-order-copy">
        <strong>${escapeHtml(bmRatingOrderTitle(r))}</strong>
        <span>${escapeHtml(bmRatingOrderMeta(r))}</span>
      </div>
      <button class="jm-hero-btn primary" data-action="openBmRatingForm" data-payload="${escapeHtml(r.id)}" type="button">去评价</button>
    </div>`).join("");
  return `<div class="bm-rate-order-list" role="list">${rows}</div>`;
}

export function bmRateCardHtml(r) {
  const kind = bmRatingKindLabel(r.tradeKind);
  const itemTitle = bmRatingOrderTitle(r);
  const price = resolveBmRatingPrice(r);
  const tradeShort = String(r.tradeId || r.id || "").slice(0, 8).toUpperCase();
  const when = r.createdAt ? marketElapsed(r.createdAt) : "刚刚";
  const counterparty = r.anonymous
    ? `${r.counterpartyName || "对方"}（匿名摊）`
    : (r.counterpartyName || "对方");
  const detailRows = [
    ["对方", counterparty],
    ["成交价", price > 0 ? formatMoney(price) : "—"],
    ["摊位", r.stallTitle || "—"],
    ["成交时间", when],
    ["订单号", tradeShort ? `#${tradeShort}` : "—"]
  ];
  if (r.tradeKind === "service" && r.inputItemName) {
    detailRows.splice(1, 0, ["委托物料", r.inputItemName]);
  }
  if (r.tradeKind === "blindbox" && r.itemName && r.itemName !== "盲盒") {
    detailRows.splice(1, 0, ["拆出货品", r.itemName]);
  }
  if (r.note) detailRows.push(["备注", r.note]);
  const facts = detailRows.map(([k, v]) => `
    <div class="bm-rate-fact">
      <span>${escapeHtml(k)}</span>
      <b>${escapeHtml(String(v))}</b>
    </div>`).join("");
  return `
    <article class="bm-rate-card" data-rating-id="${escapeHtml(r.id)}">
      <div class="bm-rate-card-head">
        <span class="bm-rate-kind">${escapeHtml(kind)}</span>
      </div>
      <h4 class="bm-rate-title">${escapeHtml(itemTitle)}</h4>
      <div class="bm-rate-facts">${facts}</div>
      <div class="bm-rate-actions">
        <div class="bm-rate-stars" role="group" aria-label="选择星级">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="bm-star-btn${n === 5 ? " active" : ""}" data-action="bmPickStar" data-payload="${n}" data-rating-id="${escapeHtml(r.id)}">${n}★</button>`).join("")}
        </div>
        <button class="jm-hero-btn primary bm-rate-submit" data-action="bmSubmitRating" data-payload="${escapeHtml(r.id)}" type="button">提交评价</button>
      </div>
    </article>`;
}

/** 顶栏「待评价」：可滚动订单列表 */
export function openBmRatingModal() {
  const pending = bmPendingRatings();
  const { modal, body, title, sub, countEl } = bmRatingModalShell();
  if (!modal || !body) return;
  if (!pending.length) {
    showToast("暂无待评价交易。");
    return;
  }
  if (title) title.textContent = "待评价";
  if (sub) {
    sub.hidden = false;
    sub.textContent = "成交后请为对方打客户评级 · 点右侧进入打分";
  }
  if (countEl) {
    countEl.hidden = false;
    countEl.textContent = `${pending.length} 笔`;
  }
  body.classList.add("is-rate-list");
  body.innerHTML = bmRateListHtml(pending);
  modal.hidden = false;
}

/** 列表行「去评价」：进入该笔打分 */
export function openBmRatingForm(ratingId) {
  const pending = bmPendingRatings();
  const { modal, body, title, sub, countEl } = bmRatingModalShell();
  if (!modal || !body) return;
  const target = ratingId
    ? pending.find((r) => r.id === ratingId)
    : pending[0];
  if (!target) {
    showToast("暂无待评价交易。");
    modal.hidden = true;
    return;
  }
  if (title) title.textContent = "客户评级";
  if (sub) {
    sub.hidden = false;
    sub.textContent = "核对成交订单后再打分，避免评错人";
  }
  if (countEl) countEl.hidden = true;
  body.classList.remove("is-rate-list");
  body.innerHTML = bmRateCardHtml(target);
  bmUi.ratingStars = 5;
  modal.hidden = false;
}

export function closeBmModals() {
  const drawModal = document.getElementById("bmBlindDrawModal");
  if (drawModal && !drawModal.hidden && bmUi.blindDraw) {
    requestBmBlindDrawClose();
    return;
  }
  const mine = bmMyStall();
  const closingList = !(document.getElementById("bmListModal")?.hidden);
  const closingBlindManage = isBmBlindManageModalOpen();
  const closingService = !(document.getElementById("bmServiceOfferModal")?.hidden);
  bmUi.pendingWithdrawId = null;
  for (const id of [
    "bmListModal", "bmBuyModal", "bmOpenModal", "bmBlindStockModal",
    "bmBlindMetaModal", "bmServiceOfferModal", "bmServiceProfileModal", "bmServiceInfoModal", "bmRatingModal", "bmWithdrawConfirmModal",
    "bmOrderServiceModal"
  ]) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }
  if (closingBlindManage) {
    closeBmBlindManageModal({ skipSetupGuard: false });
    return;
  }

  // 开摊引导中点「取消/关闭」：视为放弃摆摊并收摊，避免又被强制弹回补货窗
  if (!bmStallInSetup(mine) || !socketRef) return;
  const incomplete = mine.type === "goods"
    ? !(mine.items || []).length
    : mine.type === "blindbox"
      ? (mine.poolCount ?? mine.pool?.length ?? 0) < BM_BLIND_MIN
      : !(mine.offers || []).length;
  if (!incomplete) return;
  const closingSetupModal = (closingList && mine.type === "goods")
    || (closingService && mine.type === "service");
  if (!closingSetupModal) return;
  bmUi.pendingSetupType = null;
  socketRef.emit("bmCloseStall");
}
