// 玩家经营经验 / 成就值：前后端共用。与声望(rep)、员工技能经验相互独立。
import { recordExpGain, EXP_TYPE_LABELS } from "../economy/metric-history.js";

export const PLAYER_LEVEL_THRESHOLDS = [
  { level: 1, exp: 0, label: "新人" },
  { level: 2, exp: 250, label: "起势" },
  { level: 3, exp: 800, label: "熟行" },
  { level: 4, exp: 1800, label: "名店" },
  { level: 5, exp: 3600, label: "宗师" },
  { level: 6, exp: 7000, label: "掌柜" },
  { level: 7, exp: 12000, label: "名坊" },
  { level: 8, exp: 20000, label: "堂口" },
  { level: 9, exp: 35000, label: "泰斗" }
];

export const PLAYER_LEVEL_LABELS = Object.fromEntries(
  PLAYER_LEVEL_THRESHOLDS.map((row) => [row.level, row.label])
);

/** 日课：现金维持，声望改为 0，改发 Exp */
export const TASK_EXP_REWARDS = {
  commission_complete: 30,
  market_buy: 12,
  auction_win: 16,
  workshop_craft: 14,
  livestream_sell: 20,
  market_sell: 10,
  order_complete: 18,
  collection_collect: 16,
  window_open: 12,
  recruit_worker: 12,
  material_buy: 10
};

export const EXP_DAILY_CAPS = {
  commission_done: Object.freeze({ full: 20, half: 40 }),
  opening_done: Object.freeze({ full: 20, half: 40 }),
  carving_done: Object.freeze({ full: 20, half: 40 }),
  finishing_done: Object.freeze({ full: 20, half: 40 }),
  livestream_sale: Object.freeze({ full: 15, half: 30 }),
  market_buy: Object.freeze({ full: 10, half: 20 }),
  market_sell: Object.freeze({ full: 10, half: 20 })
};

const AUCTION_WIN_BY_HALL_LEVEL = [0, 8, 12, 16, 20, 24];

export const ACHIEVEMENT_MATERIAL_LABELS = {
  silver925: { name: "925银", unit: "克" },
  gold18k: { name: "18K金", unit: "克" },
  goldPure: { name: "足金", unit: "克" },
  platinum: { name: "铂金", unit: "克" },
  ruby: { name: "红宝石", unit: "颗" },
  sapphire: { name: "蓝宝石", unit: "颗" },
  diamond: { name: "钻石", unit: "颗" }
};

function S(name, target, ap, tier, rewards, desc) {
  return { name, target, ap, tier, rewards: rewards || {}, desc };
}

