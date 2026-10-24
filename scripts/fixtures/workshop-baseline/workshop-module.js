// 工坊系统模块（从 main.js 抽离，依赖注入解耦）
import { payrollWorkNotice } from "../../payroll-work-notice.js";
import { employeePayrollStatus } from "../../worker-economy.js";
import { nowMs as payrollNowMs } from "../../shell/format-utils.js";
import {
  createFinishPlanDraft,
  normalizeFinishPlanDraft,
  validateFinishPlanDraft
} from "../../finish-plan-model.js";
import { finishGemPolicy, finishPieceRestriction } from "../../../shared/domain/workshop/finished-product-design.js";
import { isBangle, BANGLE_REFINEMENTS } from "../../../shared/domain/workshop/bangle-finish.js";
import { bangleFinishControls, patchBangleFinishUi } from "./bangle-finish-ui.js";
import { jadePiecePreviewMarkup } from "../../jade-piece-view.js";
import { cutoutPreviewSignature } from "../../preview-bitmap-cache.js";
import { createFinishPlanModalController } from "../../finish-plan-modal-controller.js";
import {
  patchFinishPlanSelectOptions,
  preserveFinishPlanUiState
} from "../../finish-plan-dom.js";
import { activateModalLifecycle } from "../../modal-lifecycle.js";
import { patchPlannerBody } from "../../planner-dom.js";
import { activeDragKit } from "../opening/opening-state.js";
import {
  renderWorkerDetailPanel
} from "../../worker-detail-view.js";
import {
  FLAW_DEFS,
  clamp,
  speedTimeScale,
  workerStepPreview as baseWorkerStepPreview
} from "../../workshop-craft-scoring.js";
import { workerProcessingFee } from "../../worker-economy.js";
import { equipmentRepairQuote } from "../../equipment-maintenance.js";
import { equipmentSaleBlockReason } from "../../equipment-trading.js";
import { resourceSaleBlock } from "../../../shared/domain/blackmarket/bm-resources.js";
import {
  INLAY_PREVIEW_SHAPES,
  applyInlayPreviewTesterField,
  buildFinishPreviewProduct,
  buildInlayPreviewBaseItem,
  createInlayPreviewTesterState,
  metalPreviewVariants,
  normalizeInlayPreviewTesterState,
  previewCapabilityShape,
  settingPreviewVariants
} from "../../inlay-preview-tester.js";
import { renderEquipmentParamPills } from "../../equipment-param-view.js";
import { lazyPreviewMarkup, observeLazyPreviews } from "../../lazy-preview.js";
import { openMaterialBuyModal } from "../../shop-module.js";
import { createWorkshopDeliveryUi } from "./delivery-ui.js";

let socketRef;
let getState;
let elsRef;
let activeWorkshopDeviceId = null;
let selectedWorkshopItemId = null;
let selectedWorkshopWorkerId = null;
let activeWorkshopStep = "open";
let activeWorkshopPicker = null;
let pickerMountKey = null; // 当前已挂载到 DOM 的弹窗标识（kind:deviceId），避免每次重绘重建外壳
let activePickerWorkerId = null; // 选工弹窗内临时选中的员工（点详情用，不直接指派）
let lastWorkshopRenderFp = "";
let activeWorkerSort = "default"; // 选工弹窗列表排序：default=品阶降序 / quality / flawless / speed
let activeKitPlanner = null;
let activeFinishPlanModal = null;
let activeInlayPreviewTester = null;
let finishPlanController = null;
let plannerModalLifecycleCleanup = null;
let finishModalLifecycleCleanup = null;
let inlayPreviewTesterLifecycleCleanup = null;
let workshopStepKeyboardBound = false;
const finishPlanPreviewMarkupCache = new WeakMap();
const WORKSHOP_DURATION_FALLBACK = {
  rough: 90 * 1000,
  refine: 4 * 60 * 1000,
  inlay: 2 * 60 * 1000
};
let formatMoney, formatDuration, escapeHtml, empty, nowMs, typeName, materialStageForClient, materialStageLabel, productCanvas, openingStoneSvg, openingKitsForRender, kitsFor, roughBoard, roughPlannerControls, placementAnalysisRows, openingKitsForServer, roughKits, paintJades, showToast, productionJobsFor, renderInventory;

export function initWorkshopModule(deps) {
  socketRef = deps.socket;
  getState = deps.getState;
  elsRef = deps.els;
  ({ formatMoney, formatDuration, escapeHtml, empty, nowMs, typeName, materialStageForClient, materialStageLabel, productCanvas, openingStoneSvg, openingKitsForRender, kitsFor, roughBoard, roughPlannerControls, placementAnalysisRows, openingKitsForServer, roughKits, paintJades, showToast, productionJobsFor, renderInventory } = deps.helpers);
  bindWorkshopStepKeyboard();
  createWorkshopDeliveryUi({ socket: socketRef, getState, els: elsRef, registerAction: deps.registerAction, helpers: deps.helpers });
  finishPlanController = createFinishPlanModalController({
    mount: mountFinishPlanShell,
    patch: patchFinishPlanModal,
    unmount: (root) => {
      finishModalLifecycleCleanup?.();
      finishModalLifecycleCleanup = null;
      root?.remove();
    },
    emit: (payload, acknowledge) => socketRef.emit("startWorkshopJob", payload, (result) => {
      if (typeof acknowledge === "function") acknowledge(result);
      if (result?.ok) workshopBackDevices();
    }),
    createRequestId: () => globalThis.crypto?.randomUUID?.() || `workshop-${Date.now()}`,
    onActiveChange: (modal) => {
      activeFinishPlanModal = modal;
    }
  });
  const register = deps.registerAction;
  if (typeof register === "function") {
    register("selectWorkshopStep", ({ payload }) => workshopSelectStep(payload));
    register("openWorkshopDevice", ({ payload }) => workshopOpenDevice(payload));
    register("backWorkshopDevices", () => workshopBackDevices());
    register("selectWorkshopItem", ({ payload }) => workshopSelectItem(payload));
    register("startWorkshopJob", ({ target, payload }) => workshopStartJob(target, payload));
    register("assignWorkshopWorker", ({ target, payload }) => workshopAssignWorker(target, payload));
    register("recommendWorkshopWorker", ({ payload }) => workshopRecommendWorker(payload));
    register("openWorkshopPicker", ({ payload }) => workshopOpenPicker(payload));
    register("closeWorkshopPicker", () => workshopClosePicker());
    register("pickWorkshopItem", ({ payload }) => workshopPickItem(payload));
    register("pickWorkshopWorker", ({ target, payload }) => workshopPickWorker(target, payload));
    register("confirmPickerWorker", ({ target, payload }) => workshopConfirmPickerWorker(target, payload));
    register("setWorkerSort", ({ target }) => workshopSetSort(target));
    register("openWorkshopPlanner", ({ payload }) => workshopOpenPlanner(payload));
    register("closeWorkshopPlanner", () => workshopClosePlanner(false));
    register("openInlayPreviewTester", () => openInlayPreviewTester());
  }
}

function bindWorkshopStepKeyboard() {
  if (workshopStepKeyboardBound || !elsRef?.workshopRoot) return;
  workshopStepKeyboardBound = true;
  elsRef.workshopRoot.addEventListener("keydown", (event) => {
    const current = event.target.closest?.('.workshop-step-tab[role="tab"]');
    if (!current) return;
    const tabs = [...elsRef.workshopRoot.querySelectorAll('.workshop-step-tab[role="tab"]')];
    const index = tabs.indexOf(current);
    if (index < 0) return;
    let next = index;
    if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    const stepId = tabs[next].dataset.payload;
    workshopSelectStep(stepId);
    elsRef.workshopRoot.querySelector(`#workshopStepTab-${stepId}`)?.focus();
  });
}

const WORKSHOP_DEVICE_FALLBACKS = [
  { id: "opening", type: "opening", step: "open", name: "翠捷牌CJ-O1 快切型打磨机", baseName: "开料快切线", brandKey: "cuijie", brand: "翠捷", brandPositioning: "入门快周转", brandPriceTier: "入门", brandBasePrice: 6800, brandPeakPrice: 102500, category: "打磨机", tier: "T1", model: "翠捷 CJ-O1 快切型", modelName: "CJ-O1 快切型", inputStage: "rough", inputType: "rough", outputStage: "opened", capacity: 1, workerId: "worker-opening", fee: 620, condition: 92, attrs: { quality: 2, risk: 1.18, speed: 15, perfectFloor: 0 }, specs: "品质+2% · 风险×1.18 · 速度+15% · 保底0%", description: "低价快切入门款，适合早期把暗料快速推进到开料阶段。" },
  { id: "carving", type: "carving", step: "plan", name: "工造牌GZ-C1 基础套料套料机", baseName: "基础套料线", brandKey: "gongzao", brand: "工造", brandPositioning: "主流均衡", brandPriceTier: "标准", brandBasePrice: 9200, brandPeakPrice: 138700, category: "套料机", tier: "T1", model: "工造 GZ-C1 基础套料", modelName: "GZ-C1 基础套料", inputStage: "opened", inputType: "rough", outputStage: "carved", capacity: 1, workerId: "worker-polishing", fee: 900, condition: 84, attrs: { quality: 3, risk: 1.08, speed: 9, perfectFloor: 1 }, specs: "品质+3% · 风险×1.08 · 速度+9% · 保底1%", description: "基础规划取件线，便宜但不激进。" },
  { id: "finishing", type: "finishing", step: "finish", name: "琢光牌ZG-F1 亮抛型玉雕机·抛光机", baseName: "亮抛收光线", brandKey: "zhuoguang", brand: "琢光", brandPositioning: "出光精修", brandPriceTier: "高端", brandBasePrice: 14400, brandPeakPrice: 217200, category: "玉雕机·抛光机", tier: "T1", model: "琢光 ZG-F1 亮抛型", modelName: "ZG-F1 亮抛型", inputStage: "carved", inputType: "bracelet", outputStage: "finished", capacity: 1, workerId: "worker-carving", fee: 680, condition: 76, attrs: { quality: 5, risk: 1.06, speed: 8, perfectFloor: 1 }, specs: "品质+5% · 风险×1.06 · 速度+8% · 保底1%", description: "精加工基础强势款，适合提升常规成品光感。" }
];

