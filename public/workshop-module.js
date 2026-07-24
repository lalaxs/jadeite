// 工坊系统模块（从 main.js 抽离，依赖注入解耦）
import { inlaySummary } from "./product-meta.js";

let socketRef;
let getState;
let elsRef;
let activeWorkshopDeviceId = null;
let selectedWorkshopItemId = null;
let selectedWorkshopWorkerId = null;
let activeWorkshopStep = "open";
let activeWorkshopPicker = null;
let pickerMountKey = null; // 当前已挂载到 DOM 的弹窗标识（kind:deviceId），避免每次重绘重建外壳
let activePickerWorkerId = null; // 选工弹窗内临时选中的员工（点详情用，不直接指派）
let activeWorkerSort = "default"; // 选工弹窗列表排序：default=品阶降序 / quality / flawless / speed
let activeFinishPlanModal = null;
let stageDrawerOpen = false;
let formatMoney, formatDuration, escapeHtml, empty, nowMs, typeName, materialStageForClient, materialStageLabel, productCanvas, openingStoneSvg, openingKitsForRender, kitsFor, roughBoard, roughPlannerControls, placementAnalysisRows, openingKitsForServer, roughKits, paintJades, showToast, productionJobsFor;

export function initWorkshopModule(deps) {
  socketRef = deps.socket;
  getState = deps.getState;
  elsRef = deps.els;
  ({ formatMoney, formatDuration, escapeHtml, empty, nowMs, typeName, materialStageForClient, materialStageLabel, productCanvas, openingStoneSvg, openingKitsForRender, kitsFor, roughBoard, roughPlannerControls, placementAnalysisRows, openingKitsForServer, roughKits, paintJades, showToast, productionJobsFor } = deps.helpers);
}

const WORKSHOP_DEVICE_FALLBACKS = [
  { id: "opening", type: "opening", step: "open", name: "粗加工台", category: "打磨机", tier: "T1", model: "角磨机 CJ-1 基础型", inputStage: "rough", inputType: "rough", outputStage: "opened", capacity: 1, workerId: "worker-opening", fee: 620, condition: 92, specs: "完美度保底 +0% · 风险系数 1.20 · 基准耗时", description: "玉翠加工第一道工序：打磨暗料原石揭露真容，显出真实料性与先天瑕疵。" },
  { id: "carving", type: "carving", step: "plan", name: "套件雕刻台", category: "套料机", tier: "T1", model: "数控套料机 SK-2", inputStage: "opened", inputType: "rough", outputStage: "carved", capacity: 1, workerId: "worker-polishing", fee: 900, condition: 84, specs: "取件精度 标准 · 压裂风险 中 · 支持 3D 扫描设计", description: "在已揭露薄片上规划并取出套件，产可交易「粗加工套件」。规划层＝玉料扫描设计台。" },
  { id: "finishing", type: "finishing", step: "finish", name: "精加工抛光台", category: "玉雕机·抛光机", tier: "T1", model: "精雕抛光一体机 JP-3", inputStage: "carved", inputType: "bracelet", outputStage: "finished", capacity: 1, workerId: "worker-carving", fee: 680, condition: 76, specs: "起货保底 +0% · 翻车系数 1.10 · 含抛光与镶嵌底托工序", description: "逐套件精加工：先抛光出光感，再镶嵌底托/手镯圈口完成版式收口，产出最终成品。" }
];

// 工坊三步加工页签（开料 / 规划 / 精加工）
const WORKSHOP_STEPS = [
  { id: "open", label: "开料", desc: "打磨暗料，显出真实料子样子。" },
  { id: "plan", label: "规划", desc: "在明料上摆放套件，规划取件。" },
  { id: "finish", label: "精加工", desc: "完成版式、底托与细部收口。" }
];
// 设备只有 stage(opening/carving/finishing)，需映射到设计步骤(open/plan/finish)
const STEP_BY_STAGE = { opening: "open", carving: "plan", finishing: "finish" };
function deviceStep(d) {
  return STEP_BY_STAGE[d?.stage] || "open";
}
function deviceAttr(d, key) {
  const a = d?.attrs || {};
  return (key === "risk") ? (Number(a.risk) || 1).toFixed(2) : (Number(a[key]) || 0).toFixed(1);
}

const WORKSHOP_WORKER_FALLBACKS = [
  { id: "worker-opening", name: "阿成", job: "cutter", tier: 5, tierLevel: 1, traits: ["稳手"], flaws: ["巧手"],
    skills: { cut: { jieliao: { level: 6, exp: 180 }, damo: { level: 5, exp: 150 } }, set: { qieliao: { level: 3, exp: 80 }, xiuxing: { level: 2, exp: 50 } }, finish: { diaozhuo: { level: 2, exp: 40 }, xiangqian: { level: 2, exp: 30 } }, speak: { huashu: { level: 1, exp: 15 }, kongchang: { level: 1, exp: 10 }, cuidan: { level: 1, exp: 5 } } } },
  { id: "worker-carving", name: "林师傅", job: "finisher", tier: 8, tierLevel: 1, traits: ["按线稳"], flaws: ["心细"],
    skills: { cut: { jieliao: { level: 2, exp: 60 }, damo: { level: 2, exp: 40 } }, set: { qieliao: { level: 2, exp: 50 }, xiuxing: { level: 2, exp: 45 } }, finish: { diaozhuo: { level: 6, exp: 200 }, xiangqian: { level: 5, exp: 180 } }, speak: { huashu: { level: 1, exp: 20 }, kongchang: { level: 1, exp: 12 }, cuidan: { level: 1, exp: 8 } } } },
  { id: "worker-polishing", name: "小周", job: "planner", tier: 3, tierLevel: 1, traits: ["细光"], flaws: ["手重"],
    skills: { cut: { jieliao: { level: 3, exp: 90 }, damo: { level: 3, exp: 70 } }, set: { qieliao: { level: 6, exp: 240 }, xiuxing: { level: 5, exp: 210 } }, finish: { diaozhuo: { level: 2, exp: 35 }, xiangqian: { level: 2, exp: 25 } }, speak: { huashu: { level: 1, exp: 18 }, kongchang: { level: 1, exp: 11 }, cuidan: { level: 1, exp: 6 } } } },
  { id: "worker-finishing", name: "许工", job: "streamer", tier: 6, tierLevel: 1, traits: ["收口准"], flaws: ["易出绵"],
    skills: { cut: { jieliao: { level: 2, exp: 55 }, damo: { level: 2, exp: 45 } }, set: { qieliao: { level: 2, exp: 48 }, xiuxing: { level: 2, exp: 42 } }, finish: { diaozhuo: { level: 2, exp: 38 }, xiangqian: { level: 2, exp: 28 } }, speak: { huashu: { level: 6, exp: 190 }, kongchang: { level: 5, exp: 160 }, cuidan: { level: 5, exp: 155 } } } }
];

