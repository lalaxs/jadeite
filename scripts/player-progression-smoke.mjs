import { readTradingServiceSource } from "./load-trading-service-source.mjs";
import { readWorkshopServiceSource } from "./load-workshop-service-source.mjs";
import assert from "node:assert/strict";
import { readClientShellSource } from "./load-client-shell.mjs";
import {
  ACHIEVEMENT_DEFINITIONS,
  ACHIEVEMENT_TRACKS,
  ACHIEVEMENT_MATERIAL_LABELS,
  achievementRewardChips,
  achievementRewardText,
  achievementRewardsOf,
  achievementViewModels,
  claimAllAchievements,
  claimAchievement,
  evaluateAchievements,
  grantPlayerExp,
  migrateExpFromRep,
  migrateLegacyAchievements,
  nextAchievementViewModel,
  normalizePlayerProgression,
  playerExpProgress,
  playerLevelForExp,
  resolveAchievementStage,
  resolveExpAmount,
  settleAchievements,
  sortAchievementViewModels,
  TASK_EXP_REWARDS,
  collectRepFromValue,
  collectExpFromValue,
  collectRepTierOf,
  COLLECT_REP_VALUE_TIERS,
  FEATURE_AP_GATES,
  FEATURE_AP_GATE_ORDER,
  canAccessFeature,
  featureAccess,
  nextFeatureUnlock,
  newlyUnlockedFeatures,
  playerAchievementPoints,
  grantDebugAchievementPoints,
  syncAchievementPoints,
  buildFeatureUnlockModalEvent
} from "../public/player-progression.js";
import { readFileSync } from "node:fs";

function blankPlayer(overrides = {}) {
  return {
    cash: 30_000,
    rep: 0,
    exp: 0,
    level: 1,
    stats: {},
    collection: [],
    bracelets: [],
    rough: [],
    materials: [],
    achievements: {},
    achievementPoints: 0,
    externalMaterials: {},
    ...overrides
  };
}

{
  assert.equal(COLLECT_REP_VALUE_TIERS.length, 6);
  assert.equal(collectRepFromValue(2499), 0);
  assert.equal(collectRepFromValue(2500), 2);
  assert.equal(collectRepFromValue(8000), 6);
  assert.equal(collectRepFromValue(25000), 14);
  assert.equal(collectRepFromValue(60000), 28);
  assert.equal(collectRepFromValue(150000), 50);
  assert.equal(collectRepFromValue(999999, { alreadyGranted: true }), 0);
  assert.equal(collectExpFromValue(2499), 0);
  assert.equal(collectExpFromValue(25000), 12);
  assert.equal(collectRepTierOf(15000).label, "上柜");
}

{
  assert.equal(playerLevelForExp(0), 1);
  assert.equal(playerLevelForExp(250), 2);
  assert.equal(playerLevelForExp(800), 3);
  assert.equal(playerLevelForExp(1800), 4);
  assert.equal(playerLevelForExp(3600), 5);
  assert.equal(playerLevelForExp(7000), 6);
  assert.equal(playerLevelForExp(12000), 7);
  assert.equal(playerLevelForExp(20000), 8);
  assert.equal(playerLevelForExp(35000), 9);
  assert.equal(migrateExpFromRep(30), 360);
  assert.equal(playerLevelForExp(migrateExpFromRep(30)), 2);
  const progress = playerExpProgress(450);
  assert.equal(progress.level, 2);
  assert.equal(progress.current, 200);
  assert.equal(progress.span, 550);
}

{
  assert.equal(resolveExpAmount("auction_win", { hallLevel: 1 }), 8);
  assert.equal(resolveExpAmount("auction_win", { hallLevel: 5 }), 24);
  assert.equal(resolveExpAmount("livestream_close", { salesCount: 0 }), 0);
  assert.equal(resolveExpAmount("livestream_close", { salesCount: 2 }), 6);
  assert.equal(resolveExpAmount("collect_item", { itemRep: 120 }), 24);
  assert.equal(resolveExpAmount("collect_item", { itemValue: 2499 }), 0);
  assert.equal(resolveExpAmount("collect_item", { itemValue: 25000 }), 12);
  assert.equal(resolveExpAmount("collect_item", { collectRep: 50 }), 24);
  assert.equal(resolveExpAmount("achievement_unlock", { amount: 12 }), 12);
  assert.equal(TASK_EXP_REWARDS.livestream_sell, 20);
}

