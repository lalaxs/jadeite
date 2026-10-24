import {
  MINES,
  MINING_BASIC_MAX_CREW,
  MINING_BASIC_MIN_CREW,
  MINING_BASIC_MODE,
  MINER_FATIGUE_WORK_LIMIT,
  MINER_CARE_OPTIONS,
  MINER_INITIAL_CONTRACT_SHIFTS,
  MINER_MAX_TIER,
  MINER_MENTOR_REQUIRED_SHIFTS,
  MINER_MENTOR_REQUIRED_TIER,
  MINER_MENTORSHIP_REQUIRED_SHIFTS,
  MINER_MENTORSHIP_ROLE_EXP,
  MINER_MORALE_CARE_THRESHOLD,
  MINER_RETENTION_CHOICES,
  MINER_REST_MIN_FATIGUE,
  MINER_SKILL_MAX_LEVEL,
  MINER_SHIFT_FATIGUE,
  MINER_SPECIALIZATIONS,
  MINER_SPECIALIZATION_BONUS,
  MINER_SPECIALIZATION_REQUIRED_LEVEL,
  MINER_SPECIALIZATION_REQUIRED_SHIFTS,
  MINER_TRAINING_PROGRAMS,
  MINER_TRAIT_EFFECTS,
  MINING_CLUE_TARGET,
  MINING_FACILITIES,
  MINING_FACILITY_MAX_LEVEL,
  MINING_INCIDENT_REVEAL_RATIO,
  MINING_MASTERY_MAX_LEVEL,
  MINING_MASTERY_THRESHOLDS,
  MINING_MAX_SURVEY_REPORTS,
  MINING_MAX_MINERS,
  MINING_MAX_PREPARATIONS,
  MINING_MAX_PREFERENCES,
  MINING_PREPARATIONS,
  MINING_RECRUIT_REFRESH_COST,
  MINING_ROLE_EXPERIENCE,
  MINING_ROLE_SKILL_BONUS,
  MINING_SHIFT_INCENTIVES,
  MINING_SHIFT_ROLES,
  MINING_SITE_CONDITIONS,
  MINING_STRATEGIES,
  MINING_SURVEY_REPORT,
  miningCrewBondEffectLabel,
  miningCrewBondInfo,
  miningCrewBondNextAt,
  miningCrewKey,
  miningBasicMineProfile,
  miningBasicMinerProfile,
  miningBasicShiftPlan,
  miningFacilityEffectLabel,
  miningFacilityUpgradeCost,
  miningForemanInfo,
  miningAutoRoleAssignments,
  miningMineById,
  miningMineMasteryEffectLabel,
  miningMineMasteryInfo,
  miningMineMasteryNextAt,
  miningMinerEffectLabel,
  miningMinerEffectiveSkill,
  miningMinerFatigueAt,
  miningMinerMoraleInfo,
  miningMinerRetentionChoiceQuote,
  miningMinerRetentionInfo,
  miningMentorshipEligibility,
  miningMentorshipProgress,
  miningMinerShiftMoraleDelta,
  miningMinerContractInfo,
  miningMinerPromotionInfo,
  miningMinerTierBonus,
  miningMinerSkillExpTarget,
  miningMinerSpecializationEligibility,
  miningMinerSpecializationInfo,
  miningPreparationEffects,
  miningRoleAssignmentDetails,
  miningShiftIncidentById,
  miningShiftIncidentChoice,
  miningShiftIncentiveById,
  miningShiftPerformance,
  miningShiftWageQuote,
  miningTuningDraftProjection,
  miningQualityLabel
} from "/shared/domain/mining/mining-rules.js";
import { activateModalLifecycle } from "./modal-lifecycle.js";

let socket;
let getState = () => null;
let getActiveView = () => "";
let registerAction = () => {};
let h = {};
let activeTab = "mines";
let activeRecordsTab = "shifts";
let activeMinerTab = "hired";
let preferenceDraft = [];
let preferenceServerKey = "";
let allowFallbackDraft = true;
let preferenceMutationPending = false;
let preferenceMutationTimer = null;
let candidateRefreshMutationPending = false;
let candidateRefreshMutationTimer = null;
let candidateRefreshCooldownUntil = 0;
let candidateRefreshCooldownTimer = null;
let minerRosterMutationPending = false;
let minerRosterMutationTimer = null;
let miningShiftMutationPending = false;
let miningShiftMutationTimer = null;
let selectedMinerIds = [];
let selectedForemanId = "";
let selectedRoleAssignments = {};
let selectedStrategyId = "standard";
let selectedIncentiveId = "standard";
let selectedPreparationIds = [];
let selectedUseSurveyReport = false;
let focusedMineId = "";
let miningMapZoom = 0.82;
let miningMapPanX = 0;
let pendingMineFocusId = "";
let mineInspectorVisible = false;
let mineInspectorModalLifecycleCleanup = null;
let mineInspectorRenderKey = "";
let mineInteriorVisible = false;
let mineInteriorJobId = "";
let focusedInteriorMinerId = "";
let miningHistoryInitialized = false;
let lastMiningHistorySignature = "";
let lastMiningRecoveryNoticeSignature = "";
let pendingApplicationRound = 0;
let lastAllocationNoticeRound = 0;
let competitionInsightsOpen = false;
let economyInsightsOpen = false;
let worldEconomyReportOpen = false;
let tuningSandboxOpen = false;
let tuningSandboxBeltId = "";
let tuningSandboxScenarioId = "";
let tuningDraftOpen = false;
let tuningDraftSelections = {};
let tuningExperimentsOpen = false;
let tuningExperimentMutationPending = false;
let tuningGovernanceMutationPending = false;
let pendingTuningGovernanceAction = null;
let tuningObservationStatusesInitialized = false;
let tuningObservationStatuses = new Map();
let tuningEffectStatusesInitialized = false;
let tuningEffectStatuses = new Map();

const MINING_MAP_WIDTH = 2172;
const MINING_MAP_HEIGHT = 724;
const MINING_MAP_MIN_ZOOM = 0.68;
const MINING_MAP_MAX_ZOOM = 1.2;
const MINING_MUTATION_CLICK_COOLDOWN_MS = 1_000;

const MINING_INTERIOR_ROLES = Object.freeze([
  "掌子面开采",
  "支护巡检",
  "筛料装车"
]);

const MINING_MAP_BELTS = Object.freeze([
  Object.freeze({ id: "mist", label: "雾溪浅层", hint: "浅坑与水口", x: 10 }),
  Object.freeze({ id: "ridge", label: "青岭矿带", hint: "缓坡露采", x: 30 }),
  Object.freeze({ id: "glacier", label: "冰河矿带", hint: "浅色岩层", x: 50 }),
  Object.freeze({ id: "deep", label: "苍岫深层", hint: "低台阶深坑", x: 70 }),
  Object.freeze({ id: "core", label: "天游核心", hint: "老场矿口", x: 90 })
]);

const MINING_MAP_PORTALS = Object.freeze([
  Object.freeze({ x: 113, y: 273, width: 22, height: 22 }),
  Object.freeze({ x: 232, y: 276, width: 20, height: 22 }),
  Object.freeze({ x: 336, y: 311, width: 28, height: 23 }),
  Object.freeze({ x: 133, y: 346, width: 20, height: 23 }),
  Object.freeze({ x: 251, y: 367, width: 22, height: 20 }),
  Object.freeze({ x: 348, y: 389, width: 25, height: 21 }),

  Object.freeze({ x: 587, y: 291, width: 24, height: 20 }),
  Object.freeze({ x: 704, y: 306, width: 26, height: 22 }),
  Object.freeze({ x: 772, y: 314, width: 24, height: 21 }),
  Object.freeze({ x: 573, y: 362, width: 23, height: 22 }),
  Object.freeze({ x: 650, y: 361, width: 24, height: 20 }),
  Object.freeze({ x: 747, y: 379, width: 22, height: 20 }),

  Object.freeze({ x: 1018, y: 295, width: 20, height: 22 }),
  Object.freeze({ x: 1120, y: 305, width: 22, height: 21 }),
  Object.freeze({ x: 1186, y: 333, width: 23, height: 22 }),
  Object.freeze({ x: 991, y: 368, width: 24, height: 23 }),
  Object.freeze({ x: 1081, y: 367, width: 21, height: 23 }),
  Object.freeze({ x: 1178, y: 391, width: 22, height: 24 }),

  Object.freeze({ x: 1455, y: 294, width: 17, height: 22 }),
  Object.freeze({ x: 1587, y: 305, width: 21, height: 22 }),
  Object.freeze({ x: 1660, y: 336, width: 25, height: 23 }),
  Object.freeze({ x: 1462, y: 367, width: 21, height: 22 }),
  Object.freeze({ x: 1540, y: 362, width: 24, height: 23 }),
  Object.freeze({ x: 1616, y: 393, width: 21, height: 20 }),

  Object.freeze({ x: 1922, y: 291, width: 19, height: 20 }),
  Object.freeze({ x: 2020, y: 307, width: 21, height: 23 }),
  Object.freeze({ x: 2067, y: 314, width: 24, height: 22 }),
  Object.freeze({ x: 1856, y: 348, width: 23, height: 22 }),
  Object.freeze({ x: 1934, y: 363, width: 24, height: 24 }),
  Object.freeze({ x: 2023, y: 379, width: 25, height: 24 })
]);

function money(value) {
  return h.formatMoney ? h.formatMoney(value) : `¥${Math.round(Number(value) || 0).toLocaleString("zh-CN")}`;
}

function duration(value) {
  return h.formatDuration ? h.formatDuration(value) : `${Math.max(0, Math.ceil((Number(value) || 0) / 1000))}秒`;
}

function esc(value) {
  return h.escapeHtml ? h.escapeHtml(value) : String(value || "");
}

function now() {
  return h.nowMs ? h.nowMs() : Date.now();
}

function percent(value) {
  return `${Math.round(Math.max(0, Number(value) || 0) * 100)}%`;
}

function signedPercent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function signedMoney(value) {
  const amount = Math.round(Number(value) || 0);
  if (!amount) return money(0);
  return `${amount > 0 ? "+" : "−"}${money(Math.abs(amount))}`;
}

function signedPercentagePoints(value) {
  const points = Math.round((Number(value) || 0) * 100);
  if (!points) return "0 个百分点";
  return `${points > 0 ? "+" : "−"}${Math.abs(points)} 个百分点`;
}

function riskLabel(value) {
  const risk = Math.max(0, Number(value) || 0);
  if (risk >= 0.25) return "高";
  if (risk >= 0.12) return "中";
  return "低";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mineQualities(mine) {
  return mine.weights
    .map((weight, index) => ({ weight, label: miningQualityLabel(["bean", "glutinous", "stickyIce", "ice", "highIce", "glass"][index]) }))
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 2)
    .map((entry) => entry.label)
    .join("、");
}

function minerCondition(miner) {
  const fatigue = miningMinerFatigueAt(miner, now());
  const injuredUntil = Number(miner?.injuredUntil) || 0;
  const retention = miningMinerRetentionInfo(miner, now());
  if (retention.pending) {
    return { ready: false, fatigue, tone: "retention", label: "离职申请待处理" };
  }
  if (retention.leaveUntil > now()) {
    return { ready: false, fatigue, tone: "leave", label: `个人请假 ${duration(retention.leaveUntil - now())}` };
  }
  if (injuredUntil > now()) {
    return { ready: false, fatigue, tone: "hurt", label: `伤停 ${duration(injuredUntil - now())}` };
  }
  if (fatigue >= MINER_FATIGUE_WORK_LIMIT) {
    return { ready: false, fatigue, tone: "tired", label: `疲劳 ${Math.round(fatigue)} · 休整中` };
  }
  return { ready: true, fatigue, tone: fatigue >= 50 ? "warn" : "good", label: `疲劳 ${Math.round(fatigue)}` };
}

function stateMining() {
  return getState()?.mining || {};
}

function effectiveMiningMineById(mineId, mining = stateMining()) {
  const mine = miningMineById(mineId);
  if (!mine) return null;
  const effective = (Array.isArray(mining?.effectiveMines) ? mining.effectiveMines : [])
    .find((entry) => String(entry?.id || "") === mine.id);
  return effective ? { ...mine, ...effective } : mine;
}

function effectiveMiningMines(mining = stateMining()) {
  return MINES.map((mine) => effectiveMiningMineById(mine.id, mining));
}

function playerMining() {
  return getState()?.me?.mining || {};
}

function syncMiningTuningObservationNotice(mining) {
  const experiments = Array.isArray(mining?.tuningExperiments) ? mining.tuningExperiments : [];
  const nextStatuses = new Map(experiments.map((entry) => [String(entry.id || ""), entry.status]));
  if (!tuningObservationStatusesInitialized) {
    tuningObservationStatusesInitialized = true;
    tuningObservationStatuses = nextStatuses;
    return;
  }
  for (const experiment of experiments) {
    const previous = tuningObservationStatuses.get(String(experiment.id || ""));
    if (previous !== "collecting" || experiment.status === "collecting") continue;
    h.showToast?.({
      title: experiment.status === "complete" ? "影子观察已完成" : "影子观察样本不足",
      text: experiment.assessment?.summary || experiment.note || "观察记录已更新。"
    });
  }
  tuningObservationStatuses = nextStatuses;
}

function syncMiningTuningEffectNotice(mining) {
  const active = mining?.tuningGovernance?.activeVersion || null;
  const effect = active?.effectReport || null;
  const key = String(active?.id || "");
  const signature = effect ? `${effect.status}:${effect.assessment?.id || ""}` : "";
  const nextStatuses = key && signature ? new Map([[key, signature]]) : new Map();
  if (!tuningEffectStatusesInitialized) {
    tuningEffectStatusesInitialized = true;
    tuningEffectStatuses = nextStatuses;
    return;
  }
  const previous = tuningEffectStatuses.get(key);
  if (key && previous && previous !== signature) {
    const assessment = effect?.assessment || {};
    h.showToast?.({
      title: assessment.id === "rollback-recommended"
        ? "正式版本触发安全线"
        : effect.status === "complete"
          ? "生效后跟踪已完成"
          : effect.status === "insufficient"
            ? "生效后样本不足"
            : "生效后跟踪已更新",
      text: assessment.summary || effect.note || "正式数值版本的跟踪结果已更新。"
    });
  }
  tuningEffectStatuses = nextStatuses;
}

function emitMiningTuningGovernanceAction() {
  const pending = pendingTuningGovernanceAction;
  pendingTuningGovernanceAction = null;
  h.closeGameModal?.();
  if (!pending?.event || tuningGovernanceMutationPending) return;
  tuningGovernanceMutationPending = true;
  renderMining();
  socket.emit(pending.event, pending.payload, () => {
    tuningGovernanceMutationPending = false;
    if (pending.event === "miningReviewTuningExperiment") tuningExperimentsOpen = true;
    renderMining();
  });
}

function openMiningTuningGovernanceConfirmation(type, id) {
  const mining = stateMining();
  const governance = mining.tuningGovernance || {};
  if (!governance.canManage) {
    h.showToast?.("只有矿务数值审核员可以执行正式数值操作。");
    return;
  }
  const active = governance.activeVersion || null;
  const pending = governance.pendingVersion || null;
  const experiment = (mining.tuningExperiments || []).find((entry) => String(entry.id) === String(id || ""));
  const rowsLabel = (rows = []) => rows.map((row) => `${row.beltLabel} · ${row.scenarioLabel}`).join(" / ") || "恢复初始数值";
  const configs = {
    review: {
      event: "miningReviewTuningExperiment",
      payload: { experimentId: String(id || "") },
      title: "确认生成全服正式版本",
      subtitle: experiment ? rowsLabel(experiment.rows) : "人工审核",
      tone: "warn",
      lines: [
        "确认后会建立待生效版本，并在安全轮次边界统一切换。",
        "普通调整生效后必须完成三个独立轮次的效果追踪，期间不能叠加下一次调整。"
      ],
      confirmLabel: "确认审核并排期"
    },
    cancel: {
      event: "miningCancelTuningVersion",
      payload: { versionId: String(id || "") },
      title: `确认撤销 V${Number(pending?.number) || 0} 排期`,
      subtitle: pending ? rowsLabel(pending.rows) : "待生效版本",
      tone: "warn",
      lines: ["撤销后该版本不会生效，当前正式数值保持不变。"],
      confirmLabel: "确认撤销排期"
    },
    rollback: {
      event: "miningRollbackTuningVersion",
      payload: { versionId: String(id || "") },
      title: `确认安排 V${Number(active?.number) || 0} 回滚`,
      subtitle: active ? rowsLabel(active.rows) : "当前正式版本",
      tone: "danger",
      lines: [
        "回滚不会立刻改写当前租期，将在下一个安全轮次边界恢复上一版本数值。",
        "若当前版本尚未完成三轮追踪，阶段结果会以“观察提前中止”永久归档。"
      ],
      confirmLabel: "确认安排安全回滚"
    }
  };
  const config = configs[type];
  if (!config || !id) return;
  if (typeof h.openGameModal !== "function") {
    h.showToast?.("确认窗口暂不可用，请稍后重试。");
    return;
  }
  pendingTuningGovernanceAction = { event: config.event, payload: config.payload };
  h.openGameModal({
    id: `mining-tuning-confirm:${type}:${id}`,
    title: config.title,
    subtitle: config.subtitle,
    tone: config.tone,
    lines: config.lines,
    actions: [
      { label: config.confirmLabel, clientAction: "miningConfirmTuningGovernance" },
      { label: "取消", variant: "secondary", clientAction: "miningCancelTuningGovernanceConfirm" }
    ]
  });
}

function basicModeEnabled() {
  const configured = stateMining().basicMode;
  return typeof configured === "boolean" ? configured : MINING_BASIC_MODE;
}

function syncMiningAllocationNotice(mining) {
  const applicationRound = Number(mining.myApplication?.targetRound) || 0;
  if (applicationRound) pendingApplicationRound = applicationRound;
  const currentRound = mining.currentRound;
  if (
    !pendingApplicationRound
    || !currentRound?.allocatedAt
    || Number(currentRound.number) < pendingApplicationRound
    || lastAllocationNoticeRound >= pendingApplicationRound
  ) return;
  const targetRound = pendingApplicationRound;
  pendingApplicationRound = 0;
  lastAllocationNoticeRound = targetRound;
  const lease = mining.myLease?.roundNumber === targetRound ? mining.myLease : null;
  if (lease) {
    const allocationLabel = lease.priorityAllocation
      ? "上轮落选优先"
      : lease.allocationMode === "adjusted"
        ? "空闲矿山调剂"
        : lease.preferenceRank
          ? `第 ${lease.preferenceRank} 志愿中选`
          : "随机抽签中选";
    h.showToast?.({
      title: "矿权分配完成",
      text: `第 ${targetRound} 轮已取得 ${miningMineById(lease.mineId)?.name || "矿山"}（${allocationLabel}），租金 ${money(lease.rent)}。`,
      tone: "success",
      dedupeKey: `mining-allocation:${targetRound}:won`,
      duration: 5000
    });
    return;
  }
  h.showToast?.({
    title: "本轮未取得矿权",
    text: Number(playerMining().priorityRound) > targetRound
      ? `第 ${targetRound} 轮没有中签，冻结资金已全额退回；下一轮重新申请并接受调剂时将优先分配。`
      : `第 ${targetRound} 轮没有中签，冻结资金已全额退回，可在下一申请期重新选择。`,
    tone: "info",
    dedupeKey: `mining-allocation:${targetRound}:missed`,
    duration: 5000
  });
}

function syncMiningSettlementNotice() {
  const latest = playerMining().history?.[0];
  const signature = latest
    ? `${getState()?.me?.id || "player"}:${latest.id || "shift"}:${Number(latest.completedAt) || 0}`
    : "";
  if (!miningHistoryInitialized) {
    miningHistoryInitialized = true;
    lastMiningHistorySignature = signature;
    return;
  }
  if (!signature || signature === lastMiningHistorySignature) return;
  lastMiningHistorySignature = signature;
  if (latest.status === "refunded") {
    h.showToast?.({
      title: "开采任务已退款",
      text: latest.note || `任务资料异常，未生成原石；已退回 ${money(latest.refund)}。`,
      tone: "warn",
      dedupeKey: `mining-settlement:${signature}`,
      duration: 6500
    });
    return;
  }
  const roughCount = Math.max(0, Number(latest.roughCount) || 0);
  const totalMass = Math.max(0, Number(latest.totalMass) || 0).toFixed(1);
  h.showToast?.({
    title: "开采完成",
    text: `${latest.mineName || "矿山"}运回 ${roughCount} 块原石（${totalMass} kg）${latest.accident ? "，途中发生事故并减产" : ""}。`,
    tone: latest.accident ? "warn" : "success",
    dedupeKey: `mining-settlement:${signature}`,
    duration: 5000
  });
}

function syncMiningRecoveryNotice(mining) {
  const notice = mining.applicationRecoveryNotice;
  if (!notice) return;
  const signature = `${Number(notice.roundNumber) || 0}:${Number(notice.settledAt) || 0}:${Number(notice.refund) || 0}`;
  if (!signature || signature === lastMiningRecoveryNoticeSignature) return;
  lastMiningRecoveryNoticeSignature = signature;
  h.showToast?.({
    title: "矿区停机恢复完成",
    text: notice.message || `旧矿权申请已过期，冻结款 ${money(notice.refund)} 已全额退回。`,
    tone: "info",
    dedupeKey: `mining-downtime-recovery:${signature}`,
    duration: 6500
  });
}

function syncDrafts() {
  const application = stateMining().myApplication;
  const nextKey = application
    ? `${application.id}:${(application.preferences || []).join(",")}:${application.allowFallback !== false}`
    : "none";
  if (nextKey !== preferenceServerKey) {
    preferenceServerKey = nextKey;
    preferenceDraft = application ? [...(application.preferences || [])] : [];
    allowFallbackDraft = application ? application.allowFallback !== false : true;
  }
  const miners = playerMining().miners || [];
  const roster = new Set(miners.map((miner) => miner.id));
  const available = new Set(miners.filter((miner) => (
    !miner.busy && (basicModeEnabled() || (minerCondition(miner).ready && !miningMinerContractInfo(miner).expired))
  )).map((miner) => miner.id));
  const activeJobMinerIds = new Set((playerMining().jobs || [])
    .filter((job) => job?.status === "active")
    .flatMap((job) => Array.isArray(job.minerIds) ? job.minerIds.map(String) : []));
  selectedMinerIds = selectedMinerIds.filter((id) => (
    roster.has(id) && (available.has(id) || activeJobMinerIds.has(id))
  ));
  if (basicModeEnabled()) {
    selectedMinerIds = selectedMinerIds.slice(-MINING_BASIC_MAX_CREW);
    selectedForemanId = "";
    selectedRoleAssignments = {};
    selectedPreparationIds = [];
    selectedUseSurveyReport = false;
    return;
  }
  if (!selectedMinerIds.includes(selectedForemanId)) selectedForemanId = selectedMinerIds[0] || "";
  const selectedMiners = miners.filter((miner) => selectedMinerIds.includes(miner.id));
  const roleKeys = Object.keys(selectedRoleAssignments);
  const assignedMinerIds = roleKeys.map((roleKey) => String(selectedRoleAssignments[roleKey] || ""));
  const rolesValid = roleKeys.length === selectedMiners.length
    && roleKeys.every((roleKey) => Boolean(MINING_SHIFT_ROLES[roleKey]))
    && assignedMinerIds.every((minerId) => selectedMinerIds.includes(minerId))
    && new Set(assignedMinerIds).size === selectedMiners.length;
  if (!rolesValid) selectedRoleAssignments = miningAutoRoleAssignments(selectedMiners);
  selectedPreparationIds = selectedPreparationIds.filter((id) => Boolean(MINING_PREPARATIONS[id]));
  if (!MINING_SHIFT_INCENTIVES[selectedIncentiveId]) selectedIncentiveId = "standard";
  const leaseMineId = stateMining().myLease?.mineId;
  if ((Number(playerMining().mineRecords?.[leaseMineId]?.surveyReports) || 0) < 1) selectedUseSurveyReport = false;
}

function restorePreferenceDraftFromServer() {
  const application = stateMining().myApplication;
  preferenceDraft = application ? [...(application.preferences || [])] : [];
  allowFallbackDraft = application ? application.allowFallback !== false : true;
  preferenceServerKey = application
    ? `${application.id}:${preferenceDraft.join(",")}:${allowFallbackDraft}`
    : "none";
}

function finishPreferenceMutation() {
  preferenceMutationPending = false;
  if (preferenceMutationTimer) globalThis.clearTimeout(preferenceMutationTimer);
  preferenceMutationTimer = null;
}

function beginPreferenceMutation() {
  preferenceMutationPending = true;
  if (preferenceMutationTimer) globalThis.clearTimeout(preferenceMutationTimer);
  preferenceMutationTimer = globalThis.setTimeout(() => {
    if (!preferenceMutationPending) return;
    finishPreferenceMutation();
    restorePreferenceDraftFromServer();
    renderMining();
    h.showToast?.("志愿保存响应超时，请确认当前申请状态后再试。");
  }, 10_000);
}

function finishCandidateRefreshMutation() {
  candidateRefreshMutationPending = false;
  if (candidateRefreshMutationTimer) globalThis.clearTimeout(candidateRefreshMutationTimer);
  candidateRefreshMutationTimer = null;
}

function candidateRefreshCoolingDown() {
  return Date.now() < candidateRefreshCooldownUntil;
}

function refreshMiningCandidates() {
  if (minerRosterMutationPending) {
    h.showToast?.("矿工名单正在更新，请稍候。");
    return;
  }
  if (candidateRefreshMutationPending || candidateRefreshCoolingDown()) {
    h.showToast?.("招募名单正在刷新，请稍候。");
    return;
  }
  candidateRefreshCooldownUntil = Date.now() + MINING_MUTATION_CLICK_COOLDOWN_MS;
  if (candidateRefreshCooldownTimer) globalThis.clearTimeout(candidateRefreshCooldownTimer);
  candidateRefreshCooldownTimer = globalThis.setTimeout(() => {
    candidateRefreshCooldownTimer = null;
    renderMining();
  }, MINING_MUTATION_CLICK_COOLDOWN_MS);
  candidateRefreshMutationPending = true;
  if (candidateRefreshMutationTimer) globalThis.clearTimeout(candidateRefreshMutationTimer);
  candidateRefreshMutationTimer = globalThis.setTimeout(() => {
    if (!candidateRefreshMutationPending) return;
    finishCandidateRefreshMutation();
    renderMining();
    h.showToast?.("刷新响应超时，请确认现金和候选名单后再试。");
  }, 10_000);
  renderMining();
  socket.emit("miningRefreshCandidates", {
    candidateIds: (playerMining().recruitCandidates || []).map((candidate) => candidate.id)
  }, () => {
    finishCandidateRefreshMutation();
    renderMining();
  });
}

function finishMinerRosterMutation() {
  minerRosterMutationPending = false;
  if (minerRosterMutationTimer) globalThis.clearTimeout(minerRosterMutationTimer);
  minerRosterMutationTimer = null;
}