// ── 员工养成：技能 / 品阶 / 属性 计算模型（与 翡翠街_员工养成系统设计案 对齐）──
// 品阶 = 数字 1~10 阶（替代 白/绿/蓝/紫/金 颜色名）
const TIER_MULT = { 1: 1.0, 2: 1.07, 3: 1.15, 4: 1.24, 5: 1.35, 6: 1.47, 7: 1.6, 8: 1.72, 9: 1.85, 10: 2.0 };
const TIER_BASE_TIME = { 1: 1.0, 2: 0.98, 3: 0.96, 4: 0.94, 5: 0.92, 6: 0.90, 7: 0.88, 8: 0.86, 9: 0.84, 10: 0.82 };
// 品阶显示：数字阶 + 渐变徽章（低阶翡翠绿 → 高阶暖金）
function tierLabel(worker) { return `${Number(worker?.tier) || 1}阶`; }
function tierBadgeStyle(tier) {
  const t = clamp(Number(tier) || 1, 1, 10);
  const f = (t - 1) / 9;
  const jade = [71, 164, 116], gold = [206, 184, 124];
  const c = jade.map((jv, i) => Math.round(jv + f * (gold[i] - jv)));
  return `background:linear-gradient(135deg,rgb(${c[0]},${c[1]},${c[2]}),rgba(${c[0]},${c[1]},${c[2]},.82));color:#10221b`;
}
// 左卡边框颜色：按品阶从翡翠绿 → 暖金 渐变（实色无 alpha，让边框差异一眼可辨）
// 1~2 阶：偏冷绿（低阶）→ 5~6 阶：偏青绿（中阶）→ 9~10 阶：暖金（高阶）
function tierBorder(tier) {
  const t = clamp(Number(tier) || 1, 1, 10);
  const f = (t - 1) / 9;
  const jade = [52, 138, 100], gold = [232, 168, 60];
  const c = jade.map((jv, i) => Math.round(jv + f * (gold[i] - jv)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
// 等级 → 效能系数 k（共用形状，Lv1=12% → Lv10=100%，索引 0 不用）
const K_CURVE = [0, 0.12, 0.24, 0.37, 0.5, 0.63, 0.74, 0.83, 0.9, 0.95, 1.0];
// 9 个具体技能 → 独占属性（白板 Lv10 满值 / 完美率贡献% / 所属方向）
const SKILL_DEFS = {
  jieliao:   { name: "解料", attr: "完整度",     full: 18, dir: "cut" },
  damo:      { name: "打磨", attr: "光泽度",     full: 15, dir: "cut" },
  qieliao:   { name: "切料", attr: "瑕疵控制",   full: 12, dir: "set" },
  xiuxing:   { name: "修形", attr: "造型精度",   full: 14, dir: "set" },
  diaozhuo:  { name: "雕琢", attr: "雕琢精细度", full: 22, dir: "finish" },
  xiangqian: { name: "镶嵌", attr: "镶嵌贴合度", full: 16, dir: "finish" },
  huashu:    { name: "话术", attr: "溢价力",     full: 12, dir: "speak" },
  kongchang: { name: "控场", attr: "控场流速",   full: 10, dir: "speak" },
  cuidan:    { name: "催单", attr: "逼单转化",   full: 10, dir: "speak" }
};
const PROCESS_SKILLS = ["jieliao", "damo", "qieliao", "xiuxing", "diaozhuo", "xiangqian"];
// 工序 → 本工序计入评分/价格的属性（按工序取相关属性）
const STEP_ATTRS = { open: ["jieliao", "damo"], plan: ["qieliao", "xiuxing"], finish: ["diaozhuo", "xiangqian"] };
// 词条正/负（用于显示着色与净瑕疵修正）
const FLAW_DEFS = {
  易裂: -0.08, 易出绵: -0.06, 易脏: -0.05, 手重: -0.04,
  巧手: 0.05, 净料: 0.06, 稳手: 0.04, 心细: 0.04
};
// 词条说明（点击词条 chip 时在旁边弹出小 tooltip）
const TRAIT_DESC = {
  稳手: "手感稳健，压裂与崩口风险更低。",
  按线稳: "下刀贴合设计线，取件边界更准。",
  细光: "抛光细腻，表面光感更润。",
  收口准: "镶嵌 / 圈口收口更贴合。",
  巧手: "手法灵巧，降低瑕疵倾向，更易出完美件。",
  心细: "观察细致，降低瑕疵倾向。",
  净料: "净料处理到位，减少脏点 / 棉絮。",
  易裂: "料性偏脆，出裂风险较高。",
  易出绵: "易出棉絮 / 绵，影响净度。",
  易脏: "工序中易带入脏点。",
  手重: "下手偏重，压裂 / 崩口风险略高。"
};

function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }
function skillThreshold(level) { return 50 * level; }
function skillK(level, exp) {
  const L = clamp(Math.round(Number(level) || 1), 1, 10);
  const p = clamp((Number(exp) || 0) / skillThreshold(L), 0, 1);
  const k0 = K_CURVE[L];
  const k1 = L < 10 ? K_CURVE[L + 1] : K_CURVE[10];
  return k0 + p * (k1 - k0);
}
function workerTierM(worker) {
  const base = TIER_MULT[worker.tier] ?? 1.0;
  const tl = Number(worker.tierLevel || 1);
  return base * (1 + 0.06 * (tl - 1));
}
function workerSkill(worker, key) {
  const dir = SKILL_DEFS[key].dir;
  return (worker.skills?.[dir]?.[key]) || { level: 1, exp: 0 };
}
function skillAttrValue(worker, key) {
  const sk = workerSkill(worker, key);
  return SKILL_DEFS[key].full * skillK(sk.level, sk.exp) * workerTierM(worker);
}
// ===== 加工「工分」评分体系（与 server.js 共用同一套权重/评级）=====
const STEP_ATTR_WEIGHTS = {
  open:   { jieliao: 0.55, damo: 0.45 },
  plan:   { qieliao: 0.40, xiuxing: 0.60 },
  finish: { diaozhuo: 0.55, xiangqian: 0.45 }
};
const GRADE_RULES = [
  { grade: "S", min: 100, mult: 1.04 },
  { grade: "A", min: 85,  mult: 1.00 },
  { grade: "B", min: 70,  mult: 0.97 },
  { grade: "C", min: 55,  mult: 0.94 },
  { grade: "D", min: 0,   mult: 0.90 }
];
// 完美度（= 工分）标签阈值：工分≥此值标「完美」，≤此值标「瑕疵」；与 server.js 的 WS_PERFECT_SCORE/WS_FLAW_SCORE 保持一致
const WS_PERFECT_SCORE = 100;
const WS_FLAW_SCORE = 35;
// 单工序工分子分（0~120）：本工序两属性按权重加权，技能×品阶映射；词条净修正并入工分
function workerStepScore(worker, step) {
  const w = STEP_ATTR_WEIGHTS[step];
  if (!w || !worker) return 0;
  let s = 0;
  for (const key in w) {
    const sk = workerSkill(worker, key);
    s += w[key] * skillK(sk.level, sk.exp) * workerTierM(worker) * 100;
  }
  let flawNet = 0;
  for (const f of (worker.flaws || [])) flawNet += (FLAW_DEFS[f] || 0);
  if (flawNet) s *= (1 + flawNet);
  return clamp(s, 0, 120);
}
function craftGrade(score) {
  for (const r of GRADE_RULES) if (score >= r.min) return r.grade;
  return "D";
}
function craftGradeBadge(grade) {
  return `<span class="craft-grade grade-${grade}">${grade}</span>`;
}
// 成品/中间产物底部一行：工分 + 评级（仅已完成工序参与，无则不显示）
function craftScoreLine(item) {
  if (item.craftScore == null) return "";
  let tag = "";
  if (item.craftPerfect) tag = `<span class="craft-tag tag-perfect">完美</span>`;
  else if (item.craftFlaw) tag = `<span class="craft-tag tag-flaw">瑕疵·${escapeHtml(item.craftFlaw)}</span>`;
  return `<p class="item-craft-score">工分 <strong>${item.craftScore}</strong> ${craftGradeBadge(item.craftGrade)} ${tag}</p>`;
}
// 某员工在指定工序下的属性预览
function workerStepPreview(worker, step) {
  const attrKeys = STEP_ATTRS[step] || [];
  const attrs = attrKeys.map((key) => ({ key, attr: SKILL_DEFS[key].attr, value: skillAttrValue(worker, key) }));
  const quality = workerStepScore(worker, step); // 新：本工序工分子分（0~120）
  const grade = craftGrade(quality);
  let speed = 0;
  for (const key of PROCESS_SKILLS) speed += 0.04 * skillK(workerSkill(worker, key).level, workerSkill(worker, key).exp) * workerTierM(worker);
  // 完美度 = 工分（不再有随机「完美率」）：工分≥WS_PERFECT_SCORE 标「完美」，≤WS_FLAW_SCORE 标「瑕疵」
  const perfectLabel = quality >= WS_PERFECT_SCORE ? "完美" : (quality <= WS_FLAW_SCORE ? "瑕疵" : "");
  return { attrs, quality, grade, speed: Math.round(speed * 100), perfectLabel, tierTime: TIER_BASE_TIME[worker.tier] || 1 };
}
function flawClass(flaw) { return (FLAW_DEFS[flaw] || 0) >= 0 ? "pos" : "neg"; }
function pct(n) { return (n > 0 ? "+" : "") + n + "%"; }
function skillBarHtml(level, exp) {
  const pctw = clamp(Math.round((Number(exp) || 0) / skillThreshold(clamp(level, 1, 10)) * 100), 0, 100);
  return `<span class="wsp-bar"><i style="width:${pctw}%"></i></span>`;
}
// 技能卡片：每个技能一张底图卡片，名称 + Lv + 经验进度条 + 经验数字。
// 按「当前工序」排序：本工序相关技能置顶，并在名字后标「本工序」标签。
function renderSkillCards(worker, step) {
  const stepSkills = STEP_ATTRS[step] || [];
  const stepSet = new Set(stepSkills);
  const keys = Object.keys(SKILL_DEFS);
  const ordered = keys.slice().sort((a, b) => {
    const pa = stepSet.has(a) ? 0 : (SKILL_DEFS[a].dir === "speak" ? 2 : 1);
    const pb = stepSet.has(b) ? 0 : (SKILL_DEFS[b].dir === "speak" ? 2 : 1);
    if (pa !== pb) return pa - pb;
    return keys.indexOf(a) - keys.indexOf(b);
  });
  return ordered.map((key) => {
    const sk = workerSkill(worker, key);
    const L = clamp(sk.level, 1, 10);
    const cur = Math.round(Number(sk.exp) || 0);
    const max = skillThreshold(L);
    const pctw = clamp(Math.round((cur / max) * 100), 0, 100);
    const isStep = stepSet.has(key);
    return `<div class="wsp-skill-card ${isStep ? "is-step" : ""}">
      <div class="wsp-skill-card-head">
        <strong class="wsp-skill-name">${escapeHtml(SKILL_DEFS[key].name)}${isStep ? '<span class="wsp-skill-tag">本工序</span>' : ""}</strong>
        <span class="wsp-skill-lv">Lv.${sk.level}</span>
      </div>
      <div class="wsp-skill-card-bar"><span class="wsp-bar"><i style="width:${pctw}%"></i></span></div>
      <div class="wsp-skill-card-foot"><span class="wsp-skill-exp">${cur} / ${max}</span></div>
    </div>`;
  }).join("");
}
// 左卡完整效果评分：品质分 + 提速 + 完美率 + 本工序各属性贡献，全部使用与上方相同的 chip UI（不再分两版）
function renderWorkerMiniScores(worker, step) {
  const pv = workerStepPreview(worker, step);
  const speed = pv.speed > 0 ? "+" + pv.speed + "%" : "—";
  const label = pv.perfectLabel;
  const flawCls = label === "完美" ? "grade-S" : (label === "瑕疵" ? "grade-D" : "");
  const items = [
    { label: "工分", value: pv.quality.toFixed(0), cls: "grade-" + pv.grade },
    { label: "评级", value: pv.grade, cls: "grade-" + pv.grade },
    { label: "提速", value: speed },
    { label: "完美度", value: label || "—", cls: flawCls },
    ...pv.attrs.map((a) => ({ label: a.attr, value: "+" + a.value.toFixed(1) }))
  ];
  return `<div class="wsp-worker-mini">${items.map((it) =>
    `<span class="${it.cls || ""}"><em>${escapeHtml(it.label)}</em><strong>${escapeHtml(it.value)}</strong></span>`
  ).join("")}</div>`;
}
// 左卡天赋 chips（返回纯 chips，由调用方包在 .wsp-worker-traits 容器里）
function renderWorkerMiniTraitChips(worker) {
  const traits = worker.traits || [];
  const flaws = worker.flaws || [];
  const list = [...traits, ...flaws];
  if (!list.length) return '<span class="wsp-trait-chip muted">无天赋</span>';
  return list.map((t) => {
    const isTrait = traits.includes(t);
    const cls = isTrait ? "pos" : flawClass(t);
    return `<span class="wsp-trait-chip ${cls}">${escapeHtml(t)}</span>`;
  }).join("");
}
// 天赋行：每条天赋整行展示（名称 + 描述），底图颜色按天赋品质（正/负）区分
function renderTraitRows(worker) {
  const traits = worker.traits || [];
  const flaws = worker.flaws || [];
  const list = [...traits, ...flaws];
  if (!list.length) {
    return `<div class="wsp-trait-row muted"><strong class="wsp-trait-name">无天赋</strong><span class="wsp-trait-desc">该员工没有特性或缺陷。</span></div>`;
  }
  return list.map((trait) => {
    const isTrait = traits.includes(trait);
    const cls = isTrait ? "pos" : flawClass(trait);
    const desc = TRAIT_DESC[trait] || "暂无说明";
    return `<div class="wsp-trait-row ${cls}">
      <strong class="wsp-trait-name">${escapeHtml(trait)}</strong>
      <span class="wsp-trait-desc">${escapeHtml(desc)}</span>
    </div>`;
  }).join("");
}
export function workshopDevices() {
  const serverDevices = getState().me.workshop?.devices || [];
  if (!serverDevices.length) return WORKSHOP_DEVICE_FALLBACKS;
  return serverDevices.map((device) => ({
    ...(WORKSHOP_DEVICE_FALLBACKS.find((fallback) => fallback.type === device.stage) || {}),
    ...device,
    type: device.stage || device.type,
    capacity: 1
  }));
}

export function workshopWorkers() {
  const serverWorkers = getState().me.workshop?.workers || [];
  if (!serverWorkers.length) return WORKSHOP_WORKER_FALLBACKS;
  return serverWorkers.map((worker) => ({
    ...(WORKSHOP_WORKER_FALLBACKS.find((fallback) => fallback.id === worker.id) || {}),
    ...worker
  }));
}

export function workshopWorkerFor(device) {
  return workshopWorkers().find((worker) => worker.id === device.workerId) || WORKSHOP_WORKER_FALLBACKS[0];
}

export function workshopJobs(deviceId = null) {
  const jobs = productionJobsFor(getState().me);
  if (!deviceId) return jobs;
  return jobs.filter((job) => (job.deviceId || { rough: "opening", refine: "carving", inlay: "finishing" }[job.stage] || job.stage) === deviceId);
}

export function workshopProcessableItems(device) {
  const bucket = device.inputType === "rough" ? getState().me.rough || [] : getState().me.bracelets || [];
  return bucket.filter((item) => materialStageForClient(item) === device.inputStage);
}

export function workshopStageItems() {
  return [
    ...(getState().me.rough || []).map((item) => ({ ...item, type: "rough" })),
    ...(getState().me.bracelets || []).map((item) => ({ ...item, type: "bracelet" }))
  ];
}

export function workshopOutputLabel(device) {
  return materialStageLabel(device.outputStage);
}

export function workshopDurationLabel(device) {
  return {
    opening: "约 5 分钟",
    carving: "约 8 分钟",
    finishing: "约 2 分钟"
  }[device.stage || device.type] || "约 2 分钟";
}

export function workshopWorkerImpact(worker, device) {
  const trait = worker?.traits?.[0] ? `，特性「${worker.traits[0]}」` : "";
  return {
    opening: `${worker.name}：开料耗时小幅下降，损耗风险小幅降低${trait}。`,
    carving: `${worker.name}：按套件边界下刀更稳，取件质量小幅提高${trait}。`,
    finishing: `${worker.name}：细部收口更准，最终成品稳定性小幅提高${trait}。`
  }[device.stage || device.type] || `${worker.name}：当前工序表现稳定${trait}。`;
}

export function workshopDeviceImpact(device) {
  return `${device.name} 1阶：容量 ${workshopJobs(device.id).length}/1，状态 ${Math.round(device.condition ?? 100)}%，稳定完成${workshopOutputLabel(device)}工序。`;
}

function workshopRepairQuote(device) {
  const missing = 100 - Math.max(0, Math.min(100, Number(device.condition ?? 100)));
  return Math.ceil(Number(device.basePrice || 0) * (missing / 100) * 0.35);
}

export function workshopJobEstimate(device, item) {
  const worker = workshopWorkerFor(device);
  return {
    fee: Number(device.fee || 0),
    duration: workshopDurationLabel(device),
    output: workshopOutputLabel(device),
    workerImpact: workshopWorkerImpact(worker, device),
    deviceImpact: workshopDeviceImpact(device),
    summary: `预计：${formatMoney(device.fee)}，${workshopDurationLabel(device)}，产出${workshopOutputLabel(device)}。`
  };
}

export function workshopJobProgress(job) {
  const remain = Math.max(0, Number(job.readyAt || 0) - nowMs());
  const total = Math.max(1, Number(job.readyAt || 0) - Number(job.startedAt || nowMs()));
  const elapsed = Math.max(0, nowMs() - Number(job.startedAt || nowMs()));
  const progress = Math.min(100, Math.round(elapsed / total * 100));
  return `
    <div class="machine-row inline-machine">
      <div class="machine-top"><div><strong>${escapeHtml(job.item?.name || "加工中")}</strong><p class="item-meta">还需 ${formatDuration(remain)}</p></div></div>
      <div class="machine-track"><span style="width:${progress}%"></span></div>
    </div>
  `;
}

export function workshopItemPreview(item, device = null) {
  if (item.type === "rough") {
    return `<div class="rough-output-preview compact">${openingStoneSvg(item, { revealed: materialStageForClient(item) !== "rough", kits: device?.stage === "carving" ? openingKitsForRender(item) : [] })}</div>`;
  }
  return `<div class="workshop-product-preview">${productCanvas(item, "compact")}</div>`;
}

export function workshopRecipeCard(device) {
  const worker = workshopWorkerFor(device);
  const jobs = workshopJobs(device.id);
  const processable = workshopProcessableItems(device);
  const current = jobs[0];
  const tier = device.tier || "T1";
  const durability = Number(device.condition ?? device.durability ?? 100);
  const category = device.category || "加工设备";
  const model = device.model || "";
  const specs = device.specs || "";
  const durClass = durability > 80 ? "high" : durability > 50 ? "mid" : "low";
  return `
    <button class="workshop-recipe-card" data-action="openWorkshopDevice" data-payload="${device.id}" type="button">
      <span class="wrc-head">
        <span class="wrc-badge">${escapeHtml(category)}</span>
        <span class="wrc-tier">${escapeHtml(tier)}</span>
      </span>
      <span class="recipe-card-title">${escapeHtml(device.name)}</span>
      <span class="wrc-model">${escapeHtml(model)}</span>
      <span class="recipe-card-copy">${escapeHtml(device.description || "")}</span>
      <span class="wrc-durability">
        <span class="wrc-dur-label">耐久 ${durability}%</span>
        <span class="wrc-dur-track"><span class="wrc-dur-fill ${durClass}" style="width:${durability}%"></span></span>
      </span>
      <span class="recipe-card-grid">
        <span><em>师傅</em><strong>${escapeHtml(worker.name)} · ${escapeHtml(tierLabel(worker))}</strong></span>
        <span><em>容量</em><strong>${jobs.length}/1</strong></span>
        <span><em>可加工</em><strong>${processable.length} 件</strong></span>
      </span>
      <span class="wrc-specs">${escapeHtml(specs)}</span>
      <span class="wrc-foot">
        <span class="recipe-card-current">${current ? `加工中：${escapeHtml(current.item?.name || "物料")}` : "设备空闲"}</span>
        <span class="wrc-upgrade" aria-disabled="true" title="所有设备固定为 1 阶，型号差异由基础属性决定">固定 1 阶</span>
      </span>
    </button>
  `;
}

export function workshopStepTabs() {
  return `
    <div class="workshop-step-tabs" role="tablist">
      ${WORKSHOP_STEPS.map((step, i) => `
        <button class="workshop-step-tab ${step.id === activeWorkshopStep ? "active" : ""}" data-action="selectWorkshopStep" data-payload="${step.id}" type="button" role="tab" aria-selected="${step.id === activeWorkshopStep}">
          <span class="wst-photo" aria-hidden="true"></span>
          <span class="wst-tint" aria-hidden="true"></span>
          <span class="wst-shade" aria-hidden="true"></span>
          <span class="wst-content">
            <span class="wst-index">0${i + 1}</span>
            <span class="wst-label">${escapeHtml(step.label)}</span>
            <span class="wst-desc">${escapeHtml(step.desc)}</span>
          </span>
        </button>
      `).join("")}
    </div>
  `;
}

export function workshopRecipeHome(devices) {
  const stepDevices = devices.filter((device) => deviceStep(device) === activeWorkshopStep);
  const step = WORKSHOP_STEPS.find((s) => s.id === activeWorkshopStep) || WORKSHOP_STEPS[0];
  return `
    <div class="workshop-recipe-home">
      ${workshopStepTabs()}
      <p class="workshop-step-desc">${escapeHtml(step.desc)}</p>
      <section class="workshop-recipe-grid">
        ${stepDevices.map(workshopRecipeCard).join("") || empty(`当前没有「${step.label}」环节的机器。`)}
      </section>
    </div>
  `;
}

export function workshopStageInventory() {
  const items = workshopStageItems();
  return items.map((item) => {
    const stage = materialStageForClient(item);
    const summary = inlaySummary(item);
    return `
      <div class="item-row stage-inventory-row">
        ${workshopItemPreview(item)}
        <div>
          <div class="item-title"><span>${escapeHtml(item.name)}</span><span class="pill">${formatMoney(item.value || item.price)}</span></div>
          <p class="item-meta">${escapeHtml(materialStageLabel(item))} · ${escapeHtml(typeName(item.type, item))}</p>
          ${summary ? `<p class="inlay-summary">${escapeHtml(summary)}</p>` : ""}
          ${craftScoreLine(item)}
          ${stage === "finished" ? `<div class="row-actions"><button class="secondary small" data-action="collectBracelet" data-payload="${item.id}" type="button">收入藏宝阁</button></div>` : ""}
        </div>
      </div>
    `;
  }).join("") || empty("暂无阶段产物。");
}

export function workshopMaterialRow(device, item) {
  const selected = selectedWorkshopItemId === item.id;
  return `
    <button class="workshop-material-card ${selected ? "selected" : ""}" data-action="selectWorkshopItem" data-payload="${item.id}" type="button">
      ${workshopItemPreview(item, device)}
      <span>
        <strong>${escapeHtml(item.name)}</strong>
        <em>${escapeHtml(materialStageLabel(item))} · ${formatMoney(item.value || item.price)}</em>
      </span>
    </button>
  `;
}

export function workshopRecipeSummary(device, selected) {
  if (!selected) {
    return `
      <section class="workshop-recipe-summary empty-summary">
        <h4>等待物料</h4>
        <p>请选择左侧料子后开始加工。</p>
      </section>`;
  }
  const estimate = workshopJobEstimate(device, selected);
  const kits = device.stage === "carving" ? kitsFor(selected.id) : [];
  const needsKits = device.stage === "carving" && !kits.length;
  const busy = workshopJobs(device.id).length >= 1;
  const broken = Number(device.condition ?? 100) <= 0;
  const worker = (selectedWorkshopWorkerId && workshopWorkers().find((w) => w.id === selectedWorkshopWorkerId)) || workshopWorkerFor(device);
  const workerBusy = Boolean(worker?.busy);
  const pv = worker ? workerStepPreview(worker, deviceStep(device)) : null;
  const workerEffectBlock = pv ? `
      <div class="wrs-block">
        <h4>员工 · ${escapeHtml(worker.name)}（${escapeHtml(tierLabel(worker))}）</h4>
        <div class="wrs-chips">
          <span class="wrs-chip"><em>工分</em><strong>${pv.quality.toFixed(0)}</strong></span>
          <span class="wrs-chip"><em>评级</em><strong>${craftGradeBadge(pv.grade)}</strong></span>
          <span class="wrs-chip"><em>提速</em><strong>${pv.speed > 0 ? "+" + pv.speed + "%" : "—"}</strong></span>
          <span class="wrs-chip"><em>完美度</em><strong>${pv.perfectLabel || "—"}</strong></span>
        </div>
      </div>` : `
      <div class="wrs-block">
        <h4>员工效果</h4>
        <div class="wrs-chips"><span class="wrs-chip muted">未选择员工</span></div>
      </div>`;
  return `
    <section class="workshop-recipe-summary">
      <div class="wrs-block">
        <h4>物料属性</h4>
        <div class="wrs-chips">
          <span class="wrs-chip"><em>料子</em><strong>${escapeHtml(selected.name)}</strong></span>
          <span class="wrs-chip"><em>花色</em><strong>${escapeHtml(selected.flower || selected.color || "—")}</strong></span>
          <span class="wrs-chip"><em>完美度</em><strong>${escapeHtml(selected.grade || "—")}</strong></span>
        </div>
      </div>
      ${workerEffectBlock}
      <p class="recipe-hint">${escapeHtml(estimate.duration)} · 费用 ${formatMoney(estimate.fee)} · 产出 ${escapeHtml(estimate.output)}</p>
      ${device.stage === "carving" ? roughBoard(selected) + roughPlannerControls(selected) + placementAnalysisRows(selected, kits) : ""}
      ${needsKits ? `<p class="recipe-hint">请先在明料上摆放套件，然后再开工。</p>` : ""}
      <div class="row-actions">
        <button class="${needsKits ? "warn" : "primary"}" data-action="startWorkshopJob" data-payload="${device.id}" data-item-id="${selected.id}" data-needs-kits="${needsKits ? "1" : "0"}" ${busy || broken || workerBusy ? "disabled" : ""}>${broken ? "请先维修设备" : busy ? "设备加工中（容量 1）" : workerBusy ? "员工正在执行其他任务" : needsKits ? "先摆套件" : `开工 ${formatMoney(estimate.fee)}`}</button>
      </div>
    </section>`;
}

export function workshopBigMaterialCard(device, selected) {
  const payload = JSON.stringify({ kind: "material", deviceId: device.id });
  if (!selected) {
    return `
      <div class="ws-big-card ws-big-material empty" data-action="openWorkshopPicker" data-payload='${payload}'>
        <span class="ws-big-plus">+</span>
        <span class="ws-big-label">选择石头</span>
      </div>`;
  }
  return `
    <div class="ws-big-card ws-big-material" data-action="openWorkshopPicker" data-payload='${payload}'>
      ${workshopItemPreview(selected, device)}
      <div class="ws-big-meta">
        <strong>${escapeHtml(selected.name)}</strong>
        <em>${escapeHtml(materialStageLabel(selected))} · ${formatMoney(selected.value || selected.price)}</em>
        ${craftScoreLine(selected)}
      </div>
    </div>`;
}

export function workshopBigWorkerCard(device, worker) {
  const payload = JSON.stringify({ kind: "worker", deviceId: device.id });
  if (!worker) {
    return `
      <div class="ws-big-card ws-big-worker empty" data-action="openWorkshopPicker" data-payload='${payload}'>
        <span class="ws-big-plus">+</span>
        <span class="ws-big-label">选择员工</span>
        <button class="secondary small wsp-recommend" data-action="recommendWorkshopWorker" data-payload="${device.id}" type="button">智能推荐</button>
      </div>`;
  }
  const pv = workerStepPreview(worker, deviceStep(device));
  const flaws = (worker.flaws || []).map((f) => `<span class="flaw-chip ${flawClass(f)}">${escapeHtml(f)}</span>`).join("") || '<span class="flaw-chip muted">无词条</span>';
  return `
    <div class="ws-big-card ws-big-worker" data-action="openWorkshopPicker" data-payload='${payload}'>
      <div class="ws-big-worker-top">
        <span class="worker-avatar">${escapeHtml((worker.name || "?")[0] || "?")}</span>
        <div class="ws-big-worker-id">
          <strong>${escapeHtml(worker.name)}</strong>
          <em>${escapeHtml(tierLabel(worker))}${worker.busy ? " · 工作中" : " · 空闲"}</em>
        </div>
      </div>
      <div class="ws-big-worker-preview">
        <span>工分 <strong>${pv.quality.toFixed(0)}</strong> ${craftGradeBadge(pv.grade)}</span>
        <span>提速 <strong>${pv.speed > 0 ? "+" + pv.speed + "%" : "—"}</strong></span>
        <span>完美度 <strong>${pv.perfectLabel || "—"}</strong></span>
      </div>
      <div class="ws-big-worker-flaws">${flaws}</div>
      <button class="secondary small wsp-recommend" data-action="recommendWorkshopWorker" data-payload="${device.id}" type="button">智能推荐</button>
    </div>`;
}

export function workshopStageDrawer() {
  const stageItems = workshopStageItems();
  const finishedCount = (getState().me.bracelets || []).filter((item) => materialStageForClient(item) === "finished").length;
  return `
    <details class="workshop-stage-drawer">
      <summary>阶段库存 ${stageItems.length} 件 · 成品 ${finishedCount}</summary>
      <div class="workshop-stage-grid">${workshopStageInventory()}</div>
    </details>
  `;
}

export function workshopRecommendedWorkerId(device) {
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

export function workshopWorkerColumn(device) {
  const current = workshopWorkerFor(device);
  const workers = workshopWorkers();
  const list = workers.map((worker) => {
    const on = worker.id === device.workerId;
    const pv = workerStepPreview(worker, deviceStep(device));
    const traits = (worker.traits || []).map((trait) => `<span class="trait-chip">${escapeHtml(trait)}</span>`).join("");
    return `
      <button class="workshop-worker-card ${on ? "assigned" : ""}" data-action="assignWorkshopWorker" data-payload="${device.id}" data-worker-id="${worker.id}" type="button" ${worker.busy ? "disabled" : ""}>
        <span class="worker-avatar">${escapeHtml((worker.name || "?")[0] || "?")}</span>
        <span class="worker-body">
          <strong>${escapeHtml(worker.name)}</strong>
          <em>${escapeHtml(tierLabel(worker))}</em>
          <span class="trait-row">${traits || '<span class="trait-chip muted">暂无特性</span>'}</span>
          <span class="worker-mini">工分 ${pv.quality.toFixed(0)}（${pv.grade}） · 提速 ${pv.speed > 0 ? "+" + pv.speed + "%" : "—"} · 完美度 ${pv.perfectLabel || "—"}</span>
        </span>
        <span class="worker-state">${worker.busy ? "工作中" : on ? "已选" : "可选"}</span>
      </button>`;
  }).join("");
  return `
    <div class="workshop-worker-column">
      <div class="workshop-column-head">
        <h4>排工 · 安排师傅</h4>
        <span>点选排到本台</span>
      </div>
      <div class="workshop-worker-grid">${list}</div>
      <button class="secondary small" data-action="recommendWorkshopWorker" data-payload="${device.id}" type="button">智能推荐</button>
      <p class="recipe-hint">当前已选：${escapeHtml(current.name)} · ${escapeHtml(tierLabel(current))}</p>
    </div>`;
}

export function workshopRecipePage(device) {
  const jobs = workshopJobs(device.id);
  const items = workshopProcessableItems(device);
  if (selectedWorkshopItemId && !items.some((item) => item.id === selectedWorkshopItemId)) selectedWorkshopItemId = items[0]?.id || null;
  const selected = selectedWorkshopItemId ? items.find((item) => item.id === selectedWorkshopItemId) || null : null;
  const selectedWorker = selectedWorkshopWorkerId ? workshopWorkers().find((w) => w.id === selectedWorkshopWorkerId) || null : null;

  const stepLabel = (WORKSHOP_STEPS.find((s) => s.id === deviceStep(device)) || {}).label || "";
  const tier = device.tier || 1;
  const durability = Number(device.condition ?? device.durability ?? 100);
  const category = device.category || "加工设备";
  const model = device.model || "—";
  const durClass = durability > 80 ? "high" : durability > 50 ? "mid" : "low";
  const riskVal = Number(device.attrs?.risk || 1);
  const riskClass = riskVal > 1 ? "neg" : riskVal < 1 ? "pos" : "";

  const progressBlock = jobs.length
    ? `<section class="workshop-progress">${jobs.map(workshopJobProgress).join("")}</section>`
    : `<section class="workshop-progress job-empty"><span class="job-empty-text">暂未开工</span></section>`;

  const queueStrip = `<section class="workshop-queue-strip">${
    jobs.length
      ? `<div class="queue-row">单机任务：${escapeHtml(jobs[0].item?.name || "加工中")}（容量 1，无等待队列）</div>`
      : `<div class="queue-row muted">设备空闲（容量 1，无等待队列）</div>`
  }</section>`;
  const repairCost = workshopRepairQuote(device);
  const repairDisabled = durability >= 100 || jobs.length > 0;

  return `
    <div class="workshop-recipe-page">
      <section class="workshop-recipe-page-head">
        <button class="back-link" data-action="backWorkshopDevices" type="button">返回</button>
        <div class="wsp-title">
          <h3>${escapeHtml(stepLabel)}</h3>
        </div>
      </section>

      <section class="machine-info-bar">
        <div class="mib-item name-item"><em>名字</em><strong>${escapeHtml(device.name)}</strong></div>
        <div class="mib-item"><em>种类</em><strong>${escapeHtml(category)}</strong></div>
        <div class="mib-item"><em>品牌</em><strong>${escapeHtml(model)}</strong></div>
        <div class="mib-item"><em>等级</em><strong>${tier} 阶</strong></div>
        <div class="mib-item"><em>品质加成</em><strong class="pos">+${deviceAttr(device, "quality")}%</strong></div>
        <div class="mib-item"><em>风险系数</em><strong class="${riskClass}">×${deviceAttr(device, "risk")}</strong></div>
        <div class="mib-item"><em>速度</em><strong class="pos">+${deviceAttr(device, "speed")}%</strong></div>
        <div class="mib-item"><em>完美保底</em><strong class="pos">+${deviceAttr(device, "perfectFloor")}%</strong></div>
        <div class="mib-item mib-dura">
          <em>耐久 ${durability}%</em>
          <span class="mib-dura-track"><span class="mib-dura-fill ${durClass}" style="width:${durability}%"></span></span>
          <button class="secondary small" data-action="repairWorkshopDevice" data-payload="${device.id}" type="button" ${repairDisabled ? "disabled" : ""}>${jobs.length ? "加工中" : durability >= 100 ? "无需维修" : `维修 ${formatMoney(repairCost)}`}</button>
        </div>
      </section>

      ${progressBlock}
      ${queueStrip}

      <section class="workshop-recipe-main">
        ${workshopBigMaterialCard(device, selected)}
        ${workshopBigWorkerCard(device, selectedWorker)}
        ${workshopRecipeSummary(device, selected)}
      </section>
      ${workshopStageDrawer()}
    </div>
  `;
}

export function renderWorkshop() {
  const devices = workshopDevices();
  const activeDevice = devices.find((device) => device.id === activeWorkshopDeviceId) || null;
  if (activeWorkshopDeviceId && !activeDevice) {
    activeWorkshopDeviceId = null;
    selectedWorkshopItemId = null;
  }
  elsRef.workshopRoot.innerHTML = activeDevice ? workshopRecipePage(activeDevice) : workshopRecipeHome(devices);
  const stageDrawer = elsRef.workshopRoot.querySelector(".workshop-stage-drawer");
  if (stageDrawer) {
    stageDrawer.open = stageDrawerOpen;
    stageDrawer.addEventListener("toggle", () => {
      stageDrawerOpen = stageDrawer.open;
    });
  }
  // 注意：选工/选料弹窗不再挂在 workshopRoot 内，改为挂到 body 下的独立容器（见 renderPicker），
  // 这样服务端每秒推送 state 触发 renderWorkshop 重建工坊页时，不会连带重建弹窗导致闪烁。
  if (activeFinishPlanModal) renderFinishPlanModal();
}

// 弹窗挂载容器（独立于 workshopRoot，挂在 body 上，renderWorkshop 不触碰）
function pickerRootEl() {
  let el = document.getElementById("ws-picker-root");
  if (!el) {
    el = document.createElement("div");
    el.id = "ws-picker-root";
    document.body.appendChild(el);
  }
  return el;
}

// 弹窗外壳：仅在「打开」时构建一次（入场动画只播一次），之后只刷新内容区
function buildPickerShell(picker, device) {
  const kind = picker.kind;
  const isMaterial = kind === "material";
  const title = isMaterial ? "选择石头" : "选择员工";
  const stepClass = `step-${deviceStep(device) || "open"}`;
  const verb = isMaterial ? "挑选料子" : "指派工匠";
  return `
    <div class="ws-picker-overlay">
      <div class="ws-picker-modal ${stepClass} kind-${kind}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="ws-picker-head">
          <div class="wsp-head-text">
            <h3>${escapeHtml(title)}</h3>
            <p>为「${escapeHtml(device.name)}」${verb}</p>
          </div>
          <button class="ws-picker-close" data-action="closeWorkshopPicker" type="button" aria-label="关闭">×</button>
        </div>
        <div class="wsp-toolbar">
          <span class="wsp-count"></span>
          <input class="wsp-search" type="search" placeholder="搜索${isMaterial ? "料子名称" : "工匠"}…" aria-label="搜索" />
        </div>
        ${kind === "worker" ? `
        <div class="wsp-toolbar-extra">
          <div class="wsp-toolbar-group" role="group" aria-label="排序">
            <button class="wsp-toolbar-btn ${activeWorkerSort === "default" ? "is-active" : ""}" data-action="setWorkerSort" data-sort="default" type="button">默认</button>
            <button class="wsp-toolbar-btn ${activeWorkerSort === "quality" ? "is-active" : ""}" data-action="setWorkerSort" data-sort="quality" type="button">工分</button>
            <button class="wsp-toolbar-btn ${activeWorkerSort === "flawless" ? "is-active" : ""}" data-action="setWorkerSort" data-sort="flawless" type="button">完美度</button>
            <button class="wsp-toolbar-btn ${activeWorkerSort === "speed" ? "is-active" : ""}" data-action="setWorkerSort" data-sort="speed" type="button">提速</button>
          </div>
        </div>
        ` : ""}
        <div class="ws-picker-content"></div>
      </div>
    </div>`;
}

// 弹窗内容区（列表 + 右侧详情）：每次切换/状态刷新只更新这一块，不重建外壳 → 不闪烁
function buildPickerContent(picker, device) {
  const isMaterial = picker.kind === "material";
  if (isMaterial) {
    const items = workshopProcessableItems(device);
    const list = items.length
      ? items.map((item) => `
        <button class="ws-picker-item ws-pick-material" data-action="pickWorkshopItem" data-payload="${item.id}" type="button">
          <span class="wsp-thumb">${workshopItemPreview(item, device)}</span>
          <span class="wsp-thumb-meta">
            <strong>${escapeHtml(item.name)}</strong>
            <em>${escapeHtml(materialStageLabel(item))} · ${escapeHtml(typeName(item.type, item))}</em>
          </span>
          <span class="wsp-thumb-foot">
            <span class="wsp-value">${formatMoney(item.value || item.price)}</span>
            <span class="wsp-tag ok">可加工</span>
          </span>
        </button>`).join("")
      : empty(`没有可用于${escapeHtml(device.name)}的${escapeHtml(materialStageLabel(device.inputStage))}。`);
    return `<div class="ws-picker-list picker-material">${list}</div>`;
  }
  let workers = workshopWorkers();
  // 排序（默认按品阶降序；其余按本工序对应指标排序）
  if (activeWorkerSort !== "default") {
    workers = [...workers].sort((a, b) => {
      const pa = workerStepPreview(a, deviceStep(device));
      const pb = workerStepPreview(b, deviceStep(device));
      if (activeWorkerSort === "quality") return pb.quality - pa.quality;
      if (activeWorkerSort === "flawless") { const r = (x) => x.perfectLabel === "完美" ? 2 : x.perfectLabel === "瑕疵" ? 0 : 1; return r(pb) - r(pa); }
      if (activeWorkerSort === "speed") return pb.speed - pa.speed;
      return 0;
    });
  } else {
    workers = [...workers].sort((a, b) => (Number(b.tier) || 1) - (Number(a.tier) || 1));
  }
  const detail = activePickerWorkerId && workers.find((w) => w.id === activePickerWorkerId)
    || workshopWorkers().find((w) => w.id === activePickerWorkerId); // 详情固定显示当前临时选中的员工（即使被筛掉也照显示）
  const list = workers.map((worker) => {
    const pv = workerStepPreview(worker, deviceStep(device));
    const active = worker.id === activePickerWorkerId;
    const assigned = worker.id === device.workerId;
    return `
      <button class="ws-picker-item ws-pick-worker ${active ? "is-active" : ""} ${assigned ? "is-assigned" : ""}" style="--tier-border:${tierBorder(worker.tier)}" data-action="pickWorkshopWorker" data-payload="${device.id}" data-worker-id="${worker.id}" type="button" ${worker.busy ? "disabled" : ""}>
        <span class="wsp-worker-top">
          <strong class="wsp-worker-name">${escapeHtml(worker.name)}</strong>
          <span class="wsp-tier-badge" style="${tierBadgeStyle(worker.tier)}">${escapeHtml(tierLabel(worker))}</span>
          <span class="wsp-worker-traits">${renderWorkerMiniTraitChips(worker)}</span>
          ${worker.busy ? '<span class="wsp-tag busy">工作中</span>' : ""}
        </span>
        ${renderWorkerMiniScores(worker, deviceStep(device))}
      </button>`;
  }).join("");
  const side = detail ? renderWorkerDetail(detail, device) : `<div class="wsp-pick-side empty"><div class="wsp-pick-side-hint">← 在左侧点选员工，查看完整技能与词条</div></div>`;
  return `<div class="ws-picker-body"><div class="ws-picker-list picker-worker">${list}</div>${side}</div>`;
}

function attachPickerSearch(rootEl) {
  const search = rootEl.querySelector(".wsp-search");
  if (!search) return;
  search.addEventListener("input", (event) => {
    const q = event.target.value.trim().toLowerCase();
    const items = rootEl.querySelectorAll(".ws-picker-item");
    let visible = 0;
    items.forEach((el) => {
      const hit = !q || el.textContent.toLowerCase().includes(q);
      el.classList.toggle("is-hidden", !hit);
      if (hit) visible += 1;
    });
    const countEl = rootEl.querySelector(".wsp-count");
    if (countEl) countEl.textContent = q ? `匹配 ${visible} / 共 ${items.length} 项` : `共 ${items.length} 项`;
  });
}

// 统一刷新弹窗：外壳只在打开时建一次，其后仅替换内容区
export function renderPicker() {
  const rootEl = pickerRootEl();
  if (!activeWorkshopPicker) {
    if (rootEl.childElementCount) rootEl.innerHTML = "";
    pickerMountKey = null;
    return;
  }
  const device = workshopDevices().find((d) => d.id === activeWorkshopPicker.deviceId) || null;
  if (!device) {
    if (rootEl.childElementCount) rootEl.innerHTML = "";
    pickerMountKey = null;
    return;
  }
  const key = `${activeWorkshopPicker.kind}:${activeWorkshopPicker.deviceId}`;
  if (pickerMountKey !== key) {
    rootEl.innerHTML = buildPickerShell(activeWorkshopPicker, device);
    const overlay = rootEl.querySelector(".ws-picker-overlay");
    if (overlay) overlay.addEventListener("click", (event) => { if (event.target === overlay) workshopClosePicker(); });
    attachPickerSearch(rootEl);
    pickerMountKey = key;
  }
  const content = rootEl.querySelector(".ws-picker-content");
  if (content) content.innerHTML = buildPickerContent(activeWorkshopPicker, device);
  const countEl = rootEl.querySelector(".wsp-count");
  if (countEl && !countEl.textContent) {
    const n = activeWorkshopPicker.kind === "material" ? workshopProcessableItems(device).length : workshopWorkers().length;
    countEl.textContent = `共 ${n} 项`;
  }
}

// 员工弹窗右侧详情面板
function renderWorkerDetail(worker, device) {
  const pv = workerStepPreview(worker, deviceStep(device));
  const assigned = worker.id === device.workerId;
  const skillsHtml = renderSkillCards(worker, deviceStep(device));
  const skillCount = Object.keys(SKILL_DEFS).length;
  return `
    <div class="wsp-pick-side">
      <div class="wsp-pick-side-head">
        <div class="wsp-pick-side-id">
          <strong>${escapeHtml(worker.name)}</strong>
        </div>
        <span class="wsp-tier-badge" style="${tierBadgeStyle(worker.tier)}">${escapeHtml(tierLabel(worker))}</span>
      </div>
      <div class="wsp-pick-side-body">
        <div class="wsp-pick-side-block">
          <h5>天赋</h5>
          <div class="wsp-trait-rows">${renderTraitRows(worker)}</div>
        </div>
        <div class="wsp-pick-side-block">
          <h5>技能（${skillCount}）</h5>
          <div class="wsp-skill-cards">${skillsHtml}</div>
        </div>
      </div>
      <div class="wsp-pick-side-foot">
        <button class="primary" data-action="confirmPickerWorker" data-payload="${device.id}" data-worker-id="${worker.id}" type="button" ${worker.busy ? "disabled" : ""}>${worker.busy ? "正在执行其他任务" : "选择"}</button>
      </div>
    </div>`;
}

export function workshopOpenPicker(payload) {
  try { activeWorkshopPicker = typeof payload === "string" ? JSON.parse(payload) : payload; }
  catch { activeWorkshopPicker = null; }
  // 员工弹窗：默认选中当前设备已绑定的员工（让右侧详情一开就有内容）
  if (activeWorkshopPicker && activeWorkshopPicker.kind === "worker") {
    const devId = activeWorkshopPicker.deviceId;
    const dev = workshopDevices().find((d) => d.id === devId);
    const workers = workshopWorkers();
    const fallback = dev?.workerId || (workers[0] && workers[0].id) || null;
    activePickerWorkerId = (dev && dev.workerId && workers.some((w) => w.id === dev.workerId))
      ? dev.workerId
      : (workers[0] && workers[0].id) || null;
  } else {
    activePickerWorkerId = null;
  }
  renderWorkshop();
  renderPicker();
}

export function workshopClosePicker() {
  activeWorkshopPicker = null;
  activePickerWorkerId = null;
  renderWorkshop();
  renderPicker();
}

export function workshopPickItem(payload) {
  activeWorkshopPicker = null;
  workshopSelectItem(payload);
  renderPicker();
}

export function workshopPickWorker(target, payload) {
  // 弹窗内点员工卡 = 只切换详情预览，不直接指派、不关闭
  const workerId = target.dataset.workerId || null;
  if (!workerId) return;
  activePickerWorkerId = workerId;
  renderPicker(); // 只刷新弹窗内容区，不重建外壳、不重播动画 → 不再闪烁
}

export function workshopSetSort(target) {
  const sort = target?.dataset?.sort;
  if (!sort) return;
  activeWorkerSort = sort;
  // 同步工具栏按钮高亮（不重建外壳，只改 active 类）
  document.querySelectorAll(".wsp-toolbar-btn[data-action='setWorkerSort']").forEach((b) => b.classList.toggle("is-active", b.dataset.sort === sort));
  renderPicker();
}

export function workshopConfirmPickerWorker(target, payload) {
  // 详情面板点「指派此员工开工」= 真正指派并关闭弹窗
  const workerId = target.dataset.workerId || activePickerWorkerId;
  if (!workerId) { workshopClosePicker(); return; }
  activeWorkshopPicker = null;
  activePickerWorkerId = null;
  selectedWorkshopWorkerId = workerId;
  workshopAssignWorker({ dataset: { workerId } }, payload);
  renderWorkshop();
  renderPicker();
}


export function workshopOpenDevice(payload) {
  activeWorkshopDeviceId = payload;
  selectedWorkshopItemId = null;
  selectedWorkshopWorkerId = null;
  renderWorkshop();
  paintJades();
}
export function workshopSelectStep(payload) {
  if (!WORKSHOP_STEPS.some((step) => step.id === payload)) return;
  activeWorkshopStep = payload;
  renderWorkshop();
  paintJades();
}
export function workshopBackDevices() {
  activeWorkshopDeviceId = null;
  selectedWorkshopItemId = null;
  selectedWorkshopWorkerId = null;
  renderWorkshop();
  paintJades();
}
export function workshopSelectItem(payload) {
  selectedWorkshopItemId = payload;
  renderWorkshop();
  paintJades();
}

function finishItemShape(item) {
  const key = String(item?.kind || item?.design || "").toLowerCase();
  if (["cabochon", "egg", "saddle", "蛋面"].includes(key)) return "cabochon";
  if ([
    "buddha", "buddhapendant", "guanyin", "guanyinpendant", "leaf", "leafpendant",
    "gourd", "gourdpendant", "fubean", "fubeanpendant", "droppendant", "ruyipendant",
    "carving", "雕件"
  ].includes(key)) return "carving";
  if (["peacependant", "plaque", "pierced", "平安扣", "无事牌", "山水牌"].includes(key)) return "pierced";
  if (["bangle", "bead", "beads", "seal", "whole", "bracelet", "手镯", "珠链", "印章"].includes(key)) return "whole";
  return null;
}

function finishCatalog() {
  return getState().inlayCatalog || {};
}

function defaultFinishPlan(item) {
  const shape = finishItemShape(item);
  const defaults = {
    cabochon: { productType: "ring", settingId: "claw", metalId: "gold18k", backingId: "open" },
    carving: { productType: "pendant", settingId: "claw", metalId: "gold18k", backingId: null },
    pierced: { productType: "pendant", settingId: "bezel", metalId: "gold18k", backingId: null },
    whole: { productType: "bracelet", settingId: "cord", metalId: null, backingId: null }
  };
  return {
    ...(defaults[shape] || defaults.whole),
    gemId: null,
    gemCount: 0,
    polishId: "bright"
  };
}

function normalizeFinishPlan(item, plan) {
  const catalog = finishCatalog();
  const shape = finishItemShape(item);
  const productTypes = catalog.productTypes?.[shape] || [];
  const settings = catalog.shapeSettings?.[shape] || [];
  if (!productTypes.includes(plan.productType)) plan.productType = productTypes[0];
  if (!settings.includes(plan.settingId)) plan.settingId = settings[0];
  const allowedMetals = catalog.settings?.[plan.settingId]?.metals || [];
  plan.metalId = allowedMetals.length
    ? (allowedMetals.includes(plan.metalId) ? plan.metalId : allowedMetals[0])
    : null;
  plan.gemCount = Math.max(0, Math.min(12, Math.round(Number(plan.gemCount) || 0)));
  if (plan.gemCount === 0) plan.gemId = null;
  else if (!catalog.gems?.[plan.gemId]) plan.gemId = Object.keys(catalog.gems || {})[0] || null;
  if (!catalog.polishes?.[plan.polishId]) plan.polishId = Object.keys(catalog.polishes || {})[0] || "bright";
  const backingAllowed = shape === "cabochon" && plan.productType === "ring";
  plan.backingId = backingAllowed && catalog.backings?.[plan.backingId]
    ? plan.backingId
    : backingAllowed ? "open" : null;
  return plan;
}

function quoteFinishPlanForClient(item, plan) {
  const catalog = finishCatalog();
  const setting = catalog.settings?.[plan.settingId];
  const polish = catalog.polishes?.[plan.polishId];
  const backing = plan.backingId ? catalog.backings?.[plan.backingId] : { labor: 0, value: 0 };
  if (!item || !setting || !polish || !backing) return null;
  const metalAmount = Number((Number(setting.grams || 0) * (1 + Number(plan.gemCount || 0) * 0.05)).toFixed(2));
  return {
    metalId: plan.metalId,
    metalAmount,
    gemId: plan.gemId,
    gemCount: Number(plan.gemCount || 0),
    laborFee: Number(setting.labor || 0) + Number(plan.gemCount || 0) * 80 + Number(polish.labor || 0) + Number(backing.labor || 0),
    valueMultiplier: Number((
      1 +
      Number(plan.metalId ? catalog.metalValues?.[plan.metalId] || 0 : 0) +
      Number(plan.gemCount || 0) * 0.05 +
      Number(polish.value || 0) +
      Number(backing.value || 0)
    ).toFixed(2))
  };
}

export function finishOptions(keys, labels, selected, {
  enabledKeys = keys,
  disabledReason = "当前组合不兼容"
} = {}) {
  const enabled = new Set(enabledKeys);
  return keys.map((key) => {
    const disabled = !enabled.has(key);
    const reason = disabled ? `（${disabledReason}）` : "";
    return `<option value="${escapeHtml(key)}" ${key === selected ? "selected" : ""} ${disabled ? `disabled title="${escapeHtml(disabledReason)}"` : ""}>${escapeHtml(labels?.[key] || key)}${escapeHtml(reason)}</option>`;
  }).join("");
}

function closeFinishPlanModal() {
  activeFinishPlanModal = null;
  document.getElementById("finish-plan-root")?.remove();
}

function updateFinishPlanFromControl(event) {
  const field = event.target?.dataset?.finishField;
  if (!field || !activeFinishPlanModal) return;
  const plan = activeFinishPlanModal.plan;
  plan[field] = field === "gemCount"
    ? Number(event.target.value)
    : event.target.value === "" ? null : event.target.value;
  const item = workshopStageItems().find((entry) => entry.id === activeFinishPlanModal.itemId);
  if (!item) return closeFinishPlanModal();
  normalizeFinishPlan(item, plan);
  renderFinishPlanModal();
}

function finishRootEl() {
  let root = document.getElementById("finish-plan-root");
  if (root) return root;
  root = document.createElement("div");
  root.id = "finish-plan-root";
  root.className = "modal-root";
  root.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-finish-action]");
    const action = actionTarget?.dataset.finishAction;
    if (!action) {
      if (event.target === root) closeFinishPlanModal();
      return;
    }
    if (action === "close") closeFinishPlanModal();
    else if (action === "confirm") confirmFinishPlan();
  });
  root.addEventListener("change", updateFinishPlanFromControl);
  root.addEventListener("input", updateFinishPlanFromControl);
  document.body.appendChild(root);
  return root;
}

