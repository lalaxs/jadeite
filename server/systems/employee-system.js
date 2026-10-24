import {
  baseWageForTier,
  workerDailyWage,
  workerProcessingFee,
  recruitPrice,
  RECRUIT_REFRESH_COST
} from "../../shared/domain/economy/worker-economy.js";

export {
  baseWageForTier,
  workerDailyWage,
  workerProcessingFee,
  recruitPrice,
  RECRUIT_REFRESH_COST
};

import { normalizeEmployeePayroll, settleEmployeePayroll, employeeRecruitmentBlock,
  enterEmployeePayrollDay, recordEmployeePayrollRoster } from "./employee-payroll.js";
export { normalizeEmployeePayroll, settleEmployeePayroll } from "./employee-payroll.js";

export const MAX_WORKERS = 8;

export const ACTIVITY_XP = {
  opening: { jieliao: 10, damo: 5 },
  carving: { xiuxing: 10, qieliao: 5 },
  finishing: { diaozhuo: 10, xiangqian: 5 },
  bangleFinishing: { damo: 9, xiuxing: 6 },
  livestream: { huashu: 10, kongchang: 7, cuidan: 5 },
  // 直播—P2：单笔成交少量经验，关播/售罄再给完场经验
  livestreamSale: { huashu: 3, kongchang: 2, cuidan: 2 },
  livestreamSession: { huashu: 8, kongchang: 5, cuidan: 4 }
};

const TIER_WEIGHTS = [
  [1, 0.30],
  [2, 0.25],
  [3, 0.18],
  [4, 0.12],
  [5, 0.07],
  [6, 0.04],
  [7, 0.025],
  [8, 0.015]
];

const SKILL_DIR = {
  jieliao: "cut",
  damo: "cut",
  qieliao: "set",
  xiuxing: "set",
  diaozhuo: "finish",
  xiangqian: "finish",
  huashu: "speak",
  kongchang: "speak",
  cuidan: "speak"
};

const JOB_SKILLS = {
  cutter: ["jieliao", "damo"],
  planner: ["qieliao", "xiuxing"],
  finisher: ["diaozhuo", "xiangqian"],
  streamer: ["huashu", "kongchang", "cuidan"]
};

const NAMES = ["阿良", "玉芬", "周师傅", "林巧", "陈稳", "许宁", "罗师傅", "小满", "梁玉", "宋师傅", "叶青", "顾成"];
const RECRUIT_POSITIVE_TRAITS = ["巧手", "净料", "稳手", "心细"];
export const POSITIVE_TRAITS = [...RECRUIT_POSITIVE_TRAITS, "按线稳", "细光", "收口准"];
export const NEGATIVE_TRAITS = ["易裂", "易出绵", "易脏", "手重"];

/** 纠正误放进 flaws 的优点 / 误放进 traits 的缺点（如初始员工把「巧手」写成缺点）。 */
export function sanitizeWorkerTraits(worker, fallback = {}) {
  const positive = new Set(POSITIVE_TRAITS);
  const negative = new Set(NEGATIVE_TRAITS);
  const rawTraits = Array.isArray(worker?.traits) ? worker.traits : [];
  const rawFlaws = Array.isArray(worker?.flaws) ? worker.flaws : [];
  const traits = [];
  const flaws = [];
  for (const name of rawTraits) {
    if (negative.has(name)) {
      if (!flaws.includes(name)) flaws.push(name);
    } else if (!traits.includes(name)) {
      traits.push(name);
    }
  }
  for (const name of rawFlaws) {
    if (positive.has(name)) {
      // 优点不应留在缺点槽；若优点槽已有内容则丢弃误放项，避免凭空多出天赋
      if (!traits.length) traits.push(name);
    } else if (!flaws.includes(name)) {
      flaws.push(name);
    }
  }
  if (!traits.length && Array.isArray(fallback.traits)) {
    for (const name of fallback.traits) {
      if (!traits.includes(name)) traits.push(name);
    }
  }
  if (!flaws.length && Array.isArray(fallback.flaws)) {
    for (const name of fallback.flaws) {
      if (!flaws.includes(name)) flaws.push(name);
    }
  }
  return { traits, flaws };
}

export function isWorkerBusy(player, workerId) {
  if (!workerId) return false;
  if (player?.workshop?.workers?.some((worker) => worker.id === workerId && worker.blackmarketListingId)) return true;
  if (player?.livestreamRoom?.status === "live" && player.livestreamRoom.hostWorkerId === workerId) {
    return true;
  }
  return [...(player?.jobs || [])].some((job) => job.workerId === workerId);
}

function addSkillExp(skill, amount) {
  if (!skill || skill.level >= 10) return [];
  const levels = [];
  skill.exp += amount;
  while (skill.level < 10 && skill.exp >= 50 * skill.level) {
    skill.exp -= 50 * skill.level;
    skill.level += 1;
    levels.push(skill.level);
  }
  if (skill.level >= 10) skill.exp = 0;
  return levels;
}

