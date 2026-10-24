import { equipmentRepairQuote } from "./equipment-maintenance.js";

export const EQUIPMENT_STAGE_LABELS = Object.freeze({ opening: "开料", carving: "规划", finishing: "精加工" });

export function equipmentResaleValue(device) {
  return Math.max(100, Math.round(Number(device?.basePrice || 0) * 0.8 - equipmentRepairQuote(device)));
}

export function equipmentSaleBlockReason(player, device, state = {}) {
  if (device?.publicStation) return "公共工位由街坊维护，不属于可出售资产。";
  if (device?.blackmarketListingId) return "设备正在黑市挂牌，请先撤回。";
  const devices = player?.workshop?.devices || [];
  if (!device || !devices.some((row) => row.id === device.id) || !EQUIPMENT_STAGE_LABELS[device.stage]) return "工坊中找不到该设备。";
  const jobs = [...(player.jobs || []), ...(player.polishingJobs || [])];
  if (jobs.some((job) => job.deviceId === device.id)) return "设备正在加工，完工后才能挂牌。";
  if (player.commissions?.active?.deviceIds?.includes(device.id)) return "设备正在执行来料加工单，结算后才能挂牌。";
  const reserved = (state.blackServiceOrders || []).some((order) => {
    if (order.sellerId !== player.id || !["pending", "escrow"].includes(order.status)) return false;
    const stall = (state.blackStalls || []).find((row) => row.id === order.stallId);
    const offer = (stall?.offers || []).find((row) => row.id === order.offerId);
    return (offer?.capabilityRefs?.equipmentIds || []).includes(device.id);
  });
  if (reserved) return "设备被进行中的技术订单占用，完成订单后才能挂牌。";
  return "";
}
