import { recruitPrice, workerDailyWage } from "../economy/worker-economy.js";
import { equipmentRepairQuote } from "../economy/equipment-maintenance.js";

export const isBlackmarketResource = (type) => type === "employee" || type === "equipment";
export const resourceBucket = (type) => type === "employee" ? "workers" : "devices";
export const resourceReferencePrice = (type, item) => type === "employee"
  ? recruitPrice(item?.tier)
  : Math.max(100, Math.round(Number(item?.basePrice || 0) * 0.75 - equipmentRepairQuote(item)));
export { workerDailyWage, equipmentRepairQuote };

export function resourceSaleBlock(player, type, item, orders = []) {
  if (!item) return "找不到该员工或设备。";
  if (item.publicStation || item.isOwner || item.virtual) return "公共工位与掌柜不能转让。";
  if (item.blackmarketListingId) return "该资源已经在黑市挂牌。";
  if (type === "equipment" && player?.commissions?.active?.deviceIds?.includes(item.id)) return "设备正在执行来料加工单，结算后才能上架。";
  if ([...(player?.jobs || []), ...(player?.polishingJobs || [])].some((job) => (type === "employee" ? job.workerId : job.deviceId) === item.id)
    || (type === "employee" && player?.livestreamRoom?.status === "live" && player.livestreamRoom.hostWorkerId === item.id)) return "该资源正在工作，结束后才能上架。";
  if (orders.some((order) => order.sellerId === player?.id && ["pending", "escrow"].includes(order.status))) return "仍有未完成的技术委托，请完成或取消后再转让经营资源。";
  return null;
}

export function resourceSellables(state = {}) {
  const me = state.me || {};
  return ["employee", "equipment"].flatMap((type) => (me.workshop?.[resourceBucket(type)] || [])
    .filter((item) => !resourceSaleBlock(me, type, item, state.blackServiceOrders || []))
    .map((item) => ({ ...item, type, _type: type, value: resourceReferencePrice(type, item) })));
}
