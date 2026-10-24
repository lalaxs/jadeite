/**
 * Daily task board — refresh, progress, claim, paid reset.
 * Use createTaskService(deps) after cash/report helpers exist.
 */
import { randomUUID } from "node:crypto";
import {
  TASK_EXP_REWARDS,
  featureAccess,
  grantPlayerExp
} from "../../shared/domain/progression/player-progression.js";
import { settlePlayerAchievements as legacySettlePlayerAchievements } from "./achievement-rewards.js";

// 刷新间隔：默认 6 小时；可用环境变量 TASK_REFRESH_MS 覆盖（开发演示用，如 60000 = 1 分钟）
export const TASK_REFRESH_MS = Number(process.env.TASK_REFRESH_MS) || 6 * 60 * 60 * 1000;
export const TASK_RESET_COSTS = Object.freeze([0, 1000, 2000, 4000]);
export const TASK_RESET_COST = 1000;
export const TASK_COUNT = 6;

export function taskResetCostForCount(count = 0) {
  const index = Math.max(0, Math.round(Number(count) || 0));
  return TASK_RESET_COSTS[Math.min(index, TASK_RESET_COSTS.length - 1)];
}

// 任务池：每项对应一个真实的游戏内动作（已在对应 socket handler 中埋点进度）
export const TASK_DEFINITIONS = [
  { type: "market_buy", title: "交易行购买原石", desc: "在交易行购入任意一块原石或中间料", target: 1, reward: 100, rep: 0, exp: TASK_EXP_REWARDS.market_buy, color: "#12a594", view: "market" },
  { type: "auction_win", title: "拍卖成功竞得", desc: "在公盘竞拍中成功中标至少 1 块原石", target: 1, reward: 200, rep: 0, exp: TASK_EXP_REWARDS.auction_win, color: "#e0913a", view: "auction" },
  { type: "workshop_craft", title: "工坊打磨加工", desc: "在工坊完成打磨或取件操作", target: 3, reward: 200, rep: 0, exp: TASK_EXP_REWARDS.workshop_craft, color: "#5285d0", view: "workshop" },
  { type: "livestream_sell", title: "直播间售出商品", desc: "在直播间成功售出成品", target: 2, reward: 250, rep: 0, exp: TASK_EXP_REWARDS.livestream_sell, color: "#c264a0", view: "livestream" },
  { type: "market_sell", title: "交易行挂牌出售", desc: "在交易行上架一件商品", target: 1, reward: 0, rep: 0, exp: TASK_EXP_REWARDS.market_sell, color: "#2fa36b", view: "market" },
  { type: "order_complete", title: "完成客户订单", desc: "交付一单客户定制订单", target: 1, reward: 200, rep: 0, exp: TASK_EXP_REWARDS.order_complete, color: "#d1725a", view: "orders" },
  { type: "collection_collect", title: "收藏精品", desc: "将一件成品收入藏品阁", target: 1, reward: 0, rep: 0, exp: TASK_EXP_REWARDS.collection_collect, color: "#8a72c9", view: "collection" },
  { type: "window_open", title: "公盘开窗", desc: "对公盘原石执行开窗操作", target: 1, reward: 0, rep: 0, exp: TASK_EXP_REWARDS.window_open, color: "#3aa6c0", view: "auction" },
  { type: "recruit_worker", title: "扩充工坊人手", desc: "成功招聘一名员工", target: 1, reward: 0, rep: 0, exp: TASK_EXP_REWARDS.recruit_worker, color: "#92735d", view: "hireMarket" },
  { type: "material_buy", title: "采购镶嵌材料", desc: "从材料商店完成一次采购", target: 1, reward: 0, rep: 0, exp: TASK_EXP_REWARDS.material_buy, color: "#8f7a3f", view: "shop" }
];

export function taskDefinitionAvailable(player, def) {
  if (!player || !def) return false;
  if (def.type === "commission_complete") {
    return def.status === "complete" || def.status === "claimed";
  }
  if (def.type === "market_buy" || def.type === "market_sell") {
    return featureAccess(player, "market").ok;
  }
  if (def.type === "livestream_sell") {
    return Boolean(player.assets?.livestreamPermitOwned);
  }
  if (def.type === "recruit_worker") {
    return (player.workshop?.workers?.length || 0) < 8;
  }
  return true;
}