export const ACHIEVEMENT_TRACKS = [
  {
    id: "window", title: "开窗之路", metric: "windowOpens", format: "count", endless: "mul", endlessFactor: 1.6,
    stages: [
      S("初试开窗", 1, 10, "铜", { cash: 800, exp: 12 }, "完成第一次原石开窗"),
      S("眼力初成", 5, 15, "铜", { cash: 1200, exp: 16 }, "累计开窗 5 次"),
      S("场口常客", 15, 20, "银", { cash: 1800, exp: 22, materials: { silver925: 8 } }, "累计开窗 15 次"),
      S("看料老手", 40, 25, "银", { cash: 2400, exp: 28 }, "累计开窗 40 次"),
      S("窗前百眼", 100, 30, "银", { exp: 32, materials: { gold18k: 3 } }, "累计开窗 100 次"),
      S("识石入骨", 250, 40, "金", { materials: { ruby: 8 } }, "累计开窗 250 次"),
      S("开窗宗师", 500, 50, "金", { materials: { diamond: 4 } }, "累计开窗 500 次")
    ]
  },
  {
    id: "auction", title: "公盘之路", metric: "auctionWins", format: "count", endless: "mul", endlessFactor: 1.6,
    stages: [
      S("初尝中标", 1, 10, "铜", { cash: 800, exp: 16 }, "公盘暗标中标 1 次"),
      S("再下一城", 5, 15, "铜", { cash: 1200, exp: 20 }, "累计中标 5 次"),
      S("场口有名", 15, 20, "银", { cash: 1800, exp: 28, materials: { silver925: 10 } }, "累计中标 15 次"),
      S("暗标老手", 40, 25, "银", { exp: 35, materials: { gold18k: 4 } }, "累计中标 40 次"),
      S("连中带利", 100, 30, "金", { materials: { sapphire: 8 } }, "累计中标 100 次"),
      S("公盘常胜", 250, 40, "金", { materials: { platinum: 3 } }, "累计中标 250 次")
    ]
  },
  {
    id: "cut", title: "切石之路", metric: "cutCount", format: "count", endless: "mul", endlessFactor: 1.6,
    stages: [
      S("第一刀", 1, 10, "铜", { cash: 800, exp: 12 }, "完成第一次开料 / 切石"),
      S("敢下刀", 5, 15, "铜", { cash: 1200, exp: 16 }, "累计开料 5 次"),
      S("赌性未消", 15, 20, "银", { cash: 1800, exp: 24 }, "累计开料 15 次"),
      S("开料成习", 40, 25, "银", { exp: 30, materials: { gold18k: 3 } }, "累计开料 40 次"),
      S("百刀入行", 100, 30, "金", { materials: { ruby: 8 } }, "累计开料 100 次"),
      S("刀下见真", 250, 40, "金", { materials: { platinum: 2 } }, "累计开料 250 次")
    ]
  },
  {
    id: "craft", title: "工坊之路", metric: "craftDone", format: "count", endless: "mul", endlessFactor: 1.6,
    stages: [
      S("开工第一件", 1, 10, "铜", { cash: 800, exp: 12 }, "工坊完成工序 1 次"),
      S("熟能生巧", 10, 15, "铜", { cash: 1200, exp: 16 }, "工坊完成工序 10 次"),
      S("坊内有手", 30, 20, "银", { cash: 1800, exp: 24, materials: { silver925: 8 } }, "工坊完成工序 30 次"),
      S("坊内老手", 80, 25, "银", { cash: 2400, exp: 32 }, "工坊完成工序 80 次"),
      S("台面不停", 200, 30, "银", { exp: 38, materials: { gold18k: 4 } }, "工坊完成工序 200 次"),
      S("工坊成势", 500, 40, "金", { materials: { sapphire: 8 } }, "工坊完成工序 500 次"),
      S("工坊宗师", 1000, 50, "金", { materials: { goldPure: 3, diamond: 4 } }, "工坊完成工序 1,000 次")
    ]
  },
  {
    id: "finished", title: "成品之路", metric: "finishedMade", format: "count", endless: "mul", endlessFactor: 1.6,
    stages: [
      S("匠心初成", 1, 10, "铜", { cash: 800, exp: 12, materials: { silver925: 8 } }, "打磨出第一件成品"),
      S("柜上有货", 5, 15, "铜", { cash: 1200, exp: 18 }, "累计出品 5 件"),
      S("成批出手", 15, 20, "银", { cash: 1800, exp: 26 }, "累计出品 15 件"),
      S("货架常满", 40, 25, "银", { exp: 32, materials: { gold18k: 3 } }, "累计出品 40 件"),
      S("成品成河", 100, 30, "金", { materials: { ruby: 8 } }, "累计出品 100 件"),
      S("名坊出品", 250, 40, "金", { materials: { platinum: 2 } }, "累计出品 250 件"),
      S("工坊招牌", 500, 50, "金", { materials: { diamond: 4 } }, "累计出品 500 件")
    ]
  },
  {
    id: "live", title: "带货之路", metric: "livestreamSales", format: "count", endless: "mul", endlessFactor: 1.6,
    stages: [
      S("首单开播", 1, 10, "铜", { cash: 800, exp: 15 }, "直播间成功售出一件"),
      S("镜前十单", 10, 15, "铜", { cash: 1200, exp: 20 }, "直播成交 10 次"),
      S("场次有客", 30, 20, "银", { cash: 1800, exp: 28 }, "直播成交 30 次"),
      S("带货成势", 80, 25, "银", { exp: 36, materials: { gold18k: 4 } }, "直播成交 80 次"),
      S("镜头常亮", 200, 30, "金", { materials: { sapphire: 8 } }, "直播成交 200 次"),
      S("带货名店", 500, 40, "金", { materials: { platinum: 3 } }, "直播成交 500 次")
    ]
  },
  {
    id: "order", title: "接单之路", metric: "orderCount", format: "count", endless: "mul", endlessFactor: 1.6,
    stages: [
      S("接单上岸", 1, 10, "铜", { cash: 800, exp: 15 }, "完成一单客户订单"),
      S("回头客", 5, 15, "铜", { cash: 1200, exp: 20 }, "累计完成 5 单"),
      S("堂口有信", 15, 20, "银", { cash: 1800, exp: 28, materials: { silver925: 8 } }, "累计完成 15 单"),
      S("订单不断", 40, 25, "银", { exp: 34, materials: { gold18k: 3 } }, "累计完成 40 单"),
      S("定制成行", 100, 30, "金", { materials: { ruby: 8 } }, "累计完成 100 单"),
      S("客户盈门", 250, 40, "金", { materials: { platinum: 2 } }, "累计完成 250 单")
    ]
  },
  {
    id: "trade", title: "街口之路", metric: "tradeCount", format: "count", endless: "mul", endlessFactor: 1.6,
    stages: [
      S("第一笔流通", 1, 10, "铜", { cash: 800, exp: 12 }, "交易行成交（买或卖）1 次"),
      S("街口流通", 10, 15, "铜", { cash: 1200, exp: 18 }, "交易行成交 10 次"),
      S("有买有卖", 30, 20, "银", { cash: 1800, exp: 26 }, "交易行成交 30 次"),
      S("行口熟客", 80, 25, "银", { exp: 32, materials: { gold18k: 3 } }, "交易行成交 80 次"),
      S("货走四方", 200, 30, "金", { materials: { sapphire: 8 } }, "交易行成交 200 次"),
      S("街口大户", 500, 40, "金", { materials: { platinum: 2 } }, "交易行成交 500 次")
    ]
  },
  {
    id: "blackmarket", title: "黑市之路", metric: "bmDeals", format: "count", endless: "mul", endlessFactor: 1.6,
    stages: [
      S("第一笔黑市", 1, 10, "铜", { cash: 800, exp: 12 }, "黑市摊位成交或技术单完成 1 次"),
      S("摊前有客", 5, 15, "铜", { cash: 1200, exp: 18 }, "黑市成交 5 次"),
      S("堂口买卖", 15, 20, "银", { cash: 1800, exp: 26 }, "黑市成交 15 次"),
      S("黑市熟手", 40, 25, "银", { exp: 32, materials: { gold18k: 3 } }, "黑市成交 40 次"),
      S("暗巷成名", 100, 30, "金", { materials: { ruby: 4, sapphire: 4 } }, "黑市成交 100 次"),
      S("黑市掌柜", 250, 40, "金", { materials: { platinum: 2 } }, "黑市成交 250 次")
    ]
  },
  {
    id: "collection", title: "藏宝之路", metric: "collectionUniqueCount", format: "count", endless: "add", endlessStep: 25,
    stages: [
      S("入阁第一件", 1, 10, "铜", { cash: 800, exp: 12 }, "累计收藏 1 件不同藏品"),
      S("藏珍纳宝", 5, 15, "银", { cash: 1200, exp: 25, materials: { ruby: 4 } }, "累计收藏 5 件不同藏品"),
      S("柜里有光", 12, 20, "银", { cash: 1800, exp: 30 }, "累计收藏 12 件不同藏品"),
      S("门庭珍藏", 25, 25, "金", { cash: 2400, exp: 40, materials: { gold18k: 5 } }, "累计收藏 25 件不同藏品"),
      S("阁中成列", 50, 30, "金", { materials: { platinum: 2, diamond: 4 } }, "累计收藏 50 件不同藏品"),
      S("藏宝大家", 100, 40, "金", { materials: { goldPure: 3 } }, "累计收藏 100 件不同藏品")
    ]
  },
  {
    id: "facade", title: "门面之路", metric: "collectionPower", format: "count", endless: "mul", endlessFactor: 1.8,
    stages: [
      S("门面有光", 50, 10, "铜", { cash: 800, exp: 15 }, "藏宝阁门面分达到 50"),
      S("门面初成", 150, 15, "银", { cash: 1200, exp: 28 }, "藏宝阁门面分达到 150"),
      S("堂口生辉", 300, 20, "银", { exp: 35, materials: { gold18k: 4 } }, "藏宝阁门面分达到 300"),
      S("名店门面", 500, 25, "金", { materials: { ruby: 6, sapphire: 6 } }, "藏宝阁门面分达到 500"),
      S("街口招牌", 750, 30, "金", { materials: { platinum: 3 } }, "藏宝阁门面分达到 750"),
      S("泰斗门庭", 1000, 40, "金", { materials: { diamond: 6 } }, "藏宝阁门面分达到 1,000")
    ]
  },
  {
    id: "cash", title: "积蓄之路", metric: "cashPeak", format: "money", endless: "mul", endlessFactor: 2,
    stages: [
      S("略有余粮", 50_000, 10, "铜", { materials: { silver925: 8 } }, "现金峰值达到 ¥50,000"),
      S("腰缠万贯", 100_000, 15, "银", { exp: 35, materials: { gold18k: 3 } }, "现金峰值达到 ¥100,000"),
      S("柜里压得住", 250_000, 20, "银", { materials: { gold18k: 5 } }, "现金峰值达到 ¥250,000"),
      S("半百万户", 500_000, 25, "金", { materials: { platinum: 3 } }, "现金峰值达到 ¥500,000"),
      S("百万过手", 1_000_000, 30, "金", { materials: { goldPure: 3 } }, "现金峰值达到 ¥1,000,000"),
      S("三百万户", 3_000_000, 40, "金", { materials: { diamond: 4 } }, "现金峰值达到 ¥3,000,000"),
      S("千万掌柜", 10_000_000, 50, "金", { materials: { diamond: 8 } }, "现金峰值达到 ¥10,000,000")
    ]
  },
  {
    id: "rep", title: "声望之路", metric: "rep", format: "count", endless: "mul", endlessFactor: 1.6,
    stages: [
      S("街坊认得", 20, 10, "铜", { cash: 800, exp: 12 }, "声望达到 20"),
      S("堂口有名", 50, 15, "铜", { cash: 1200, exp: 18 }, "声望达到 50"),
      S("街坊皆知", 100, 20, "银", { cash: 1800, exp: 30 }, "声望达到 100"),
      S("一方熟客", 200, 25, "银", { materials: { gold18k: 3 } }, "声望达到 200"),
      S("街口有号", 400, 30, "金", { materials: { sapphire: 8 } }, "声望达到 400"),
      S("名动一行", 800, 40, "金", { materials: { platinum: 3 } }, "声望达到 800"),
      S("翡翠闻人", 1500, 50, "金", { materials: { diamond: 4 } }, "声望达到 1,500")
    ]
  },
  {
    id: "level", title: "经营之路", metric: "exp", format: "exp", endless: "mul", endlessFactor: 1.5,
    stages: [
      S("起势", 250, 10, "铜", { cash: 800 }, "经营经验达到 250（Lv.2）"),
      S("熟行", 800, 15, "铜", { cash: 1200, materials: { silver925: 8 } }, "经营经验达到 800（Lv.3）"),
      S("名店", 1800, 20, "银", { cash: 1800, materials: { gold18k: 3 } }, "经营经验达到 1,800（Lv.4）"),
      S("宗师", 3600, 25, "金", { cash: 3000, materials: { goldPure: 3 } }, "经营经验达到 3,600（Lv.5）"),
      S("掌柜", 7000, 30, "金", { materials: { platinum: 2 } }, "经营经验达到 7,000（Lv.6）"),
      S("名坊", 12000, 40, "金", { materials: { ruby: 6, sapphire: 6 } }, "经营经验达到 12,000（Lv.7）"),
      S("堂口", 20000, 50, "金", { materials: { diamond: 4 } }, "经营经验达到 20,000（Lv.8）"),
      S("泰斗", 35000, 60, "金", { materials: { goldPure: 3, diamond: 4 } }, "经营经验达到 35,000（Lv.9）")
    ]
  },
  {
    id: "hire", title: "招兵之路", metric: "hireCount", format: "count", endless: false,
    stages: [
      S("招兵买马", 1, 10, "铜", { cash: 800, exp: 10 }, "主动招募一名员工"),
      S("搭起班子", 2, 15, "铜", { cash: 1200, exp: 16 }, "累计招募 2 人"),
      S("坊里有人", 4, 20, "银", { exp: 24, materials: { gold18k: 2 } }, "累计招募 4 人")
    ]
  },
  {
    id: "imperial", title: "帝王之绿", metric: "everImperial", format: "count", endless: false,
    stages: [
      S("帝王之绿", 1, 40, "金", { cash: 3000, exp: 50, materials: { platinum: 3, diamond: 6 } }, "拥有或开出帝王绿")
    ]
  },
  {
    id: "legendary", title: "传奇场口", metric: "legendaryHallWin", format: "count", endless: false,
    stages: [
      S("传奇场口", 1, 50, "金", { materials: { platinum: 2, diamond: 4 } }, "传奇公盘首次中标")
    ]
  },
  {
    id: "badcut", title: "废料十刀", metric: "badCutCount", format: "count", endless: false,
    stages: [
      S("废料十刀", 10, 15, "银", { cash: 800, exp: 20 }, "开料失败 / 切垮累计 10 次")
    ]
  }
];