function mutateMinerRoster(eventName, payload) {
  if (minerRosterMutationPending || candidateRefreshMutationPending) {
    h.showToast?.("矿工名单正在更新，请稍候。");
    return;
  }
  minerRosterMutationPending = true;
  if (minerRosterMutationTimer) globalThis.clearTimeout(minerRosterMutationTimer);
  minerRosterMutationTimer = globalThis.setTimeout(() => {
    if (!minerRosterMutationPending) return;
    finishMinerRosterMutation();
    renderMining();
    h.showToast?.("矿工名单更新超时，请确认当前名单和现金后再试。");
  }, 10_000);
  renderMining();
  socket.emit(eventName, payload, () => {
    finishMinerRosterMutation();
    renderMining();
  });
}

function savePreferenceDraft() {
  if (preferenceMutationPending) return;
  const mining = stateMining();
  if (!mining.acceptingApplications || !mining.playerQualified) {
    restorePreferenceDraftFromServer();
    renderMining();
    return h.showToast?.("当前不在矿权志愿申请期。");
  }
  if (!preferenceDraft.length && !mining.myApplication) {
    renderMining();
    return;
  }

  beginPreferenceMutation();
  renderMining();
  const onSaved = (result = {}) => {
    finishPreferenceMutation();
    if (!result.ok) restorePreferenceDraftFromServer();
    else if (!preferenceDraft.length) pendingApplicationRound = 0;
    renderMining();
  };
  if (!preferenceDraft.length) {
    socket.emit("miningCancelApplication", {
      expectedRevision: Number(mining.myApplication?.revision) || 0
    }, onSaved);
    return;
  }
  socket.emit("miningApply", {
    preferences: [...preferenceDraft],
    allowFallback: allowFallbackDraft,
    expectedRevision: Number(mining.myApplication?.revision) || 0
  }, onSaved);
}

function finishMiningShiftMutation() {
  miningShiftMutationPending = false;
  if (miningShiftMutationTimer) globalThis.clearTimeout(miningShiftMutationTimer);
  miningShiftMutationTimer = null;
}

function beginMiningShiftMutation() {
  if (miningShiftMutationPending) {
    h.showToast?.("开工请求正在处理，请稍候。");
    return false;
  }
  miningShiftMutationPending = true;
  if (miningShiftMutationTimer) globalThis.clearTimeout(miningShiftMutationTimer);
  miningShiftMutationTimer = globalThis.setTimeout(() => {
    if (!miningShiftMutationPending) return;
    finishMiningShiftMutation();
    renderMining();
    h.showToast?.("开工响应超时，请确认当前班次状态后再试。");
  }, 10_000);
  renderMining();
  return true;
}

function progressCard(mining) {
  const required = Math.max(1, Number(mining.competitionRosterLimit || mining.requiredPlayers) || 1);
  const qualified = Math.max(0, Number(mining.competitionRosterSize ?? mining.qualifiedCount) || 0);
  const pct = Math.max(0, Math.min(100, Math.round((qualified / required) * 100)));
  const suspended = Number(mining.competitionSuspendedUntil || 0) > now();
  const personal = mining.playerQualified
    ? `<span class="mining-status-chip good">已进入竞租席位</span>`
    : suspended
      ? `<span class="mining-status-chip warn">席位已释放 · 候补第 ${esc(mining.waitlistPosition || "—")} 位</span>`
    : mining.milestoneQualified
      ? `<span class="mining-status-chip">候补第 ${esc(mining.waitlistPosition || "—")} 位</span>`
      : `<span class="mining-status-chip">个人门槛：声望 Lv.3（${esc(mining.requiredRep ?? 100)}）</span>`;
  return `
    <section class="mining-hero ${mining.unlocked ? "is-open" : "is-locked"}">
      <div>
        <p class="eyebrow">玉矿联合会 · 30 座矿山</p>
        <h3>${mining.unlocked ? mining.playerQualified ? "矿区已经开放" : suspended ? "竞租席位已释放" : "当前竞租席位已满" : "矿区筹备中"}</h3>
        <p>${mining.unlocked
          ? mining.playerQualified
            ? `每 ${duration(mining.leaseMs)} 轮换矿权；雇佣独立矿工，单次开采 ${duration(mining.shiftMs)}。`
            : suspended
              ? `连续未报名达到上限后会暂时退出竞租名单；暂停结束后按候补顺序重新排队。`
              : `竞租名单最多 ${required} 人；席位释放后，候补玩家会按排队顺序递补。`
          : `需要 ${required} 个有效竞租席位达到声望 Lv.3（${esc(mining.requiredRep ?? 100)}）；开放后每轮竞争 ${MINES.length} 座矿山。`}</p>
      </div>
      <div class="mining-unlock-meter" aria-label="竞租席位进度">
        <strong>${qualified} / ${required}</strong>
        <span class="mining-progress"><i style="width:${pct}%"></i></span>
        ${personal}
      </div>
    </section>
  `;
}

function rosterParticipationNotice(mining) {
  if (!mining.playerQualified) return "";
  const skippedRounds = Math.max(0, Number(mining.skippedApplicationRounds) || 0);
  if (!skippedRounds) return "";
  const maxSkippedRounds = Math.max(1, Number(mining.maxSkippedApplicationRounds) || 3);
  const applicationSaved = Boolean(mining.acceptingApplications && mining.myApplication);
  const critical = skippedRounds >= maxSkippedRounds - 1;
  const detail = applicationSaved
    ? "本轮志愿已经保存，统一分配后连续未报名记录会清零。"
    : mining.acceptingApplications
      ? critical
        ? "本轮申请截止前仍未报名，竞租席位将被释放，并转入候补队尾。"
        : "提交本轮志愿即可在统一分配后清除此记录。"
      : critical
        ? "下一轮仍未报名将释放竞租席位，并转入候补队尾。"
        : "达到连续未报名上限后，席位会让给候补玩家。";
  return `
    <section class="mining-roster-warning ${critical && !applicationSaved ? "is-critical" : ""}" role="status">
      <div>
        <strong>${applicationSaved ? "本轮已参赛，记录待清零" : "竞租席位参与提醒"}</strong>
        <span>连续未报名 ${skippedRounds}/${maxSkippedRounds} 轮</span>
      </div>
      <p>${detail}</p>
    </section>
  `;
}

function miningRecoveryNotice(mining) {
  const notice = mining.applicationRecoveryNotice;
  if (!notice) return "";
  return `
    <section class="mining-roster-warning mining-recovery-notice" role="status">
      <div>
        <strong>矿区停机恢复完成</strong>
        <span>第 ${Number(notice.roundNumber) || 0} 轮申请已退款</span>
      </div>
      <p>${esc(notice.message || `冻结款 ${money(notice.refund)} 已全额退回，请重新提交志愿。`)}</p>
    </section>
  `;
}

function competitionInsightsPanel(mining) {
  const insights = mining.competitionInsights || {};
  const rounds = Array.isArray(insights.recentRounds) ? insights.recentRounds : [];
  const heat = Array.isArray(insights.mineHeat) ? insights.mineHeat : [];
  const healthAlerts = Array.isArray(insights.healthAlerts) ? insights.healthAlerts : [];
  const currentRosterSize = Math.max(0, Number(insights.currentRosterSize) || 0);
  const currentApplicantCount = Math.max(0, Number(insights.currentApplicantCount) || 0);
  const recentRoundCount = Math.max(0, Number(insights.recentRoundCount) || 0);
  const waitlistCount = Math.max(0, Number(insights.waitlistCount) || 0);
  const averageWaitMs = Math.max(0, Number(insights.averageWaitMs) || 0);
  const summary = mining.acceptingApplications
    ? `第 ${Number(insights.currentTargetRound) || "—"} 轮已报名 ${currentApplicantCount}/${currentRosterSize}`
    : recentRoundCount
      ? `近 ${recentRoundCount} 轮报名率 ${percent(insights.recentParticipationRate)}`
      : "首轮结算后生成趋势";
  const maxHeat = Math.max(1, ...heat.map((entry) => Number(entry.applicantCount) || 0));
  return `
    <details class="mining-competition-insights" ${competitionInsightsOpen ? "open" : ""}>
      <summary>
        <span><strong>竞租数据</strong>${healthAlerts.length ? `<mark>${healthAlerts.length} 项预警</mark>` : ""}<small>${esc(summary)}</small></span>
        <b><span class="when-closed">展开查看</span><span class="when-open">收起</span></b>
      </summary>
      <div class="mining-insights-body">
        <section class="mining-insight-metrics" aria-label="竞租核心数据">
          <div><span>${mining.acceptingApplications ? "本轮报名率" : "近期报名率"}</span><strong>${percent(mining.acceptingApplications ? insights.currentParticipationRate : insights.recentParticipationRate)}</strong><small>${mining.acceptingApplications ? `${currentApplicantCount}/${currentRosterSize} 个席位已提交` : `统计近 ${recentRoundCount} 轮`}</small></div>
          <div><span>近期中选率</span><strong>${percent(insights.recentWinRate)}</strong><small>中选人数 ÷ 报名人数</small></div>
          <div><span>当前候补</span><strong>${waitlistCount}</strong><small>${waitlistCount ? `平均已等待 ${duration(averageWaitMs)}` : "目前没有候补玩家"}</small></div>
          <div><span>席位释放率</span><strong>${percent(insights.recentReleaseRate)}</strong><small>近轮释放 ${Number(insights.recentReleaseCount) || 0} 个席位</small></div>
        </section>
        <section class="mining-health-advice ${healthAlerts.length ? "has-alerts" : "is-healthy"}" aria-label="数值健康建议">
          <header>
            <div><strong>数值健康建议</strong><span>仅诊断，不会自动改规则</span></div>
            <b>${healthAlerts.length ? `${healthAlerts.length} 项需关注` : recentRoundCount < 3 ? "数据积累中" : "当前健康"}</b>
          </header>
          ${healthAlerts.length ? healthAlerts.map((alert) => {
            const severity = alert?.severity === "critical" ? "critical" : "warning";
            return `
              <article class="is-${severity}">
                <div><strong>${esc(alert?.title || "数值异常")}</strong><em>${severity === "critical" ? "优先处理" : "建议观察"}</em></div>
                <span>${esc(alert?.metricLabel || "")}</span>
                <p>${esc(alert?.detail || "")}</p>
                <small><b>建议</b>${esc(alert?.recommendation || "继续观察后续轮次。")}</small>
              </article>
            `;
          }).join("") : `<p>${recentRoundCount < 3 ? "至少积累 3 轮结算数据后启用趋势预警；本轮志愿集中度仍会实时检查。" : "近期报名、候补、志愿分布和席位释放均在建议区间内。"}</p>`}
        </section>
        ${heat.length ? `
          <section class="mining-heat-list" aria-label="本轮热门矿洞">
            <header><strong>本轮热门矿洞</strong><span>按志愿人数统计</span></header>
            ${heat.map((entry, index) => {
              const mine = miningMineById(entry.mineId);
              const count = Math.max(0, Number(entry.applicantCount) || 0);
              return `<div><span>${index + 1}. ${esc(mine?.name || entry.mineId)}</span><i><b style="width:${Math.max(6, Math.round((count / maxHeat) * 100))}%"></b></i><em>${count} 人</em></div>`;
            }).join("")}
          </section>
        ` : ""}
        <section class="mining-round-trends" aria-label="近期竞租趋势">
          <header><strong>近期轮次</strong><span>最多保留 6 轮</span></header>
          ${rounds.length ? rounds.map((entry) => `
            <div>
              <b>第 ${Number(entry.roundNumber) || 0} 轮</b>
              <span>报名 ${Number(entry.applicantCount) || 0}/${Number(entry.rosterSize) || 0}</span>
              <span>中选 ${Number(entry.winnerCount) || 0}</span>
              <span>落选 ${Number(entry.missedCount) || 0}</span>
              <span>释放 ${Number(entry.rosterReleasedCount) || 0}</span>
            </div>
          `).join("") : `<p>暂无已结算轮次，首轮分配后会在这里生成趋势。</p>`}
        </section>
      </div>
    </details>
  `;
}

function miningEconomyPanel(mining) {
  const insights = mining.economyInsights || {};
  const alerts = Array.isArray(insights.alerts) ? insights.alerts : [];
  const benchmarks = Array.isArray(insights.benchmarkBands) ? insights.benchmarkBands : [];
  const recentBands = Array.isArray(insights.recentBands) ? insights.recentBands : [];
  const recentShiftCount = Math.max(0, Number(insights.recentShiftCount) || 0);
  const leaseUtilization = insights.leaseUtilization == null
    ? null
    : Math.max(0, Number(insights.leaseUtilization) || 0);
  const maxBenchmarkNet = Math.max(1, ...benchmarks.map((entry) => Math.max(0, Number(entry.expectedNet) || 0)));
  const summary = recentShiftCount
    ? `近 ${recentShiftCount} 班估算净收益 ${money(insights.estimatedNet)} · 净收益率 ${signedPercent(insights.margin)}`
    : `矿洞基准差距 ${Number(insights.benchmarkNetSpread) || 0} 倍 · 开采后生成个人数据`;
  return `
    <details class="mining-economy-insights" ${economyInsightsOpen ? "open" : ""}>
      <summary>
        <span><strong>开采收益健康</strong>${alerts.length ? `<mark>${alerts.length} 项预警</mark>` : ""}<small>${esc(summary)}</small></span>
        <b><span class="when-closed">展开查看</span><span class="when-open">收起</span></b>
      </summary>
      <div class="mining-economy-body">
        <section class="mining-economy-metrics" aria-label="开采收益核心指标">
          <div><span>估算产值</span><strong>${recentShiftCount ? money(insights.estimatedOutputValue) : "—"}</strong><small>近 ${recentShiftCount} 班公开概率估算</small></div>
          <div><span>分摊总成本</span><strong>${recentShiftCount ? money(insights.allInCost) : "—"}</strong><small>班次 ${money(insights.operatingCost)} + 租金 ${money(insights.allocatedRent)}</small></div>
          <div class="${Number(insights.estimatedNet) < 0 ? "is-negative" : ""}"><span>估算净收益</span><strong>${recentShiftCount ? money(insights.estimatedNet) : "—"}</strong><small>${recentShiftCount ? `净收益率 ${signedPercent(insights.margin)}` : "至少完成 1 班后显示"}</small></div>
          <div><span>结束租期利用率</span><strong>${leaseUtilization == null ? "—" : percent(leaseUtilization)}</strong><small>${Number(insights.settledLeaseCount) ? `${Number(insights.leaseUsedShifts) || 0}/${Number(insights.leaseCapacityShifts) || 0} 班已使用` : "至少结束 1 个租期后显示"}</small></div>
        </section>
        <p class="mining-economy-note">${esc(insights.estimationNote || "产值仅按公开概率估算，不读取原石隐藏品质，也不代表最终成交价。")}</p>
        <section class="mining-economy-alerts ${alerts.length ? "has-alerts" : "is-healthy"}" aria-label="收益健康建议">
          <header><strong>收益调参建议</strong><span>${alerts.length ? `${alerts.length} 项需关注` : recentShiftCount < 3 ? "数据积累中" : "当前健康"}</span></header>
          ${alerts.length ? alerts.map((alert) => {
            const severity = alert?.severity === "critical" ? "critical" : "warning";
            return `
              <article class="is-${severity}">
                <div><strong>${esc(alert?.title || "收益异常")}</strong><em>${severity === "critical" ? "优先处理" : "建议观察"}</em></div>
                <span>${esc(alert?.metricLabel || "")}</span>
                <small><b>建议</b>${esc(alert?.recommendation || "继续观察后续班次。")}</small>
              </article>
            `;
          }).join("") : `<p>${recentShiftCount < 3 ? "积累至少 3 个班次后启用个人收益率预警；矿洞基准差距会持续检查。" : "近期收益率、亏损班次、租期利用率和矿洞差距均在建议区间内。"}</p>`}
        </section>
        <div class="mining-economy-comparison">
          <section class="mining-benchmark-bands" aria-label="矿带基准收益">
            <header><strong>五档矿带基准</strong><span>单普通矿工 · 满租期</span></header>
            ${benchmarks.map((entry) => {
              const net = Number(entry.expectedNet) || 0;
              return `
                <div>
                  <span>${esc(entry.beltLabel || entry.beltId)}</span>
                  <i><b style="width:${Math.max(5, Math.round((Math.max(0, net) / maxBenchmarkNet) * 100))}%"></b></i>
                  <em>${money(net)}<small>${signedPercent(entry.margin)}</small></em>
                </div>
              `;
            }).join("")}
            <p>单矿洞最高与最低基准净收益相差 <b>${Number(insights.benchmarkNetSpread) || 0} 倍</b>，建议上限 ${Number(insights.benchmarkMaxNetSpread) || 0} 倍。</p>
          </section>
          <section class="mining-recent-bands" aria-label="近期矿带收益">
            <header><strong>个人近期矿带</strong><span>最多统计 12 班</span></header>
            ${recentBands.length ? recentBands.map((entry) => `
              <div>
                <span>${esc(entry.beltLabel || entry.beltId)} · ${Number(entry.shiftCount) || 0} 班</span>
                <strong>${money(entry.estimatedNet)}</strong>
                <small>均班 ${money(entry.averageNet)} · ${signedPercent(entry.margin)}</small>
              </div>
            `).join("") : `<p>完成开采后，这里会按矿带汇总估算净收益。</p>`}
          </section>
        </div>
      </div>
    </details>
  `;
}

function miningWorldEconomyPanel(mining) {
  const report = mining.worldEconomyReport || {};
  const alerts = Array.isArray(report.alerts) ? report.alerts : [];
  const belts = Array.isArray(report.belts) ? report.belts : [];
  const rounds = Array.isArray(report.rounds) ? report.rounds : [];
  const shiftCount = Math.max(0, Number(report.shiftCount) || 0);
  const playerCount = Math.max(0, Number(report.uniquePlayerCount) || 0);
  const roundCount = Math.max(0, Number(report.recentRoundCount) || 0);
  const utilization = report.utilization == null ? null : Math.max(0, Number(report.utilization) || 0);
  const sampleReady = report.sampleReady === true;
  const sampleProgress = Math.max(0, Math.min(1, Number(report.sampleProgress) || 0));
  const summary = sampleReady
    ? `近 ${roundCount} 轮全服净收益 ${money(report.estimatedNet)} · 全租金口径 ${signedPercent(report.margin)}`
    : `样本采集中 · ${roundCount}/${Number(report.minimumRounds) || 3} 轮 · ${shiftCount}/${Number(report.minimumShifts) || 30} 班 · ${playerCount}/${Number(report.minimumPlayers) || 5} 人`;
  return `
    <details class="mining-world-economy" ${worldEconomyReportOpen ? "open" : ""}>
      <summary>
        <span><strong>全服轮次经济</strong>${sampleReady && alerts.length ? `<mark>${alerts.length} 项预警</mark>` : ""}<small>${esc(summary)}</small></span>
        <b><span class="when-closed">展开查看</span><span class="when-open">收起</span></b>
      </summary>
      <div class="mining-world-economy-body">
        <section class="mining-world-sample ${sampleReady ? "is-ready" : "is-collecting"}" aria-label="全服经济样本门槛">
          <header><div><strong>${sampleReady ? "样本已达标" : "样本采集中"}</strong><span>${sampleReady ? "已启用系统级调参建议" : "未达标前不输出系统级结论"}</span></div><b>${Math.round(sampleProgress * 100)}%</b></header>
          <i><b style="width:${Math.round(sampleProgress * 100)}%"></b></i>
          <div><span>轮次 ${roundCount}/${Number(report.minimumRounds) || 3}</span><span>班次 ${shiftCount}/${Number(report.minimumShifts) || 30}</span><span>玩家 ${playerCount}/${Number(report.minimumPlayers) || 5}</span></div>
        </section>
        <section class="mining-world-metrics" aria-label="全服经济核心指标">
          <div><span>全服估算产值</span><strong>${shiftCount ? money(report.estimatedOutputValue) : "—"}</strong><small>最近 ${roundCount} 个结束轮次</small></div>
          <div><span>实际总成本</span><strong>${rounds.length ? money(report.allInCost) : "—"}</strong><small>班次 ${money(report.operatingCost)} + 全部租金 ${money(report.rentCost)}</small></div>
          <div class="${Number(report.estimatedNet) < 0 ? "is-negative" : ""}"><span>全服估算净收益</span><strong>${rounds.length ? money(report.estimatedNet) : "—"}</strong><small>${rounds.length ? `净收益率 ${signedPercent(report.margin)}` : "轮次结束后生成"}</small></div>
          <div><span>租约利用率</span><strong>${utilization == null ? "—" : percent(utilization)}</strong><small>${Number(report.capacityShifts) ? `${Number(report.usedShifts) || 0}/${Number(report.capacityShifts) || 0} 班已开工` : "暂无结束租约"}</small></div>
        </section>
        <p class="mining-world-note">${esc(report.estimationNote || "只按公开概率估算产值；成本采用全租金口径。")}</p>
        <section class="mining-world-alerts ${sampleReady && alerts.length ? "has-alerts" : sampleReady ? "is-healthy" : "is-collecting"}" aria-label="全服调参建议">
          <header><strong>系统级调参建议</strong><span>${!sampleReady ? "等待样本达标" : alerts.length ? `${alerts.length} 项需关注` : "当前健康"}</span></header>
          ${!sampleReady ? `<p>至少积累 ${Number(report.minimumRounds) || 3} 个结束轮次、${Number(report.minimumShifts) || 30} 个班次和 ${Number(report.minimumPlayers) || 5} 名实际开采玩家后，再判断是否需要改租金或产出。</p>` : alerts.length ? alerts.map((alert) => {
            const severity = alert?.severity === "critical" ? "critical" : "warning";
            return `
              <article class="is-${severity}">
                <div><strong>${esc(alert?.title || "全服经济异常")}</strong><em>${severity === "critical" ? "优先处理" : "建议观察"}</em></div>
                <span>${esc(alert?.metricLabel || "")}</span>
                <small><b>建议</b>${esc(alert?.recommendation || "继续观察后续轮次。")}</small>
              </article>
            `;
          }).join("") : `<p>全服利润、租约利用率以及各矿带相对自身基准的表现均在建议区间内。</p>`}
        </section>
        <section class="mining-world-belts" aria-label="全服矿带表现">
          <header><strong>矿带实际表现</strong><span>至少 ${Number(report.minimumBeltShifts) || 8} 班才给单矿带建议</span></header>
          ${belts.map((belt) => {
            const performance = belt.performanceIndex == null ? null : Number(belt.performanceIndex);
            return `
              <article class="${belt.qualifiedForTuning ? "is-qualified" : "is-collecting"}">
                <div><strong>${esc(belt.beltLabel || belt.beltId)}</strong><span>${Number(belt.shiftCount) || 0} 班 · ${Number(belt.leaseCount) || 0} 份租约</span></div>
                <dl>
                  <div><dt>产值达成</dt><dd>${performance == null ? "—" : percent(performance)}</dd></div>
                  <div><dt>全租金利润率</dt><dd>${Number(belt.shiftCount) || Number(belt.leaseCount) ? signedPercent(belt.margin) : "—"}</dd></div>
                  <div><dt>利用率</dt><dd>${belt.utilization == null ? "—" : percent(belt.utilization)}</dd></div>
                </dl>
                <p>${esc(belt.tuningAdvice || "继续积累数据。")}</p>
              </article>
            `;
          }).join("")}
        </section>
        <section class="mining-world-rounds" aria-label="全服近期轮次经济">
          <header><strong>近期结束轮次</strong><span>最多保留 6 轮</span></header>
          ${rounds.length ? rounds.map((round) => `
            <div>
              <b>第 ${Number(round.roundNumber) || 0} 轮</b>
              <span>${Number(round.playerCount) || 0} 人 · ${Number(round.shiftCount) || 0} 班</span>
              <span>利用率 ${round.utilization == null ? "—" : percent(round.utilization)}</span>
              <strong class="${Number(round.estimatedNet) < 0 ? "is-negative" : ""}">${money(round.estimatedNet)}</strong>
            </div>
          `).join("") : `<p>暂无结束轮次；当前租期结束后会生成第一份全服轮次报表。</p>`}
        </section>
      </div>
    </details>
  `;
}

function miningTuningSandboxPanel(mining) {
  const sandbox = mining.economyTuningSandbox || {};
  const bands = Array.isArray(sandbox.bands) ? sandbox.bands : [];
  if (!bands.length) return "";
  if (!bands.some((band) => band.beltId === tuningSandboxBeltId)) {
    tuningSandboxBeltId = bands[0].beltId;
  }
  const band = bands.find((entry) => entry.beltId === tuningSandboxBeltId) || bands[0];
  const scenarios = Array.isArray(band.scenarios) ? band.scenarios : [];
  const fallbackScenarioId = band.recommendedScenarioId || "rent-5";
  if (!scenarios.some((scenario) => scenario.id === tuningSandboxScenarioId)) {
    tuningSandboxScenarioId = fallbackScenarioId;
  }
  const scenario = scenarios.find((entry) => entry.id === tuningSandboxScenarioId)
    || scenarios[0]
    || {};
  const recommended = Boolean(
    band.recommendedScenarioId
    && scenario.id === band.recommendedScenarioId
  );
  const stagedScenarioId = String(tuningDraftSelections[band.beltId] || "hold");
  const scenarioStaged = scenario.id !== "hold" && scenario.id === stagedScenarioId;
  const observed = band.source === "observed";
  const spreadChange = Number(scenario.spreadDelta) || 0;
  const summary = `${band.beltLabel} · ${scenario.label || "选择方案"} · 均班净收益 ${money(scenario.estimatedNet)}（${signedMoney(scenario.netDelta)}）`;
  return `
    <details class="mining-tuning-sandbox" ${tuningSandboxOpen ? "open" : ""}>
      <summary>
        <span><strong>数值调参沙盘</strong><small>${esc(summary)}</small></span>
        <b><span class="when-closed">展开模拟</span><span class="when-open">收起</span></b>
      </summary>
      <div class="mining-tuning-body">
        <header class="mining-tuning-head">
          <div><strong>选择矿带与方案</strong><span>${observed ? `使用近期 ${Number(band.shiftCount) || 0} 班全服表现` : "使用公开基准演算"}</span></div>
          <em>${sandbox.sampleReady ? "样本已达标" : "基准预演"}</em>
        </header>
        <div class="mining-tuning-belts" role="tablist" aria-label="选择模拟矿带">
          ${bands.map((entry) => {
            const staged = entry.scenarios?.find((item) => item.id === tuningDraftSelections[entry.beltId]);
            return `
              <button class="${entry.beltId === band.beltId ? "on" : ""} ${staged && staged.id !== "hold" ? "is-staged" : ""}" data-action="miningTuningBelt" data-payload="${esc(entry.beltId)}" type="button" role="tab" aria-selected="${entry.beltId === band.beltId}">
                <strong>${esc(entry.beltLabel)}</strong>
                <span>${staged && staged.id !== "hold" ? `草案：${esc(staged.label)}` : entry.source === "observed" ? `${Number(entry.shiftCount) || 0} 班实测` : "公开基准"}</span>
              </button>
            `;
          }).join("")}
        </div>
        <div class="mining-tuning-scenarios" role="tablist" aria-label="选择调参方案">
          ${scenarios.map((entry) => `
            <button class="${entry.id === scenario.id ? "on" : ""}" data-action="miningTuningScenario" data-payload="${esc(entry.id)}" type="button" role="tab" aria-selected="${entry.id === scenario.id}">
              ${esc(entry.label)}${band.recommendedScenarioId === entry.id ? " · 建议" : ""}
            </button>
          `).join("")}
        </div>
        <section class="mining-tuning-comparison" aria-label="调参前后对比">
          <article>
            <header><strong>当前口径</strong><span>${observed ? "近期全服均班" : "标准均班"}</span></header>
            <dl>
              <div><dt>估算产值</dt><dd>${money(band.outputPerShift)}</dd></div>
              <div><dt>租金分摊</dt><dd>${money(band.rentPerShift)}</dd></div>
              <div><dt>均班总成本</dt><dd>${money(band.allInCost)}</dd></div>
              <div><dt>均班净收益</dt><dd>${money(band.estimatedNet)}</dd></div>
              <div><dt>净收益率</dt><dd>${signedPercent(band.margin)}</dd></div>
            </dl>
          </article>
          <i aria-hidden="true">→</i>
          <article class="is-projected">
            <header><strong>${esc(scenario.label || "模拟方案")}</strong>${recommended ? "<span>系统建议</span>" : "<span>模拟结果</span>"}</header>
            <dl>
              <div><dt>估算产值</dt><dd>${money(scenario.outputPerShift)}</dd></div>
              <div><dt>租金分摊</dt><dd>${money(scenario.rentPerShift)}</dd></div>
              <div><dt>均班总成本</dt><dd>${money(scenario.allInCost)}</dd></div>
              <div><dt>均班净收益</dt><dd>${money(scenario.estimatedNet)} <small>${signedMoney(scenario.netDelta)}</small></dd></div>
              <div><dt>净收益率</dt><dd>${signedPercent(scenario.margin)} <small>${signedPercentagePoints(scenario.marginDelta)}</small></dd></div>
            </dl>
          </article>
        </section>
        <section class="mining-tuning-impact ${spreadChange > 0 ? "is-worse" : spreadChange < 0 ? "is-better" : ""}">
          <div><span>五矿带净收益差距</span><strong>${Number(sandbox.baselineSpread) || 0} 倍 → ${Number(scenario.projectedSpread) || 0} 倍</strong><small>健康上限 ${Number(sandbox.maxNetSpread) || 0} 倍</small></div>
          <p>${esc(band.recommendationReason || "继续积累样本后再决定是否调整。")}</p>
        </section>
        <div class="mining-tuning-stage-action">
          <span>${scenario.id === "hold" ? "保持现状不会加入组合草案。" : scenarioStaged ? "该方案已在下方组合草案中。" : "可先加入草案，再与其他矿带一起评估整体影响。"}</span>
          <button data-action="miningTuningDraftSet" data-payload="${esc(`${band.beltId}|${scenario.id || "hold"}`)}" type="button" ${scenario.id === "hold" || scenarioStaged ? "disabled" : ""}>
            ${scenario.id === "hold" ? "无需加入" : scenarioStaged ? "✓ 已加入草案" : stagedScenarioId !== "hold" ? "更新组合草案" : "加入组合草案"}
          </button>
        </div>
        <p class="mining-tuning-note">${esc(sandbox.note || "模拟结果仅供比较，不会自动修改正式数值。")}</p>
      </div>
    </details>
  `;
}

