// Read models and estimates; current fallback values are compatibility data.
import { isBangle } from "../../../shared/domain/workshop/bangle-finish.js";
import { speedTimeScale, workerStepPreview as baseWorkerStepPreview } from "../../workshop-craft-scoring.js";
import { workerProcessingFee } from "../../worker-economy.js";
import { equipmentRepairQuote } from "../../equipment-maintenance.js";
import { publicStationFee } from "../../../shared/domain/economy/public-workstations.js";
import { WORKSHOP_DURATION_FALLBACK, WORKSHOP_DEVICE_FALLBACKS, WORKSHOP_WORKER_FALLBACKS, deviceStep } from "./catalog.js";

export function createWorkshopSelectors({ ui, getState, helpers }) {
  const { formatDuration, materialStageForClient, materialStageLabel, productionJobsFor } = helpers;

function workshopDevices() {
  const workshop = getState().me.workshop;
  const serverDevices = workshop?.devices;
  if (!Array.isArray(serverDevices)) return WORKSHOP_DEVICE_FALLBACKS;
  return [...serverDevices, ...(workshop.publicStations || [])].map((device) => ({
    ...(WORKSHOP_DEVICE_FALLBACKS.find((fallback) => fallback.type === device.stage) || {}),
    ...device,
    type: device.stage || device.type,
    capacity: 1
  }));
}

function workshopWorkers() {
  const workshop = getState().me.workshop;
  const serverWorkers = [...(workshop?.owner ? [workshop.owner] : []), ...(workshop?.workers || [])];
  if (!workshop) return WORKSHOP_WORKER_FALLBACKS;
  return serverWorkers.map((worker) => ({
    ...(WORKSHOP_WORKER_FALLBACKS.find((fallback) => fallback.id === worker.id) || {}),
    ...worker
  }));
}

function workshopWorkerFor(device) {
  return workshopWorkers().find((worker) => worker.id === device.workerId) || workshopWorkers()[0] || null;
}

function workshopJobs(deviceId = null) {
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

function workshopProcessableItems(device) {
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

function workshopStageItems() {
  return [
    ...(getState().me.rough || []).map((item) => ({ ...item, type: "rough" })),
    ...(getState().me.materials || []).map((item) => ({ ...item, type: "material" })),
    ...(getState().me.slices || []).map((item) => ({ ...item, type: "slice" })),
    ...(getState().me.bracelets || []).map((item) => ({ ...item, type: "bracelet" }))
  ];
}

function workshopOutputLabel(device) {
  return materialStageLabel(device.outputStage);
}

function workshopDurationMs(device, worker = workshopWorkerFor(device)) {
  const durationStage = device?.durationStage || "rough";
  const base = Number(getState()?.timing?.production?.[durationStage])
    || WORKSHOP_DURATION_FALLBACK[durationStage]
    || WORKSHOP_DURATION_FALLBACK.rough;
  const deviceSpeed = Number(device?.attrs?.speed || 0);
  const deviceTimeScale = Math.max(0.2, 1 - Math.min(0.8, deviceSpeed / 100));
  return Math.max(1000, Math.round(base * speedTimeScale(worker) * deviceTimeScale * Number(device?.timeMultiplier || 1)));
}

function workshopDurationLabel(device, worker = workshopWorkerFor(device)) {
  return `约 ${formatDuration(workshopDurationMs(device, worker))}`;
}

function workshopWorkerImpact(worker, device) {
  const trait = worker?.traits?.[0] ? `，特性「${worker.traits[0]}」` : "";
  return {
    opening: `${worker.name}：开料耗时小幅下降，损耗风险小幅降低${trait}。`,
    carving: `${worker.name}：按套件边界下刀更稳，取件质量小幅提高${trait}。`,
    finishing: `${worker.name}：细部收口更准，最终成品稳定性小幅提高${trait}。`
  }[device.stage || device.type] || `${worker.name}：当前工序表现稳定${trait}。`;
}

function workshopDeviceImpact(device) {
  return `${device.name} 1阶：容量 ${workshopJobs(device.id).length}/1，状态 ${Math.round(device.condition ?? 100)}%，稳定完成${workshopOutputLabel(device)}工序。`;
}

function workshopRepairQuote(device) {
  return equipmentRepairQuote(device);
}

function workshopJobEstimate(device, item) {
  const worker = (ui.selectedWorkshopWorkerId
    && workshopWorkers().find((entry) => entry.id === ui.selectedWorkshopWorkerId))
    || workshopWorkerFor(device);
  const fee = device.publicStation
    ? publicStationFee(device, item, getState().me.id)
    : workerProcessingFee(worker, 0, {
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
    summary: `预计：${fee ? `工位费 ${fee}` : "免加工费"}，${duration}，产出${workshopOutputLabel(device)}。`
  };
}

function workshopRecommendedWorkerId(device) {
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

function workerStepPreview(worker, step) {
  if (step !== "finish") return baseWorkerStepPreview(worker, step);
  const item = (getState()?.me?.bracelets || []).find((entry) => entry.id === ui.selectedWorkshopItemId);
  return baseWorkerStepPreview(worker, step === "finish" && isBangle(item) ? "bangleFinish" : step);
}

function finishCatalog() {
  return getState().inlayCatalog || {};
}

  return { workshopDevices, workshopWorkers, workshopWorkerFor, workshopJobs, isWorkshopLeftoverMaterial, workshopProcessableItems, workshopHeldJadeItems, workshopStageItems, workshopOutputLabel, workshopDurationMs, workshopDurationLabel, workshopWorkerImpact, workshopDeviceImpact, workshopRepairQuote, workshopJobEstimate, workshopRecommendedWorkerId, workerStepPreview, finishCatalog };
}
