import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MINES,
  MINING_BASIC_MAX_CREW,
  MINING_BASIC_MIN_CREW,
  MINING_BASIC_MODE,
  MINING_BASIC_MINE_GRADES,
  MINING_APPLICATION_MS,
  MINING_LEASE_MS,
  MINING_MAX_SHIFTS_PER_LEASE,
  MINING_SHIFT_MS,
  MINER_CARE_OPTIONS,
  MINER_CONTRACT_MAX_SHIFTS,
  MINER_CONTRACT_RENEWAL_SHIFTS,
  MINER_INITIAL_CONTRACT_SHIFTS,
  MINER_INITIAL_MORALE,
  MINER_MAX_TIER,
  MINER_MORALE_CARE_THRESHOLD,
  MINER_MORALE_LEVELS,
  MINER_MENTOR_REQUIRED_SHIFTS,
  MINER_MENTOR_REQUIRED_TIER,
  MINER_MENTORSHIP_COMPLETION_EXP,
  MINER_MENTORSHIP_FEE_WAGE_MULTIPLIER,
  MINER_MENTORSHIP_REQUIRED_SHIFTS,
  MINER_MENTORSHIP_ROLE_EXP,
  MINER_PERSONAL_LEAVE_MORALE_THRESHOLD,
  MINER_PERSONAL_LEAVE_MS,
  MINER_RESIGNATION_MORALE_THRESHOLD,
  MINER_RETENTION_CHOICES,
  MINER_PROMOTION_FEE_WAGE_MULTIPLIER,
  MINER_PROMOTION_REQUIREMENTS,
  MINER_TIER_SKILL_BONUS,
  MINER_REST_MIN_FATIGUE,
  MINER_SKILL_MAX_LEVEL,
  MINER_SPECIALIZATIONS,
  MINER_SPECIALIZATION_BONUS,
  MINER_SPECIALIZATION_REQUIRED_LEVEL,
  MINER_SPECIALIZATION_REQUIRED_SHIFTS,
  MINER_TRAINING_PROGRAMS,
  MINING_CLUE_TARGET,
  MINING_CREW_BOND_MAX_LEVEL,
  MINING_CREW_BOND_THRESHOLDS,
  MINING_FACILITIES,
  MINING_FACILITY_MAX_LEVEL,
  MINING_FOREMAN_BONUS,
  MINING_FOREMAN_SPECIALTIES,
  MINING_INCIDENT_REVEAL_RATIO,
  MINING_ROLE_EXPERIENCE,
  MINING_ROLE_SKILL_BONUS,
  MINING_SHIFT_INCENTIVES,
  MINING_SHIFT_ROLES,
  MINING_SHIFT_INCIDENTS,
  MINING_MASTERY_MAX_LEVEL,
  MINING_MASTERY_THRESHOLDS,
  MINING_MAX_SURVEY_REPORTS,
  MINING_MAX_MINERS,
  MINING_MAX_PREPARATIONS,
  MINING_MAX_PREFERENCES,
  MINING_PREPARATIONS,
  MINING_RECRUIT_REFRESH_COST,
  MINING_REQUIRED_PLAYERS,
  MINING_REQUIRED_REP,
  MINING_SITE_CONDITIONS,
  MINING_SURVEY_REPORT,
  miningClueGain,
  miningCrewBondEffectLabel,
  miningCrewBondInfo,
  miningCrewBondNextAt,
  miningCrewKey,
  miningBasicMineProfile,
  miningBasicMinerProfile,
  miningBasicShiftPlan,
  miningForemanInfo,
  miningAutoRoleAssignments,
  miningMineMasteryEffectLabel,
  miningMineMasteryInfo,
  miningMineMasteryNextAt,
  miningMinerSkillExpTarget,
  miningMinerEffectiveSkill,
  miningMinerMoraleInfo,
  miningMinerRetentionChoiceQuote,
  miningMinerRetentionInfo,
  miningMentorshipEligibility,
  miningMentorshipProgress,
  miningMinerShiftMoraleDelta,
  miningMinerContractInfo,
  miningMinerPromotionInfo,
  miningMinerTierBonus,
  miningMinerSpecializationEligibility,
  miningMinerSpecializationInfo,
  miningRoleAssignmentDetails,
  miningShiftIncidentChoice,
  miningShiftIncidentFor,
  miningShiftIncentiveById,
  miningShiftPerformance,
  miningShiftWageQuote,
  miningPreparationEffects,
  miningSiteConditionFor
} from "../shared/domain/mining/mining-rules.js";

const [html, main, navigation, moduleSource, css, minerSystem, inventoryHelpers, interiorAsset, sidePanel] = await Promise.all([
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/main.js", import.meta.url), "utf8"),
  readFile(new URL("../public/shell/navigation.js", import.meta.url), "utf8"),
  readFile(new URL("../public/mining-module.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles/mining.css", import.meta.url), "utf8"),
  readFile(new URL("../server/systems/miner-system.js", import.meta.url), "utf8"),
  Promise.all([
    readFile(new URL("../public/features/inventory-helpers.js", import.meta.url), "utf8"),
    readFile(new URL("../public/features/inventory/item-detail-model.js", import.meta.url), "utf8")
  ]).then(parts => parts.join("\n")),
  readFile(new URL("../public/assets/mining/mining-interior-v1.png", import.meta.url)),
  readFile(new URL("../public/features/hud/side-panel.js", import.meta.url), "utf8")
]);

assert.equal(MINES.length, 30, "mining map should expose exactly 30 mines");
assert.equal(new Set(MINES.map((mine) => mine.id)).size, 30, "mine ids should be unique");
assert.equal(new Set(MINES.map((mine) => mine.beltId)).size, 5, "mines should be grouped into five geological belts");
assert.equal(MINING_REQUIRED_PLAYERS, 50, "the mining competition should open with 50 active qualified seats");
assert.equal(MINING_REQUIRED_REP, 100, "default personal threshold should match reputation level three");
assert.equal(MINING_BASIC_MODE, true);
assert.equal(MINING_MAX_MINERS, 6);
assert.equal(MINING_RECRUIT_REFRESH_COST, 500);
assert.equal(MINING_LEASE_MS, 10 * 60 * 1000);
assert.equal(MINING_APPLICATION_MS, 1 * 60 * 1000);
assert.equal(MINING_SHIFT_MS, 1 * 60 * 1000);
assert.match(moduleSource, /mining-map-marker-owner/, "the player's mine should have a persistent map label");
assert.match(moduleSource, /<span>承租人<\/span>/, "mine details should show the current lease owner explicitly");
assert.doesNotMatch(moduleSource, /点击洞口查看归属/, "the map legend should stay compact");
assert.doesNotMatch(moduleSource, /点击矿洞即可自动保存/, "the application bar should not repeat obvious click guidance");
assert.match(moduleSource, /未提交志愿则本轮不参与分配/, "qualified players should be told that only applicants enter allocation");
assert.doesNotMatch(moduleSource, /guaranteeRosterLabel|保障席位|申请后保障/,
  "the old permanent guaranteed-roster language should be removed");
assert.match(moduleSource, /下一轮申请期/, "the overlap should be identified as the next-round application period");
assert.match(moduleSource, /距申请截止/, "the application period should expose its own countdown");
assert.match(moduleSource, /申请下一轮不会影响当前矿权/, "the overlap should be explained explicitly");
assert.match(moduleSource, /上轮系统落选者优先，同优先级随机抽签，不按提交先后/,
  "the allocation bar should explain the fairness order and that submission speed has no advantage");
