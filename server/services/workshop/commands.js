// Start/assign use cases, validation, fees and material reservations.
import { employeeWorkBlock, enterEmployeePayrollDay } from "../../systems/employee-payroll.js";
import { kitFitsRemainingStone } from "../../../shared/domain/jade/offcut-layout.js";
import { speedTimeScale as wsSpeedTimeScale } from "../../../shared/domain/workshop/workshop-craft-scoring.js";
import { productionDuration } from "../../../shared/domain/economy/jade-loop.js";
import { isWorkerBusy, workerProcessingFee } from "../../systems/employee-system.js";
import { canonicalizeFinishPlan, quoteFinishPlan, reserveFinishMaterials, refundFinishMaterials } from "../../systems/inlay-system.js";
import { canonicalizeExtractionKitIntents } from "../workshop-planning.js";
import { OWNER_OPERATOR_ID } from "../../../shared/domain/economy/public-workstations.js";
import { openingKitsOutsideStone } from "../../../shared/domain/jade/jade-opening-engine.js";

export function createWorkshopCommands({
  money,
  spendCash,
  takeItem,
  normalizePlayer,
  materialStageFor,
  refreshPlayerReport,
  broadcast,
  randomUUID,
  TIMING_PROFILE,
  openingKitFromExtractionKit,
  extractionKitsOverlap,
  normalizeExtractionKits,
  expandKitPlacements,
  workshopDeviceForPlayer,
  workshopWorkerForPlayer,
  workshopJobsForDevice,
  playerOwnsWorkshop,
  restoreWorkshopItem,
  findWorkshopItem,
  openingStoneForRough
}) {
function startProductionJob(player, stage, item, options = {}) {
  if (enterEmployeePayrollDay(player, { spendCash, reason: "continued" }).changed) broadcast?.();
  if (!options.ownerOperated && employeeWorkBlock(player)) return null;
  const now = Date.now();
  const durationStage = options.durationStage || stage;
  const durationMs = Math.max(1, Math.round(
    productionDuration(durationStage, TIMING_PROFILE) * (options.timeScale || 1)
  ));
  const job = {
    id: randomUUID(),
    type: "productionJob",
    stage,
    deviceId: options.deviceId,
    deviceAttrs: options.deviceAttrs,
    workerId: options.workerId,
    outputStage: options.outputStage,
    outputPreview: options.outputPreview,
    item,
    options,
    fee: 0,
    startedAt: now,
    readyAt: now + durationMs
  };
  player.jobs.push(job);
  return job;
}

function startRoughOpeningForPlayer(player, roughId) {
  return startWorkshopJobForPlayer(player, "opening", { itemId: roughId });
}

function startWorkshopJobForPlayer(player, deviceId, payload = {}) {
  if (!player) return { ok: false, message: "未找到玩家。" };
  normalizePlayer(player);
  if (enterEmployeePayrollDay(player, { spendCash, reason: "continued" }).changed) broadcast?.();
  if (!playerOwnsWorkshop(player)) return { ok: false, message: "先去交易行买下街角小工坊。" };
  const device = workshopDeviceForPlayer(player, deviceId);
  if (!device) return { ok: false, message: "这台设备不存在。" };
  if (player.commissions?.active?.deviceIds?.includes(device.id)) {
    return { ok: false, code: "BUSY", message: "这台设备正在用于来料单，请先交付来料单。" };
  }
  if (device.blackmarketListingId) return { ok: false, code: "RESOURCE_LISTED", message: "设备正在黑市挂牌，请先撤回再使用。" };
  if (Number(device.condition ?? 100) <= 0) {
    return { ok: false, message: "这台设备耐久已耗尽，请先维修。" };
  }
  if (workshopJobsForDevice(player, device.id).length >= 1) {
    return { ok: false, message: "这台设备正在加工；每台设备容量固定为 1，不设等待队列。" };
  }
  const worker = workshopWorkerForPlayer(player, payload.workerId || device.workerId)
    || (!payload.workerId ? workshopWorkerForPlayer(player, OWNER_OPERATOR_ID) : null);
  if (!worker) {
    return { ok: false, code: "NOT_FOUND", message: "这位师傅不存在。" };
  }
  const blocked = worker.isOwner ? null : employeeWorkBlock(player);
  if (blocked) return blocked;
  if (worker.isOwner && player.commissions?.active) {
    return { ok: false, code: "WORKER_BUSY", message: "掌柜正在处理来料单，请先完成并领取报酬。" };
  }
  if (isWorkerBusy(player, worker.id)) {
    return { ok: false, code: "WORKER_BUSY", message: "这位师傅正在执行其他任务。" };
  }
  const itemId = payload?.itemId || payload?.roughId || payload?.productId || payload?.braceletId;
  if (device.stage === "finishing") {
    const previewItem = findWorkshopItem(player, device, itemId);
    if (!previewItem) {
      return { ok: false, code: "NOT_FOUND", message: "找不到可加工物料。" };
    }
    if (materialStageFor(previewItem) !== device.inputStage) {
      return {
        ok: false,
        code: "INVALID_COMBINATION",
        message: "这台设备不能处理当前阶段的物料。" };
    }
    const canonicalPlan = canonicalizeFinishPlan(previewItem, payload.finishPlan);
    if (!canonicalPlan.ok) return canonicalPlan;
    const quote = quoteFinishPlan(
      previewItem,
      canonicalPlan.plan,
      workerProcessingFee(worker, 0, {
        stage: "finishing",
        itemValue: previewItem.value ?? previewItem.price
      })
    );
    const item = takeItem(player, device.inputType, itemId);
    const reserve = reserveFinishMaterials(player, quote);
    if (!reserve.ok) {
      restoreWorkshopItem(player, item);
      return reserve;
    }
    const devSpeed = Number(device.attrs?.speed || 0);
    const devTimeScale = Math.max(0.2, 1 - Math.min(0.8, devSpeed / 100));
    const job = startProductionJob(player, device.stage, item, {
      label: device.name,
      fee: quote.laborFee,
      feeAlreadyPaid: true,
      durationStage: device.durationStage,
      deviceId: device.id,
      deviceAttrs: device.attrs,
      workerId: worker.id,
      ownerOperated: Boolean(worker.isOwner),
      timeScale: wsSpeedTimeScale(worker) * devTimeScale * (device.timeMultiplier || 1) * (quote.timeMultiplier || 1),
      outputStage: device.outputStage,
      outputPreview: { materialStage: device.outputStage }
    });
    if (!job) {
      refundFinishMaterials(player, reserve.reservedMaterials, reserve.reservedMaterialCosts);
      restoreWorkshopItem(player, item);
      return { ok: false, code: "WORK_BLOCKED", message: "暂时无法开工，翡翠与辅材已退回。" };
    }
    job.finishPlan = structuredClone(canonicalPlan.plan);
    job.inlayQuote = quote;
    job.reservedMaterials = reserve.reservedMaterials;
    job.reservedMaterialCosts = reserve.reservedMaterialCosts;
    refreshPlayerReport(player);
    return { ok: true, message: `${device.name} 已开工。`, job, device, worker, fee: job.fee };
  }
  const processingItem = findWorkshopItem(player, device, itemId);
  if (!processingItem) return { ok: false, message: "找不到可加工物料。" };
  const processingFee = workerProcessingFee(worker, 0, {
    stage: device.stage,
    itemValue: processingItem.value ?? processingItem.price
  });
  const inputStage = materialStageFor(processingItem);
  if (inputStage !== device.inputStage) {
    return { ok: false, message: "这台设备不能处理当前阶段的物料。" };
  }

  let normalizedKits = [];
  let existingKits = [];
  if (device.needsKits) {
    existingKits = normalizeExtractionKits(
      processingItem.extractionKits || processingItem.braceletPlacements || [],
      { maxScale: processingItem.leftoverGeometryVersion === 2 ? 5 : 1.45 }
    );
    const rawKits = Array.isArray(payload?.kits) && payload.kits.length
      ? payload.kits
      : [];
    const legacyKits = !rawKits.length && Array.isArray(payload?.placements)
      ? payload.placements.map((placement) => ({ ...placement, type: "bangle" }))
      : [];
    const planResult = canonicalizeExtractionKitIntents(
      rawKits.length ? rawKits : legacyKits,
      { maxKits: 10 - existingKits.length, makeId: randomUUID }
    );
    if (!planResult.ok) return planResult;
    normalizedKits = planResult.kits;
    const placements = expandKitPlacements(normalizedKits);
    if (!placements.length) {
      return { ok: false, message: "请先在明料上摆放套件。" };
    }
    const existingIds = new Set(existingKits.map((kit) => String(kit.id)));
    if (normalizedKits.some((kit) => existingIds.has(String(kit.id)))) {
      return { ok: false, code: "INVALID_PLANNING", message: "套件编号已被这块料使用。" };
    }
    const stone = openingStoneForRough(processingItem);
    if (openingKitsOutsideStone(normalizedKits.map(openingKitFromExtractionKit), stone).size) {
      return { ok: false, code: "INVALID_PLANNING", message: "套件超出石料边缘，请移回料内再开工。" };
    }
    if (processingItem.leftoverGeometryVersion === 2) {
      const consumed = existingKits.map(openingKitFromExtractionKit);
      for (const kit of normalizedKits.map(openingKitFromExtractionKit)) {
        if (!kitFitsRemainingStone(kit, stone, consumed)) return { ok: false, code: "INVALID_PLANNING", message: "取件必须完整放在剩余料内，且不能覆盖已取走的部分。" };
        consumed.push(kit);
      }
    } else if (extractionKitsOverlap([...existingKits, ...normalizedKits])) {
      return { ok: false, message: "套件位置互相重叠，重新摆一下。" };
    }
  }

  const item = takeItem(player, device.inputType, itemId);
  if (!item) return { ok: false, message: "找不到可加工物料。" };
  if (device.needsKits) {
    item.extractionKits = [...existingKits, ...normalizedKits].slice(0, 10);
    item.braceletPlacements = item.extractionKits;
  }

  const devSpeed = Number(device.attrs?.speed || 0);
  const devTimeScale = Math.max(0.2, 1 - Math.min(0.8, devSpeed / 100));
  const job = startProductionJob(player, device.stage, item, {
    label: device.name,
    fee: processingFee,
    durationStage: device.durationStage,
    deviceId: device.id,
    deviceAttrs: device.attrs,
    workerId: worker?.id || device.workerId,
    ownerOperated: Boolean(worker.isOwner),
    timeScale: (worker ? wsSpeedTimeScale(worker) : 1) * devTimeScale * (device.timeMultiplier || 1),
    outputStage: device.outputStage,
    outputPreview: { materialStage: device.outputStage },
    kits: normalizedKits
  });
  if (job && device.needsKits) job.previousExtractionKits = structuredClone(existingKits);
  if (!job) {
    restoreWorkshopItem(player, item);
    return { ok: false, message: "现金不足，无法开工。" };
  }
  refreshPlayerReport(player);
  return { ok: true, message: `${device.name} 已开工。`, job, device, worker, fee: job.fee };
}

function assignWorkshopWorkerForPlayer(player, payload = {}) {
    if (!player) return { ok: false, message: "未找到玩家。" };
    normalizePlayer(player);
    if (!playerOwnsWorkshop(player)) return { ok: false, message: "先去交易行买下街角小工坊。" };
    const device = workshopDeviceForPlayer(player, payload.deviceId);
    if (!device) return { ok: false, message: "这台设备不存在。" };
    if (device.blackmarketListingId) return { ok: false, message: "设备正在黑市挂牌，请先撤回再换人。" };
    const worker = workshopWorkerForPlayer(player, payload.workerId);
    if (!worker) return { ok: false, message: "这位师傅不存在。" };
    if (isWorkerBusy(player, worker.id) || (worker.isOwner && player.commissions?.active)) return { ok: false, message: "这位师傅正在执行其他任务。" };
    if (player.commissions?.active?.deviceIds?.includes(device.id)) return { ok: false, code: "BUSY", message: "设备正在用于来料单，请先交付。" };
    if (device.workerId === worker.id) return { ok: false, message: `${worker.name} 已在本台。` };
    // Looking up a worker normalizes saved devices, so mutate the current
    // owned instance rather than a reference from the previous normalization.
    const currentDevice = player.workshop.devices.find((entry) => entry.id === device.id);
    currentDevice.workerId = worker.id;
    return { ok: true, message: `${worker.name} 已安排到 ${currentDevice.name}。`, device: currentDevice, worker };
  }

  return { startProductionJob, startRoughOpeningForPlayer, startWorkshopJobForPlayer, assignWorkshopWorkerForPlayer };
}
