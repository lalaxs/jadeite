// Shared rules for the starter economy; cash awards are budgeted independently of sales.
export const INITIAL_PLAYER_CASH = 12_000;
export const DAILY_TASK_CASH_CAP = 300;
export const INTRO_REWARD_CASH_CAP = 1_000;
export const ORDER_MAX_VALUE_MULTIPLIER = 1.25;
const DAY_MS = 86_400_000;

export function economyDayKey(now = Date.now()) {
  return Math.floor((now + 8 * 3_600_000) / DAY_MS);
}

export function rewardCashQuote(player, amount, source, now = Date.now()) {
  const requested = Math.max(0, Math.round(Number(amount) || 0));
  const intro = player?.onboarding;
  const duringIntro = intro && (!intro.completedAt
    || economyDayKey(intro.startedAt) === economyDayKey(now));
  const budget = player?.rewardCashBudget;
  const today = budget?.day === economyDayKey(now) ? Number(budget.taskCash || 0) : 0;
  let allowed = requested;
  if (source === "taskReward") allowed = Math.min(allowed, Math.max(0, DAILY_TASK_CASH_CAP - today));
  if (duringIntro && ["taskReward", "achievementReward"].includes(source)) {
    allowed = Math.min(allowed, Math.max(0, INTRO_REWARD_CASH_CAP - Number(intro.rewardCash || 0)));
  }
  return allowed;
}

export function bookRewardCash(player, amount, source, now = Date.now()) {
  const allowed = rewardCashQuote(player, amount, source, now);
  if (source === "taskReward") {
    if (player.rewardCashBudget?.day !== economyDayKey(now)) {
      player.rewardCashBudget = { day: economyDayKey(now), taskCash: 0 };
    }
    player.rewardCashBudget.taskCash = Math.max(0, Number(player.rewardCashBudget.taskCash) || 0) + allowed;
  }
  const intro = player.onboarding;
  if (intro && (!intro.completedAt || economyDayKey(intro.startedAt) === economyDayKey(now))) {
    intro.rewardCash = Number(intro.rewardCash || 0) + allowed;
  }
  return allowed;
}

export function orderPayoutCap(products = []) {
  return Math.max(0, Math.floor(products.reduce((sum, item) => (
    sum + Math.max(0, Number(item?.value ?? item?.price) || 0)
  ), 0) * ORDER_MAX_VALUE_MULTIPLIER));
}