assert.match(moduleSource, /申请截止后统一分配，未中选将立即全额退回冻结资金/,
  "the opening application period should not be mislabeled as a next-round overlap");
assert.match(moduleSource, /第 \$\{targetRound\} 轮已取得.*\$\{allocationLabel\}/,
  "the winning notice should explain how the lease was allocated");
assert.match(moduleSource, /上轮落选 · 本轮优先/, "eligible system losers should see their priority status");
assert.doesNotMatch(moduleSource, /无需选择也会自动分配/, "the UI must not promise automatic allocation without consent");
assert.doesNotMatch(moduleSource, /不提交志愿时，系统会从付得起租金的空闲矿洞中随机安排/,
  "the UI must not promise an unsolicited paid lease");
assert.match(moduleSource, /function syncMiningSettlementNotice\(\)/,
  "completed shifts should produce an explicit player notification");
assert.match(moduleSource, /开采任务已退款/,
  "failed shift recovery should tell the player that the fee was refunded");
assert.match(moduleSource, /结算异常 · 已退款/,
  "refunded shifts should remain clearly labeled in mining history");
assert.match(css, /\.mining-history-list article\.is-refunded/,
  "refunded shift records should be visually distinct from completed production");
assert.match(moduleSource, /function syncMiningRecoveryNotice\(mining\)/,
  "downtime refunds should produce a one-time player notification");
assert.match(moduleSource, /function miningRecoveryNotice\(mining\)/,
  "recent downtime refunds should remain visible on the mining screen");
assert.match(moduleSource, /服务器停机期间轮次已过期 · 冻结款已退/,
  "application history must not describe a downtime refund as a player cancellation");
assert.match(css, /\.mining-recovery-notice/,
  "downtime recovery feedback should have a distinct success treatment");
assert.match(moduleSource, /let miningShiftMutationPending = false/,
  "shift submission should have a client-side in-flight guard");
assert.match(moduleSource, /let preferenceMutationTimer = null/,
  "application submission should track its acknowledgement timeout");
assert.match(moduleSource, /function finishPreferenceMutation\(\)/,
  "application acknowledgement should clear its in-flight guard and timeout");
assert.match(moduleSource, /expectedRevision: Number\(mining\.myApplication\?\.revision\) \|\| 0/,
  "application edits and cancellation should carry the displayed server revision");
assert.match(moduleSource, /志愿保存响应超时，请确认当前申请状态后再试/,
  "a lost application acknowledgement should restore controls with clear guidance");
assert.match(moduleSource, /if \(!beginMiningShiftMutation\(\)\) return/,
  "rapid start clicks should be rejected before another socket mutation is emitted");
assert.match(moduleSource, /正在提交开工…/,
  "the start button should visibly explain its pending state");
assert.match(moduleSource, /function syncMiningAllocationNotice\(mining\)/,
  "allocation results should produce an explicit player notification");
assert.match(moduleSource, /function miningPreferenceQuote\(mine, mining = stateMining\(\)\)/,
  "mine cards, dialogs and actions should share one affordability calculation");
assert.match(moduleSource, /if \(!quote\.affordable\)/,
  "stale or rapid mine-preference actions should be rejected before reaching the server");
assert.match(moduleSource, /function basicModeEnabled\(\)/,
  "the UI should consume the server-provided basic-mode flag");
assert.doesNotMatch(moduleSource, /if \(MINING_BASIC_MODE\)/,
  "runtime UI branches should not drift from the server basic-mode setting");
assert.match(moduleSource, /至少保留 1 名矿工/,
  "basic mode should visibly protect the last playable miner");
assert.match(moduleSource, /rosterFull \|\| !affordable/,
  "unaffordable or full-roster recruit actions should be disabled before submission");
assert.match(moduleSource, /现金不足 · 需/,
  "paid candidate refresh should explain the required cash before submission");
assert.match(moduleSource, /const refreshAllowed = !candidateRefreshMutationPending && !refreshCoolingDown && !minerRosterMutationPending && !rosterFull && refreshAffordable/,
  "an in-flight refresh or full roster should disable another paid refresh");
assert.match(moduleSource, /function refreshMiningCandidates\(\)/,
  "candidate refresh should have one guarded client mutation path");
assert.match(moduleSource, /candidateRefreshCooldownUntil = Date\.now\(\) \+ MINING_MUTATION_CLICK_COOLDOWN_MS/,
  "a completed refresh should remain briefly guarded against a fast second click");
assert.match(moduleSource, /function mutateMinerRoster\(eventName, payload\)/,
  "recruit and dismiss should share one guarded roster mutation path");
assert.match(moduleSource, /minerRosterMutationPending \|\| candidateRefreshMutationPending/,
  "roster changes should be rejected while another roster operation is pending");
assert.match(moduleSource, /矿工名单更新超时，请确认当前名单和现金后再试/,
  "a lost recruit or dismiss acknowledgement should restore roster controls");
assert.match(moduleSource, /candidateIds: \(playerMining\(\)\.recruitCandidates \|\| \[\]\)/,
  "candidate refresh should send the roster version used for pre-charge validation");
assert.match(moduleSource, /招募名单正在刷新，请稍候/,
  "rapid refresh actions should be rejected before another chargeable request is emitted");
assert.match(moduleSource, /刷新响应超时，请确认现金和候选名单后再试/,
  "a lost refresh acknowledgement should restore the roster controls");
assert.match(minerSystem, /candidate\.price = minerRecruitPrice\(candidate\.tier\)/,
  "persisted candidate prices should be normalized server-side");
assert.match(minerSystem, /无需刷新候选人/,
  "the server should reject candidate refresh for a full roster before charging cash");
assert.match(minerSystem, /刷新操作过快，本次未扣费/,
  "the server should reject an immediate second refresh before charging cash");
assert.match(moduleSource, /activeJobMinerIds\.has\(id\)/,
  "an active shift should preserve its selected crew for the next available shift");
assert.match(css, /\.mining-map-marker\.mine-owned/, "the player's mine should have a distinct persistent highlight");
assert.match(css, /\.mining-mine-dialog-owner\.is-mine/, "the ownership panel should distinguish the player's own mine");
assert.match(css, /\.mining-priority-chip/, "the previous-round loss-priority badge should be styled");
assert.match(css, /--mining-type-caption:\s*12px/, "mining captions should use a readable shared minimum");
assert.match(css, /--mining-type-body:\s*14px/, "mining screens should share a readable body size");
assert.match(css, /\.mining-tabs button,\s*\n\.mining-record-tabs button/, "primary and record tabs should share the larger type scale");
assert.match(css, /\.mining-tabs\s*\{[^}]*display:\s*flex[^}]*border:\s*0[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s,
  "top-level mining tabs should use the same standalone pill layout as the shop tabs");
assert.match(css, /\.mining-tabs button\s*\{[^}]*min-width:\s*112px[^}]*border-radius:\s*999px[^}]*background:\s*var\(--panel\)/s,
  "each top-level mining tab should render as an independent pill");
assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*?\.mining-tabs\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)[^}]*overflow:\s*visible/s,
  "all four top-level mining tabs should remain visible together on mobile");
assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*?\.mining-tabs button\s*\{[^}]*min-width:\s*0[^}]*padding:\s*8px 4px/s,
  "mobile mining tabs should shrink instead of placing the final tab off-screen");
assert.match(css, /\.mining-history-list\s*\{[^}]*background:\s*transparent\s*!important/s,
  "the history list should not merge records into one large panel");
assert.match(css, /\.mining-history-list article\s*\{[^}]*border-left:\s*3px solid[^}]*border-radius:\s*var\(--r-md\)/s,
  "each mining record should render as an independent bill-style card");
