import { playersMatching } from "../persistence/mutation-scope.js";
import { employeeWorkBlock, enterEmployeePayrollDay } from "../systems/employee-payroll.js";
import { kitFitsRemainingStone } from "../../shared/domain/jade/offcut-layout.js";
/**
 * Workshop service — device lookup + start/complete production jobs.
 * Use createWorkshopService(deps) after server helpers exist.
 */
import {
  applyCraftValue,
  applyCraftStepValue,
  speedTimeScale as wsSpeedTimeScale,
  stageToStep as wsStageToStep,
  stepScore as wsStepScore,
  workshopShatterChance
} from "../../shared/domain/workshop/workshop-craft-scoring.js";
import {
  buildOpeningStone,
  computeGrade as computeOpeningGrade,
  evaluateOpeningKit,
  evaluateLeftoverMaterial,
  scaleForOpeningKit
} from "../../shared/domain/jade/jade-opening-engine.js";
import { productionDuration } from "../../shared/domain/economy/jade-loop.js";
import { captureExtractedJadePiece } from "../../shared/domain/workshop/finished-product-design.js";
import { isBangle, bangleStepScore } from "../../shared/domain/workshop/bangle-finish.js";
import { durabilityLoss } from "../systems/equipment-system.js";
import {
  isWorkerBusy,
  grantActivityExperience,
  workerProcessingFee
} from "../systems/employee-system.js";
import {
  canonicalizeFinishPlan,
  quoteFinishPlan,
  reserveFinishMaterials,
  refundFinishMaterials,
  applyInlay
} from "../systems/inlay-system.js";
import {
  grantPlayerExp
} from "../../shared/domain/progression/player-progression.js";
import { settlePlayerAchievements } from "./achievement-rewards.js";
import { applyRepDelta } from "../../shared/domain/economy/metric-history.js";
import { addItemCost, distributeItemCost } from "../../shared/domain/economy/item-cost.js";
import {
  canonicalizeExtractionKitIntents,
  createWorkshopPlanning
} from "./workshop-planning.js";
import { createWorkshopRoster } from "./workshop-roster.js";
import { OWNER_OPERATOR_ID, publicStationFee, publicWorkshopStations } from "../../shared/domain/economy/public-workstations.js";
import { createWorkshopDeliveryService } from "./workshop-delivery.js";
import { materialEvaluationWeight, partitionMaterialValue } from "../../shared/domain/workshop/material-value-pool.js";