{
  const player = blankPlayer();
  normalizePlayerProgression(player);
  assert.equal(player.exp, 0);
  assert.equal(player.level, 1);

  const first = grantPlayerExp(player, "window_open");
  assert.equal(first.granted, 6);
  player.stats.windowOpens = 1;
  const unlocked = evaluateAchievements(player);
  assert.ok(unlocked.some((item) => item.id === "window"));
  assert.equal(player.achievementPoints, 10, "AP should auto-grant on completion");
  assert.ok(player.achievements.window.completedAt);
  assert.equal(player.achievements.window.unlockedStage, 1);
  assert.equal(player.cash, 30_000, "evaluateAchievements should not grant cash");

  const again = evaluateAchievements(player);
  assert.equal(again.length, 0);
}

{
  const player = blankPlayer({
    cash: 50_000,
    rep: 40,
    exp: undefined,
    stats: { cashPeak: 50_000 }
  });
  normalizePlayerProgression(player);
  assert.equal(player.exp, migrateExpFromRep(40));
  assert.equal(player.level, playerLevelForExp(player.exp));
  evaluateAchievements(player);
  assert.ok(player.achievements.cash?.completedAt, "¥50,000 peak unlocks 积蓄之路 first stage");
  assert.equal(player.achievements.cash.unlockedStage, 1);
}

{
  const player = { exp: 0, level: 1, stats: {}, expDaily: null };
  for (let i = 0; i < 45; i += 1) grantPlayerExp(player, "opening_done");
  assert.equal(player.exp, 300, "daily craft exp should grant full 20, half 20, then stop");
}

{
  const windowTrack = ACHIEVEMENT_TRACKS.find((item) => item.id === "window");
  const windowStage = resolveAchievementStage(windowTrack, 1);
  assert.match(achievementRewardText(windowStage), /成就积分 10（达成即发）/);
  assert.match(achievementRewardText(windowStage), /¥800/);
  const chips = achievementRewardChips(windowStage);
  assert.ok(chips.some((chip) => chip.kind === "ap" && chip.label === "成就积分 10"));
  assert.ok(chips.some((chip) => chip.kind === "cash" && /¥\s*800/.test(chip.label)));
  assert.ok(chips.some((chip) => chip.kind === "exp" && /经验 × /.test(chip.label)));
  assert.equal(achievementRewardsOf(resolveAchievementStage(ACHIEVEMENT_TRACKS.find((item) => item.id === "cash"), 1)).cash, 0);
  assert.equal(achievementRewardsOf(resolveAchievementStage(ACHIEVEMENT_TRACKS.find((item) => item.id === "level"), 4)).exp, 0);
  assert.equal(resolveAchievementStage(ACHIEVEMENT_TRACKS.find((item) => item.id === "craft"), 8).target, 1600);
  assert.equal(resolveAchievementStage(ACHIEVEMENT_TRACKS.find((item) => item.id === "hire"), 4), null);
  assert.equal(ACHIEVEMENT_MATERIAL_LABELS.sapphire.name, "蓝宝石");
  assert.deepEqual(windowTrack.stages[5].rewards.materials, { ruby: 8 });
  assert.deepEqual(windowTrack.stages[6].rewards.materials, { diamond: 4 });
  assert.deepEqual(
    ACHIEVEMENT_TRACKS.find((item) => item.id === "auction").stages[4].rewards.materials,
    { sapphire: 8 }
  );
}

{
  const player = blankPlayer({
    stats: { windowOpens: 1, cashPeak: 30_000 }
  });
  const unlocked = settleAchievements(player);
  assert.ok(unlocked.some((item) => item.id === "window"));
  assert.equal(player.cash, 30_000, "unlock should wait for claim before granting cash");
  assert.equal(player.exp, 0);
  assert.equal(player.achievementPoints, 10, "unlock should auto-grant AP");
  const claim = claimAchievement(player, "window");
  assert.equal(claim.ok, true);
  assert.equal(player.cash, 30_800);
  assert.equal(player.exp, 12);
  assert.equal(claim.granted.cash, 800);
  assert.equal(claim.granted.ap, 0);
  assert.equal(player.achievementPoints, 10);
  assert.equal(player.achievements.window.claimedStage, 1);
  const again = claimAchievement(player, "window");
  assert.equal(again.ok, false);
  assert.equal(player.cash, 30_800, "achievement cash must not double-grant");
  assert.equal(player.exp, 12);
  assert.equal(player.achievementPoints, 10, "achievement AP must not double-grant");
}