assert.match(css, /\.mining-lease-history article\s*\{[^}]*border-left-color:/s,
  "lease records should retain their own accent treatment");
assert.equal(MINING_MAX_SHIFTS_PER_LEASE, 5);
assert.equal(MINING_BASIC_MIN_CREW, 1);
assert.equal(MINING_BASIC_MAX_CREW, 3);
assert.deepEqual(MINING_BASIC_MINE_GRADES.map(({ count }) => count), [6, 6, 6, 6, 6]);
assert.deepEqual(MINING_BASIC_MINE_GRADES.map(({ rent }) => rent), [28_000, 45_000, 70_000, 95_000, 110_000]);
assert.ok(MINES.filter((mine) => mine.beltId === "mist").every((mine) => mine.rent >= 28_000 && mine.rent <= 36_000));
assert.ok(MINES.filter((mine) => mine.beltId === "ridge").every((mine) => mine.rent >= 45_000 && mine.rent <= 60_000));
assert.ok(MINES.filter((mine) => mine.beltId === "glacier").every((mine) => mine.rent >= 70_000 && mine.rent <= 95_000));
assert.ok(MINES.filter((mine) => mine.beltId === "deep").every((mine) => mine.rent >= 95_000 && mine.rent <= 125_000));
assert.ok(MINES.filter((mine) => mine.beltId === "core").every((mine) => mine.rent >= 110_000 && mine.rent <= 140_000));
assert.equal(miningBasicMineProfile(MINES[0]).name, "浅层矿山");
assert.equal(miningBasicMineProfile(MINES[6]).name, "青岭矿山");
assert.equal(miningBasicMineProfile(MINES[12]).name, "冰河矿山");
assert.equal(miningBasicMineProfile(MINES[18]).name, "深层矿山");
assert.equal(miningBasicMineProfile(MINES[24]).name, "核心矿山");
assert.deepEqual(miningBasicMinerProfile({ tier: 1 }), {
  id: "ordinary", name: "普通矿工", maxTier: 2, power: 1, wage: 400, tier: 1
});
assert.deepEqual(miningBasicMinerProfile({ tier: 4 }), {
  id: "skilled", name: "熟练矿工", maxTier: 4, power: 2, wage: 900, tier: 4
});
const basicPlan = miningBasicShiftPlan(MINES[27], [
  { id: "basic-a", tier: 1 },
  { id: "basic-b", tier: 5 }
]);
assert.equal(basicPlan.miningPower, 4);
assert.equal(basicPlan.wageCost, 1_900);
assert.equal(basicPlan.extraYieldChance, 0.24);
assert.deepEqual([basicPlan.baseYieldMin, basicPlan.baseYieldMax], [1, 2]);
assert.equal(basicPlan.risk, 0.225);
assert.equal(MINING_MAX_PREFERENCES, 3, "lease application should accept up to three preferences");
assert.equal(Object.keys(MINING_FACILITIES).length, 4, "mining should expose four independent facilities");
assert.equal(MINING_FACILITY_MAX_LEVEL, 3, "facility upgrades should stop at level three");
assert.equal(MINING_FOREMAN_BONUS, 0.6, "a foreman should add a meaningful but secondary skill bonus");
assert.equal(Object.keys(MINING_FOREMAN_SPECIALTIES).length, 3, "foremen should cover all three field skills");
assert.equal(MINING_ROLE_SKILL_BONUS, 0.8, "each filled underground role should have a clear shift impact");
assert.equal(MINING_ROLE_EXPERIENCE, 15, "role owners should gain targeted on-the-job experience");
assert.equal(Object.keys(MINING_SHIFT_ROLES).length, 3, "shift planning should expose three distinct underground roles");
assert.equal(Object.keys(MINING_SHIFT_INCENTIVES).length, 3, "shift planning should expose three wage incentive choices");
assert.equal(miningShiftIncentiveById("safety").riskDelta, -0.04);
assert.equal(miningShiftIncentiveById("piecework").extraYieldChanceDelta, 0.10);
assert.deepEqual(miningShiftWageQuote([{ baseWage: 360 }, { baseWage: 480 }], "safety"), {
  incentive: MINING_SHIFT_INCENTIVES.safety,
  baseWages: 1_260,
  wages: 1_512,
  incentivePremium: 252
});
assert.equal(MINING_INCIDENT_REVEAL_RATIO, 0.42, "underground decisions should arrive after the shift is established");
assert.equal(Object.keys(MINING_SHIFT_INCIDENTS).length, 3, "shifts should draw from three underground incidents");
assert.ok(Object.values(MINING_SHIFT_INCIDENTS).every((incident) => (
  incident.choices.length === 3 && miningShiftIncidentChoice(incident.id, incident.defaultChoiceId)
)), "every incident should offer three valid choices and a neutral automatic fallback");
assert.equal(miningShiftIncidentFor("incident-seed").id, miningShiftIncidentFor("incident-seed").id,
  "incident selection should be deterministic");
