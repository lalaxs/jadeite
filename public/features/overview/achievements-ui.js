// Goals / achievements UI (moved from main.js)

import { formatMoney, formatNumber, escapeHtml, nowMs } from "../../shell/format-utils.js";
import { showToast } from "../../shell/toast-fx.js";
import { rewardCashQuote } from "../../../shared/domain/economy/new-player-economy.js";
import {
  achievementViewModels,
  nextAchievementViewModel,
  sortAchievementViewModels,
  resolveAchievementStage,
  achievementRewardChips,
  ACHIEVEMENT_DEFINITIONS,
  nextFeatureUnlock,
  playerAchievementPoints,
  newlyUnlockedFeatures
} from "../../player-progression.js";

let getState = () => null;
let getEls = () => null;

export function bindAchievementsUiDeps(deps = {}) {
  if (typeof deps.getState === "function") getState = deps.getState;
  if (typeof deps.getEls === "function") getEls = deps.getEls;
}

export function goalFmt(achievement) {
  const progress = achievement.progress;
  const target = achievement.target;
  if (achievement.format === "money") {
    return `${formatMoney(progress)} / ${formatMoney(target)}`;
  }
  if (achievement.format === "exp") {
    return `${formatNumber(progress)} / ${formatNumber(target)} 经验`;
  }
  return `${formatNumber(progress)} / ${formatNumber(target)}`;
}

export function currentGoalViewModel() {
  const state = getState();

  const model = nextAchievementViewModel(state?.me || {});
  if (!model.done && Number.isFinite(Number(model.progress)) && Number.isFinite(Number(model.target))) {
    model.countText = goalFmt(model);
  }
  return model;
}

export function achievementGroupKey(item) {
  if (item.claimable) return "claimable";
  if (item.claimed) return "claimed";
  return "active";
}

export function rewardChipsHtml(defOrModel, { claimed = false, claimable = false } = {}) {
  const chips = achievementRewardChips(defOrModel);
  if (!claimed) {
    const cash = chips.find((chip) => chip.kind === "cash");
    if (cash) {
      const requested = Number(defOrModel?.rewards?.cash || 0);
      const allowed = rewardCashQuote(getState()?.me, requested, "achievementReward", nowMs());
      if (getState()?.me?.onboarding && allowed < requested) {
        cash.label = `¥ ${allowed.toLocaleString("zh-CN")}`;
        cash.title = "新手期现金奖励合计上限 ¥1,000，经验和材料照常领取";
      }
    }
  }
  if (!chips.length) return "";
  const stateCls = claimed ? " is-claimed" : (claimable ? " is-claimable" : "");
  return `<div class="reward-chips${stateCls}" aria-label="奖励">
    ${chips.map((chip) => `
      <span class="reward-chip is-${escapeHtml(chip.kind)}" title="${escapeHtml(chip.title || chip.label)}">${escapeHtml(chip.label)}</span>
    `).join("")}
  </div>`;
}
export function achievementRowHtml(g) {
  const tag = g.claimed
    ? '<span class="achv-tag is-claimed">已领取</span>'
    : (g.claimable
      ? '<span class="achv-tag is-claimable">可领取</span>'
      : `<span class="achv-tag">${escapeHtml(g.stageLabel || `+${g.ap} AP`)}</span>`);
  const action = g.claimable
    ? `<button class="achv-claim" type="button" data-action="claimAchievement" data-payload="${escapeHtml(g.id)}">领取</button>`
    : "";
  const showStageName = g.stageName && g.stageName !== g.title && !g.endless && !g.rare;
  const subtitle = showStageName
    ? `${escapeHtml(g.stageName)} · ${escapeHtml(g.desc || "")}`
    : escapeHtml(g.desc || "");
  const starred = g.claimable || g.claimed || g.done;
  const progressText = goalFmt(g);
  return `<div class="achv ${g.done ? "is-done" : ""} ${g.claimable ? "is-claimable" : ""} ${g.claimed ? "is-claimed" : ""}">
      <div class="achv-ico">${starred ? "★" : "○"}</div>
      <div class="achv-main">
        <div class="achv-top"><b>${escapeHtml(g.title)}</b>${tag}${action}</div>
        <div class="achv-mid">
          <div class="achv-desc">${subtitle}</div>
          <div class="achv-prog">${escapeHtml(progressText)}</div>
        </div>
        <div class="achv-bar"><i style="width:${g.pct}%"></i></div>
        ${rewardChipsHtml(g, { claimed: Boolean(g.claimed), claimable: Boolean(g.claimable) })}
      </div>
    </div>`;
}

