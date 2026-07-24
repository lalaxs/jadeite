export const WORKER_SKILL_DEFS = {
  jieliao:   { name: "解料", attr: "完整度", full: 18, dir: "cut" },
  damo:      { name: "打磨", attr: "光泽度", full: 15, dir: "cut" },
  qieliao:   { name: "切料", attr: "瑕疵控制", full: 12, dir: "set" },
  xiuxing:   { name: "修形", attr: "造型精度", full: 14, dir: "set" },
  diaozhuo:  { name: "雕琢", attr: "雕琢精细度", full: 22, dir: "finish" },
  xiangqian: { name: "镶嵌", attr: "镶嵌贴合度", full: 16, dir: "finish" },
  huashu:    { name: "话术", attr: "溢价力", full: 12, dir: "speak" },
  kongchang: { name: "控场", attr: "控场流速", full: 10, dir: "speak" },
  cuidan:    { name: "催单", attr: "逼单转化", full: 10, dir: "speak" }
};

const STEP_SKILLS = {
  open: ["jieliao", "damo"],
  plan: ["qieliao", "xiuxing"],
  finish: ["diaozhuo", "xiangqian"],
  speak: ["huashu", "kongchang", "cuidan"]
};

const TRAIT_DESCRIPTIONS = {
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

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function tierBadgeStyle(tier) {
  const normalized = Math.max(1, Math.min(10, Number(tier) || 1));
  const ratio = (normalized - 1) / 9;
  const jade = [71, 164, 116];
  const gold = [206, 184, 124];
  const color = jade.map((channel, index) => (
    Math.round(channel + ratio * (gold[index] - channel))
  ));
  return `background:linear-gradient(135deg,rgb(${color[0]},${color[1]},${color[2]}),rgba(${color[0]},${color[1]},${color[2]},.82));color:#10221b`;
}

export function workerStepForJob(job) {
  return ({
    cutter: "open",
    planner: "plan",
    finisher: "finish",
    streamer: "speak"
  })[job] || "open";
}

export function workerJobLabel(job) {
  return ({
    cutter: "开料师傅",
    planner: "规划师傅",
    finisher: "精加工师傅",
    streamer: "直播掌柜"
  })[job] || "工坊员工";
}

function workerSkill(worker, key) {
  const direction = WORKER_SKILL_DEFS[key].dir;
  return worker.skills?.[direction]?.[key] || { level: 1, exp: 0 };
}

function skillCardsHtml(worker, step) {
  const relevant = new Set(STEP_SKILLS[step] || []);
  const keys = Object.keys(WORKER_SKILL_DEFS);
  const ordered = keys.slice().sort((a, b) => {
    const priority = (key) => relevant.has(key)
      ? 0
      : WORKER_SKILL_DEFS[key].dir === "speak" ? 2 : 1;
    return priority(a) - priority(b) || keys.indexOf(a) - keys.indexOf(b);
  });

  return ordered.map((key) => {
    const definition = WORKER_SKILL_DEFS[key];
    const skill = workerSkill(worker, key);
    const level = Math.max(1, Math.min(10, Math.round(Number(skill.level) || 1)));
    const maximum = 50 * level;
    const current = Math.max(0, Math.round(Number(skill.exp) || 0));
    const pct = Math.max(0, Math.min(100, Math.round(current / maximum * 100)));
    const isRelevant = relevant.has(key);
    return `<div class="wsp-skill-card ${isRelevant ? "is-step" : ""}">
      <div class="wsp-skill-card-head">
        <strong class="wsp-skill-name">${escapeHtml(definition.name)}${isRelevant ? '<span class="wsp-skill-tag">本工序</span>' : ""}</strong>
        <span class="wsp-skill-lv">Lv.${level}</span>
      </div>
      <div class="wsp-skill-card-bar"><span class="wsp-bar"><i style="width:${pct}%"></i></span></div>
      <div class="wsp-skill-card-foot"><span class="wsp-skill-exp">${current} / ${maximum}</span></div>
    </div>`;
  }).join("");
}

function traitRowsHtml(worker) {
  const positive = new Set(worker.traits || []);
  const names = [...(worker.traits || []), ...(worker.flaws || [])];
  if (!names.length) {
    return '<div class="wsp-trait-row muted"><strong class="wsp-trait-name">无天赋</strong><span class="wsp-trait-desc">该员工没有特性或缺陷。</span></div>';
  }
  return names.map((name) => `
    <div class="wsp-trait-row ${positive.has(name) ? "pos" : "neg"}">
      <strong class="wsp-trait-name">${escapeHtml(name)}</strong>
      <span class="wsp-trait-desc">${escapeHtml(TRAIT_DESCRIPTIONS[name] || "暂无说明")}</span>
    </div>
  `).join("");
}

export function renderWorkerDetailPanel({
  worker,
  step,
  mode = "workshop",
  summaryHtml = "",
  footerHtml = ""
}) {
  return `<section class="wsp-pick-side worker-detail-panel mode-${escapeHtml(mode)}">
    <div class="wsp-pick-side-head">
      <div class="wsp-pick-side-id">
        <strong>${escapeHtml(worker.name)}</strong>
        <em>${escapeHtml(workerJobLabel(worker.job))} · ${Number(worker.tier) || 1}阶</em>
      </div>
      <span class="wsp-tier-badge" style="${tierBadgeStyle(worker.tier)}">${Number(worker.tier) || 1}阶</span>
    </div>
    ${summaryHtml}
    <div class="wsp-pick-side-body">
      <div class="wsp-pick-side-block">
        <h5>天赋</h5>
        <div class="wsp-trait-rows">${traitRowsHtml(worker)}</div>
      </div>
      <div class="wsp-pick-side-block">
        <h5>技能（9）</h5>
        <div class="wsp-skill-cards">${skillCardsHtml(worker, step)}</div>
      </div>
    </div>
    <footer class="wsp-pick-side-foot">${footerHtml}</footer>
  </section>`;
}
