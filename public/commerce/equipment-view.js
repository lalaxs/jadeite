import { equipmentRepairQuote } from "../equipment-maintenance.js";

import { EQUIPMENT_STAGE_LABELS } from "../equipment-trading.js";

import { renderEquipmentParamPills } from "../equipment-param-view.js";

import { renderResourceCard, resourceCardArt } from "../resource-card-view.js";

export const isEquipmentItem = (item) => item?._type === "equipment" || item?.type === "equipment" || Boolean(item?.modelKey && EQUIPMENT_STAGE_LABELS[item.stage]);

export function equipmentVisual() {
  return `<div class="jm-equipment-visual">${resourceCardArt("equipment")}</div>`;
}

export function equipmentIdentityCard(device, options = {}) {
  return renderResourceCard({
    type: "equipment", stage: device.stage, name: [device.brand, device.modelName].filter(Boolean).join(" ") || device.name,
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