export function achievementsHtml() {
  const state = getState();

  const me = state?.me || {};
  const points = playerAchievementPoints(me);
  const next = nextFeatureUnlock(me);
  const nextLine = next
    ? `<span>下一解锁 <b>${escapeHtml(next.label)}</b> ${points}/${next.ap}</span>`
    : `<span>已解锁全部功能</span>`;
  const models = sortAchievementViewModels(achievementViewModels(me));
  const claimableCount = models.filter((item) => item.claimable).length;
  const claimAll = claimableCount
    ? `<button class="achv-claim" type="button" data-action="claimAllAchievements">全部领取（${claimableCount}）</button>`
    : "";
  const summary = `<div class="achv-summary"><span>成就积分 <b>${formatNumber(points)}</b></span>${nextLine}${claimAll}</div>`;
  const GROUP_LABELS = { claimable: "可领取", active: "进行中", claimed: "已领取" };
  const chunks = [summary];
  let lastGroup = null;
  for (const item of models) {
    const group = achievementGroupKey(item);
    if (group !== lastGroup) {
      chunks.push(`<div class="achv-group-label">${GROUP_LABELS[group]}</div>`);
      lastGroup = group;
    }
    chunks.push(achievementRowHtml(item));
  }
  return chunks.join("");
}

export function goalCardHtml(model) {
  return `
    <div class="goal-card is-entering ${model.done ? "is-done" : ""} ${model.claimable ? "is-claimable" : ""}">
      <div class="goal-head"><span class="goal-label">成长目标</span><b data-goal-title>${escapeHtml(model.title)}</b></div>
      <div class="goal-desc" data-goal-desc>${escapeHtml(model.desc)}</div>
      <div class="goal-bar" ${model.done ? "hidden" : ""}><i data-goal-bar style="width:${model.pct}%"></i></div>
      <div class="goal-prog" data-goal-progress ${model.done ? "hidden" : ""}>
        <div data-goal-reward>${rewardChipsHtml(model, { claimable: Boolean(model.claimable) })}</div>
        <span data-goal-count>${escapeHtml(model.countText || "")}</span>
      </div>
    </div>
  `;
}

export function ensureOverviewStatusShell() {
  const els = getEls();

  if (!els.homeStatusPane) return {};
  let goalSlot = els.homeStatusPane.querySelector('[data-overview-slot="goal"]');
  let focusSlot = els.homeStatusPane.querySelector('[data-overview-slot="focus"]');
  let economySlot = els.homeStatusPane.querySelector('[data-overview-slot="economy"]');
  let pipelineSlot = els.homeStatusPane.querySelector('[data-overview-slot="pipeline"]');
  let ranksSlot = els.homeStatusPane.querySelector('[data-overview-slot="ranks"]');
  let rowsSlot = els.homeStatusPane.querySelector('[data-overview-slot="rows"]');
  // 任一槽位缺失都重建，避免只剩标题「状态」而榜单/行卡片空白
  if (!goalSlot || !ranksSlot || !rowsSlot || !focusSlot || !economySlot || !pipelineSlot) {
    els.homeStatusPane.innerHTML = `
      <div class="overview-command-grid">
        <div data-overview-slot="focus"></div>
        <div data-overview-slot="goal"></div>
      </div>
      <div data-overview-slot="economy"></div>
      <div data-overview-slot="pipeline"></div>
      <section class="overview-glance" aria-label="同行位置">
        <div class="overview-glance-head">
          <b>同行位置</b>
          <span>实时经营排名</span>
        </div>
        <div class="rank-pills" data-overview-slot="ranks"></div>
        <div class="overview-glance-actions" data-overview-slot="rows"></div>
      </section>
    `;
    goalSlot = els.homeStatusPane.querySelector('[data-overview-slot="goal"]');
    focusSlot = els.homeStatusPane.querySelector('[data-overview-slot="focus"]');
    economySlot = els.homeStatusPane.querySelector('[data-overview-slot="economy"]');
    pipelineSlot = els.homeStatusPane.querySelector('[data-overview-slot="pipeline"]');
    ranksSlot = els.homeStatusPane.querySelector('[data-overview-slot="ranks"]');
    rowsSlot = els.homeStatusPane.querySelector('[data-overview-slot="rows"]');
  }
  return { goalSlot, focusSlot, economySlot, pipelineSlot, ranksSlot, rowsSlot };
}