/** 列表按赛道计；旧一次性 id 在 migrateLegacyAchievements 里映射进来。 */
export const ACHIEVEMENT_DEFINITIONS = ACHIEVEMENT_TRACKS;

const LEGACY_ACHIEVEMENT_MAP = {
  first_window: { id: "window", stage: 1 },
  first_finished: { id: "finished", stage: 1 },
  first_live_sale: { id: "live", stage: 1 },
  first_order: { id: "order", stage: 1 },
  first_hire: { id: "hire", stage: 1 },
  cash_100k: { id: "cash", stage: 2 },
  craft_10: { id: "craft", stage: 2 },
  craft_50: { id: "craft", stage: 3 },
  live_10: { id: "live", stage: 2 },
  live_50: { id: "live", stage: 3 },
  trade_10: { id: "trade", stage: 2 },
  collection_5: { id: "collection", stage: 2 },
  collection_20: { id: "collection", stage: 4 },
  facade_200: { id: "facade", stage: 2 },
  imperial_touch: { id: "imperial", stage: 1 },
  rep_100: { id: "rep", stage: 3 },
  level_5: { id: "level", stage: 4 }
};

export function achievementTrackById(id) {
  return ACHIEVEMENT_TRACKS.find((track) => track.id === id) || null;
}

export function playerLevelForExp(exp) {
  const value = Math.max(0, Math.round(Number(exp) || 0));
  let level = 1;
  for (const row of PLAYER_LEVEL_THRESHOLDS) {
    if (value >= row.exp) level = row.level;
  }
  return level;
}

export function playerLevelLabel(level) {
  const maxLevel = PLAYER_LEVEL_THRESHOLDS[PLAYER_LEVEL_THRESHOLDS.length - 1]?.level || 1;
  return PLAYER_LEVEL_LABELS[Math.max(1, Math.min(maxLevel, Number(level) || 1))] || "新人";
}

export function playerExpProgress(exp) {
  const value = Math.max(0, Math.round(Number(exp) || 0));
  const level = playerLevelForExp(value);
  const current = PLAYER_LEVEL_THRESHOLDS.find((row) => row.level === level) || PLAYER_LEVEL_THRESHOLDS[0];
  const next = PLAYER_LEVEL_THRESHOLDS.find((row) => row.level === level + 1) || null;
  if (!next) {
    return {
      level,
      label: current.label,
      exp: value,
      current: value - current.exp,
      span: 1,
      pct: 100,
      maxed: true,
      nextExp: null
    };
  }
  const span = next.exp - current.exp;
  const into = value - current.exp;
  return {
    level,
    label: current.label,
    exp: value,
    current: into,
    span,
    pct: Math.max(4, Math.min(100, Math.round((into / span) * 100))),
    maxed: false,
    nextExp: next.exp
  };
}

/** 旧号迁移：声望折算经验，避免掉公盘厅 */
export function migrateExpFromRep(rep) {
  return Math.max(0, Math.min(4000, Math.round(Number(rep) || 0) * 12));
}