// 工坊三步加工页签（开料 / 规划 / 精加工）
const WORKSHOP_STEPS = [
  { id: "open", label: "开料", desc: "打磨暗料，显出真实料子样子。" },
  { id: "plan", label: "规划", desc: "在明料上摆放套件，规划取件。" },
  { id: "finish", label: "精加工", desc: "手镯修形抛光，挂件按需镶嵌。" }
];
// 设备只有 stage(opening/carving/finishing)，需映射到设计步骤(open/plan/finish)
const STEP_BY_STAGE = { opening: "open", carving: "plan", finishing: "finish" };
const WORKSHOP_DEVICE_TYPE_LABELS = { opening: "开料", carving: "规划", finishing: "精加工" };
function deviceStep(d) {
  return STEP_BY_STAGE[d?.stage] || "open";
}
function workshopDeviceTypeLabel(device) {
  return WORKSHOP_DEVICE_TYPE_LABELS[device?.stage] || "加工";
}

const WORKSHOP_WORKER_FALLBACKS = [
  { id: "worker-opening", name: "阿成", job: "cutter", tier: 5, tierLevel: 1, traits: ["稳手"], flaws: ["易裂"],
    skills: { cut: { jieliao: { level: 6, exp: 180 }, damo: { level: 5, exp: 150 } }, set: { qieliao: { level: 3, exp: 80 }, xiuxing: { level: 2, exp: 50 } }, finish: { diaozhuo: { level: 2, exp: 40 }, xiangqian: { level: 2, exp: 30 } }, speak: { huashu: { level: 1, exp: 15 }, kongchang: { level: 1, exp: 10 }, cuidan: { level: 1, exp: 5 } } } },
  { id: "worker-carving", name: "林师傅", job: "finisher", tier: 8, tierLevel: 1, traits: ["按线稳"], flaws: ["易脏"],
    skills: { cut: { jieliao: { level: 2, exp: 60 }, damo: { level: 2, exp: 40 } }, set: { qieliao: { level: 2, exp: 50 }, xiuxing: { level: 2, exp: 45 } }, finish: { diaozhuo: { level: 6, exp: 200 }, xiangqian: { level: 5, exp: 180 } }, speak: { huashu: { level: 1, exp: 20 }, kongchang: { level: 1, exp: 12 }, cuidan: { level: 1, exp: 8 } } } },
  { id: "worker-polishing", name: "小周", job: "planner", tier: 3, tierLevel: 1, traits: ["细光"], flaws: ["手重"],
    skills: { cut: { jieliao: { level: 3, exp: 90 }, damo: { level: 3, exp: 70 } }, set: { qieliao: { level: 6, exp: 240 }, xiuxing: { level: 5, exp: 210 } }, finish: { diaozhuo: { level: 2, exp: 35 }, xiangqian: { level: 2, exp: 25 } }, speak: { huashu: { level: 1, exp: 18 }, kongchang: { level: 1, exp: 11 }, cuidan: { level: 1, exp: 6 } } } },
  { id: "worker-finishing", name: "许工", job: "streamer", tier: 6, tierLevel: 1, traits: ["收口准"], flaws: ["易出绵"],
    skills: { cut: { jieliao: { level: 2, exp: 55 }, damo: { level: 2, exp: 45 } }, set: { qieliao: { level: 2, exp: 48 }, xiuxing: { level: 2, exp: 42 } }, finish: { diaozhuo: { level: 2, exp: 38 }, xiangqian: { level: 2, exp: 28 } }, speak: { huashu: { level: 6, exp: 190 }, kongchang: { level: 5, exp: 160 }, cuidan: { level: 5, exp: 155 } } } }
];

