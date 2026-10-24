export { WORKER_SKILL_DEFS } from "./workshop-craft-scoring.js";
import { WORKER_SKILL_DEFS } from "./workshop-craft-scoring.js";
import { renderResourceCard } from "./resource-card-view.js";
import { employeeOutlineSvg } from "./workshop-resource-art.js";

const STEP_SKILLS = {
  open: ["jieliao", "damo"],
  plan: ["qieliao", "xiuxing"],
  finish: ["diaozhuo", "xiangqian"],
  bangleFinish: ["damo", "xiuxing"],
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

function skillCardsHtml(worker, step, relevantLabel = "本工序") {
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
        <strong class="wsp-skill-name">${escapeHtml(definition.name)}${isRelevant ? `<span class="wsp-skill-tag">${escapeHtml(relevantLabel)}</span>` : ""}</strong>
        <span class="wsp-skill-lv">Lv.${level}</span>
      </div>
      <div class="wsp-skill-card-bar"><span class="wsp-bar"><i style="width:${pct}%"></i></span></div>
      <div class="wsp-skill-card-foot">
        <span class="wsp-skill-attr">${escapeHtml(definition.attr)}：${definition.full}</span>
        <span class="wsp-skill-exp">${current} / ${maximum}</span>
      </div>
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
  if (mode === "roster") {
    return `<section class="wsp-pick-side worker-detail-panel mode-roster owned-worker-sheet">
      <header class="owned-worker-heading">
        <span class="owned-worker-avatar" aria-hidden="true">${employeeOutlineSvg()}</span>
        <div class="owned-worker-identity">
          <div class="owned-worker-name"><h3 id="ownedWorkerDetailTitle">${escapeHtml(worker.name)}</h3><span class="wsp-tier-badge" style="${tierBadgeStyle(worker.tier)}">${Number(worker.tier) || 1}阶</span></div>
          <p>${escapeHtml(workerJobLabel(worker.job))}</p>
        </div>
        ${summaryHtml}
      </header>
      <div class="wsp-pick-side-body owned-worker-content" data-owned-worker-scroll>
        <section class="owned-worker-traits" aria-label="员工天赋">
          <h4>天赋</h4>
          <div class="wsp-trait-rows">${traitRowsHtml(worker)}</div>
        </section>
        <section class="owned-worker-skills" aria-label="员工技能">
          <h4>技能 <span>9 项</span></h4>
          <div class="wsp-skill-cards">${skillCardsHtml(worker, step, "本职")}</div>
        </section>
      </div>
      <footer class="owned-worker-footer">${footerHtml}</footer>
    </section>`;
  }
  return `<section class="wsp-pick-side worker-detail-panel mode-${escapeHtml(mode)}">
    <div class="wsp-pick-side-head">
      ${renderResourceCard({
        type: "employee", name: worker.name,
        badge: mode === "recruit" ? "待招募" : mode === "roster" ? "在册员工" : "员工详情",
        className: "resource-card--compact worker-detail-identity",
        summary: [worker.isOwner ? "掌柜自营 · 无工资" : workerJobLabel(worker.job)],
        body: `<span class="wsp-tier-badge" style="${tierBadgeStyle(worker.tier)}">${Number(worker.tier) || 1}阶</span>`
      })}
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