export function todayKey(now = Date.now()) {
  const date = new Date(now);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function resolveExpAmount(type, context = {}) {
  switch (type) {
    case "auction_win": {
      const hallLevel = Math.max(1, Math.min(5, Number(context.hallLevel) || 1));
      return AUCTION_WIN_BY_HALL_LEVEL[hallLevel] || 8;
    }
    case "window_open":
      return 6;
    case "opening_done":
      return 10;
    case "carving_done":
      return 8;
    case "finishing_done":
      return 12;
    case "commission_done":
      return 12;
    case "livestream_sale":
      return 10;
    case "livestream_close":
      return Number(context.salesCount) > 0 ? 6 : 0;
    case "order_ok":
      return 22;
    case "order_bad":
      return 6;
    case "market_sell":
      return 8;
    case "market_buy":
      return 4;
    case "collect_item": {
      if (context.collectRep != null || context.itemValue != null) {
        const already = Boolean(context.alreadyGranted);
        if (context.collectRep != null) {
          const collectRep = Math.max(0, Math.round(Number(context.collectRep) || 0));
          if (already || collectRep <= 0) return 0;
          if (collectRep >= 50) return 24;
          if (collectRep >= 28) return 16;
          if (collectRep >= 14) return 12;
          if (collectRep >= 6) return 8;
          if (collectRep >= 2) return 4;
          return 0;
        }
        return collectExpFromValue(context.itemValue, { alreadyGranted: already });
      }
      // 旧调用兼容：仍按 itemRep 估经验
      const itemRep = Number(context.itemRep) || 0;
      if (itemRep >= 100) return 24;
      if (itemRep >= 40) return 16;
      return 10;
    }
    case "task_claim":
    case "achievement_unlock":
    case "debug":
      return Math.max(0, Math.round(Number(context.amount) || 0));
    default:
      return 0;
  }
}

function ensureExpDaily(player, now = Date.now()) {
  const key = todayKey(now);
  if (!player.expDaily || player.expDaily.date !== key) {
    player.expDaily = { date: key, counts: {} };
  }
  player.expDaily.counts ||= {};
  return player.expDaily;
}

function dailyExpMultiplier(player, type, now = Date.now()) {
  const band = EXP_DAILY_CAPS[type];
  if (!band) return 1;
  const daily = ensureExpDaily(player, now);
  const count = Math.max(0, Math.round(Number(daily.counts[type]) || 0));
  if (count < band.full) return 1;
  if (count < band.half) return 0.5;
  return 0;
}

function bumpDailyCount(player, type, now = Date.now()) {
  if (!EXP_DAILY_CAPS[type]) return;
  const daily = ensureExpDaily(player, now);
  daily.counts[type] = (Number(daily.counts[type]) || 0) + 1;
}

export function grantPlayerExp(player, type, context = {}) {
  if (!player) return { granted: 0, levelBefore: 1, levelAfter: 1 };
  const now = Number(context.now) || Date.now();
  const levelBefore = playerLevelForExp(player.exp);
  const multiplier = dailyExpMultiplier(player, type, now);
  if (multiplier <= 0) {
    return { granted: 0, levelBefore, levelAfter: levelBefore, capped: true };
  }
  const baseAmount = resolveExpAmount(type, context);
  const amount = Math.round(baseAmount * multiplier);
  if (amount <= 0) {
    return { granted: 0, levelBefore, levelAfter: levelBefore };
  }
  const before = Math.max(0, Math.round(Number(player.exp) || 0));
  player.exp = before + amount;
  player.level = playerLevelForExp(player.exp);
  bumpDailyCount(player, type, now);
  recordExpGain(player, amount, type, EXP_TYPE_LABELS[type] || type, {
    at: now,
    itemId: context.itemId
  });
  return {
    granted: amount,
    levelBefore,
    levelAfter: player.level,
    capped: false,
    diminished: multiplier < 1,
    multiplier
  };
}

function isImperialItem(item) {
  if (!item) return false;
  // 帝王绿是色；旧档 qualityKey=imperial 仅作兼容
  return item.qualityKey === "imperial"
    || String(item.color || "").includes("帝王")
    || (typeof item.quality === "string" && item.quality.includes("帝王"));
}

/** 藏宝阁容量上限：入库后冻结，不可交易/加工，需放回仓库才解冻 */
export const MAX_COLLECTION_SIZE = 20;

/**
 * 入库瞬时声望：按估值死表六档（高→低匹配）。
 * 低价值入库 +0；放回再收入若已发过则不再发（见 collectedRepGranted）。
 */
export const COLLECT_REP_VALUE_TIERS = [
  { minValue: 150000, rep: 50, exp: 24, label: "镇店" },
  { minValue: 60000, rep: 28, exp: 16, label: "重器" },
  { minValue: 25000, rep: 14, exp: 12, label: "精品" },
  { minValue: 8000, rep: 6, exp: 8, label: "上柜" },
  { minValue: 2500, rep: 2, exp: 4, label: "可看" },
  { minValue: 0, rep: 0, exp: 0, label: "入门货" }
];

export function collectRepTierOf(value = 0) {
  const v = Math.max(0, Number(value) || 0);
  for (const tier of COLLECT_REP_VALUE_TIERS) {
    if (v >= tier.minValue) return tier;
  }
  return COLLECT_REP_VALUE_TIERS[COLLECT_REP_VALUE_TIERS.length - 1];
}

/** 入库可得声望；alreadyGranted 时恒为 0（防进出刷）。 */
export function collectRepFromValue(value = 0, { alreadyGranted = false } = {}) {
  if (alreadyGranted) return 0;
  return collectRepTierOf(value).rep;
}

export function collectExpFromValue(value = 0, { alreadyGranted = false } = {}) {
  if (alreadyGranted) return 0;
  return collectRepTierOf(value).exp;
}

export function collectRepLabel(value = 0, { alreadyGranted = false } = {}) {
  if (alreadyGranted) return "入库声望已领取";
  const rep = collectRepFromValue(value);
  return rep > 0 ? `入库声望 +${rep}` : "入库不加声望";
}

export function collectionPowerOf(player) {
  return (player?.collection || []).reduce((sum, item) => sum + (Number(item?.rep) || 0), 0);
}

/** 藏品榜用：藏宝阁内全部藏品估值总和 */
export function collectionValueOf(player) {
  return (player?.collection || []).reduce((sum, item) => sum + (Number(item?.value) || 0), 0);
}

export function syncProgressionStats(player) {
  if (!player) return;
  player.stats ||= {};
  const stats = player.stats;
  stats.windowOpens = Math.max(0, Math.round(Number(stats.windowOpens) || 0));
  stats.finishedMade = Math.max(0, Math.round(Number(stats.finishedMade) || 0));
  stats.craftDone = Math.max(0, Math.round(Number(stats.craftDone) || 0));
  stats.hireCount = Math.max(0, Math.round(Number(stats.hireCount) || 0));
  stats.cashPeak = Math.max(
    Math.round(Number(stats.cashPeak) || 0),
    Math.round(Number(player.cash) || 0)
  );
  stats.cutCount = Math.max(0, Math.round(Number(stats.cutCount) || 0));
  stats.craftCount = Math.max(0, Math.round(Number(stats.craftCount) || 0));
  stats.orderCount = Math.max(0, Math.round(Number(stats.orderCount) || 0));
  stats.tradeCount = Math.max(0, Math.round(Number(stats.tradeCount) || 0));
  stats.livestreamSales = Math.max(0, Math.round(Number(stats.livestreamSales) || 0));
  stats.auctionWins = Math.max(0, Math.round(Number(stats.auctionWins) || 0));
  stats.bmDeals = Math.max(0, Math.round(Number(stats.bmDeals) || 0));
  stats.badCutCount = Math.max(0, Math.round(Number(stats.badCutCount) || 0));
  const collectedIds = new Set();
  for (const item of [...(player.bracelets || []), ...(player.collection || [])]) {
    if (!item || item.collectedRepGranted !== true) continue;
    const key = item.id == null ? null : String(item.id);
    if (key) collectedIds.add(key);
  }
  stats.collectionUniqueCount = Math.max(
    0,
    Math.round(Number(stats.collectionUniqueCount) || 0),
    collectedIds.size,
    (player.collection || []).length
  );
  stats.legendaryHallWin = stats.legendaryHallWin === true;
  if (stats.everImperial !== true) {
    const bags = [
      ...(player.rough || []),
      ...(player.materials || []),
      ...(player.bracelets || []),
      ...(player.collection || [])
    ];
    if (bags.some(isImperialItem)) stats.everImperial = true;
  }
  stats.everImperial = stats.everImperial === true;
}

export function metricValue(player, metric) {
  syncProgressionStats(player);
  const stats = player.stats || {};
  switch (metric) {
    case "windowOpens":
      return stats.windowOpens;
    case "finishedMade":
      return Math.max(stats.finishedMade, (player.bracelets || []).filter((item) => item?.materialStage === "finished").length);
    case "livestreamSales":
      return stats.livestreamSales;
    case "orderCount":
      return stats.orderCount;
    case "hireCount":
      return stats.hireCount;
    case "cashPeak":
      return stats.cashPeak;
    case "craftDone":
      return stats.craftDone;
    case "tradeCount":
      return stats.tradeCount;
    case "collectionCount":
      return (player.collection || []).length;
    case "collectionUniqueCount":
      return stats.collectionUniqueCount;
    case "collectionPower":
      return collectionPowerOf(player);
    case "everImperial":
      return stats.everImperial ? 1 : 0;
    case "legendaryHallWin":
      return stats.legendaryHallWin ? 1 : 0;
    case "cutCount":
      return stats.cutCount;
    case "auctionWins":
      return stats.auctionWins;
    case "bmDeals":
      return stats.bmDeals;
    case "badCutCount":
      return stats.badCutCount;
    case "exp":
      return Math.max(0, Math.round(Number(player.exp) || 0));
    case "rep":
      return Math.round(Number(player.rep) || 0);
    case "level":
      return playerLevelForExp(player.exp);
    default:
      return 0;
  }
}

export function normalizePlayerProgression(player) {
  if (!player || typeof player !== "object") return player;
  player.stats ||= {};
  syncProgressionStats(player);

  const hasExp = Number.isFinite(Number(player.exp));
  if (!hasExp) {
    player.exp = migrateExpFromRep(player.rep);
    player.progressionMigrated = true;
  } else {
    player.exp = Math.max(0, Math.round(Number(player.exp) || 0));
  }
  player.level = playerLevelForExp(player.exp);
  player.achievements ||= {};
  migrateLegacyAchievements(player);
  migrateAchievementApV2(player);
  syncAchievementPoints(player);
  ensureExpDaily(player);
  return player;
}

function blankTrackEntry() {
  return { claimedStage: 0, unlockedStage: 0, apGrantedStage: 0, progress: 0, completedAt: null, claimedAt: null };
}

export function migrateLegacyAchievements(player) {
  if (!player || player.achievementTracksMigrated) return player;
  const old = player.achievements && typeof player.achievements === "object" ? player.achievements : {};
  const next = {};
  for (const track of ACHIEVEMENT_TRACKS) {
    const existing = old[track.id];
    if (existing && typeof existing === "object" && Number.isFinite(Number(existing.claimedStage))) {
      next[track.id] = {
        claimedStage: Math.max(0, Math.round(Number(existing.claimedStage) || 0)),
        unlockedStage: Math.max(0, Math.round(Number(existing.unlockedStage) || 0)),
        apGrantedStage: Math.max(0, Math.round(Number(existing.apGrantedStage) || 0)),
        progress: Math.max(0, Number(existing.progress) || 0),
        completedAt: existing.completedAt || null,
        claimedAt: existing.claimedAt || null
      };
    }
  }
  for (const [legacyId, mapped] of Object.entries(LEGACY_ACHIEVEMENT_MAP)) {
    const entry = old[legacyId];
    if (!entry || !mapped) continue;
    const dest = next[mapped.id] || blankTrackEntry();
    const stage = Math.max(1, Math.round(Number(mapped.stage) || 1));
    if (entry.claimedAt) {
      dest.claimedStage = Math.max(dest.claimedStage, stage);
      dest.unlockedStage = Math.max(dest.unlockedStage, dest.claimedStage);
      dest.apGrantedStage = Math.max(dest.apGrantedStage, dest.claimedStage);
      dest.claimedAt = Math.max(Number(dest.claimedAt) || 0, Number(entry.claimedAt) || 0) || dest.claimedAt;
    } else if (entry.completedAt) {
      dest.claimedStage = Math.max(dest.claimedStage, stage - 1);
      dest.unlockedStage = Math.max(dest.unlockedStage, stage);
      dest.completedAt = dest.completedAt || entry.completedAt;
    }
    next[mapped.id] = dest;
  }
  player.achievements = next;
  player.achievementTracksMigrated = true;
  return player;
}

function migrateAchievementApV2(player) {
  if (!player || player.achievementApV2Migrated) return player;
  const legacyTotal = Math.max(0, Math.round(Number(player.achievementPoints) || 0));
  for (const track of ACHIEVEMENT_TRACKS) {
    const entry = player.achievements?.[track.id];
    if (!entry || typeof entry !== "object") continue;
    entry.claimedStage = Math.max(0, Math.round(Number(entry.claimedStage) || 0));
    entry.unlockedStage = Math.max(entry.claimedStage, Math.round(Number(entry.unlockedStage) || 0));
    entry.apGrantedStage = Math.max(entry.claimedStage, Math.round(Number(entry.apGrantedStage) || 0));
  }
  const debugBonus = Math.max(0, Math.round(Number(player.achievementPointsBonus) || 0));
  const earned = achievementPointsFromClaims(player);
  player.achievementPointsLegacyBonus = Math.max(
    Math.max(0, Math.round(Number(player.achievementPointsLegacyBonus) || 0)),
    legacyTotal - earned - debugBonus,
    0
  );
  player.achievementApV2Migrated = true;
  return player;
}

export function resolveAchievementStage(track, stageIndex) {
  if (!track || !Number.isFinite(Number(stageIndex)) || stageIndex < 1) return null;
  const named = track.stages || [];
  const namedCount = named.length;
  if (stageIndex <= namedCount) {
    const stage = named[stageIndex - 1];
    return {
      id: track.id,
      trackTitle: track.title,
      stageName: stage.name,
      title: namedCount > 1 ? `${track.title} · ${stage.name}` : track.title,
      desc: stage.desc,
      metric: track.metric,
      format: track.format || "count",
      target: stage.target,
      ap: stage.ap,
      tier: stage.tier,
      rewards: stage.rewards || {},
      stageIndex,
      namedCount,
      endless: false
    };
  }
  if (!track.endless) return null;
  let target = named[namedCount - 1]?.target || 1;
  for (let index = namedCount + 1; index <= stageIndex; index += 1) {
    if (track.endless === "add") {
      target += Math.max(1, Math.round(Number(track.endlessStep) || 1));
    } else {
      const factor = Number(track.endlessFactor) || 1.6;
      target = Math.max(target + 1, Math.round(target * factor));
    }
  }
  const ap = 10 + stageIndex * 2;
  return {
    id: track.id,
    trackTitle: track.title,
    stageName: `第 ${stageIndex} 阶`,
    title: `${track.title} · 第 ${stageIndex} 阶`,
    desc: `继续推进，目标 ${target}`,
    metric: track.metric,
    format: track.format || "count",
    target,
    ap,
    tier: "金",
    rewards: {},
    stageIndex,
    namedCount,
    endless: true
  };
}

export function achievementRewardsOf(def) {
  const raw = def?.rewards && typeof def.rewards === "object" ? def.rewards : {};
  const materials = raw.materials && typeof raw.materials === "object" ? raw.materials : {};
  const cleaned = {};
  for (const [key, amount] of Object.entries(materials)) {
    const qty = Number(amount);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    cleaned[key] = Math.round(qty * 100) / 100;
  }
  return {
    cash: Math.max(0, Math.round(Number(raw.cash) || 0)),
    exp: Math.max(0, Math.round(Number(raw.exp) || 0)),
    materials: cleaned
  };
}

function materialRewardLabel(key, amount) {
  const meta = ACHIEVEMENT_MATERIAL_LABELS[key] || { name: key, unit: "" };
  const qty = Math.round((Number(amount) || 0) * 100) / 100;
  return `${meta.name} ${qty}${meta.unit}`;
}

/** Structured reward chips for UI (AP / cash / exp / materials). */
export function achievementRewardChips(def) {
  const ap = Math.max(0, Math.round(Number(def?.ap) || 0));
  const rewards = achievementRewardsOf(def);
  const chips = [];
  if (ap) chips.push({ kind: "ap", label: `AP ${ap}`, title: `AP ${ap}（达成即发）` });
  if (rewards.cash) {
    const cashNum = rewards.cash.toLocaleString("zh-CN");
    chips.push({ kind: "cash", label: `¥ ${cashNum}`, title: `¥${cashNum}` });
  }
  if (rewards.exp) {
    chips.push({ kind: "exp", label: `经验 × ${rewards.exp}`, title: `+${rewards.exp} 经验` });
  }
  for (const [key, amount] of Object.entries(rewards.materials)) {
    const meta = ACHIEVEMENT_MATERIAL_LABELS[key] || { name: key, unit: "" };
    const qty = Math.round((Number(amount) || 0) * 100) / 100;
    const full = materialRewardLabel(key, amount);
    chips.push({
      kind: "mat",
      label: `${meta.name}×${qty}`,
      title: full
    });
  }
  return chips;
}

export function achievementRewardText(def) {
  return achievementRewardChips(def).map((chip) => chip.title || chip.label).join(" · ");
}

function grantAchievementMaterials(player, materials, markNew) {
  if (!player || !materials) return;
  const keys = Object.keys(materials);
  if (!keys.length) return;
  player.externalMaterials ||= {};
  for (const [key, amount] of Object.entries(materials)) {
    const qty = Number(amount);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const previousQty = Math.max(0, Number(player.externalMaterials[key]) || 0);
    const nextQty = Math.round((previousQty + qty) * 100) / 100;
    const pool = player.externalMaterialCosts?.[key];
    const aligned = pool && Math.abs(Number(pool.quantity) - previousQty) < .001;
    player.externalMaterialCosts ||= {};
    player.externalMaterialCosts[key] = {
      quantity: nextQty,
      amount: previousQty > 0 ? Math.max(0, Math.round(Number(pool?.amount) || 0)) : 0,
      complete: previousQty === 0 || Boolean(aligned && pool.complete === true)
    };
    player.externalMaterials[key] = nextQty;
    if (typeof markNew === "function") markNew(player, key);
  }
}

function applyAchievementCash(player, amount, title, id, earnCash) {
  const cash = Math.max(0, Math.round(Number(amount) || 0));
  if (!cash || !player) return 0;
  const note = `成就奖励：${title}`;
  const meta = { source: "achievementReward", itemId: id, repEligible: false };
  if (typeof earnCash === "function") {
    const granted = earnCash(player, cash, note, meta);
    return typeof granted === "number" ? granted : cash;
  }
  player.cash = Math.max(0, Math.round(Number(player.cash) || 0)) + cash;
  return cash;
}

export function evaluateAchievements(player, now = Date.now()) {
  if (!player) return [];
  normalizePlayerProgression(player);
  const unlocked = [];
  for (const track of ACHIEVEMENT_TRACKS) {
    const entry = player.achievements[track.id] || blankTrackEntry();
    const progress = metricValue(player, track.metric);
    entry.progress = progress;
    entry.claimedStage = Math.max(0, Math.round(Number(entry.claimedStage) || 0));
    entry.unlockedStage = Math.max(entry.claimedStage, Math.round(Number(entry.unlockedStage) || 0));
    entry.apGrantedStage = Math.max(entry.claimedStage, Math.round(Number(entry.apGrantedStage) || 0));
    let stageIndex = entry.apGrantedStage + 1;
    let guard = 0;
    while (guard < 64) {
      const stage = resolveAchievementStage(track, stageIndex);
      if (!stage || progress < stage.target) break;
      entry.unlockedStage = Math.max(entry.unlockedStage, stageIndex);
      entry.apGrantedStage = stageIndex;
      unlocked.push(stage);
      stageIndex += 1;
      guard += 1;
    }
    entry.completedAt = entry.unlockedStage > entry.claimedStage
      ? (entry.completedAt || now)
      : null;
    player.achievements[track.id] = entry;
  }
  syncAchievementPoints(player);
  return unlocked;
}

export function settleAchievements(player, _hooks = {}, now = Date.now()) {
  const unlocked = evaluateAchievements(player, now);
  return unlocked.map((def) => ({
    ...def,
    rewardText: achievementRewardText(def),
    claimable: true,
    granted: { ap: Math.max(0, Math.round(Number(def.ap) || 0)), cash: 0, exp: 0, materials: {} }
  }));
}

/** Sum AP from stages whose AP has already been auto-granted. */
export function achievementPointsFromClaims(player) {
  let total = 0;
  const achievements = player?.achievements || {};
  for (const track of ACHIEVEMENT_TRACKS) {
    const entry = achievements[track.id] || {};
    const grantedStage = Math.max(
      Math.round(Number(entry.claimedStage) || 0),
      Math.round(Number(entry.apGrantedStage) || 0),
      0
    );
    for (let stageIndex = 1; stageIndex <= grantedStage; stageIndex += 1) {
      const stage = resolveAchievementStage(track, stageIndex);
      if (!stage) break;
      total += Math.max(0, Math.round(Number(stage.ap) || 0));
    }
  }
  return total;
}

export function syncAchievementPoints(player) {
  if (!player) return 0;
  const bonus = Math.max(0, Math.round(Number(player.achievementPointsBonus) || 0));
  const legacyBonus = Math.max(0, Math.round(Number(player.achievementPointsLegacyBonus) || 0));
  player.achievementPointsBonus = bonus;
  player.achievementPointsLegacyBonus = legacyBonus;
  player.achievementPoints = achievementPointsFromClaims(player) + bonus + legacyBonus;
  return player.achievementPoints;
}

export function claimAchievement(player, id, hooks = {}, now = Date.now()) {
  if (!player) return { ok: false, message: "未找到玩家。" };
  evaluateAchievements(player, now);
  const track = achievementTrackById(id);
  if (!track) return { ok: false, message: "成就不存在。" };
  const entry = player.achievements?.[track.id] || blankTrackEntry();
  const nextIndex = Math.max(0, Math.round(Number(entry.claimedStage) || 0)) + 1;
  const stage = resolveAchievementStage(track, nextIndex);
  if (!stage) return { ok: false, message: "该成就已满阶。" };
  if (metricValue(player, track.metric) < stage.target || entry.unlockedStage < nextIndex) {
    return { ok: false, message: "该成就尚未达成，无法领取。" };
  }
  if (Math.round(Number(entry.claimedStage) || 0) >= nextIndex) {
    return { ok: false, message: "该成就奖励已领取。" };
  }
  const rewards = achievementRewardsOf(stage);
  const earnCash = typeof hooks?.earnCash === "function" ? hooks.earnCash : null;
  const markNew = typeof hooks?.markExternalMaterialNew === "function" ? hooks.markExternalMaterialNew : null;
  const grantedCash = applyAchievementCash(player, rewards.cash, stage.title, `${track.id}:${nextIndex}`, earnCash);
  const expResult = rewards.exp
    ? grantPlayerExp(player, "achievement_unlock", { amount: rewards.exp, itemId: `${track.id}:${nextIndex}`, now })
    : { granted: 0 };
  grantAchievementMaterials(player, rewards.materials, markNew);
  entry.claimedStage = nextIndex;
  entry.lastGrantedCash = grantedCash;
  entry.claimedAt = now;
  entry.completedAt = null;
  entry.unlockedStage = Math.max(Math.round(Number(entry.unlockedStage) || 0), nextIndex);
  player.achievements[track.id] = entry;
  evaluateAchievements(player, now);
  syncAchievementPoints(player);
  return {
    ok: true,
    id: track.id,
    title: stage.title,
    rewardText: achievementRewardText(stage),
    granted: {
      ap: 0,
      cash: grantedCash,
      exp: expResult.granted || 0,
      materials: rewards.materials
    }
  };
}

export function claimAllAchievements(player, hooks = {}, now = Date.now()) {
  if (!player) return { ok: false, message: "未找到玩家。", count: 0, results: [] };
  evaluateAchievements(player, now);
  const results = [];
  let guard = 0;
  let claimedInPass = true;
  while (claimedInPass && guard < 128) {
    claimedInPass = false;
    for (const track of ACHIEVEMENT_TRACKS) {
      const entry = player.achievements?.[track.id] || blankTrackEntry();
      const nextIndex = Math.max(0, Math.round(Number(entry.claimedStage) || 0)) + 1;
      if (Math.round(Number(entry.unlockedStage) || 0) < nextIndex) continue;
      const result = claimAchievement(player, track.id, hooks, now);
      if (!result.ok) continue;
      results.push(result);
      claimedInPass = true;
      guard += 1;
      if (guard >= 128) break;
    }
  }
  if (!results.length) return { ok: false, message: "当前没有可领取的成就奖励。", count: 0, results: [] };
  const granted = { ap: 0, cash: 0, exp: 0, materials: {} };
  for (const result of results) {
    granted.cash += Math.max(0, Number(result.granted?.cash) || 0);
    granted.exp += Math.max(0, Number(result.granted?.exp) || 0);
    for (const [key, amount] of Object.entries(result.granted?.materials || {})) {
      granted.materials[key] = Math.round(((Number(granted.materials[key]) || 0) + (Number(amount) || 0)) * 100) / 100;
    }
  }
  return { ok: true, count: results.length, results, granted };
}

const ACHIEVEMENT_ORDER = Object.fromEntries(
  ACHIEVEMENT_TRACKS.map((track, index) => [track.id, index])
);

function achievementDefOrder(item) {
  const index = ACHIEVEMENT_ORDER[item?.id];
  return Number.isInteger(index) ? index : ACHIEVEMENT_TRACKS.length;
}

function compareDescThenDef(a, b, field) {
  const delta = (Number(b?.[field]) || 0) - (Number(a?.[field]) || 0);
  return delta || (achievementDefOrder(a) - achievementDefOrder(b));
}

/** 可领取（completedAt 降序）→ 进行中（pct 降序）→ 已领取（claimedAt 降序）；并列按定义顺序。 */
export function sortAchievementViewModels(list) {
  const claimable = [];
  const active = [];
  const claimed = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (item?.claimable) claimable.push(item);
    else if (item?.claimed) claimed.push(item);
    else active.push(item);
  }
  claimable.sort((a, b) => compareDescThenDef(a, b, "completedAt"));
  active.sort((a, b) => compareDescThenDef(a, b, "pct"));
  claimed.sort((a, b) => compareDescThenDef(a, b, "claimedAt"));
  return claimable.concat(active, claimed);
}