function miningTuningDraftPanel(mining) {
  const sandbox = mining.economyTuningSandbox || {};
  const bands = Array.isArray(sandbox.bands) ? sandbox.bands : [];
  if (!bands.length) return "";
  const draft = miningTuningDraftProjection(sandbox, tuningDraftSelections);
  const recommendedCount = bands.filter((band) => (
    band.recommendedScenarioId && band.recommendedScenarioId !== "hold"
  )).length;
  const summary = draft.changedCount
    ? `已选 ${draft.changedCount} 个矿带 · 组合净收益 ${money(draft.projected.estimatedNet)}（${signedMoney(draft.netDelta)}）`
    : "尚未加入方案 · 可从上方沙盘逐个加入";
  return `
    <details class="mining-tuning-draft is-${esc(draft.status)}" ${tuningDraftOpen ? "open" : ""}>
      <summary>
        <span><strong>多矿带组合草案</strong><small>${esc(summary)}</small></span>
        <span class="mining-tuning-draft-summary-actions">
          <mark>${esc(draft.statusLabel)}</mark>
          <b><span class="when-closed">展开草案</span><span class="when-open">收起</span></b>
        </span>
      </summary>
      <div class="mining-tuning-draft-body">
        <header class="mining-tuning-draft-head">
          <div>
            <strong>一次只验证少量变量</strong>
            <span>每个矿带按 1 个代表性均班合并，建议一次最多调整 2 个矿带。</span>
          </div>
          <div class="mining-tuning-draft-actions">
            <button data-action="miningTuningExperimentSave" type="button" ${!draft.changedCount || draft.changedCount > 2 || tuningExperimentMutationPending ? "disabled" : ""}>${tuningExperimentMutationPending ? "正在保存…" : "保存影子观察"}</button>
            <button data-action="miningTuningDraftRecommended" type="button" ${!sandbox.sampleReady || !recommendedCount ? "disabled" : ""}>采用系统建议</button>
            <button data-action="miningTuningDraftClear" type="button" ${!draft.changedCount ? "disabled" : ""}>清空草案</button>
          </div>
        </header>
        <section class="mining-tuning-draft-picks" aria-label="已选调参方案">
          ${draft.changedRows.length ? draft.changedRows.map((row) => `
            <article>
              <div>
                <strong>${esc(row.beltLabel)}</strong>
                <span>${esc(row.scenarioLabel)}</span>
              </div>
              <dl>
                <div><dt>产出</dt><dd>${row.outputDelta ? signedPercent(row.outputDelta) : "不变"}</dd></div>
                <div><dt>租金</dt><dd>${row.rentDelta ? signedPercent(row.rentDelta) : "不变"}</dd></div>
                <div><dt>净收益</dt><dd>${money(row.baseline.estimatedNet)} → ${money(row.projected.estimatedNet)} <small>${signedMoney(row.netDelta)}</small></dd></div>
              </dl>
              <button data-action="miningTuningDraftRemove" data-payload="${esc(row.beltId)}" type="button" aria-label="移除${esc(row.beltLabel)}方案">移除</button>
            </article>
          `).join("") : `
            <p>草案还是空的。请在上方选择矿带和模拟方案，再点击“加入组合草案”。</p>
          `}
        </section>
        <section class="mining-tuning-draft-comparison" aria-label="组合草案前后对比">
          <header><strong>五矿带代表组合</strong><span>每个矿带各取 1 个均班，不等同于全服总流水</span></header>
          <div>
            <article>
              <span>当前组合</span>
              <dl>
                <div><dt>产值</dt><dd>${money(draft.baseline.outputPerShift)}</dd></div>
                <div><dt>总成本</dt><dd>${money(draft.baseline.allInCost)}</dd></div>
                <div><dt>净收益</dt><dd>${money(draft.baseline.estimatedNet)}</dd></div>
                <div><dt>净收益率</dt><dd>${signedPercent(draft.baseline.margin)}</dd></div>
                <div><dt>矿带差距</dt><dd>${Number(draft.baseline.spread) || 0} 倍</dd></div>
              </dl>
            </article>
            <i aria-hidden="true">→</i>
            <article class="is-projected">
              <span>草案组合</span>
              <dl>
                <div><dt>产值</dt><dd>${money(draft.projected.outputPerShift)}</dd></div>
                <div><dt>总成本</dt><dd>${money(draft.projected.allInCost)}</dd></div>
                <div><dt>净收益</dt><dd>${money(draft.projected.estimatedNet)} <small>${draft.changedCount ? signedMoney(draft.netDelta) : "不变"}</small></dd></div>
                <div><dt>净收益率</dt><dd>${signedPercent(draft.projected.margin)} <small>${draft.changedCount ? signedPercentagePoints(draft.marginDelta) : "不变"}</small></dd></div>
                <div><dt>矿带差距</dt><dd>${Number(draft.projected.spread) || 0} 倍 <small>${draft.spreadDelta ? `${draft.spreadDelta > 0 ? "+" : "−"}${Math.abs(Number(draft.spreadDelta.toFixed(2)))} 倍` : "不变"}</small></dd></div>
              </dl>
            </article>
          </div>
        </section>
        <section class="mining-tuning-guardrails" aria-label="草案安全检查">
          <header><strong>安全检查</strong><span>${draft.issues.length ? `${draft.issues.length} 项需要留意` : draft.changedCount ? "未触发风险线" : "等待加入方案"}</span></header>
          ${draft.issues.length ? draft.issues.map((issue) => `
            <article class="is-${esc(issue.severity)}">
              <strong>${esc(issue.title)}</strong>
              <p>${esc(issue.message)}</p>
            </article>
          `).join("") : draft.changedCount ? `
            <article class="is-safe"><strong>调整范围可控</strong><p>样本、改动数量、组合收益和矿带差距均未越过当前安全线，可先进入一轮观察期。</p></article>
          ` : `<p>加入方案后，将检查样本成熟度、同时改动数量、整体收益放宽幅度和矿带差距。</p>`}
        </section>
        <p class="mining-tuning-note">${esc(draft.note)}</p>
      </div>
    </details>
  `;
}

function miningTuningGovernancePanel(mining) {
  const governance = mining.tuningGovernance || {};
  const active = governance.activeVersion || null;
  const pending = governance.pendingVersion || null;
  const versions = Array.isArray(governance.versions) ? governance.versions : [];
  const effect = active?.effectReport || null;
  const effectAssessment = effect?.assessment || {};
  const effectProgress = effect
    ? Math.max(0, Math.min(1,
      (Number(effect.observedRoundCount) || 0) / Math.max(1, Number(effect.targetRoundCount) || 3)
    ))
    : 0;
  const versionRows = (version) => (version?.rows || []).map((row) => (
    `${row.beltLabel} · ${row.scenarioLabel}`
  )).join(" / ") || "恢复初始数值";
  return `
    <section class="mining-tuning-governance" aria-label="正式数值版本">
      <header>
        <div>
          <strong>正式数值版本</strong>
          <span>${active ? `当前 V${Number(active.number) || 0}` : "当前为初始数值"}${pending ? ` · V${Number(pending.number) || 0} 待生效` : ""}</span>
        </div>
        <em>轮次边界生效</em>
      </header>
      <div class="mining-tuning-governance-access ${governance.canManage ? "is-reviewer" : "is-readonly"}">
        <div>
          <strong>矿务数值审核</strong>
          <span>${governance.reviewerPlayerNames?.length ? `审核员：${esc(governance.reviewerPlayerNames.join("、"))}` : governance.reviewerMode === "configured" ? "审核账号由服务器配置" : "矿区开放后由首位创始成员担任"}</span>
        </div>
        <mark>${governance.canManage ? "你有审核权限" : "只读"}</mark>
      </div>
      <div class="mining-tuning-governance-current">
        <article class="${active ? "is-active" : "is-empty"}">
          <span>正在生效</span>
          <strong>${active ? `V${Number(active.number) || 0} · ${active.kind === "rollback" ? "回滚版本" : "数值调整"}` : "初始版本"}</strong>
          <p>${active ? esc(versionRows(active)) : "所有矿带使用公开基准租金与产出。"}</p>
          ${active ? `<small>第 ${Number(active.activatedRoundNumber) || Number(active.scheduledRoundNumber) || 0} 轮起生效 · 审核人 ${esc(active.createdByPlayerName || "未知")}</small>` : ""}
          ${governance.canManage && active && !pending ? `<button class="${effectAssessment.id === "rollback-recommended" ? "is-critical" : ""}" data-action="miningTuningRollback" data-payload="${esc(active.id)}" type="button" ${tuningGovernanceMutationPending ? "disabled" : ""}>${tuningGovernanceMutationPending ? "正在建立回滚…" : effectAssessment.id === "rollback-recommended" ? "按建议安排安全回滚" : "安排安全回滚"}</button>` : ""}
        </article>
        <i aria-hidden="true">→</i>
        <article class="${pending ? "is-pending" : "is-empty"}">
          <span>待生效排期</span>
          <strong>${pending ? `V${Number(pending.number) || 0} · ${pending.kind === "rollback" ? "回滚版本" : "审核版本"}` : "暂无待生效版本"}</strong>
          <p>${pending ? esc(versionRows(pending)) : "新的正式版本只能由校准通过的观察记录生成。"}</p>
          ${pending ? `<small>计划第 ${Number(pending.scheduledRoundNumber) || 0} 轮生效 · 当前租期保持不变</small>` : ""}
          ${governance.canManage && pending ? `<button data-action="miningTuningCancelVersion" data-payload="${esc(pending.id)}" type="button" ${tuningGovernanceMutationPending ? "disabled" : ""}>撤销排期</button>` : ""}
        </article>
      </div>
      ${effect ? `<section class="mining-tuning-effect is-${esc(effectAssessment.tone || "neutral")}" aria-label="生效后效果追踪">
        <header>
          <div><strong>生效后效果追踪</strong><span>固定观察正式版本生效后的 3 个完整轮次</span></div>
          <mark>${esc(effectAssessment.label || effect.statusLabel || "跟踪中")}</mark>
        </header>
        <div class="mining-tuning-effect-progress">
          <span><i style="width:${Math.round(effectProgress * 100)}%"></i></span>
          <b>${Number(effect.observedRoundCount) || 0}/${Number(effect.targetRoundCount) || 3} 轮</b>
          <small>${Number(effect.minimumSelectedBeltShifts) || 0}/${Number(effect.requiredSelectedBeltShifts) || 8} 班最低矿带样本</small>
        </div>
        <div class="mining-tuning-effect-metrics">
          <article>
            <span>所选矿带净收益</span>
            <strong>${effect.actual ? money(effect.actual.estimatedNet) : "等待样本"}</strong>
            <small>${effect.baseline && effect.actual ? `生效前 ${money(effect.baseline.estimatedNet)} · ${signedMoney(effect.netDeltaFromBaseline)}` : "暂无可比基线"}</small>
          </article>
          <article>
            <span>实际净收益率</span>
            <strong>${effect.actual ? signedPercent(effect.actual.margin) : "等待样本"}</strong>
            <small>${effect.baseline && effect.actual ? `生效前 ${signedPercent(effect.baseline.margin)} · ${signedPercentagePoints(effect.marginDeltaFromBaseline)}` : "安全线 20%"}</small>
          </article>
          <article>
            <span>五矿带实际差距</span>
            <strong>${effect.actualSpread == null ? "样本未齐" : `${Number(effect.actualSpread) || 0} 倍`}</strong>
            <small>安全线上限 5 倍</small>
          </article>
        </div>
        ${(effect.rows || []).length ? `<div class="mining-tuning-effect-rows">
          ${(effect.rows || []).map((row) => `<div>
            <strong>${esc(row.beltLabel)}</strong>
            <span>${Number(row.shiftCount) || 0} 班</span>
            <p>${row.actual ? `净收益 ${money(row.actual.estimatedNet)}${row.baseline ? ` · 较生效前 ${signedMoney(row.netDeltaFromBaseline)}` : ""}` : "等待该矿带样本"}</p>
          </div>`).join("")}
        </div>` : ""}
        <div class="mining-tuning-effect-assessment">
          <strong>${esc(effectAssessment.summary || effect.note || "正在收集生效后表现。")}</strong>
          ${(effectAssessment.reasons || []).length ? `<ul>${effectAssessment.reasons.map((reason) => `<li>${esc(reason)}</li>`).join("")}</ul>` : ""}
          <small>只提示风险，不会自动回滚。该结果反映观察关联，不等同于因果证明。</small>
        </div>
      </section>` : ""}
      ${versions.length ? `<div class="mining-tuning-version-history" role="list" aria-label="版本审计记录">
        ${versions.map((version) => `<div role="listitem">
          <strong>V${Number(version.number) || 0}</strong>
          <span>${esc(version.kind === "rollback" ? "回滚" : "调整")}</span>
          <p>${esc(versionRows(version))}</p>
          <mark class="is-${esc(version.status)}">${esc(version.statusLabel || version.status)}</mark>
          <small class="is-${esc(version.effectReport?.assessment?.tone || "neutral")}">${version.effectReport ? `效果归档：${esc(version.effectReport.assessment?.label || version.effectReport.statusLabel || "已完成")} · ${Number(version.effectReport.observedRoundCount) || 0}/${Number(version.effectReport.targetRoundCount) || 3} 轮 · ${esc(version.effectReport.assessment?.summary || version.effectReport.note || "")}` : version.status === "active" ? "效果归档：正在收集独立生效轮次" : "效果归档：尚无结果"}</small>
        </div>`).join("")}
      </div>` : `<p class="mining-empty-copy">尚无正式版本记录。完成三轮观察并通过模型校准后，可由记录卡片进入人工审核。</p>`}
      <p class="mining-tuning-note">${esc(governance.policyNote || "正式版本只在下一轮边界生效；每次调整和回滚都会保留记录。")}</p>
    </section>
  `;
}

function miningTuningExperimentsPanel(mining) {
  const experiments = Array.isArray(mining.tuningExperiments) ? mining.tuningExperiments : [];
  const draftStatusLabels = {
    "benchmark-only": "基准草案",
    "needs-review": "起草需复核",
    ready: "起草风险可控"
  };
  const latest = experiments[0] || null;
  const summary = latest
    ? `${experiments.length} 份记录 · 最新 ${Number(latest.observedRoundCount) || 0}/${Number(latest.targetRoundCount) || 3} 轮 · ${latest.statusLabel || "观察中"}`
    : "尚无记录 · 从组合草案保存一份影子观察";
  return `
    <details class="mining-tuning-experiments" ${tuningExperimentsOpen ? "open" : ""}>
      <summary>
        <span><strong>影子观察记录</strong><small>${esc(summary)}</small></span>
        <b><span class="when-closed">展开记录</span><span class="when-open">收起</span></b>
      </summary>
      <div class="mining-tuning-experiments-body">
        <header>
          <div><strong>预测与后续实况</strong><span>每份记录固定观察保存后的 3 个结束轮次</span></div>
          <em>不套用参数</em>
        </header>
        ${experiments.length > 1 ? `<section class="mining-tuning-experiment-compare" aria-label="影子观察横向比较">
          <header><strong>记录横向比较</strong><span>只比较模型风险与预测偏差，不代表方案收益排名</span></header>
          <div role="table">
            <div role="row" class="is-head"><span>方案</span><span>起草状态</span><span>净收益偏差</span><span>校准结论</span></div>
            ${experiments.map((experiment) => {
              const netErrorRate = experiment.assessment?.metrics?.netErrorRate;
              return `<div role="row">
                <strong data-label="方案">${esc((experiment.rows || []).map((row) => `${row.beltLabel}·${row.scenarioLabel}`).join(" / "))}</strong>
                <span data-label="起草状态">${esc(draftStatusLabels[experiment.draftStatus] || "待复核")}</span>
                <b data-label="净收益偏差">${netErrorRate == null ? "—" : `${Math.round(Number(netErrorRate) * 1000) / 10}%`}</b>
                <mark data-label="校准结论" class="is-${esc(experiment.assessment?.tone || "neutral")}">${esc(experiment.assessment?.label || "等待观察完成")}</mark>
              </div>`;
            }).join("")}
          </div>
        </section>` : ""}
        ${experiments.length ? `<div class="mining-tuning-experiment-list">
          ${experiments.map((experiment) => {
            const complete = experiment.status === "complete";
            const insufficient = experiment.status === "insufficient";
            const actual = experiment.actual || null;
            const assessment = experiment.assessment || {};
            const governanceRecord = experiment.governance || null;
            const progress = Math.max(0, Math.min(1,
              (Number(experiment.observedRoundCount) || 0) / Math.max(1, Number(experiment.targetRoundCount) || 3)
            ));
            return `
              <article class="is-${esc(experiment.status || "collecting")}">
                <header>
                  <div>
                    <strong>${esc((experiment.rows || []).map((row) => `${row.beltLabel} · ${row.scenarioLabel}`).join(" / "))}</strong>
                    <span>${new Date(Number(experiment.createdAt) || 0).toLocaleString("zh-CN")} · 从第 ${Number(experiment.baselineRoundNumber) || 0} 轮后开始</span>
                  </div>
                  <mark>${esc(experiment.statusLabel || "观察中")}</mark>
                </header>
                <div class="mining-tuning-experiment-progress">
                  <span><i style="width:${Math.round(progress * 100)}%"></i></span>
                  <b>${Number(experiment.observedRoundCount) || 0}/${Number(experiment.targetRoundCount) || 3} 轮</b>
                  <small>${Number(experiment.minimumSelectedBeltShifts) || 0}/${Number(experiment.requiredSelectedBeltShifts) || 8} 班最低矿带样本</small>
                </div>
                <section class="mining-tuning-experiment-metrics">
                  <div>
                    <span>草案预测</span>
                    <dl>
                      <div><dt>所选矿带均班净收益</dt><dd>${money(experiment.forecast?.estimatedNet)}</dd></div>
                      <div><dt>所选矿带净收益率</dt><dd>${signedPercent(experiment.forecast?.margin)}</dd></div>
                      <div><dt>五矿带预测差距</dt><dd>${Number(experiment.forecastSpread) || 0} 倍</dd></div>
                    </dl>
                  </div>
                  <i aria-hidden="true">→</i>
                  <div class="is-actual">
                    <span>${complete ? "三轮实况" : actual ? "阶段实况" : "等待实况"}</span>
                    ${actual ? `<dl>
                      <div><dt>所选矿带均班净收益</dt><dd>${money(actual.estimatedNet)} <small>${signedMoney(experiment.netDelta)}</small></dd></div>
                      <div><dt>所选矿带净收益率</dt><dd>${signedPercent(actual.margin)} <small>${signedPercentagePoints(experiment.marginDelta)}</small></dd></div>
                      <div><dt>五矿带实际差距</dt><dd>${experiment.actualSpread == null ? "样本未齐" : `${Number(experiment.actualSpread) || 0} 倍`}</dd></div>
                    </dl>` : `<p>结束新一轮且所选矿带产生班次后，将显示阶段对比。</p>`}
                  </div>
                </section>
                <section class="mining-tuning-experiment-assessment is-${esc(assessment.tone || "neutral")}">
                  <header><strong>模型校准结论</strong><mark>${esc(assessment.label || "等待观察完成")}</mark></header>
                  <p>${esc(assessment.summary || "当前尚未生成校准结论。")}</p>
                  ${(assessment.reasons || []).length ? `<ul>${assessment.reasons.map((reason) => `<li>${esc(reason)}</li>`).join("")}</ul>` : ""}
                  ${governanceRecord ? `<div class="mining-tuning-review-state">
                    <strong>已生成正式版本 V${Number(governanceRecord.number) || 0}</strong>
                    <span>${esc(governanceRecord.statusLabel || governanceRecord.status || "已记录")}${governanceRecord.scheduledRoundNumber ? ` · 第 ${Number(governanceRecord.scheduledRoundNumber)} 轮` : ""}</span>
                  </div>` : experiment.canEnterReview ? `<button class="mining-tuning-review-action" data-action="miningTuningReviewSchedule" data-payload="${esc(experiment.id)}" type="button" ${tuningGovernanceMutationPending ? "disabled" : ""}>${tuningGovernanceMutationPending ? "正在生成版本…" : "确认人工审核并安排生效"}</button>` : assessment.id === "review-ready" ? `<p class="mining-tuning-review-blocked">${esc(experiment.reviewBlockedReason || "当前条件不允许生成新的正式版本。")}</p>` : ""}
                </section>
                <p class="mining-tuning-experiment-note ${insufficient ? "is-warning" : ""}">${esc(experiment.note || "正在等待后续轮次。")}</p>
              </article>
            `;
          }).join("")}
        </div>` : `<p class="mining-empty-copy">还没有影子观察。请先在上方组合草案中选择 1–2 个矿带，再保存记录。</p>`}
        <p class="mining-tuning-note">影子观察不会把草案参数写入游戏；它用于检查预测是否偏离后续自然实况，不可作为调参效果的因果证明。</p>
      </div>
    </details>
  `;
}

function miningTabs() {
  return `
    <div class="mining-tabs" role="tablist" aria-label="矿区功能">
      <button class="${activeTab === "mines" ? "on" : ""}" data-action="miningTab" data-payload="mines" type="button" role="tab" aria-selected="${activeTab === "mines"}">租赁矿山</button>
      <button class="${activeTab === "work" ? "on" : ""}" data-action="miningTab" data-payload="work" type="button" role="tab" aria-selected="${activeTab === "work"}">挖矿</button>
      <button class="${activeTab === "miners" ? "on" : ""}" data-action="miningTab" data-payload="miners" type="button" role="tab" aria-selected="${activeTab === "miners"}">矿工队伍</button>
      <button class="${activeTab === "records" ? "on" : ""}" data-action="miningTab" data-payload="records" type="button" role="tab" aria-selected="${activeTab === "records"}">开采记录</button>
    </div>
  `;
}

function roundSummary(mining) {
  const round = mining.currentRound;
  if (!round) return "";
  const preparing = !round.allocatedAt;
  const target = preparing ? round.startsAt : round.endsAt;
  return `
    <section class="mining-round-strip">
      <span>第 ${esc(round.number)} 轮</span>
      <strong>${preparing ? "等待分配" : "租赁进行中"}</strong>
      <span data-mining-countdown="${Number(target) || 0}" data-prefix="${preparing ? "分配" : "到期"}">${preparing ? "分配" : "到期"}：${duration((Number(target) || 0) - now())}</span>
      <span>已出租 ${(round.leases || []).length} / ${MINES.length}</span>
    </section>
  `;
}

function miningPreferenceQuote(mine, mining = stateMining()) {
  const availableFunds = (Number(getState()?.me?.cash) || 0)
    + (Number(mining.myApplication?.escrow) || 0);
  const nextEscrow = Math.max(
    Number(mine?.rent) || 0,
    ...preferenceDraft.map((mineId) => effectiveMiningMineById(mineId, mining)?.rent || 0)
  );
  return {
    availableFunds,
    nextEscrow,
    affordable: availableFunds >= nextEscrow
  };
}