{
  const player = blankPlayer({
    cash: 50_000,
    stats: { cashPeak: 50_000 }
  });
  const ledger = [];
  const hooks = {
    earnCash(target, amount, note, meta) {
      ledger.push({ amount, note, source: meta.source });
      target.cash += amount;
    }
  };
  const unlocked = settleAchievements(player, hooks);
  assert.ok(unlocked.some((item) => item.id === "cash"));
  const claim = claimAchievement(player, "cash", hooks);
  assert.equal(claim.ok, true);
  assert.equal(player.cash, 50_000, "cash track must not grant cash");
  assert.equal(player.exp, 0);
  assert.equal(ledger.length, 0);
}

{
  const player = blankPlayer({
    exp: 4000,
    level: 5,
    stats: { cashPeak: 30_000 }
  });
  settleAchievements(player);
  let last = null;
  for (let i = 0; i < 4; i += 1) {
    last = claimAchievement(player, "level");
    assert.equal(last.ok, true, `level stage ${i + 1} should claim`);
  }
  assert.equal(player.exp, 4000, "level track must not grant exp");
  assert.equal(player.cash, 30_000 + 800 + 1200 + 1800 + 3000);
  assert.equal(player.externalMaterials.goldPure, 3);
  assert.equal(player.achievements.level.claimedStage, 4);
}

{
  const player = blankPlayer({
    rep: 100,
    stats: { cashPeak: 30_000 }
  });
  settleAchievements(player);
  for (let i = 0; i < 3; i += 1) {
    assert.equal(claimAchievement(player, "rep").ok, true);
  }
  assert.equal(player.rep, 100, "rep track must not grant reputation");
  assert.equal(player.cash, 30_000 + 800 + 1200 + 1800);
  assert.equal(player.exp, 12 + 18 + 30);
}

{
  const player = blankPlayer({
    stats: { finishedMade: 1, cashPeak: 30_000 },
    bracelets: [{ materialStage: "finished" }]
  });
  const marked = [];
  settleAchievements(player);
  const claim = claimAchievement(player, "finished", {
    markExternalMaterialNew(_player, key) {
      marked.push(key);
    }
  });
  assert.equal(claim.ok, true);
  assert.equal(player.externalMaterials.silver925, 8);
  assert.deepEqual(marked, ["silver925"]);
}

{
  const player = blankPlayer({ stats: { craftDone: 30 } });
  settleAchievements(player);
  assert.equal(player.achievementPoints, 45, "three reached craft stages should auto-grant all AP");
  assert.equal(claimAchievement(player, "craft").ok, true);
  assert.equal(player.achievements.craft.claimedStage, 1);
  assert.equal(claimAchievement(player, "craft").ok, true);
  assert.equal(player.achievements.craft.claimedStage, 2);
  assert.equal(claimAchievement(player, "craft").ok, true);
  assert.equal(player.achievements.craft.claimedStage, 3);
  const models = achievementViewModels(player);
  const craft = models.find((item) => item.id === "craft");
  assert.equal(craft.claimable, false);
  assert.equal(craft.stageIndex, 4);
  assert.equal(craft.target, 80);
  assert.equal(craft.stageLabel, "第 4/7 阶");
}

{
  const player = blankPlayer({
    stats: { windowOpens: 5, cutCount: 1, cashPeak: 30_000 }
  });
  settleAchievements(player);
  assert.equal(player.achievementPoints, 35);
  const claimed = claimAllAchievements(player);
  assert.equal(claimed.ok, true);
  assert.equal(claimed.count, 3);
  assert.equal(claimed.granted.cash, 800 + 1200 + 800);
  assert.equal(player.achievements.window.claimedStage, 2);
  assert.equal(player.achievements.cut.claimedStage, 1);
  assert.equal(player.achievementPoints, 35, "claim-all must not grant AP twice");
}

{
  const player = blankPlayer({
    achievementPoints: 999,
    achievements: {
      window: { claimedStage: 1, unlockedStage: 1, progress: 1, completedAt: null, claimedAt: 1 }
    }
  });
  normalizePlayerProgression(player);
  assert.equal(playerAchievementPoints(player), 999, "legacy AP should never be reduced during migration");
  assert.equal(player.achievementPointsLegacyBonus, 989);
}