function trackEntryOf(player, id) {
  return player?.achievements?.[id] || blankTrackEntry();
}

export function achievementViewModels(player) {
  normalizePlayerProgression(player);
  return ACHIEVEMENT_TRACKS.map((track) => {
    const entry = trackEntryOf(player, track.id);
    const claimedStage = Math.max(0, Math.round(Number(entry.claimedStage) || 0));
    const nextIndex = claimedStage + 1;
    const nextStage = resolveAchievementStage(track, nextIndex);
    const progress = metricValue(player, track.metric);
    const maxed = !nextStage;
    const display = nextStage || resolveAchievementStage(track, Math.max(1, claimedStage)) || {
      id: track.id,
      trackTitle: track.title,
      stageName: track.title,
      title: track.title,
      desc: "",
      metric: track.metric,
      format: track.format || "count",
      target: 1,
      ap: 0,
      tier: "铜",
      rewards: {},
      stageIndex: claimedStage,
      namedCount: track.stages.length,
      endless: false
    };
    const target = Math.max(1, Number(display.target) || 1);
    const claimable = Boolean(!maxed && entry.completedAt && progress >= target);
    const claimed = maxed;
    const rare = (track.stages || []).length === 1 && !track.endless;
    const pct = maxed ? 100 : Math.max(0, Math.min(100, Math.round((progress / target) * 100)));
    const stageLabel = maxed
      ? "满阶"
      : (display.endless ? "无尽" : (rare ? "稀有" : `第 ${display.stageIndex}/${display.namedCount} 阶`));
    return {
      id: track.id,
      title: track.title,
      stageName: display.stageName,
      desc: display.desc,
      metric: track.metric,
      format: display.format,
      progress,
      target,
      ap: display.ap,
      tier: display.tier,
      rewards: claimed && Number.isFinite(entry.lastGrantedCash)
        ? { ...display.rewards, cash: entry.lastGrantedCash } : display.rewards,
      stageIndex: display.stageIndex,
      namedCount: display.namedCount,
      stageLabel,
      endless: Boolean(display.endless),
      rare,
      done: maxed,
      claimed,
      claimable,
      pct,
      completedAt: entry.completedAt || null,
      claimedAt: entry.claimedAt || null,
      rewardText: achievementRewardText(display)
    };
  });
}

