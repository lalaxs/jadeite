import { renderResourceCard } from "../../resource-card-view.js";
import { equipmentRepairQuote } from "../../equipment-maintenance.js";
import { EQUIPMENT_STAGE_LABELS } from "../../equipment-trading.js";
export { isEquipmentItem as isMarketEquipment, equipmentVisual, equipmentIdentityCard, equipmentChips, equipmentProfile, equipmentCostRows } from "../../commerce/equipment-view.js";

export function equipmentCard(listing, isMine, { escapeHtml, formatMoney, total, can, seller }) {
  const device = listing.item;
  const buyAction = `data-action="openMarketBuy" data-payload="${escapeHtml(listing.id)}"`;
  const action = isMine
    ? `<button class="jm-buy jm-buy-mine" data-action="withdrawListing" data-payload="${escapeHtml(listing.id)}" type="button">撤单 · 退回工坊</button>`
    : `<button class="jm-buy" ${buyAction} type="button">${can ? "买入" : "现金不足"} · ${formatMoney(total)}</button>`;
  return renderResourceCard({
    type: "equipment",
    stage: device.stage,
    name: [device.brand, device.modelName].filter(Boolean).join(" ") || device.name,
    badge: isMine ? "我的挂单" : "二手设备",
    className: `jm-card jm-equipment-card ${isMine ? "is-mine" : "is-buyable"}`,
    attributes: isMine ? "" : buyAction,
    visualAttributes: isMine ? "" : `${buyAction} aria-label="查看${escapeHtml(device.name)}详情"`,
    summary: [
      `${EQUIPMENT_STAGE_LABELS[device.stage] || "加工"}设备 · 耐久 ${Number(device.condition ?? 100)}%${Number(device.condition) === 0 ? " · 需维修后使用" : ""}`,
      `修满需 ${formatMoney(equipmentRepairQuote(device))}`
    ],
    footer: `${isMine ? `<div class="inventory-slot-value"><span>售价</span><strong>${formatMoney(listing.price)}</strong></div>` : ""}
      <div class="jm-seller"><span class="who">${seller}</span></div>${action}`
  });
}