export function createWorkshopService(deps) {
  const {
    money,
    clamp,
    spendCash,
    takeItem,
    markInventoryItemNew,
    normalizePlayer,
    materialStageFor,
    qualityByKey,
    refreshPlayerReport,
    advanceTask,
    addNews,
    emitUiEventToPlayer,
    getState,
    isPlayerOnline,
    broadcast,
    randomUUID,
    TIMING_PROFILE
  } = deps;

  const {
    normalizeWorkshop,
    starterDevices,
    mergeWorkerSkills,
    WORKSHOP_WORKER_DEFS
  } = createWorkshopRoster({ clamp, makeId: randomUUID });

  const {
    normalizeAngle,
    angleDistance,
    cutAngleName,
    makeSliceBoard,
    normalizePlan,
    normalizePlacement,
    normalizePlacements,
    openingTplForKit,
    openingKitFromExtractionKit,
    extractionKitsOverlap,
    normalizeExtractionKits,
    expandKitPlacements,
    kitProductMeta,
    placementFootprint,
    templateWidthOnBoard,
    placementsOverlap,
    scoreSlicePlacement,
    scoreSlicePlan,
    scoreRoughPlacement,
    revealPolishedRough
  } = createWorkshopPlanning({ clamp, money, qualityByKey, randomUUID });

  const state = new Proxy({}, {
    get(_t, prop) {
      return getState()[prop];
    },
    set(_t, prop, value) {
      getState()[prop] = value;
      return true;
    },
    has(_t, prop) {
      return prop in getState();
    }
  });

  const { storeWorkshopDelivery, revealWorkshopDeliveryForPlayer, claimWorkshopDeliveryForPlayer } = createWorkshopDeliveryService({
    normalizePlayer, restoreWorkshopItem, markInventoryItemNew, refreshPlayerReport, randomUUID,
    onClaim: (player) => deps.refillOrders?.(player)
  });

  function wsApplyWorker(item, bonus, gradeMult, worker) {
    return applyCraftValue(item, bonus, gradeMult, worker, money);
  }

function workshopDevicesForPlayer(player) {
  normalizeWorkshop(player);
  return [...player.workshop.devices, ...publicWorkshopStations()];
}

function workshopDeviceForPlayer(player, deviceId) {
  const devs = workshopDevicesForPlayer(player);
  return devs.find((device) => device.id === deviceId) || devs.find((device) => device.stage === deviceId) || null;
}

function workshopWorkerForPlayer(player, workerId) {
  normalizeWorkshop(player);
  if (workerId === OWNER_OPERATOR_ID) return player.workshop.owner;
  return player.workshop.workers.find((worker) => worker.id === workerId) || null;
}

function legacyDeviceIdForStage(stage) {
  if (stage === "rough") return "opening";
  if (stage === "refine") return "carving";
  if (stage === "inlay") return "finishing";
  return stage;
}

function workshopJobsForDevice(player, deviceId) {
  normalizePlayer(player);
  const jobs = (player.jobs || []).filter((job) => (job.deviceId || legacyDeviceIdForStage(job.stage)) === deviceId);
  const commission = player.commissions?.active;
  if (commission?.deviceIds?.includes(deviceId)) jobs.push({
    id: commission.id, type: "commissionJob", deviceId, workerId: OWNER_OPERATOR_ID,
    startedAt: commission.startedAt, readyAt: commission.readyAt,
    item: { name: commission.name }, commission: true
  });
  return jobs;
}

function workshopProcessableItems(player, deviceId) {
  normalizePlayer(player);
  const device = workshopDeviceForPlayer(player, deviceId);
  if (!device) return [];
  const bucket = device.inputType === "rough" ? [...player.rough, ...player.materials, ...player.slices] : player.bracelets;
  return bucket.filter((item) => materialStageFor(item) === device.inputStage);
}

function playerOwnsWorkshop(player) {
  normalizePlayer(player);
  return Boolean(player.assets.workshopOwned);
}


function restoreWorkshopItem(player, item) {
  if (!item) return;
  if (item.type === "slice") { player.slices.push(item); return; }
  if (item.type === "rough" || item.type === "material") {
    restoreRoughToInventory(player, item);
    return;
  }
  player.bracelets.push(item);
}

function inheritEscrowMeta(source, ...targets) {
  if (!source?.escrowOrderId) return;
  for (const target of targets) {
    if (!target || typeof target !== "object") continue;
    target.escrowOrderId = source.escrowOrderId;
    target.escrowFromBuyerId = source.escrowFromBuyerId;
  }
}

function findWorkshopItem(player, device, itemId) {
  const bucket = device.inputType === "rough" ? [...player.rough, ...player.materials, ...player.slices] : player.bracelets;
  return bucket.find((item) => item.id === itemId) || null;
}

function startProductionJob(player, stage, item, options = {}) {
  if (enterEmployeePayrollDay(player, { spendCash, reason: "continued" }).changed) broadcast?.();
  if (!options.ownerOperated && employeeWorkBlock(player)) return null;
  const stageCost = money(options.publicStationFee || 0);
  if (stageCost && !spendCash(player, stageCost, `公共工位使用：${options.label || stage}`, { source: "workshop-station", itemId: item.id })) return null;
  const now = Date.now();
  addItemCost(item, stageCost);
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
    fee: stageCost,
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
    const stationFee = publicStationFee(device, previewItem, player.id);
    if (player.cash < stationFee) return { ok: false, code: "INSUFFICIENT_CASH", message: `本次公共工位费 ¥${stationFee}，可先接无需垫资的来料单。` };
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
      publicStationFee: stationFee,
      timeScale: wsSpeedTimeScale(worker) * devTimeScale * (device.timeMultiplier || 1) * (quote.timeMultiplier || 1),
      outputStage: device.outputStage,
      outputPreview: { materialStage: device.outputStage }
    });
    if (!job) {
      refundFinishMaterials(player, reserve.reservedMaterials, reserve.reservedMaterialCosts);
      restoreWorkshopItem(player, item);
      return { ok: false, code: "INSUFFICIENT_CASH", message: "工位费不足，翡翠与辅材已退回。" };
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
  const stationFee = publicStationFee(device, processingItem, player.id);
  if (player.cash < stationFee) return { ok: false, code: "INSUFFICIENT_CASH", message: `本次公共工位费 ¥${stationFee}，可先接无需垫资的来料单。` };
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
    if (processingItem.leftoverGeometryVersion === 2) {
      const stone = openingStoneForRough(processingItem);
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
    publicStationFee: stationFee,
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

function openingStoneForRough(rough) {
  return buildOpeningStone({
    seed: `${rough.id}:${rough.openingSeed || rough.visual?.openingSeed || rough.visual?.seed || rough.id}`,
    roughId: rough.id,
    qualityKey: rough.qualityKey,
    quality: rough.quality,
    color: rough.color
  });
}

function openingKitForPlacement(placement) {
  const tpl = placement.openingTpl || openingTplForKit(placement, placement.kitType);
  const sizeVal = tpl === "bangle"
    ? (Number(placement.ringSize) || 56)
    : (["S", "M", "L"].includes(placement.size) ? placement.size : "M");
  return {
    uid: placement.kitId || placement.id,
    tpl,
    x: clamp(Number(placement.x) || 50, 4, 96) * 6,
    y: clamp(Number(placement.y) || 50, 4, 96) * 6,
    rot: Number(placement.rot || 0),
    scale: Number(placement.scale || scaleForOpeningKit(tpl, sizeVal)),
    size: sizeVal
  };
}

function extractProductsFromJob(job) {
  const rough = job.item;
  const normalizedKits = normalizeExtractionKits(job.options?.kits || []);
  const placements = expandKitPlacements(normalizedKits);
  const openingStone = openingStoneForRough(rough);
  return placements.map((placement) => {
    const placementScore = scoreRoughPlacement(rough, placement);
    const productMeta = kitProductMeta(placement);
    const openingEval = evaluateOpeningKit(openingKitForPlacement(placement), openingStone);
    const openingGrade = computeOpeningGrade(openingEval, openingStone);
    const openingValue = Math.max(0, Number(openingEval.price) || 0);
    const product = {
      id: randomUUID(),
      type: "bracelet",
      kind: placement.layout,
      name: `${rough.quality}${rough.color}${productMeta.label}`,
      ...(rough.starterOriginId ? { starterOriginId: rough.starterOriginId,
        starterProtection: rough.starterProtection, starterOwnerId: rough.starterOwnerId } : {}),
      qualityKey: rough.qualityKey,
      quality: rough.quality,
      score: rough.score,
      color: rough.color,
      design: productMeta.label,
      ringSize: placement.ringSize,
      size: placement.size,
      value: money(openingValue),
      rep: Math.max(1, Math.round(((Number(rough.rep) || 0) * productMeta.rep * 0.35 + rough.score * 2 + openingGrade.score * 0.08) * clamp(placementScore, 0.72, 1.18))),
      count: productMeta.count,
      sourceRoughId: rough.id,
      plan: placement,
      openingGrade,
      openingEval: {
        price: openingEval.price,
        crackRatio: openingEval.crackRatio,
        wasteRatio: openingEval.wasteRatio,
        avgCv: openingEval.avgCv,
        avgRar: openingEval.avgRar
      },
      sourceMaterial: {
        roughId: rough.id,
        roughName: rough.name,
        visual: structuredClone(rough.visual || {}),
        openingSeed: rough.openingSeed || rough.visual?.openingSeed || rough.visual?.seed || rough.id,
        windows: structuredClone(rough.windows || []),
        placement: structuredClone(placement),
        openingTpl: placement.openingTpl,
        openingGrade,
        templateSize: { w: placement.templateSize?.w, h: placement.templateSize?.h },
        mass: rough.mass,
        qualityKey: rough.qualityKey,
        quality: rough.quality,
        color: rough.color
      },
      placementScore: Math.round(placementScore * 100),
      baseName: `${rough.quality}${rough.color}${productMeta.label}`,
      materialStage: "carved",
      stage: "carved"
    };
    product.jadePiece = captureExtractedJadePiece(product, openingStone, openingKitForPlacement(placement));
    return product;
  });
}

function productBaseName(product) {
  if (product.baseName) return product.baseName;
  return String(product.name || "翡翠成品").replace(/(?:精雕毛坯|抛光半成品|成品|镶嵌成品)$/u, "");
}

function stagedProduct(product, materialStage, suffix, valueMultiplier = 1, extra = {}) {
  const baseName = productBaseName(product);
  return {
    ...product,
    ...extra,
    baseName,
    name: suffix ? `${baseName}${suffix}` : baseName,
    materialStage,
    stage: materialStage,
    value: money(Number(product.value || product.price || 0) * valueMultiplier)
  };
}

function restoreRoughToInventory(player, rough) {
  // —materialStage 决定归属桶：已开窗的明料—materials，其余回 rough
  const stage = materialStageFor(rough);
  const bucket = stage === "opened" || rough.type === "material" ? player.materials : player.rough;
  const existingIndex = bucket.findIndex((item) => item.id === rough.id);
  if (existingIndex >= 0) {
    bucket[existingIndex] = { ...bucket[existingIndex], ...rough };
    return;
  }
  bucket.push(rough);
}

function applyJobDurability(player, job) {
  if (!job?.deviceId || job.durabilityApplied) return 0;
  job.durabilityApplied = true;
  const device = workshopDeviceForPlayer(player, job.deviceId);
  if (!device) return 0;
  if (device.publicStation) return 0;
  const loss = durabilityLoss(device);
  device.condition = clamp(Number(device.condition ?? 100) - loss, 0, 100);
  return loss;
}

function completeProductionJob(player, job) {
  applyJobDurability(player, job);
  const activity = workshopDeviceForPlayer(player, job.deviceId)?.stage
    || ({ rough: "opening", refine: "carving", inlay: "finishing" }[job.stage])
    || job.stage;
  const worker = job.workerId ? workshopWorkerForPlayer(player, job.workerId) : null;
  const deliver = (items, auxiliaryItems = []) => storeWorkshopDelivery(player, job, items, auxiliaryItems, {
    workerName: worker?.name || "工坊师傅",
    deviceName: workshopDeviceForPlayer(player, job.deviceId)?.name || "工坊设备"
  });
  const bangleFinishing = activity === "finishing" && isBangle(job.item);
  const bangleScore = bangleFinishing && job.finishPlan?.process === "bangle" ? bangleStepScore(worker, job.finishPlan.refinementId) : null;
  const xpResult = worker
    ? grantActivityExperience(worker, bangleFinishing ? "bangleFinishing" : activity)
    : { grants: {}, levelUps: [] };
  const step = wsStageToStep(job.stage);
  const applyWorker = Boolean(worker && step);
  const stepScore = applyWorker ? (bangleFinishing && job.finishPlan?.process === "bangle"
    ? bangleScore : wsStepScore(worker, step)) : 0;

  // 设备属性（固定阶数道具，加工时生效）：品质加成%（抬高价格）+ 完美保底%（抬高工分下限，即「完美度保底」）；风险仅影响碎裂（见下方
  const devAttrs = job.deviceAttrs || (job.deviceId ? (workshopDeviceForPlayer(player, job.deviceId)?.attrs) : null);

  // 碎裂率由工序底险、设备风险和员工技能共同决定，并按工序封顶。
  const shatterProb = workshopShatterChance(devAttrs, worker, job.stage);
  const shattered = Math.random() < shatterProb;
  if (shattered) {
    if (job.item?.starterProtection === true && job.item.starterOwnerId === player.id && activity !== "finishing") {
      if (activity === "carving") {
        job.item.extractionKits = structuredClone(job.previousExtractionKits || []);
        job.item.braceletPlacements = job.item.extractionKits;
      }
      restoreWorkshopItem(player, job.item);
      return { text: `${job.item.name} 加工失败，新手保护已退回原料`, item: null,
        shattered: true, refunded: true, xpResult };
    }
    if (job.stage === "rough" || job.stage === "opening") {
      player.stats.cutCount = (player.stats.cutCount || 0) + 1;
      player.stats.badCutCount = (player.stats.badCutCount || 0) + 1;
      settlePlayerAchievements(player);
    }
    if (activity === "finishing") {
      restoreWorkshopItem(player, job.item);
      refundFinishMaterials(player, job.reservedMaterials, job.reservedMaterialCosts);
      job.reservedMaterials = {};
      return {
        text: bangleFinishing ? `${job.item.name} 精修失败，原坯已退回` : `${job.item.name} 精加工失败，翡翠与镶嵌材料已退回`,
        item: null,
        shattered: true,
        refunded: true,
        xpResult
      };
    }
    return { text: `碎裂${job.item?.name || "物料"} 材料全损`, item: null, shattered: true, xpResult };
  }

  // Each successful step adds only its own workmanship. A weaker later worker
  // cannot reprice away the value created by an earlier step.
  function priceByCraft(item) {
    return applyCraftStepValue(item, { step, score: stepScore, worker, deviceAttrs: devAttrs || {}, previousValue: item.value, roundMoney: money });
  }

  if (job.stage === "rough" || job.stage === "opening") {
    const polished = revealPolishedRough(job.item);
    inheritEscrowMeta(job.item, polished);
    polished.baseValue = Number(polished.value || polished.price || 0); // 开料首步：料值即纯料值
    polished.materialValuePoolVersion = 2;
    priceByCraft(polished);
    polished.stage = "material";
    polished.materialStage = "opened";
    deliver([polished]);
    applyRepDelta(
      player,
      Math.max(1, Math.round(polished.rep * 0.45)),
      `开石完成：${polished.name || "成品"}`,
      { source: "opening", itemId: polished.id }
    );
    player.stats.craftDone = (player.stats.craftDone || 0) + 1;
    player.stats.cutCount = (player.stats.cutCount || 0) + 1;
    if (String(polished.color || "").includes("帝王")) {
      player.stats.everImperial = true;
    }
    grantPlayerExp(player, "opening_done");
    settlePlayerAchievements(player);
    return { text: `${polished.name} 开料完成`, item: polished, xpResult };
  }
  if (job.stage === "refine" || job.stage === "carving") {
    const prevScores = job.item.craftScores || {};
    const prevWorkers = job.item.craftWorkers || {};
    // 余料回库时必须剥离托管标记，否则 findEscrow 会先命中余料而非成品。
    // leftover 标记供规划选料 UI 过滤；保留 extractionKits 以便库存/黑市渲染已扣件黑洞。
    // 工坊规划预览会主动忽略历史 extractionKits（见 carvingPreviewKits）。
    const allKits = normalizeExtractionKits(job.item.extractionKits || job.item.braceletPlacements || [], { maxScale: job.item.leftoverGeometryVersion === 2 ? 5 : 1.45 });
    const allOpeningKits = expandKitPlacements(allKits).map(openingKitForPlacement);
    const submittedKitIds = new Set((job.options?.kits || []).map((kit) => String(kit.id)));
    const priorKits = normalizeExtractionKits(job.previousExtractionKits
      || allKits.filter((kit) => !submittedKitIds.has(String(kit.id))), { maxScale: job.item.leftoverGeometryVersion === 2 ? 5 : 1.45 });
    const priorOpeningKits = expandKitPlacements(priorKits).map(openingKitForPlacement);
    const stone = openingStoneForRough(job.item);
    const geometryOptions = { withinStone: job.item.leftoverGeometryVersion === 2 };
    const beforeEval = evaluateLeftoverMaterial(priorOpeningKits, stone, geometryOptions);
    const leftoverEval = evaluateLeftoverMaterial(allOpeningKits, stone, geometryOptions);
    const extracted = extractProductsFromJob(job);
    const previousMaterialWeight = materialEvaluationWeight(beforeEval, stone);
    const pool = partitionMaterialValue(job.item, leftoverEval.remainRatio, extracted.map((product) => product.value), {
      valueRetainedRatio: previousMaterialWeight > 0 ? materialEvaluationWeight(leftoverEval, stone) / previousMaterialWeight : undefined
    });
    const { remainingRatio, retainedRatio } = pool;
    const leftoverValue = pool.leftover.value;
    const leftoverBaseValue = pool.leftover.baseValue;
    const products = extracted.map((product, index) => {
      const p = stagedProduct(product, "carved", "精雕毛坯");
      Object.assign(p, pool.pieces[index]);
      p.craftScores = { ...prevScores };
      p.craftWorkers = { ...prevWorkers };
      p.deviceQualityBonuses = { ...(job.item.deviceQualityBonuses || {}) };
      p.materialValuePoolVersion = 2;
      p.extractedByPlayerId = player.id;
      return priceByCraft(p);
    });
    inheritEscrowMeta(job.item, ...products);
    const leftover = {
      ...job.item,
      type: "material",
      materialStage: "opened",
      stage: "material",
      leftover: true,
      remainingRatio,
      value: leftoverValue,
      ...(job.item.leftoverGeometryVersion === 2 ? { mass: Number(((job.item.mass || 0) * retainedRatio).toFixed(2)) } : {}),
      price: leftoverValue,
      baseValue: leftoverBaseValue,
      craftValueContributions: pool.leftover.craftValueContributions,
      materialValuePoolVersion: 2,
      openingEval: {
        ...(job.item.openingEval || {}),
        price: leftoverValue,
        crackRatio: leftoverEval.crackRatio,
        wasteRatio: leftoverEval.wasteRatio,
        remainRatio: remainingRatio,
        avgCv: leftoverEval.avgCv,
        avgRar: leftoverEval.avgRar
      }
    };
    delete leftover.escrowOrderId;
    delete leftover.escrowFromBuyerId;
    distributeItemCost(job.item, [...products, leftover]);
    deliver(products, [leftover]);
    player.stats.craftCount += products.length;
    player.stats.craftDone = (player.stats.craftDone || 0) + 1;
    grantPlayerExp(player, "carving_done");
    settlePlayerAchievements(player);
    return { text: `${job.item.name} 精雕完成`, item: job.item, xpResult };
  }
  // 精加工 = 员工工分结算 + 玩家镶嵌方案，材料与工艺倍率由权威报价统一应用。
  const hasFinishPlan = Boolean(job.finishPlan && job.inlayQuote);
  const finished = stagedProduct(
    job.item,
    "finished",
    "",
    hasFinishPlan ? 1 : 1.2096,
    { inlaid: hasFinishPlan, polished: true }
  );
  inheritEscrowMeta(job.item, finished);
  const finInBase = Number(job.item.baseValue ?? job.item.value ?? job.item.price ?? 0);
  const finInVal = Number(job.item.value ?? job.item.price ?? 0);
  const finTf = finInVal > 0 ? (Number(finished.value || 0) / finInVal) : 1;
  finished.baseValue = finInBase * finTf; // 纯料值（剥离上一步工分加成）
  priceByCraft(finished);
  if (hasFinishPlan) {
    applyInlay(finished, job.finishPlan, job.inlayQuote);
    for (const [key] of Object.entries(job.reservedMaterials || {})) {
      const materialCost = job.reservedMaterialCosts?.[key];
      addItemCost(finished, materialCost?.amount || 0, materialCost?.complete === true);
    }
    job.reservedMaterials = {};
  }
  finished.craftedByPlayerId = player.id;
  deliver([finished]);
  player.stats.craftDone = (player.stats.craftDone || 0) + 1;
  player.stats.finishedMade = (player.stats.finishedMade || 0) + 1;
  if (String(finished.color || "").includes("帝王")) {
    player.stats.everImperial = true;
  }
  grantPlayerExp(player, "finishing_done");
  settlePlayerAchievements(player);
  return { text: `${finished.name} 精加工完成`, item: finished, xpResult };
}


function normalizeProductionJob(job) {
  if (job?.stage && job.item) return job;
  if (job?.rough) {
    return {
      ...job,
      type: "productionJob",
      stage: "rough",
      item: job.rough,
      options: { label: "粗加工", ...(job.options || {}) }
    };
  }
  return job;
}

function settleProductionJobsForPlayer(player, now = Date.now()) {
  normalizePlayer(player);
  const events = [];
  const readyJobs = player.jobs.filter((job) => job.readyAt <= now);
  const readyLegacyJobs = player.polishingJobs.filter((job) => job.readyAt <= now);
  if (!readyJobs.length && !readyLegacyJobs.length) return events;

  player.jobs = player.jobs.filter((job) => job.readyAt > now);
  player.polishingJobs = player.polishingJobs.filter((job) => job.readyAt > now);

  for (const rawJob of [...readyJobs, ...readyLegacyJobs]) {
    const job = normalizeProductionJob(rawJob);
    if (!job?.item) continue;
    const result = completeProductionJob(player, job);
    if (!result.shattered) advanceTask(player, "workshop_craft");
    events.push({
      type: "production",
      text: result.text,
      income: 0,
      expense: 0,
      readyAt: job.readyAt,
      levelUps: result.xpResult?.levelUps || []
    });
    if (result.xpResult?.levelUps?.length) {
      const worker = workshopWorkerForPlayer(player, job.workerId);
      emitUiEventToPlayer(player, {
        type: "float",
        tone: "craft",
        text: `${worker?.name || "员工"} 技能升级`,
        x: 58,
        y: 56
      });
    }
    addNews(`${player.name} ${result.text}。`, job.stage === "rough" && result.item?.score >= 5 ? "great" : "craft");
  }

  refreshPlayerReport(player, now);
  return events;
}

function processProductionJobs(now = Date.now(), options = {}) {
  const onlineOnly = options.onlineOnly !== false;
  let changed = false;
  for (const player of playersMatching(state.players, (entry) => (!onlineOnly || isPlayerOnline(entry)) && Boolean(entry.jobs?.length || entry.polishingJobs?.length || entry.cuttingJobs?.length))) {
    normalizePlayer(player);
    if (onlineOnly && !isPlayerOnline(player)) continue;
    const events = settleProductionJobsForPlayer(player, now);
    if (events.length) changed = true;
  }
  if (changed && options.broadcast !== false) broadcast();
  return changed;
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
    if (device.publicStation) return { ok: false, message: "公共工位不保存长期员工安排，请在开工时选择操作人。" };
    if (device.workerId === worker.id) return { ok: false, message: `${worker.name} 已在本台。` };
    // Looking up a worker normalizes saved devices, so mutate the current
    // owned instance rather than a reference from the previous normalization.
    const currentDevice = player.workshop.devices.find((entry) => entry.id === device.id);
    currentDevice.workerId = worker.id;
    return { ok: true, message: `${worker.name} 已安排到 ${currentDevice.name}。`, device: currentDevice, worker };
  }

  return {
    workshopDevicesForPlayer,
    workshopDeviceForPlayer,
    workshopWorkerForPlayer,
    workshopJobsForDevice,
    workshopProcessableItems,
    playerOwnsWorkshop,
    legacyDeviceIdForStage,
    wsApplyWorker,
    restoreWorkshopItem,
    findWorkshopItem,
    restoreRoughToInventory,
    startProductionJob,
    startRoughOpeningForPlayer,
    startWorkshopJobForPlayer,
    extractProductsFromJob,
    productBaseName,
    stagedProduct,
    applyJobDurability,
    completeProductionJob,
    revealWorkshopDeliveryForPlayer,
    claimWorkshopDeliveryForPlayer,
    normalizeProductionJob,
    settleProductionJobsForPlayer,
    processProductionJobs,
    assignWorkshopWorkerForPlayer,
    normalizeAngle,
    angleDistance,
    cutAngleName,
    makeSliceBoard,
    normalizePlan,
    normalizePlacement,
    normalizePlacements,
    openingTplForKit,
    openingKitFromExtractionKit,
    extractionKitsOverlap,
    normalizeExtractionKits,
    expandKitPlacements,
    kitProductMeta,
    placementFootprint,
    templateWidthOnBoard,
    placementsOverlap,
    scoreSlicePlacement,
    scoreSlicePlan,
    scoreRoughPlacement,
    revealPolishedRough,
    normalizeWorkshop,
    starterDevices,
    mergeWorkerSkills,
    WORKSHOP_WORKER_DEFS
  };
}
