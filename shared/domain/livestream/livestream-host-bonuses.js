// 直播主播技能加成：前后端共用，开播时快照进房间，本场不随升级变化。

export function livestreamSkillLevel(source, key) {
  if (source == null) return 1;
  if (typeof source === "number" || typeof source === "string") {
    return Math.max(1, Math.min(10, Math.round(Number(source) || 1)));
  }
  const nested = source?.skills?.speak?.[key]
    || source?.speak?.[key]
    || source?.skills?.[key]
    || source?.[key];
  const level = nested && typeof nested === "object" ? nested.level : nested;
  return Math.max(1, Math.min(10, Math.round(Number(level) || 1)));
}

export function livestreamSkillProgress(level) {
  return Math.max(0, Math.min(1, (livestreamSkillLevel(level) - 1) / 9));
}

export function hostSkillLevelsFromWorker(worker) {
  return {
    huashu: livestreamSkillLevel(worker, "huashu"),
    kongchang: livestreamSkillLevel(worker, "kongchang"),
    cuidan: livestreamSkillLevel(worker, "cuidan")
  };
}

/** Lv1→10：话术溢价、控场流速、催单转化。 */
export function hostBonusesFromLevels(levels = {}) {
  const huashu = livestreamSkillProgress(levels.huashu);
  const kongchang = livestreamSkillProgress(levels.kongchang);
  const cuidan = livestreamSkillProgress(levels.cuidan);
  return {
    premium: Number((huashu * 0.10).toFixed(4)),
    premiumSoft: Number((huashu * 0.06).toFixed(4)),
    traffic: Number((kongchang * 0.22).toFixed(4)),
    likes: Number((kongchang * 0.35).toFixed(4)),
    convert: Number((cuidan * 0.12).toFixed(4))
  };
}

export function hostBonusesFromWorker(worker) {
  const skills = hostSkillLevelsFromWorker(worker);
  return {
    skills,
    bonuses: hostBonusesFromLevels(skills)
  };
}

/** 开播话术风格：不替代选人，只微调本场加成倾向。 */
export const LIVESTREAM_TALK_STYLES = {
  steady: {
    id: "steady",
    label: "稳卖",
    desc: "走量优先：转化更高、到访稍快，溢价能力减弱",
    mult: { premium: 0.7, premiumSoft: 0.45, convert: 1.28, traffic: 1.18, likes: 1.05 }
  },
  balanced: {
    id: "balanced",
    label: "均衡",
    desc: "按主播本事发挥，不做额外偏向",
    mult: { premium: 1, premiumSoft: 1, convert: 1, traffic: 1, likes: 1 }
  },
  push: {
    id: "push",
    label: "冲高",
    desc: "冲溢价：贵价更好谈，转化略降、节奏稍慢",
    mult: { premium: 1.4, premiumSoft: 1.55, convert: 0.82, traffic: 0.88, likes: 1.12 }
  }
};

export function normalizeTalkStyle(styleId) {
  return LIVESTREAM_TALK_STYLES[styleId] ? styleId : "balanced";
}

export function talkStyleMeta(styleId) {
  const id = normalizeTalkStyle(styleId);
  return { ...LIVESTREAM_TALK_STYLES[id] };
}

export function applyTalkStyleToBonuses(bonuses = {}, styleId = "balanced") {
  const style = talkStyleMeta(styleId);
  const next = {};
  for (const key of ["premium", "premiumSoft", "convert", "traffic", "likes"]) {
    next[key] = Number(((Number(bonuses?.[key]) || 0) * style.mult[key]).toFixed(4));
  }
  next.traffic = Math.max(0, Math.min(0.25, next.traffic));
  return next;
}

export function hostBonusesWithTalkStyle(worker, styleId = "balanced") {
  const { skills, bonuses } = hostBonusesFromWorker(worker);
  const styled = applyTalkStyleToBonuses(bonuses, styleId);
  return {
    skills,
    bonuses: styled,
    talkStyle: normalizeTalkStyle(styleId),
    preview: hostBonusPreview(styled)
  };
}

export function hostBonusPreview(bonuses = {}) {
  const premium = Number(bonuses.premium) || 0;
  const convert = Number(bonuses.convert) || 0;
  const traffic = Number(bonuses.traffic) || 0;
  const likes = Number(bonuses.likes) || 0;
  return {
    convertPct: Math.round(((1 + premium) * (1 + convert) - 1) * 100),
    trafficPct: Math.round(traffic * 100),
    likesPct: Math.round(likes * 100)
  };
}

/** 开播选人排序分：空闲优先、直播掌柜优先，再比加成与话术。 */
export function livestreamHostScore(worker) {
  if (!worker || worker.busy) return Number.NEGATIVE_INFINITY;
  const { bonuses } = hostBonusesFromWorker(worker);
  const preview = hostBonusPreview(bonuses);
  const streamerBoost = worker.job === "streamer" ? 1_000 : 0;
  const speakPower = livestreamSkillLevel(worker, "huashu")
    + livestreamSkillLevel(worker, "kongchang")
    + livestreamSkillLevel(worker, "cuidan");
  return streamerBoost
    + preview.convertPct * 10
    + preview.trafficPct * 5
    + preview.likesPct * 2
    + speakPower;
}

export function rankLivestreamHosts(workers = []) {
  return [...(workers || [])].sort((left, right) => {
    const leftBusy = left?.busy ? 1 : 0;
    const rightBusy = right?.busy ? 1 : 0;
    if (leftBusy !== rightBusy) return leftBusy - rightBusy;
    return livestreamHostScore(right) - livestreamHostScore(left);
  });
}

export function recommendLivestreamHost(workers = []) {
  return rankLivestreamHosts(workers).find((worker) => !worker?.busy) || null;
}

export function applyHostPurchaseBonuses(baseChance, ratio, bonuses = {}, limits = {}) {
  const premium = Math.max(0, Number(bonuses.premium) || 0);
  const premiumSoft = Math.max(0, Number(bonuses.premiumSoft) || 0);
  const convert = Math.max(0, Number(bonuses.convert) || 0);
  let chance = Number(baseChance) || 0;
  if (Number(ratio) > 1) {
    chance += Math.min(0.08, (Number(ratio) - 1) * premiumSoft * 2);
  }
  chance *= (1 + premium) * (1 + convert);
  const minChance = Math.max(0, Number(limits.minChance) || 0.01);
  const maxChance = Math.max(minChance, Number(limits.maxChance) || 0.88);
  return Math.max(minChance, Math.min(maxChance, chance));
}

export function hostVisitIntervalScale(bonuses = {}) {
  const traffic = Math.max(0, Math.min(0.25, Number(bonuses.traffic) || 0));
  return Math.max(0.75, 1 - traffic);
}

export function hostLikeGain(baseLikes, bonuses = {}) {
  const likes = Math.max(0, Number(bonuses.likes) || 0);
  return Math.max(1, Math.round(Number(baseLikes || 0) * (1 + likes)));
}
