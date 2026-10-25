// Durability and authoritative production outcomes; preserve effect order.
import { applyCraftStepValue, stageToStep as wsStageToStep, stepScore as wsStepScore, workshopShatterChance } from "../../../shared/domain/workshop/workshop-craft-scoring.js";
import { evaluateLeftoverMaterial, evaluateOpeningKit } from "../../../shared/domain/jade/jade-opening-engine.js";
import { isBangle, bangleStepScore } from "../../../shared/domain/workshop/bangle-finish.js";
import { durabilityLoss } from "../../systems/equipment-system.js";
import { grantActivityExperience } from "../../systems/employee-system.js";
import { refundFinishMaterials, applyInlay } from "../../systems/inlay-system.js";
import { grantPlayerExp } from "../../../shared/domain/progression/player-progression.js";
import { settlePlayerAchievements as legacySettlePlayerAchievements } from "../achievement-rewards.js";
import { applyRepDelta } from "../../../shared/domain/economy/metric-history.js";
import { distributeItemCost, setAcquisitionCost } from "../../../shared/domain/economy/item-cost.js";
import { addFinanceItemCost, registerFinanceItem, recordFinanceLoss } from "../../../shared/domain/economy/finance-book.js";
import { materialEvaluationWeight, partitionMaterialValue } from "../../../shared/domain/workshop/material-value-pool.js";

export function createWorkshopCompletion({
  settlePlayerAchievements = legacySettlePlayerAchievements,
  money,
  clamp,
  getState,
  normalizeExtractionKits,
  expandKitPlacements,
  revealPolishedRough,
  storeWorkshopDelivery,
  workshopDeviceForPlayer,
  workshopWorkerForPlayer,
  restoreWorkshopItem,
  inheritEscrowMeta,
  openingStoneForRough,
  openingKitForPlacement,
  extractProductsFromJob,
  stagedProduct
}) {
function applyJobDurability(player, job) {
  if (!job?.deviceId || job.durabilityApplied) return 0;
  job.durabilityApplied = true;
  const device = workshopDeviceForPlayer(player, job.deviceId);
  if (!device) return 0;
  const loss = durabilityLoss(device);
  device.condition = clamp(Number(device.condition ?? 100) - loss, 0, 100);
  return loss;
}

function completeProductionJob(player, job) {
  registerFinanceItem(player, job.item);
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
    const lossOwner = job.item?.escrowOrderId ? getState?.()?.players?.get(job.item.escrowFromBuyerId) : player;
    if (lossOwner) recordFinanceLoss(lossOwner, job.item, { id: job.id });
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
    const pieceWeights = expandKitPlacements(job.options?.kits || []).map(openingKitForPlacement)
      .map((kit) => materialEvaluationWeight(evaluateOpeningKit(kit, stone, geometryOptions), stone));
    const pool = partitionMaterialValue(job.item, leftoverEval.remainRatio, pieceWeights, {
      sourceWeight: previousMaterialWeight,
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
    if (job.item.escrowOrderId) {
      const buyer = getState?.()?.players?.get(job.item.escrowFromBuyerId);
      if (buyer) recordFinanceLoss(buyer, leftover, { id: `${job.id}:service-leftover` });
      setAcquisitionCost(leftover, 0);
      registerFinanceItem(player, leftover, { acquisition: true });
    }
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
      addFinanceItemCost(player, finished, materialCost?.amount || 0, materialCost?.complete === true, "materials");
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

  return { applyJobDurability, completeProductionJob };
}
