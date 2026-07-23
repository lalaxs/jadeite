export const MAX_WORKERS = 8;
export const RECRUIT_REFRESH_COST = 500;
export const ACTIVITY_XP = {
  opening: { jieliao: 10, damo: 5 },
  carving: { xiuxing: 10, qieliao: 5 },
  finishing: { diaozhuo: 10, xiangqian: 5 },
  livestream: { huashu: 10, kongchang: 7, cuidan: 5 }
};

const TIER_WEIGHTS = [
  [1, 0.45],
  [2, 0.30],
  [3, 0.15],
  [4, 0.08],
  [5, 0.02]
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
const POSITIVE_TRAITS = ["巧手", "净料", "稳手", "心细"];
const NEGATIVE_TRAITS = ["易裂", "易出绵", "易脏", "手重"];

export function recruitPrice(tier) {
  return 1500 + Number(tier) ** 2 * 750;
}

export function isWorkerBusy(player, workerId) {
  return [...(player?.jobs || []), ...(player?.livestreamJobs || [])]
    .some((job) => job.workerId === workerId);
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
  return 5;
}

function candidateSkills(job, tier, rng) {
  const skills = { cut: {}, set: {}, finish: {}, speak: {} };
  for (const [key, dir] of Object.entries(SKILL_DIR)) {
    const main = JOB_SKILLS[job].includes(key);
    const level = main
      ? Math.min(7, tier + 1 + randomInt(rng, 0, 1))
      : Math.min(5, 1 + randomInt(rng, 0, Math.min(2, tier - 1)));
    skills[dir][key] = { level, exp: 0 };
  }
  return skills;
}

function makeCandidate({ rng, makeId }) {
  const jobs = Object.keys(JOB_SKILLS);
  const tier = weightedTier(rng);
  const job = pick(jobs, rng);
  return {
    id: makeId(),
    name: pick(NAMES, rng),
    job,
    tier,
    tierLevel: 1,
    traits: [pick(POSITIVE_TRAITS, rng)],
    flaws: [pick(NEGATIVE_TRAITS, rng)],
    skills: candidateSkills(job, tier, rng),
    price: recruitPrice(tier)
  };
}

function newCandidateBatch(deps) {
  return [
    makeCandidate(deps),
    makeCandidate(deps),
    makeCandidate(deps)
  ];
}

export function ensureRecruitCandidates(player, deps) {
  if (!Array.isArray(player.recruitCandidates) || player.recruitCandidates.length === 0) {
    player.recruitCandidates = newCandidateBatch(deps);
  }
  return player.recruitCandidates;
}

export function refreshRecruitCandidates(player, { rng, makeId, spendCash }) {
  if (!spendCash(
    player,
    RECRUIT_REFRESH_COST,
    "刷新招聘候选人",
    { source: "recruitRefresh" }
  )) {
    return {
      ok: false,
      code: "INSUFFICIENT_CASH",
      message: "刷新候选人需要 ¥500。"
    };
  }
  player.recruitCandidates = newCandidateBatch({ rng, makeId });
  return { ok: true, message: "候选人已经刷新。", candidates: player.recruitCandidates };
}

export function recruitWorker(player, candidateId, { spendCash }) {
  player.workshop ||= {};
  player.workshop.workers ||= [];
  if (player.workshop.workers.length >= MAX_WORKERS) {
    return { ok: false, code: "ROSTER_FULL", message: "员工人数已经达到 8 人上限。" };
  }
  const candidate = (player.recruitCandidates || [])
    .find((item) => item.id === candidateId);
  if (!candidate) {
    return { ok: false, code: "NOT_FOUND", message: "候选人不存在。" };
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
  player.workshop.workers.push(worker);
  player.recruitCandidates = player.recruitCandidates
    .filter((item) => item.id !== candidateId);
  return { ok: true, message: `${worker.name} 已加入工坊。`, worker };
}

export function mergeWorkers(starters, existing) {
  const starterIds = new Set(starters.map((worker) => worker.id));
  const existingById = new Map(existing.map((worker) => [worker.id, worker]));
  const mergedStarters = starters.map((starter) => {
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