export function nextAchievementViewModel(player) {
  const list = achievementViewModels(player);
  const active = list.filter((item) => !item.claimable && !item.claimed);
  active.sort((a, b) => (Number(b.pct) || 0) - (Number(a.pct) || 0) || achievementDefOrder(a) - achievementDefOrder(b));
  const next = active[0] || list.find((item) => item.claimable);
  if (!next) {
    return {
      id: "all-done",
      title: "全部达成",
      desc: "江湖路远，去公盘再淘块好料吧！",
      progressText: "",
      countText: "",
      rewardText: "",
      rewards: {},
      pct: 100,
      done: true,
      claimable: false,
      ap: 0
    };
  }
  const countText = next.format === "money"
    ? null
    : `${next.progress} / ${next.target}`;
  const rewardText = next.rewardText || achievementRewardText(next);
  return {
    id: next.id,
    title: next.title,
    desc: next.claimable ? `${next.stageName} · 可领取` : `${next.stageName} · ${next.desc}`,
    progressText: `${rewardText}  ${countText || ""}`.trim(),
    countText: countText || "",
    rewardText,
    rewards: next.rewards || {},
    format: next.format,
    progress: next.progress,
    target: next.target,
    pct: next.pct,
    done: false,
    claimable: Boolean(next.claimable),
    ap: next.ap
  };
}

