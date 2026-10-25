// Instance-owned implementation; legacy entry points remain one directory above.
import { isWorkerBusy } from "../../../systems/employee-system.js";
import { PROCESS_SKILLS, WORKER_SKILL_DEFS } from "../../../../shared/domain/workshop/workshop-craft-scoring.js";
import {
  BM_SERVICE_TEMPLATES,
  BM_SERVICE_HEADLINE_TAGS,
  BM_SERVICE_ACCEPT_SCOPES,
  bmServiceTemplateById,
  bmServiceTemplateSortOrder,
  bmServiceHeadlineTagById,
  bmServiceAcceptScopeById
} from "../../../../shared/domain/blackmarket/bm-service-templates.js";
import {
  BLACKMARKET_MIN_PRICE,
  BM_EARLY_SUBMIT_REP_PENALTY,
  BM_TIMEOUT_REP_PENALTY,
  BM_SELLER_CANCEL_REP_PENALTY,
  BM_ACCEPT_TIMEOUT_MS,
  BM_SERVICE_PROFILE_CAPS
} from "../../../../shared/domain/blackmarket/bm-constants.js";
import {
  applyRepDelta,
  customerRatingTierInfo,
  isCustomerRatingPublic
} from "../../../../shared/domain/economy/metric-history.js";
import { findInventoryItem, inventoryEntries } from "../../inventory-items.js";
import { attemptAtomicMutation } from "../../atomic-mutation.js";
import { addFinanceItemCost, registerFinanceItem } from "../../../../shared/domain/economy/finance-book.js";

