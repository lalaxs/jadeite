import { resourceSaleBlock } from "../../../shared/domain/blackmarket/bm-resources.js";
import { equipmentSaleBlockReason } from "../../equipment-trading.js";
// Existing workshop templates and incremental progress rendering.
import { payrollWorkNotice } from "../../payroll-work-notice.js";
import { employeePayrollStatus } from "../../worker-economy.js";
import { nowMs as payrollNowMs } from "../../shell/format-utils.js";
import { renderEquipmentParamPills } from "../../equipment-param-view.js";
import { renderResourceCard } from "../../resource-card-view.js";
import { workerJobLabel } from "../../worker-detail-view.js";
import { WORKSHOP_STEPS, deviceStep, workshopDeviceTypeLabel } from "./catalog.js";

export function createWorkshopView({ ui, getState, elsRef, helpers, ports }) {
  const { formatMoney, formatDuration, escapeHtml, nowMs, materialStageForClient, materialStageLabel, kitsFor } = helpers;
  const { tierLabel, craftGradeBadge, craftScoreLine, flawClass, workshopDevices, workshopWorkers, workshopWorkerFor, workshopJobs, workshopProcessableItems, workshopRepairQuote, workshopJobEstimate, workshopItemPreview, workshopRefreshPlanner, workerStepPreview, patchInlayPreviewTester } = ports;

function workshopJobProgress(job) {
  const remainMs = Math.max(0, Number(job.readyAt || 0) - nowMs());
  const startedAt = Number(job.startedAt || 0);
  const readyAt = Number(job.readyAt || 0);
  const total = Math.max(1, readyAt - (startedAt || readyAt - 1));
  const elapsed = Math.max(0, Math.min(total, nowMs() - (startedAt || nowMs())));
  // 与侧栏一致：起步至少露出一点填充，避免「空槽」错觉
  const progress = Math.max(2, Math.min(100, Math.round((elapsed / total) * 100)));
  const jobKey = escapeHtml(job.id || `${job.deviceId || ""}-${job.startedAt || ""}-${job.item?.name || ""}`);
  return `
    <div class="machine-row inline-machine" data-workshop-job="${jobKey}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}" aria-label="加工进度">
      <div class="machine-top">
        <strong>${escapeHtml(job.item?.name || "加工中")}</strong>
        <p class="machine-eta" data-workshop-job-eta>还需 ${formatDuration(remainMs)}</p>
      </div>
      <div class="machine-track"><i data-workshop-job-bar class="${progress >= 100 ? "done" : ""}" style="width:${progress}%"></i></div>
    </div>
  `;
}

function tickWorkshopJobProgress() {
  const root = elsRef?.workshopRoot;
  if (!root || typeof nowMs !== "function") return;
  const nodes = [...root.querySelectorAll("[data-workshop-job]")];
  if (!nodes.length) return;
  const jobs = workshopJobs();
  for (const node of nodes) {
    const key = node.dataset.workshopJob || "";
    const job = jobs.find((entry) => {
      const entryKey = String(entry.id || `${entry.deviceId || ""}-${entry.startedAt || ""}-${entry.item?.name || ""}`);
      return entryKey === key;
    });
    if (!job) continue;
    const remainMs = Math.max(0, Number(job.readyAt || 0) - nowMs());
    const startedAt = Number(job.startedAt || 0);
    const readyAt = Number(job.readyAt || 0);
    const total = Math.max(1, readyAt - (startedAt || readyAt - 1));
    const elapsed = Math.max(0, Math.min(total, nowMs() - (startedAt || nowMs())));
    const progress = Math.max(2, Math.min(100, Math.round((elapsed / total) * 100)));
    const eta = node.querySelector("[data-workshop-job-eta]");
    const bar = node.querySelector("[data-workshop-job-bar]");
    if (eta) eta.textContent = `还需 ${formatDuration(remainMs)}`;
    if (bar) {
      bar.style.width = `${progress}%`;
      bar.classList.toggle("done", progress >= 100);
    }
    node.setAttribute("aria-valuenow", String(progress));
  }
}

function workshopRecipeCard(device) {
  const jobs = workshopJobs(device.id);
  const current = jobs[0];
  const durability = Number(device.condition ?? device.durability ?? 100);
  const typeLabel = workshopDeviceTypeLabel(device);
  const paramPills = renderEquipmentParamPills(device.attrs, escapeHtml, { containerTag: "span", className: "wrc-param-pills", interactive: false });
  const durClass = durability > 80 ? "high" : durability > 50 ? "mid" : "low";
  return renderResourceCard({
    type: "equipment", stage: device.stage, name: device.name, badge: typeLabel,
    tag: "button", className: "workshop-recipe-card",
    attributes: `data-action="openWorkshopDevice" data-payload="${escapeHtml(device.id)}" type="button"`,
    body: `<span class="wrc-durability">
        <span class="wrc-dur-meta">
          <span class="wrc-dur-label">耐久 ${durability}%</span>
        </span>
        <span class="wrc-dur-track"><span class="wrc-dur-fill ${durClass}" style="width:${durability}%"></span></span>
      </span>
      ${paramPills}`,
    footer: `<span class="wrc-foot">
        <span class="recipe-card-current">${current ? `加工中：${escapeHtml(current.item?.name || "物料")}` : "设备空闲"}</span>
      </span>`
  });
}

function workshopStepTabs() {
  return `
    <div class="workshop-step-tabs" role="tablist" aria-label="工坊工序">
      ${WORKSHOP_STEPS.map((step) => {
        const active = step.id === ui.activeWorkshopStep;
        return `
        <button class="workshop-step-tab ${active ? "active" : ""}" id="workshopStepTab-${step.id}" data-action="selectWorkshopStep" data-payload="${step.id}" type="button" role="tab" aria-controls="workshopStepPanel" aria-selected="${active}" tabindex="${active ? "0" : "-1"}">
          <span class="wst-photo" aria-hidden="true"></span>
          <span class="wst-tint" aria-hidden="true"></span>
          <span class="wst-shade" aria-hidden="true"></span>
          ${active ? `<span class="wst-current-badge" aria-hidden="true">当前</span>` : ""}
          <span class="wst-content">
            <span class="wst-label">${escapeHtml(step.label)}</span>
            <span class="wst-desc">${escapeHtml(step.desc)}</span>
          </span>
        </button>
      `;
      }).join("")}
    </div>
  `;
}

function workshopRecipeHome(devices) {
  const stepDevices = devices.filter((device) => deviceStep(device) === ui.activeWorkshopStep);
  const step = WORKSHOP_STEPS.find((s) => s.id === ui.activeWorkshopStep) || WORKSHOP_STEPS[0];
  const emptyStep = `
    <div class="game-empty-state workshop-step-empty">
      <span class="game-empty-state-mark" aria-hidden="true">工</span>
      <strong>暂无${escapeHtml(step.label)}设备</strong>
      <button type="button" data-view-link="shop">前往商铺购买</button>
    </div>`;
  return `
    <div class="workshop-recipe-home">
      ${workshopStepTabs()}
      <section id="workshopStepPanel" class="workshop-step-panel" role="tabpanel" aria-labelledby="workshopStepTab-${ui.activeWorkshopStep}">
        <div class="workshop-recipe-grid">
          ${stepDevices.map(workshopRecipeCard).join("") || emptyStep}
        </div>
      </section>
    </div>
  `;
}

function workshopMaterialRow(device, item) {
  const selected = ui.selectedWorkshopItemId === item.id;
  return `
    <button class="workshop-material-card ${selected ? "selected" : ""}" data-action="selectWorkshopItem" data-payload="${item.id}" type="button">
      ${workshopItemPreview(item, device)}
      <span>
        <strong>${escapeHtml(item.name)}</strong>
        <em>${escapeHtml(materialStageLabel(item))} · ${formatMoney(item.value || item.price)}</em>
      </span>
    </button>
  `;
}

function workshopRecipeSummary(device, selected) {
  if (!selected) {
    return `
      <section class="workshop-recipe-summary empty-summary">
        <h4>等待物料</h4>
        <p>请选择左侧料子后开始加工。</p>
      </section>`;
  }
  const estimate = workshopJobEstimate(device, selected);
  const kits = device.stage === "carving" ? kitsFor(selected.id) : [];
  const needsKits = device.stage === "carving" && !kits.length;
  const planReady = device.stage !== "carving" || kits.length > 0;
  const planStep = device.stage === "carving" ? `
    <div class="wrs-plan-step ${planReady ? "is-ready" : "is-pending"}">
      <div>
        <strong>${planReady ? `已规划 ${kits.length} 件` : "尚未规划"}</strong>
        <p>${planReady
          ? "点击查看或修改石头与套件布局。"
          : "完成规划后才会出现开工按钮。"}</p>
      </div>
      <button
        class="${planReady ? "secondary" : "primary"}"
        data-action="openWorkshopPlanner"
        data-payload="${device.id}"
        type="button"
      >${planReady ? "查看 / 修改" : "规划套件"}</button>
    </div>
  ` : "";
  const busy = Boolean(device.blackmarketListingId) || workshopJobs(device.id).length >= 1;
  const broken = Number(device.condition ?? 100) <= 0;
  const worker = (ui.selectedWorkshopWorkerId && workshopWorkers().find((w) => w.id === ui.selectedWorkshopWorkerId)) || workshopWorkerFor(device);
  const workerBusy = Boolean(worker?.busy);
  const cash = Number(getState()?.me?.cash || 0);
  const isFinish = device.stage === "finishing";
  const cashShort = !isFinish && cash < Number(estimate.fee || 0);
  const balanceAfter = cash - Number(estimate.fee || 0);
  const pv = worker ? workerStepPreview(worker, deviceStep(device)) : null;
  const workerEffectBlock = pv ? `
      <div class="wrs-block">
        <h4>员工 · ${escapeHtml(worker.name)}（${escapeHtml(tierLabel(worker))}）</h4>
        <div class="wrs-chips">
          <span class="wrs-chip"><em>工分</em><strong>${pv.quality.toFixed(0)}</strong></span>
          <span class="wrs-chip"><em>评级</em><strong>${craftGradeBadge(pv.grade)}</strong></span>
          <span class="wrs-chip"><em>提速</em><strong>${pv.speed > 0 ? "+" + pv.speed + "%" : "—"}</strong></span>
          <span class="wrs-chip"><em>完美度</em><strong>${pv.perfectLabel || "—"}</strong></span>
        </div>
      </div>` : `
      <div class="wrs-block">
        <h4>员工效果</h4>
        <div class="wrs-chips"><span class="wrs-chip muted">未选择员工</span></div>
      </div>`;
  const startLabel = broken
    ? "请先维修设备"
    : busy
      ? "设备加工中（容量 1）"
      : workerBusy
        ? "员工正在执行其他任务"
        : cashShort
          ? `现金不足 · 还差 ${formatMoney(Math.abs(balanceAfter))}`
          : isFinish ? "精加工方案" : "开工";
  const startActions = needsKits
    ? ""
    : `
      <div class="row-actions">
        <button
          class="primary"
          data-action="startWorkshopJob"
          data-payload="${device.id}"
          data-item-id="${selected.id}"
          type="button"
          ${busy || broken || workerBusy || cashShort ? "disabled" : ""}
        >${startLabel}</button>
      </div>`;
  return `
    <section class="workshop-recipe-summary">
      <div class="wrs-block">
        <h4>物料属性</h4>
        <div class="wrs-chips">
          <span class="wrs-chip"><em>料子</em><strong>${escapeHtml(selected.name)}</strong></span>
          <span class="wrs-chip"><em>花色</em><strong>${escapeHtml(selected.flower || selected.color || "—")}</strong></span>
          <span class="wrs-chip"><em>完美度</em><strong>${escapeHtml(selected.grade || "—")}</strong></span>
        </div>
      </div>
      ${workerEffectBlock}
      <div class="workshop-outcome-preview ${cashShort ? "is-short" : "is-safe"}" aria-label="本次加工预计结果">
        <div><span>预计产出</span><strong>${escapeHtml(estimate.output)}</strong></div>
        <div><span>预计耗时</span><strong>${isFinish ? "随工艺确定" : escapeHtml(estimate.duration)}</strong></div>
        <div><span>加工费用</span><strong>${estimate.fee ? formatMoney(estimate.fee) : "免费"}</strong></div>
      </div>
      ${planStep}
      ${startActions}
    </section>`;
}

function workshopBigMaterialCard(device, selected, { locked = false } = {}) {
  const payload = JSON.stringify({ kind: "material", deviceId: device.id });
  const interaction = locked
    ? 'aria-disabled="true"'
    : `role="button" tabindex="0" aria-label="${selected ? `更换石头：${escapeHtml(selected.name)}` : "选择石头"}" data-action="openWorkshopPicker" data-payload='${payload}'`;
  if (!selected) {
    return `
      <div class="ws-big-card ws-big-material empty ${locked ? "is-locked" : ""}" ${interaction}>
        <span class="ws-big-plus">+</span>
        <span class="ws-big-label">选择石头</span>
        ${locked ? `<span class="ws-big-locked-hint">加工中，暂不可更换</span>` : ""}
      </div>`;
  }
  return `
    <div class="ws-big-card ws-big-material ${locked ? "is-locked" : ""}" ${interaction}>
      ${workshopItemPreview(selected, device)}
      <div class="ws-big-meta">
        <strong>${escapeHtml(selected.name)}</strong>
        <em>${escapeHtml(materialStageLabel(selected))} · ${formatMoney(selected.value || selected.price)}</em>
        ${craftScoreLine(selected)}
      </div>
      ${locked ? `<span class="ws-big-locked-hint">加工中，暂不可更换</span>` : ""}
    </div>`;
}

function workshopBigWorkerCard(device, worker, { locked = false } = {}) {
  const payload = JSON.stringify({ kind: "worker", deviceId: device.id });
  const openWorkerButton = (label) => locked ? "" : `
    <button class="secondary small wsp-select-worker" data-action="openWorkshopPicker" data-payload='${payload}' type="button">${label}</button>`;
  if (!worker) {
    return `
      <div class="ws-big-card ws-big-worker empty ${locked ? "is-locked" : ""}" ${locked ? 'aria-disabled="true"' : `data-action="openWorkshopPicker" data-payload='${payload}'`}>
        <span class="ws-big-plus">+</span>
        <span class="ws-big-label">选择员工</span>
        ${locked
          ? `<span class="ws-big-locked-hint">加工中，暂不可更换</span>`
          : `<span class="ws-big-worker-actions"><button class="secondary small wsp-recommend" data-action="recommendWorkshopWorker" data-payload="${device.id}" type="button">智能推荐</button></span>`}
      </div>`;
  }
  const pv = workerStepPreview(worker, deviceStep(device));
  const flaws = [...(worker.traits || []).map((trait) => `<span class="trait-chip">${escapeHtml(trait)}</span>`), ...(worker.flaws || []).map((f) => `<span class="flaw-chip ${flawClass(f)}">${escapeHtml(f)}</span>`)].join("") || '<span class="flaw-chip muted">无词条</span>';
  return renderResourceCard({
    type: "employee", name: worker.name, badge: locked ? "加工中" : worker.busy ? "工作中" : "已选员工",
    className: `ws-big-card ws-big-worker ${locked ? "is-locked" : ""}`,
    attributes: locked ? 'aria-disabled="true"' : "",
    visualAttributes: locked ? "" : `data-action="openWorkshopPicker" data-payload='${escapeHtml(payload)}' aria-label="更换员工：${escapeHtml(worker.name)}"`,
    summary: [`${workerJobLabel(worker.job)} · ${tierLabel(worker)}`, worker.busy ? "工作中" : "空闲"],
    body: `<span class="ws-big-worker-preview">
        <span>工分 <strong>${pv.quality.toFixed(0)}</strong> ${craftGradeBadge(pv.grade)}</span>
        <span>提速 <strong>${pv.speed > 0 ? "+" + pv.speed + "%" : "—"}</strong></span>
        <span>完美度 <strong>${pv.perfectLabel || "—"}</strong></span>
      </span><span class="ws-big-worker-flaws">${flaws}</span>`,
    footer: locked
        ? `<span class="ws-big-locked-hint">加工中，暂不可更换</span>`
        : `<span class="ws-big-worker-actions">${openWorkerButton("更换员工")}<button class="secondary small wsp-recommend" data-action="recommendWorkshopWorker" data-payload="${escapeHtml(device.id)}" type="button">智能推荐</button></span>`
  });
}

function workshopWorkerColumn(device) {
  const current = workshopWorkerFor(device);
  const workers = workshopWorkers();
  const list = workers.map((worker) => {
    const on = worker.id === device.workerId;
    const pv = workerStepPreview(worker, deviceStep(device));
    const traits = (worker.traits || []).map((trait) => `<span class="trait-chip">${escapeHtml(trait)}</span>`).join("");
    return renderResourceCard({
      type: "employee", name: worker.name, badge: worker.busy ? "工作中" : on ? "已选" : "可选",
      tag: "button", className: `workshop-worker-card ${on ? "assigned" : ""}`,
      attributes: `data-action="assignWorkshopWorker" data-payload="${escapeHtml(device.id)}" data-worker-id="${escapeHtml(worker.id)}" type="button" aria-pressed="${on}" ${worker.busy ? "disabled" : ""}`,
      summary: [`${workerJobLabel(worker.job)} · ${tierLabel(worker)}`],
      body: `<span class="trait-row">${traits || '<span class="trait-chip muted">暂无特性</span>'}</span><span class="worker-mini">工分 ${pv.quality.toFixed(0)}（${pv.grade}） · 提速 ${pv.speed > 0 ? "+" + pv.speed + "%" : "—"} · 完美度 ${pv.perfectLabel || "—"}</span>`
    });
  }).join("");
  return `
    <div class="workshop-worker-column">
      <div class="workshop-column-head">
        <h4>排工 · 安排师傅</h4>
        <span>点选排到本台</span>
      </div>
      <div class="workshop-worker-grid">${list}</div>
      <button class="secondary small" data-action="recommendWorkshopWorker" data-payload="${device.id}" type="button">智能推荐</button>
      <p class="recipe-hint">当前已选：${escapeHtml(current.name)} · ${escapeHtml(tierLabel(current))}</p>
    </div>`;
}

function workshopRecipePage(device) {
  const jobs = workshopJobs(device.id);
  const busy = Boolean(device.blackmarketListingId) || jobs.length >= 1;
  const activeJob = jobs[0] || null;
  const items = workshopProcessableItems(device);
  if (ui.selectedWorkshopItemId && !items.some((item) => item.id === ui.selectedWorkshopItemId)) {
    ui.selectedWorkshopItemId = items[0]?.id || null;
  }
  let selected = ui.selectedWorkshopItemId ? items.find((item) => item.id === ui.selectedWorkshopItemId) || null : null;
  if (!selected && busy && activeJob?.item) selected = activeJob.item;
  let selectedWorker = ui.selectedWorkshopWorkerId
    ? workshopWorkers().find((w) => w.id === ui.selectedWorkshopWorkerId) || null
    : null;
  if (!selectedWorker && busy) {
    selectedWorker = workshopWorkers().find((w) => w.id === (activeJob?.workerId || device.workerId))
      || workshopWorkerFor(device);
  }

  const stepLabel = (WORKSHOP_STEPS.find((s) => s.id === deviceStep(device)) || {}).label || "";
  const tier = device.tier || 1;
  const durability = Number(device.condition ?? device.durability ?? 100);
  const brand = device.brand || "—";
  const modelName = device.modelName || device.model || "—";
  const brandPositioning = device.brandPositioning || device.profile || "—";
  const brandPeakPrice = Number(device.brandPeakPrice || 0);
  const durClass = durability > 80 ? "high" : durability > 50 ? "mid" : "low";

  const progressBlock = jobs.length
    ? `<section class="workshop-progress">${jobs.map(workshopJobProgress).join("")}</section>`
    : `<section class="workshop-progress job-empty"><span class="job-empty-text">暂未开工</span></section>`;

  const queueStrip = `<section class="workshop-queue-strip">${
    jobs.length
      ? `<div class="queue-row">单机任务：${escapeHtml(jobs[0].item?.name || "加工中")}（容量 1，无等待队列）</div>`
      : `<div class="queue-row muted">设备空闲（容量 1，无等待队列）</div>`
  }</section>`;
  const repairCost = workshopRepairQuote(device);
  const repairDisabled = Boolean(device.blackmarketListingId) || durability >= 100 || jobs.length > 0;
  const saleBlocked = equipmentSaleBlockReason(getState().me, device, getState());
  const blackSaleBlocked = resourceSaleBlock(getState().me, "equipment", device, getState()?.blackServiceOrders || []);

  return `
    <div class="workshop-recipe-page">
      <section class="workshop-recipe-page-head">
        <button class="back-link" data-action="backWorkshopDevices" type="button">← 返回</button>
        <div class="wsp-title">
          <h3>${escapeHtml(stepLabel)}</h3>
        </div>
      </section>

      <section class="machine-info-bar">
        <div class="mib-item name-item"><em>名字</em><strong>${escapeHtml(device.name)}</strong><span class="wsp-device-type-field">${escapeHtml(workshopDeviceTypeLabel(device))}</span></div>
        <div class="mib-item"><em>品牌</em><strong>${escapeHtml(brand)}</strong></div>
        <div class="mib-item"><em>品牌定位</em><strong>${escapeHtml(brandPositioning)}</strong></div>
        ${brandPeakPrice ? `<div class="mib-item"><em>旗舰价</em><strong>${formatMoney(brandPeakPrice)}</strong></div>` : ""}
        <div class="mib-item"><em>型号</em><strong>${escapeHtml(modelName)}</strong></div>
        <div class="mib-item"><em>等级</em><strong>${tier} 阶</strong></div>
        <div class="mib-item mib-param-pills"><em>参数</em>${renderEquipmentParamPills(device.attrs, escapeHtml, { className: "mib-equipment-param-pills" })}</div>
        <div class="mib-item mib-dura">
          <em>耐久 ${durability}%</em>
          <span class="mib-dura-track"><span class="mib-dura-fill ${durClass}" style="width:${durability}%"></span></span>
          <button class="secondary small" data-action="repairWorkshopDevice" data-payload="${device.id}" type="button" ${repairDisabled ? "disabled" : ""}>${jobs.length ? "加工中" : durability >= 100 ? "无需维修" : `维修 ${formatMoney(repairCost)}`}</button>
          <button class="secondary small" data-action="openMarketListModal" data-payload="${device.id}" type="button" title="${escapeHtml(saleBlocked || "出售闲置设备")}" ${saleBlocked ? "disabled" : ""}>挂牌出售</button>
          <button class="secondary small" data-action="sellBmResource" data-payload="${device.id}" type="button" title="${escapeHtml(blackSaleBlocked || "在黑市出售闲置设备")}" ${blackSaleBlocked ? "disabled" : ""}>${device.blackmarketListingId ? "黑市挂牌中" : "黑市出售"}</button>
        </div>
      </section>

      ${progressBlock}
      ${queueStrip}

      <section class="workshop-recipe-main">
        ${workshopBigMaterialCard(device, selected, { locked: busy })}
        ${workshopBigWorkerCard(device, selectedWorker, { locked: busy })}
        ${workshopRecipeSummary(device, selected)}
      </section>
    </div>
  `;
}

function renderWorkshop() {
  const devices = workshopDevices();
  const activeDevice = devices.find((device) => device.id === ui.activeWorkshopDeviceId) || null;
  if (ui.activeWorkshopDeviceId && !activeDevice) {
    ui.activeWorkshopDeviceId = null;
    ui.selectedWorkshopItemId = null;
  }
  const me = getState()?.me;
  const jobs = workshopJobs();
  // 规划草稿在客户端 Map，不进 state；指纹必须带上，否则确认规划后 DOM 不刷新，开工按钮不出现
  const planKitsSig = ui.selectedWorkshopItemId && typeof kitsFor === "function"
    ? (kitsFor(ui.selectedWorkshopItemId) || []).map((kit) => kit.id || kit.uid || "").join(",")
    : "";
  const fp = [
    ui.activeWorkshopDeviceId || "",
    ui.selectedWorkshopItemId || "",
    ui.selectedWorkshopWorkerId || "",
    ui.activeWorkshopStep || "",
    planKitsSig,
    me?.cash ?? 0,
    employeePayrollStatus(me, payrollNowMs()), me?.employeePayroll?.debt || 0,
    devices.map((device) => `${device.id}:${device.workerId || ""}:${device.condition || ""}:${device.busy ? 1 : 0}`).join("|"),
    jobs.map((job) => `${job.id || job.startedAt || ""}:${job.readyAt || ""}:${job.deviceId || job.stage || ""}`).join("|"),
    [...(me?.rough || []), ...(me?.materials || [])].map((item) => `${item.id}:${materialStageForClient(item)}`).join("|"),
    (me?.bracelets || []).map((item) => `${item.id}:${item.value ?? item.price ?? ""}`).join("|"),
    workshopWorkers().map((worker) => `${worker.id}:${worker.busy ? 1 : 0}:${worker.tier || ""}`).join("|")
  ].join("::");
  if ((fp !== ui.lastWorkshopRenderFp || !elsRef.workshopRoot?.childElementCount)) {
    ui.lastWorkshopRenderFp = fp;
    elsRef.workshopRoot.innerHTML = payrollWorkNotice(me, { now: payrollNowMs(), formatMoney })
      + (activeDevice ? workshopRecipePage(activeDevice) : workshopRecipeHome(devices));
  } else if (activeDevice && workshopJobs(activeDevice.id).length) {
    tickWorkshopJobProgress();
  }
  // 注意：选工/选料弹窗不再挂在 workshopRoot 内，改为挂到 body 下的独立容器（见 renderPicker），
  // 这样服务端每秒推送 state 触发 renderWorkshop 重建工坊页时，不会连带重建弹窗导致闪烁。
  if (ui.activeKitPlanner) workshopRefreshPlanner(ui.activeKitPlanner.itemId);
  if (ui.activeFinishPlanModal) ui.finishPlanController.refresh();
  if (ui.activeInlayPreviewTester) patchInlayPreviewTester();
}

  return { workshopJobProgress, tickWorkshopJobProgress, workshopRecipeCard, workshopStepTabs, workshopRecipeHome, workshopMaterialRow, workshopRecipeSummary, workshopBigMaterialCard, workshopBigWorkerCard, workshopWorkerColumn, workshopRecipePage, renderWorkshop };
}