/** 交易行和黑市从开局开放；保留定义供现有入口查询。 */
export const FEATURE_AP_GATES = Object.freeze({
  market: Object.freeze({
    id: "market",
    label: "交易行",
    ap: 0,
    view: "market",
    goLabel: "去交易行",
    blurb: "可在交易行挂牌出售、发求购，以及买入其他掌柜的货品。"
  }),
  bmBrowse: Object.freeze({
    id: "bmBrowse",
    label: "黑市浏览",
    ap: 0,
    view: "blackmarket",
    goLabel: "逛逛黑市",
    blurb: "可进入黑市查看摊位、购买货品、拆盲盒及下单技术服务。"
  }),
  bmBuy: Object.freeze({
    id: "bmBuy",
    label: "黑市购买",
    ap: 0,
    view: "blackmarket",
    goLabel: "去黑市",
    blurb: "可在黑市购买货品、拆盲盒或下单技术服务。"
  }),
  bmStall: Object.freeze({
    id: "bmStall",
    label: "黑市摆摊",
    ap: 0,
    view: "blackmarket",
    goLabel: "去黑市摆摊",
    blurb: "可开设黑市摊位，上架货品、盲盒或技术服务。"
  })
});

export const FEATURE_AP_GATE_ORDER = Object.freeze(["market", "bmBrowse", "bmBuy", "bmStall"]);