function pick(list, rng) {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

function randomInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function weightedTier(rng) {
  let roll = rng();
  for (const [tier, weight] of TIER_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return tier;
  }
  return 8;
}

function hiredWorkerNames(player) {
  return new Set(
    (player?.workshop?.workers || [])
      .map((worker) => String(worker?.name || "").trim())
      .filter(Boolean)
  );
}

/** 从名池取不与 used 冲突的名字；名池耗尽时用「基—序号」兜底。*/
function pickUniqueName(rng, used) {
  const available = NAMES.filter((name) => !used.has(name));
  if (available.length) {
    const name = pick(available, rng);
    used.add(name);
    return name;
  }
  const base = pick(NAMES, rng);
  let n = 2;
  while (used.has(`${base}${n}`)) n += 1;
  const name = `${base}${n}`;
  used.add(name);
  return name;
}

function candidateSkills(job, tier, rng) {
  const skills = { cut: {}, set: {}, finish: {}, speak: {} };
  for (const [key, dir] of Object.entries(SKILL_DIR)) {
    const main = JOB_SKILLS[job].includes(key);
    const level = main
      ? Math.min(10, tier + 1 + randomInt(rng, 0, 1))
      : Math.min(6, 1 + randomInt(rng, 0, Math.min(3, tier - 1)));
    skills[dir][key] = { level, exp: 0 };
  }
  return skills;
}

export function makeCandidate({ rng, makeId, usedNames, tier: requestedTier, job: requestedJob }) {
  const jobs = Object.keys(JOB_SKILLS);
  const tier = requestedTier || weightedTier(rng);
  const job = requestedJob || pick(jobs, rng);
  return {
    id: makeId(),
    name: pickUniqueName(rng, usedNames),
    job,
    tier,
    tierLevel: 1,
    traits: [pick(RECRUIT_POSITIVE_TRAITS, rng)],
    flaws: [pick(NEGATIVE_TRAITS, rng)],
    skills: candidateSkills(job, tier, rng),
    baseWage: baseWageForTier(tier),
    price: recruitPrice(tier)
  };
}

function newCandidateBatch(deps, reservedNames = []) {
  const usedNames = new Set(reservedNames);
  return [
    makeCandidate({ ...deps, usedNames }),
    makeCandidate({ ...deps, usedNames }),
    makeCandidate({ ...deps, usedNames })
  ];
}

export function ensureRecruitCandidates(player, deps) {
  if (player.recruitCandidatesInitialized === true) {
    if (!Array.isArray(player.recruitCandidates)) player.recruitCandidates = [];
    player.recruitCandidates = player.recruitCandidates.map((candidate) => ({
      ...candidate,
      baseWage: baseWageForTier(candidate.tier),
      price: recruitPrice(candidate.tier)
    }));
    return player.recruitCandidates;
  }
  if (!Array.isArray(player.recruitCandidates) || player.recruitCandidates.length === 0) {
    player.recruitCandidates = newCandidateBatch(deps, [...hiredWorkerNames(player)]);
  }
  player.recruitCandidates = player.recruitCandidates.map((candidate) => ({
    ...candidate,
    baseWage: baseWageForTier(candidate.tier),
    price: recruitPrice(candidate.tier)
  }));
  player.recruitCandidatesInitialized = true;
  return player.recruitCandidates;
}

export function refreshRecruitCandidates(player, { rng, makeId, spendCash }) {
  enterEmployeePayrollDay(player, { spendCash, reason: "continued" });
  const blocked = employeeRecruitmentBlock(player);
  if (blocked) return blocked;
  if (!spendCash(
    player,
    RECRUIT_REFRESH_COST,
    "刷新招聘候选人",
    { source: "recruitRefresh" }
  )) {
    return {
      ok: false,
      code: "INSUFFICIENT_CASH",
      message: `刷新候选人需要 ¥${RECRUIT_REFRESH_COST}。` };
  }
  player.recruitCandidates = newCandidateBatch(
    { rng, makeId },
    [...hiredWorkerNames(player)]
  );
  player.recruitCandidatesInitialized = true;
  return { ok: true, message: "候选人已经刷新。", candidates: player.recruitCandidates };
}

export function recruitWorker(player, candidateId, { spendCash, now = Date.now() }) {
  enterEmployeePayrollDay(player, { spendCash, now, reason: "continued" });
  const blocked = employeeRecruitmentBlock(player, now);
  if (blocked) return blocked;
  player.workshop ||= {};
  player.workshop.workers ||= [];
  if (player.workshop.workers.length >= MAX_WORKERS) {
    return { ok: false, code: "ROSTER_FULL", message: "员工人数已经达到 8 人上限。" };
  }
  const candidates = (player.recruitCandidates || [])
    .filter((item) => item.id === candidateId);
  if (!candidates.length) {
    return { ok: false, code: "NOT_FOUND", message: "候选人不存在。" };
  }
  if (candidates.length > 1) {
    return { ok: false, code: "ID_CONFLICT", message: "候选人编号冲突，请刷新招聘列表。" };
  }
  const candidate = candidates[0];
  if (player.workshop.workers.some((worker) => worker.id === candidate.id)) {
    return { ok: false, code: "ID_CONFLICT", message: "该员工编号已在工坊中，本次招聘未扣款。" };
  }
  if (!spendCash(
    player,
    candidate.price,
    `招聘员工：${candidate.name}`,
    { source: "recruit", itemId: candidate.id }
  )) {
    return {
      ok: false,
      code: "INSUFFICIENT_CASH",
      message: `招聘 ${candidate.name} 需要 ¥${candidate.price}。`
    };
  }
  const worker = structuredClone(candidate);
  delete worker.price;
  worker.resourceOrigin = "recruit";
  worker.acquisitionPrice = candidate.price;
  worker.acquiredAt = now;
  normalizeEmployeePayroll(player, now);
  worker.payrollAt = now;
  player.workshop.workers.push(worker);
  recordEmployeePayrollRoster(player, now);
  player.recruitCandidates = player.recruitCandidates
    .filter((item) => item.id !== candidateId);
  return { ok: true, message: `${worker.name} 已加入工坊，日工资 ¥${workerDailyWage(worker)}，当天记薪，下一个登录日结算。`, worker };
}

/** 与 workshop-roster 初始四人 id 对齐；招募员工使用 UUID，不会命中此表。 */
export const STARTER_WORKER_IDS = Object.freeze([
  "worker-opening",
  "worker-carving",
  "worker-polishing",
  "worker-finishing"
]);

export function isStarterWorkerId(workerId) {
  return STARTER_WORKER_IDS.includes(String(workerId || "").trim());
}

export function dismissWorker(player, workerId, payrollOptions = {}) {
  player.workshop ||= {};
  player.workshop.workers ||= [];
  const id = String(workerId || "").trim();
  const worker = player.workshop.workers.find((entry) => entry.id === id);
  if (!worker) {
    return { ok: false, code: "NOT_FOUND", message: "员工不存在。" };
  }
  if (isWorkerBusy(player, id)) {
    return { ok: false, code: "BUSY", message: "员工忙碌中，无法解雇。" };
  }
  const payroll = settleEmployeePayroll(player, { ...payrollOptions, closingWorkerId: id });
  const closingWage = payroll.receipt?.entries.find((entry) => entry.workerId === id)?.dailyWage ?? workerDailyWage(worker);
  player.workshop.workers = player.workshop.workers.filter((entry) => entry.id !== id);
  if (isStarterWorkerId(id)) {
    const dismissed = normalizeDismissedStarterIds(player.workshop.dismissedStarterIds);
    if (!dismissed.includes(id)) dismissed.push(id);
    player.workshop.dismissedStarterIds = dismissed;
  }
  return { ok: true, message: `已解雇 ${worker.name}，含当天整日工资 ¥${closingWage}；本次已扣 ¥${payroll.paid}。${payroll.debt > 0 ? `待补工资 ¥${payroll.debt}，保留周转金后，按保留周转金后按经营收入20%补薪，也可在员工页手动补齐。` : ""}`, worker, payroll };
}

export function normalizeDismissedStarterIds(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(
    raw
      .map((id) => String(id || "").trim())
      .filter((id) => id && isStarterWorkerId(id))
  )];
}

export function mergeWorkers(starters, existing, { dismissedStarterIds = [] } = {}) {
  const dismissed = new Set(normalizeDismissedStarterIds(dismissedStarterIds));
  const starterIds = new Set(starters.map((worker) => worker.id));
  const existingById = new Map(existing.map((worker) => [worker.id, worker]));
  const mergedStarters = starters
    .filter((starter) => !dismissed.has(starter.id))
    .map((starter) => {
      const saved = existingById.get(starter.id);
      return saved ? { ...structuredClone(starter), ...saved } : structuredClone(starter);
    });
  const recruits = existing.filter((worker) => !starterIds.has(worker.id));
  return [...mergedStarters, ...recruits].slice(0, MAX_WORKERS);
}

export function grantActivityExperience(worker, activity) {
  const grants = ACTIVITY_XP[activity] || {};
  const levelUps = [];
  for (const [key, amount] of Object.entries(grants)) {
    const dir = SKILL_DIR[key];
    const skill = worker?.skills?.[dir]?.[key];
    for (const level of addSkillExp(skill, amount)) {
      levelUps.push({ key, level });
    }
  }
  return { grants, levelUps };
}