assert.equal(Object.keys(MINING_PREPARATIONS).length, 3, "shift planning should expose three mining-only supplies");
assert.equal(MINING_MAX_PREPARATIONS, 2, "each shift should require a preparation tradeoff");
assert.equal(Object.keys(MINING_SITE_CONDITIONS).length, 5, "each shift should draw from five site conditions");
assert.equal(MINING_MASTERY_MAX_LEVEL, 3, "mine familiarity should stop at level three");
assert.deepEqual(MINING_MASTERY_THRESHOLDS, [1, 3, 6], "mine files should reward repeat exploration without long grind");
assert.equal(miningMineMasteryInfo({ shifts: 3 }).level, 2);
assert.equal(miningMineMasteryNextAt({ shifts: 3 }), 6);
assert.match(miningMineMasteryEffectLabel(3, { level: true }), /勘脉 \+0\.8/);
assert.equal(MINING_CREW_BOND_MAX_LEVEL, 2, "crew bond should stop at level two");
assert.deepEqual(MINING_CREW_BOND_THRESHOLDS, [2, 5], "crew bond should form quickly, then reward a stable long-term team");
assert.equal(miningCrewKey(["miner-b", "miner-a", "miner-b"]), "miner-a|miner-b");
assert.equal(miningCrewBondInfo({ shifts: 2 }).level, 1);
assert.equal(miningCrewBondInfo({ shifts: 5 }).level, 2);
assert.equal(miningCrewBondNextAt({ shifts: 3 }), 5);
assert.match(miningCrewBondEffectLabel(2, { level: true }), /采掘 \+0\.5/);
assert.equal(MINING_CLUE_TARGET, 100);
assert.equal(MINING_MAX_SURVEY_REPORTS, 2);
assert.equal(MINING_SURVEY_REPORT.prospectingBonus, 1.2);
assert.equal(MINER_SKILL_MAX_LEVEL, 10);
assert.equal(Object.keys(MINER_TRAINING_PROGRAMS).length, 3);
assert.equal(Object.keys(MINER_SPECIALIZATIONS).length, 3);
assert.equal(MINER_SPECIALIZATION_REQUIRED_SHIFTS, 3);
assert.equal(MINER_SPECIALIZATION_REQUIRED_LEVEL, 5);
assert.equal(MINER_SPECIALIZATION_BONUS, 0.7);
assert.equal(MINER_INITIAL_CONTRACT_SHIFTS, 6);
assert.equal(MINER_CONTRACT_RENEWAL_SHIFTS, 6);
assert.equal(MINER_CONTRACT_MAX_SHIFTS, 12);
assert.equal(MINER_MAX_TIER, 6);
assert.equal(MINER_PROMOTION_FEE_WAGE_MULTIPLIER, 5);
assert.equal(MINER_TIER_SKILL_BONUS, 0.2);
assert.deepEqual([1, 2, 3, 4, 5, 6].map(miningMinerTierBonus), [0, 0.2, 0.4, 0.6, 0.8, 1]);
assert.deepEqual(Object.values(MINER_PROMOTION_REQUIREMENTS).map((requirement) => [
  requirement.targetTier,
  requirement.requiredShifts,
  requirement.requiredAverageSkill
]), [[2, 2, 3], [3, 4, 4], [4, 7, 5], [5, 11, 6], [6, 16, 8]]);
assert.deepEqual(miningMinerContractInfo({ baseWage: 360 }), {
  remaining: 6,
  initialShifts: 6,
  renewalShifts: 6,
  maxShifts: 12,
  baseRenewalCost: 720,
  renewalCost: 720,
  moraleMultiplier: 1,
  moraleLabel: "稳定",
  expired: false,
  low: false,
  canRenew: true
});
assert.equal(miningMinerContractInfo({ baseWage: 360, contractShiftsRemaining: 0 }).expired, true);
assert.equal(miningMinerContractInfo({ baseWage: 360, contractShiftsRemaining: 7 }).canRenew, false);
assert.equal(MINER_INITIAL_MORALE, 70);
assert.equal(MINER_MORALE_CARE_THRESHOLD, 80);
assert.equal(MINER_MORALE_LEVELS.length, 4);
assert.equal(miningMinerMoraleInfo(10).name, "低落");
assert.equal(miningMinerMoraleInfo(85).name, "高昂");
assert.equal(miningMinerContractInfo({ baseWage: 360, morale: 10 }).renewalCost, 1_080);
assert.equal(miningMinerContractInfo({ baseWage: 360, morale: 85 }).renewalCost, 648);
assert.equal(miningMinerShiftMoraleDelta({ strategyId: "standard", incentiveId: "standard" }), -1);
assert.equal(miningMinerShiftMoraleDelta({ strategyId: "steady", incentiveId: "safety" }), 4);
assert.equal(miningMinerShiftMoraleDelta({ strategyId: "deep", incentiveId: "piecework", accident: true, injured: true }), -18);
assert.equal(MINER_PERSONAL_LEAVE_MORALE_THRESHOLD, 35);
assert.equal(MINER_RESIGNATION_MORALE_THRESHOLD, 15);
assert.equal(MINER_PERSONAL_LEAVE_MS, 4 * 60 * 60 * 1000);
assert.equal(Object.keys(MINER_RETENTION_CHOICES).length, 3);
assert.equal(miningMinerRetentionInfo({ morale: 40 }, 1).id, "watch");
assert.equal(miningMinerRetentionInfo({ morale: 20 }, 1).id, "leaveRisk");
assert.equal(miningMinerRetentionInfo({ morale: 10 }, 1).id, "critical");
assert.equal(miningMinerRetentionInfo({ morale: 70, leaveUntil: 10 }, 1).id, "leave");
assert.equal(miningMinerRetentionInfo({ morale: 70, retentionCase: { id: "case" } }, 1).id, "resignation");
assert.equal(miningMinerRetentionChoiceQuote({ baseWage: 360 }, "conversation").cost, 720);
assert.equal(miningMinerRetentionChoiceQuote({ baseWage: 360 }, "bonus").cost, 1_800);
assert.equal(MINER_MENTOR_REQUIRED_TIER, 3);
assert.equal(MINER_MENTOR_REQUIRED_SHIFTS, 3);
assert.equal(MINER_MENTORSHIP_REQUIRED_SHIFTS, 3);
assert.equal(MINER_MENTORSHIP_ROLE_EXP, 10);
assert.equal(MINER_MENTORSHIP_COMPLETION_EXP, 30);
assert.equal(MINER_MENTORSHIP_FEE_WAGE_MULTIPLIER, 2);
const mentorProbe = { id: "mentor", tier: 3, shiftsWorked: 3, baseWage: 630 };
const apprenticeProbe = { id: "apprentice", tier: 1, shiftsWorked: 0, baseWage: 360 };
assert.deepEqual(miningMentorshipEligibility(mentorProbe, apprenticeProbe, []), {
  ready: true,
  reason: "",
  cost: 1_260,
  mentorTier: 3,
  apprenticeTier: 1,
  mentorShifts: 3,
  requiredTier: 3,
  requiredShifts: 3,
  requiredSharedShifts: 3
});
assert.equal(miningMentorshipEligibility({ ...mentorProbe, shiftsWorked: 1 }, apprenticeProbe, []).ready, false);
assert.equal(miningMentorshipEligibility(mentorProbe, { ...apprenticeProbe, tier: 3 }, []).ready, false);
assert.equal(miningMentorshipEligibility(mentorProbe, apprenticeProbe, [{
  status: "active",
  mentorId: "mentor",
  apprenticeId: "other"
}]).ready, false);
assert.deepEqual(miningMentorshipProgress({ status: "active", sharedShifts: 2 }), {
  sharedShifts: 2,
  requiredShifts: 3,
  remaining: 1,
  percent: 67,
  completed: false
});
const promotionProbe = {
  tier: 1,
  baseWage: 360,
  shiftsWorked: 2,
  skills: {
    prospecting: { level: 3 },
    extraction: { level: 3 },
    safety: { level: 3 }
  }
};
assert.deepEqual(miningMinerPromotionInfo(promotionProbe), {
  tier: 1,
  targetTier: 2,
  maxed: false,
  ready: true,
  shiftsWorked: 2,
  averageSkill: 3,
  requiredShifts: 2,
  requiredAverageSkill: 3,
  missingShifts: 0,
  missingAverageSkill: 0,
  promotionCost: 1_800,
  currentSkillBonus: 0,
  targetSkillBonus: 0.2,
  reason: "已满足晋升条件。"
});
assert.equal(miningMinerPromotionInfo({ ...promotionProbe, shiftsWorked: 0 }).ready, false);
assert.match(miningMinerPromotionInfo({ ...promotionProbe, shiftsWorked: 0 }).reason, /还需完成 2 个矿山班次/);
assert.equal(miningMinerPromotionInfo({ ...promotionProbe, tier: 6 }).maxed, true);
assert.equal(miningMinerEffectiveSkill({
  ...promotionProbe,
  tier: 3,
  skills: { ...promotionProbe.skills, prospecting: { level: 3 } }
}, "prospecting"), 3.4);
assert.equal(Object.keys(MINER_CARE_OPTIONS).length, 3);
assert.equal(MINER_REST_MIN_FATIGUE, 10);
assert.equal(MINER_CARE_OPTIONS.rest.fatigueRecovery, 30);
assert.equal(MINER_CARE_OPTIONS.treatment.injuryReductionMs, 6 * 60 * 60 * 1000);
assert.equal(MINER_CARE_OPTIONS.support.moraleRecovery, 20);
assert.equal(miningMinerSkillExpTarget(1), 50);
assert.equal(miningMinerSkillExpTarget(4), 200);
assert.equal(miningMinerSkillExpTarget(10), 0);
const foremanProbe = {
  id: "foreman-probe",
  name: "试班矿工",
  trait: "稳手",
  flaw: "",
  skills: {
    prospecting: { level: 3 },
    extraction: { level: 3 },
    safety: { level: 2 }
  }
};
assert.equal(miningMinerEffectiveSkill(foremanProbe, "extraction"), 4);
assert.deepEqual(miningForemanInfo(foremanProbe), {
  minerId: "foreman-probe",
  minerName: "试班矿工",
  focus: "extraction",
  label: "采掘指挥",
  skillLabel: "采掘",
  skill: 4,
  bonus: 0.6,
  effectLabel: "采掘 +0.6"
});
const specializationProbe = {
  id: "specialization-probe",
  name: "专精矿工",
  shiftsWorked: 3,
  skills: {
    prospecting: { level: 5 },
    extraction: { level: 4 },
    safety: { level: 3 }
  }
};
assert.equal(miningMinerSpecializationEligibility(specializationProbe, "veinReader").ready, true);
assert.equal(miningMinerSpecializationEligibility({ ...specializationProbe, shiftsWorked: 2 }, "veinReader").ready, false);
assert.equal(miningMinerSpecializationEligibility(specializationProbe, "rockBreaker").ready, false);
specializationProbe.specializationId = "veinReader";
assert.equal(miningMinerSpecializationInfo(specializationProbe).name, "寻脉师");
assert.equal(miningMinerEffectiveSkill(specializationProbe, "prospecting"), 5.7);
assert.equal(miningMinerEffectiveSkill(specializationProbe, "extraction"), 4);
const roleProbe = [
  {
    id: "role-prospector",
    name: "探脉甲",
    skills: { prospecting: { level: 7 }, extraction: { level: 2 }, safety: { level: 2 } }
  },
  {
    id: "role-extractor",
    name: "采掘乙",
    skills: { prospecting: { level: 2 }, extraction: { level: 8 }, safety: { level: 4 } }
  }
];
const autoRoles = miningAutoRoleAssignments(roleProbe);
assert.deepEqual(autoRoles, { prospecting: "role-prospector", extraction: "role-extractor" });
assert.deepEqual(miningRoleAssignmentDetails(autoRoles, roleProbe).map((row) => row.effectLabel), [
  "勘脉 +0.8",
  "采掘 +0.8"
]);
const rolePerformance = miningShiftPerformance({
  mine: MINES[0],
  miners: roleProbe,
  roleAssignments: autoRoles
});
const unassignedPerformance = miningShiftPerformance({ mine: MINES[0], miners: roleProbe });
assert.ok(rolePerformance.upgradeChance > unassignedPerformance.upgradeChance,
  "a filled prospecting role should improve rough-stone upgrade chance");
