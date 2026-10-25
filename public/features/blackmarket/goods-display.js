import { materialSwatchHtml } from "../../inlay-product-renderer.js";
import { workerJobLabel } from "../../worker-detail-view.js";
import { WORKER_SKILL_DEFS } from "../../workshop-craft-scoring.js";
import { workerDailyWage, equipmentRepairQuote, resourceReferencePrice } from "../../../shared/domain/blackmarket/bm-resources.js";
import { resourceCardArt, renderResourceCard } from "../../resource-card-view.js";
import { EQUIPMENT_STAGE_LABELS } from "../../equipment-trading.js";

export function createBlackmarketGoodsDisplay({ helpers, productView }) {
  const { escapeHtml, formatMoney } = helpers;
  const { deriveMaterialProfile } = productView;

const ROLE_LABELS = { stone: "石料", offcut: "散货", finished: "玉器", supplies: "配材", employee: "人才", equipment: "设备", traveler: "行商" };

const npcRoleLabel = (stall) => ROLE_LABELS[stall.npcRole] || "商贩";

const isSpecialGoods = (row) => ["supply", "equipment", "employee"].includes(row.type);

const goodsReferencePrice = (row) => row.type === "equipment"
  ? row.item.basePrice ?? row.referencePrice
  : row.referencePrice ?? (row.type === "employee"
    ? resourceReferencePrice(row.type, row.item) : Number(row.item.value ?? row.item.price ?? 0));

const specialGoodsLabel = (type) => ({ employee: "员工转聘", equipment: "二手设备", supply: "镶嵌材料" })[type] || "物品";

const resourceCardName = (row) => row.type === "equipment"
  ? [row.item.brand, row.item.modelName].filter(Boolean).join(" ") || row.item.name
  : row.item.name;

function resourceCardLines(row, npc) {
  const item = row.item;
  const lines = row.type === "employee"
    ? [`${workerJobLabel(item.job)} · ${Number(item.tier) || 1}阶`, `登录日日薪 ${formatMoney(workerDailyWage(item))}`]
    : [`${EQUIPMENT_STAGE_LABELS[item.stage] || "加工"}设备 · 耐久 ${Number(item.condition ?? 100)}%`];
  return lines;
}

function resourceCardSummary(row, npc) {
  return resourceCardLines(row, npc).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

function blackmarketResourceCard(row, { npc = false, ...options } = {}) {
  return renderResourceCard({
    type: row.type, stage: row.item.stage, name: resourceCardName(row), badge: specialGoodsLabel(row.type),
    summary: resourceCardLines(row, npc), ...options
  });
}

function employeeSkillStats(item) {
  const primary = { cutter: "cut", planner: "set", finisher: "finish", streamer: "speak" }[item.job];
  return Object.entries(WORKER_SKILL_DEFS).sort((a, b) => Number(b[1].dir === primary) - Number(a[1].dir === primary)).map(([key, def]) => {
    const skill = item.skills?.[def.dir]?.[key] || {};
    return { label: def.name, value: `Lv.${skill.level || 1} · 经验 ${skill.exp || 0}` };
  });
}

function specialGoodsVisual(row) {
  const item = row.item;
  if (row.type === "employee" || row.type === "equipment") return resourceCardArt(row.type, item.stage);
  if (row.type === "supply") {
    return `<div class="bm-npc-product is-supply" aria-hidden="true">${materialSwatchHtml({ key: item.materialKey, unit: item.unitLabel })}</div>`;
  }
  return "";
}

function specialGoodsChips(row) {
  const item = row.item;
  if (row.type === "employee") return `<div class="bm-svc-card-chips"><span class="bm-svc-chip">${escapeHtml(workerJobLabel(item.job))} · ${Number(item.tier)}阶</span><span class="bm-svc-chip">登录日日薪 ${formatMoney(workerDailyWage(item))}</span>${employeeSkillStats(item).slice(0, 3).map((stat) => `<span class="bm-svc-chip">${escapeHtml(stat.label + " " + stat.value)}</span>`).join("")}</div>`;
  const labels = row.type === "supply"
    ? [`${item.amount}${item.unitLabel} / 批`, "镶嵌材料"]
    : [item.brand, `科技 ${item.techLevel} 级`, `状态 ${item.condition}%`, item.condition === 100 ? "新品尾货" : "二手设备"];
  return `<div class="bm-svc-card-chips">${labels.map((label) => `<span class="bm-svc-chip">${escapeHtml(label)}</span>`).join("")}</div>`;
}

function goodsPriceComparison(row) {
  const referencePrice = Math.max(0, Number(goodsReferencePrice(row)) || 0);
  const price = Math.max(0, Number(row.price) || 0);
  const repair = row.type === "equipment" ? equipmentRepairQuote(row.item) : 0;
  const totalCost = price + repair;
  const referenceLabel = row.type === "equipment" ? "同款新机价"
    : row.type === "employee" ? "同阶招聘基准"
      : row.type === "supply" ? "商店同批价" : "参考估值";
  const savingsLabel = row.type === "equipment" ? "修满后较新机省"
    : row.type === "employee" ? "较同阶招聘省"
      : row.type === "supply" ? "较商店同批省" : "较参考估值省";
  return { referencePrice, price, repair, totalCost, referenceLabel, savingsLabel,
    hasReference: isSpecialGoods(row) || deriveMaterialProfile(row.item).hasReference,
    savings: Math.max(0, Math.round(referencePrice - totalCost)) };
}

function goodsOfferNotes(row, npc = false) {
  const note = String(row.note || "");
  return [
    npc && row.npcDiscount && !note.includes("本批清仓") ? "本批清仓，售完等下一批" : "",
    npc && row.npcPremium && !note.includes("限量高货") ? "限量高货" : "",
    note
  ].filter(Boolean);
}

function npcGoodsInfo(row, { npc = false, showSavings = false } = {}) {
  if (row.referencePrice == null && !["employee", "equipment"].includes(row.type)) return "";
  const item = row.item;
  const comparison = goodsPriceComparison(row);
  let detail = "";
  if (row.type === "equipment") {
    detail = `<p class="bm-npc-note">${escapeHtml(item.specs)} · 耐久 ${Number(item.condition)} / 100</p><p class="bm-npc-note">挂牌价 ${formatMoney(comparison.price)} · 维修至满耐久 ${formatMoney(comparison.repair)} · 修满后总投入 ${formatMoney(comparison.totalCost)}</p>`;
  }
  if (row.type === "employee") detail = `<p class="bm-npc-note">优点：${escapeHtml((item.traits || []).join("、") || "无")} · 缺点：${escapeHtml((item.flaws || []).join("、") || "无")}</p><p class="bm-npc-note">登录日日薪 ${formatMoney(workerDailyWage(item))}，加入当天记薪，不再另收招聘费。</p>`;
  return `${comparison.hasReference || npc && (row.npcDiscount || row.npcPremium) ? `<div class="bm-npc-price-note">
    ${npc && row.npcDiscount ? '<span class="bm-npc-label is-deal">本批清仓</span>' : ""}
    ${npc && row.npcPremium ? '<span class="bm-npc-label">限量高货</span>' : ""}
    ${comparison.hasReference ? `<span>${comparison.referenceLabel} ${formatMoney(comparison.referencePrice)}</span>` : ""}
  </div>` : ""}${comparison.hasReference && showSavings && comparison.savings > 0 ? `<p class="bm-npc-saving">${comparison.savingsLabel} ${formatMoney(comparison.savings)}</p>` : ""}<p class="bm-npc-note">${escapeHtml(row.note || "")}</p>${detail}`;
}

function npcPurchaseDestination(row) {
  if (row.type === "employee") return "员工将加入名册，保留技能和经验，加入当天记薪；原雇主欠薪不会转给你。";
  if (row.type === "supply") return "整批材料将加入镶嵌材料库存。";
  if (row.type === "equipment") return "设备将加入工坊，可在设备页查看和维修。";
  return row.type === "rough" ? "原石将加入库存，内部品质仍需开料确认。" : "物品将加入库存。";
}

  return { npcRoleLabel, isSpecialGoods, goodsReferencePrice, specialGoodsLabel, resourceCardName, resourceCardSummary, blackmarketResourceCard, employeeSkillStats, specialGoodsVisual, specialGoodsChips, goodsPriceComparison, goodsOfferNotes, npcGoodsInfo, npcPurchaseDestination };
}