export function createTaskService(deps) {
  const settlePlayerAchievements = deps.settlePlayerAchievements || legacySettlePlayerAchievements;
  const {
    spendCash,
    earnCash,
    refreshPlayerReport
  } = deps;

  function makeTaskInstance(def) {
    return {
      uid: randomUUID(),
      type: def.type,
      title: def.title,
      desc: def.desc,
      target: def.target,
      reward: def.reward,
      rep: 0,
      exp: Math.max(0, Math.round(Number(def.exp) || TASK_EXP_REWARDS[def.type] || 0)),
      color: def.color,
      view: def.view,
      progress: 0,
      status: "active" // active | complete | claimed
    };
  }

  function pickTaskDefinitions(count, player, excludeTypes = []) {
    const excluded = new Set(excludeTypes || []);
    const pool = TASK_DEFINITIONS.filter((def) => (
      !excluded.has(def.type) && taskDefinitionAvailable(player, def)
    ));
    const chosen = [];
    while (chosen.length < count && pool.length) {
      const idx = Math.floor(Math.random() * pool.length);
      chosen.push(pool.splice(idx, 1)[0]);
    }
    return chosen;
  }

  function refreshTasksIfDue(player, now = Date.now()) {
    let migrated = false;
    if (Array.isArray(player.tasks) && player.tasks.some(
      (task) => task?.type === "commission_complete" && task.status === "active"
    )) {
      const retainedTypes = player.tasks.filter(
        (task) => task?.type !== "commission_complete" || task.status !== "active"
      ).map((task) => task.type);
      // Retire only unfinished tasks whose gameplay entry was removed. Keep
      // pending rewards, other task progress and the board's paid-reset budget.
      player.tasks = player.tasks.flatMap((task) => {
        if (task?.type !== "commission_complete" || task.status !== "active") return [task];
        const replacement = pickTaskDefinitions(1, player, retainedTypes)[0]
          || pickTaskDefinitions(1, player)[0];
        migrated = true;
        if (!replacement) return [];
        retainedTypes.push(replacement.type);
        return [makeTaskInstance(replacement)];
      });
    }
    const hasUnavailableTask = Array.isArray(player.tasks) && player.tasks.some(
      (task) => task?.status === "active" && !taskDefinitionAvailable(player, task)
    );
    const due = !player.tasks
      || player.tasks.length === 0
      || hasUnavailableTask
      || now - (player.taskRefreshedAt || 0) >= TASK_REFRESH_MS;
    if (!due) return migrated;
    player.tasks = pickTaskDefinitions(TASK_COUNT, player).map(makeTaskInstance);
    player.taskRefreshedAt = now;
    player.taskResetCount = 0;
    return true;
  }

  function advanceTask(player, type, amount = 1) {
    if (!player.tasks) return;
    let changed = false;
    for (const task of player.tasks) {
      if (task.status !== "active" || task.type !== type) continue;
      task.progress = Math.min(task.target, task.progress + amount);
      if (task.progress >= task.target) task.status = "complete";
      changed = true;
    }
    if (changed) refreshPlayerReport(player);
    return changed;
  }

  function claimTask(player, uid) {
    const task = (player.tasks || []).find((item) => item.uid === uid);
    if (!task) return { ok: false, message: "任务不存在。" };
    if (task.status === "claimed") return { ok: false, message: "该任务奖励已领取。" };
    if (task.status !== "complete") return { ok: false, message: "任务尚未完成，无法领取。" };
    const grantedCash = earnCash(player, task.reward, `任务奖励${task.title}`, { source: "taskReward", itemId: task.uid });
    const expAmount = Math.max(0, Math.round(Number(task.exp) || TASK_EXP_REWARDS[task.type] || 0));
    const expResult = grantPlayerExp(player, "task_claim", { amount: expAmount });
    task.status = "claimed";
    task.grantedReward = typeof grantedCash === "number" ? grantedCash : task.reward;
    const unlocked = settlePlayerAchievements(player);
    refreshPlayerReport(player);
    return {
      ok: true,
      reward: typeof grantedCash === "number" ? grantedCash : task.reward,
      rep: 0,
      exp: expResult.granted,
      title: task.title,
      unlocked
    };
  }

  function resetTask(player, uid) {
    const task = (player.tasks || []).find((item) => item.uid === uid);
    if (!task) return { ok: false, message: "任务不存在。" };
    if (task.status !== "active") return { ok: false, message: "已完成或已领取的任务不可重置。" };
    const existingTypes = player.tasks
      .filter((item) => item.uid !== uid)
      .map((item) => item.type);
    const replacementDef = pickTaskDefinitions(1, player, [task.type, ...existingTypes])[0]
      || pickTaskDefinitions(1, player, [task.type])[0];
    if (!replacementDef) {
      return { ok: false, message: "当前没有其他可完成任务，未扣除重置费用。" };
    }
    const cost = taskResetCostForCount(player.taskResetCount);
    if (cost > 0 && !spendCash(player, cost, `重置任务${task.title}`, { source: "taskReset", repEligible: false })) {
      return { ok: false, message: `重置需要 ¥${cost.toLocaleString("zh-CN")} 现金。` };
    }
    const replacement = makeTaskInstance(replacementDef);
    player.tasks = player.tasks.map((item) => (item.uid === uid ? replacement : item));
    player.taskResetCount = Math.max(0, Math.round(Number(player.taskResetCount) || 0)) + 1;
    refreshPlayerReport(player);
    return {
      ok: true,
      task: replacement,
      cost,
      nextCost: taskResetCostForCount(player.taskResetCount)
    };
  }

  return {
    makeTaskInstance,
    pickTaskDefinitions,
    taskDefinitionAvailable,
    refreshTasksIfDue,
    advanceTask,
    claimTask,
    resetTask,
    TASK_REFRESH_MS,
    TASK_RESET_COST,
    TASK_RESET_COSTS,
    taskResetCostForCount,
    TASK_COUNT,
    TASK_DEFINITIONS
  };
}