function openFinishPlanModal(device, item, workerId) {
  activeFinishPlanModal = {
    deviceId: device.id,
    itemId: item.id,
    workerId,
    plan: defaultFinishPlan(item)
  };
  renderFinishPlanModal();
}

function confirmFinishPlan() {
  if (!activeFinishPlanModal) return;
  const { deviceId, itemId, workerId, plan } = activeFinishPlanModal;
  const item = workshopStageItems().find((entry) => entry.id === itemId);
  if (!item) {
    showToast("套件已不在库存中。");
    closeFinishPlanModal();
    return;
  }
  socketRef.emit("startWorkshopJob", {
    deviceId,
    itemId,
    workerId,
    finishPlan: structuredClone(plan),
    requestId: globalThis.crypto?.randomUUID?.() || `workshop-${Date.now()}`
  });
  closeFinishPlanModal();
}

function renderFinishPlanModal() {
  if (!activeFinishPlanModal) return;
  const root = finishRootEl();
  const catalog = finishCatalog();
  const item = workshopStageItems().find((entry) => entry.id === activeFinishPlanModal.itemId);
  if (!item) return closeFinishPlanModal();
  const shape = finishItemShape(item);
  const plan = normalizeFinishPlan(item, activeFinishPlanModal.plan);
  const quote = quoteFinishPlanForClient(item, plan);
  if (!quote) {
    showToast("无法生成精加工报价。");
    closeFinishPlanModal();
    return;
  }
  const productTypes = catalog.productTypes?.[shape] || [];
  const settings = catalog.shapeSettings?.[shape] || [];
  const metals = catalog.settings?.[plan.settingId]?.metals || [];
  const allProductTypes = Object.keys(catalog.productTypeNames || {});
  const allSettings = Object.keys(catalog.settings || {});
  const allMetals = Object.keys(catalog.metals || {});
  const materials = getState().me.externalMaterials || {};
  const metalHeld = plan.metalId ? Number(materials[plan.metalId] || 0) : 0;
  const gemHeld = plan.gemId ? Number(materials[plan.gemId] || 0) : 0;
  const hasMaterials = (!plan.metalId || metalHeld >= quote.metalAmount)
    && (!plan.gemId || gemHeld >= quote.gemCount);
  const hasCash = Number(getState().me.cash || 0) >= quote.laborFee;
  const canStart = hasMaterials && hasCash;
  const backingAllowed = shape === "cabochon" && plan.productType === "ring";
  const settingNames = Object.fromEntries(Object.entries(catalog.settings || {}).map(([key, value]) => [key, value.name]));
  root.innerHTML = `
    <section class="game-modal finish-plan-modal" role="dialog" aria-modal="true" aria-label="精加工方案">
      <header class="game-modal-head">
        <div class="game-modal-title">
          <h3>制定精加工方案</h3>
          <p>${escapeHtml(item.name)} · 每台设备容量固定为 1</p>
        </div>
        <button class="modal-close" data-finish-action="close" type="button" aria-label="关闭">×</button>
      </header>
      <div class="game-modal-body">
        <div class="finish-plan-grid">
          <label class="finish-plan-field"><span>成品类型</span><select data-finish-field="productType">${finishOptions(allProductTypes, catalog.productTypeNames, plan.productType, { enabledKeys: productTypes, disabledReason: "当前套件形态不兼容" })}</select></label>
          <label class="finish-plan-field"><span>镶嵌方式</span><select data-finish-field="settingId">${finishOptions(allSettings, settingNames, plan.settingId, { enabledKeys: settings, disabledReason: "当前套件形态不兼容" })}</select></label>
          <label class="finish-plan-field"><span>金属</span><select data-finish-field="metalId"><option value="" ${plan.metalId == null ? "selected" : ""} ${metals.length ? 'disabled title="当前镶法必须使用兼容金属"' : ""}>不使用金属${metals.length ? "（当前镶法不兼容）" : ""}</option>${finishOptions(allMetals, catalog.metals, plan.metalId, { enabledKeys: metals, disabledReason: "当前镶法不兼容" })}</select></label>
          <label class="finish-plan-field"><span>抛光</span><select data-finish-field="polishId">${finishOptions(Object.keys(catalog.polishes || {}), catalog.polishNames, plan.polishId)}</select></label>
          <label class="finish-plan-field"><span>配石</span><select data-finish-field="gemId"><option value="" ${plan.gemCount === 0 ? "selected" : ""}>不配石</option>${finishOptions(Object.keys(catalog.gems || {}), catalog.gems, plan.gemId)}</select></label>
          <label class="finish-plan-field"><span>配石数量</span><input data-finish-field="gemCount" type="number" min="0" max="12" step="1" value="${plan.gemCount}"></label>
          ${backingAllowed ? `<label class="finish-plan-field"><span>底托</span><select data-finish-field="backingId">${finishOptions(Object.keys(catalog.backings || {}), catalog.backingNames, plan.backingId)}</select></label>` : ""}
        </div>
        <div class="finish-plan-summary">
          <div><span>金属库存</span><strong class="${!plan.metalId || metalHeld >= quote.metalAmount ? "pos" : "neg"}">${plan.metalId ? `${metalHeld.toFixed(2)} / ${quote.metalAmount.toFixed(2)} 克` : "无需"}</strong></div>
          <div><span>配石库存</span><strong class="${!plan.gemId || gemHeld >= quote.gemCount ? "pos" : "neg"}">${plan.gemId ? `${gemHeld} / ${quote.gemCount} 颗` : "无需"}</strong></div>
          <div><span>人工费</span><strong class="${hasCash ? "" : "neg"}">${formatMoney(quote.laborFee)}</strong></div>
          <div><span>成品价值倍率</span><strong class="pos">×${quote.valueMultiplier.toFixed(2)}</strong></div>
        </div>
        ${!hasMaterials ? '<p class="finish-plan-warning">材料库存不足，请先到商店购买镶嵌材料。</p>' : ""}
        ${!hasCash ? '<p class="finish-plan-warning">现金不足，无法支付精加工人工费。</p>' : ""}
      </div>
      <footer class="game-modal-actions">
        <button class="secondary" data-finish-action="close" type="button">取消</button>
        <button class="primary" data-finish-action="confirm" type="button" ${canStart ? "" : "disabled"}>确认开工 · ${formatMoney(quote.laborFee)}</button>
      </footer>
    </section>`;
}