function applicationBar(mining) {
  if (!mining.acceptingApplications || !mining.playerQualified) return "";
  const priorityEligible = Boolean(mining.priorityEligible);
  const isNextRound = Number(mining.targetRound) > Number(mining.currentRound?.number || 0);
  const rosterLimit = Math.max(1, Number(mining.competitionRosterLimit || mining.requiredPlayers) || 50);
  const allocationRule = `${rosterLimit} 个竞租席位竞争 ${MINES.length} 座矿山；上轮系统落选者优先，同优先级随机抽签，不按提交先后。`;
  const selected = preferenceDraft.map((mineId) => effectiveMiningMineById(mineId, mining)).filter(Boolean);
  const escrow = selected.length ? Math.max(...selected.map((mine) => mine.rent)) : 0;
  const applicationPreferences = mining.myApplication?.preferences || [];
  const saved = Boolean(mining.myApplication)
    && applicationPreferences.length === preferenceDraft.length
    && applicationPreferences.every((mineId, index) => mineId === preferenceDraft[index])
    && (mining.myApplication.allowFallback !== false) === allowFallbackDraft;
  const saveLabel = preferenceMutationPending
    ? "正在自动保存…"
    : selected.length && saved
      ? "✓ 已自动保存，等待分配"
      : selected.length
        ? "正在同步志愿…"
        : mining.myApplication
          ? "正在清空志愿…"
          : "";
  return `
    <section class="mining-application-bar">
      <div>
        <strong>${isNextRound ? "下一轮申请期" : "本轮申请期"} · 第 ${esc(mining.targetRound)} 轮</strong>
        <span data-mining-countdown="${Number(mining.applicationClosesAt) || 0}" data-prefix="距申请截止">距申请截止：${duration((Number(mining.applicationClosesAt) || 0) - now())}</span>
        <span>${selected.length
          ? selected.map((mine, index) => `${index + 1}. ${mine.name}`).join("　")
          : priorityEligible
            ? `上轮系统落选；提交 1–${MINING_MAX_PREFERENCES} 座志愿并接受调剂后，本轮优先分配`
            : `可选 1–${MINING_MAX_PREFERENCES} 座；未提交志愿则本轮不参与分配`}</span>
      </div>
      <div class="mining-application-actions">
        <span>冻结上限 ${money(escrow)} · 非扣费</span>
        ${priorityEligible ? `<span class="mining-priority-chip">${allowFallbackDraft ? "上轮落选 · 本轮优先" : "开启调剂以使用优先"}</span>` : ""}
        <button class="mining-allocation-toggle ${allowFallbackDraft ? "on" : ""}" data-action="miningToggleFallback" type="button" aria-pressed="${allowFallbackDraft}" ${preferenceMutationPending ? "disabled" : ""}>${allowFallbackDraft ? "✓ 接受同价位空闲矿山调剂" : "仅接受所选志愿"}</button>
        ${mining.myApplication || selected.length ? `<button class="ghost-btn" data-action="miningCancelApplication" type="button" ${preferenceMutationPending ? "disabled" : ""}>清空志愿</button>` : ""}
        ${saveLabel ? `<span class="mining-application-save-state ${saved ? "saved" : "pending"}" role="status">${saveLabel}</span>` : ""}
      </div>
      <p class="mining-application-note">${isNextRound
        ? `申请下一轮不会影响当前矿权；${allocationRule}本轮到期后统一分配，未中选将立即全额退回冻结资金。`
        : `${allocationRule}申请截止后统一分配，未中选将立即全额退回冻结资金。`}</p>
    </section>
  `;
}

function minerSkill(miner, key, label) {
  const level = Math.max(1, Number(miner?.skills?.[key]?.level) || 1);
  return `<span>${label} Lv.${level}</span>`;
}

function minerTrainingRow(miner, training, condition) {
  const skillState = miner?.skills?.[training.id] || {};
  const level = Math.max(1, Math.min(MINER_SKILL_MAX_LEVEL, Number(skillState.level) || 1));
  const exp = Math.max(0, Number(skillState.exp) || 0);
  const target = miningMinerSkillExpTarget(level);
  const progress = level >= MINER_SKILL_MAX_LEVEL ? 100 : Math.max(0, Math.min(100, (exp / Math.max(1, target)) * 100));
  const affordable = (Number(getState()?.me?.cash) || 0) >= training.cost;
  const disabled = miner.busy || !condition.ready || level >= MINER_SKILL_MAX_LEVEL || !affordable;
  const buttonLabel = level >= MINER_SKILL_MAX_LEVEL
    ? "已满级"
    : affordable
      ? `训练 ${money(training.cost)}`
      : `资金不足 ${money(training.cost)}`;
  return `
    <div class="miner-training-row">
      <div>
        <span><b>${esc(training.skillLabel)} Lv.${level}</b><small>${level >= MINER_SKILL_MAX_LEVEL ? "满级" : `${Math.round(exp)} / ${target}`}</small></span>
        <i aria-label="${esc(training.skillLabel)}训练进度"><em style="width:${progress}%"></em></i>
        <small>${esc(training.name)} · 经验 +${training.exp} · 疲劳 +${training.fatigue}</small>
      </div>
      <button data-action="miningTrainMiner" data-payload="${esc(miner.id)}:${training.id}" type="button" ${disabled ? "disabled" : ""}>${buttonLabel}</button>
    </div>
  `;
}

function minerMoralePanel(miner, candidate = false) {
  const morale = miningMinerMoraleInfo(miner);
  return `
    <div class="miner-morale ${esc(morale.tone)} ${candidate ? "candidate" : ""}">
      <div><span>矿工士气</span><strong>${morale.morale} · ${esc(morale.name)}</strong></div>
      <i aria-label="矿工士气 ${morale.morale}"><em style="width:${morale.morale}%"></em></i>
      <small>${esc(morale.effectLabel)}</small>
    </div>
  `;
}