assert.ok(rolePerformance.extraYieldChance > unassignedPerformance.extraYieldChance,
  "a filled extraction role should improve extra-yield chance");
const incentiveBaselinePerformance = miningShiftPerformance({
  mine: MINES[29],
  miners: roleProbe,
  roleAssignments: autoRoles
});
const safetyIncentivePerformance = miningShiftPerformance({
  mine: MINES[29],
  miners: roleProbe,
  roleAssignments: autoRoles,
  incentiveId: "safety"
});
const pieceworkIncentivePerformance = miningShiftPerformance({
  mine: MINES[29],
  miners: roleProbe,
  roleAssignments: autoRoles,
  incentiveId: "piecework"
});
assert.equal(Math.round((incentiveBaselinePerformance.risk - safetyIncentivePerformance.risk) * 100), 4);
assert.equal(Math.round((pieceworkIncentivePerformance.risk - incentiveBaselinePerformance.risk) * 100), 2);
assert.equal(Math.round((pieceworkIncentivePerformance.extraYieldChance - incentiveBaselinePerformance.extraYieldChance) * 100), 10);
const lowMoralePerformance = miningShiftPerformance({
  mine: MINES[29],
  miners: roleProbe.map((miner) => ({ ...miner, morale: 10 })),
  roleAssignments: autoRoles
});
const highMoralePerformance = miningShiftPerformance({
  mine: MINES[29],
  miners: roleProbe.map((miner) => ({ ...miner, morale: 85 })),
  roleAssignments: autoRoles
});
assert.ok(highMoralePerformance.extraction > lowMoralePerformance.extraction);
assert.ok(highMoralePerformance.risk < lowMoralePerformance.risk);
const incidentPerformance = miningShiftPerformance({
  mine: MINES[0],
  miners: roleProbe,
  roleAssignments: autoRoles,
  incidentChoice: miningShiftIncidentChoice("veinFork", "sample")
});
assert.ok(incidentPerformance.upgradeChance > rolePerformance.upgradeChance);
assert.ok(incidentPerformance.clueGain > rolePerformance.clueGain);
const riskyIncidentPerformance = miningShiftPerformance({
  mine: MINES[0],
  miners: roleProbe,
  roleAssignments: autoRoles,
  incidentChoice: miningShiftIncidentChoice("roofCrack", "rush")
});
assert.equal(
  Math.round((riskyIncidentPerformance.risk - rolePerformance.risk) * 100),
  7,
  "incident risk labels should match the final player-visible risk change"
);
assert.ok(miningClueGain({ strategyId: "deep", conditionId: "richVein", masteryLevel: 3, prospecting: 6 })
  > miningClueGain({ strategyId: "steady", conditionId: "stable", masteryLevel: 0, prospecting: 1 }));
assert.equal(miningSiteConditionFor("same-seed").id, miningSiteConditionFor("same-seed").id, "site condition should be deterministic");
assert.equal(miningPreparationEffects(["sampling", "bracing"], "stable").cost, 3_400);
assert.ok(miningPreparationEffects(["drainage"], "seepage").riskDelta <= -0.06);