export function patchCurrentGoal(goalSlot, model) {
  if (!goalSlot) return;
  const currentId = goalSlot.dataset.goalId;
  if (currentId !== model.id || !goalSlot.querySelector(".goal-card")) {
    goalSlot.dataset.goalId = model.id;
    goalSlot.innerHTML = goalCardHtml(model);
    goalSlot.querySelector(".goal-card")?.addEventListener("animationend", (event) => {
      event.currentTarget.classList.remove("is-entering");
    }, { once: true });
    return;
  }
  const card = goalSlot.querySelector(".goal-card");
  card.classList.toggle("is-done", model.done);
  card.classList.toggle("is-claimable", Boolean(model.claimable));
  card.querySelector("[data-goal-title]").textContent = model.title;
  card.querySelector("[data-goal-desc]").textContent = model.desc;
  const bar = card.querySelector(".goal-bar");
  const progress = card.querySelector("[data-goal-progress]");
  bar.hidden = model.done;
  progress.hidden = model.done;
  card.querySelector("[data-goal-bar]").style.width = `${model.pct}%`;
  const reward = progress.querySelector("[data-goal-reward]");
  const count = progress.querySelector("[data-goal-count]");
  if (reward) reward.innerHTML = rewardChipsHtml(model, { claimable: Boolean(model.claimable) });
  if (count) count.textContent = model.countText || "";
  else if (!reward) progress.textContent = model.progressText;
}

const seenAchievementIds = new Set();
let achievementToastReady = false;
let previousAchievementPoints = null;

export function resetAchievementToastState() {
  achievementToastReady = false;
  previousAchievementPoints = null;
  seenAchievementIds.clear();
}

export function notifyNewAchievements(me) {
  const achievements = me?.achievements || {};
  const newly = [];
  for (const track of ACHIEVEMENT_DEFINITIONS) {
    const entry = achievements[track.id] || {};
    const unlockedStage = Math.max(0, Math.round(Number(entry.unlockedStage) || 0));
    if (unlockedStage <= 0) continue;
    const key = `${track.id}:${unlockedStage}`;
    if (!seenAchievementIds.has(key)) {
      if (achievementToastReady && entry.completedAt && unlockedStage > Math.max(0, Math.round(Number(entry.claimedStage) || 0))) {
        newly.push({ track, unlockedStage });
      }
      seenAchievementIds.add(key);
    }
  }
  achievementToastReady = true;
  if (newly.length) {
    const names = newly.map((item) => {
      const stage = resolveAchievementStage(item.track, item.unlockedStage);
      return stage?.title || item.track.title;
    });
    showToast({
      text: newly.length === 1
        ? `成就达成：${names[0]}，AP 已自动计入，可领取其他奖励`
        : `${newly.length} 项成就达成：${names.slice(0, 2).join("、")}${newly.length > 2 ? "等" : ""}，奖励待领取`,
      tone: "great",
      dedupeKey: `achievement-batch:${names.join("|")}`
    });
  }
  const currentPoints = playerAchievementPoints(me);
  if (previousAchievementPoints != null) {
    const features = newlyUnlockedFeatures(previousAchievementPoints, currentPoints);
    if (features.length) {
      showToast({
        text: `功能已解锁：${features.map((feature) => feature.label).join("、")}`,
        tone: "great",
        dedupeKey: `feature-unlock:${features.map((feature) => feature.id || feature.label).join("|")}`
      });
    }
  }
  previousAchievementPoints = currentPoints;
}