function minerRetentionPanel(miner) {
  const retention = miningMinerRetentionInfo(miner, now());
  if (retention.id === "stable") return "";
  const cash = Number(getState()?.me?.cash) || 0;
  if (!retention.pending) {
    return `
      <div class="miner-retention-panel ${esc(retention.tone)}">
        <div><span>留任状态</span><strong>${esc(retention.name)}</strong></div>
        <p>${esc(retention.reason)}。${esc(retention.description)}</p>
      </div>
    `;
  }
  return `
    <div class="miner-retention-panel critical">
      <div><span>留任事件 · 暂停排班</span><strong>离职申请待处理</strong></div>
      <p>提出申请时士气 ${Math.max(0, Number(miner.retentionCase?.moraleAtNotice) || 0)}。选择方案后立即生效；同意离队会移除该矿工及其固定班组记录。</p>
      <div class="miner-retention-choices">
        ${Object.values(MINER_RETENTION_CHOICES).map((choice) => {
          const quote = miningMinerRetentionChoiceQuote(miner, choice.id);
          const disabled = miner.busy || cash < quote.cost;
          const effect = choice.id === "release"
            ? "矿工离队 · 免费"
            : `士气至少恢复至 ${choice.moraleFloor}${choice.contractShifts ? ` · 合约 +${choice.contractShifts} 班` : ""}`;
          return `
            <button class="${choice.id === "release" ? "release" : ""}" data-action="miningResolveMinerRetention" data-payload="${esc(miner.id)}|${choice.id}" type="button" ${disabled ? "disabled" : ""}>
              <b>${esc(choice.name)}${quote.cost ? ` · ${money(quote.cost)}` : ""}</b>
              <span>${esc(effect)}</span>
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function minerCarePanel(miner, condition) {
  const injured = (Number(miner?.injuredUntil) || 0) > now();
  const needsRest = condition.fatigue >= MINER_REST_MIN_FATIGUE;
  const morale = miningMinerMoraleInfo(miner);
  const needsSupport = morale.morale < MINER_MORALE_CARE_THRESHOLD;
  if (!injured && !needsRest && !needsSupport) return "";
  const cash = Number(getState()?.me?.cash) || 0;
  const buttons = [];
  if (needsRest) {
    const care = MINER_CARE_OPTIONS.rest;
    const disabled = miner.busy || Boolean(miner.retentionCase) || cash < care.cost;
    buttons.push(`<button data-action="miningCareMiner" data-payload="${esc(miner.id)}:${care.id}" type="button" ${disabled ? "disabled" : ""}><b>${esc(care.name)} · ${money(care.cost)}</b><span>疲劳 -${care.fatigueRecovery}</span></button>`);
  }
  if (injured) {
    const care = MINER_CARE_OPTIONS.treatment;
    const disabled = miner.busy || Boolean(miner.retentionCase) || cash < care.cost;
    buttons.push(`<button class="treatment" data-action="miningCareMiner" data-payload="${esc(miner.id)}:${care.id}" type="button" ${disabled ? "disabled" : ""}><b>${esc(care.name)} · ${money(care.cost)}</b><span>伤停 -${Math.round(care.injuryReductionMs / (60 * 60 * 1000))}小时 · 疲劳 -${care.fatigueRecovery}</span></button>`);
  }
  if (needsSupport) {
    const care = MINER_CARE_OPTIONS.support;
    const disabled = miner.busy || Boolean(miner.retentionCase) || cash < care.cost;
    buttons.push(`<button class="support" data-action="miningCareMiner" data-payload="${esc(miner.id)}:${care.id}" type="button" ${disabled ? "disabled" : ""}><b>${esc(care.name)} · ${money(care.cost)}</b><span>士气 +${care.moraleRecovery}</span></button>`);
  }
  return `
    <div class="miner-care-panel">
      <span><b>休整、救护与关怀</b><small>仅服务独立矿工</small></span>
      <div>${buttons.join("")}</div>
    </div>
  `;
}

function minerSpecializationPanel(miner) {
  const chosen = miningMinerSpecializationInfo(miner);
  const shiftsWorked = Math.max(0, Math.round(Number(miner?.shiftsWorked) || 0));
  if (chosen) {
    return `
      <div class="miner-specialization-panel chosen">
        <div><span>职业专精 · 永久</span><strong>${esc(chosen.name)}</strong></div>
        <p>${esc(chosen.description)}</p>
        <small>${esc(chosen.effectLabel)} · 已完成 ${shiftsWorked} 个矿山班次</small>
      </div>
    `;
  }
  return `
    <div class="miner-specialization-panel">
      <div>
        <span>职业专精 · 永久选择</span>
        <strong>班次 ${Math.min(shiftsWorked, MINER_SPECIALIZATION_REQUIRED_SHIFTS)} / ${MINER_SPECIALIZATION_REQUIRED_SHIFTS}</strong>
      </div>
      <p>完成 ${MINER_SPECIALIZATION_REQUIRED_SHIFTS} 个矿山班次，且对应技能达到 Lv.${MINER_SPECIALIZATION_REQUIRED_LEVEL} 后可确定一个方向。</p>
      <div class="miner-specialization-choices">
        ${Object.values(MINER_SPECIALIZATIONS).map((specialization) => {
          const eligibility = miningMinerSpecializationEligibility(miner, specialization.id);
          const disabled = miner.busy || Boolean(miner.retentionCase) || !eligibility.ready;
          const status = miner.busy ? "正在井下，暂不可选择" : eligibility.ready ? "可确定 · 选择后不可更改" : eligibility.reason;
          return `
            <button class="${eligibility.ready ? "eligible" : ""}" data-action="miningSpecializeMiner" data-payload="${esc(miner.id)}|${specialization.id}" type="button" ${disabled ? "disabled" : ""}>
              <b>${esc(specialization.name)}</b>
              <span>${esc(specialization.skillLabel)} +${MINER_SPECIALIZATION_BONUS}</span>
              <small>${esc(status)}</small>
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function minerContractPanel(miner) {
  const contract = miningMinerContractInfo(miner);
  const affordable = (Number(getState()?.me?.cash) || 0) >= contract.renewalCost;
  const disabled = miner.busy || Boolean(miner.retentionCase) || !contract.canRenew || !affordable;
  const progress = Math.max(0, Math.min(100, (contract.remaining / contract.maxShifts) * 100));
  const buttonLabel = miner.busy
    ? "井下作业中"
    : miner.retentionCase
      ? "请先处理离职申请"
    : !contract.canRenew
      ? contract.remaining >= contract.maxShifts ? "班次已储满" : `剩余 ${contract.remaining} 班`
      : affordable
        ? `续约 +${contract.renewalShifts} 班 · ${money(contract.renewalCost)}`
        : `资金不足 · ${money(contract.renewalCost)}`;
  return `
    <div class="miner-contract-panel ${contract.expired ? "expired" : contract.low ? "low" : ""}">
      <div><span>矿工班次合约</span><strong>${contract.expired ? "待续约" : `剩余 ${contract.remaining} 班`}</strong></div>
      <i aria-label="剩余合约班次"><em style="width:${progress}%"></em></i>
      <p>只在完成开采班次后扣减；当前士气“${esc(contract.moraleLabel)}”，续约费 ${contract.moraleMultiplier === 1 ? "不变" : `×${contract.moraleMultiplier}`}，不计入普通员工薪资。</p>
      <button data-action="miningRenewMinerContract" data-payload="${esc(miner.id)}" type="button" ${disabled ? "disabled" : ""}>${buttonLabel}</button>
    </div>
  `;
}

function minerPromotionPanel(miner) {
  const promotion = miningMinerPromotionInfo(miner);
  if (promotion.maxed) {
    return `
      <div class="miner-promotion-panel maxed">
        <div><span>矿工评级</span><strong>T${MINER_MAX_TIER} · 顶级认证</strong><small>三项井下能力永久 +${promotion.currentSkillBonus.toFixed(1)} · 已完成全部评级晋升</small></div>
      </div>
    `;
  }
  const affordable = (Number(getState()?.me?.cash) || 0) >= promotion.promotionCost;
  const disabled = miner.busy || Boolean(miner.retentionCase) || !promotion.ready || !affordable;
  const shiftProgress = Math.max(0, Math.min(100, (promotion.shiftsWorked / promotion.requiredShifts) * 100));
  const skillProgress = Math.max(0, Math.min(100, (promotion.averageSkill / promotion.requiredAverageSkill) * 100));
  const status = miner.busy
    ? "正在井下，暂不可评定"
    : miner.retentionCase
      ? "请先处理离职申请"
    : promotion.ready
      ? affordable ? "资格已满足" : "资格已满足，当前资金不足"
      : promotion.reason;
  return `
    <div class="miner-promotion-panel ${promotion.ready ? "eligible" : ""}">
      <div>
        <span>矿工评级 · T${promotion.tier} → T${promotion.targetTier}</span>
        <strong>班次 ${promotion.shiftsWorked}/${promotion.requiredShifts} · 均技 ${promotion.averageSkill}/${promotion.requiredAverageSkill}</strong>
        <span class="miner-promotion-progress"><i style="width:${shiftProgress}%"></i><i style="width:${skillProgress}%"></i></span>
        <small>评级作业加成 +${promotion.currentSkillBonus.toFixed(1)} → +${promotion.targetSkillBonus.toFixed(1)} · ${esc(status)}</small>
      </div>
      <button data-action="miningPromoteMiner" data-payload="${esc(miner.id)}" type="button" ${disabled ? "disabled" : ""}>晋升 T${promotion.targetTier} · ${money(promotion.promotionCost)}</button>
    </div>
  `;
}

function crewAssignmentFor(crewKey, record, mine, miners) {
  const key = miningCrewKey(record?.minerIds || String(crewKey || "").split("|"));
  const minerIds = key.split("|").filter(Boolean);
  const members = minerIds.map((minerId) => miners.find((miner) => miner.id === minerId));
  let unavailableReason = "";
  if (!mine) unavailableReason = "当前没有矿权";
  else if (minerIds.length !== mine.crewRequired) unavailableReason = `本矿需 ${mine.crewRequired} 人`;
  else if (members.some((miner) => !miner)) unavailableReason = "成员已离队";
  else {
    const busy = members.find((miner) => miner.busy);
    const expiredContract = members.find((miner) => miningMinerContractInfo(miner).expired);
    const unavailable = members
      .map((miner) => ({ miner, condition: minerCondition(miner) }))
      .find((entry) => !entry.condition.ready);
    if (busy) unavailableReason = `${busy.name}正在井下`;
    else if (expiredContract) unavailableReason = `${expiredContract.name}合约待续`;
    else if (unavailable) unavailableReason = `${unavailable.miner.name}${unavailable.condition.label}`;
  }
  return {
    key,
    minerIds,
    members: members.filter(Boolean),
    names: (record?.minerNames || []).filter(Boolean),
    ready: !unavailableReason,
    unavailableReason,
    selected: Boolean(mine)
      && minerIds.length === mine.crewRequired
      && miningCrewKey(selectedMinerIds) === key
  };
}

function crewAssignmentsFor(mine, miners, limit = 3) {
  return Object.entries(playerMining().crewRecords || {})
    .filter(([, record]) => Number(record?.shifts) > 0)
    .map(([crewKey, record]) => ({
      crewKey,
      record,
      assignment: crewAssignmentFor(crewKey, record, mine, miners),
      bond: miningCrewBondInfo(record)
    }))
    .filter((entry) => !mine || entry.assignment.minerIds.length === mine.crewRequired)
    .sort((left, right) => (
      right.bond.level - left.bond.level
      || (Number(right.record.shifts) || 0) - (Number(left.record.shifts) || 0)
      || (Number(right.record.lastWorkedAt) || 0) - (Number(left.record.lastWorkedAt) || 0)
    ))
    .slice(0, limit);
}

function crewShortcutPanel(mine, miners) {
  const crews = crewAssignmentsFor(mine, miners);
  if (!crews.length) return "";
  return `
    <div class="mining-crew-shortcuts">
      <div><strong>历史班组 · 一键排班</strong><small>按默契与合作班次排序</small></div>
      <div class="mining-crew-shortcut-list">${crews.map(({ record, assignment, bond }) => `
        <button class="mining-crew-shortcut ${assignment.selected ? "on" : ""}" data-action="miningAssignCrew" data-payload="${esc(assignment.key)}" type="button" ${assignment.ready ? "" : "disabled"}>
          <span><b>${esc(assignment.names.join("、") || assignment.members.map((miner) => miner.name).join("、") || "未命名班组")}</b><small>Lv.${bond.level} · ${esc(bond.name)}</small></span>
          <em>${assignment.ready ? assignment.selected ? "已排班" : "一键安排" : esc(assignment.unavailableReason)}</em>
        </button>
      `).join("")}</div>
    </div>
  `;
}

function shiftPreview(mine, miners, strategy, condition) {
  const selected = miners.filter((miner) => selectedMinerIds.includes(miner.id));
  const foreman = selected.find((miner) => miner.id === selectedForemanId) || selected[0] || null;
  const foremanInfo = miningForemanInfo(foreman);
  const roleDetails = miningRoleAssignmentDetails(selectedRoleAssignments, selected);
  const crewKey = miningCrewKey(selected.map((miner) => miner.id));
  const crewRecord = playerMining().crewRecords?.[crewKey] || null;
  const crewBond = selected.length === mine.crewRequired
    ? miningCrewBondInfo(crewRecord)
    : miningCrewBondInfo(0, { level: true });
  const facilities = playerMining().facilities || {};
  const mineRecord = playerMining().mineRecords?.[mine.id] || {};
  const mastery = miningMineMasteryInfo(mineRecord);
  const surveyReportUsed = selectedUseSurveyReport && (Number(mineRecord.surveyReports) || 0) > 0;
  const preparationEffects = miningPreparationEffects(selectedPreparationIds, condition.id);
  const incentive = miningShiftIncentiveById(selectedIncentiveId);
  const wageQuote = miningShiftWageQuote(selected, incentive.id);
  const moraleMembers = selected.map((miner) => miningMinerMoraleInfo(miner));
  const moraleAverage = selected.length
    ? Math.round(moraleMembers.reduce((sum, morale) => sum + morale.morale, 0) / selected.length)
    : 70;
  const morale = miningMinerMoraleInfo(moraleAverage);
  const moraleSkillBonus = selected.length
    ? moraleMembers.reduce((sum, entry) => sum + entry.skillBonus, 0) / selected.length
    : 0;
  const moraleRiskDelta = selected.length
    ? moraleMembers.reduce((sum, entry) => sum + entry.riskDelta, 0) / selected.length
    : 0;
  const moraleSkillLabel = Math.abs(moraleSkillBonus) < 0.001
    ? "技能不变"
    : `技能 ${moraleSkillBonus > 0 ? "+" : ""}${Math.round(moraleSkillBonus * 10) / 10}`;
  const moraleRiskLabel = Math.abs(moraleRiskDelta) < 0.0001
    ? "风险不变"
    : `风险 ${moraleRiskDelta > 0 ? "+" : ""}${Math.round(moraleRiskDelta * 1000) / 10}%`;
  const moraleShiftDelta = miningMinerShiftMoraleDelta({ strategyId: strategy.id, incentiveId: incentive.id });
  const performance = miningShiftPerformance({
    mine,
    miners: selected,
    strategyId: strategy.id,
    conditionId: condition.id,
    preparationIds: selectedPreparationIds,
    facilities,
    masteryLevel: mastery.level,
    crewBondLevel: crewBond.level,
    foremanFocus: foremanInfo?.focus,
    foremanBonus: foremanInfo?.bonus,
    roleAssignments: selectedRoleAssignments,
    incentiveId: incentive.id,
    useSurveyReport: surveyReportUsed
  });
  const fatigueValues = selected.map((miner) => Math.max(
    5,
    (Number(MINER_SHIFT_FATIGUE[strategy.id]) || MINER_SHIFT_FATIGUE.standard)
      + (Number(MINER_TRAIT_EFFECTS[miner?.trait]?.fatigueDelta) || 0)
      + crewBond.fatigueDelta
      + incentive.fatigueDelta
  ));
  return {
    selectedCount: selected.length,
    selectedReady: selected.every((miner) => (
      minerCondition(miner).ready && !miningMinerContractInfo(miner).expired
    )),
    cost: wageQuote.wages + mine.supplies + preparationEffects.cost,
    wageCost: wageQuote.wages,
    baseWages: wageQuote.baseWages,
    incentivePremium: wageQuote.incentivePremium,
    incentive,
    morale,
    moraleEffectLabel: `${moraleSkillLabel} · ${moraleRiskLabel}`,
    moraleShiftDelta,
    preparationCost: preparationEffects.cost,
    mastery,
    crewBond,
    crewShifts: Number(crewRecord?.shifts) || 0,
    crewNextAt: miningCrewBondNextAt(crewRecord),
    foreman,
    foremanInfo,
    roleDetails,
    surveyReportUsed,
    clueGain: performance.clueGain,
    risk: performance.risk,
    yieldMin: performance.yieldMin,
    yieldMax: performance.yieldMax,
    extraYieldChance: performance.extraYieldChance,
    upgradeChance: performance.upgradeChance,
    fatigueMin: fatigueValues.length ? Math.min(...fatigueValues) : Number(MINER_SHIFT_FATIGUE[strategy.id]),
    fatigueMax: fatigueValues.length ? Math.max(...fatigueValues) : Number(MINER_SHIFT_FATIGUE[strategy.id])
  };
}

function activeMiningJob() {
  return (playerMining().jobs || []).find((entry) => entry.status === "active") || null;
}

function miningInteriorProgress(job, timestamp = now()) {
  const startedAt = Number(job?.startedAt) || 0;
  const readyAt = Number(job?.readyAt) || startedAt + Math.max(1, Number(job?.durationMs) || 1);
  return clamp((timestamp - startedAt) / Math.max(1, readyAt - startedAt), 0, 1);
}

function miningInteriorPhase(progress) {
  if (progress < 0.18) return { id: "prepare", label: "掘进准备", detail: "检查支护与通风" };
  if (progress < 0.62) return { id: "extract", label: "掌子面开采", detail: "岩壁裂纹持续扩大" };
  if (progress < 0.86) return { id: "sort", label: "筛料装车", detail: "碎料正在清点入车" };
  return { id: "haul", label: "清点回运", detail: "矿车准备驶离作业面" };
}

function miningInteriorYield(mine, job) {
  if (Number.isFinite(Number(job?.estimate?.yieldMin)) && Number.isFinite(Number(job?.estimate?.yieldMax))) {
    return {
      min: Math.max(0, Number(job.estimate.yieldMin)),
      max: Math.max(0, Number(job.estimate.yieldMax))
    };
  }
  const strategy = MINING_STRATEGIES[job?.strategyId] || MINING_STRATEGIES.standard;
  const condition = MINING_SITE_CONDITIONS[job?.conditionId] || MINING_SITE_CONDITIONS.stable;
  const delta = Number(strategy.yieldDelta || 0) + Number(condition.yieldDelta || 0);
  const min = Math.max(0, Number(mine?.yieldMin || 0) + delta);
  const max = Math.max(min, Number(mine?.yieldMax || 0) + delta + 1);
  return { min, max };
}

function miningInteriorStation(miner, index, count, job) {
  const layouts = count <= 2
    ? [{ x: 28, y: 70 }, { x: 73, y: 70 }]
    : [{ x: 18, y: 70 }, { x: 50, y: 64 }, { x: 81, y: 70 }];
  const point = layouts[index] || layouts[layouts.length - 1];
  const roleKey = Object.keys(job.roleAssignments || {})
    .find((key) => job.roleAssignments[key] === miner.id);
  const role = MINING_SHIFT_ROLES[roleKey]?.label || MINING_INTERIOR_ROLES[index] || "协同作业";
  const condition = minerCondition(miner);
  const isForeman = job.foremanId === miner.id;
  const selected = focusedInteriorMinerId === miner.id;
  return `
    <button
      class="mining-interior-station ${selected ? "selected" : ""}"
      style="--station-x:${point.x}%;--station-y:${point.y}%"
      data-action="miningFocusInteriorMiner"
      data-payload="${esc(miner.id)}"
      type="button"
      aria-pressed="${selected}"
      aria-label="${esc(miner.name)}，${esc(role)}"
    >
      <span class="mining-interior-station-mark" aria-hidden="true">${esc(String(miner.name || "矿").slice(0, 1))}</span>
      <span><b>${esc(miner.name)}</b><small>${isForeman ? `${esc(job.foremanLabel || "值班班长")} · ` : ""}${esc(role)}</small></span>
      <em>${Math.round(condition.fatigue)}%</em>
    </button>
  `;
}

function miningIncidentPanel(job) {
  const incidentAt = Number(job?.incidentAt) || 0;
  if (!incidentAt) return "";
  const incident = miningShiftIncidentById(job.incidentId);
  if (!incident) {
    return `
      <section class="mining-incident-card waiting">
        <div><span>井下联络</span><strong>下一次作业汇报尚未传回</strong></div>
        <p>每班约在 ${Math.round(MINING_INCIDENT_REVEAL_RATIO * 100)}% 进度出现一次现场抉择；未在线时将自动按原预案执行。</p>
        <time data-mining-countdown="${incidentAt}" data-prefix="预计传回">预计传回：${duration(incidentAt - now())}</time>
      </section>
    `;
  }
  const selectedChoice = miningShiftIncidentChoice(incident.id, job.incidentChoiceId);
  if (selectedChoice) {
    return `
      <section class="mining-incident-card resolved">
        <div><span>井下急报 · 已处理</span><strong>${esc(incident.name)}</strong></div>
        <p>${esc(incident.description)}</p>
        <em>${esc(selectedChoice.label)} · ${esc(selectedChoice.effectLabel)}</em>
      </section>
    `;
  }
  return `
    <section class="mining-incident-card pending" aria-live="polite">
      <div><span>井下急报 · 等待掌柜决策</span><strong>${esc(incident.name)}</strong></div>
      <p>${esc(incident.description)}</p>
      <div class="mining-incident-choices">
        ${incident.choices.map((choice) => `
          <button data-action="miningResolveIncident" data-payload="${esc(job.id)}|${esc(choice.id)}" type="button">
            <b>${esc(choice.label)}</b>
            <span>${esc(choice.description)}</span>
            <small>${esc(choice.effectLabel)}</small>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function miningInteriorView(mining, job) {
  const mine = miningMineById(job.mineId);
  if (!mine) return `<section class="mining-empty-panel"><strong>井下资料暂不可用</strong><p>请返回矿区稍后重试。</p></section>`;
  const miners = playerMining().miners || [];
  const crew = (job.minerIds || []).map((id) => miners.find((miner) => miner.id === id)).filter(Boolean);
  const progress = miningInteriorProgress(job);
  const phase = miningInteriorPhase(progress);
  const expectedYield = miningInteriorYield(mine, job);
  const strategy = MINING_STRATEGIES[job.strategyId] || MINING_STRATEGIES.standard;
  const incentive = miningShiftIncentiveById(job.incentiveId);
  const condition = MINING_SITE_CONDITIONS[job.conditionId] || MINING_SITE_CONDITIONS.stable;
  const risk = Number.isFinite(Number(job.estimate?.risk))
    ? clamp(Number(job.estimate.risk), 0.01, 0.65)
    : clamp(Number(mine.risk || 0) + Number(strategy.accidentDelta || 0) + Number(condition.riskDelta || 0), 0.01, 0.65);
  const selectedMiner = crew.find((miner) => miner.id === focusedInteriorMinerId)
    || crew.find((miner) => miner.id === job.foremanId)
    || crew[0]
    || null;
  if (selectedMiner) focusedInteriorMinerId = selectedMiner.id;
  const selectedIndex = Math.max(0, crew.findIndex((miner) => miner.id === selectedMiner?.id));
  const selectedRoleKey = Object.keys(job.roleAssignments || {})
    .find((key) => job.roleAssignments[key] === selectedMiner?.id);
  const selectedRole = MINING_SHIFT_ROLES[selectedRoleKey]?.label
    || MINING_INTERIOR_ROLES[selectedIndex]
    || "协同作业";
  const selectedCondition = selectedMiner ? minerCondition(selectedMiner) : null;
  const selectedMorale = miningMinerMoraleInfo(selectedMiner);
  const selectedSpecialization = miningMinerSpecializationInfo(selectedMiner);
  const selectedContract = miningMinerContractInfo(selectedMiner);
  const progressPercent = Math.round(progress * 100);
  const oreCount = Math.max(1, Math.ceil(progress * 5));
  const phases = ["掘进准备", "掌子面开采", "筛料装车", "清点回运"];
  const phaseIndex = ["prepare", "extract", "sort", "haul"].indexOf(phase.id);
  return `
    <section
      class="mining-interior"
      data-mining-interior
      data-started-at="${Number(job.startedAt) || 0}"
      data-ready-at="${Number(job.readyAt) || 0}"
      data-phase="${phase.id}"
    >
      <header class="mining-interior-head">
        <button class="mining-interior-back" data-action="miningExitInterior" type="button">← 返回矿区</button>
        <div>
          <p>${esc(mine.beltLabel)} · ${esc(mine.id.toUpperCase())}</p>
          <h3>${esc(mine.name)}</h3>
          <span>${esc(job.strategyLabel || strategy.label)}方案 · ${esc(job.incentiveLabel || incentive.label)} · ${esc(job.conditionName || condition.name)}</span>
        </div>
        <div class="mining-interior-live">
          <span><i></i> 井下作业中</span>
          <strong data-mining-countdown="${Number(job.readyAt) || 0}" data-prefix="完成">完成：${duration(Number(job.readyAt || 0) - now())}</strong>
        </div>
      </header>

      <div class="mining-interior-stage" aria-label="${esc(mine.name)}井下作业现场">
        <div class="mining-interior-zone ventilation"><span>通风</span><b>正常</b></div>
        <div class="mining-interior-zone face"><span>掌子面</span><b data-mining-interior-phase>${esc(phase.label)}</b></div>
        <div class="mining-interior-zone haulage"><span>矿车装载</span><b data-mining-interior-load>${progressPercent}%</b></div>
        <div class="mining-interior-dust" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div class="mining-interior-ore" aria-hidden="true">
          ${Array.from({ length: 5 }, (_, index) => `<i class="${index < oreCount ? "on" : ""}" data-mining-ore-index="${index}"></i>`).join("")}
        </div>
        ${crew.map((miner, index) => miningInteriorStation(miner, index, crew.length, job)).join("")}
      </div>

      <div class="mining-interior-console">
        ${miningIncidentPanel(job)}
        <div class="mining-interior-progress-copy">
          <span><b data-mining-interior-phase>${esc(phase.label)}</b><small data-mining-interior-phase-detail>${esc(phase.detail)}</small></span>
          <strong data-mining-interior-progress>${progressPercent}%</strong>
        </div>
        <div class="mining-interior-progress"><i style="width:${progressPercent}%"></i></div>
        <div class="mining-interior-steps" aria-label="开采流程">
          ${phases.map((label, index) => `<span class="${index < phaseIndex ? "done" : index === phaseIndex ? "current" : ""}" data-mining-interior-step="${index}">${esc(label)}</span>`).join("")}
        </div>
        <div class="mining-interior-stats">
          <span><small>预计出料</small><b>${expectedYield.min}–${expectedYield.max} 块</b></span>
          <span><small>作业风险</small><b>${riskLabel(risk)} · ${percent(risk)}</b></span>
          <span><small>班组默契</small><b>Lv.${Number(job.crewBondLevel) || 0}</b></span>
          <span><small>值班班长</small><b>${esc(job.foremanName || "未记录")}</b></span>
        </div>
        ${selectedMiner ? `
          <div class="mining-interior-worker-detail">
            <span class="mining-interior-worker-mark" aria-hidden="true">${esc(String(selectedMiner.name || "矿").slice(0, 1))}</span>
            <div>
              <small>当前工位 · ${esc(selectedRole)}</small>
              <strong>${esc(selectedMiner.name)}${selectedMiner.id === job.foremanId ? ` · ${esc(job.foremanLabel || "值班班长")}` : ""}</strong>
              <p>T${Number(selectedMiner.tier) || 1}${selectedSpecialization ? ` · ${esc(selectedSpecialization.name)}` : ""} · 井下作业 · 合约余 ${selectedContract.remaining} 班 · 疲劳 ${Math.round(selectedCondition?.fatigue || 0)} · 士气 ${selectedMorale.morale}（${esc(selectedMorale.name)}）</p>
            </div>
            <div class="mining-interior-worker-skills">
              <span>勘脉 Lv.${Math.max(1, Number(selectedMiner.skills?.prospecting?.level) || 1)}</span>
              <span>采掘 Lv.${Math.max(1, Number(selectedMiner.skills?.extraction?.level) || 1)}</span>
              <span>安全 Lv.${Math.max(1, Number(selectedMiner.skills?.safety?.level) || 1)}</span>
            </div>
            <button data-action="miningInteriorOpenCrew" type="button">查看班组</button>
          </div>
        ` : ""}
      </div>
    </section>
  `;
}

function paintMiningInteriorProgress() {
  const interior = document.querySelector("[data-mining-interior]");
  if (!interior) return;
  const progress = clamp(
    (now() - Number(interior.dataset.startedAt || 0))
      / Math.max(1, Number(interior.dataset.readyAt || 0) - Number(interior.dataset.startedAt || 0)),
    0,
    1
  );
  const phase = miningInteriorPhase(progress);
  const phaseIndex = ["prepare", "extract", "sort", "haul"].indexOf(phase.id);
  const progressPercent = Math.round(progress * 100);
  interior.dataset.phase = phase.id;
  interior.querySelectorAll("[data-mining-interior-phase]").forEach((node) => { node.textContent = phase.label; });
  const detail = interior.querySelector("[data-mining-interior-phase-detail]");
  if (detail) detail.textContent = phase.detail;
  const label = interior.querySelector("[data-mining-interior-progress]");
  if (label) label.textContent = `${progressPercent}%`;
  const load = interior.querySelector("[data-mining-interior-load]");
  if (load) load.textContent = `${progressPercent}%`;
  const fill = interior.querySelector(".mining-interior-progress i");
  if (fill) fill.style.width = `${progressPercent}%`;
  interior.querySelectorAll("[data-mining-interior-step]").forEach((node) => {
    const index = Number(node.dataset.miningInteriorStep) || 0;
    node.classList.toggle("done", index < phaseIndex);
    node.classList.toggle("current", index === phaseIndex);
  });
  const oreCount = Math.max(1, Math.ceil(progress * 5));
  interior.querySelectorAll("[data-mining-ore-index]").forEach((node) => {
    node.classList.toggle("on", Number(node.dataset.miningOreIndex) < oreCount);
  });
}

function paintBasicMiningProgress() {
  const surface = document.querySelector("[data-basic-mining-job]");
  if (!surface) return;
  const progress = clamp(
    (now() - Number(surface.dataset.startedAt || 0))
      / Math.max(1, Number(surface.dataset.readyAt || 0) - Number(surface.dataset.startedAt || 0)),
    0,
    1
  );
  const phase = miningInteriorPhase(progress);
  const phaseIndex = ["prepare", "extract", "sort", "haul"].indexOf(phase.id);
  const progressPercent = Math.round(progress * 100);
  surface.querySelectorAll("[data-mining-work-phase]").forEach((node) => { node.textContent = phase.label; });
  surface.querySelectorAll("[data-mining-work-detail]").forEach((node) => { node.textContent = phase.detail; });
  surface.querySelectorAll("[data-mining-work-progress]").forEach((node) => { node.textContent = `${progressPercent}%`; });
  const fill = surface.querySelector(".mining-operation-progress i");
  if (fill) fill.style.width = `${progressPercent}%`;
  surface.querySelectorAll("[data-mining-work-step]").forEach((node) => {
    const index = Number(node.dataset.miningWorkStep) || 0;
    node.classList.toggle("done", index < phaseIndex);
    node.classList.toggle("current", index === phaseIndex);
  });
}

function basicLeasePanel(mining) {
  const lease = mining.myLease;
  if (!lease) {
    return `
      <section class="mining-work-empty">
        <span class="mining-work-empty-mark" aria-hidden="true">矿</span>
        <div><strong>本轮还没有可开采的矿洞</strong><p>${mining.acceptingApplications
          ? mining.priorityEligible
            ? "前往租赁页提交下一轮志愿并接受调剂；你拥有上轮落选优先资格。"
            : "先在租赁页选择最多三座矿山；未提交志愿则本轮不参与分配。"
          : "等待下一轮矿权申请期开放。"}</p></div>
        <button class="primary-btn" data-action="miningTab" data-payload="mines" type="button">前往租赁矿山</button>
      </section>
    `;
  }
  const mine = miningMineById(lease.mineId);
  if (!mine) return "";
  const job = (playerMining().jobs || []).find((entry) => entry.status === "active");
  const miners = playerMining().miners || [];
  const selectedMiners = miners.filter((miner) => selectedMinerIds.includes(miner.id));
  const plan = miningBasicShiftPlan(mine, selectedMiners);
  const crewReady = selectedMinerIds.length >= MINING_BASIC_MIN_CREW
    && selectedMinerIds.length <= MINING_BASIC_MAX_CREW
    && selectedMiners.length === selectedMinerIds.length;
  const shiftFits = now() + Number(mining.shiftMs || 0) <= Number(lease.endsAt || 0);
  const canAfford = (Number(getState()?.me?.cash) || 0) >= plan.total;
  const canStart = !miningShiftMutationPending
    && !job
    && lease.shiftsStarted < lease.maxShifts
    && crewReady
    && shiftFits
    && canAfford;
  const startAction = miningShiftMutationPending
      ? `<button class="primary-btn mining-start-btn" type="button" disabled aria-busy="true">正在提交开工…</button>`
      : !miners.length
      ? `<button class="ghost-btn mining-start-btn" data-action="miningOpenMinerTeam" type="button">先招聘矿工</button>`
      : canStart
        ? `<button class="primary-btn mining-start-btn" data-action="miningStartShift" type="button">开始 ${duration(mining.shiftMs)} 开采</button>`
        : lease.shiftsStarted >= lease.maxShifts
          ? `<button class="primary-btn mining-start-btn" type="button" disabled>本轮开采次数已用完</button>`
          : !shiftFits
            ? `<button class="primary-btn mining-start-btn" type="button" disabled>租期时间不足</button>`
            : !crewReady
              ? `<button class="ghost-btn mining-start-btn" data-action="miningFocusCrew" type="button">先选择矿工</button>`
              : !canAfford
                ? `<button class="primary-btn mining-start-btn" type="button" disabled>现金不足 · 需 ${money(plan.total)}</button>`
                : `<button class="primary-btn mining-start-btn" type="button" disabled>暂不可开采</button>`;
  const activeCrew = job
    ? (job.minerIds || []).map((minerId) => miners.find((miner) => miner.id === minerId)).filter(Boolean)
    : [];
  const progress = job ? miningInteriorProgress(job) : 0;
  const phase = miningInteriorPhase(progress);
  const progressPercent = Math.round(progress * 100);
  const jobYieldMin = Number(job?.estimate?.yieldMin) || plan.yieldMin;
  const jobYieldMax = Number(job?.estimate?.yieldMax) || plan.yieldMax;
  return `
    <section class="mining-lease-panel mining-basic-lease ${job ? "is-active" : "is-ready"}" id="miningLeasePanel" ${job ? `data-basic-mining-job data-started-at="${Number(job.startedAt) || 0}" data-ready-at="${Number(job.readyAt) || 0}"` : ""}>
      <header class="mining-operation-head">
        <div>
          <p class="eyebrow">我的矿权${lease.priorityAllocation ? " · 落选优先" : ""}${lease.allocationMode === "automatic" ? " · 系统随机分配" : lease.allocationMode === "adjusted" ? " · 调剂取得" : lease.preferenceRank ? ` · 第 ${lease.preferenceRank} 志愿` : ""}</p>
          <h3>${esc(mine.name)}</h3>
          <p>${esc(plan.mineProfile.name)} · 主产 ${esc(mineQualities(mine))} · 本轮已开采 ${lease.shiftsStarted}/${lease.maxShifts} 次</p>
        </div>
        <div class="mining-operation-lease-meta">
          <strong data-mining-countdown="${Number(lease.endsAt) || 0}" data-prefix="租期剩余">租期剩余：${duration(Number(lease.endsAt || 0) - now())}</strong>
          <em class="${job ? "active" : "ready"}">${job ? "开采进行中" : "等待派工"}</em>
        </div>
      </header>

      <div class="mining-operation-layout">
        <section class="mining-operation-overview ${job ? "is-active" : "is-ready"}">
          <div class="mining-operation-overview-head">
            <span><i></i>${job ? "本班执行中" : "矿洞可开采"}</span>
            <b>${esc(mine.id.toUpperCase())}</b>
          </div>
          ${job ? `
            <div class="mining-operation-phase">
              <div>
                <small>当前环节</small>
                <h4 data-mining-work-phase>${esc(phase.label)}</h4>
                <p data-mining-work-detail>${esc(phase.detail)}</p>
              </div>
              <strong data-mining-work-progress>${progressPercent}%</strong>
            </div>
            <div class="mining-operation-progress"><i style="width:${progressPercent}%"></i></div>
            <div class="mining-operation-steps" aria-label="开采流程">
              ${["准备", "开采", "筛料", "回运"].map((label, index) => `<span class="${index < ["prepare", "extract", "sort", "haul"].indexOf(phase.id) ? "done" : index === ["prepare", "extract", "sort", "haul"].indexOf(phase.id) ? "current" : ""}" data-mining-work-step="${index}"><i>${index + 1}</i><b>${label}</b></span>`).join("")}
            </div>
            <div class="mining-operation-stats is-active-stats">
              <span><small>预计产出</small><b>${jobYieldMin}–${jobYieldMax} 块</b></span>
              <span><small>总采矿力</small><b>${Number(job.miningPower) || "—"}</b></span>
              <span><small>本班工资</small><b>${money(job.wageCost || job.cost)}</b></span>
            </div>
            <div class="mining-operation-timing">
              <span>班次计时</span>
              <strong data-mining-countdown="${Number(job.readyAt) || 0}" data-prefix="预计完成">预计完成：${duration(Number(job.readyAt || 0) - now())}</strong>
            </div>
          ` : `
            <div class="mining-operation-ready-copy">
              <small>本班作业方案</small>
              <h4>安排矿工，确认后即可开工</h4>
              <p>${esc(plan.mineProfile.name)}矿层 · 单次耗时 ${duration(mining.shiftMs)}。采矿力越高，额外带回一块原石的机会越高。</p>
            </div>
            <div class="mining-operation-stats is-ready-stats">
              <span><small>总采矿力</small><b>${plan.miningPower}</b></span>
              <span><small>预计产出</small><b>${plan.yieldMin}–${plan.yieldMax} 块</b></span>
              <span><small>事故风险</small><b>${percent(plan.risk)}</b></span>
              <span><small>本次工资</small><b>${money(plan.total)}</b></span>
            </div>
            <div class="mining-operation-readiness" aria-label="开采准备">
              <span class="done"><i>1</i><b>确认矿权</b><small>${esc(mine.name)}</small></span>
              <span class="${crewReady ? "done" : ""}"><i>2</i><b>安排班组</b><small>${crewReady ? `${selectedMinerIds.length} 名矿工` : "选择 1～3 名矿工"}</small></span>
              <span class="${canAfford && shiftFits ? "done" : ""}"><i>3</i><b>核对条件</b><small>${!shiftFits ? "租期时间不足" : !canAfford ? "现金不足" : "工资与租期可用"}</small></span>
            </div>
          `}
        </section>

        <aside class="mining-operation-console">
          ${job ? `
            <div class="mining-operation-console-title">
              <span>井下班组</span>
              <strong>${activeCrew.length} 名矿工正在作业</strong>
            </div>
            <div class="mining-operation-crew-summary">
              <div>${activeCrew.map((miner) => {
                const profile = miningBasicMinerProfile(miner);
                return `<span><i>${esc(String(miner.name || "矿").slice(0, 1))}</i><b>${esc(miner.name)}</b><small>${esc(profile.name)} · 采矿力 ${profile.power}</small></span>`;
              }).join("")}</div>
            </div>
            <div class="mining-operation-shift-note"><b>自动归仓</b><p>本班完成后，原石会自动运回库存，无需停留在当前页面。</p></div>
          ` : `
            <div class="mining-operation-console-title">
              <span>本班安排</span>
              <strong>选择矿工 <em>${selectedMinerIds.length} / ${MINING_BASIC_MAX_CREW}</em></strong>
            </div>
            <div class="mining-basic-crew" id="miningCrewPicker">
              <div class="mining-operation-crew-picks">
                ${miners.length ? miners.map((miner) => {
                  const selected = selectedMinerIds.includes(miner.id);
                  const profile = miningBasicMinerProfile(miner);
                  return `<button class="miner-pick ${selected ? "on" : ""}" data-action="miningToggleMiner" data-payload="${esc(miner.id)}" type="button" aria-pressed="${selected}" ${miner.busy ? "disabled" : ""}><i>${esc(String(miner.name || "矿").slice(0, 1))}</i><span><b>${esc(miner.name)}</b><small>${esc(profile.name)} · 采矿力 ${profile.power}</small></span><em>${money(profile.wage)}</em></button>`;
                }).join("") : `<div class="mining-operation-no-crew"><strong>暂无可用矿工</strong><span>前往队伍页招聘后即可安排开采。</span></div>`}
              </div>
            </div>
            <div class="mining-operation-action">
              <span>额外原石概率 <b>${percent(plan.extraYieldChance)}</b></span>
              ${startAction}
            </div>
          `}
        </aside>
      </div>
    </section>
  `;
}

function leasePanel(mining) {
  if (basicModeEnabled()) return basicLeasePanel(mining);
  const lease = mining.myLease;
  if (!lease) {
    return `<section class="mining-empty-panel"><strong>本轮没有矿权</strong><p>${mining.acceptingApplications
      ? mining.priorityEligible
        ? "提交下一轮志愿并接受调剂后，将按上轮系统落选资格优先分配。"
        : "可主动选择最多三座矿山；未提交志愿则本轮不参与分配。"
      : "等待下一次申请期开放。"}</p></section>`;
  }
  const mine = miningMineById(lease.mineId);
  const job = (playerMining().jobs || []).find((entry) => entry.status === "active");
  const activeIncident = job ? miningShiftIncidentById(job.incidentId) : null;
  const activeIncidentChoice = activeIncident
    ? miningShiftIncidentChoice(activeIncident.id, job.incidentChoiceId)
    : null;
  const incidentPending = Boolean(activeIncident && !activeIncidentChoice);
  const miners = playerMining().miners || [];
  const strategy = MINING_STRATEGIES[selectedStrategyId] || MINING_STRATEGIES.standard;
  const condition = mining.myNextCondition || MINING_SITE_CONDITIONS.stable;
  const preview = shiftPreview(mine, miners, strategy, condition);
  const mineRecord = playerMining().mineRecords?.[mine.id] || {};
  const availableSurveyReports = Number(mineRecord.surveyReports) || 0;
  const canStart = !miningShiftMutationPending
    && !job
    && lease.shiftsStarted < lease.maxShifts
    && selectedMinerIds.length === mine.crewRequired
    && selectedForemanId
    && selectedMinerIds.includes(selectedForemanId)
    && preview.roleDetails.length === selectedMinerIds.length
    && preview.selectedReady
    && now() + Number(mining.shiftMs || 0) <= Number(lease.endsAt || 0);
  return `
    <section class="mining-lease-panel" id="miningLeasePanel">
      <div class="mining-lease-title">
        <div><p class="eyebrow">我的矿权 ${lease.priorityAllocation ? "· 落选优先 " : ""}${lease.allocationMode === "automatic" ? "· 系统随机分配" : lease.allocationMode === "adjusted" ? "· 调剂取得" : lease.preferenceRank ? `· 第 ${lease.preferenceRank} 志愿` : ""}</p><h3>${esc(mine.name)}</h3><p>${esc(mine.focus)} · 本轮 ${lease.shiftsStarted}/${lease.maxShifts} 班</p></div>
        <span data-mining-countdown="${Number(lease.endsAt) || 0}" data-prefix="租期剩余">租期剩余：${duration(Number(lease.endsAt || 0) - now())}</span>
      </div>
      ${job ? `
        <div class="mining-active-job">
          <div><strong>${esc(job.strategyLabel)}班组正在井下作业${incidentPending ? " · 井下急报待处理" : ""}</strong><small>${esc(job.incentiveLabel || miningShiftIncentiveById(job.incentiveId).label)} · ${esc(job.conditionName || "岩层稳定")}${job.preparationNames?.length ? ` · ${esc(job.preparationNames.join("、"))}` : " · 未携带额外物资"} · 班长 ${esc(job.foremanName || "未记录")}${job.foremanLabel ? `（${esc(job.foremanLabel)}）` : ""}${job.roleLabels?.length ? ` · 分工 ${esc(job.roleLabels.join("、"))}` : ""} · 档案 Lv.${Number(job.mineMasteryLevel) || 0} 已锁定 · 默契 Lv.${Number(job.crewBondLevel) || 0} 已锁定${job.surveyReportUsed ? " · 已采用勘探成果" : ""}${activeIncidentChoice ? ` · 急报：${esc(activeIncidentChoice.label)}` : ""}</small></div>
          <span data-mining-countdown="${Number(job.readyAt) || 0}" data-prefix="完成">完成：${duration(Number(job.readyAt || 0) - now())}</span>
          <button class="${incidentPending ? "urgent" : ""}" data-action="miningEnterInterior" type="button">${incidentPending ? "处理井下急报" : "进入矿洞"}</button>
        </div>
      ` : `
        <div class="mining-shift-builder">
          <div class="mining-condition-brief ${esc(condition.tone || "neutral")}">
            <div><span>下一班勘察简报</span><strong>${esc(condition.name)}</strong></div>
            <p>${esc(condition.description)}</p>
            <small>${esc(condition.summary)}</small>
          </div>
          <div class="mining-mastery-summary">
            <div><span>矿山熟悉度</span><strong>Lv.${preview.mastery.level} · ${esc(preview.mastery.name)}</strong></div>
            <p>${esc(miningMineMasteryEffectLabel(preview.mastery.level, { level: true }))}</p>
            <small>档案加成按开工时等级锁定</small>
          </div>
          <div class="mining-survey-use ${preview.surveyReportUsed ? "on" : ""}">
            <div>
              <span>矿脉线索 ${Number(mineRecord.clueProgress) || 0} / ${MINING_CLUE_TARGET}</span>
              <strong>${esc(MINING_SURVEY_REPORT.name)} · 可用 ${availableSurveyReports}/${MINING_MAX_SURVEY_REPORTS}</strong>
              <small>${esc(MINING_SURVEY_REPORT.description)} 勘脉 +${MINING_SURVEY_REPORT.prospectingBonus} · 事故风险 -${Math.round(Math.abs(MINING_SURVEY_REPORT.riskDelta) * 100)}%</small>
            </div>
            <button data-action="miningToggleSurveyReport" type="button" ${availableSurveyReports ? "" : "disabled"}>${preview.surveyReportUsed ? "✓ 本班使用" : availableSurveyReports ? "用于本班" : "暂无成果"}</button>
          </div>
          <div>
            <strong>选择 ${mine.crewRequired} 名矿工</strong>
            ${crewShortcutPanel(mine, miners)}
            <div class="mining-crew-picks">
              ${miners.length ? miners.map((miner) => {
                const selected = selectedMinerIds.includes(miner.id);
                const condition = minerCondition(miner);
                const contract = miningMinerContractInfo(miner);
                const unavailable = miner.busy || !condition.ready || contract.expired;
                const status = miner.busy
                  ? "井下作业"
                  : contract.expired
                    ? "合约待续"
                    : condition.ready
                      ? `T${miner.tier} · 合约${contract.remaining}班 · 疲劳${Math.round(condition.fatigue)} · 士气${miningMinerMoraleInfo(miner).morale}`
                      : condition.label;
                return `<button class="miner-pick ${selected ? "on" : ""}" data-action="miningToggleMiner" data-payload="${esc(miner.id)}" type="button" ${unavailable ? "disabled" : ""}>${esc(miner.name)} · ${esc(status)}</button>`;
              }).join("") : `<span class="muted">还没有矿工，请前往“矿工队伍”招聘。</span>`}
            </div>
          </div>
          <div class="mining-morale-summary ${esc(preview.morale.tone)}">
            <div><span>班组平均士气</span><strong>${preview.selectedCount ? `${preview.morale.morale} · ${esc(preview.morale.name)}` : "待排班"}</strong></div>
            <p>${preview.selectedCount ? esc(preview.moraleEffectLabel) : "选齐矿工后显示实际班组影响"}</p>
            <small>${preview.selectedCount ? `顺利完班预计每人士气 ${preview.moraleShiftDelta >= 0 ? "+" : ""}${preview.moraleShiftDelta}；事故与伤停会追加损耗` : "士气会影响井下技能、事故风险与续约费用"}</small>
          </div>
          <div class="mining-crew-bond-summary ${preview.crewBond.level ? "active" : ""}">
            <div><span>班组默契</span><strong>Lv.${preview.crewBond.level} · ${esc(preview.crewBond.name)}</strong></div>
            <p>${esc(miningCrewBondEffectLabel(preview.crewBond.level, { level: true }))}</p>
            <small>${selectedMinerIds.length !== mine.crewRequired
              ? "选齐班组后显示对应默契"
              : preview.crewNextAt == null
                ? `已共同完成 ${preview.crewShifts} 班 · 默契已满`
                : `已共同完成 ${preview.crewShifts} 班 · 再合作 ${Math.max(0, preview.crewNextAt - preview.crewShifts)} 班升级`}</small>
          </div>
          <div class="mining-foreman-panel">
            <div><strong>值班班长</strong><small>最强技能决定当班指挥方向，开工后锁定</small></div>
            <div class="mining-foreman-picks">
              ${selectedMinerIds.length ? miners.filter((miner) => selectedMinerIds.includes(miner.id)).map((miner) => {
                const info = miningForemanInfo(miner);
                return `<button class="${selectedForemanId === miner.id ? "on" : ""}" data-action="miningSelectForeman" data-payload="${esc(miner.id)}" type="button" aria-pressed="${selectedForemanId === miner.id}"><b>${esc(miner.name)}</b><span>${esc(info.label)} · ${esc(info.effectLabel)}</span></button>`;
              }).join("") : `<span class="muted">先选择完整班组，再指定值班班长。</span>`}
            </div>
          </div>
          <div class="mining-role-panel">
            <div><strong>井下岗位分工</strong><small>每人一岗 · 同岗不可重复 · 开工后锁定</small></div>
            <div class="mining-role-grid">
              ${Object.values(MINING_SHIFT_ROLES).map((role) => {
                const assigneeId = selectedRoleAssignments[role.key];
                const assignee = miners.find((miner) => miner.id === assigneeId);
                return `
                  <section class="mining-role-card ${assignee ? "filled" : "vacant"}">
                    <header><span>${esc(role.label)}</span><b>${assignee ? esc(assignee.name) : "本班空缺"}</b></header>
                    <small>${esc(role.skillLabel)} +${MINING_ROLE_SKILL_BONUS} · 负责人${esc(role.skillLabel)}经验 +${MINING_ROLE_EXPERIENCE}</small>
                    <div>${selectedMinerIds.map((minerId) => {
                      const miner = miners.find((entry) => entry.id === minerId);
                      if (!miner) return "";
                      const assigned = assigneeId === miner.id;
                      return `<button class="${assigned ? "on" : ""}" data-action="miningAssignRole" data-payload="${role.key}:${esc(miner.id)}" type="button" aria-pressed="${assigned}">${esc(miner.name)} · Lv.${Math.round(miningMinerEffectiveSkill(miner, role.key))}</button>`;
                    }).join("")}</div>
                  </section>
                `;
              }).join("")}
            </div>
            <p>${selectedMinerIds.length
              ? selectedMinerIds.length < Object.keys(MINING_SHIFT_ROLES).length
                ? `当前 ${selectedMinerIds.length} 人班组需取舍一个岗位；系统已按技能自动匹配，可手动交换。`
                : "三个岗位已完整编组；调整负责人可定向培养不同矿工。"
              : "选择当班矿工后自动安排岗位。"}</p>
          </div>
          <div>
            <strong>开采方案</strong>
            <div class="mining-strategy-picks">
              ${Object.values(MINING_STRATEGIES).map((strategy) => `<button class="${selectedStrategyId === strategy.id ? "on" : ""}" data-action="miningSelectStrategy" data-payload="${strategy.id}" type="button"><b>${strategy.label}</b><span>${strategy.description}</span></button>`).join("")}
            </div>
          </div>
          <div>
            <strong>班次激励 <small class="muted">只影响本班矿工工资与作业表现</small></strong>
            <div class="mining-incentive-picks">
              ${Object.values(MINING_SHIFT_INCENTIVES).map((incentiveOption) => `<button class="${selectedIncentiveId === incentiveOption.id ? "on" : ""}" data-action="miningSelectIncentive" data-payload="${incentiveOption.id}" type="button"><b>${esc(incentiveOption.label)}</b><span>${esc(incentiveOption.description)}</span><small>${esc(incentiveOption.effectLabel)}</small></button>`).join("")}
            </div>
          </div>
          <div>
            <strong>班前物资 <small class="muted">最多选择 ${MINING_MAX_PREPARATIONS} 项，仅本班消耗</small></strong>
            <div class="mining-preparation-picks">
              ${Object.values(MINING_PREPARATIONS).map((preparation) => {
                const selected = selectedPreparationIds.includes(preparation.id);
                return `<button class="${selected ? "on" : ""}" data-action="miningTogglePreparation" data-payload="${preparation.id}" type="button"><b>${esc(preparation.name)} · ${money(preparation.cost)}</b><span>${esc(preparation.description)}</span></button>`;
              }).join("")}
            </div>
          </div>
          <div class="mining-shift-quote">
            <div><span>${preview.selectedCount === mine.crewRequired ? "班次支出" : "当前估算"}</span><strong>${money(preview.cost)}</strong><small>耗材 ${money(mine.supplies)} + 物资 ${money(preview.preparationCost)} + 工资 ${money(preview.wageCost)}${preview.incentivePremium ? `（激励 +${money(preview.incentivePremium)}）` : ""}</small></div>
            <div><span>预计出料</span><strong>${preview.yieldMin}–${preview.yieldMax} 块</strong><small>追加一块 ${percent(preview.extraYieldChance)} · 单块升档 ${percent(preview.upgradeChance)} · 线索 +${preview.clueGain}</small></div>
            <div><span>事故风险</span><strong>${riskLabel(preview.risk)} · ${percent(preview.risk)}</strong><small>环境、矿工、设施与物资均已计入 · 疲劳 +${preview.fatigueMin === preview.fatigueMax ? preview.fatigueMin : `${preview.fatigueMin}–${preview.fatigueMax}`}</small></div>
          </div>
          <button class="primary-btn mining-start-btn" data-action="miningStartShift" type="button" ${canStart ? "" : "disabled"} ${miningShiftMutationPending ? `aria-busy="true"` : ""}>${miningShiftMutationPending ? "正在提交开工…" : `开始 ${duration(mining.shiftMs)} 开采班次`}</button>
        </div>
      `}
    </section>
  `;
}

function miningPortalPath(portal) {
  const width = portal.width;
  const height = portal.height;
  const shoulderY = Math.max(6, Math.round(height * 0.48));
  const floorY = height - 1;
  return `M 1 ${floorY} L 1 ${shoulderY} C 1 3 ${Math.round(width * 0.24)} 1 ${Math.round(width * 0.5)} 1 C ${Math.round(width * 0.76)} 1 ${width - 1} 3 ${width - 1} ${shoulderY} L ${width - 1} ${floorY} Z`;
}

function mineMapMarker(mine, mining, index, locked = false) {
  const portal = MINING_MAP_PORTALS[index] || { x: MINING_MAP_WIDTH / 2, y: MINING_MAP_HEIGHT / 2, width: 24, height: 22 };
  const centerX = portal.x + (portal.width / 2);
  const centerY = portal.y + (portal.height / 2);
  const lease = (mining.currentRound?.leases || []).find((entry) => entry.mineId === mine.id);
  const preferenceRank = preferenceDraft.indexOf(mine.id);
  const isMine = mining.myLease?.mineId === mine.id;
  const selected = focusedMineId === mine.id;
  const ownerName = String(lease?.playerName || (isMine ? mining.myLease?.playerName : "") || "未知玩家");
  const status = isMine
    ? `我的矿洞，承租人 ${ownerName}`
    : preferenceRank >= 0
      ? `第 ${preferenceRank + 1} 志愿`
      : lease
        ? `已由 ${ownerName} 承租`
        : locked
          ? "待开放"
          : "待租";
  return `
    <button
      class="mining-map-marker ${selected ? "selected" : ""} ${lease ? "occupied" : "available"} ${isMine ? "mine-owned" : ""} ${preferenceRank >= 0 ? "preferred" : ""}"
      style="left:${centerX}px;top:${centerY}px;--portal-width:${portal.width}px;--portal-height:${portal.height}px"
      data-action="miningFocusMine"
      data-payload="${esc(mine.id)}"
      data-mine-id="${esc(mine.id)}"
      type="button"
      aria-pressed="${selected}"
      aria-label="${esc(mine.name)}，${esc(status)}"
    >
      <svg
        class="mining-map-marker-svg"
        viewBox="0 0 ${portal.width} ${portal.height}"
        style="width:${portal.width}px;height:${portal.height}px"
        aria-hidden="true"
        focusable="false"
      >
        <path class="mining-map-marker-shape" d="${miningPortalPath(portal)}"></path>
      </svg>
      ${isMine ? `<span class="mining-map-marker-owner" aria-hidden="true"><i></i>我的矿洞</span>` : ""}
      ${preferenceRank >= 0 ? `<span class="mining-map-marker-preference" aria-hidden="true"><b>${preferenceRank + 1}</b><em>志愿</em></span>` : ""}
      <span class="mining-map-marker-copy">
        <b>${esc(mine.name)}</b>
        ${preferenceRank >= 0
          ? `<small>第 ${preferenceRank + 1} 志愿</small>`
          : lease
            ? `<small>${isMine ? "我的矿洞" : `${esc(ownerName)} 承租`}</small>`
            : ""}
      </span>
    </button>
  `;
}

function mineInspectorContent(mine, mining, locked = false) {
  const lease = (mining.currentRound?.leases || []).find((entry) => entry.mineId === mine.id);
  const preferenceRank = preferenceDraft.indexOf(mine.id);
  const isMine = mining.myLease?.mineId === mine.id;
  const canChoose = !locked && mining.acceptingApplications && mining.playerQualified && !isMine;
  const preferenceQuote = miningPreferenceQuote(mine, mining);
  const canAffordPreference = preferenceRank >= 0 || preferenceQuote.affordable;
  const basicProfile = miningBasicMineProfile(mine);
  const ownerName = String(lease?.playerName || (isMine ? mining.myLease?.playerName : "") || "未知玩家");
  const status = isMine ? "我的矿洞" : lease ? "已由其他玩家承租" : locked ? "矿区开放后可申请" : "当前待租";
  const ownerLabel = isMine ? `${ownerName}（你）` : lease ? ownerName : locked ? "等待矿区开放" : "暂无承租人";
  const ownerMeta = lease
    ? `本轮租期至 ${new Date(Number(lease.endsAt) || 0).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
    : mining.acceptingApplications
      ? "本轮仍可提交矿权志愿"
      : "等待下一轮矿权分配";
  const intro = isMine
    ? "这是你本轮取得的矿洞，可返回租赁页安排矿工开采。"
    : lease
      ? "这座矿洞本轮已有归属，可以查看承租人和矿山信息。"
      : "确认矿山品质、租金和产出后，可将其加入本轮矿权志愿。";
  const unavailableMessage = locked
    ? "取得采矿资格后可提交矿权志愿。"
    : isMine && mining.acceptingApplications
      ? "本轮正在承租这座矿山，下一轮不可连续选择。"
      : isMine
        ? "这座矿山已归你承租，关闭详情后可在租赁页安排开采。"
        : "当前不在矿权申请期，请等待下一轮申请开放。";
  return `
      <header class="game-modal-head mining-mine-dialog-head">
        <div class="game-modal-title">
          <span>${esc(mine.beltLabel)} · ${esc(mine.id.toUpperCase())}</span>
          <h3 id="miningMineDialogTitle">${esc(mine.name)}</h3>
          <p>${esc(mine.focus)} · ${status}</p>
        </div>
        <button class="modal-close" data-action="miningCloseMineInspector" type="button" aria-label="关闭矿洞详情">×</button>
      </header>
      <div class="game-modal-body mining-mine-dialog-body">
        <p class="mining-mine-dialog-intro">${esc(intro)}</p>
        <div class="mining-mine-dialog-owner ${isMine ? "is-mine" : lease ? "is-occupied" : "is-available"}">
          <span>承租人</span>
          <strong>${esc(ownerLabel)}</strong>
          <small>${esc(ownerMeta)}</small>
        </div>
        <dl class="mining-mine-dialog-stats">
          <div><dt>品质</dt><dd>${esc(basicProfile.name)}</dd></div>
          <div><dt>主产</dt><dd>${esc(mineQualities(mine))}</dd></div>
          <div><dt>租金</dt><dd>${money(mine.rent)}${Number(mine.baseRent) && Number(mine.baseRent) !== Number(mine.rent) ? ` <small>基准 ${money(mine.baseRent)}</small>` : ""}</dd></div>
          <div><dt>基础产出</dt><dd>${basicProfile.yieldMin}–${basicProfile.yieldMax} 块${Number(mine.outputMultiplier) && Number(mine.outputMultiplier) !== 1 ? ` <small>版本调整 ${signedPercent(Number(mine.outputMultiplier) - 1)}</small>` : ""}</dd></div>
        </dl>
        ${canChoose && !canAffordPreference
          ? `<p class="mining-mine-dialog-note">现金与已冻结租金不足，至少需要 ${money(preferenceQuote.nextEscrow)} 才能选择这座矿山。</p>`
          : canChoose
            ? ""
            : `<p class="mining-mine-dialog-note">${esc(unavailableMessage)}</p>`}
      </div>
      <footer class="game-modal-actions mining-mine-dialog-actions">
        <button class="ghost-btn" data-action="miningCloseMineInspector" type="button">返回地图</button>
        ${canChoose
          ? `<button class="primary-btn mine-pick ${preferenceRank >= 0 ? "on" : ""}" data-action="miningTogglePreference" data-payload="${esc(mine.id)}" type="button" ${preferenceMutationPending || !canAffordPreference ? "disabled" : ""}>${preferenceMutationPending
            ? "正在保存志愿…"
            : preferenceRank >= 0
              ? `移出第 ${preferenceRank + 1} 志愿`
              : canAffordPreference
                ? `设为第 ${preferenceDraft.length + 1} 志愿`
                : `现金不足 · 需 ${money(preferenceQuote.nextEscrow)}`}</button>`
          : ""}
      </footer>
  `;
}

function mineInspectorRoot() {
  let root = document.querySelector("#miningMineInspectorRoot");
  if (!root) {
    root = document.createElement("div");
    root.id = "miningMineInspectorRoot";
    root.className = "modal-root mining-mine-modal-root";
    root.hidden = true;
    document.body.appendChild(root);
  }
  return root;
}

function closeMineInspector() {
  mineInspectorVisible = false;
  mineInspectorRenderKey = "";
  mineInspectorModalLifecycleCleanup?.();
  mineInspectorModalLifecycleCleanup = null;
  const root = document.querySelector("#miningMineInspectorRoot");
  if (!root) return;
  root.hidden = true;
  root.replaceChildren();
}

function renderMineInspector(mining, { locked = false } = {}) {
  if (!mineInspectorVisible || getActiveView() !== "mining" || (!locked && activeTab !== "mines")) {
    closeMineInspector();
    return;
  }
  const mine = effectiveMiningMineById(focusedMineId, mining);
  if (!mine) {
    closeMineInspector();
    return;
  }
  const root = mineInspectorRoot();
  const lease = (mining.currentRound?.leases || []).find((entry) => entry.mineId === mine.id);
  const renderKey = JSON.stringify({
    mineId: mine.id,
    rent: Number(mine.rent) || 0,
    outputMultiplier: Number(mine.outputMultiplier) || 1,
    locked: Boolean(locked),
    leaseId: lease?.id || "",
    leasePlayerName: lease?.playerName || "",
    leaseEndsAt: Number(lease?.endsAt) || 0,
    myLeaseId: mining.myLease?.id || "",
    preferenceRank: preferenceDraft.indexOf(mine.id),
    preferenceMutationPending,
    playerCash: Number(getState()?.me?.cash) || 0,
    applicationEscrow: Number(mining.myApplication?.escrow) || 0,
    acceptingApplications: Boolean(mining.acceptingApplications),
    playerQualified: Boolean(mining.playerQualified)
  });
  if (
    !root.hidden
    && mineInspectorRenderKey === renderKey
    && root.querySelector('[role="dialog"]')
  ) return;
  mineInspectorModalLifecycleCleanup?.();
  mineInspectorModalLifecycleCleanup = null;
  root.innerHTML = `
    <section class="game-modal game-modal--compact mining-mine-dialog ${locked ? "locked" : ""}" role="dialog" aria-modal="true" aria-labelledby="miningMineDialogTitle">
      ${mineInspectorContent(mine, mining, locked)}
    </section>
  `;
  root.hidden = false;
  mineInspectorRenderKey = renderKey;
  mineInspectorModalLifecycleCleanup = activateModalLifecycle({
    root,
    dialog: root.querySelector('[role="dialog"]'),
    shell: document.querySelector(".shell"),
    onClose: closeMineInspector
  });
}

function miningMap(mining, { locked = false } = {}) {
  if (!miningMineById(focusedMineId)) {
    focusedMineId = mining.myLease?.mineId || preferenceDraft[0] || MINES[0]?.id || "";
  }
  const focusedMine = effectiveMiningMineById(focusedMineId, mining) || effectiveMiningMines(mining)[0];
  return `
    <section class="mining-map-shell ${locked ? "is-locked" : ""}" aria-label="三十座矿口分布图">
      <div class="mining-map-head">
        <div><strong>矿口分布图</strong><span>拖动查看 · 滚轮或双指缩放</span></div>
        <div class="mining-map-head-actions">
          <div class="mining-map-legend" aria-label="矿洞状态说明">
            <span class="mine"><i></i>我的矿洞</span>
            <span class="preferred"><i></i>已选志愿</span>
            <span class="occupied"><i></i>已承租</span>
          </div>
          ${mining.myLease ? `<button class="mining-map-own-action" data-action="miningGoToLease" type="button">${activeMiningJob() ? "查看开采进度" : "前往我的矿洞开采"}</button>` : ""}
        </div>
      </div>
      <nav class="mining-belt-nav" aria-label="矿带快速定位">
        ${MINING_MAP_BELTS.map((belt) => `
          <button class="${focusedMine?.beltId === belt.id ? "on" : ""}" data-action="miningFocusBelt" data-payload="${belt.id}" type="button">
            <b>${belt.label}</b><small>${belt.hint} · 6 处</small>
          </button>
        `).join("")}
      </nav>
      <div class="mining-map-viewport" id="miningMapViewport">
        <div class="mining-map-scene" id="miningMapScene">
          ${MINING_MAP_BELTS.map((belt) => `<span class="mining-map-belt-label" style="left:${belt.x}%"><b>${belt.label}</b><small>${belt.hint}</small></span>`).join("")}
          ${effectiveMiningMines(mining).map((mine, index) => mineMapMarker(mine, mining, index, locked)).join("")}
        </div>
        <button class="mining-map-edge previous" data-action="miningMapNudge" data-payload="left" type="button" aria-label="向左查看">‹</button>
        <button class="mining-map-edge next" data-action="miningMapNudge" data-payload="right" type="button" aria-label="向右查看">›</button>
        <div class="mining-map-zoom" aria-label="地图缩放">
          <button data-action="miningMapZoom" data-payload="out" type="button" aria-label="缩小地图">−</button>
          <span data-mining-map-zoom>${Math.round(miningMapZoom * 100)}%</span>
          <button data-action="miningMapZoom" data-payload="in" type="button" aria-label="放大地图">＋</button>
          <button data-action="miningMapZoom" data-payload="reset" type="button">复位</button>
        </div>
      </div>
    </section>
  `;
}

function miningMapElements() {
  return {
    viewport: document.querySelector("#miningMapViewport"),
    scene: document.querySelector("#miningMapScene")
  };
}

function clampMiningMapPan(viewport, zoom = miningMapZoom, value = miningMapPanX) {
  const scaledWidth = MINING_MAP_WIDTH * zoom;
  if (scaledWidth <= viewport.clientWidth) return (viewport.clientWidth - scaledWidth) / 2;
  return clamp(value, viewport.clientWidth - scaledWidth, 0);
}

function paintMiningMap() {
  const { viewport, scene } = miningMapElements();
  if (!viewport || !scene) return;
  miningMapPanX = clampMiningMapPan(viewport);
  const panY = (viewport.clientHeight - (MINING_MAP_HEIGHT * miningMapZoom)) / 2;
  scene.style.transform = `translate3d(${Math.round(miningMapPanX)}px, ${Math.round(panY)}px, 0) scale(${miningMapZoom})`;
  viewport.dataset.zoom = miningMapZoom < 0.76 ? "far" : miningMapZoom > 1.05 ? "near" : "normal";
  const label = viewport.querySelector("[data-mining-map-zoom]");
  if (label) label.textContent = `${Math.round(miningMapZoom * 100)}%`;
}

function setMiningMapZoom(nextZoom, anchorX = null) {
  const { viewport } = miningMapElements();
  if (!viewport) return;
  const oldZoom = miningMapZoom;
  const localAnchor = anchorX == null ? viewport.clientWidth / 2 : anchorX;
  const worldX = (localAnchor - miningMapPanX) / oldZoom;
  miningMapZoom = clamp(nextZoom, MINING_MAP_MIN_ZOOM, MINING_MAP_MAX_ZOOM);
  miningMapPanX = localAnchor - (worldX * miningMapZoom);
  paintMiningMap();
}

function centerMiningMapMine(mineId) {
  const { viewport } = miningMapElements();
  const index = MINES.findIndex((mine) => mine.id === mineId);
  if (!viewport || index < 0) return;
  const portal = MINING_MAP_PORTALS[index];
  const centerX = portal ? portal.x + (portal.width / 2) : MINING_MAP_WIDTH / 2;
  miningMapPanX = (viewport.clientWidth / 2) - (centerX * miningMapZoom);
  viewport.classList.add("is-centering");
  paintMiningMap();
  window.setTimeout(() => viewport.classList.remove("is-centering"), 260);
}

function bindMiningMap() {
  const { viewport } = miningMapElements();
  if (!viewport) return;
  paintMiningMap();
  if (pendingMineFocusId) {
    const mineId = pendingMineFocusId;
    pendingMineFocusId = "";
    window.requestAnimationFrame(() => centerMiningMapMine(mineId));
  }

  const pointers = new Map();
  let dragStart = null;
  let pinchStart = null;

  const resetSingleDrag = () => {
    const first = [...pointers.values()][0];
    dragStart = first ? { x: first.x, panX: miningMapPanX } : null;
  };

  viewport.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    viewport.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    viewport.classList.add("is-dragging");
    if (pointers.size === 1) resetSingleDrag();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const midpoint = (a.x + b.x) / 2 - viewport.getBoundingClientRect().left;
      pinchStart = {
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        zoom: miningMapZoom,
        worldX: (midpoint - miningMapPanX) / miningMapZoom
      };
    }
  });

  viewport.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1 && dragStart) {
      miningMapPanX = dragStart.panX + event.clientX - dragStart.x;
      paintMiningMap();
    } else if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const midpoint = (a.x + b.x) / 2 - viewport.getBoundingClientRect().left;
      miningMapZoom = clamp(pinchStart.zoom * (distance / pinchStart.distance), MINING_MAP_MIN_ZOOM, MINING_MAP_MAX_ZOOM);
      miningMapPanX = midpoint - (pinchStart.worldX * miningMapZoom);
      paintMiningMap();
    }
  });

  const releasePointer = (event) => {
    pointers.delete(event.pointerId);
    pinchStart = null;
    if (pointers.size === 1) resetSingleDrag();
    if (!pointers.size) {
      dragStart = null;
      viewport.classList.remove("is-dragging");
    }
  };
  viewport.addEventListener("pointerup", releasePointer);
  viewport.addEventListener("pointercancel", releasePointer);

  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      miningMapPanX -= event.deltaX;
      paintMiningMap();
      return;
    }
    const rect = viewport.getBoundingClientRect();
    setMiningMapZoom(miningMapZoom + (event.deltaY < 0 ? 0.08 : -0.08), event.clientX - rect.left);
  }, { passive: false });
}

function minesView(mining) {
  if (basicModeEnabled()) {
    return `
      ${roundSummary(mining)}
      ${miningRecoveryNotice(mining)}
      ${rosterParticipationNotice(mining)}
      ${applicationBar(mining)}
      ${competitionInsightsPanel(mining)}
      ${miningMap(mining)}
    `;
  }
  return `
    ${roundSummary(mining)}
    ${miningRecoveryNotice(mining)}
    ${rosterParticipationNotice(mining)}
    ${applicationBar(mining)}
    ${competitionInsightsPanel(mining)}
    ${miningMap(mining)}
  `;
}

function miningWorkView(mining) {
  if (basicModeEnabled()) return basicLeasePanel(mining);
  const job = activeMiningJob();
  if (!job) {
    mineInteriorVisible = false;
    mineInteriorJobId = "";
    focusedInteriorMinerId = "";
  } else if (mineInteriorJobId !== job.id) {
    mineInteriorJobId = job.id;
    mineInteriorVisible = true;
    focusedInteriorMinerId = job.foremanId || job.minerIds?.[0] || "";
  }
  if (job && mineInteriorVisible) {
    return miningInteriorView(mining, job);
  }
  return leasePanel(mining);
}

function miningRecruitAction(miner) {
  const price = Math.max(0, Math.round(Number(miner?.price) || 0));
  const rosterFull = (playerMining().miners?.length || 0) >= MINING_MAX_MINERS;
  const affordable = (Number(getState()?.me?.cash) || 0) >= price;
  return {
    disabled: candidateRefreshMutationPending || minerRosterMutationPending || rosterFull || !affordable,
    label: candidateRefreshMutationPending
      ? "名单刷新中"
      : minerRosterMutationPending
        ? "名单更新中"
        : rosterFull
          ? "队伍已满"
          : affordable ? "招聘" : "现金不足"
  };
}

function basicMinerCard(miner, candidate = false) {
  const profile = miningBasicMinerProfile(miner);
  const lastRequiredMiner = !candidate && (playerMining().miners?.length || 0) <= 1;
  const statusLabel = candidate ? "待招募" : miner.busy ? "开采中" : "空闲";
  const recruitAction = candidate ? miningRecruitAction(miner) : null;
  return `
    <article class="miner-card miner-basic-card ${candidate ? "is-candidate" : ""} ${miner.busy ? "busy" : ""}">
      <div class="miner-basic-card-head">
        <div>
          <h3>${esc(miner.name)}</h3>
          <p>${esc(profile.name)} · ${Number(profile.tier) || 1} 阶</p>
        </div>
        <span class="miner-basic-status ${miner.busy ? "is-busy" : candidate ? "is-candidate" : "is-idle"}">${statusLabel}</span>
      </div>
      <div class="miner-basic-profile">
        <span><small>采矿力</small><b>${profile.power}</b></span>
        ${candidate ? "" : `<span><small>完成开采</small><b>${Number(miner.shiftsWorked) || 0} 次</b></span>`}
      </div>
      <div class="miner-basic-cost">
        <span>${candidate ? "招聘费用" : "单次工资"}</span>
        <strong>${candidate ? money(miner.price) : `${money(profile.wage)} / 次`}</strong>
      </div>
      ${candidate
        ? `<button class="miner-basic-action" data-action="miningRecruitMiner" data-payload="${esc(miner.id)}" type="button" ${recruitAction.disabled ? "disabled" : ""}>${recruitAction.label}</button>`
        : `<button class="miner-basic-action danger-link" data-action="miningDismissMiner" data-payload="${esc(miner.id)}" type="button" ${candidateRefreshMutationPending || minerRosterMutationPending || miner.busy || lastRequiredMiner ? "disabled" : ""}>${candidateRefreshMutationPending ? "名单刷新中" : minerRosterMutationPending ? "名单更新中" : lastRequiredMiner ? "至少保留 1 名矿工" : "解雇"}</button>`}
    </article>
  `;
}

function minerCard(miner, candidate = false) {
  if (basicModeEnabled()) return basicMinerCard(miner, candidate);
  const condition = minerCondition(miner);
  const contract = miningMinerContractInfo(miner);
  const tierBonus = miningMinerTierBonus(miner);
  const rosterStatus = contract.expired ? "合约待续" : condition.label;
  const recruitAction = candidate ? miningRecruitAction(miner) : null;
  return `
    <article class="miner-card ${miner.busy ? "busy" : ""} ${!candidate && (!condition.ready || contract.expired) ? "unavailable" : ""}">
      <div class="miner-card-title"><strong>${esc(miner.name)}</strong><span>T${miner.tier}${miner.busy ? " · 井下" : !candidate ? ` · ${esc(rosterStatus)}` : ` · 三项 +${tierBonus.toFixed(1)}`}</span></div>
      <p><b>${esc(miner.trait || "稳健")}</b>：${esc(miningMinerEffectLabel("trait", miner.trait))}<br><b>${esc(miner.flaw || "暂无")}</b>：${esc(miningMinerEffectLabel("flaw", miner.flaw))}</p>
      ${minerMoralePanel(miner, candidate)}
      ${candidate ? "" : minerRetentionPanel(miner)}
      ${candidate ? `<div class="miner-skills">
        ${minerSkill(miner, "prospecting", "勘脉")}
        ${minerSkill(miner, "extraction", "采掘")}
        ${minerSkill(miner, "safety", "安全")}
      </div>` : `<div class="miner-training-grid">${Object.values(MINER_TRAINING_PROGRAMS).map((training) => minerTrainingRow(miner, training, condition)).join("")}</div>`}
      ${candidate ? "" : minerPromotionPanel(miner)}
      ${candidate ? "" : minerSpecializationPanel(miner)}
      ${candidate ? "" : minerContractPanel(miner)}
      ${candidate ? "" : `<div class="miner-condition ${condition.tone}"><span><i style="width:${Math.max(0, Math.min(100, condition.fatigue))}%"></i></span><small>${condition.ready ? "离线期间会自动休整" : esc(condition.label)}</small></div>`}
      ${candidate ? "" : minerCarePanel(miner, condition)}
      <div class="miner-card-foot">
        <span>${candidate ? `招聘 ${money(miner.price)} · 含 ${MINER_INITIAL_CONTRACT_SHIFTS} 班首约` : `班薪基准 ${money(miner.baseWage)}`}</span>
        ${candidate
          ? `<button data-action="miningRecruitMiner" data-payload="${esc(miner.id)}" type="button" ${recruitAction.disabled ? "disabled" : ""}>${recruitAction.label}</button>`
          : `<button class="danger-link" data-action="miningDismissMiner" data-payload="${esc(miner.id)}" type="button" ${candidateRefreshMutationPending || minerRosterMutationPending || miner.busy || miner.retentionCase ? "disabled" : ""}>${candidateRefreshMutationPending ? "名单刷新中" : minerRosterMutationPending ? "名单更新中" : miner.retentionCase ? "请先处理离职申请" : "解雇"}</button>`}
      </div>
    </article>
  `;
}

function crewRecordsView(mining) {
  const miners = mining.miners || [];
  const mine = miningMineById(stateMining().myLease?.mineId);
  const records = Object.entries(mining.crewRecords || {})
    .filter(([, record]) => Number(record?.shifts) > 0)
    .map(([crewKey, record]) => ({ crewKey, record }))
    .sort((left, right) => (Number(right.record.shifts) || 0) - (Number(left.record.shifts) || 0));
  if (!records.length) return "";
  return `
    <section class="miner-section miner-crew-section">
      <h4>班组默契</h4>
      <div class="miner-crew-records">${records.map(({ crewKey, record }) => {
        const bond = miningCrewBondInfo(record);
        const nextAt = miningCrewBondNextAt(record);
        const shifts = Number(record.shifts) || 0;
        const assignment = crewAssignmentFor(crewKey, record, mine, miners);
        const canAssignHere = mine && assignment.minerIds.length === mine.crewRequired;
        return `
          <article>
            <div><strong>${esc((record.minerNames || []).join("、") || "未命名班组")}</strong><span>Lv.${bond.level} · ${esc(bond.name)}</span></div>
            <p>${esc(miningCrewBondEffectLabel(bond.level, { level: true }))}</p>
            <footer>
              <small>共同完成 ${shifts} 班${nextAt == null ? " · 默契已满" : ` · 再合作 ${Math.max(0, nextAt - shifts)} 班升级`}</small>
              ${canAssignHere ? `<button data-action="miningAssignCrew" data-payload="${esc(assignment.key)}" type="button" ${assignment.ready ? "" : "disabled"}>${assignment.ready ? assignment.selected ? "已排班" : "安排下班" : esc(assignment.unavailableReason)}</button>` : ""}
            </footer>
          </article>
        `;
      }).join("")}</div>
    </section>
  `;
}

function mentorshipsView(mining) {
  const miners = mining.miners || [];
  const mentorships = mining.mentorships || [];
  const active = mentorships.filter((entry) => entry.status === "active");
  const completed = mentorships.filter((entry) => entry.status === "completed").slice(0, 4);
  const pairs = [];
  for (const mentor of miners) {
    for (const apprentice of miners) {
      const eligibility = miningMentorshipEligibility(mentor, apprentice, mentorships);
      if (eligibility.ready) pairs.push({ mentor, apprentice, eligibility });
    }
  }
  const cash = Number(getState()?.me?.cash) || 0;
  return `
    <section class="miner-section miner-mentorship-section">
      <div class="miner-mentorship-head">
        <div><h4>师徒带教</h4><p>T${MINER_MENTOR_REQUIRED_TIER} 以上且完成 ${MINER_MENTOR_REQUIRED_SHIFTS} 班的矿工可带一名低阶新人；师徒同班才累计进度。</p></div>
        <span>已结业 ${Number(mining.stats?.mentorshipsCompleted) || 0} 对 · 投入 ${money(mining.stats?.mentorshipSpent)}</span>
      </div>
      ${active.length ? `<div class="miner-mentorship-active">${active.map((record) => {
        const progress = miningMentorshipProgress(record);
        const mentor = miners.find((entry) => entry.id === record.mentorId);
        const apprentice = miners.find((entry) => entry.id === record.apprenticeId);
        const disabled = Boolean(mentor?.busy || apprentice?.busy);
        return `
          <article>
            <div><strong>${esc(record.mentorName)} → ${esc(record.apprenticeName)}</strong><span>${progress.sharedShifts} / ${progress.requiredShifts} 班</span></div>
            <i aria-label="带教进度"><em style="width:${progress.percent}%"></em></i>
            <p>同班时学徒岗位经验 +${MINER_MENTORSHIP_ROLE_EXP}，双方获得额外士气；再共同完成 ${progress.remaining} 班结业。</p>
            <button data-action="miningEndMentorship" data-payload="${esc(record.id)}" type="button" ${disabled ? "disabled" : ""}>${disabled ? "井下作业中" : "终止带教"}</button>
          </article>
        `;
      }).join("")}</div>` : `<p class="mining-empty-copy">当前没有进行中的师徒带教。</p>`}
      <div class="miner-mentorship-offers">
        <strong>可签订带教</strong>
        ${pairs.length ? `<div>${pairs.map(({ mentor, apprentice, eligibility }) => {
          const disabled = mentor.busy || apprentice.busy || mentor.retentionCase || apprentice.retentionCase || cash < eligibility.cost;
          return `
            <button data-action="miningFormMentorship" data-payload="${esc(mentor.id)}|${esc(apprentice.id)}" type="button" ${disabled ? "disabled" : ""}>
              <b>${esc(mentor.name)} 带教 ${esc(apprentice.name)}</b>
              <span>${cash < eligibility.cost ? `资金不足 · ${money(eligibility.cost)}` : `签订协议 · ${money(eligibility.cost)}`}</span>
            </button>
          `;
        }).join("")}</div>` : `<p>暂无合适组合。师傅需满足评级和班次要求，学徒评级必须低于师傅，且每人同时只能参与一组带教。</p>`}
      </div>
      ${completed.length ? `<div class="miner-mentorship-history"><strong>最近结业</strong>${completed.map((record) => `<span>${esc(record.mentorName)} → ${esc(record.apprenticeName)} · ${MINER_MENTORSHIP_REQUIRED_SHIFTS} 班结业</span>`).join("")}</div>` : ""}
    </section>
  `;
}

function miningMinerTabs(miners, candidates) {
  const hiredActive = activeMinerTab === "hired";
  return `
    <div class="mining-miner-tabs" role="tablist" aria-label="已雇矿工与招募">
      <div class="mining-miner-tabs-main">
        <button class="${hiredActive ? "on" : ""}" id="miningMinerTabHired" data-action="miningMinersTab" data-payload="hired" type="button" role="tab" aria-controls="miningMinerHiredPanel" aria-selected="${hiredActive}" tabindex="${hiredActive ? "0" : "-1"}">已雇矿工</button>
        <button class="${hiredActive ? "" : "on"}" id="miningMinerTabRecruit" data-action="miningMinersTab" data-payload="recruit" type="button" role="tab" aria-controls="miningMinerRecruitPanel" aria-selected="${!hiredActive}" tabindex="${hiredActive ? "-1" : "0"}">招募</button>
      </div>
      <span class="mining-miner-tabs-brief">已雇 ${miners.length}/${MINING_MAX_MINERS} · 候选 ${candidates.length}</span>
    </div>
  `;
}

function minersView() {
  const mining = playerMining();
  const miners = mining.miners || [];
  const candidates = mining.recruitCandidates || [];
  const recruitActive = activeMinerTab === "recruit";
  const tabs = miningMinerTabs(miners, candidates);
  const rosterFull = miners.length >= MINING_MAX_MINERS;
  const refreshPaid = mining.recruitCandidatesInitialized === true;
  const refreshAffordable = !refreshPaid
    || (Number(getState()?.me?.cash) || 0) >= MINING_RECRUIT_REFRESH_COST;
  const refreshCoolingDown = candidateRefreshCoolingDown();
  const refreshAllowed = !candidateRefreshMutationPending && !refreshCoolingDown && !minerRosterMutationPending && !rosterFull && refreshAffordable;
  const basicRefreshLabel = candidateRefreshMutationPending || refreshCoolingDown || minerRosterMutationPending
    ? "正在刷新招募名单…"
    : rosterFull
      ? "矿工队伍已满"
      : refreshPaid
        ? `刷新招募名单 · ${refreshAffordable ? money(MINING_RECRUIT_REFRESH_COST) : `现金不足 · 需 ${money(MINING_RECRUIT_REFRESH_COST)}`}`
        : "获取首批矿工 · 免费";
  const advancedRefreshLabel = candidateRefreshMutationPending || refreshCoolingDown || minerRosterMutationPending
    ? "正在刷新候选人…"
    : rosterFull
      ? "矿工队伍已满"
      : refreshPaid
        ? `刷新候选人 · ${refreshAffordable ? money(MINING_RECRUIT_REFRESH_COST) : `现金不足 · 需 ${money(MINING_RECRUIT_REFRESH_COST)}`}`
        : "查看首批候选人 · 免费";
  if (basicModeEnabled()) {
    return `
      ${tabs}
      <div class="mining-roster-head mining-basic-roster-head">
        <div><p class="eyebrow">${recruitActive ? "矿山专属招募" : "矿山专属人力"}</p><h3>${recruitActive ? `招募矿工 ${candidates.length}` : `矿工队伍 ${miners.length} / ${MINING_MAX_MINERS}`}</h3><p>${recruitActive ? "候选矿工招募后只参与矿山开采，不会进入普通员工列表。" : "矿工独立于普通员工，只参与矿山开采。每班可安排 1–3 人，等级越高，采矿力和工资越高。"}</p></div>
        ${recruitActive ? `<button class="ghost-btn" data-action="miningRefreshCandidates" type="button" ${refreshAllowed ? "" : "disabled"} ${candidateRefreshMutationPending ? `aria-busy="true"` : ""}>${basicRefreshLabel}</button>` : ""}
      </div>
      ${recruitActive ? `
        <section class="miner-section mining-basic-recruit-section" id="miningMinerRecruitPanel" role="tabpanel" aria-labelledby="miningMinerTabRecruit">
          <div class="miner-grid">${candidates.length ? candidates.map((miner) => basicMinerCard(miner, true)).join("") : `<p class="mining-empty-copy">当前没有候选矿工，可使用右上角按钮获取招募名单。</p>`}</div>
        </section>
      ` : `
        <section class="miner-section mining-basic-hired-section" id="miningMinerHiredPanel" role="tabpanel" aria-labelledby="miningMinerTabHired">
          <div class="miner-grid">${miners.length ? miners.map((miner) => basicMinerCard(miner)).join("") : `<p class="mining-empty-copy">尚未雇佣矿工。</p>`}</div>
        </section>
      `}
    `;
  }
  return `
    ${tabs}
    <div class="mining-roster-head">
      <div><p class="eyebrow">${recruitActive ? "矿山专属招募" : "独立人力系统"}</p><h3>${recruitActive ? `招募矿工 ${candidates.length}` : `矿工队伍 ${miners.length} / ${MINING_MAX_MINERS}`}</h3><p>${recruitActive ? "候选矿工招募后只参与矿山开采，不会进入普通员工列表。" : `矿工不会出现在普通员工列表，也不能参与工坊或直播。培训 ${Number(mining.stats?.trainingSessions) || 0} 次 / ${money(mining.stats?.trainingSpent)} · 带教结业 ${Number(mining.stats?.mentorshipsCompleted) || 0}/${Number(mining.stats?.mentorshipsFormed) || 0} 对 / ${money(mining.stats?.mentorshipSpent)} · 休整关怀 ${Number(mining.stats?.careActions) || 0} 次 / ${money(mining.stats?.careSpent)}（恢复士气 ${Number(mining.stats?.moraleRecovered) || 0}） · 个人请假 ${Number(mining.stats?.personalLeaves) || 0} 次 · 留任 ${Number(mining.stats?.retentionSuccesses) || 0}/${Number(mining.stats?.retentionCases) || 0} 次 / ${money(mining.stats?.retentionSpent)} · 离队 ${Number(mining.stats?.minerDepartures) || 0} 人 · 续约 ${Number(mining.stats?.contractRenewals) || 0} 次 / ${money(mining.stats?.contractSpent)} · 晋升 ${Number(mining.stats?.promotions) || 0} 次 / ${money(mining.stats?.promotionSpent)}`}</p></div>
      ${recruitActive ? `<button class="ghost-btn" data-action="miningRefreshCandidates" type="button" ${refreshAllowed ? "" : "disabled"} ${candidateRefreshMutationPending ? `aria-busy="true"` : ""}>${advancedRefreshLabel}</button>` : ""}
    </div>
    ${recruitActive ? `
      <section class="miner-section mining-recruit-section" id="miningMinerRecruitPanel" role="tabpanel" aria-labelledby="miningMinerTabRecruit"><div class="miner-grid">${candidates.length ? candidates.map((miner) => minerCard(miner, true)).join("") : `<p class="mining-empty-copy">点击上方按钮生成候选人。</p>`}</div></section>
    ` : `
      <section class="miner-section mining-hired-section" id="miningMinerHiredPanel" role="tabpanel" aria-labelledby="miningMinerTabHired"><div class="miner-grid">${miners.length ? miners.map((miner) => minerCard(miner)).join("") : `<p class="mining-empty-copy">尚未雇佣矿工。</p>`}</div></section>
      ${mentorshipsView(mining)}
      ${crewRecordsView(mining)}
    `}
  `;
}

function facilityCard(facility) {
  const mining = playerMining();
  const level = Math.max(0, Number(mining.facilities?.[facility.id]) || 0);
  const maxed = level >= MINING_FACILITY_MAX_LEVEL;
  const nextCost = miningFacilityUpgradeCost(facility.id, level);
  const affordable = maxed || (Number(getState()?.me?.cash) || 0) >= Number(nextCost || 0);
  return `
    <article class="mining-facility-card ${maxed ? "maxed" : ""}">
      <div class="mining-facility-title">
        <span aria-hidden="true">${facility.id === "survey" ? "勘" : facility.id === "drill" ? "钻" : facility.id === "support" ? "护" : "运"}</span>
        <div><strong>${esc(facility.name)}</strong><small>Lv.${level} / ${MINING_FACILITY_MAX_LEVEL}</small></div>
      </div>
      <div class="mining-facility-level" aria-label="设施等级 ${level}">
        ${Array.from({ length: MINING_FACILITY_MAX_LEVEL }, (_, index) => `<i class="${index < level ? "on" : ""}"></i>`).join("")}
      </div>
      <p>${esc(facility.description)}</p>
      <dl>
        <div><dt>当前效果</dt><dd>${esc(miningFacilityEffectLabel(facility.id, level))}</dd></div>
        ${maxed ? "" : `<div><dt>升级后</dt><dd>${esc(miningFacilityEffectLabel(facility.id, level + 1))}</dd></div>`}
      </dl>
      <button class="${maxed ? "ghost-btn" : "primary-btn"}" data-action="miningUpgradeFacility" data-payload="${facility.id}" type="button" ${maxed || !affordable ? "disabled" : ""}>${maxed ? "已满级" : affordable ? `升级 · ${money(nextCost)}` : `资金不足 · ${money(nextCost)}`}</button>
    </article>
  `;
}

function facilitiesView(mining) {
  const ownMining = playerMining();
  const haulageLevel = Number(ownMining.facilities?.haulage) || 0;
  return `
    <section class="mining-facility-hero">
      <div><p class="eyebrow">矿区长期建设</p><h3>独立矿业设施</h3><p>这些设施只服务井下开采，不占用工坊设备，也不会参与工坊耐久结算。</p></div>
      <div><span>累计建设投入</span><strong>${money(ownMining.stats?.facilitySpent)}</strong><small>当前班次 ${duration(mining.shiftMs)}${haulageLevel ? ` · 已缩短 ${haulageLevel * 5}%` : ""}</small></div>
    </section>
    <section class="mining-facility-grid">
      ${Object.values(MINING_FACILITIES).map(facilityCard).join("")}
    </section>
    <p class="mining-facility-note">设施等级永久保留，不随矿权轮换；所有加成由服务端在开工与结算时统一计算。</p>
  `;
}

function mineAtlasCard(mine) {
  const record = playerMining().mineRecords?.[mine.id] || {};
  const shifts = Math.max(0, Number(record.shifts) || 0);
  const clueProgress = Math.max(0, Number(record.clueProgress) || 0);
  const surveyReports = Math.max(0, Number(record.surveyReports) || 0);
  const mastery = miningMineMasteryInfo(record);
  const nextAt = miningMineMasteryNextAt(record);
  const levelStart = mastery.level > 0 ? MINING_MASTERY_THRESHOLDS[mastery.level - 1] : 0;
  const progress = nextAt == null
    ? 100
    : Math.max(0, Math.min(100, ((shifts - levelStart) / Math.max(1, nextAt - levelStart)) * 100));
  const lastCondition = record.lastConditionId
    ? MINING_SITE_CONDITIONS[record.lastConditionId]?.name || "未知岩层"
    : "尚无记录";
  return `
    <article class="mining-atlas-card ${shifts ? "discovered" : "undiscovered"}">
      <div class="mining-atlas-title">
        <div><span>${esc(mine.beltLabel)} · ${esc(mine.id.toUpperCase())}</span><strong>${esc(mine.name)}</strong></div>
        <b>Lv.${mastery.level}</b>
      </div>
      <p>${shifts ? `${esc(mastery.name)} · ${esc(miningMineMasteryEffectLabel(mastery.level, { level: true }))}` : "完成首个班次后建立勘探档案"}</p>
      <div class="mining-atlas-progress"><i style="width:${progress}%"></i></div>
      <small>${nextAt == null ? "档案已精研" : `距下一等级 ${Math.max(0, nextAt - shifts)} 班`}</small>
      <div class="mining-survey-meter">
        <span><b>矿脉线索</b><small>${clueProgress} / ${MINING_CLUE_TARGET}</small></span>
        <i><em style="width:${Math.min(100, clueProgress)}%"></em></i>
        <strong>${surveyReports} 份成果</strong>
      </div>
      <dl>
        <div><dt>累计班次</dt><dd>${shifts}</dd></div>
        <div><dt>累计出料</dt><dd>${Number(record.roughs) || 0} 块</dd></div>
        <div><dt>累计重量</dt><dd>${Number(record.totalMass || 0).toFixed(1)} kg</dd></div>
        <div><dt>事故</dt><dd>${Number(record.accidents) || 0} 次</dd></div>
        <div><dt>最近环境</dt><dd>${esc(lastCondition)}</dd></div>
        <div><dt>最近开采</dt><dd>${record.lastMinedAt ? new Date(Number(record.lastMinedAt)).toLocaleDateString("zh-CN") : "—"}</dd></div>
      </dl>
    </article>
  `;
}

function atlasView() {
  const records = playerMining().mineRecords || {};
  const discovered = MINES.filter((mine) => Number(records[mine.id]?.shifts) > 0).length;
  const totalShifts = MINES.reduce((sum, mine) => sum + (Number(records[mine.id]?.shifts) || 0), 0);
  const mastered = MINES.filter((mine) => miningMineMasteryInfo(records[mine.id]).level >= MINING_MASTERY_MAX_LEVEL).length;
  const surveyReports = MINES.reduce((sum, mine) => sum + (Number(records[mine.id]?.surveyReports) || 0), 0);
  return `
    <section class="mining-atlas-hero">
      <div><p class="eyebrow">长期勘探资产</p><h3>三十座矿山档案</h3><p>每座矿山独立积累熟悉度。完成 1、3、6 个班次分别达到初探、熟悉、精研；档案永久保留，不随矿权轮换。</p></div>
      <div class="mining-atlas-totals">
        <span><b>${discovered}</b><small>/ 30 已踏勘</small></span>
        <span><b>${mastered}</b><small>座已精研</small></span>
        <span><b>${totalShifts}</b><small>累计班次</small></span>
        <span><b>${surveyReports}</b><small>份勘探成果</small></span>
      </div>
    </section>
    <section class="mining-atlas-grid" aria-label="三十座矿山勘探档案">
      ${MINES.map(mineAtlasCard).join("")}
    </section>
  `;
}

function miningRecordsTabs(historyCount, leaseCount, applicationCount) {
  return `
    <div class="mining-record-tabs" role="tablist" aria-label="记录类型">
      <button class="${activeRecordsTab === "shifts" ? "on" : ""}" data-action="miningRecordsTab" data-payload="shifts" type="button" role="tab" aria-selected="${activeRecordsTab === "shifts"}">
        <span>开采记录</span><b>${Number(historyCount) || 0}</b>
      </button>
      <button class="${activeRecordsTab === "leases" ? "on" : ""}" data-action="miningRecordsTab" data-payload="leases" type="button" role="tab" aria-selected="${activeRecordsTab === "leases"}">
        <span>矿权记录</span><b>${Number(leaseCount) || 0}</b>
      </button>
      <button class="${activeRecordsTab === "applications" ? "on" : ""}" data-action="miningRecordsTab" data-payload="applications" type="button" role="tab" aria-selected="${activeRecordsTab === "applications"}">
        <span>竞租记录</span><b>${Number(applicationCount) || 0}</b>
      </button>
    </div>
  `;
}

function applicationHistoryView(entries = []) {
  const statusLabels = {
    won: "中选",
    missed: "未中选",
    cancelled: "已取消",
    failed: "分配失败",
    skipped: "未报名"
  };
  return `
    <section class="mining-history-list mining-application-history" role="tabpanel">
      ${entries.length ? entries.map((entry) => {
        const mine = miningMineById(entry.mineId);
        const preferences = (entry.preferences || [])
          .map((mineId) => miningMineById(mineId)?.name || mineId)
          .join("、");
        const result = entry.status === "won"
          ? `${esc(mine?.name || entry.mineId || "矿山")} · 租金 ${money(entry.rent)}`
          : entry.status === "missed"
            ? `冻结款已全退 ${money(entry.refund)}`
            : entry.rosterReleased && entry.reason === "inactive_roster_release"
              ? `长期未活跃，竞租席位已释放${Number(entry.refund) > 0 ? ` · 冻结款已退 ${money(entry.refund)}` : ""}`
            : entry.status === "cancelled" && entry.reason === "server_downtime_expired"
              ? `服务器停机期间轮次已过期 · 冻结款已退 ${money(entry.refund)}`
            : entry.status === "cancelled"
              ? `主动取消 · 已退 ${money(entry.refund)}`
              : entry.status === "failed"
                ? `分配未完成 · 已退 ${money(entry.refund)}`
                : entry.rosterReleased
                  ? "连续 3 轮未报名，竞租席位已释放并转入候补队尾"
                  : "本轮未提交志愿";
        const allocation = entry.priorityAllocation
          ? " · 上轮落选优先中选"
          : entry.allocationMode === "automatic"
            ? " · 系统随机调剂"
            : entry.allocationMode === "adjusted"
              ? " · 空闲矿山调剂"
              : entry.preferenceRank
                ? ` · 第 ${Number(entry.preferenceRank)} 志愿中选`
                : "";
        const priority = entry.priorityGranted ? " · 已获下一轮落选优先" : "";
        return `
          <article>
            <div><strong>第 ${Number(entry.roundNumber) || 0} 轮竞租</strong><span>${esc(entry.reason === "server_downtime_expired" ? "已退款" : statusLabels[entry.status] || "已结算")}</span></div>
            <p>${result}${allocation}${priority}</p>
            ${preferences ? `<p>志愿：${esc(preferences)}${entry.allowFallback === false ? " · 不接受调剂" : " · 接受同价位空闲矿山调剂"}</p>` : ""}
            <time>${new Date(Number(entry.settledAt || entry.submittedAt) || 0).toLocaleString("zh-CN")}</time>
          </article>
        `;
      }).join("") : `<p class="mining-empty-copy">还没有竞租记录。</p>`}
    </section>
  `;
}

function recordsView() {
  const mining = playerMining();
  const worldMining = stateMining();
  const stats = mining.stats || {};
  const history = mining.history || [];
  const leases = mining.leaseHistory || [];
  const applications = mining.applicationHistory || [];
  if (basicModeEnabled()) {
    return `
      <section class="mining-stats-row mining-basic-stats">
        <div><span>完成开采</span><strong>${Number(stats.shifts) || 0}</strong></div>
        <div><span>运回原石</span><strong>${Number(stats.roughs) || 0}</strong></div>
        <div><span>累计重量</span><strong>${Number(stats.totalMass || 0).toFixed(1)} kg</strong></div>
        <div><span>累计工资</span><strong>${money(stats.spent)}</strong></div>
      </section>
      ${miningEconomyPanel(worldMining)}
      ${miningWorldEconomyPanel(worldMining)}
      ${miningTuningSandboxPanel(worldMining)}
      ${miningTuningDraftPanel(worldMining)}
      ${miningTuningExperimentsPanel(worldMining)}
      ${miningTuningGovernancePanel(worldMining)}
      ${miningRecordsTabs(history.length, leases.length, applications.length)}
      ${activeRecordsTab === "applications" ? applicationHistoryView(applications) : activeRecordsTab === "leases" ? `
        <section class="mining-history-list mining-lease-history" role="tabpanel">
          ${leases.length ? leases.map((lease) => {
            const mine = miningMineById(lease.mineId);
            return `
              <article>
                <div><strong>第 ${Number(lease.roundNumber) || 0} 轮 · ${esc(mine?.name || lease.mineId)}</strong><span>${lease.status === "active" ? "承租中" : "已到期"}</span></div>
                <p>${lease.priorityAllocation ? "上轮落选优先 · " : ""}${lease.allocationMode === "automatic" ? "系统随机分配 · " : lease.allocationMode === "adjusted" ? "空闲矿山调剂 · " : ""}租金 ${money(lease.rent)} · 已开采 ${Number(lease.shiftsStarted) || 0}/${Number(lease.maxShifts) || 0} 次</p>
                <time>${new Date(Number(lease.startsAt) || 0).toLocaleDateString("zh-CN")}</time>
              </article>
            `;
          }).join("") : `<p class="mining-empty-copy">还没有矿权记录。</p>`}
        </section>
      ` : `
        <section class="mining-history-list mining-basic-history" role="tabpanel">
          ${history.length ? history.map((entry) => entry.status === "refunded" ? `
            <article class="is-refunded">
              <div><strong>${esc(entry.mineName || "未知矿山")}</strong><span>结算异常 · 已退款</span></div>
              <p>${esc(entry.note || "任务资料异常，未生成任何原石。")} · 退款 ${money(entry.refund)}</p>
              <p>矿工：${esc((entry.minerNames || []).join("、") || "未记录")}</p>
              <time>${new Date(Number(entry.completedAt) || 0).toLocaleString("zh-CN")}</time>
            </article>
          ` : `
            <article>
              <div><strong>${esc(entry.mineName)}</strong><span>${esc(entry.mode === "basic" ? entry.mineGradeName || "基础开采" : "旧版开采记录")}</span></div>
              <p>运回 ${Number(entry.roughCount) || 0} 块 / ${Number(entry.totalMass || 0).toFixed(1)} kg · 工资 ${money(entry.wageCost ?? entry.cost)}${entry.miningPower ? ` · 采矿力 ${Number(entry.miningPower)}` : ""}</p>
              <p>矿工：${esc((entry.minerNames || []).join("、") || "未记录")}</p>
              <time>${new Date(Number(entry.completedAt) || 0).toLocaleString("zh-CN")}</time>
            </article>
          `).join("") : `<p class="mining-empty-copy">还没有开采记录。</p>`}
        </section>
      `}
    `;
  }
  return `
    <section class="mining-stats-row">
      <div><span>完成班次</span><strong>${Number(stats.shifts) || 0}</strong></div>
      <div><span>运回原石</span><strong>${Number(stats.roughs) || 0}</strong></div>
      <div><span>累计重量</span><strong>${Number(stats.totalMass || 0).toFixed(1)} kg</strong></div>
      <div><span>事故次数</span><strong>${Number(stats.accidents) || 0}</strong></div>
      <div><span>班次投入</span><strong>${money(stats.spent)}</strong></div>
      <div><span>班前物资</span><strong>${money(stats.preparationSpent)}</strong></div>
      <div><span>激励奖金</span><strong>${money(stats.incentiveSpent)}</strong></div>
    </section>
    ${miningEconomyPanel(worldMining)}
    ${miningWorldEconomyPanel(worldMining)}
    ${miningTuningSandboxPanel(worldMining)}
    ${miningTuningDraftPanel(worldMining)}
    ${miningTuningExperimentsPanel(worldMining)}
    ${miningTuningGovernancePanel(worldMining)}
    ${miningRecordsTabs(history.length, leases.length, applications.length)}
    ${activeRecordsTab === "applications" ? applicationHistoryView(applications) : activeRecordsTab === "leases" ? `
      <section class="mining-history-list mining-lease-history" role="tabpanel">
        ${leases.length ? leases.map((lease) => {
          const mine = miningMineById(lease.mineId);
          return `
            <article>
              <div><strong>第 ${Number(lease.roundNumber) || 0} 轮 · ${esc(mine?.name || lease.mineId)}</strong><span>${lease.status === "active" ? "承租中" : "已到期"}</span></div>
              <p>${lease.priorityAllocation ? "上轮落选优先 · " : ""}${lease.allocationMode === "automatic" ? "系统随机分配" : lease.allocationMode === "adjusted" ? "空闲矿山调剂取得" : lease.preferenceRank ? `第 ${lease.preferenceRank} 志愿中选` : "志愿中选"} · 租金 ${money(lease.rent)} · 已开 ${Number(lease.shiftsStarted) || 0}/${Number(lease.maxShifts) || 0} 班</p>
              <time>${new Date(Number(lease.startsAt) || 0).toLocaleDateString("zh-CN")}</time>
            </article>
          `;
        }).join("") : `<p class="mining-empty-copy">还没有矿权记录。</p>`}
      </section>
    ` : `
      <section class="mining-history-list" role="tabpanel">
        ${history.length ? history.map((entry) => entry.status === "refunded" ? `
          <article class="is-refunded">
            <div><strong>${esc(entry.mineName || "未知矿山")}</strong><span>结算异常 · 已退款</span></div>
            <p>${esc(entry.note || "任务资料异常，未生成任何原石。")} · 退款 ${money(entry.refund)}</p>
            <p>班组：${esc((entry.minerNames || []).join("、") || "未记录")}</p>
            <time>${new Date(Number(entry.completedAt) || 0).toLocaleString("zh-CN")}</time>
          </article>
        ` : `
          <article>
            <div><strong>${esc(entry.mineName)}</strong><span>${esc(entry.conditionName || "岩层稳定")} · ${esc(entry.strategyId === "deep" ? "深掘" : entry.strategyId === "steady" ? "稳采" : "标准")} · ${esc(entry.incentiveLabel || "标准班薪")}</span></div>
            <p>运回 ${Number(entry.roughCount) || 0} 块 / ${Number(entry.totalMass || 0).toFixed(1)} kg · 支出 ${money(entry.cost)} · 线索 +${Number(entry.clueGain) || 0}${entry.surveyReportUsed ? " · 使用勘探成果" : ""}${entry.surveyReportsCreated ? ` · 新成果 +${Number(entry.surveyReportsCreated)}` : ""}${entry.incidentChoiceLabel ? ` · 急报：${esc(entry.incidentChoiceLabel)}${entry.incidentAutomatic ? "（自动）" : ""}` : ""}${entry.accident ? " · 塌方减产" : ""}${entry.mentorshipEvents?.length ? ` · 带教：${esc(entry.mentorshipEvents.map((event) => `${event.mentorName}→${event.apprenticeName} ${event.completed ? "结业" : `${event.sharedShifts}/${MINER_MENTORSHIP_REQUIRED_SHIFTS}`}`).join("、"))}` : ""}${entry.minerRetentionEvents?.length ? ` · 人事：${esc(entry.minerRetentionEvents.map((event) => `${event.minerName}${event.type === "resignation" ? "提出离职" : "开始请假"}`).join("、"))}` : ""}</p>
            <p>${esc(entry.note || "本班开采记录已经归档。")} · 档案 Lv.${Number(entry.mineMasteryBefore) || 0}${Number(entry.mineMasteryAfter) > Number(entry.mineMasteryBefore) ? ` → Lv.${Number(entry.mineMasteryAfter)}` : ""} · 默契 Lv.${Number(entry.crewBondBefore) || 0}${Number(entry.crewBondAfter) > Number(entry.crewBondBefore) ? ` → Lv.${Number(entry.crewBondAfter)}` : ""}${entry.foremanName ? ` · 班长：${esc(entry.foremanName)}（${esc(entry.foremanLabel || "常规指挥")}）` : ""}${entry.roleLabels?.length ? ` · 分工：${esc(entry.roleLabels.join("、"))}` : ""}${entry.crewSpecializations?.length ? ` · 专精：${esc(entry.crewSpecializations.join("、"))}` : ""}${entry.minerContracts?.length ? ` · 合约余量：${esc(entry.minerContracts.map((contract) => `${contract.minerName} ${Number(contract.remaining) || 0}班`).join("、"))}` : ""}${entry.minerMorales?.length ? ` · 士气：${esc(entry.minerMorales.map((morale) => `${morale.minerName} ${Number(morale.before) || 0}→${Number(morale.after) || 0}`).join("、"))}` : ""} · 班组：${esc((entry.minerNames || []).join("、") || "未记录")}${entry.preparationNames?.length ? ` · 物资：${esc(entry.preparationNames.join("、"))}` : ""}${entry.facilities ? ` · 设施：${esc(Object.values(MINING_FACILITIES).filter((facility) => Number(entry.facilities?.[facility.id]) > 0).map((facility) => `${facility.name} L${Number(entry.facilities[facility.id])}`).join("、") || "无")}` : ""}</p>
            <time>${new Date(Number(entry.completedAt) || 0).toLocaleString("zh-CN")}</time>
          </article>
        `).join("") : `<p class="mining-empty-copy">还没有开采记录。</p>`}
      </section>
    `}
  `;
}

export function renderMining() {
  const root = document.querySelector("#miningRoot");
  const mining = stateMining();
  if (!root || !getState()) return;
  syncMiningSettlementNotice();
  syncMiningAllocationNotice(mining);
  syncMiningRecoveryNotice(mining);
  syncMiningTuningObservationNotice(mining);
  syncMiningTuningEffectNotice(mining);
  if (basicModeEnabled() && !["mines", "work", "miners", "records"].includes(activeTab)) activeTab = "mines";
  syncDrafts();
  let content = "";
  const locked = !mining.unlocked || (!mining.playerQualified && !mining.tuningGovernance?.canManage);
  if (locked) {
    content = `
      ${mining.unlocked ? competitionInsightsPanel(mining) : ""}
      ${miningMap(mining, { locked: true })}
      <section class="mining-locked-copy">
        <strong>${mining.unlocked ? mining.milestoneQualified ? "当前处于矿区候补队列" : "尚未取得个人采矿资格" : "全服矿区尚未开放"}</strong>
        <p>${esc(mining.accessMessage || "继续经营，提高声望并等待更多同行取得资格。")}</p>
      </section>
    `;
  } else {
    content = `${miningTabs()}${activeTab === "work" ? miningWorkView(mining) : activeTab === "miners" ? minersView() : activeTab === "facilities" ? facilitiesView(mining) : activeTab === "atlas" ? atlasView() : activeTab === "records" ? recordsView() : minesView(mining)}`;
  }
  root.innerHTML = `${locked ? progressCard(mining) : ""}${content}`;
  root.querySelectorAll(".mining-competition-insights").forEach((panel) => {
    panel.addEventListener("toggle", () => {
      competitionInsightsOpen = panel.open;
    });
  });
  root.querySelectorAll(".mining-economy-insights").forEach((panel) => {
    panel.addEventListener("toggle", () => {
      economyInsightsOpen = panel.open;
    });
  });
  root.querySelectorAll(".mining-world-economy").forEach((panel) => {
    panel.addEventListener("toggle", () => {
      worldEconomyReportOpen = panel.open;
    });
  });
  root.querySelectorAll(".mining-tuning-sandbox").forEach((panel) => {
    panel.addEventListener("toggle", () => {
      tuningSandboxOpen = panel.open;
    });
  });
  root.querySelectorAll(".mining-tuning-draft").forEach((panel) => {
    panel.addEventListener("toggle", () => {
      tuningDraftOpen = panel.open;
    });
  });
  root.querySelectorAll(".mining-tuning-experiments").forEach((panel) => {
    panel.addEventListener("toggle", () => {
      tuningExperimentsOpen = panel.open;
    });
  });
  bindMiningMap();
  paintMiningInteriorProgress();
  paintBasicMiningProgress();
  renderMineInspector(mining, { locked });
}

export function tickMiningClock() {
  if (getActiveView() !== "mining") return;
  document.querySelectorAll("[data-mining-countdown]").forEach((node) => {
    const target = Number(node.dataset.miningCountdown) || 0;
    const prefix = node.dataset.prefix || "剩余";
    node.textContent = `${prefix}：${duration(target - now())}`;
  });
  paintMiningInteriorProgress();
  paintBasicMiningProgress();
}

export function initMiningModule(deps = {}) {
  socket = deps.socket;
  getState = deps.getState || getState;
  getActiveView = deps.getActiveView || getActiveView;
  registerAction = deps.registerAction || registerAction;
  h = deps.helpers || {};

  registerAction("miningTab", ({ payload }) => {
    closeMineInspector();
    activeTab = ["mines", "work", "miners", "facilities", "atlas", "records"].includes(payload) ? payload : "mines";
    renderMining();
    const scrollHost = document.querySelector("#miningRoot")?.closest(".main-stage");
    if (scrollHost) scrollHost.scrollTop = 0;
  });
  registerAction("miningRecordsTab", ({ payload }) => {
    activeRecordsTab = ["shifts", "leases", "applications"].includes(payload) ? payload : "shifts";
    renderMining();
  });
  registerAction("miningTuningBelt", ({ payload }) => {
    const bands = stateMining().economyTuningSandbox?.bands || [];
    const band = bands.find((entry) => entry.beltId === String(payload || ""));
    if (!band) return;
    tuningSandboxBeltId = band.beltId;
    tuningSandboxScenarioId = band.recommendedScenarioId || "rent-5";
    renderMining();
  });
  registerAction("miningTuningScenario", ({ payload }) => {
    const band = (stateMining().economyTuningSandbox?.bands || [])
      .find((entry) => entry.beltId === tuningSandboxBeltId);
    const scenarioId = String(payload || "");
    if (!band?.scenarios?.some((entry) => entry.id === scenarioId)) return;
    tuningSandboxScenarioId = scenarioId;
    renderMining();
  });
  registerAction("miningTuningDraftSet", ({ payload }) => {
    const [beltId, scenarioId] = String(payload || "").split("|");
    const band = (stateMining().economyTuningSandbox?.bands || [])
      .find((entry) => entry.beltId === beltId);
    if (!band?.scenarios?.some((entry) => entry.id === scenarioId)) return;
    tuningDraftSelections = { ...tuningDraftSelections };
    if (scenarioId === "hold") delete tuningDraftSelections[beltId];
    else tuningDraftSelections[beltId] = scenarioId;
    tuningDraftOpen = true;
    renderMining();
  });
  registerAction("miningTuningDraftRemove", ({ payload }) => {
    const beltId = String(payload || "");
    if (!tuningDraftSelections[beltId]) return;
    tuningDraftSelections = { ...tuningDraftSelections };
    delete tuningDraftSelections[beltId];
    tuningDraftOpen = true;
    renderMining();
  });
  registerAction("miningTuningDraftRecommended", () => {
    const sandbox = stateMining().economyTuningSandbox || {};
    if (!sandbox.sampleReady) return;
    const recommended = {};
    for (const band of sandbox.bands || []) {
      if (band.recommendedScenarioId && band.recommendedScenarioId !== "hold"
        && band.scenarios?.some((entry) => entry.id === band.recommendedScenarioId)) {
        recommended[band.beltId] = band.recommendedScenarioId;
      }
    }
    if (!Object.keys(recommended).length) return;
    tuningDraftSelections = recommended;
    tuningDraftOpen = true;
    renderMining();
  });
  registerAction("miningTuningDraftClear", () => {
    tuningDraftSelections = {};
    tuningDraftOpen = true;
    renderMining();
  });
  registerAction("miningTuningExperimentSave", () => {
    if (tuningExperimentMutationPending) return;
    const draft = miningTuningDraftProjection(
      stateMining().economyTuningSandbox || {},
      tuningDraftSelections
    );
    if (!draft.changedCount || draft.changedCount > 2) {
      h.showToast?.("影子观察需要选择 1–2 个矿带方案。");
      return;
    }
    tuningExperimentMutationPending = true;
    renderMining();
    socket.emit("miningSaveTuningExperiment", {
      selections: { ...tuningDraftSelections }
    }, (result = {}) => {
      tuningExperimentMutationPending = false;
      if (result.ok) tuningExperimentsOpen = true;
      renderMining();
    });
  });
  registerAction("miningTuningReviewSchedule", ({ payload }) => {
    if (tuningGovernanceMutationPending) return;
    openMiningTuningGovernanceConfirmation("review", String(payload || ""));
  });
  registerAction("miningTuningCancelVersion", ({ payload }) => {
    if (tuningGovernanceMutationPending) return;
    openMiningTuningGovernanceConfirmation("cancel", String(payload || ""));
  });
  registerAction("miningTuningRollback", ({ payload }) => {
    if (tuningGovernanceMutationPending) return;
    openMiningTuningGovernanceConfirmation("rollback", String(payload || ""));
  });
  registerAction("miningConfirmTuningGovernance", emitMiningTuningGovernanceAction);
  registerAction("miningCancelTuningGovernanceConfirm", () => {
    pendingTuningGovernanceAction = null;
    h.closeGameModal?.();
  });
  registerAction("miningMinersTab", ({ payload }) => {
    activeMinerTab = payload === "recruit" ? "recruit" : "hired";
    renderMining();
  });
  registerAction("miningEnterInterior", () => {
    const job = activeMiningJob();
    if (!job) return h.showToast?.("当前没有进行中的井下班次。");
    mineInteriorJobId = job.id;
    mineInteriorVisible = true;
    focusedInteriorMinerId = focusedInteriorMinerId || job.foremanId || job.minerIds?.[0] || "";
    activeTab = "work";
    renderMining();
  });
  registerAction("miningExitInterior", () => {
    mineInteriorVisible = false;
    renderMining();
  });
  registerAction("miningFocusInteriorMiner", ({ payload }) => {
    const job = activeMiningJob();
    const minerId = String(payload || "");
    if (!job?.minerIds?.includes(minerId)) return;
    focusedInteriorMinerId = minerId;
    renderMining();
  });
  registerAction("miningInteriorOpenCrew", () => {
    mineInteriorVisible = false;
    activeTab = "miners";
    activeMinerTab = "hired";
    renderMining();
  });
  registerAction("miningResolveIncident", ({ payload }) => {
    const [jobId, choiceId] = String(payload || "").split("|");
    if (!jobId || !choiceId) return;
    socket.emit("miningResolveIncident", { jobId, choiceId });
  });
  registerAction("miningFocusMine", ({ payload }) => {
    const mineId = String(payload || "");
    if (!miningMineById(mineId)) return;
    if (mineInspectorVisible && focusedMineId === mineId) return;
    focusedMineId = mineId;
    pendingMineFocusId = mineId;
    mineInspectorVisible = true;
    renderMining();
  });
  registerAction("miningCloseMineInspector", closeMineInspector);
  registerAction("miningGoToLease", () => {
    closeMineInspector();
    activeTab = "work";
    renderMining();
    window.requestAnimationFrame(() => {
      const panel = document.querySelector("#miningLeasePanel");
      panel?.scrollIntoView({ behavior: "auto", block: "start" });
      panel?.querySelector(".mining-start-btn:not(:disabled)")?.focus({ preventScroll: true });
    });
  });
  registerAction("miningOpenMinerTeam", () => {
    closeMineInspector();
    activeTab = "miners";
    activeMinerTab = "hired";
    renderMining();
    document.querySelector("#miningRoot")?.scrollIntoView({ behavior: "auto", block: "start" });
  });
  registerAction("miningFocusCrew", () => {
    const picker = document.querySelector("#miningCrewPicker");
    picker?.scrollIntoView({ behavior: "auto", block: "center" });
    picker?.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
  });
  registerAction("miningFocusBelt", ({ payload }) => {
    const mine = MINES.find((entry) => entry.beltId === String(payload || ""));
    if (!mine) return;
    focusedMineId = mine.id;
    pendingMineFocusId = mine.id;
    renderMining();
  });
  registerAction("miningMapZoom", ({ payload }) => {
    if (payload === "reset") {
      miningMapZoom = 0.82;
      centerMiningMapMine(focusedMineId);
      return;
    }
    setMiningMapZoom(miningMapZoom + (payload === "in" ? 0.1 : -0.1));
  });
  registerAction("miningMapNudge", ({ payload }) => {
    const { viewport } = miningMapElements();
    if (!viewport) return;
    miningMapPanX += (payload === "left" ? 1 : -1) * viewport.clientWidth * 0.7;
    paintMiningMap();
  });
  registerAction("miningTogglePreference", ({ payload }) => {
    if (preferenceMutationPending) return h.showToast?.("志愿正在保存，请稍候。");
    const mineId = String(payload || "");
    const mine = miningMineById(mineId);
    if (!mine) return h.showToast?.("矿山资料不存在。");
    const current = preferenceDraft.indexOf(mineId);
    if (current >= 0) {
      preferenceDraft.splice(current, 1);
    } else {
      const mining = stateMining();
      if (!mining.acceptingApplications || !mining.playerQualified) {
        return h.showToast?.("当前不在矿权志愿申请期。");
      }
      if (mining.myLease?.mineId === mineId) {
        return h.showToast?.("不能连续承租同一座矿山。");
      }
      if (preferenceDraft.length >= MINING_MAX_PREFERENCES) {
        return h.showToast?.(`最多选择 ${MINING_MAX_PREFERENCES} 座矿山。`);
      }
      const quote = miningPreferenceQuote(mine, mining);
      if (!quote.affordable) {
        return h.showToast?.(`现金与已冻结租金不足，选择该矿山需要 ${money(quote.nextEscrow)}。`);
      }
      preferenceDraft.push(mineId);
    }
    savePreferenceDraft();
  });
  registerAction("miningSubmitApplication", savePreferenceDraft);
  registerAction("miningToggleFallback", () => {
    if (preferenceMutationPending) return h.showToast?.("志愿正在保存，请稍候。");
    allowFallbackDraft = !allowFallbackDraft;
    if (preferenceDraft.length) savePreferenceDraft();
    else renderMining();
  });
  registerAction("miningCancelApplication", () => {
    if (preferenceMutationPending) return h.showToast?.("志愿正在保存，请稍候。");
    preferenceDraft = [];
    savePreferenceDraft();
  });
  registerAction("miningRefreshCandidates", refreshMiningCandidates);
  registerAction("miningRecruitMiner", ({ payload }) => {
    mutateMinerRoster("miningRecruitMiner", { candidateId: payload });
  });
  registerAction("miningDismissMiner", ({ payload }) => {
    mutateMinerRoster("miningDismissMiner", { minerId: payload });
  });
  registerAction("miningTrainMiner", ({ payload }) => {
    const [minerId, trainingId] = String(payload || "").split(":");
    if (!minerId || !MINER_TRAINING_PROGRAMS[trainingId]) return;
    socket.emit("miningTrainMiner", { minerId, trainingId });
  });
  registerAction("miningCareMiner", ({ payload }) => {
    const [minerId, careId] = String(payload || "").split(":");
    if (!minerId || !MINER_CARE_OPTIONS[careId]) return;
    socket.emit("miningCareMiner", { minerId, careId });
  });
  registerAction("miningResolveMinerRetention", ({ payload }) => {
    const [minerId, choiceId] = String(payload || "").split("|");
    if (!minerId || !MINER_RETENTION_CHOICES[choiceId]) return;
    socket.emit("miningResolveMinerRetention", { minerId, choiceId });
  });
  registerAction("miningFormMentorship", ({ payload }) => {
    const [mentorId, apprenticeId] = String(payload || "").split("|");
    if (!mentorId || !apprenticeId) return;
    socket.emit("miningFormMentorship", { mentorId, apprenticeId });
  });
  registerAction("miningEndMentorship", ({ payload }) => {
    const mentorshipId = String(payload || "");
    if (!mentorshipId) return;
    socket.emit("miningEndMentorship", { mentorshipId });
  });
  registerAction("miningSpecializeMiner", ({ payload }) => {
    const [minerId, specializationId] = String(payload || "").split("|");
    if (!minerId || !MINER_SPECIALIZATIONS[specializationId]) return;
    socket.emit("miningSpecializeMiner", { minerId, specializationId });
  });
  registerAction("miningRenewMinerContract", ({ payload }) => {
    const minerId = String(payload || "");
    if (!minerId) return;
    socket.emit("miningRenewMinerContract", { minerId });
  });
  registerAction("miningPromoteMiner", ({ payload }) => {
    const minerId = String(payload || "");
    if (!minerId) return;
    socket.emit("miningPromoteMiner", { minerId });
  });
  registerAction("miningUpgradeFacility", ({ payload }) => socket.emit("miningUpgradeFacility", { facilityId: payload }));
  registerAction("miningToggleMiner", ({ payload }) => {
    const id = String(payload || "");
    const current = selectedMinerIds.indexOf(id);
    if (current >= 0) selectedMinerIds.splice(current, 1);
    else selectedMinerIds.push(id);
    const lease = stateMining().myLease;
    const required = basicModeEnabled()
      ? MINING_BASIC_MAX_CREW
      : miningMineById(lease?.mineId)?.crewRequired || 3;
    selectedMinerIds = selectedMinerIds.slice(-required);
    renderMining();
  });
  registerAction("miningAssignCrew", ({ payload }) => {
    const lease = stateMining().myLease;
    const mine = miningMineById(lease?.mineId);
    const miners = playerMining().miners || [];
    const crewKey = miningCrewKey(String(payload || "").split("|"));
    const record = playerMining().crewRecords?.[crewKey];
    if (!record || !mine) return h.showToast?.("当前无法安排该班组。");
    const assignment = crewAssignmentFor(crewKey, record, mine, miners);
    if (!assignment.ready) return h.showToast?.(assignment.unavailableReason || "该班组暂时不能下井。");
    selectedMinerIds = [...assignment.minerIds];
    selectedForemanId = selectedMinerIds[0] || "";
    selectedRoleAssignments = miningAutoRoleAssignments(assignment.members);
    activeTab = "work";
    renderMining();
    h.showToast?.(`${assignment.names.join("、") || "历史班组"} 已安排为下一班。`);
  });
  registerAction("miningSelectForeman", ({ payload }) => {
    const minerId = String(payload || "");
    if (!selectedMinerIds.includes(minerId)) return;
    selectedForemanId = minerId;
    renderMining();
  });
  registerAction("miningAssignRole", ({ payload }) => {
    const [roleKey, minerId] = String(payload || "").split(":");
    if (!MINING_SHIFT_ROLES[roleKey] || !selectedMinerIds.includes(minerId)) return;
    const currentRole = Object.keys(selectedRoleAssignments)
      .find((key) => selectedRoleAssignments[key] === minerId);
    if (currentRole === roleKey) return;
    const displacedMinerId = selectedRoleAssignments[roleKey];
    const next = { ...selectedRoleAssignments };
    if (currentRole) delete next[currentRole];
    if (displacedMinerId && currentRole) next[currentRole] = displacedMinerId;
    next[roleKey] = minerId;
    selectedRoleAssignments = next;
    renderMining();
  });
  registerAction("miningSelectStrategy", ({ payload }) => {
    if (MINING_STRATEGIES[payload]) selectedStrategyId = payload;
    renderMining();
  });
  registerAction("miningSelectIncentive", ({ payload }) => {
    if (MINING_SHIFT_INCENTIVES[payload]) selectedIncentiveId = payload;
    renderMining();
  });
  registerAction("miningTogglePreparation", ({ payload }) => {
    const id = String(payload || "");
    if (!MINING_PREPARATIONS[id]) return;
    const current = selectedPreparationIds.indexOf(id);
    if (current >= 0) selectedPreparationIds.splice(current, 1);
    else if (selectedPreparationIds.length < MINING_MAX_PREPARATIONS) selectedPreparationIds.push(id);
    else return h.showToast?.(`每班最多选择 ${MINING_MAX_PREPARATIONS} 项班前物资。`);
    renderMining();
  });
  registerAction("miningToggleSurveyReport", () => {
    const mineId = stateMining().myLease?.mineId;
    if ((Number(playerMining().mineRecords?.[mineId]?.surveyReports) || 0) < 1) {
      return h.showToast?.("当前矿山没有可用的矿脉勘探成果。");
    }
    selectedUseSurveyReport = !selectedUseSurveyReport;
    renderMining();
  });
  registerAction("miningStartShift", () => {
    if (!beginMiningShiftMutation()) return;
    const onStarted = () => {
      finishMiningShiftMutation();
      renderMining();
    };
    if (basicModeEnabled()) {
      socket.emit("miningStartShift", { minerIds: [...selectedMinerIds] }, onStarted);
      return;
    }
    const useSurveyReport = selectedUseSurveyReport;
    selectedUseSurveyReport = false;
    socket.emit("miningStartShift", {
      minerIds: [...selectedMinerIds],
      foremanId: selectedForemanId,
      roleAssignments: { ...selectedRoleAssignments },
      strategyId: selectedStrategyId,
      incentiveId: selectedIncentiveId,
      preparationIds: [...selectedPreparationIds],
      useSurveyReport
    }, onStarted);
  });

  window.addEventListener("resize", paintMiningMap);
  setInterval(tickMiningClock, 1000);
}
