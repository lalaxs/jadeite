// Overview feature barrel

import { bindTasksUiDeps, TASK_RESET_COST, renderTasks, updateTaskCountdown, taskCardHtml } from "./tasks-ui.js";
import {
  bindAchievementsUiDeps,
  goalFmt,
  currentGoalViewModel,
  rewardChipsHtml,
  achievementsHtml,
  achievementRowHtml,
  goalCardHtml,
  ensureOverviewStatusShell,
  patchCurrentGoal,
  notifyNewAchievements,
  resetAchievementToastState
} from "./achievements-ui.js";
import {
  bindOverviewRenderDeps,
  renderOverview,
  renderNextActions,
  renderPipeline,
  statusRows,
  myRankFor
} from "./overview-render.js";

export function bindOverviewDeps(deps = {}) {
  bindTasksUiDeps(deps);
  bindAchievementsUiDeps(deps);
  bindOverviewRenderDeps({
    ...deps,
    renderTasks,
    ensureOverviewStatusShell,
    patchCurrentGoal,
    currentGoalViewModel
  });
}

export {
  TASK_RESET_COST,
  renderTasks,
  updateTaskCountdown,
  taskCardHtml,
  goalFmt,
  currentGoalViewModel,
  rewardChipsHtml,
  achievementsHtml,
  achievementRowHtml,
  goalCardHtml,
  ensureOverviewStatusShell,
  patchCurrentGoal,
  notifyNewAchievements,
  resetAchievementToastState,
  renderOverview,
  renderNextActions,
  renderPipeline,
  statusRows,
  myRankFor
};
