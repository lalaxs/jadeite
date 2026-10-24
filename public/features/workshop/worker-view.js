// Worker badges, scores and trait markup.
import { FLAW_DEFS, clamp } from "../../workshop-craft-scoring.js";

export function createWorkshopWorkerView({ helpers, ports }) {
  const { escapeHtml } = helpers;
  const { workerStepPreview } = ports;

function tierLabel(worker) { return worker?.isOwner ? "掌柜自营 · 无工资" : `${Number(worker?.tier) || 1}阶`; }

function tierBadgeStyle(tier) {
  const t = clamp(Number(tier) || 1, 1, 10);
  const f = (t - 1) / 9;
  const jade = [71, 164, 116], gold = [206, 184, 124];
  const c = jade.map((jv, i) => Math.round(jv + f * (gold[i] - jv)));
  return `background:linear-gradient(135deg,rgb(${c[0]},${c[1]},${c[2]}),rgba(${c[0]},${c[1]},${c[2]},.82));color:#10221b`;
}

function tierBorder(tier) {
  const t = clamp(Number(tier) || 1, 1, 10);
  const f = (t - 1) / 9;
  const jade = [52, 138, 100], gold = [232, 168, 60];
  const c = jade.map((jv, i) => Math.round(jv + f * (gold[i] - jv)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function craftGradeBadge(grade) {
  return `<span class="craft-grade grade-${grade}">${grade}</span>`;
}

function craftScoreLine(item) {
  if (item.craftScore == null) return "";
  let tag = "";
  if (item.craftPerfect) tag = `<span class="craft-tag tag-perfect">完美</span>`;
  else if (item.craftFlaw) tag = `<span class="craft-tag tag-flaw">瑕疵·${escapeHtml(item.craftFlaw)}</span>`;
  return `<p class="item-craft-score">工分 <strong>${item.craftScore}</strong> ${craftGradeBadge(item.craftGrade)} ${tag}</p>`;
}

function flawClass(flaw) { return (FLAW_DEFS[flaw] || 0) >= 0 ? "pos" : "neg"; }

function pct(n) { return (n > 0 ? "+" : "") + n + "%"; }

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

  return { tierLabel, tierBadgeStyle, tierBorder, craftGradeBadge, craftScoreLine, flawClass, pct, renderWorkerMiniScores, renderWorkerMiniTraitChips };
}