assert.match(html, /data-view="mining"/);
assert.match(html, /id="miningRoot"/);
assert.match(html, /id="sidePanelUnread"/, "mobile matters entry should expose a mining attention badge");
assert.match(main, /initMiningModule/);
assert.match(main, /sidePanelUnread:\s*document\.querySelector\("#sidePanelUnread"\)/);
assert.match(main, /renderMining/);
assert.match(main, /id:\s*"mining"/);
assert.match(navigation, /mining:\s*`<svg/);
assert.match(navigation, /mining\.acceptingApplications[\s\S]*?mining\.playerQualified[\s\S]*?!mining\.myApplication/,
  "the global navigation should flag an unsubmitted mining application");
assert.match(navigation, /mining\.skippedApplicationRounds/,
  "the mining navigation should also flag a seat participation warning");
assert.match(sidePanel, /第 \$\{targetRound\} 轮矿权申请/);
assert.match(sidePanel, /data-remind-mining-eta/);
assert.match(sidePanel, /矿权申请等待提交/);
assert.match(sidePanel, /竞租席位参与提醒/);
assert.match(sidePanel, /sidePanelUnread/);
assert.match(moduleSource, /miningRefreshCandidates/);
assert.match(moduleSource, /miningRecruitMiner/);
assert.match(moduleSource, /miningStartShift/);
assert.match(moduleSource, /租赁矿山/);
assert.match(moduleSource, /data-payload="work"[^>]*>挖矿<\/button>/, "mining operation should have its own tab between leasing and crew");
assert.ok(
  moduleSource.indexOf('data-payload="mines"') < moduleSource.indexOf('data-payload="work"')
    && moduleSource.indexOf('data-payload="work"') < moduleSource.indexOf('data-payload="miners"'),
  "the mining tab should sit between lease and crew"
);
assert.match(moduleSource, /function miningWorkView/, "lease selection and shift operation should render as separate views");
assert.match(moduleSource, /function rosterParticipationNotice/);
assert.match(moduleSource, /连续未报名 \$\{skippedRounds\}\/\$\{maxSkippedRounds\} 轮/);
assert.match(moduleSource, /function competitionInsightsPanel/);
assert.match(moduleSource, /竞租数据/);
assert.match(moduleSource, /本轮热门矿洞/);
assert.match(moduleSource, /近期轮次/);
assert.match(moduleSource, /数值健康建议/);
assert.match(moduleSource, /仅诊断，不会自动改规则/);
assert.match(moduleSource, /healthAlerts/);
assert.match(moduleSource, /competitionInsightsOpen = panel\.open/,
  "server refreshes should preserve whether the competition dashboard is expanded");
assert.match(css, /\.mining-competition-insights/);
assert.match(css, /\.mining-insight-metrics/);
assert.match(css, /\.mining-health-advice/);
assert.match(moduleSource, /function miningEconomyPanel/);
assert.match(moduleSource, /开采收益健康/);
assert.match(moduleSource, /估算产值/);
assert.match(moduleSource, /五档矿带基准/);
assert.match(moduleSource, /不读取原石隐藏品质/);
assert.match(moduleSource, /economyInsightsOpen = panel\.open/,
  "server refreshes should preserve whether the economy dashboard is expanded");
assert.match(css, /\.mining-economy-insights/);
assert.match(css, /\.mining-economy-metrics/);
assert.match(css, /\.mining-economy-comparison/);
assert.match(moduleSource, /function miningWorldEconomyPanel/);
assert.match(moduleSource, /全服轮次经济/);
assert.match(moduleSource, /未达标前不输出系统级结论/);
assert.match(moduleSource, /成本采用全租金口径/);
assert.match(moduleSource, /至少.*结束轮次.*班次.*实际开采玩家/);
assert.match(moduleSource, /worldEconomyReportOpen = panel\.open/,
  "server refreshes should preserve whether the world economy report is expanded");
assert.match(css, /\.mining-world-economy/);
assert.match(css, /\.mining-world-sample/);
assert.match(css, /\.mining-world-belts/);
assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.mining-world-belts \{ grid-template-columns: 1fr; \}/,
  "world economy belt cards should stack on mobile");
assert.match(moduleSource, /function miningTuningSandboxPanel/);
assert.match(moduleSource, /数值调参沙盘/);
assert.match(moduleSource, /选择矿带与方案/);
assert.match(moduleSource, /五矿带净收益差距/);
assert.match(moduleSource, /不会自动修改正式数值/);
assert.match(moduleSource, /tuningSandboxOpen = panel\.open/,
  "server refreshes should preserve whether the tuning sandbox is expanded");
assert.match(moduleSource, /registerAction\("miningTuningBelt"/);
assert.match(moduleSource, /registerAction\("miningTuningScenario"/);
assert.match(moduleSource, /function miningTuningDraftPanel/);
assert.match(moduleSource, /多矿带组合草案/);
assert.match(moduleSource, /一次只验证少量变量/);
assert.match(moduleSource, /安全检查/);
assert.match(moduleSource, /registerAction\("miningTuningDraftSet"/);
assert.match(moduleSource, /registerAction\("miningTuningDraftRemove"/);
assert.match(moduleSource, /registerAction\("miningTuningDraftRecommended"/);
assert.match(moduleSource, /registerAction\("miningTuningDraftClear"/);
assert.match(moduleSource, /registerAction\("miningTuningExperimentSave"/);
assert.match(moduleSource, /miningSaveTuningExperiment/);
assert.match(moduleSource, /tuningDraftOpen = panel\.open/,
  "server refreshes should preserve whether the combined tuning draft is expanded");
assert.match(moduleSource, /function miningTuningExperimentsPanel/);
assert.match(moduleSource, /影子观察记录/);
assert.match(moduleSource, /不可作为调参效果的因果证明/);
assert.match(moduleSource, /模型校准结论/);
assert.match(moduleSource, /记录横向比较/);
assert.match(moduleSource, /只比较模型风险与预测偏差，不代表方案收益排名/);
assert.match(moduleSource, /function syncMiningTuningObservationNotice/);
assert.match(moduleSource, /影子观察已完成/);
assert.match(moduleSource, /function miningTuningGovernancePanel/);
assert.match(moduleSource, /正式数值版本/);
assert.match(moduleSource, /轮次边界生效/);
assert.match(moduleSource, /确认人工审核并安排生效/);
assert.match(moduleSource, /安排安全回滚/);
assert.match(moduleSource, /function syncMiningTuningEffectNotice/);
assert.match(moduleSource, /生效后效果追踪/);
assert.match(moduleSource, /只提示风险，不会自动回滚/);
assert.match(moduleSource, /按建议安排安全回滚/);
assert.match(moduleSource, /矿务数值审核/);
assert.match(moduleSource, /效果归档/);
assert.match(moduleSource, /function openMiningTuningGovernanceConfirmation/);
assert.match(moduleSource, /确认生成全服正式版本/);
assert.match(moduleSource, /确认安排安全回滚/);
assert.match(moduleSource, /registerAction\("miningConfirmTuningGovernance"/);
assert.match(moduleSource, /registerAction\("miningCancelTuningGovernanceConfirm"/);
assert.match(main, /mining:\s*\{[^}]*openGameModal[^}]*closeGameModal/,
  "mining governance confirmations should use the shared accessible modal");
assert.match(moduleSource, /registerAction\("miningTuningReviewSchedule"/);
assert.match(moduleSource, /registerAction\("miningTuningCancelVersion"/);
assert.match(moduleSource, /registerAction\("miningTuningRollback"/);
assert.match(moduleSource, /miningReviewTuningExperiment/);
assert.match(moduleSource, /miningCancelTuningVersion/);
assert.match(moduleSource, /miningRollbackTuningVersion/);
assert.match(moduleSource, /function effectiveMiningMineById/);
assert.match(moduleSource, /tuningExperimentsOpen = panel\.open/,
  "server refreshes should preserve whether observation records are expanded");
assert.match(css, /\.mining-tuning-sandbox/);
assert.match(css, /\.mining-tuning-comparison/);
assert.match(css, /\.mining-tuning-draft/);
assert.match(css, /\.mining-tuning-guardrails/);
assert.match(css, /\.mining-tuning-experiments/);
assert.match(css, /\.mining-tuning-experiment-metrics/);
assert.match(css, /\.mining-tuning-experiment-assessment/);
assert.match(css, /\.mining-tuning-experiment-compare/);
assert.match(css, /\.mining-tuning-governance/);
assert.match(css, /\.mining-tuning-governance-access/);
assert.match(css, /\.mining-tuning-effect/);
assert.match(css, /\.mining-tuning-effect-metrics/);
assert.match(css, /\.mining-tuning-version-history/);
assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.mining-tuning-comparison \{ grid-template-columns: 1fr; \}/,
  "tuning comparison cards should stack on mobile");
assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.mining-tuning-draft-picks article \{ grid-template-columns: 1fr; \}/,
  "combined tuning draft rows should stack on mobile");
assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.mining-tuning-experiment-metrics \{ grid-template-columns: 1fr; \}/,
  "observation forecast and actual metrics should stack on mobile");
assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.mining-tuning-experiment-compare \[role="row"\] \{ grid-template-columns: 1fr;/,
  "observation comparison rows should become labeled cards on mobile");
assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.mining-tuning-governance-current \{ grid-template-columns: 1fr; \}/,
  "formal-version cards should stack on mobile");
assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.mining-tuning-effect-metrics \{ grid-template-columns: 1fr; \}/,
  "post-activation effect metrics should stack on mobile");
assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.mining-application-bar \{ position: static; \}/,
  "the mobile application bar should not cover expanded health advice while scrolling");
assert.match(moduleSource, /mining-operation-layout/, "the mining view should use the compact operation layout");
assert.match(moduleSource, /开始 \$\{duration\(mining\.shiftMs\)\} 开采/);
assert.match(moduleSource, /矿工独立于普通员工，只参与矿山开采/);
assert.match(moduleSource, /MINING_BASIC_MAX_CREW/);
assert.match(moduleSource, /miningInteriorView/);
assert.match(moduleSource, /miningEnterInterior/);
assert.match(moduleSource, /miningExitInterior/);
assert.match(moduleSource, /miningFocusInteriorMiner/);
assert.match(moduleSource, /data-mining-interior-progress/);
assert.match(moduleSource, /掌子面开采/);
assert.match(moduleSource, /miningUpgradeFacility/);
assert.match(moduleSource, /miningTogglePreparation/);
assert.match(moduleSource, /下一班勘察简报/);
assert.match(moduleSource, /班前物资/);
assert.match(moduleSource, /班次激励/);
assert.match(moduleSource, /miningSelectIncentive/);
assert.match(moduleSource, /incentiveId:\s*selectedIncentiveId/);
assert.match(moduleSource, /mining-facility-grid/);
assert.match(moduleSource, /miningToggleFallback/);
assert.match(moduleSource, /savePreferenceDraft/, "choosing a mine should automatically persist the application");
assert.match(moduleSource, /已自动保存，等待分配/, "the application bar should confirm server-backed preference state");
assert.match(moduleSource, /socket\.emit\("miningApply", \{[\s\S]*?\}, onSaved\)/, "preference auto-save must handle the server acknowledgement");
assert.match(moduleSource, /restorePreferenceDraftFromServer/, "failed preference saves must remove misleading local markers");
assert.match(moduleSource, /mining-shift-quote/);
assert.match(moduleSource, /MINING_MAP_PORTALS/);
assert.doesNotMatch(moduleSource, /x:\s*456,\s*y:\s*310/, "tree-cover hotspot must not be treated as a mine entrance");
assert.doesNotMatch(moduleSource, /x:\s*1741,\s*y:\s*364/, "roadside hotspot must not be treated as a mine entrance");
assert.match(moduleSource, /x:\s*772,\s*y:\s*314/, "second belt must use the added visible entrance");
assert.match(moduleSource, /x:\s*2067,\s*y:\s*314/, "fifth belt must use the added visible entrance");
assert.match(moduleSource, /mineMapMarker/);
assert.match(moduleSource, /mining-map-marker-svg/);
assert.match(moduleSource, /mining-map-marker-preference/, "selected mines should show a persistent numbered preference badge");
assert.match(moduleSource, /已选志愿/, "the map legend should explain preference markers");
assert.match(moduleSource, /miningMapZoom/);
assert.match(moduleSource, /const MINING_MAP_MAX_ZOOM = 1\.2;/);
assert.match(moduleSource, /bindMiningMap/);
assert.match(moduleSource, /activateModalLifecycle/);
assert.match(moduleSource, /id = "miningMineInspectorRoot"/);
assert.match(moduleSource, /role="dialog" aria-modal="true" aria-labelledby="miningMineDialogTitle"/);
assert.match(moduleSource, /miningCloseMineInspector/);
assert.match(moduleSource, /mineInspectorRenderKey === renderKey/, "unchanged snapshots must not recreate an open mine dialog");
assert.match(moduleSource, /data-action="miningGoToLease"/, "owned mines need a prominent route to the lease controls");
assert.match(moduleSource, /id="miningLeasePanel"/, "owned mine controls need a stable scroll target");
assert.match(moduleSource, /data-action="miningOpenMinerTeam"/, "players without miners need a direct recruitment shortcut");
assert.match(moduleSource, /data-action="miningFocusCrew"/, "the lease action should guide players to crew selection");
assert.match(moduleSource, /mineInspectorVisible && focusedMineId === mineId/, "duplicate clicks on the same mine must be idempotent");
assert.doesNotMatch(moduleSource, /点击洞口查看归属/);
assert.doesNotMatch(moduleSource, /mining-map-portal/, "mine entrances should be direct click targets, not duplicate portal icons");
assert.match(moduleSource, /miningMinerFatigueAt/);
assert.match(moduleSource, /miningMinerEffectLabel/);
assert.match(moduleSource, /矿权记录/);
assert.match(moduleSource, /三十座矿山档案/);
assert.match(moduleSource, /mineRecords/);
assert.match(moduleSource, /mining-atlas-grid/);
assert.match(moduleSource, /miningToggleSurveyReport/);
assert.match(moduleSource, /miningTrainMiner/);
assert.match(moduleSource, /miningCareMiner/);
assert.match(moduleSource, /miningResolveMinerRetention/);
assert.match(moduleSource, /miningFormMentorship/);
assert.match(moduleSource, /miningEndMentorship/);
assert.match(moduleSource, /miningSpecializeMiner/);
assert.match(moduleSource, /miningRenewMinerContract/);
assert.match(moduleSource, /miningPromoteMiner/);
assert.match(moduleSource, /职业专精/);
assert.match(moduleSource, /矿工班次合约/);
assert.match(moduleSource, /矿工评级/);
assert.match(moduleSource, /评级作业加成/);
assert.match(moduleSource, /miner-training-row/);
assert.match(moduleSource, /休整、救护与关怀/);
assert.match(moduleSource, /班组平均士气/);
assert.match(moduleSource, /矿工士气/);
assert.match(moduleSource, /留任事件/);
assert.match(moduleSource, /个人请假/);
assert.match(moduleSource, /师徒带教/);
assert.match(moduleSource, /矿脉线索/);
assert.match(moduleSource, /班组默契/);
assert.match(moduleSource, /crewRecords/);
assert.match(moduleSource, /历史班组 · 一键排班/);
assert.match(moduleSource, /miningAssignCrew/);
assert.match(moduleSource, /值班班长/);
assert.match(moduleSource, /miningSelectForeman/);
assert.match(moduleSource, /foremanId:\s*selectedForemanId/);
assert.match(moduleSource, /井下岗位分工/);
assert.match(moduleSource, /miningAssignRole/);
assert.match(moduleSource, /miningResolveIncident/);
assert.match(moduleSource, /井下急报/);
assert.match(moduleSource, /roleAssignments:\s*\{\s*\.\.\.selectedRoleAssignments\s*\}/);
assert.match(moduleSource, /job\.estimate\.yieldMin/);
assert.match(moduleSource, /job\.estimate\?\.risk/);
assert.match(moduleSource, /setInterval\(tickMiningClock, 1000\)/);
assert.match(css, /\.mining-grid/);
assert.match(css, /\.miner-promotion-panel/);
assert.match(css, /\.mining-incentive-picks/);
assert.match(css, /\.mining-map-viewport/);
assert.match(css, /\.mining-map-marker/);
assert.match(css, /\.mining-map-marker-shape/);
assert.match(css, /\.mining-mine-modal-root/);
assert.match(css, /\.mining-mine-dialog/);
assert.doesNotMatch(css, /\.mining-map-marker::before/);
assert.match(css, /\.mining-map-marker:hover,[\s\S]*background:\s*rgba\(213,\s*230,\s*220,\s*\.08\);/);
assert.match(css, /\.mining-map-zoom\s*\{[\s\S]*right:\s*20px;[\s\S]*bottom:\s*28px;/);
assert.match(css, /width:\s*max\(44px,\s*var\(--portal-width,\s*24px\)\)/, "mine click target should be comfortably larger than the visible entrance");
assert.match(css, /height:\s*max\(44px,\s*var\(--portal-height,\s*22px\)\)/);
assert.match(css, /min-height:\s*0/, "global button sizing must not enlarge mine click targets");
assert.match(css, /mining-panorama-v3\.png/);
assert.match(css, /mining-interior-v1\.png/);
assert.match(css, /\.mining-interior-stage/);
assert.match(css, /\.mining-interior-station/);
assert.match(css, /@keyframes miningDust/);
assert.match(css, /\.mining-shift-quote/);
assert.match(css, /\.miner-basic-profile/);
assert.match(css, /\.miner-basic-profile\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/s);
assert.match(css, /\.miner-basic-profile span\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/s);
assert.match(moduleSource, /class="miner-basic-card-head"/);
assert.match(moduleSource, /class="miner-basic-status/);
assert.match(moduleSource, /class="miner-basic-cost"/);
assert.match(moduleSource, /class="miner-basic-action/);
assert.match(css, /\.mining-basic-hired-section \.miner-grid,[\s\S]*?repeat\(auto-fill,\s*minmax\(280px,\s*1fr\)\)/,
  "basic miner cards should use the same compact auto-fill sizing as employee cards");
assert.match(css, /\.miner-basic-cost\s*\{[^}]*border-top:\s*1px solid var\(--hair\)/s,
  "basic miner wages should use the employee-card cost hierarchy");
assert.match(css, /\.miner-card \.miner-basic-action\s*\{[^}]*width:\s*100%[^}]*min-height:\s*38px/s,
  "basic miner actions should span the card like employee-card actions");
assert.match(css, /\.mining-basic-guide/);
assert.match(css, /\.mining-operation-overview/);
assert.match(css, /\.mining-root\s*\{[\s\S]*?container-type:\s*inline-size/,
  "mining layout should respond to its usable panel width, not only the browser viewport");
assert.match(css, /@container \(max-width:\s*760px\)[\s\S]*?\.mining-operation-layout\s*\{\s*grid-template-columns:\s*1fr/,
  "a compressed desktop mining panel should stack the operation overview and crew console");
assert.doesNotMatch(css, /\.mining-operation-scene/, "basic mining work must not use the cave scene panel");
assert.match(css, /\.mining-record-tabs/);
assert.match(css, /\.miner-section-head/);
assert.match(moduleSource, /矿工独立于普通员工，只参与矿山开采。每班可安排 1–3 人/);
assert.doesNotMatch(moduleSource, /仅参与矿山开采；没有疲劳、士气、合同或岗位培养要求。/);
assert.doesNotMatch(moduleSource, /<span>租期剩余<\/span>/);
assert.doesNotMatch(moduleSource, /每次提供 3 名候选矿工；刷新后将替换当前名单。/);
assert.match(moduleSource, /data-action="miningRecordsTab" data-payload="shifts"/);
assert.match(moduleSource, /data-action="miningRecordsTab" data-payload="leases"/);
assert.match(moduleSource, /data-action="miningRecordsTab" data-payload="applications"/);
assert.match(moduleSource, /竞租记录/);
assert.match(moduleSource, /连续 3 轮未报名，竞租席位已释放并转入候补队尾/);
assert.match(moduleSource, /已获下一轮落选优先/);
assert.match(css, /\.mining-record-tabs\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,/,
  "all three record tabs should remain on one row");
assert.match(moduleSource, /activeRecordsTab === "leases"/);
assert.match(moduleSource, /data-action="miningMinersTab" data-payload="hired"/);
assert.match(moduleSource, /data-action="miningMinersTab" data-payload="recruit"/);
assert.match(moduleSource, /activeMinerTab === "recruit"/);
assert.match(moduleSource, /role="tabpanel" aria-labelledby="miningMinerTabHired"/);
assert.match(moduleSource, /role="tabpanel" aria-labelledby="miningMinerTabRecruit"/);
const basicHiredSectionIndex = moduleSource.indexOf('class="miner-section mining-basic-hired-section"');
const basicRecruitSectionIndex = moduleSource.indexOf('class="miner-section mining-basic-recruit-section"');
const basicRefreshActionIndex = moduleSource.indexOf('data-action="miningRefreshCandidates"');
assert.ok(basicHiredSectionIndex >= 0 && basicRecruitSectionIndex >= 0);
assert.ok(basicRefreshActionIndex >= 0 && basicRefreshActionIndex < basicRecruitSectionIndex,
  "refresh action should belong to the recruit tab header");
assert.match(css, /\.mining-miner-tabs\s*\{/);
assert.match(css, /\.mining-miner-tabs button\.on\s*\{/);
assert.match(css, /\.miner-condition/);
assert.match(css, /\.mining-facility-card/);
assert.match(css, /\.mining-condition-brief/);
assert.match(css, /\.mining-preparation-picks/);
assert.match(css, /\.mining-mastery-summary/);
assert.match(css, /\.mining-crew-bond-summary/);
assert.match(css, /\.miner-crew-records/);
assert.match(css, /\.mining-crew-shortcuts/);
assert.match(css, /\.mining-crew-shortcut-list/);
assert.match(css, /\.mining-foreman-panel/);
assert.match(css, /\.mining-foreman-picks/);
assert.match(css, /\.mining-role-panel/);
assert.match(css, /\.mining-role-grid/);
assert.match(css, /\.mining-role-card/);
assert.match(css, /\.mining-incident-card/);
assert.match(css, /\.mining-incident-choices/);
assert.match(css, /\.mining-atlas-card/);
assert.match(css, /\.mining-survey-use/);
assert.ok(interiorAsset.length > 100_000, "mine interior scene asset should be bundled with the game");
assert.match(css, /\.mining-survey-meter/);
assert.match(css, /\.miner-training-grid/);
assert.match(css, /\.miner-training-row/);
assert.match(css, /\.miner-care-panel/);
assert.match(css, /\.miner-morale/);
assert.match(css, /\.miner-retention-panel/);
assert.match(css, /\.miner-retention-choices/);
assert.match(css, /\.miner-mentorship-section/);
assert.match(css, /\.miner-mentorship-active/);
assert.match(css, /\.mining-morale-summary/);
assert.match(css, /\.miner-specialization-panel/);
assert.match(css, /\.miner-specialization-choices/);
assert.match(css, /\.miner-contract-panel/);
assert.match(css, /\.miner-grid\s*\{\s*grid-template-columns:\s*repeat\(2,/);
assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*\.mining-atlas-grid,[\s\S]*grid-template-columns:\s*1fr/);
assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*\.miner-training-row\s*\{\s*grid-template-columns:\s*1fr/);
assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*\.mining-crew-shortcut-list\s*\{\s*grid-template-columns:\s*1fr/);
assert.match(css, /@media \(max-width:\s*720px\)/);
assert.match(inventoryHelpers, /班组默契/);
assert.match(inventoryHelpers, /crewNames/);
assert.match(inventoryHelpers, /值班班长/);
assert.match(inventoryHelpers, /foremanLabel/);
assert.match(inventoryHelpers, /井下分工/);
assert.match(inventoryHelpers, /roleLabels/);
assert.match(inventoryHelpers, /矿工专精/);
assert.match(inventoryHelpers, /crewSpecializations/);

assert.match(minerSystem, /player\?\.mining\?\.miners/);
assert.doesNotMatch(minerSystem, /player\.workshop\.workers/);
assert.doesNotMatch(minerSystem, /ordinaryWorker/);

console.log("mining-ui-smoke: simplified 30-mine loop, four tabs, responsive UI and isolated miners ok");
