// Material/worker selection, search, sorting and picker lifecycle.
import { isBangle } from "../../../shared/domain/workshop/bangle-finish.js";
import { renderWorkerDetailPanel, workerJobLabel } from "../../worker-detail-view.js";
import { renderResourceCard } from "../../resource-card-view.js";
import { observeLazyPreviews } from "../../lazy-preview.js";
import { deviceStep } from "./catalog.js";

export function createWorkshopPicker({ ui, document, helpers, ports }) {
  const { formatMoney, escapeHtml, typeName, materialStageForClient, materialStageLabel } = helpers;
  const { tierLabel, renderWorkerMiniScores, renderWorkerMiniTraitChips, workshopDevices, workshopWorkers, isWorkshopLeftoverMaterial, workshopProcessableItems, workshopHeldJadeItems, workshopStageItems, workshopItemPreview, renderWorkshop, workshopSelectItem, workerStepPreview, workshopAssignWorker } = ports;

function workshopPickerEmptyHint(device) {
  const needLabel = materialStageLabel(device.inputStage);
  const held = workshopHeldJadeItems();
  const wrongStage = held.filter((item) => {
    const stage = materialStageForClient(item);
    return stage && stage !== "unknown" && stage !== device.inputStage;
  });
  const guideLines = {
    rough: ["请先到「开料」页签，", "用开料机处理暗料原石。"],
    opened: ["请先到「开料」页签，", "用开料机把暗料原石开成明料。"],
    carved: ["请先到「规划」页签，", "在明料上摆套件并取件。"],
    polished: ["请先完成上一道工序。"]
  }[device.inputStage] || [`当前设备需要「${needLabel}」。`];

  // 不走 empty()：这里需要保留分层的说明结构，帮助玩家判断下一步。
  if (!held.length) {
    return `<div class="game-empty-state is-compact ws-picker-empty">`
      + `<span class="game-empty-state-mark" aria-hidden="true">料</span>`
      + `<strong>没有可用的${escapeHtml(needLabel)}</strong>`
      + `<p>当前没有可用于${escapeHtml(device.name)}的材料。先去公盘或交易行进料，再回到这里选料。</p>`
      + `</div>`;
  }
  if (wrongStage.length) {
    const hintHtml = guideLines
      .map((line) => escapeHtml(line))
      .join("<br>");
    return `<div class="game-empty-state is-compact ws-picker-empty">`
      + `<span class="game-empty-state-mark" aria-hidden="true">序</span>`
      + `<strong>材料工序还没到</strong>`
      + `<p>当前设备需要${escapeHtml(needLabel)}。${hintHtml}</p>`
      + `</div>`;
  }
  return `<div class="game-empty-state is-compact ws-picker-empty">`
    + `<span class="game-empty-state-mark" aria-hidden="true">料</span>`
    + `<strong>没有可用的${escapeHtml(needLabel)}</strong>`
    + `<p>当前没有符合${escapeHtml(device.name)}要求的材料。</p>`
    + `</div>`;
}

function pickerRootEl() {
  let el = document.getElementById("ws-picker-root");
  if (!el) {
    el = document.createElement("div");
    el.id = "ws-picker-root";
    document.body.appendChild(el);
  }
  return el;
}

function buildPickerShell(picker, device) {
  const kind = picker.kind;
  const isMaterial = kind === "material";
  const title = isMaterial ? "选择石头" : "选择员工";
  const stepClass = `step-${deviceStep(device) || "open"}`;
  const verb = isMaterial ? "挑选料子" : "指派工匠";
  return `
    <div class="ws-picker-overlay">
      <div class="ws-picker-modal ${stepClass} kind-${kind}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="ws-picker-head">
          <div class="wsp-head-text">
            <h3>${escapeHtml(title)}</h3>
            <p>为「${escapeHtml(device.name)}」${verb}</p>
          </div>
          <button class="ws-picker-close" data-action="closeWorkshopPicker" type="button" aria-label="关闭">×</button>
        </div>
        <div class="wsp-toolbar">
          <span class="wsp-count" role="status" aria-live="polite"></span>
          <input class="wsp-search" type="search" placeholder="搜索${isMaterial ? "料子名称" : "工匠"}…" aria-label="搜索${isMaterial ? "可加工料子" : "可用员工"}" />
        </div>
        ${kind === "worker" ? `
        <div class="wsp-toolbar-extra">
          <div class="wsp-toolbar-group" role="group" aria-label="排序">
            <button class="wsp-toolbar-btn ${ui.activeWorkerSort === "default" ? "is-active" : ""}" data-action="setWorkerSort" data-sort="default" type="button" aria-pressed="${ui.activeWorkerSort === "default"}">默认</button>
            <button class="wsp-toolbar-btn ${ui.activeWorkerSort === "quality" ? "is-active" : ""}" data-action="setWorkerSort" data-sort="quality" type="button" aria-pressed="${ui.activeWorkerSort === "quality"}">工分</button>
            <button class="wsp-toolbar-btn ${ui.activeWorkerSort === "flawless" ? "is-active" : ""}" data-action="setWorkerSort" data-sort="flawless" type="button" aria-pressed="${ui.activeWorkerSort === "flawless"}">完美度</button>
            <button class="wsp-toolbar-btn ${ui.activeWorkerSort === "speed" ? "is-active" : ""}" data-action="setWorkerSort" data-sort="speed" type="button" aria-pressed="${ui.activeWorkerSort === "speed"}">提速</button>
          </div>
        </div>
        ` : ""}
        <div class="ws-picker-content"></div>
        <div class="wsp-search-empty game-empty-state" hidden>
          <span class="game-empty-state-mark" aria-hidden="true">寻</span>
          <strong>没有匹配结果</strong>
          <p>换一个关键词，或清除搜索查看全部可选项。</p>
          <button class="secondary" data-wsp-search-reset type="button">清除搜索</button>
        </div>
      </div>
    </div>`;
}

function buildPickerContent(picker, device) {
  const isMaterial = picker.kind === "material";
  if (isMaterial) {
    const items = workshopProcessableItems(device);
    const list = items.length
      ? items.map((item) => {
        const leftover = isWorkshopLeftoverMaterial(item);
        const tagClass = item.escrowOrderId ? "escrow" : leftover ? "leftover" : "ok";
        const tagLabel = item.escrowOrderId ? "委托物" : leftover ? "余料" : "可加工";
        return `
        <button class="ws-picker-item ws-pick-material${item.escrowOrderId ? " is-escrow" : ""}${leftover ? " is-leftover" : ""}" data-action="pickWorkshopItem" data-payload="${item.id}" type="button">
          <span class="wsp-thumb">${workshopItemPreview(item, device, { lazy: true })}</span>
          <span class="wsp-thumb-meta">
            <strong>${escapeHtml(item.name)}${item.escrowOrderId ? '<em class="wsp-escrow-tag">委托</em>' : ""}${leftover ? '<em class="wsp-leftover-tag">余料</em>' : ""}</strong>
            <em>${escapeHtml(materialStageLabel(item))} · ${escapeHtml(typeName(item.type, item))}${item.escrowOrderId ? " · 黑市委托" : leftover ? " · 已取件残料" : ""}</em>
          </span>
          <span class="wsp-thumb-foot">
            <span class="wsp-value">${formatMoney(item.value || item.price)}</span>
            <span class="wsp-tag ${tagClass}">${tagLabel}</span>
          </span>
        </button>`;
      }).join("")
      : workshopPickerEmptyHint(device);
    return `<div class="ws-picker-list picker-material">${list}</div>`;
  }
  let workers = workshopWorkers();
  // 排序（默认按品阶降序；其余按本工序对应指标排序）
  if (ui.activeWorkerSort !== "default") {
    workers = [...workers].sort((a, b) => {
      const pa = workerStepPreview(a, deviceStep(device));
      const pb = workerStepPreview(b, deviceStep(device));
      if (ui.activeWorkerSort === "quality") return pb.quality - pa.quality;
      if (ui.activeWorkerSort === "flawless") { const r = (x) => x.perfectLabel === "完美" ? 2 : x.perfectLabel === "瑕疵" ? 0 : 1; return r(pb) - r(pa); }
      if (ui.activeWorkerSort === "speed") return pb.speed - pa.speed;
      return 0;
    });
  } else {
    workers = [...workers].sort((a, b) => (Number(b.tier) || 1) - (Number(a.tier) || 1));
  }
  const detail = ui.activePickerWorkerId && workers.find((w) => w.id === ui.activePickerWorkerId)
    || workshopWorkers().find((w) => w.id === ui.activePickerWorkerId); // 详情固定显示当前临时选中的员工（即使被筛掉也照显示）
  const list = workers.map((worker) => {
    const active = worker.id === ui.activePickerWorkerId;
    const assigned = worker.id === device.workerId;
    return renderResourceCard({
      type: "employee", name: worker.name, badge: worker.busy ? "工作中" : assigned ? "已指派" : active ? "当前预览" : "可选员工",
      tag: "button", className: `ws-picker-item ws-pick-worker ${active ? "is-active" : ""} ${assigned ? "is-assigned" : ""}`,
      attributes: `data-action="pickWorkshopWorker" data-payload="${escapeHtml(device.id)}" data-worker-id="${escapeHtml(worker.id)}" type="button" aria-pressed="${active}" ${worker.busy ? "disabled" : ""}`,
      summary: [`${workerJobLabel(worker.job)} · ${tierLabel(worker)}`],
      body: `<span class="wsp-worker-traits">${renderWorkerMiniTraitChips(worker)}</span>${renderWorkerMiniScores(worker, deviceStep(device))}`
    });
  }).join("");
  const side = detail ? renderWorkerDetail(detail, device) : `<div class="wsp-pick-side empty"><div class="wsp-pick-side-hint">← 在左侧点选员工，查看完整技能与词条</div></div>`;
  return `<div class="ws-picker-body"><div class="ws-picker-list picker-worker">${list}</div>${side}</div>`;
}

function applyPickerSearch(rootEl) {
  const search = rootEl.querySelector(".wsp-search");
  if (!search) return;
  const q = search.value.trim().toLowerCase();
  const items = rootEl.querySelectorAll(".ws-picker-item");
  let visible = 0;
  items.forEach((el) => {
    const hit = !q || el.textContent.toLowerCase().includes(q);
    el.classList.toggle("is-hidden", !hit);
    if (hit) visible += 1;
  });
  const countEl = rootEl.querySelector(".wsp-count");
  if (countEl) countEl.textContent = q ? `匹配 ${visible} / 共 ${items.length} 项` : `共 ${items.length} 项`;
  const noMatch = Boolean(q) && visible === 0;
  rootEl.querySelector(".ws-picker-content")?.classList.toggle("is-filter-empty", noMatch);
  const emptyState = rootEl.querySelector(".wsp-search-empty");
  if (emptyState) emptyState.hidden = !noMatch;
}

function attachPickerSearch(rootEl) {
  const search = rootEl.querySelector(".wsp-search");
  if (!search) return;
  search.addEventListener("input", () => applyPickerSearch(rootEl));
  rootEl.querySelector("[data-wsp-search-reset]")?.addEventListener("click", () => {
    search.value = "";
    applyPickerSearch(rootEl);
    search.focus();
  });
}

function renderPicker() {
  const rootEl = pickerRootEl();
  if (!ui.activeWorkshopPicker) {
    if (rootEl.childElementCount) rootEl.innerHTML = "";
    ui.pickerMountKey = null;
    return;
  }
  const device = workshopDevices().find((d) => d.id === ui.activeWorkshopPicker.deviceId) || null;
  if (!device) {
    if (rootEl.childElementCount) rootEl.innerHTML = "";
    ui.pickerMountKey = null;
    return;
  }
  const key = `${ui.activeWorkshopPicker.kind}:${ui.activeWorkshopPicker.deviceId}`;
  if (ui.pickerMountKey !== key) {
    rootEl.innerHTML = buildPickerShell(ui.activeWorkshopPicker, device);
    const overlay = rootEl.querySelector(".ws-picker-overlay");
    if (overlay) overlay.addEventListener("click", (event) => { if (event.target === overlay) workshopClosePicker(); });
    attachPickerSearch(rootEl);
    ui.pickerMountKey = key;
  }
  const content = rootEl.querySelector(".ws-picker-content");
  if (content) {
    content.innerHTML = buildPickerContent(ui.activeWorkshopPicker, device);
    observeLazyPreviews(content);
  }
  applyPickerSearch(rootEl);
}

function renderWorkerDetail(worker, device) {
  const pv = workerStepPreview(worker, deviceStep(device));
  const assigned = worker.id === device.workerId;
  return renderWorkerDetailPanel({
    worker,
    step: deviceStep(device) === "finish" && isBangle(workshopStageItems().find((entry) => entry.id === ui.selectedWorkshopItemId)) ? "bangleFinish" : deviceStep(device),
    mode: "workshop",
    summaryHtml: renderWorkerMiniScores(worker, deviceStep(device)),
    footerHtml: `
      <button class="primary" data-action="confirmPickerWorker"
        data-payload="${device.id}" data-worker-id="${worker.id}" type="button"
        ${worker.busy ? "disabled" : ""}>
        ${worker.busy ? "正在执行其他任务" : assigned ? "已选择" : `选择 · 工分 ${pv.quality.toFixed(0)}`}
      </button>
    `
  });
}

function workshopOpenPicker(payload) {
  try { ui.activeWorkshopPicker = typeof payload === "string" ? JSON.parse(payload) : payload; }
  catch { ui.activeWorkshopPicker = null; }
  // 员工弹窗：默认选中当前设备已绑定的员工（让右侧详情一开就有内容）
  if (ui.activeWorkshopPicker && ui.activeWorkshopPicker.kind === "worker") {
    const devId = ui.activeWorkshopPicker.deviceId;
    const dev = workshopDevices().find((d) => d.id === devId);
    const workers = workshopWorkers();
    const fallback = dev?.workerId || (workers[0] && workers[0].id) || null;
    ui.activePickerWorkerId = (dev && dev.workerId && workers.some((w) => w.id === dev.workerId))
      ? dev.workerId
      : (workers[0] && workers[0].id) || null;
  } else {
    ui.activePickerWorkerId = null;
  }
  renderWorkshop();
  renderPicker();
}

function workshopClosePicker() {
  ui.activeWorkshopPicker = null;
  ui.activePickerWorkerId = null;
  renderWorkshop();
  renderPicker();
}

function workshopPickItem(payload) {
  ui.activeWorkshopPicker = null;
  workshopSelectItem(payload);
  renderPicker();
}

function workshopPickWorker(target, payload) {
  // 弹窗内点员工卡 = 只切换详情预览，不直接指派、不关闭
  const workerId = target.dataset.workerId || null;
  if (!workerId) return;
  ui.activePickerWorkerId = workerId;
  renderPicker(); // 只刷新弹窗内容区，不重建外壳、不重播动画 → 不再闪烁
}

function workshopSetSort(target) {
  const sort = target?.dataset?.sort;
  if (!sort) return;
  ui.activeWorkerSort = sort;
  // 同步工具栏按钮高亮（不重建外壳，只改 active 类）
  document.querySelectorAll(".wsp-toolbar-btn[data-action='setWorkerSort']").forEach((b) => {
    const on = b.dataset.sort === sort;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  renderPicker();
}

function workshopConfirmPickerWorker(target, payload) {
  // 详情面板点「指派此员工开工」= 真正指派并关闭弹窗
  const workerId = target.dataset.workerId || ui.activePickerWorkerId;
  if (!workerId) { workshopClosePicker(); return; }
  ui.activeWorkshopPicker = null;
  ui.activePickerWorkerId = null;
  ui.selectedWorkshopWorkerId = workerId;
  workshopAssignWorker({ dataset: { workerId } }, payload);
  renderWorkshop();
  renderPicker();
}

function disposeWorkshopPicker() {
  ui.activeWorkshopPicker = null;
  ui.activePickerWorkerId = null;
  ui.pickerMountKey = null;
  document?.getElementById("ws-picker-root")?.remove();
}

  return { workshopPickerEmptyHint, pickerRootEl, buildPickerShell, buildPickerContent, applyPickerSearch, attachPickerSearch, renderPicker, renderWorkerDetail, workshopOpenPicker, workshopClosePicker, workshopPickItem, workshopPickWorker, workshopSetSort, workshopConfirmPickerWorker, disposeWorkshopPicker };
}