{
  const player = blankPlayer({ stats: { windowOpens: 1 } });
  evaluateAchievements(player);
  const window = achievementViewModels(player).find((item) => item.id === "window");
  assert.equal(window.claimable, true);
  assert.equal(window.done, false);
  assert.equal(window.stageLabel, "第 1/7 阶");
}

{
  const player = blankPlayer({
    stats: { craftDone: 1000 },
    achievements: {
      craft: { claimedStage: 7, unlockedStage: 7, progress: 1000, completedAt: null, claimedAt: 1 }
    }
  });
  const craft = achievementViewModels(player).find((item) => item.id === "craft");
  assert.equal(craft.endless, true);
  assert.equal(craft.stageLabel, "无尽");
  assert.equal(craft.stageIndex, 8);
  assert.equal(craft.target, 1600);
}

{
  const rare = achievementViewModels(blankPlayer()).find((item) => item.id === "legendary");
  assert.equal(rare.rare, true);
  assert.equal(rare.stageLabel, "稀有");
}

{
  const player = blankPlayer({
    achievements: { first_window: { progress: 1, completedAt: 1, claimedAt: 2 } }
  });
  migrateLegacyAchievements(player);
  assert.equal(player.achievements.window.claimedStage, 1);
  assert.equal(player.achievements.first_window, undefined);
}

assert.equal(ACHIEVEMENT_DEFINITIONS.length, 18);
assert.equal(ACHIEVEMENT_TRACKS.length, 18);

{
  const sorted = sortAchievementViewModels([
    { id: "hire", claimable: false, claimed: false, pct: 0 },
    { id: "finished", claimable: false, claimed: true, claimedAt: 50 },
    { id: "cash", claimable: true, claimed: false, completedAt: 200 },
    { id: "craft", claimable: false, claimed: false, pct: 80 },
    { id: "window", claimable: true, claimed: false, completedAt: 100 },
    { id: "live", claimable: false, claimed: true, claimedAt: 90 }
  ]);
  assert.deepEqual(sorted.map((item) => item.id), [
    "cash",
    "window",
    "craft",
    "hire",
    "live",
    "finished"
  ]);
}

{
  const tied = sortAchievementViewModels([
    { id: "cash", claimable: true, claimed: false, completedAt: 10 },
    { id: "window", claimable: true, claimed: false, completedAt: 10 }
  ]);
  assert.deepEqual(tied.map((item) => item.id), ["window", "cash"]);
}

{
  const player = blankPlayer({
    stats: { cashPeak: 30_000 }
  });
  const models = sortAchievementViewModels(achievementViewModels(player));
  const firstClaimable = models.find((item) => item.claimable);
  assert.equal(firstClaimable, undefined, "starter 30k should not unlock 积蓄 50k");
  assert.equal(nextAchievementViewModel(player).id, "cash");
}