export function workshopStartJob(target, payload) {
  const deviceId = payload || activeWorkshopDeviceId;
  const itemId = target.dataset.itemId || selectedWorkshopItemId;
  const device = workshopDevices().find((item) => item.id === deviceId);
  const request = {
    deviceId,
    itemId,
    workerId: selectedWorkshopWorkerId || device?.workerId,
    requestId: globalThis.crypto?.randomUUID?.() || `workshop-${Date.now()}`
  };
  if (device?.stage === "finishing") {
    const item = workshopProcessableItems(device).find((entry) => entry.id === itemId);
    if (!item) { showToast("请选择可精加工的套件。"); return; }
    openFinishPlanModal(device, item, request.workerId);
    return;
  }
  if (device?.stage === "carving") {
    request.kits = openingKitsForServer(itemId);
    if (!request.kits.length) { showToast("请先在明料上摆放套件。"); return; }
    roughKits.set(itemId, []);
  }
  socketRef.emit("startWorkshopJob", request);
}
export function workshopAssignWorker(target, payload) {
  const deviceId = payload || activeWorkshopDeviceId;
  const workerId = target.dataset.workerId;
  if (!workerId || !deviceId) return;
  socketRef.emit("assignWorkshopWorker", { deviceId, workerId });
}
export function workshopRecommendWorker(payload) {
  const deviceId = payload || activeWorkshopDeviceId;
  const device = workshopDevices().find((d) => d.id === deviceId);
  const workerId = device && workshopRecommendedWorkerId(device);
  if (workerId) {
    selectedWorkshopWorkerId = workerId;
    socketRef.emit("assignWorkshopWorker", { deviceId, workerId });
    renderWorkshop();
  }
}
