export const BUSINESS_DAY_MS = 86_400_000;
export const BUSINESS_AUTO_REPAY_SOURCES = new Set(["order", "market-payout", "blackmarket-sale", "blackmarket-payout", "livestream", "commission", "neighborhood-sale", "consignment", "blackmarket-service-payout", "blackmarket-service-recovery-payout", "blackmarket-blind-sale", "blackmarket-blind-extra-sale", "inventory-recycle", "salvage"]);
export const STARTUP_OPTIONS = Object.freeze([
  { id: "ordinary", name: "普通经营", cash: 500, target: 0, reward: 0 },
  { id: "small", name: "小本合约", cash: 500, target: 10_000, reward: 2_000 },
  { id: "trade", name: "周转合约", cash: 2_000, target: 50_000, reward: 10_000 },
  { id: "venture", name: "大本合约", cash: 10_000, target: 100_000, reward: 20_000 }
]);
export const BUSINESS_BUILDINGS = Object.freeze([
  { id: "stall", name: "固定小摊", target: 1_000, permit: 0, construction: 200, equipment: 0, reward: "货位增至4格，固定摊牌", requires: null },
  { id: "expanded", name: "街口扩摊", target: 3_000, permit: 0, construction: 600, equipment: 0, reward: "货位增至8格，开放批量收购", requires: "stall" },
  { id: "workshop", name: "开料工坊", target: 10_000, permit: 1_000, construction: 3_000, equipment: 0, reward: "赠旧基础开料机，开放原石与开料经营", requires: "expanded", stage: "opening" },
  { id: "auction", name: "公盘经营资格", target: 30_000, permit: 2_000, construction: 0, equipment: 0, reward: "新手公盘与交易行", requires: "workshop", milestone: "openedSold" },
  { id: "carving", name: "取件车间", target: 50_000, permit: 1_000, construction: 3_000, equipment: 4_600, reward: "规划取件，12货位，4名员工", requires: "auction", stage: "carving" },
  { id: "finishing", name: "精加工室", target: 80_000, permit: 1_000, construction: 4_000, equipment: 6_200, reward: "成品定制、镶嵌、5个藏品位、常规公盘", requires: "carving", milestone: "carvedSold", stage: "finishing" },
  { id: "livestream", name: "自有直播间", target: 150_000, permit: 10_000, construction: 5_000, equipment: 0, reward: "掌柜自播，3件货架，精品公盘", requires: "finishing", milestone: "finishedSold" },
  { id: "store", name: "翡翠名店", target: 300_000, permit: 5_000, construction: 25_000, equipment: 0, reward: "24货位、20藏品位、6件直播货架、专场公盘", requires: "livestream", milestone: "liveSold" },
  { id: "legendary", name: "传奇经营资格", target: 600_000, permit: 0, construction: 0, equipment: 0, reward: "传奇公盘、12件直播货架与传奇掌柜店牌", requires: "store" }
]);
const MILESTONE_LABELS = { openedSold: "完成一批自主开料销售", carvedSold: "完成一批毛坯销售", finishedSold: "售出一件自制成品", liveSold: "完成一笔直播成交" };
const FEATURES = { workshop: "workshop", opening: "workshop", carving: "carving", finishing: "finishing", auction: "auction", market: "auction", hireMarket: "workshop", equipment: "workshop", shop: "workshop", orders: "finishing", collection: "finishing", livestream: "livestream", bmService: "carving", bmBlind: "carving", bmResource: "workshop" };
const ALL_FEATURES = Object.keys(FEATURES);
const HALLS = ["novice", "regular", "premium", "special", "legendary"];
export function verifiedOperatingProfit(player) {
  const t = player?.financeBook?.totals || {};
  const value = key => Number(t[key]) || 0;
  const unbookedWages = (player?.employeePayroll?.currentBill?.entries || [])
    .filter(entry => !entry.booked).reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
  return Math.round(value("knownSalesProfit") + value("commissionNet") + value("serviceNet") + value("otherOperatingIncome")
    - value("operatingExpenses") - value("materialLoss") - value("financeCosts") - unbookedWages);
}
export function businessProfit(player) {
  return verifiedOperatingProfit(player) - (Number(player?.business?.profitBase) || 0);
}
export function newBusinessState(now = Date.now()) {
  return { version: 1, createdAt: now, choice: null, profitBase: 0, built: [], qualified: [], milestones: {}, loans: [], history: [], contract: null, trades: 0 };
}
export function normalizeBusiness(player, now = Date.now()) {
  if (player.business) return player.business;
  const b = newBusinessState(now);
  b.choice = "established";
  b.profitBase = verifiedOperatingProfit(player);
  b.inherited = { features: ALL_FEATURES.filter(feature => feature !== "livestream" || player.assets?.livestreamPermitOwned),
    halls: HALLS.slice(0, Math.max(1, Math.min(5, Number(player.level) || 1))), goods: 24, workers: 8, collection: 20, live: 12 };
  b.built = ["stall", "expanded", ...(player.assets?.workshopOwned ? ["workshop", "carving", "finishing"] : []), ...(player.assets?.livestreamPermitOwned ? ["livestream"] : [])];
  b.qualified = [...b.built];
  b.milestones = { openedSold: true, carvedSold: true, finishedSold: true, liveSold: Boolean(player.assets?.livestreamPermitOwned) };
  player.business = b;
  return b;
}
export function buildingAccess(player, id) {
  const b = player?.business;
  const def = BUSINESS_BUILDINGS.find(row => row.id === id);
  if (!def || !b) return { ok: false, message: "建设项目不存在。" };
  if (b.built.includes(id)) return { ok: false, message: "已经建成。" };
  if (!b.choice) return { ok: false, message: "请先选择开局经营方式。" };
  if (b.qualified.includes(id)) return { ok: true };
  if (def.requires && !b.built.includes(def.requires)) return { ok: false, message: `请先建成${BUSINESS_BUILDINGS.find(row => row.id === def.requires)?.name}。` };
  if (businessProfit(player) < def.target) return { ok: false, message: `累计经营净利润达到 ¥${def.target.toLocaleString("zh-CN")} 后取得资格。` };
  if (def.milestone && !b.milestones[def.milestone]) return { ok: false, message: `还需${MILESTONE_LABELS[def.milestone]}。` };
  return { ok: true };
}
export function observeBusinessProgress(player, at = Date.now()) {
  const b = player?.business;
  if (!b?.choice) return;
  const profit = businessProfit(player);
  for (const def of BUSINESS_BUILDINGS) {
    if (!b.qualified.includes(def.id) && buildingAccess(player, def.id).ok) b.qualified.push(def.id);
  }
  b.supplierUnlocked ||= profit >= 100;
  b.demandTier = Math.max(Number(b.demandTier) || 0, profit >= 3000 ? 2 : profit >= 1000 ? 1 : 0);
  const contract = b.contract;
  if (contract?.status === "active" && at <= contract.endsAt) {
    contract.progress = profit - contract.profitStart;
    if (contract.progress >= contract.target) {
      contract.status = "succeeded";
      contract.completedAt = at;
    }
  }
}
export function businessAccess(player, feature) {
  const b = player?.business;
  if (!b) return { ok: true, message: "" };
  if (!b.choice) return { ok: false, message: "请先在主页选择开局经营方式。" };
  if (b.choice === "established" && feature === "livestream" && player.assets?.livestreamPermitOwned) return { ok: true, message: "" };
  if (b.inherited?.features?.includes(feature)) return { ok: true, message: "" };
  const building = FEATURES[feature];
  if (!building || b.built.includes(building)) return { ok: true, message: "" };
  const def = BUSINESS_BUILDINGS.find(row => row.id === building);
  return { ok: false, message: `${def.name}开放后可使用，利润目标 ¥${def.target.toLocaleString("zh-CN")}。` };
}
export function businessHallAccess(player, hallId, level = Number(player?.level || 1)) {
  const b = player?.business;
  if (!b) return null;
  if (b.choice === "established") {
    const index = HALLS.indexOf(hallId);
    const ok = b.inherited?.halls?.includes(hallId) || index >= 0 && index < level;
    return { ok: Boolean(ok), message: ok ? "" : `需要经营 Lv.${index+1} 才能进入该公盘。` };
  }
  const required = { novice: "auction", regular: "finishing", premium: "livestream", special: "store", legendary: "legendary" }[hallId];
  const def = BUSINESS_BUILDINGS.find(row => row.id === required);
  const ok = Boolean(b.choice && required && b.built.includes(required));
  return { ok, message: ok ? "" : `请先取得${def?.name || "公盘经营资格"}。` };
}
export function businessCapacity(player, kind) {
  const b = player?.business;
  if (!b) return { goods: 24, workers: 8, collection: 20, live: 12 }[kind];
  const has = id => b.built.includes(id);
  const values = {
    goods: has("store") ? 24 : has("carving") ? 12 : has("expanded") ? 8 : has("stall") ? 4 : 2,
    workers: has("livestream") ? 8 : has("finishing") ? 6 : has("carving") ? 4 : has("workshop") ? 2 : 0,
    collection: has("store") ? 20 : has("finishing") ? 5 : 0,
    live: has("legendary") ? 12 : has("store") ? 6 : has("livestream") ? 3 : 0
  };
  return Math.max(values[kind] || 0, Number(b.inherited?.[kind]) || 0);
}
export function businessPurchaseAccess(player, item = {}) {
  const stage = item.materialStage || item.stage || (item.type === "rough" ? "rough" : "finished");
  if (["rough", "opened", "material"].includes(stage)) return businessAccess(player, "workshop");
  if (["carved", "polished"].includes(stage)) return businessAccess(player, "carving");
  return { ok: true, message: "" };
}
export function businessStageIndex(player) {
  const built = player?.business?.built || [];
  return BUSINESS_BUILDINGS.reduce((highest, row, index) => built.includes(row.id) ? index + 1 : highest, 0);
}
export function businessReserveBase(player) {
  if (!player?.business || player.business.choice === "established") return 4000;
  return [20, 200, 800, 3000, 6000, 10000, 15000, 20000, 40000, 50000][businessStageIndex(player)];
}
export function businessCreditLimit(player) {
  return [500, 2000, 5000, 10000, 30000, 50000, 80000, 150000, 300000, 300000][businessStageIndex(player)];
}
export function businessDemandCaps(player) {
  if (!player?.business || player.business.choice === "established") return null;
  const stage = businessStageIndex(player);
  const tier = stage >= 3 ? stage : Math.max(Number(player.business.demandTier) || 0, stage);
  const rows = [[12000,80,2000], [40000,100,6000], [120000,120,15000], [200000,140,30000], [300000,160,40000], [450000,180,60000], [600000,200,80000], [1000000,240,150000], [2000000,300,250000], [2000000,300,250000]];
  const [cash, count, premiumCash] = rows[tier];
  return { cash, count, premiumCash, rareCount: 2 };
}
export function businessSnapshot(player, now = Date.now()) {
  const b = player?.business;
  if (!b) return null;
  const buildings = BUSINESS_BUILDINGS.map(def => ({ ...def, price: def.permit + def.construction,
    totalPrice: def.permit + def.construction + def.equipment, built: b.built.includes(def.id), ...buildingAccess(player, def.id) }));
  return { ...structuredClone(b), profit: businessProfit(player), buildings, next: buildings.find(row => !row.built) || null,
    capacity: Object.fromEntries(["goods", "workers", "collection", "live"].map(kind => [kind, businessCapacity(player, kind)])),
    creditLimit: businessCreditLimit(player), debt: (b.loans || []).reduce((sum, loan) => sum + loan.principal + loan.interest + loan.penalty, 0),
    overdue: (b.loans || []).some(loan => loan.principal + loan.interest + loan.penalty > 0 && now >= loan.dueAt) };
}