export function createService({
  requireApi,
  denyUnlessBmBuy,
  denyUnlessBmStall,
  bumpBmDeal,
  clamp,
  ITEM_TYPES,
  blackMaskForPlayerId,
  findStallByOwner,
  findStallById,
  tryActivateStall,
  paySellerNow,
  pushPendingRatings,
  attachEscrowItemToSeller,
  removeEscrowItemFromSeller,
  removeStallFromState,
  findEscrowItemForOrder,
  returnHeldItemToBuyer,
  returnEscrowItemToBuyer,
  itemMatchesAcceptScopes,
  releaseDepositSafe,
  desensitizePlayerName,
  publicInputItemRef,
  publicCapabilitySnapshot,
  bmRatingSampleCountForPlayer,
  SATISFACTION_BASELINE
}) {
const SERVICE_STAGE_LABELS = { opening: "开料", carving: "取镯", finishing: "精加工" };

const SERVICE_CRAFT_JOBS = new Set(["cutter", "planner", "finisher"]);

const SERVICE_DEVICE_STAGES = ["opening", "carving", "finishing"];

const SERVICE_PROFILE_TAG_CAP = BM_SERVICE_PROFILE_CAPS.tags;

const SERVICE_PROFILE_WORKER_CAP = BM_SERVICE_PROFILE_CAPS.workers;

const SERVICE_PROFILE_DEVICE_CAP = BM_SERVICE_PROFILE_CAPS.devices;

const SERVICE_PROFILE_SHOWCASE_CAP = BM_SERVICE_PROFILE_CAPS.showcase;

const SERVICE_PROOF_RECENT_CAP = 3;

function workerSkillLevel(worker, key) {
  const dir = WORKER_SKILL_DEFS[key]?.dir;
  if (!dir) return 1;
  return Math.max(1, Math.min(10, Math.round(Number(worker?.skills?.[dir]?.[key]?.level) || 1)));
}

function skillPeaksFromWorkers(workers = []) {
  const peaks = {};
  for (const key of PROCESS_SKILLS) {
    peaks[key] = 1;
    for (const worker of workers) {
      peaks[key] = Math.max(peaks[key], workerSkillLevel(worker, key));
    }
  }
  return peaks;
}

function topSkillsFromPeaks(peaks) {
  return PROCESS_SKILLS
    .map((key) => ({
      key,
      name: WORKER_SKILL_DEFS[key]?.name || key,
      level: peaks[key] || 1
    }))
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
    .slice(0, 3);
}

function deviceQuality(device) {
  return Number(device?.attrs?.quality ?? device?.baseAttrs?.quality ?? device?.quality ?? 0);
}

function topDevicesFromList(devices = []) {
  const byStage = {};
  for (const device of devices) {
    const stage = device?.stage;
    if (!stage || !SERVICE_STAGE_LABELS[stage]) continue;
    const quality = deviceQuality(device);
    const prev = byStage[stage];
    if (!prev || quality > prev.quality) {
      byStage[stage] = {
        stage,
        stageLabel: SERVICE_STAGE_LABELS[stage],
        brand: String(device.brand || ""),
        modelName: String(device.modelName || device.name || ""),
        quality: Math.round(quality),
        focus: String(device.focus || "")
      };
    }
  }
  return SERVICE_DEVICE_STAGES.map((stage) => byStage[stage]).filter(Boolean);
}

function headlineTagsFromPeaks(peaks) {
  const tags = [];
  const openPeak = Math.max(peaks.jieliao || 1, peaks.damo || 1);
  const planPeak = Math.max(peaks.qieliao || 1, peaks.xiuxing || 1);
  const finishPeak = Math.max(peaks.diaozhuo || 1, peaks.xiangqian || 1);
  if (openPeak >= 4) tags.push({ id: "open-window", label: "代开。" });
  if (planPeak >= 4) tags.push({ id: "carve-plan", label: "代规。" });
  if (finishPeak >= 4) tags.push({ id: "inlay-finish", label: "代镶。" });
  return tags;
}

function defaultServiceProfile() {
  return {
    headlineTagIds: [],
    acceptScopes: [],
    featuredWorkerIds: [],
    featuredEquipmentIds: [],
    showcaseItems: [],
    visibility: {
      showWorkers: true,
      showEquipment: true,
      showShowcase: true
    }
  };
}

function eligibleHeadlineTagIds(autoSnap) {
  const autoIds = new Set((autoSnap?.headlineTags || []).map((tag) => tag.id));
  return BM_SERVICE_HEADLINE_TAGS.map((tag) => tag.id).filter((id) => autoIds.has(id));
}

function findOwnerInventoryItem(owner, type, itemId) {
  return findInventoryItem(owner, type, itemId);
}

function isShowcaseableItem(item, type) {
  if (!item) return false;
  if (type === "bracelet") return true;
  if (item.materialStage === "finished") return true;
  return false;
}

function showcaseCandidatesForOwner(owner) {
  const rows = [];
  for (const type of ["bracelet", "slice", "material"]) {
    for (const { item } of inventoryEntries(owner, [type])) {
      if (!isShowcaseableItem(item, type)) continue;
      rows.push({
        type,
        itemId: item.id,
        name: String(item.name || item.id)
      });
    }
  }
  return rows.slice(0, 40);
}

function normalizeServiceProfile(raw = {}, owner, autoSnap) {
  const base = defaultServiceProfile();
  const eligibleTags = new Set(eligibleHeadlineTagIds(autoSnap));
  const workers = owner?.workshop?.workers || [];
  const devices = owner?.workshop?.devices || [];
  const workerIds = new Set(workers.map((worker) => worker.id));
  const deviceIds = new Set(devices.map((device) => device.id));
  const showcaseKeys = new Set(
    showcaseCandidatesForOwner(owner).map((row) => `${row.type}:${row.itemId}`)
  );

  base.headlineTagIds = [...new Set((raw.headlineTagIds || []).map(String))]
    .filter((id) => eligibleTags.has(id))
    .slice(0, SERVICE_PROFILE_TAG_CAP);

  base.acceptScopes = [...new Set((raw.acceptScopes || []).map(String))]
    .filter((id) => BM_SERVICE_ACCEPT_SCOPES.some((scope) => scope.id === id))
    .slice(0, BM_SERVICE_ACCEPT_SCOPES.length);

  base.featuredWorkerIds = [...new Set((raw.featuredWorkerIds || []).map(String))]
    .filter((id) => workerIds.has(id))
    .slice(0, SERVICE_PROFILE_WORKER_CAP);

  base.featuredEquipmentIds = [...new Set((raw.featuredEquipmentIds || []).map(String))]
    .filter((id) => deviceIds.has(id))
    .slice(0, SERVICE_PROFILE_DEVICE_CAP);

  base.showcaseItems = (raw.showcaseItems || [])
    .map((row) => ({ type: String(row?.type || ""), itemId: String(row?.itemId || "") }))
    .filter((row) => showcaseKeys.has(`${row.type}:${row.itemId}`))
    .slice(0, SERVICE_PROFILE_SHOWCASE_CAP);

  const visibility = raw.visibility && typeof raw.visibility === "object" ? raw.visibility : {};
  base.visibility = {
    showWorkers: visibility.showWorkers !== false,
    showEquipment: visibility.showEquipment !== false,
    showShowcase: visibility.showShowcase !== false
  };

  return base;
}

function buildFeaturedWorkers(owner, workerIds, anonymous) {
  const workers = owner?.workshop?.workers || [];
  return workerIds.map((id, idx) => {
    const worker = workers.find((row) => row.id === id);
    if (!worker) return null;
    const topSkills = PROCESS_SKILLS
      .map((key) => ({
        key,
        name: WORKER_SKILL_DEFS[key]?.name || key,
        level: workerSkillLevel(worker, key)
      }))
      .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
      .slice(0, 2);
    return {
      label: anonymous ? `师傅 ${String.fromCharCode(65 + idx)}` : String(worker.name || `员工${idx + 1}`),
      job: worker.job,
      topSkills
    };
  }).filter(Boolean);
}

function buildFeaturedDevices(owner, deviceIds) {
  const devices = owner?.workshop?.devices || [];
  return deviceIds.map((id) => {
    const device = devices.find((row) => row.id === id);
    if (!device) return null;
    return {
      stage: device.stage,
      stageLabel: SERVICE_STAGE_LABELS[device.stage] || device.stage,
      brand: String(device.brand || ""),
      modelName: String(device.modelName || device.name || ""),
      focus: String(device.focus || "")
    };
  }).filter(Boolean);
}

function buildShowcaseItems(owner, showcaseItems, publicStone) {
  return showcaseItems.map((row) => {
    const item = findOwnerInventoryItem(owner, row.type, row.itemId);
    if (!item) return null;
    const pub = typeof publicStone === "function" ? publicStone(item) : item;
    return {
      type: row.type,
      itemId: row.itemId,
      name: String(pub?.name || item.name || row.itemId),
      item: pub
    };
  }).filter(Boolean);
}

function buildServiceProfileOptions(owner, autoSnap) {
  const eligible = eligibleHeadlineTagIds(autoSnap)
    .map((id) => bmServiceHeadlineTagById(id))
    .filter(Boolean);
  const workers = (owner?.workshop?.workers || [])
    .filter((worker) => SERVICE_CRAFT_JOBS.has(worker.job))
    .map((worker) => {
      const top = PROCESS_SKILLS
        .map((key) => ({
          name: WORKER_SKILL_DEFS[key]?.name || key,
          level: workerSkillLevel(worker, key)
        }))
        .sort((a, b) => b.level - a.level)[0];
      return {
        id: worker.id,
        name: String(worker.name || worker.id),
        job: worker.job,
        topSkill: top ? `${top.name} L${top.level}` : ""
      };
    });
  const devices = (owner?.workshop?.devices || []).map((device) => ({
    id: device.id,
    label: `${SERVICE_STAGE_LABELS[device.stage] || device.stage} · ${device.brand || ""} ${device.modelName || device.name || ""}`.trim()
  }));
  return {
    eligibleHeadlineTags: eligible,
    acceptScopes: BM_SERVICE_ACCEPT_SCOPES,
    workers,
    devices,
    showcaseCandidates: showcaseCandidatesForOwner(owner)
  };
}

function applyServiceCuration(autoSnap, stall, owner, anonymous, publicStone) {
  if (!autoSnap) return null;
  const profile = stall?.serviceProfile || defaultServiceProfile();
  const snap = { ...autoSnap };
  const pickedTags = (profile.headlineTagIds || [])
    .map((id) => bmServiceHeadlineTagById(id))
    .filter(Boolean);
  if (pickedTags.length) snap.headlineTags = pickedTags;

  snap.acceptScopes = (profile.acceptScopes || [])
    .map((id) => bmServiceAcceptScopeById(id))
    .filter(Boolean);

  if (profile.visibility?.showWorkers !== false && profile.featuredWorkerIds?.length) {
    snap.featuredWorkers = buildFeaturedWorkers(owner, profile.featuredWorkerIds, anonymous);
  }
  if (profile.visibility?.showEquipment !== false && profile.featuredEquipmentIds?.length) {
    const featured = buildFeaturedDevices(owner, profile.featuredEquipmentIds);
    if (featured.length) snap.topDevices = featured;
  }
  if (profile.visibility?.showShowcase !== false && profile.showcaseItems?.length) {
    snap.showcaseItems = buildShowcaseItems(owner, profile.showcaseItems, publicStone);
  }

  snap.curated = Boolean(
    pickedTags.length
    || snap.acceptScopes.length
    || snap.featuredWorkers?.length
    || (profile.featuredEquipmentIds?.length && snap.topDevices?.length)
    || snap.showcaseItems?.length
  );
  return snap;
}

function bestDeviceForStage(devices = [], stage) {
  if (!stage) return null;
  let best = null;
  let bestQ = -1;
  for (const device of devices) {
    if (device?.stage !== stage) continue;
    const quality = deviceQuality(device);
    if (quality > bestQ) {
      bestQ = quality;
      best = device;
    }
  }
  return best;
}

function bestWorkerForSkill(workers = [], skillKey) {
  let best = null;
  let bestLv = 0;
  for (const worker of workers) {
    const lv = workerSkillLevel(worker, skillKey);
    if (lv > bestLv) {
      bestLv = lv;
      best = worker;
    }
  }
  return { worker: best, level: bestLv || 1 };
}

function buildOfferCapabilityRefs(owner, templateId) {
  const template = bmServiceTemplateById(templateId);
  if (!template || template.id === "custom") {
    return { skillKeys: [], workerIds: [], equipmentIds: [], bindLabels: [] };
  }
  const workers = owner?.workshop?.workers || [];
  const devices = owner?.workshop?.devices || [];
  const workerIds = [];
  const equipmentIds = [];
  const bindLabels = [];
  const usedWorkers = new Set();

  for (const key of template.skillKeys || []) {
    const { worker, level } = bestWorkerForSkill(workers, key);
    if (worker?.id && !usedWorkers.has(worker.id)) {
      workerIds.push(worker.id);
      usedWorkers.add(worker.id);
    }
    const name = WORKER_SKILL_DEFS[key]?.name || key;
    bindLabels.push(`${name} L${level}`);
  }

  const device = bestDeviceForStage(devices, template.deviceStage);
  if (device?.id) {
    equipmentIds.push(device.id);
    const brand = String(device.brand || "");
    const modelName = String(device.modelName || device.name || "");
    bindLabels.push(`${brand} ${modelName}`.trim());
  }

  return {
    skillKeys: [...(template.skillKeys || [])],
    workerIds,
    equipmentIds,
    bindLabels: bindLabels.filter(Boolean)
  };
}

function buildOfferCapabilityBasis(owner, offer, anonymous) {
  const refs = offer?.capabilityRefs || {};
  const workers = owner?.workshop?.workers || [];
  const devices = owner?.workshop?.devices || [];
  const skills = (refs.skillKeys || []).map((key) => ({
    key,
    name: WORKER_SKILL_DEFS[key]?.name || key,
    level: bestWorkerForSkill(workers, key).level
  }));
  const deviceRows = (refs.equipmentIds || [])
    .map((id) => devices.find((d) => d.id === id))
    .filter(Boolean)
    .map((device) => ({
      stageLabel: SERVICE_STAGE_LABELS[device.stage] || device.stage,
      brand: String(device.brand || ""),
      modelName: String(device.modelName || device.name || "")
    }));
  const workerRows = (refs.workerIds || [])
    .map((id) => workers.find((w) => w.id === id))
    .filter(Boolean)
    .map((worker, idx) => {
      const top = PROCESS_SKILLS
        .map((key) => ({ key, level: workerSkillLevel(worker, key), name: WORKER_SKILL_DEFS[key]?.name || key }))
        .sort((a, b) => b.level - a.level)[0];
      return {
        label: anonymous ? `师傅 ${String.fromCharCode(65 + idx)}` : String(worker.name || `员工${idx + 1}`),
        topSkill: top ? `${top.name} L${top.level}` : ""
      };
    });
  return { skills, devices: deviceRows, workers: workerRows };
}

function sortServiceOffers(offers = []) {
  return [...offers].sort((a, b) => {
    const aCustom = (a.templateId || "custom") === "custom";
    const bCustom = (b.templateId || "custom") === "custom";
    if (aCustom !== bCustom) return aCustom ? 1 : -1;
    const orderDiff = bmServiceTemplateSortOrder(a.templateId) - bmServiceTemplateSortOrder(b.templateId);
    if (orderDiff) return orderDiff;
    return Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });
}

function publicServiceOffer(offer, owner, anonymous) {
  const template = bmServiceTemplateById(offer.templateId);
  const refs = offer.capabilityRefs || {};
  return {
    id: offer.id,
    title: offer.title,
    desc: offer.desc || "",
    price: offer.price,
    etaMinutes: offer.etaMinutes || 0,
    templateId: offer.templateId || "",
    templateLabel: template?.title || offer.templateLabel || "",
    capabilityLabels: refs.bindLabels || [],
    capabilityBasis: buildOfferCapabilityBasis(owner, offer, anonymous)
  };
}

function freezeOrderCapabilitySnapshot(owner, offer, state, stall = null) {
  const autoSnap = buildServiceSnapshot(owner, state);
  const serviceSnapshot = stall
    ? applyServiceCuration(autoSnap, stall, owner, stall.anonymous === true, null)
    : autoSnap;
  const refs = offer?.capabilityRefs || {};
  return {
    capturedAt: Date.now(),
    templateId: offer?.templateId || "custom",
    bindLabels: [...(refs.bindLabels || [])],
    serviceSnapshot
  };
}

function publicProofBuyerLabel(buyerId) {
  const mask = blackMaskForPlayerId(buyerId);
  const tag = String(mask.maskName || "").split("·").pop() || "****";
  return `买家·${tag}`;
}

function publicProofEntry(order) {
  return {
    title: order.title,
    templateId: order.templateId || "custom",
    price: order.price,
    completedAt: order.completedAt,
    buyerLabel: publicProofBuyerLabel(order.buyerId),
    stars: order.buyerRating?.stars ?? null,
    bindLabels: order.capabilitySnapshot?.bindLabels || []
  };
}

function buildServiceProof(state, stall) {
  const stallId = stall?.id;
  if (!stallId) {
    return { completedCount: 0, ratedCount: 0, avgStars: null, recent: [] };
  }
  const completed = (state.blackServiceOrders || [])
    .filter((order) => order.stallId === stallId && order.status === "completed")
    .sort((a, b) => Number(b.completedAt || 0) - Number(a.completedAt || 0));
  const rated = completed.filter((order) => order.buyerRating?.stars);
  const avgStars = rated.length
    ? Math.round((rated.reduce((sum, order) => sum + Number(order.buyerRating.stars), 0) / rated.length) * 10) / 10
    : null;
  return {
    completedCount: completed.length,
    ratedCount: rated.length,
    avgStars,
    recent: completed.slice(0, SERVICE_PROOF_RECENT_CAP).map((order) => publicProofEntry(order))
  };
}

function buildServiceSnapshot(owner, state) {
  if (!owner) return null;
  const orders = (state?.blackServiceOrders || []).filter((o) => o.sellerId === owner.id);
  const completed = orders.filter((o) => o.status === "completed");
  const cancelled = orders.filter((o) => o.status === "cancelled");
  const settled = completed.length + cancelled.length;
  const workers = owner.workshop?.workers || [];
  const craftWorkers = workers.filter((worker) => SERVICE_CRAFT_JOBS.has(worker.job));
  const busyWorkers = craftWorkers.filter((worker) => isWorkerBusy(owner, worker.id)).length;
  const freeWorkers = Math.max(0, craftWorkers.length - busyWorkers);
  const activeJobs = (owner.jobs || []).length + (owner.polishingJobs || []).length;
  const skillPeaks = skillPeaksFromWorkers(workers);
  let acceptHint = "暂无可接产能";
  if (freeWorkers >= 2) acceptHint = `可接 ${freeWorkers} 单`;
  else if (freeWorkers === 1) acceptHint = "可接 1 单";
  else if (activeJobs > 0) acceptHint = `排队中 · ${activeJobs} 项进行中`;

  const bmSamples = bmRatingSampleCountForPlayer(state, owner.id);
  const rated = isCustomerRatingPublic(owner, bmSamples);
  const satisfactionValue = rated
    ? clamp(Math.round(Number(owner.satisfaction ?? SATISFACTION_BASELINE)), 0, 100)
    : null;
  const tier = customerRatingTierInfo(satisfactionValue);

  return {
    satisfaction: satisfactionValue,
    ratingTitle: rated ? tier.title : null,
    orderSat: owner.orderSat != null && owner.orderSat !== ""
      ? clamp(Math.round(Number(owner.orderSat)), 0, 100)
      : null,
    bmSat: owner.bmSat != null && owner.bmSat !== ""
      ? clamp(Math.round(Number(owner.bmSat)), 0, 100)
      : null,
    serviceCompleted: completed.length,
    serviceCancelled: cancelled.length,
    serviceCancelRate: settled ? Math.round((cancelled.length / settled) * 100) : 0,
    workshopOwned: Boolean(owner.assets?.workshopOwned),
    deviceCount: (owner.workshop?.devices || []).length,
    workerCount: workers.length,
    skillPeaks,
    topSkills: topSkillsFromPeaks(skillPeaks),
    topDevices: topDevicesFromList(owner.workshop?.devices || []),
    headlineTags: headlineTagsFromPeaks(skillPeaks),
    capacity: {
      busyWorkers,
      freeWorkers,
      activeJobs,
      acceptHint
    }
  };
}

function computeOrderFinished(order, seller) {
  const { materialStageFor } = requireApi();
  if (!order || !seller) return false;
  const row = findEscrowItemForOrder(seller, order.id);
  if (!row) return Boolean(order.resultItem?.itemId);
  if (row.inDelivery) return false;
  const stage = materialStageFor(row.item);
  const templateId = order.templateId || "custom";
  switch (templateId) {
    case "open-window":
      return ["opened", "carved", "polished", "finished"].includes(stage);
    case "carve-plan":
      return ["carved", "polished", "finished"].includes(stage);
    case "inlay-finish":
      return stage === "finished";
    case "polish-only":
      return stage === "finished" || stage === "polished";
    case "custom":
      if (Array.isArray(order.linkedJobIds) && order.linkedJobIds.length) {
        const pending = (seller.jobs || []).some((job) => order.linkedJobIds.includes(job.id));
        if (pending) return false;
      }
      return ["finished", "polished", "carved", "opened"].includes(stage);
    default:
      return stage === "finished";
  }
}

function refreshOrderFinishedState(order, seller) {
  order.isFinished = computeOrderFinished(order, seller);
  return order.isFinished;
}

function linkWorkshopJobToServiceOrder(orderId, seller, jobId) {
  if (!orderId || !seller || !jobId) return;
  const { getState } = requireApi();
  const order = (getState().blackServiceOrders || []).find((row) => row.id === orderId);
  if (!order || order.sellerId !== seller.id || order.status !== "escrow") return;
  order.linkedJobIds = order.linkedJobIds || [];
  if (!order.linkedJobIds.includes(jobId)) order.linkedJobIds.push(jobId);
  refreshOrderFinishedState(order, seller);
}

function refreshBlackServiceOrderStates(state) {
  let changed = false;
  for (const order of state.blackServiceOrders || []) {
    if (order.status !== "escrow") continue;
    const seller = state.players?.get?.(order.sellerId);
    if (!seller) continue;
    const before = Boolean(order.isFinished);
    refreshOrderFinishedState(order, seller);
    if (Boolean(order.isFinished) !== before) changed = true;
  }
  return changed;
}

function updateServiceProfileForPlayer(player, payload = {}) {
  const { getState } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const locked = denyUnlessBmStall(player);
  if (locked) return locked;
  const stall = findStallByOwner(getState(), player.id);
  if (!stall || stall.type !== "service") {
    return { ok: false, message: "当前不是技术支持摊位。" };
  }
  const autoSnap = buildServiceSnapshot(player, getState());
  stall.serviceProfile = normalizeServiceProfile(payload, player, autoSnap);
  stall.updatedAt = Date.now();
  return {
    ok: true,
    message: "能力档案已更新。", stall,
    serviceProfile: stall.serviceProfile,
    serviceProfileOptions: buildServiceProfileOptions(player, autoSnap)
  };
}

function addServiceOfferForPlayer(player, payload = {}) {
  const { getState, money, randomUUID } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const locked = denyUnlessBmStall(player);
  if (locked) return locked;
  const stall = findStallByOwner(getState(), player.id);
  if (!stall || stall.type !== "service") return { ok: false, message: "当前不是技术支持摊位。" };
  const templateId = String(payload.templateId || "open-window");
  const template = bmServiceTemplateById(templateId);
  if (!template) return { ok: false, message: "无效的服务模板。" };
  const title = String(payload.title || template.title || "").trim().slice(0, 32);
  const desc = String(payload.desc ?? "").trim().slice(0, 200);
  const price = money(Number(payload.price));
  const etaMinutes = clamp(
    Math.round(Number(payload.etaMinutes) || template.defaultEta || 30),
    5,
    24 * 60
  );
  if (!title || price < BLACKMARKET_MIN_PRICE) {
    return { ok: false, message: "请填写服务标题与有效报价。" };
  }
  stall.offers = stall.offers || [];
  if (stall.offers.length >= 12) return { ok: false, message: "服务条目最多 12 条。" };
  if (stall.offers.some((o) => String(o.templateId || "") === template.id)) {
    return { ok: false, message: `已有${template.title}」服务，不能重复添加。` };
  }
  const capabilityRefs = buildOfferCapabilityRefs(player, template.id);
  const offer = {
    id: randomUUID(),
    templateId: template.id,
    title,
    desc,
    price,
    etaMinutes,
    capabilityRefs,
    createdAt: Date.now()
  };
  stall.offers.unshift(offer);
  stall.updatedAt = Date.now();
  const activation = tryActivateStall(stall, player);
  return {
    ok: true,
    message: activation.activated ? activation.message : "已添加服务。", activated: activation.activated,
    offer
  };
}

function removeServiceOfferForPlayer(player, offerId) {
  const { getState } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const stall = findStallByOwner(getState(), player.id);
  if (!stall || stall.type !== "service") return { ok: false, message: "服务不存在。" };
  const before = (stall.offers || []).length;
  stall.offers = (stall.offers || []).filter((o) => o.id !== offerId);
  if (stall.offers.length === before) return { ok: false, message: "服务不存在。" };
  stall.updatedAt = Date.now();
  return { ok: true, message: "已删除服务。" };
}

function orderBlackServiceForPlayer(player, stallId, offerId, payload = {}) {
  const { getState, money, holdDeposit, randomUUID, addNews, takeItem, addItem, materialStageFor } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const locked = denyUnlessBmBuy(player);
  if (locked) return locked;
  const note = typeof payload === "string" ? payload : String(payload?.note || "").trim().slice(0, 120);
  const itemType = payload?.itemType;
  const itemId = payload?.itemId;
  if (!itemType || !itemId) {
    return { ok: false, message: "请选择要加工的物品。" };
  }
  if (!ITEM_TYPES.has(itemType)) {
    return { ok: false, message: "物品类型无效。" };
  }
  const state = getState();
  const stall = findStallById(state, stallId);
  if (!stall || stall.type !== "service") return { ok: false, message: "技术摊不存在。" };
  const seller = state.players.get(stall.ownerId);
  if (!seller) {
    removeStallFromState(state, stall);
    return { ok: false, code: "STALE_STALL", message: "摊主已失效，技术摊已自动下架。" };
  }
  if (stall.status !== "open") return { ok: false, message: "该摊位暂停接单。" };
  if (stall.ownerId === player.id) return { ok: false, message: "不能购买自己的服务。" };
  const offer = (stall.offers || []).find((o) => o.id === offerId);
  if (!offer) return { ok: false, message: "服务条目不存在。" };
  state.blackServiceOrders ||= [];
  return attemptAtomicMutation(
    [player, seller, state.blackServiceOrders, state.news],
    ({ afterCommit }) => {
      const item = takeItem(player, itemType, itemId);
      if (!item) return { ok: false, message: "物品不存在或已不在库存。" };
      registerFinanceItem(player, item);
      const acceptScopes = stall.serviceProfile?.acceptScopes || [];
      if (!itemMatchesAcceptScopes(item, acceptScopes, materialStageFor)) {
        const restored = addItem(player, item);
        if (!restored) throw new Error("blackmarket-service: failed to restore rejected input item");
        return { ok: false, message: "该物品不符合摊位接单范围。" };
      }
      const price = money(offer.price);
      if (!holdDeposit(player, price, `黑市加工托管${offer.title}`, { source: "blackmarket-service" })) {
        const restored = addItem(player, item);
        if (!restored) throw new Error("blackmarket-service: failed to restore unfunded input item");
        return { ok: false, message: "资金不足，无法冻结加工费。" };
      }
      const etaMinutes = Math.max(5, Number(offer.etaMinutes) || 30);
      const now = Date.now();
      item.type = itemType;
      const order = {
        id: randomUUID(),
        stallId: stall.id,
        offerId: offer.id,
        buyerId: player.id,
        buyerName: player.name,
        sellerId: stall.ownerId,
        sellerName: stall.ownerName,
        title: offer.title,
        price,
        note,
        status: "pending",
        createdAt: now,
        acceptExpiresAt: now + BM_ACCEPT_TIMEOUT_MS,
        etaMinutes,
        expiresAt: null,
        deliveredAt: null,
        completedAt: null,
        anonymousStall: stall.anonymous === true,
        stallTitle: stall.title,
        templateId: offer.templateId || "custom",
        capabilitySnapshot: freezeOrderCapabilitySnapshot(seller, offer, state, stall),
        inputItem: {
          type: itemType,
          itemId: item.id,
          name: String(item.name || "物料"),
          materialStage: materialStageFor(item)
        },
        heldItem: { type: itemType, item },
        resultItem: null,
        linkedJobIds: [],
        isFinished: false,
        submitMode: null,
        feeReleased: 0,
        feeRefunded: 0
      };
      state.blackServiceOrders.unshift(order);
      addNews(`${player.name} 下了黑市技术单${offer.title}（待摊主确认）。`, "trade");
      const { notifyPlayerToast } = requireApi();
      if (typeof notifyPlayerToast === "function") {
        afterCommit(() => notifyPlayerToast(
          seller,
          `新委托「${offer.title}」待确认，请在 30 分钟内接单，超时将自动取消。`
        ));
      }
      return { ok: true, message: "已下单，等待摊主确认接单。", order };
    },
    { message: "服务下单未完成，托管资金与物品已恢复，请重试。" }
  );
}

function cancelPendingServiceOrder(order, state, { submitMode = "cancel", newsTone = "trade", penalizeSeller = false } = {}) {
  const { addNews } = requireApi();
  returnHeldItemToBuyer(order, state);
  order.status = "cancelled";
  order.submitMode = submitMode;
  const buyer = state.players?.get?.(order.buyerId);
  if (buyer) {
    order.feeRefunded = releaseDepositSafe(
      buyer,
      order.price,
      `黑市服务退款：${order.title}`,
      { source: "blackmarket-service-refund" }
    );
  }
  if (penalizeSeller) {
    const seller = state.players?.get?.(order.sellerId);
    if (seller) {
      applyRepDelta(seller, BM_SELLER_CANCEL_REP_PENALTY, "黑市卖家取消处罚", { source: "bm_penalty" });
    }
  }
  addNews(`黑市技术单已取消：${order.title}。`, newsTone);
  return true;
}

function acceptBlackServiceForPlayer(player, orderId) {
  const { getState, addNews } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const state = getState();
  const order = (state.blackServiceOrders || []).find((o) => o.id === orderId);
  if (!order) return { ok: false, message: "服务单不存在。" };
  if (order.sellerId !== player.id) return { ok: false, message: "只能由摊主确认接单。" };
  if (order.status !== "pending") return { ok: false, message: "当前状态不可接单。" };
  const buyer = state.players?.get?.(order.buyerId);
  return attemptAtomicMutation(
    [player, buyer, state.blackServiceOrders, state.news],
    ({ afterCommit }) => {
      const now = Date.now();
      if (order.acceptExpiresAt && now > order.acceptExpiresAt) {
        cancelPendingServiceOrder(order, state, { submitMode: "accept_timeout", newsTone: "bad" });
        return { ok: false, message: "接单时限已过，订单已自动取消。" };
      }
      const held = order.heldItem;
      if (!held?.item) return { ok: false, message: "托管物料丢失，无法接单。" };
      const etaMinutes = Math.max(5, Number(order.etaMinutes) || 30);
      attachEscrowItemToSeller(player, order.id, order.buyerId, held.type, held.item);
      order.heldItem = null;
      order.status = "escrow";
      order.acceptedAt = now;
      order.expiresAt = now + etaMinutes * 60 * 1000;
      refreshOrderFinishedState(order, player);
      addNews(`${player.name} 接了黑市技术单${order.title}。`, "trade");
      const { notifyPlayerToast } = requireApi();
      if (typeof notifyPlayerToast === "function") {
        afterCommit(() => notifyPlayerToast(player, `已接单${held.item?.name || "物料"}」，委托物已放入库存「委托」分类。`));
        if (buyer) afterCommit(() => notifyPlayerToast(buyer, `摊主已接单：${order.title}。`));
      }
      return { ok: true, message: "已接单，委托物已入库存，请按时加工提交。", order };
    },
    { message: "服务接单未完成，托管状态已恢复，请重试。" }
  );
}

function submitBlackServiceForPlayer(player, orderId, { forceEarly = false } = {}) {
  const { getState, releaseDeposit, addItem, addNews, materialStageFor } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const state = getState();
  const order = (state.blackServiceOrders || []).find((o) => o.id === orderId);
  if (!order) return { ok: false, message: "服务单不存在。" };
  if (order.sellerId !== player.id) return { ok: false, message: "只能由接单方提交。" };
  if (order.status !== "escrow") return { ok: false, message: "当前状态不可提交。" };
  const buyer = state.players.get(order.buyerId);
  refreshOrderFinishedState(order, player);
  if (!order.isFinished && !forceEarly) {
    return {
      ok: false,
      needConfirm: true,
      message: "该订单尚未完成加工。", penalty: order.price
    };
  }
  const escrowRow = findEscrowItemForOrder(player, order.id);
  if (!escrowRow) return { ok: false, message: "找不到托管物品。" };
  if (escrowRow.inDelivery) return { ok: false, message: "请先在「进行事项 → 工坊」领取加工产物，再提交委托。" };
  if (escrowRow.inJob) {
    return { ok: false, message: "委托物仍在加工中，请等任务完成后再提交。" };
  }
  return attemptAtomicMutation(
    [player, buyer, state.blackServiceOrders, state.news],
    () => {
      if (order.isFinished && !forceEarly) {
        const item = removeEscrowItemFromSeller(player, escrowRow.type, escrowRow.item);
        if (!item) return { ok: false, message: "托管物品转移失败。" };
        delete item.financeServiceCost;
        if (buyer) {
          // Delivery makes the agreed service fee payable. Record it before
          // returning sellable stock, so a sale before buyer confirmation still
          // has its full direct cost. Confirming/releasing escrow cannot add it
          // a second time.
          if (!order.financeFeeBookedAt) {
            addFinanceItemCost(buyer, item, order.price, true, "processing", { refundKey: order.id });
            order.financeFeeBookedAt = Date.now();
            order.financeFeeBatchId = item.financeBatchId;
            order.financeFeeBookedAmount = order.price;
          }
          const added = addItem(buyer, item);
          if (!added) throw new Error("blackmarket-service: buyer inventory rejected delivered item");
        }
        order.resultItem = {
          type: escrowRow.type,
          itemId: item.id,
          name: String(item.name || "物料"),
          materialStage: materialStageFor(item)
        };
        order.status = "delivered";
        order.submitMode = "normal";
        order.deliveredAt = Date.now();
        addNews(`${player.name} 提交了黑市技术单${order.title}。`, "trade");
        return { ok: true, message: "已提交，等待买家确认。", order };
      }

      const item = removeEscrowItemFromSeller(player, escrowRow.type, escrowRow.item);
      if (item && buyer) {
        delete item.financeServiceCost;
        const added = addItem(buyer, item);
        if (!added) throw new Error("blackmarket-service: buyer inventory rejected returned item");
      }
      if (buyer) {
        order.feeRefunded = releaseDepositSafe(
          buyer,
          order.price,
          `加工单提前退回：${order.title}`,
          { source: "blackmarket-service-refund" }
        );
      }
      order.status = "refunded";
      order.submitMode = "early";
      order.feeReleased = 0;
      applyRepDelta(player, BM_EARLY_SUBMIT_REP_PENALTY, "黑市提前交割处罚", { source: "bm_penalty" });
      addNews(`${player.name} 提前提交了黑市技术单，加工费已退还买家。`, "bad");
      return { ok: true, message: "已提前提交，加工费已退还买家。", order };
    },
    { message: "服务交付未完成，双方物品与托管资金已恢复，请重试。" }
  );
}

function deliverBlackServiceForPlayer(player, orderId) {
  return submitBlackServiceForPlayer(player, orderId, { forceEarly: false });
}

function confirmBlackServiceForPlayer(player, orderId) {
  const { getState, addNews } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const state = getState();
  const order = (state.blackServiceOrders || []).find((o) => o.id === orderId);
  if (!order) return { ok: false, message: "服务单不存在。" };
  if (order.buyerId !== player.id) return { ok: false, message: "只能由下单方确认。" };
  if (order.status !== "delivered") {
    return { ok: false, message: "卖家尚未提交交付。" };
  }
  const seller = state.players.get(order.sellerId);
  if (!seller) {
    return { ok: false, code: "STALE_ORDER", message: "卖家已失效，订单等待恢复处理。" };
  }
  return attemptAtomicMutation(
    [player, seller, state.blackServiceOrders, state.news],
    ({ afterCommit }) => {
      order.status = "completed";
      order.completedAt = Date.now();
      paySellerNow(seller, order.price, `服务·${order.title}`, {
        source: "blackmarket-service-payout",
        afterCommit
      });
      bumpBmDeal(seller);
      order.feeReleased = order.price;
      pushPendingRatings(player, seller, {
        tradeId: order.id,
        tradeKind: "service",
        stallTitle: order.stallTitle,
        itemLabel: order.title,
        itemName: order.title,
        price: order.price,
        note: order.note || "",
        inputItemName: order.inputItem?.name || order.resultItem?.name || "",
        anonymous: order.anonymousStall === true
      });
      addNews(`黑市技术单完成${order.title}。`, "trade");
      return { ok: true, message: "已确认完成，卖家可领加工费。", order };
    },
    { message: "服务确认未完成，双方资金与订单状态已恢复，请重试。" }
  );
}

function cancelBlackServiceForPlayer(player, orderId) {
  const { getState, addNews } = requireApi();
  if (!player) return { ok: false, message: "未找到玩家。" };
  const state = getState();
  const order = (state.blackServiceOrders || []).find((o) => o.id === orderId);
  if (!order) return { ok: false, message: "服务单不存在。" };
  if (order.buyerId !== player.id && order.sellerId !== player.id) {
    return { ok: false, message: "无权取消该单。" };
  }
  if (order.status !== "pending" && order.status !== "escrow") {
    return { ok: false, message: "仅待确认或托管中的服务单可取消。" };
  }
  if (order.status === "escrow" && Array.isArray(order.linkedJobIds) && order.linkedJobIds.length) {
    return { ok: false, message: "加工已开始，无法取消。" };
  }
  const buyer = state.players.get(order.buyerId);
  const seller = state.players.get(order.sellerId);
  return attemptAtomicMutation(
    [player, buyer, seller, state.blackServiceOrders, state.news],
    () => {
      if (order.status === "pending") {
        cancelPendingServiceOrder(order, state, {
          submitMode: player.id === order.sellerId ? "reject" : "cancel",
          newsTone: "trade",
          penalizeSeller: false
        });
        const msg = player.id === order.sellerId
          ? "已拒绝接单，物品与加工费已退回买家。" : "已取消，物品与加工费已退回。";
        return { ok: true, message: msg, order };
      }
      returnEscrowItemToBuyer(order, state);
      order.status = "cancelled";
      order.submitMode = "cancel";
      if (buyer) {
        order.feeRefunded = releaseDepositSafe(
          buyer,
          order.price,
          `黑市服务退款：${order.title}`,
          { source: "blackmarket-service-refund" }
        );
      }
      if (player.id === order.sellerId) {
        applyRepDelta(player, BM_SELLER_CANCEL_REP_PENALTY, "黑市卖家取消处罚", { source: "bm_penalty" });
      }
      addNews(`黑市技术单已取消：${order.title}。`, "trade");
      return { ok: true, message: "已取消，物品与加工费已退回买家。", order };
    },
    { message: "服务取消未完成，双方物品与托管资金已恢复，请重试。" }
  );
}

function processExpiredBlackServiceOrders(state, now = Date.now()) {
  const { addNews, releaseDeposit } = requireApi();
  let changed = false;
  for (const order of state.blackServiceOrders || []) {
    const buyer = state.players?.get?.(order.buyerId);
    const seller = state.players?.get?.(order.sellerId);
    if (order.status === "pending") {
      if (!order.acceptExpiresAt || now <= order.acceptExpiresAt) continue;
      const result = attemptAtomicMutation(
        [buyer, seller, state.blackServiceOrders, state.news],
        () => {
          cancelPendingServiceOrder(order, state, {
            submitMode: "accept_timeout",
            newsTone: "bad",
            penalizeSeller: false
          });
          return { ok: true };
        }
      );
      if (result.ok) changed = true;
      continue;
    }
    if (order.status !== "escrow") continue;
    if (!order.expiresAt || now <= order.expiresAt) continue;
    const result = attemptAtomicMutation(
      [buyer, seller, state.blackServiceOrders, state.news],
      () => {
        returnEscrowItemToBuyer(order, state);
        if (buyer) {
          order.feeRefunded = releaseDeposit(
            buyer,
            order.price,
            `加工单超时退款：${order.title}`,
            { source: "blackmarket-service-refund" }
          );
        }
        if (seller) {
          applyRepDelta(seller, BM_TIMEOUT_REP_PENALTY, "黑市超时未交割处", { source: "bm_penalty" });
        }
        order.status = "cancelled";
        order.submitMode = "timeout";
        order.feeReleased = 0;
        addNews(`黑市技术单超时${order.title}，已自动取消并退款给买家。`, "bad");
        return { ok: true };
      }
    );
    if (result.ok) changed = true;
  }
  return changed;
}

function publicServiceOrdersForPlayer(state, playerId, viewerId, now = Date.now()) {
  const id = String(playerId || "");
  const viewer = String(viewerId || "");
  return (state.blackServiceOrders || [])
    .filter((o) => o.buyerId === id || o.sellerId === id)
    .filter((o) => {
      // Expired / cancelled / refunded never appear in order lists
      if (o.status === "cancelled" || o.status === "refunded") return false;
      if (o.status === "pending") {
        if (o.acceptExpiresAt && now > o.acceptExpiresAt) return false;
        return true;
      }
      if (o.status === "escrow") {
        if (o.expiresAt && now > o.expiresAt) return false;
        return true;
      }
      if (o.status === "delivered") return true;
      if (viewer === id && o.status === "completed") return true;
      return false;
    })
    .slice(0, 40)
    .map((o) => {
      const seller = state.players?.get?.(o.sellerId);
      const isBuyer = o.buyerId === viewer;
      const isSeller = o.sellerId === viewer;
      const isFinished = o.status === "escrow" && seller
        ? computeOrderFinished(o, seller)
        : Boolean(o.isFinished);
      const buyerDisplayName = (o.anonymousStall && isSeller)
        ? desensitizePlayerName(o.buyerName)
        : o.buyerName;
      const { heldItem: _held, ...safeOrder } = o;
      return {
        ...safeOrder,
        inputItem: publicInputItemRef(o.inputItem),
        resultItem: publicInputItemRef(o.resultItem),
        capabilitySnapshot: publicCapabilitySnapshot(o.capabilitySnapshot),
        buyerRating: o.buyerRating || null,
        sellerRating: o.sellerRating || null,
        isBuyer,
        isSeller,
        isFinished,
        buyerDisplayName
      };
    });
}

  return {
    defaultServiceProfile,
    normalizeServiceProfile,
    buildServiceProfileOptions,
    applyServiceCuration,
    buildOfferCapabilityRefs,
    sortServiceOffers,
    publicServiceOffer,
    freezeOrderCapabilitySnapshot,
    buildServiceProof,
    buildServiceSnapshot,
    computeOrderFinished,
    linkWorkshopJobToServiceOrder,
    refreshBlackServiceOrderStates,
    updateServiceProfileForPlayer,
    addServiceOfferForPlayer,
    removeServiceOfferForPlayer,
    orderBlackServiceForPlayer,
    acceptBlackServiceForPlayer,
    submitBlackServiceForPlayer,
    deliverBlackServiceForPlayer,
    confirmBlackServiceForPlayer,
    cancelBlackServiceForPlayer,
    processExpiredBlackServiceOrders,
    publicServiceOrdersForPlayer
  };
}