export function playerAchievementPoints(player) {
  return Math.max(0, Math.round(Number(player?.achievementPoints) || 0));
}

export function featureGateDef(featureId) {
  return FEATURE_AP_GATES[featureId] || null;
}

export function canAccessFeature(player, featureId) {
  const def = featureGateDef(featureId);
  if (!def) return true;
  return playerAchievementPoints(player) >= def.ap;
}

export function featureAccess(player, featureId) {
  const def = featureGateDef(featureId);
  const current = playerAchievementPoints(player);
  if (!def) {
    return { ok: true, current, required: 0, label: "", message: "" };
  }
  const ok = current >= def.ap;
  return {
    ok,
    current,
    required: def.ap,
    label: def.label,
    message: ok ? "" : `成就积分达到 ${def.ap} 后开启${def.label}（当前 ${current}）`
  };
}

export function nextFeatureUnlock(player) {
  const current = playerAchievementPoints(player);
  for (const id of FEATURE_AP_GATE_ORDER) {
    const def = FEATURE_AP_GATES[id];
    if (current < def.ap) return { ...def, current };
  }
  return null;
}

export function newlyUnlockedFeatures(beforeAp, afterAp) {
  const before = Math.max(0, Math.round(Number(beforeAp) || 0));
  const after = Math.max(0, Math.round(Number(afterAp) || 0));
  return FEATURE_AP_GATE_ORDER
    .map((id) => FEATURE_AP_GATES[id])
    .filter((def) => before < def.ap && after >= def.ap);
}

/** Build a game-modal payload for newly unlocked AP-gated features. */
export function buildFeatureUnlockModalEvent(features, { currentAp } = {}) {
  const list = (Array.isArray(features) ? features : [features])
    .map((item) => (typeof item === "string" ? FEATURE_AP_GATES[item] : item))
    .filter((item) => item && item.id && item.label);
  if (!list.length) return null;
  const ap = Math.max(0, Math.round(Number(currentAp) || 0));
  const id = `feature-unlock:${list.map((f) => f.id).join("+")}:${ap}`;
  const byView = new Map();
  for (const feature of list) {
    byView.set(feature.view || feature.id, feature);
  }
  const goActions = [...byView.values()].map((feature) => ({
    label: feature.goLabel || `去${feature.label}`,
    clientAction: "goFeatureUnlock",
    payload: feature.view || feature.id
  }));
  if (list.length === 1) {
    const feature = list[0];
    return {
      id,
      type: "modal",
      tone: "success",
      title: `${feature.label}已解锁`,
      subtitle: ap ? `成就积分 ${ap}` : "",
      body: [
        `恭喜！成就积分已达到 ${feature.ap}，${feature.label}现已开放。`,
        feature.blurb || ""
      ].filter(Boolean),
      actions: [
        ...goActions,
        { label: "稍后再说", variant: "secondary" }
      ]
    };
  }
  return {
    id,
    type: "modal",
    tone: "success",
    title: "功能解锁",
    subtitle: ap ? `成就积分 ${ap}` : "",
    body: [
      "恭喜！以下功能现已开放：",
      ...list.map((feature) => `· ${feature.label}（需 ${feature.ap} AP）`)
    ],
    actions: [
      ...goActions,
      { label: "知道了", variant: "secondary" }
    ]
  };
}

/** Debug/dev only: add free AP without claiming achievements. */
export function grantDebugAchievementPoints(player, amount = 10) {
  if (!player) return { ok: false, before: 0, after: 0, gained: 0, unlocked: [] };
  const gained = Math.max(0, Math.round(Number(amount) || 0));
  const before = playerAchievementPoints(player);
  player.achievementPointsBonus = Math.max(0, Math.round(Number(player.achievementPointsBonus) || 0)) + gained;
  syncAchievementPoints(player);
  const after = playerAchievementPoints(player);
  return {
    ok: true,
    before,
    after,
    gained,
    unlocked: newlyUnlockedFeatures(before, after)
  };
}