const mainEntry = readFileSync("public/main.js", "utf8");
const main = readClientShellSource();
const server = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const boot = `${server}\n${wireSource}`;
const taskService = readFileSync("server/services/task-service.js", "utf8");
const auctionService = readTradingServiceSource("auction-service.js");
const auction = readFileSync("public/features/auction/auction-module.js", "utf8");
assert.match(main, /playerExpProgress/);
assert.match(main, /achievementViewModels/);
assert.match(main, /sortAchievementViewModels/);
assert.match(main, /claimAchievement/);
assert.match(main, />领取</);
assert.match(main, /stageLabel/);
assert.match(main, /resolveAchievementStage/);
assert.match(main, /achv-group-label/);
assert.match(main, /panel-tab-dot/);
assert.match(main, /有未领取的成就奖励/);
assert.match(main, /rewardChipsHtml|achievementRewardChips/);
assert.match(readFileSync("shared/domain/progression/player-progression.js", "utf8"), /syncAchievementPoints/);
assert.match(readFileSync("shared/domain/progression/player-progression.js", "utf8"), /achievementPointsFromClaims/);
assert.match(readFileSync("shared/domain/progression/player-progression.js", "utf8"), /FEATURE_AP_GATES/);
assert.match(readFileSync("public/player-progression.js", "utf8"), /shared\/domain\/progression\/player-progression/);
assert.match(readFileSync("public/styles/hud-fx.css", "utf8"), /\.panel-tab-dot/);
assert.match(readFileSync("public/styles/hud-fx.css", "utf8"), /\.achv\.is-claimable \.achv-ico/);
assert.match(readFileSync("public/styles/hud-fx.css", "utf8"), /\.achv-summary/);
assert.match(main, /achv-summary/);
assert.match(main, /nextFeatureUnlock/);
assert.match(readTradingServiceSource("market-service.js"), /denyUnlessMarket|featureAccess\(player, "market"\)/);
const blackmarketSource = [
  readFileSync("server/services/blackmarket-service.js", "utf8"),
  readTradingServiceSource("blackmarket/context.js"),
  readFileSync("server/services/blackmarket/index.js", "utf8")
].join("\n");
assert.match(blackmarketSource, /denyUnlessBmBuy|featureAccess\(player, "bmBuy"\)/);
assert.match(blackmarketSource, /denyUnlessBmStall|featureAccess\(player, "bmStall"\)/);
assert.doesNotMatch(main, /经验由声望推导/);
const workshopService = readWorkshopServiceSource();
assert.match(`${boot}\n${workshopService}\n${auctionService}`, /grantPlayerExp/);
assert.match(`${boot}\n${workshopService}\n${auctionService}`, /settlePlayerAchievements/);
assert.match(wireSource, /bindAchievementRewards/);
assert.match(taskService, /exp:\s*TASK_EXP_REWARDS/);
assert.match(auctionService, /playerLevelForExp\(player\?\.exp\)/);
assert.match(auction, /经营 Lv\.\$\{hall\.requiredLevel\} 解锁/);

{
  const fresh = blankPlayer({ achievementPoints: 0 });
  for (const id of FEATURE_AP_GATE_ORDER) {
    assert.equal(FEATURE_AP_GATES[id].ap, 0);
    assert.equal(canAccessFeature(fresh, id), true);
    assert.equal(featureAccess(fresh, id).message, "");
  }
  assert.equal(nextFeatureUnlock(fresh), null);
  assert.deepEqual(newlyUnlockedFeatures(0, 600), []);
  const debugPlayer = blankPlayer();
  const granted = grantDebugAchievementPoints(debugPlayer, 10);
  assert.equal(granted.gained, 10);
  assert.equal(debugPlayer.achievementPointsBonus, 10);
  assert.equal(playerAchievementPoints(debugPlayer), 10);
  grantDebugAchievementPoints(debugPlayer, 10);
  assert.equal(playerAchievementPoints(debugPlayer), 20);
  syncAchievementPoints(debugPlayer);
  assert.equal(playerAchievementPoints(debugPlayer), 20, "debug AP bonus must survive sync");
  const unlockModal = buildFeatureUnlockModalEvent(FEATURE_AP_GATES.market, { currentAp: 80 });
  assert.equal(unlockModal?.type, "modal");
  assert.match(unlockModal.title, /交易行/);
  assert.ok(unlockModal.actions.some((action) => action.clientAction === "goFeatureUnlock" && action.payload === "market"));
  assert.equal(FEATURE_AP_GATES.market.view, "market");
  assert.equal(FEATURE_AP_GATES.bmBrowse.view, "blackmarket");
  assert.equal(FEATURE_AP_GATES.bmBuy.view, "blackmarket");
  assert.equal(FEATURE_AP_GATES.bmStall.goLabel, "去黑市摆摊");
  const mainEntry = readFileSync("public/main.js", "utf8");
const mainSource = readClientShellSource();
  assert.match(mainSource, /featureAccess\(me, "bmBrowse"\)/);
  assert.match(mainSource, /data-action="lockedLocation"[\s\S]*blackmarket/);
  assert.match(mainSource, /view === "blackmarket"[\s\S]*featureAccess\(state\?\.me, "bmBrowse"\)/);
  const blackmarketNavigationGate = mainSource.match(
    /if \(view === "blackmarket"\) \{[\s\S]*?const access = featureAccess\(state\?\.me, "bmBrowse"\);([\s\S]*?)\n  \}/
  )?.[1] || "";
  assert.match(blackmarketNavigationGate, /showToast/);
  assert.doesNotMatch(blackmarketNavigationGate, /setView\("overview"\)/);
}

console.log("player-progression-smoke: exp / achievements / hall unlock ok");
