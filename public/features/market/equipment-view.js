import { equipmentRepairQuote } from "../../equipment-maintenance.js";
import { EQUIPMENT_STAGE_LABELS } from "../../equipment-trading.js";
import { renderEquipmentParamPills } from "../../equipment-param-view.js";
import { renderResourceCard, resourceCardArt } from "../../resource-card-view.js";

export const isMarketEquipment = (item) => item?._type === "equipment" || item?.type === "equipment" || Boolean(item?.modelKey && EQUIPMENT_STAGE_LABELS[item.stage]);

export function equipmentVisual() {
  return `<div class="jm-equipment-visual">${resourceCardArt("equipment")}</div>`;
}

export function equipmentIdentityCard(device, options = {}) {
  return renderResourceCard({
    type: "equipment", name: [device.brand, device.modelName].filter(Boolean).join(" ") || device.name,
    badge: "设备", summary: [`${EQUIPMENT_STAGE_LABELS[device.stage] || "加工"}设备 · 耐久 ${Number(device.condition ?? 100)}%`, `科技 ${device.techLevel || 1} 级`],
    ...options
  });
}

export function equipmentChips(device, escapeHtml) {
  const labels = [EQUIPMENT_STAGE_LABELS[device.stage], `科技 ${device.techLevel || 1} 级`, `耐久 ${device.condition ?? 100}%`];
  if (Number(device.condition) === 0) labels.push("需维修后使用");
  return `<div class="jm-chips">${labels.map((label) => `<span class="jm-chip">${escapeHtml(label)}</span>`).join("")}</div>`;
}

export function equipmentProfile(device, escapeHtml, formatMoney) {
  return `<div class="jm-equipment-profile">${renderEquipmentParamPills(device.attrs || {}, escapeHtml)}<p>同款新机 ${formatMoney(device.basePrice || 0)} · 修满需 ${formatMoney(equipmentRepairQuote(device))}</p></div>`;
}

export function equipmentCostRows(device, total, formatMoney) {
  const repair = equipmentRepairQuote(device);
  return `<div><span>同款新机</span><span>${formatMoney(device.basePrice || 0)}</span></div><div><span>修满耐久费用（另付）</span><span>${formatMoney(repair)}</span></div><div><span>购买并修满总成本</span><span>${formatMoney(total + repair)}</span></div>`;
}

export function equipmentCard(listing, isMine, { escapeHtml, formatMoney, total, can, seller, elapsed }) {
  const device = listing.item;
  const buyAction = `data-action="openMarketBuy" data-payload="${escapeHtml(listing.id)}"`;
  const action = isMine
    ? `<button class="jm-buy jm-buy-mine" data-action="withdrawListing" data-payload="${escapeHtml(listing.id)}" type="button">撤单 · 退回工坊</button>`
    : `<button class="jm-buy" ${buyAction} type="button">${can ? "买入" : "查看详情 · 现金不足"}</button>`;
  return renderResourceCard({
    type: "equipment",
    name: [device.brand, device.modelName].filter(Boolean).join(" ") || device.name,
    badge: isMine ? "我的挂单" : "二手设备",
    className: `jm-card jm-equipment-card ${isMine ? "is-mine" : "is-buyable"}`,
    attributes: isMine ? "" : buyAction,
    visualAttributes: isMine ? "" : `${buyAction} aria-label="查看${escapeHtml(device.name)}详情"`,
    summary: [
      `${EQUIPMENT_STAGE_LABELS[device.stage] || "加工"}设备 · 耐久 ${Number(device.condition ?? 100)}%${Number(device.condition) === 0 ? " · 需维修后使用" : ""}`,
      `同款新机 ${formatMoney(device.basePrice || 0)} · 修满需 ${formatMoney(equipmentRepairQuote(device))}`
    ],
    footer: `<div class="inventory-slot-value"><span>售价</span><strong>${formatMoney(listing.price)}</strong></div>
      <span class="resource-card-summary">含税 ${formatMoney(total)}</span>
      <div class="jm-seller"><span class="who">${seller}</span><span class="when">${elapsed}</span></div>${action}`
  });
}