// 品阶显示：数字阶 + 渐变徽章（低阶翡翠绿 → 高阶暖金）；公式见 workshop-craft-scoring.js
function tierLabel(worker) { return `${Number(worker?.tier) || 1}阶`; }
function tierBadgeStyle(tier) {
  const t = clamp(Number(tier) || 1, 1, 10);
  const f = (t - 1) / 9;
  const jade = [71, 164, 116], gold = [206, 184, 124];
  const c = jade.map((jv, i) => Math.round(jv + f * (gold[i] - jv)));
  return `background:linear-gradient(135deg,rgb(${c[0]},${c[1]},${c[2]}),rgba(${c[0]},${c[1]},${c[2]},.82));color:#10221b`;
}
// 左卡边框颜色：按品阶从翡翠绿 → 暖金 渐变（实色无 alpha，让边框差异一眼可辨）
function tierBorder(tier) {
  const t = clamp(Number(tier) || 1, 1, 10);
  const f = (t - 1) / 9;
  const jade = [52, 138, 100], gold = [232, 168, 60];
  const c = jade.map((jv, i) => Math.round(jv + f * (gold[i] - jv)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function craftGradeBadge(grade) {
  return `<span class="craft-grade grade-${grade}">${grade}</span>`;
}
// 成品/中间产物底部一行：工分 + 评级（仅已完成工序参与，无则不显示）
function craftScoreLine(item) {
  if (item.craftScore == null) return "";
  let tag = "";
  if (item.craftPerfect) tag = `<span class="craft-tag tag-perfect">完美</span>`;
  else if (item.craftFlaw) tag = `<span class="craft-tag tag-flaw">瑕疵·${escapeHtml(item.craftFlaw)}</span>`;
  return `<p class="item-craft-score">工分 <strong>${item.craftScore}</strong> ${craftGradeBadge(item.craftGrade)} ${tag}</p>`;
}
function flawClass(flaw) { return (FLAW_DEFS[flaw] || 0) >= 0 ? "pos" : "neg"; }
function pct(n) { return (n > 0 ? "+" : "") + n + "%"; }
// 左卡完整效果评分：品质分 + 提速 + 完美率 + 本工序各属性贡献，全部使用与上方相同的 chip UI（不再分两版）
function renderWorkerMiniScores(worker, step) {
  const pv = workerStepPreview(worker, step);
  const speed = pv.speed > 0 ? "+" + pv.speed + "%" : "—";
  const label = pv.perfectLabel;
  const flawCls = label === "完美" ? "grade-S" : (label === "瑕疵" ? "grade-D" : "");
  const items = [
    { label: "工分", value: pv.quality.toFixed(0), cls: "grade-" + pv.grade },
    { label: "评级", value: pv.grade, cls: "grade-" + pv.grade },
    { label: "提速", value: speed },
    { label: "完美度", value: label || "—", cls: flawCls },
    ...pv.attrs.map((a) => ({ label: a.attr, value: "+" + a.value.toFixed(1) }))
  ];
  return `<div class="wsp-worker-mini">${items.map((it) =>
    `<span class="${it.cls || ""}"><em>${escapeHtml(it.label)}</em><strong>${escapeHtml(it.value)}</strong></span>`
  ).join("")}</div>`;
}
// 左卡天赋 chips（返回纯 chips，由调用方包在 .wsp-worker-traits 容器里）
function renderWorkerMiniTraitChips(worker) {
  const traits = worker.traits || [];
  const flaws = worker.flaws || [];
  const list = [...traits, ...flaws];
  if (!list.length) return '<span class="wsp-trait-chip muted">无天赋</span>';
  return list.map((t) => {
    const isTrait = traits.includes(t);
    const cls = isTrait ? "pos" : flawClass(t);
    return `<span class="wsp-trait-chip ${cls}">${escapeHtml(t)}</span>`;
  }).join("");
}
export function workshopDevices() {
  const serverDevices = getState().me.workshop?.devices;
  if (!Array.isArray(serverDevices)) return WORKSHOP_DEVICE_FALLBACKS;
  return serverDevices.map((device) => ({
    ...(WORKSHOP_DEVICE_FALLBACKS.find((fallback) => fallback.type === device.stage) || {}),
    ...device,
    type: device.stage || device.type,
    capacity: 1
  }));
}

export function workshopWorkers() {
  const serverWorkers = getState().me.workshop?.workers || [];
  if (!serverWorkers.length) return WORKSHOP_WORKER_FALLBACKS;
  return serverWorkers.map((worker) => ({
    ...(WORKSHOP_WORKER_FALLBACKS.find((fallback) => fallback.id === worker.id) || {}),
    ...worker
  }));
}

export function workshopWorkerFor(device) {
  return workshopWorkers().find((worker) => worker.id === device.workerId) || WORKSHOP_WORKER_FALLBACKS[0];
}

export function workshopJobs(deviceId = null) {
  const jobs = productionJobsFor(getState().me);
  if (!deviceId) return jobs;
  return jobs.filter((job) => (job.deviceId || { rough: "opening", refine: "carving", inlay: "finishing" }[job.stage] || job.stage) === deviceId);
}

function isWorkshopLeftoverMaterial(item, me = getState()?.me) {
  if (!item) return false;
  if (item.leftover === true || item.isLeftover === true) return true;
  const id = item.id;
  if (!id) return false;
  // 兼容旧存档：已被取件产物引用的残料视为余料（含加工中 job）
  if ((me?.bracelets || []).some((product) => product.sourceRoughId === id)) return true;
  return (me?.jobs || []).some((job) => (
    String(job?.item?.sourceRoughId || job?.item?.sourceMaterial?.roughId || "") === String(id)
  ));
}

export function workshopProcessableItems(device) {
  const me = getState().me || {};
  const fromRough = me.rough || [];
  const fromMaterials = me.materials || [];
  const bucket = device.inputType === "rough" ? [...fromRough, ...fromMaterials, ...(me.slices || [])] : me.bracelets || [];
  return bucket.filter((item) => materialStageForClient(item) === device.inputStage);
}

function workshopHeldJadeItems() {
  const me = getState()?.me || {};
  return [...(me.rough || []), ...(me.materials || []), ...(me.slices || []), ...(me.bracelets || [])];
}

/** 选料为空时：区分「真没货」和「有货但阶段不对」（例如套料机要明料，库存却是暗料） */
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

export function workshopStageItems() {
  return [
    ...(getState().me.rough || []).map((item) => ({ ...item, type: "rough" })),
    ...(getState().me.materials || []).map((item) => ({ ...item, type: "material" })),
    ...(getState().me.slices || []).map((item) => ({ ...item, type: "slice" })),
    ...(getState().me.bracelets || []).map((item) => ({ ...item, type: "bracelet" }))
  ];
}

export function workshopOutputLabel(device) {
  return materialStageLabel(device.outputStage);
}

export function workshopDurationMs(device, worker = workshopWorkerFor(device)) {
  const durationStage = device?.durationStage || "rough";
  const base = Number(getState()?.timing?.production?.[durationStage])
    || WORKSHOP_DURATION_FALLBACK[durationStage]
    || WORKSHOP_DURATION_FALLBACK.rough;
  const deviceSpeed = Number(device?.attrs?.speed || 0);
  const deviceTimeScale = Math.max(0.2, 1 - Math.min(0.8, deviceSpeed / 100));
  return Math.max(1000, Math.round(base * speedTimeScale(worker) * deviceTimeScale));
}

export function workshopDurationLabel(device, worker = workshopWorkerFor(device)) {
  return `约 ${formatDuration(workshopDurationMs(device, worker))}`;
}

export function workshopWorkerImpact(worker, device) {
  const trait = worker?.traits?.[0] ? `，特性「${worker.traits[0]}」` : "";
  return {
    opening: `${worker.name}：开料耗时小幅下降，损耗风险小幅降低${trait}。`,
    carving: `${worker.name}：按套件边界下刀更稳，取件质量小幅提高${trait}。`,
    finishing: `${worker.name}：细部收口更准，最终成品稳定性小幅提高${trait}。`
  }[device.stage || device.type] || `${worker.name}：当前工序表现稳定${trait}。`;
}

export function workshopDeviceImpact(device) {
  return `${device.name} 1阶：容量 ${workshopJobs(device.id).length}/1，状态 ${Math.round(device.condition ?? 100)}%，稳定完成${workshopOutputLabel(device)}工序。`;
}

function workshopRepairQuote(device) {
  return equipmentRepairQuote(device);
}

export function workshopJobEstimate(device, item) {
  const worker = (selectedWorkshopWorkerId
    && workshopWorkers().find((entry) => entry.id === selectedWorkshopWorkerId))
    || workshopWorkerFor(device);
  const fee = workerProcessingFee(worker, 0, {
    stage: device.stage,
    itemValue: item?.value ?? item?.price
  });
  const duration = workshopDurationLabel(device, worker);
  return {
    fee,
    duration,
    output: workshopOutputLabel(device),
    workerImpact: workshopWorkerImpact(worker, device),
    deviceImpact: workshopDeviceImpact(device),
    summary: `预计：免加工费，${duration}，产出${workshopOutputLabel(device)}。`
  };
}

export function workshopJobProgress(job) {
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

/** 轻量刷新设备页进度条/倒计时（不重建整页） */
export function tickWorkshopJobProgress() {
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

function isRoughLikeWorkshopItem(item) {
  const stage = materialStageForClient(item);
  return item?.type === "rough"
    || item?.type === "material"
    || stage === "rough"
    || stage === "opened";
}

function carvingPreviewKits(item) {
  // 历史已取件遮罩（余料黑洞）+ 本次 kitsFor 草稿一并绘制
  if (typeof openingKitsForRender !== "function" || !item) return [];
  return openingKitsForRender(item);
}

export function workshopItemPreview(item, device = null, options = {}) {
  let inner;
  if (isRoughLikeWorkshopItem(item)) {
    const kits = device?.stage === "carving" ? carvingPreviewKits(item) : [];
    // 非规划工序选中余料时也要画出已扣件遮罩
    const previewKits = kits.length
      ? kits
      : (isWorkshopLeftoverMaterial(item) && typeof openingKitsForRender === "function"
        ? openingKitsForRender(item)
        : []);
    inner = `<div class="rough-output-preview compact">${openingStoneSvg(item, {
      revealed: materialStageForClient(item) !== "rough",
      kits: previewKits
    })}</div>`;
  } else {
    inner = `<div class="workshop-product-preview">${productCanvas(item, "compact")}</div>`;
  }
  if (options.lazy) {
    const stage = materialStageForClient(item);
    const draftSig = cutoutPreviewSignature(typeof kitsFor === "function" ? (kitsFor(item.id) || []) : []);
    const savedSig = cutoutPreviewSignature(item.extractionKits || item.braceletPlacements || []);
    return lazyPreviewMarkup(inner, {
      tint: item?.visual?.skin || item?.visual?.vein || "",
      cacheKey: `ws:${item.id}:${stage}:${draftSig}:${savedSig}:${item.leftover ? 1 : 0}`
    });
  }
  return inner;
}

export function workshopRecipeCard(device) {
  const jobs = workshopJobs(device.id);
  const current = jobs[0];
  const tier = device.tier || "T1";
  const durability = Number(device.condition ?? device.durability ?? 100);
  const typeLabel = workshopDeviceTypeLabel(device);
  const paramPills = renderEquipmentParamPills(device.attrs, escapeHtml, { containerTag: "span", className: "wrc-param-pills", interactive: false });
  const durClass = durability > 80 ? "high" : durability > 50 ? "mid" : "low";
  return `
    <button class="workshop-recipe-card" data-action="openWorkshopDevice" data-payload="${device.id}" type="button">
      <span class="recipe-card-title">${escapeHtml(device.name)}</span>
      <span class="wrc-durability">
        <span class="wrc-dur-meta">
          <span class="wrc-dur-label">耐久 ${durability}%</span>
          <span class="wsp-device-type-field">${escapeHtml(typeLabel)}</span>
        </span>
        <span class="wrc-dur-track"><span class="wrc-dur-fill ${durClass}" style="width:${durability}%"></span></span>
      </span>
      ${paramPills}
      <span class="wrc-foot">
        <span class="recipe-card-current">${current ? `加工中：${escapeHtml(current.item?.name || "物料")}` : "设备空闲"}</span>
        <span class="wrc-upgrade" aria-disabled="true" title="所有设备固定为 1 阶，型号差异由基础属性决定">固定 ${escapeHtml(String(tier))} 阶</span>
      </span>
    </button>
  `;
}

export function workshopStepTabs() {
  return `
    <div class="workshop-step-tabs" role="tablist" aria-label="工坊工序">
      ${WORKSHOP_STEPS.map((step) => {
        const active = step.id === activeWorkshopStep;
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

export function workshopRecipeHome(devices) {
  const stepDevices = devices.filter((device) => deviceStep(device) === activeWorkshopStep);
  const step = WORKSHOP_STEPS.find((s) => s.id === activeWorkshopStep) || WORKSHOP_STEPS[0];
  const emptyStep = `
    <div class="game-empty-state workshop-step-empty">
      <span class="game-empty-state-mark" aria-hidden="true">工</span>
      <strong>「${escapeHtml(step.label)}」还没有可用设备</strong>
      <p>先到商铺添置对应工序的机器，设备到位后就能在这里选料、排工并开工。</p>
      <button type="button" data-view-link="shop">去商铺看设备</button>
    </div>`;
  return `
    <div class="workshop-recipe-home">
      ${workshopStepTabs()}
      <section id="workshopStepPanel" class="workshop-step-panel" role="tabpanel" aria-labelledby="workshopStepTab-${activeWorkshopStep}">
        <div class="workshop-step-tools">
          <button class="secondary small" data-action="openInlayPreviewTester" type="button">镶嵌预览测试</button>
        </div>
        <div class="workshop-recipe-grid">
          ${stepDevices.map(workshopRecipeCard).join("") || emptyStep}
        </div>
      </section>
    </div>
  `;
}

export function workshopMaterialRow(device, item) {
  const selected = selectedWorkshopItemId === item.id;
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

export function workshopRecipeSummary(device, selected) {
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
  const worker = (selectedWorkshopWorkerId && workshopWorkers().find((w) => w.id === selectedWorkshopWorkerId)) || workshopWorkerFor(device);
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
        <div><span>加工费用</span><strong>免费</strong></div>
      </div>
      ${planStep}
      ${startActions}
    </section>`;
}

export function workshopBigMaterialCard(device, selected, { locked = false } = {}) {
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

export function workshopBigWorkerCard(device, worker, { locked = false } = {}) {
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
  const flaws = (worker.flaws || []).map((f) => `<span class="flaw-chip ${flawClass(f)}">${escapeHtml(f)}</span>`).join("") || '<span class="flaw-chip muted">无词条</span>';
  return `
    <div class="ws-big-card ws-big-worker ${locked ? "is-locked" : ""}" ${locked ? 'aria-disabled="true"' : `data-action="openWorkshopPicker" data-payload='${payload}'`}>
      <div class="ws-big-worker-top">
        <span class="worker-avatar">${escapeHtml((worker.name || "?")[0] || "?")}</span>
        <div class="ws-big-worker-id">
          <strong>${escapeHtml(worker.name)}</strong>
          <em>${escapeHtml(tierLabel(worker))}${worker.busy ? " · 工作中" : " · 空闲"}</em>
        </div>
      </div>
      <div class="ws-big-worker-preview">
        <span>工分 <strong>${pv.quality.toFixed(0)}</strong> ${craftGradeBadge(pv.grade)}</span>
        <span>提速 <strong>${pv.speed > 0 ? "+" + pv.speed + "%" : "—"}</strong></span>
        <span>完美度 <strong>${pv.perfectLabel || "—"}</strong></span>
      </div>
      <div class="ws-big-worker-flaws">${flaws}</div>
      ${locked
        ? `<span class="ws-big-locked-hint">加工中，暂不可更换</span>`
        : `<span class="ws-big-worker-actions">${openWorkerButton("更换员工")}<button class="secondary small wsp-recommend" data-action="recommendWorkshopWorker" data-payload="${device.id}" type="button">智能推荐</button></span>`}
    </div>`;
}

export function workshopRecommendedWorkerId(device) {
  const workers = workshopWorkers().filter((worker) => !worker.busy);
  if (!workers.length) return null;
  let best = workers[0];
  let bestScore = -Infinity;
  for (const worker of workers) {
    const pv = workerStepPreview(worker, deviceStep(device));
    const score = pv.quality + pv.speed * 0.3 + (pv.perfectLabel === "完美" ? 50 : pv.perfectLabel === "瑕疵" ? -50 : 0);
    if (score > bestScore) { bestScore = score; best = worker; }
  }
  return best ? best.id : device.workerId;
}

export function workshopWorkerColumn(device) {
  const current = workshopWorkerFor(device);
  const workers = workshopWorkers();
  const list = workers.map((worker) => {
    const on = worker.id === device.workerId;
    const pv = workerStepPreview(worker, deviceStep(device));
    const traits = (worker.traits || []).map((trait) => `<span class="trait-chip">${escapeHtml(trait)}</span>`).join("");
    return `
      <button class="workshop-worker-card ${on ? "assigned" : ""}" data-action="assignWorkshopWorker" data-payload="${device.id}" data-worker-id="${worker.id}" type="button" ${worker.busy ? "disabled" : ""}>
        <span class="worker-avatar">${escapeHtml((worker.name || "?")[0] || "?")}</span>
        <span class="worker-body">
          <strong>${escapeHtml(worker.name)}</strong>
          <em>${escapeHtml(tierLabel(worker))}</em>
          <span class="trait-row">${traits || '<span class="trait-chip muted">暂无特性</span>'}</span>
          <span class="worker-mini">工分 ${pv.quality.toFixed(0)}（${pv.grade}） · 提速 ${pv.speed > 0 ? "+" + pv.speed + "%" : "—"} · 完美度 ${pv.perfectLabel || "—"}</span>
        </span>
        <span class="worker-state">${worker.busy ? "工作中" : on ? "已选" : "可选"}</span>
      </button>`;
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

export function workshopRecipePage(device) {
  const jobs = workshopJobs(device.id);
  const busy = Boolean(device.blackmarketListingId) || jobs.length >= 1;
  const activeJob = jobs[0] || null;
  const items = workshopProcessableItems(device);
  if (selectedWorkshopItemId && !items.some((item) => item.id === selectedWorkshopItemId)) {
    selectedWorkshopItemId = items[0]?.id || null;
  }
  let selected = selectedWorkshopItemId ? items.find((item) => item.id === selectedWorkshopItemId) || null : null;
  if (!selected && busy && activeJob?.item) selected = activeJob.item;
  let selectedWorker = selectedWorkshopWorkerId
    ? workshopWorkers().find((w) => w.id === selectedWorkshopWorkerId) || null
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

export function renderWorkshop() {
  const devices = workshopDevices();
  const activeDevice = devices.find((device) => device.id === activeWorkshopDeviceId) || null;
  if (activeWorkshopDeviceId && !activeDevice) {
    activeWorkshopDeviceId = null;
    selectedWorkshopItemId = null;
  }
  const me = getState()?.me;
  const jobs = workshopJobs();
  // 规划草稿在客户端 Map，不进 state；指纹必须带上，否则确认规划后 DOM 不刷新，开工按钮不出现
  const planKitsSig = selectedWorkshopItemId && typeof kitsFor === "function"
    ? (kitsFor(selectedWorkshopItemId) || []).map((kit) => kit.id || kit.uid || "").join(",")
    : "";
  const fp = [
    activeWorkshopDeviceId || "",
    selectedWorkshopItemId || "",
    selectedWorkshopWorkerId || "",
    activeWorkshopStep || "",
    planKitsSig,
    me?.cash ?? 0,
    employeePayrollStatus(me, payrollNowMs()), me?.employeePayroll?.debt || 0,
    devices.map((device) => `${device.id}:${device.workerId || ""}:${device.condition || ""}:${device.busy ? 1 : 0}`).join("|"),
    jobs.map((job) => `${job.id || job.startedAt || ""}:${job.readyAt || ""}:${job.deviceId || job.stage || ""}`).join("|"),
    [...(me?.rough || []), ...(me?.materials || [])].map((item) => `${item.id}:${materialStageForClient(item)}`).join("|"),
    (me?.bracelets || []).map((item) => `${item.id}:${item.value ?? item.price ?? ""}`).join("|"),
    workshopWorkers().map((worker) => `${worker.id}:${worker.busy ? 1 : 0}:${worker.tier || ""}`).join("|")
  ].join("::");
  if ((fp !== lastWorkshopRenderFp || !elsRef.workshopRoot?.childElementCount)) {
    lastWorkshopRenderFp = fp;
    elsRef.workshopRoot.innerHTML = payrollWorkNotice(me, { now: payrollNowMs(), formatMoney })
      + (activeDevice ? workshopRecipePage(activeDevice) : workshopRecipeHome(devices));
  } else if (activeDevice && workshopJobs(activeDevice.id).length) {
    tickWorkshopJobProgress();
  }
  // 注意：选工/选料弹窗不再挂在 workshopRoot 内，改为挂到 body 下的独立容器（见 renderPicker），
  // 这样服务端每秒推送 state 触发 renderWorkshop 重建工坊页时，不会连带重建弹窗导致闪烁。
  if (activeKitPlanner) workshopRefreshPlanner(activeKitPlanner.itemId);
  if (activeFinishPlanModal) finishPlanController.refresh();
  if (activeInlayPreviewTester) patchInlayPreviewTester();
}

function plannerRootEl() {
  let root = document.getElementById("ws-planner-root");
  if (root) return root;
  root = document.createElement("div");
  root.id = "ws-planner-root";
  root.className = "ws-picker-overlay";
  root.addEventListener("click", (event) => {
    if (event.target.closest('[data-planner-action="cancel"]')) {
      workshopClosePlanner(false);
      return;
    }
    if (event.target.closest('[data-planner-action="confirm"]')) {
      workshopClosePlanner(true);
    }
  });
  document.body.appendChild(root);
  return root;
}

function buildPlannerShell(device, item) {
  return `
    <section class="ws-planner-modal" role="dialog" aria-modal="true" aria-label="规划套件">
      <header class="ws-picker-head">
        <div class="wsp-head-text">
          <h3>规划套件</h3>
          <p>${escapeHtml(item.name)} · ${escapeHtml(device.name)}</p>
        </div>
        <button class="ws-picker-close" data-planner-action="cancel" type="button" aria-label="关闭">×</button>
      </header>
      <div class="ws-planner-body" data-planner-body></div>
      <footer class="game-modal-actions">
        <button class="secondary" data-planner-action="cancel" type="button">取消</button>
        <button class="primary" data-planner-action="confirm" type="button">确认规划</button>
      </footer>
    </section>
  `;
}

export function workshopOpenPlanner(payload) {
  const deviceId = payload || activeWorkshopDeviceId;
  const device = workshopDevices().find((entry) => entry.id === deviceId);
  if (!device || device.stage !== "carving") {
    showToast("请先选择需要规划的石头。");
    return;
  }
  const item = workshopProcessableItems(device).find((entry) => entry.id === selectedWorkshopItemId);
  if (!item) {
    showToast("请先选择需要规划的石头。");
    return;
  }
  activeKitPlanner = {
    deviceId,
    itemId: item.id,
    originalKits: structuredClone(kitsFor(item.id))
  };
  const root = plannerRootEl();
  root.innerHTML = buildPlannerShell(device, item);
  plannerModalLifecycleCleanup?.();
  plannerModalLifecycleCleanup = activateModalLifecycle({
    root,
    dialog: root.querySelector('[role="dialog"]'),
    shell: document.querySelector(".shell"),
    onClose: () => workshopClosePlanner(false)
  });
  workshopRefreshPlanner(item.id);
}

export function workshopRefreshPlanner(roughId, options = {}) {
  if (!activeKitPlanner || activeKitPlanner.itemId !== roughId) return;
  const item = workshopStageItems().find((entry) => entry.id === roughId);
  const body = document.querySelector("#ws-planner-root [data-planner-body]");
  if (!item) {
    activeKitPlanner = null;
    plannerModalLifecycleCleanup?.();
    plannerModalLifecycleCleanup = null;
    document.getElementById("ws-planner-root")?.remove();
    return;
  }
  if (!body) return;
  const kits = kitsFor(roughId);
  // Socket snapshots also refresh this view. Keep the captured SVG mounted
  // throughout a drag, including those background refreshes.
  if (options.dragging || activeDragKit?.roughId === roughId) {
    const tools = body.querySelector(".ws-planner-tools");
    if (tools) patchPlannerBody(tools, `${roughPlannerControls(item)}${placementAnalysisRows(item, kits)}`);
    return;
  }
  const markup = `
    <div class="ws-planner-canvas">${roughBoard(item)}</div>
    <div class="ws-planner-tools">
      ${roughPlannerControls(item)}
      ${placementAnalysisRows(item, kits)}
    </div>
  `;
  patchPlannerBody(body, markup, paintJades);
}

export function workshopClosePlanner(commit = false) {
  if (!activeKitPlanner) {
    plannerModalLifecycleCleanup?.();
    plannerModalLifecycleCleanup = null;
    document.getElementById("ws-planner-root")?.remove();
    return;
  }
  if (commit) {
    const draftKits = typeof kitsFor === "function" ? (kitsFor(activeKitPlanner.itemId) || []) : [];
    if (!draftKits.length) {
      showToast("请先摆放至少一个套件。");
      return;
    }
  } else {
    roughKits.set(activeKitPlanner.itemId, structuredClone(activeKitPlanner.originalKits));
  }
  activeKitPlanner = null;
  plannerModalLifecycleCleanup?.();
  plannerModalLifecycleCleanup = null;
  document.getElementById("ws-planner-root")?.remove();
  lastWorkshopRenderFp = "";
  renderWorkshop();
  if (typeof renderInventory === "function") renderInventory();
}

// 弹窗挂载容器（独立于 workshopRoot，挂在 body 上，renderWorkshop 不触碰）
function pickerRootEl() {
  let el = document.getElementById("ws-picker-root");
  if (!el) {
    el = document.createElement("div");
    el.id = "ws-picker-root";
    document.body.appendChild(el);
  }
  return el;
}

// 弹窗外壳：仅在「打开」时构建一次（入场动画只播一次），之后只刷新内容区
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
            <button class="wsp-toolbar-btn ${activeWorkerSort === "default" ? "is-active" : ""}" data-action="setWorkerSort" data-sort="default" type="button" aria-pressed="${activeWorkerSort === "default"}">默认</button>
            <button class="wsp-toolbar-btn ${activeWorkerSort === "quality" ? "is-active" : ""}" data-action="setWorkerSort" data-sort="quality" type="button" aria-pressed="${activeWorkerSort === "quality"}">工分</button>
            <button class="wsp-toolbar-btn ${activeWorkerSort === "flawless" ? "is-active" : ""}" data-action="setWorkerSort" data-sort="flawless" type="button" aria-pressed="${activeWorkerSort === "flawless"}">完美度</button>
            <button class="wsp-toolbar-btn ${activeWorkerSort === "speed" ? "is-active" : ""}" data-action="setWorkerSort" data-sort="speed" type="button" aria-pressed="${activeWorkerSort === "speed"}">提速</button>
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

// 弹窗内容区（列表 + 右侧详情）：每次切换/状态刷新只更新这一块，不重建外壳 → 不闪烁
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
  if (activeWorkerSort !== "default") {
    workers = [...workers].sort((a, b) => {
      const pa = workerStepPreview(a, deviceStep(device));
      const pb = workerStepPreview(b, deviceStep(device));
      if (activeWorkerSort === "quality") return pb.quality - pa.quality;
      if (activeWorkerSort === "flawless") { const r = (x) => x.perfectLabel === "完美" ? 2 : x.perfectLabel === "瑕疵" ? 0 : 1; return r(pb) - r(pa); }
      if (activeWorkerSort === "speed") return pb.speed - pa.speed;
      return 0;
    });
  } else {
    workers = [...workers].sort((a, b) => (Number(b.tier) || 1) - (Number(a.tier) || 1));
  }
  const detail = activePickerWorkerId && workers.find((w) => w.id === activePickerWorkerId)
    || workshopWorkers().find((w) => w.id === activePickerWorkerId); // 详情固定显示当前临时选中的员工（即使被筛掉也照显示）
  const list = workers.map((worker) => {
    const pv = workerStepPreview(worker, deviceStep(device));
    const active = worker.id === activePickerWorkerId;
    const assigned = worker.id === device.workerId;
    return `
      <button class="ws-picker-item ws-pick-worker ${active ? "is-active" : ""} ${assigned ? "is-assigned" : ""}" style="--tier-border:${tierBorder(worker.tier)}" data-action="pickWorkshopWorker" data-payload="${device.id}" data-worker-id="${worker.id}" type="button" ${worker.busy ? "disabled" : ""}>
        <span class="wsp-worker-top">
          <strong class="wsp-worker-name">${escapeHtml(worker.name)}</strong>
          <span class="wsp-tier-badge" style="${tierBadgeStyle(worker.tier)}">${escapeHtml(tierLabel(worker))}</span>
          <span class="wsp-worker-traits">${renderWorkerMiniTraitChips(worker)}</span>
          ${worker.busy ? '<span class="wsp-tag busy">工作中</span>' : ""}
        </span>
        ${renderWorkerMiniScores(worker, deviceStep(device))}
      </button>`;
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

// 统一刷新弹窗：外壳只在打开时建一次，其后仅替换内容区
export function renderPicker() {
  const rootEl = pickerRootEl();
  if (!activeWorkshopPicker) {
    if (rootEl.childElementCount) rootEl.innerHTML = "";
    pickerMountKey = null;
    return;
  }
  const device = workshopDevices().find((d) => d.id === activeWorkshopPicker.deviceId) || null;
  if (!device) {
    if (rootEl.childElementCount) rootEl.innerHTML = "";
    pickerMountKey = null;
    return;
  }
  const key = `${activeWorkshopPicker.kind}:${activeWorkshopPicker.deviceId}`;
  if (pickerMountKey !== key) {
    rootEl.innerHTML = buildPickerShell(activeWorkshopPicker, device);
    const overlay = rootEl.querySelector(".ws-picker-overlay");
    if (overlay) overlay.addEventListener("click", (event) => { if (event.target === overlay) workshopClosePicker(); });
    attachPickerSearch(rootEl);
    pickerMountKey = key;
  }
  const content = rootEl.querySelector(".ws-picker-content");
  if (content) {
    content.innerHTML = buildPickerContent(activeWorkshopPicker, device);
    observeLazyPreviews(content);
  }
  applyPickerSearch(rootEl);
}

// 员工弹窗右侧详情面板
function renderWorkerDetail(worker, device) {
  const pv = workerStepPreview(worker, deviceStep(device));
  const assigned = worker.id === device.workerId;
  return renderWorkerDetailPanel({
    worker,
    step: deviceStep(device) === "finish" && isBangle(workshopStageItems().find((entry) => entry.id === selectedWorkshopItemId)) ? "bangleFinish" : deviceStep(device),
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

export function workshopOpenPicker(payload) {
  try { activeWorkshopPicker = typeof payload === "string" ? JSON.parse(payload) : payload; }
  catch { activeWorkshopPicker = null; }
  // 员工弹窗：默认选中当前设备已绑定的员工（让右侧详情一开就有内容）
  if (activeWorkshopPicker && activeWorkshopPicker.kind === "worker") {
    const devId = activeWorkshopPicker.deviceId;
    const dev = workshopDevices().find((d) => d.id === devId);
    const workers = workshopWorkers();
    const fallback = dev?.workerId || (workers[0] && workers[0].id) || null;
    activePickerWorkerId = (dev && dev.workerId && workers.some((w) => w.id === dev.workerId))
      ? dev.workerId
      : (workers[0] && workers[0].id) || null;
  } else {
    activePickerWorkerId = null;
  }
  renderWorkshop();
  renderPicker();
}

export function workshopClosePicker() {
  activeWorkshopPicker = null;
  activePickerWorkerId = null;
  renderWorkshop();
  renderPicker();
}

export function workshopPickItem(payload) {
  activeWorkshopPicker = null;
  workshopSelectItem(payload);
  renderPicker();
}

export function workshopPickWorker(target, payload) {
  // 弹窗内点员工卡 = 只切换详情预览，不直接指派、不关闭
  const workerId = target.dataset.workerId || null;
  if (!workerId) return;
  activePickerWorkerId = workerId;
  renderPicker(); // 只刷新弹窗内容区，不重建外壳、不重播动画 → 不再闪烁
}

export function workshopSetSort(target) {
  const sort = target?.dataset?.sort;
  if (!sort) return;
  activeWorkerSort = sort;
  // 同步工具栏按钮高亮（不重建外壳，只改 active 类）
  document.querySelectorAll(".wsp-toolbar-btn[data-action='setWorkerSort']").forEach((b) => {
    const on = b.dataset.sort === sort;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  renderPicker();
}

export function workshopConfirmPickerWorker(target, payload) {
  // 详情面板点「指派此员工开工」= 真正指派并关闭弹窗
  const workerId = target.dataset.workerId || activePickerWorkerId;
  if (!workerId) { workshopClosePicker(); return; }
  activeWorkshopPicker = null;
  activePickerWorkerId = null;
  selectedWorkshopWorkerId = workerId;
  workshopAssignWorker({ dataset: { workerId } }, payload);
  renderWorkshop();
  renderPicker();
}


export function workshopOpenDevice(payload) {
  activeWorkshopDeviceId = payload;
  selectedWorkshopItemId = null;
  const device = workshopDevices().find((entry) => entry.id === payload);
  selectedWorkshopWorkerId = device?.workerId || (device ? workshopRecommendedWorkerId(device) : null);
  if (device) activeWorkshopStep = deviceStep(device);
  renderWorkshop();
  paintJades();
}

/** Open the matching workshop step with an inventory item already selected. */
export function focusWorkshopItem(rawItemId) {
  const itemId = String(rawItemId || "").trim();
  if (!itemId) return false;
  const device = workshopDevices().find((entry) => (
    workshopProcessableItems(entry).some((item) => String(item.id) === itemId)
  ));
  if (!device) {
    showToast?.({ text: "当前没有可承接这件物品的加工设备。", tone: "warn" });
    return false;
  }
  activeWorkshopDeviceId = device.id;
  activeWorkshopStep = deviceStep(device);
  selectedWorkshopItemId = itemId;
  selectedWorkshopWorkerId = device.workerId || workshopRecommendedWorkerId(device);
  lastWorkshopRenderFp = "";
  renderWorkshop();
  paintJades();
  return true;
}
export function workshopSelectStep(payload) {
  if (!WORKSHOP_STEPS.some((step) => step.id === payload)) return;
  activeWorkshopStep = payload;
  renderWorkshop();
  paintJades();
}
export function workshopBackDevices() {
  activeWorkshopDeviceId = null;
  selectedWorkshopItemId = null;
  selectedWorkshopWorkerId = null;
  renderWorkshop();
  paintJades();
}
export function workshopSelectItem(payload) {
  const previousItemId = selectedWorkshopItemId;
  const device = workshopDevices().find((entry) => entry.id === activeWorkshopDeviceId);
  if (device?.stage === "carving" && previousItemId && previousItemId !== payload) {
    roughKits.delete(previousItemId);
  }
  selectedWorkshopItemId = payload;
  renderWorkshop();
  paintJades();
}

function workerStepPreview(worker, step) {
  if (step !== "finish") return baseWorkerStepPreview(worker, step);
  const item = (getState()?.me?.bracelets || []).find((entry) => entry.id === selectedWorkshopItemId);
  return baseWorkerStepPreview(worker, step === "finish" && isBangle(item) ? "bangleFinish" : step);
}

function finishItemShape(item) {
  if (isBangle(item)) return "bangle";
  const key = String(item?.kind || item?.design || "").toLowerCase();
  if (["cabochon", "egg", "saddle", "蛋面"].includes(key)) return "cabochon";
  if ([
    "buddha", "buddhapendant", "guanyin", "guanyinpendant", "leaf", "leafpendant",
    "gourd", "gourdpendant", "fubean", "fubeanpendant", "droppendant", "ruyipendant",
    "carving", "雕件"
  ].includes(key)) return "carving";
  if (["peacependant", "plaque", "pierced", "平安扣", "无事牌", "山水牌"].includes(key)) return "pierced";
  return null;
}

function finishCatalog() {
  return getState().inlayCatalog || {};
}

export function finishOptions(keys, labels, selected, {
  enabledKeys = keys,
  disabledReason = "当前组合不兼容"
} = {}) {
  const enabled = new Set(enabledKeys);
  return keys.map((key) => {
    const disabled = !enabled.has(key);
    const reason = disabled ? `（${disabledReason}）` : "";
    return `<option value="${escapeHtml(key)}" ${key === selected ? "selected" : ""} ${disabled ? `disabled title="${escapeHtml(disabledReason)}"` : ""}>${escapeHtml(labels?.[key] || key)}${escapeHtml(reason)}</option>`;
  }).join("");
}

function inlayPreviewTesterRootEl() {
  let root = document.getElementById("inlay-preview-tester-root");
  if (root) return root;
  root = document.createElement("div");
  root.id = "inlay-preview-tester-root";
  root.className = "modal-root";
  root.addEventListener("click", handleInlayPreviewTesterClick);
  root.addEventListener("change", updateInlayPreviewTesterFromControl);
  root.addEventListener("input", updateInlayPreviewTesterFromControl);
  document.body.appendChild(root);
  return root;
}

function handleInlayPreviewTesterClick(event) {
  const actionTarget = event.target.closest("[data-inlay-preview-action]");
  const action = actionTarget?.dataset.inlayPreviewAction;
  if (!action || !activeInlayPreviewTester) return;
  if (action === "close") {
    closeInlayPreviewTester();
    return;
  }
  if (action === "select-setting") {
    activeInlayPreviewTester = applyInlayPreviewTesterField(
      activeInlayPreviewTester,
      "settingId",
      actionTarget.dataset.settingId || "",
      finishCatalog()
    );
    patchInlayPreviewTester();
    return;
  }
  if (action === "select-metal") {
    activeInlayPreviewTester = applyInlayPreviewTesterField(
      activeInlayPreviewTester,
      "metalId",
      actionTarget.dataset.metalId || "",
      finishCatalog()
    );
    patchInlayPreviewTester();
  }
}

function updateInlayPreviewTesterFromControl(event) {
  const field = event.target?.dataset?.inlayPreviewField;
  if (!field || !activeInlayPreviewTester) return;
  activeInlayPreviewTester = applyInlayPreviewTesterField(
    activeInlayPreviewTester,
    field,
    event.target.value,
    finishCatalog()
  );
  patchInlayPreviewTester();
}

function inlayPreviewTesterShell() {
  return `
    <section class="game-modal inlay-preview-tester-modal" role="dialog" aria-modal="true" aria-label="镶嵌预览测试">
      <header class="game-modal-head">
        <div class="game-modal-title">
          <h3>镶嵌预览测试</h3>
          <p>跳过工坊流程，直接查看不同配饰和材质的效果。</p>
        </div>
        <button class="modal-close" data-inlay-preview-action="close" type="button" aria-label="关闭">×</button>
      </header>
      <div class="game-modal-body" data-inlay-preview-body></div>
      <footer class="game-modal-actions">
        <button class="secondary" data-inlay-preview-action="close" type="button">关闭</button>
      </footer>
    </section>
  `;
}

function inlayPreviewSelectOptions(keys, labels, selected, enabledKeys = keys) {
  return finishOptions(keys, labels, selected, { enabledKeys });
}

function renderInlayPreviewControls(state, catalog) {
  const gemPolicy = finishGemPolicy(state.draft);
  const shapeLabels = Object.fromEntries(INLAY_PREVIEW_SHAPES.map((shape) => [shape.id, shape.label]));
  if (state.shape === "bangle") return `<div class="inlay-preview-controls">
    <label class="finish-plan-field"><span>原料形态</span><select data-inlay-preview-field="shape">${inlayPreviewSelectOptions(INLAY_PREVIEW_SHAPES.map((shape) => shape.id), shapeLabels, state.shape)}</select></label>
    ${bangleFinishControls(escapeHtml).replaceAll("data-finish-field", "data-inlay-preview-field")}</div>`;
  const capability = previewCapabilityShape(state.shape);
  const settings = catalog.shapeSettings?.[capability] || [];
  const metals = catalog.settings?.[state.draft.settingId]?.metals || [];
  const settingNames = Object.fromEntries(
    Object.entries(catalog.settings || {}).map(([key, value]) => [key, value.name])
  );
  const backingAllowed = state.shape === "cabochon" && state.draft.productType === "ring";
  return `
    <div class="inlay-preview-controls">
      <label class="finish-plan-field">
        <span>原料形态</span>
        <select data-inlay-preview-field="shape">${inlayPreviewSelectOptions(INLAY_PREVIEW_SHAPES.map((shape) => shape.id), shapeLabels, state.shape)}</select>
      </label>
      <label class="finish-plan-field">
        <span>成品类型</span>
        <select data-inlay-preview-field="productType">${inlayPreviewSelectOptions(Object.keys(catalog.productTypeNames || {}), catalog.productTypeNames, state.draft.productType, catalog.productTypes?.[capability] || [])}</select>
      </label>
      <label class="finish-plan-field">
        <span>镶嵌方式</span>
        <select data-inlay-preview-field="settingId">${inlayPreviewSelectOptions(Object.keys(catalog.settings || {}), settingNames, state.draft.settingId, settings)}</select>
      </label>
      <label class="finish-plan-field">
        <span>金属材质</span>
        <select data-inlay-preview-field="metalId">
          <option value="">${metals.length ? "自动选择兼容金属" : "不使用金属"}</option>
          ${inlayPreviewSelectOptions(Object.keys(catalog.metals || {}), catalog.metals, state.draft.metalId, metals)}
        </select>
      </label>
      <label class="finish-plan-field">
        <span>配石</span>
        <select data-inlay-preview-field="gemId" ${gemPolicy.supports ? "" : "disabled"}>
          <option value="">${gemPolicy.required ? "请选择配石种类（微镶必选）" : "不使用配石"}</option>
          ${inlayPreviewSelectOptions(Object.keys(catalog.gems || {}), catalog.gems, state.draft.gemId)}
        </select>
        <small class="finish-plan-auto-hint">${escapeHtml(gemPolicy.hint)}</small>
      </label>
      <label class="finish-plan-field" ${state.draft.gemId ? "" : "hidden"}>
        <span>${escapeHtml(gemPolicy.title)}</span>
        <input data-inlay-preview-field="gemCount" type="number" readonly value="${Number(state.draft.gemCount || 0)}">
        <small class="finish-plan-auto-hint">${gemPolicy.kind === "channel" ? `左右各 ${state.draft.gemCount / 2} 颗，按槽长排布` : "数量由当前石座结构确定"}</small>
      </label>
      <label class="finish-plan-field"><span>抛光</span><select data-inlay-preview-field="polishId">${inlayPreviewSelectOptions(Object.keys(catalog.polishes || {}), catalog.polishNames, state.draft.polishId)}</select></label>
      <label class="finish-plan-field"><span>玉件尺寸</span><select data-inlay-preview-field="size">${inlayPreviewSelectOptions(["S", "M", "L"], { S: "小号", M: "中号", L: "大号" }, state.size)}</select></label>
      <label class="finish-plan-field" ${backingAllowed ? "" : "hidden"}>
        <span>底托</span>
        <select data-inlay-preview-field="backingId">${inlayPreviewSelectOptions(Object.keys(catalog.backings || {}), catalog.backingNames, state.draft.backingId)}</select>
      </label>
    </div>
  `;
}

function renderInlayPreviewSettingCard(variant, item, size = "compact") {
  return `
    <button class="inlay-preview-card ${variant.selected ? "is-active" : ""}" data-inlay-preview-action="select-setting" data-setting-id="${escapeHtml(variant.id)}" type="button">
      <span class="inlay-preview-card-visual">${productCanvas(buildFinishPreviewProduct(item, variant.draft), size)}</span>
      <span class="inlay-preview-card-label">${escapeHtml(variant.label)}</span>
    </button>
  `;
}

function renderInlayPreviewMetalCard(variant, item, size = "compact") {
  return `
    <button class="inlay-preview-card ${variant.selected ? "is-active" : ""}" data-inlay-preview-action="select-metal" data-metal-id="${escapeHtml(variant.id)}" type="button">
      <span class="inlay-preview-card-visual">${productCanvas(buildFinishPreviewProduct(item, variant.draft), size)}</span>
      <span class="inlay-preview-card-label">${escapeHtml(variant.label)}</span>
    </button>
  `;
}

function renderInlayPreviewMatrices(state, catalog, item) {
  if (state.shape === "bangle") return "";
  const settingCards = settingPreviewVariants(state, catalog)
    .map((variant) => renderInlayPreviewSettingCard(variant, item))
    .join("");
  const metalCards = metalPreviewVariants(state, catalog)
    .map((variant) => renderInlayPreviewMetalCard(variant, item))
    .join("");
  return `
    <section class="inlay-preview-matrix">
      <h4>镶嵌方式</h4>
      <div class="inlay-preview-card-grid">${settingCards || empty("暂无可预览镶嵌方式。")}</div>
      <h4>金属材质</h4>
      <div class="inlay-preview-card-grid">${metalCards || empty("暂无可预览金属材质。")}</div>
    </section>
  `;
}

function patchInlayPreviewTester() {
  const root = document.getElementById("inlay-preview-tester-root");
  const body = root?.querySelector("[data-inlay-preview-body]");
  if (!root || !body || !activeInlayPreviewTester) return;
  const catalog = finishCatalog();
  activeInlayPreviewTester = normalizeInlayPreviewTesterState(activeInlayPreviewTester, catalog);
  const item = buildInlayPreviewBaseItem(activeInlayPreviewTester.shape, activeInlayPreviewTester.size);
  body.innerHTML = `
    <div class="inlay-preview-tester-layout">
      ${renderInlayPreviewControls(activeInlayPreviewTester, catalog)}
      <section class="inlay-preview-main">
        <div class="inlay-preview-main-visual">${productCanvas(buildFinishPreviewProduct(item, activeInlayPreviewTester.draft), "finished")}</div>
        <div class="inlay-preview-current">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${activeInlayPreviewTester.shape === "bangle" ? `手镯 · ${escapeHtml(BANGLE_REFINEMENTS[activeInlayPreviewTester.draft.refinementId].name)}` : `${escapeHtml(catalog.productTypeNames?.[activeInlayPreviewTester.draft.productType] || activeInlayPreviewTester.draft.productType)} · ${escapeHtml(catalog.settings?.[activeInlayPreviewTester.draft.settingId]?.name || activeInlayPreviewTester.draft.settingId)}`}</span>
        </div>
      </section>
    </div>
    ${renderInlayPreviewMatrices(activeInlayPreviewTester, catalog, item)}
  `;
}

export function openInlayPreviewTester() {
  activeInlayPreviewTester = createInlayPreviewTesterState(finishCatalog());
  const root = inlayPreviewTesterRootEl();
  root.innerHTML = inlayPreviewTesterShell();
  inlayPreviewTesterLifecycleCleanup?.();
  inlayPreviewTesterLifecycleCleanup = activateModalLifecycle({
    root,
    dialog: root.querySelector('[role="dialog"]'),
    shell: document.querySelector(".shell"),
    onClose: closeInlayPreviewTester
  });
  patchInlayPreviewTester();
}

export function closeInlayPreviewTester() {
  activeInlayPreviewTester = null;
  inlayPreviewTesterLifecycleCleanup?.();
  inlayPreviewTesterLifecycleCleanup = null;
  document.getElementById("inlay-preview-tester-root")?.remove();
}

function closeFinishPlanModal() {
  finishPlanController.close();
}

function updateFinishPlanFromControl(event) {
  const field = event.target?.dataset?.finishField;
  if (!field || !activeFinishPlanModal || activeFinishPlanModal.submitting) return;
  const draft = activeFinishPlanModal.draft;
  draft[field] = field === "gemCount"
    ? Number(event.target.value)
    : event.target.value === "" ? null : event.target.value;
  if (field === "gemId" && draft.gemId && draft.gemCount < 1) draft.gemCount = 1;
  activeFinishPlanModal.error = "";
  finishPlanController.refresh();
}

function finishRootEl() {
  let root = document.getElementById("finish-plan-root");
  if (root) return root;
  root = document.createElement("div");
  root.id = "finish-plan-root";
  root.className = "modal-root";
  root.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-finish-action]");
    const action = actionTarget?.dataset.finishAction;
    if (!action) return;
    if (action === "close") closeFinishPlanModal();
    else if (action === "confirm") confirmFinishPlan();
    else if (action === "buy-stock") {
      const materialId = actionTarget.dataset.materialId;
      if (materialId) openMaterialBuyModal(materialId);
    }
  });
  root.addEventListener("change", updateFinishPlanFromControl);
  root.addEventListener("input", updateFinishPlanFromControl);
  document.body.appendChild(root);
  return root;
}

function openFinishPlanModal(device, item, workerId) {
  const shape = finishItemShape(item);
  finishPlanController.open({
    deviceId: device.id,
    itemId: item.id,
    workerId,
    shape,
    draft: createFinishPlanDraft(shape, finishCatalog(), item),
    submitting: false,
    error: ""
  });
}

function confirmFinishPlan() {
  finishPlanController.confirm();
}

function mountFinishPlanShell() {
  const root = finishRootEl();
  root.innerHTML = `
    <section class="game-modal finish-plan-modal" role="dialog" aria-modal="true" aria-label="精加工方案">
      <header class="game-modal-head">
        <div class="game-modal-title">
          <h3>制定精加工方案</h3>
          <p data-finish-item-title></p>
        </div>
        <button class="modal-close" data-finish-action="close" type="button" aria-label="关闭">×</button>
      </header>
      <div class="game-modal-body">
        <div class="finish-plan-comparison" data-finish-item-preview></div>
        <div class="finish-plan-grid">
          <label class="finish-plan-field"><span>成品类型</span><select data-finish-field="productType"></select></label>
          <label class="finish-plan-field"><span>镶嵌方式</span><select data-finish-field="settingId"></select></label>
          <label class="finish-plan-field">
            <span class="finish-plan-field-label">金属<em class="finish-plan-stock-hint" data-finish-stock="metal" hidden></em></span>
            <select data-finish-field="metalId"></select>
          </label>
          <label class="finish-plan-field"><span>抛光</span><select data-finish-field="polishId"></select></label>
          <label class="finish-plan-field">
            <span class="finish-plan-field-label">配石<em class="finish-plan-stock-hint" data-finish-stock="gem" hidden></em></span>
            <select data-finish-field="gemId"></select>
            <small class="finish-plan-auto-hint" data-finish-gem-policy></small>
          </label>
          <label class="finish-plan-field" data-finish-count="gem" hidden>
            <span data-finish-gem-title>配石数量 · 自动计算</span>
            <input data-finish-field="gemCount" type="number" readonly aria-label="当前石座所需配石颗数">
            <small class="finish-plan-auto-hint" data-finish-gem-count-hint></small>
          </label>
          <label class="finish-plan-field" data-finish-backing hidden>
            <span>底托</span><select data-finish-field="backingId"></select>
          </label>
        </div>
        <div class="finish-plan-summary">
          <div><span>预计增值</span><strong class="pos" data-finish-summary="value"></strong></div>
        </div>
      </div>
      <footer class="game-modal-actions">
        <div class="finish-plan-warning-wrap" data-finish-warning-wrap hidden>
          <p class="finish-plan-warning" data-finish-warning></p>
          <span class="finish-plan-buy-actions" data-finish-buy-actions></span>
        </div>
        <div class="finish-plan-action-btns">
          <button class="secondary" data-finish-action="close" type="button">取消</button>
          <button class="primary" data-finish-action="confirm" type="button"></button>
        </div>
      </footer>
    </section>
  `;
  if (activeFinishPlanModal?.shape === "bangle") {
    root.querySelector(".finish-plan-grid").innerHTML = bangleFinishControls(escapeHtml);
    root.querySelector(".finish-plan-modal").classList.add("bangle-finish-modal");
    root.querySelector('[role="dialog"]').setAttribute("aria-label", "手镯精修方案");
  }
  finishModalLifecycleCleanup?.();
  finishModalLifecycleCleanup = activateModalLifecycle({
    root,
    dialog: root.querySelector('[role="dialog"]'),
    shell: document.querySelector(".shell"),
    onClose: closeFinishPlanModal
  });
  return root;
}

function patchFinishPlanModal() {
  if (!activeFinishPlanModal) return;
  const root = document.getElementById("finish-plan-root");
  const item = workshopStageItems().find((entry) => entry.id === activeFinishPlanModal.itemId);
  if (!root || !item) return closeFinishPlanModal();
  preserveFinishPlanUiState(root, () => patchFinishPlanModalFields(root, item));
}

function patchFinishPlanModalFields(root, item) {
  const catalog = finishCatalog();
  const { shape, draft } = activeFinishPlanModal;
  const worker = workshopWorkers()
    .find((entry) => entry.id === activeFinishPlanModal.workerId);
  const workerFee = workerProcessingFee(worker, 0, {
    stage: "finishing",
    itemValue: item.value ?? item.price
  });
  normalizeFinishPlanDraft(shape, draft, catalog, item);
  patchFinishPlanPreview(root, item, draft);
  const validation = validateFinishPlanDraft({
    shape,
    draft,
    catalog,
    materials: getState().me.externalMaterials || {},
    cash: Number(getState().me.cash || 0),
    workerFee,
    itemValue: item.value ?? item.price,
    item
  });
  activeFinishPlanModal.canStart = validation.canStart;
  if (shape === "bangle") {
    const device = workshopDevices().find((entry) => entry.id === activeFinishPlanModal.deviceId);
    patchBangleFinishUi(root, { item, draft, worker, device, durationMs: workshopDurationMs(device, worker),
      formatMoney, formatDuration, escapeHtml, error: activeFinishPlanModal.error || validation.reasons.join("；"),
      canStart: validation.canStart, submitting: activeFinishPlanModal.submitting });
    return;
  }

  root.querySelector("[data-finish-item-title]").textContent =
    `${item.name} · ${worker?.name || "师傅"}`;

  const fields = Object.fromEntries(
    [...root.querySelectorAll("[data-finish-field]")].map((field) => [field.dataset.finishField, field])
  );
  const settings = catalog.shapeSettings?.[shape] || [];
  const metals = catalog.settings?.[draft.settingId]?.metals || [];
  const settingNames = Object.fromEntries(
    Object.entries(catalog.settings || {}).map(([key, value]) => [key, value.name])
  );

  const productTypes = catalog.productTypes?.[shape] || [];
  const productNames = Object.fromEntries(Object.entries(catalog.productTypeNames || {}).map(([key, name]) => {
    const reason = productTypes.includes(key) ? finishPieceRestriction(item, key) : "";
    return [key, reason ? `${name}（${reason}）` : name];
  }));
  patchFinishPlanSelectOptions(fields.productType,
    finishOptions(Object.keys(catalog.productTypeNames || {}), productNames, draft.productType, {
      enabledKeys: productTypes.filter((type) => !finishPieceRestriction(item, type))
    }), draft.productType);
  patchFinishPlanSelectOptions(fields.settingId,
    finishOptions(Object.keys(catalog.settings || {}), settingNames, draft.settingId, { enabledKeys: settings }),
    draft.settingId);
  patchFinishPlanSelectOptions(fields.metalId,
    `<option value="">${metals.length ? "请选择金属种类" : "不使用金属"}</option>${finishOptions(Object.keys(catalog.metals || {}), catalog.metals, draft.metalId, { enabledKeys: metals })}`,
    draft.metalId);
  patchFinishPlanSelectOptions(fields.polishId,
    finishOptions(Object.keys(catalog.polishes || {}), catalog.polishNames, draft.polishId),
    draft.polishId);
  patchFinishPlanSelectOptions(fields.gemId,
    `<option value="">${finishGemPolicy(draft).required ? "请选择配石种类（微镶必选）" : "不使用配石"}</option>${finishOptions(Object.keys(catalog.gems || {}), catalog.gems, draft.gemId)}`,
    draft.gemId);

  const gemPolicy = finishGemPolicy(draft);
  fields.gemCount.value = String(draft.gemCount || 0);
  fields.gemId.disabled = !gemPolicy.supports;
  root.querySelector('[data-finish-gem-policy]').textContent = gemPolicy.hint;
  root.querySelector('[data-finish-gem-title]').textContent = gemPolicy.title;
  root.querySelector('[data-finish-gem-count-hint]').textContent = gemPolicy.kind === "channel" ? `左右各 ${draft.gemCount / 2} 颗，按有效槽长排布` : gemPolicy.hint;
  fields.gemCount.readOnly = true;
  root.querySelector('[data-finish-count="gem"]').hidden = !draft.gemId;
  const backingAllowed = shape === "cabochon" && draft.productType === "ring";
  const backingField = root.querySelector("[data-finish-backing]");
  backingField.hidden = !backingAllowed;
  if (backingAllowed) {
    patchFinishPlanSelectOptions(fields.backingId,
      finishOptions(Object.keys(catalog.backings || {}), catalog.backingNames, draft.backingId),
      draft.backingId);
  }

  const metalStock = root.querySelector('[data-finish-stock="metal"]');
  const metalShort = (validation.stockShortages || []).some((entry) => entry.kind === "metal");
  metalStock.hidden = !validation.showMetalInventory;
  metalStock.classList.toggle("is-short", metalShort);
  metalStock.textContent = draft.metalId
    ? `当前持有 ${validation.metalHeld.toFixed(2)} 克 · 需要 ${Number(validation.quote?.metalAmount || 0).toFixed(2)} 克`
    : "";

  const gemStock = root.querySelector('[data-finish-stock="gem"]');
  const gemShort = (validation.stockShortages || []).some((entry) => entry.kind === "gem");
  gemStock.hidden = !validation.showGemInventory;
  gemStock.classList.toggle("is-short", gemShort);
  gemStock.textContent = draft.gemId
    ? `当前持有 ${validation.gemHeld} 颗 · 需要 ${Number(validation.quote?.gemCount || 0)} 颗`
    : "";

  root.querySelector('[data-finish-summary="value"]').textContent =
    `+${formatMoney(validation.quote?.valueBonus || 0)}（×${Number(validation.quote?.valueMultiplier || 1).toFixed(2)}）`;

  const warningWrap = root.querySelector("[data-finish-warning-wrap]");
  const warning = root.querySelector("[data-finish-warning]");
  const buyActions = root.querySelector("[data-finish-buy-actions]");
  const warningText = activeFinishPlanModal.error || validation.reasons.join("；");
  const showWarning = Boolean(warningText);
  warningWrap.hidden = !showWarning;
  warning.textContent = warningText;

  const shortageButtons = (validation.stockShortages || []).map((entry) => {
    const name = entry.kind === "gem"
      ? (catalog.gems?.[entry.materialId] || "配石")
      : (catalog.metals?.[entry.materialId] || "金属");
    return `<button type="button" class="finish-plan-buy-btn" data-finish-action="buy-stock" data-material-id="${escapeHtml(entry.materialId)}">去购买${escapeHtml(name)}</button>`;
  }).join("");
  if (buyActions.dataset.buttonsHtml !== shortageButtons) {
    buyActions.innerHTML = shortageButtons;
    buyActions.dataset.buttonsHtml = shortageButtons;
  }

  const confirm = root.querySelector('[data-finish-action="confirm"]');
  confirm.disabled = !validation.canStart || activeFinishPlanModal.submitting;
  confirm.textContent = activeFinishPlanModal.submitting
    ? "正在提交…"
    : "确认开工";
}

export function patchFinishPlanPreview(root, item, draft = null) {
  const preview = root.querySelector("[data-finish-item-preview]");
  if (!preview) return;
  const source = item?.sourceMaterial || {};
  const visual = source.visual || {};
  const placement = source.placement || {};
  const sourceKey = JSON.stringify([
    item?.id,
    item?.name,
    item?.materialStage,
    item?.kind,
    item?.design,
    item?.ringSize,
    item?.size,
    item?.jadePiece?.signature,
    source.roughId,
    source.roughName,
    source.openingSeed,
    visual.seed,
    visual.openingSeed,
    placement.id,
    placement.openingTpl,
    placement.kitType,
    placement.x,
    placement.y,
    placement.svgSpace,
    placement.rot ?? placement.rotation,
    placement.scale,
    placement.ringSize,
    draft?.productType,
    draft?.refinementId,
    draft?.settingId,
    draft?.metalId,
    draft?.gemId,
    draft?.gemCount,
    draft?.polishId,
    draft?.backingId
  ]);
  if (finishPlanPreviewMarkupCache.get(preview) === sourceKey) return;
  const hideMount = preview.querySelector?.('[data-jade-hide-mount]')?.checked || false;
  preview.innerHTML = jadePiecePreviewMarkup(item, buildFinishPreviewProduct(item, draft))
    || productCanvas(buildFinishPreviewProduct(item, draft), "compact");
  const toggle = preview.querySelector?.('[data-jade-hide-mount]');
  if (toggle) toggle.checked = hideMount;
  finishPlanPreviewMarkupCache.set(preview, sourceKey);
}

export function workshopStartJob(target, payload) {
  const deviceId = payload || activeWorkshopDeviceId;
  const itemId = target.dataset.itemId || selectedWorkshopItemId;
  const device = workshopDevices().find((item) => item.id === deviceId);
  const request = {
    deviceId,
    itemId,
    workerId: selectedWorkshopWorkerId || device?.workerId,
    requestId: globalThis.crypto?.randomUUID?.() || `workshop-${Date.now()}`
  };
  if (device?.stage === "finishing") {
    const item = workshopProcessableItems(device).find((entry) => entry.id === itemId);
    if (!item) { showToast("请选择可精加工的套件。"); return; }
    openFinishPlanModal(device, item, request.workerId);
    return;
  }
  if (device?.stage === "carving") {
    request.kits = openingKitsForServer(itemId);
    if (!request.kits.length) { showToast("请先在明料上摆放套件。"); return; }
    roughKits.set(itemId, []);
  }
  socketRef.emit("startWorkshopJob", request, (result = {}) => {
    if (result.ok) {
      workshopBackDevices();
      return;
    }
    if (result.message) showToast(result.message);
  });
}
export function workshopAssignWorker(target, payload) {
  const deviceId = payload || activeWorkshopDeviceId;
  const workerId = target.dataset.workerId;
  if (!workerId || !deviceId) return;
  socketRef.emit("assignWorkshopWorker", { deviceId, workerId });
}
export function workshopRecommendWorker(payload) {
  const deviceId = payload || activeWorkshopDeviceId;
  const device = workshopDevices().find((d) => d.id === deviceId);
  const workerId = device && workshopRecommendedWorkerId(device);
  if (workerId) {
    selectedWorkshopWorkerId = workerId;
    socketRef.emit("assignWorkshopWorker", { deviceId, workerId });
    renderWorkshop();
  }
}
