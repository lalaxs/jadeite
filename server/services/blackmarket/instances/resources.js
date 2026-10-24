// Instance-owned implementation; legacy entry points remain one directory above.
import { resourceBucket, resourceSaleBlock, isBlackmarketResource } from "../../../../shared/domain/blackmarket/bm-resources.js";
import { MAX_WORKERS, isStarterWorkerId, normalizeDismissedStarterIds } from "../../../systems/employee-system.js";
import { enterEmployeePayrollDay, employeeRecruitmentBlock, recordEmployeePayrollRoster, settleEmployeePayroll } from "../../../systems/employee-payroll.js";
import { setAcquisitionCost } from "../../../../shared/domain/economy/item-cost.js";

export function createResources({
  requireApi
}) {
function ownedResource(player, type, id) {
  return player?.workshop?.[resourceBucket(type)]?.find((item) => item.id === id);
}

function lockResource(player, type, id) {
  const item = ownedResource(player, type, id);
  const blocked = resourceSaleBlock(player, type, item, requireApi().getState().blackServiceOrders || []);
  if (blocked) return { ok: false, message: blocked };
  item.blackmarketListingId = requireApi().randomUUID();
  return { ok: true, item: { ...structuredClone(item), type }, listingId: item.blackmarketListingId };
}

function unlockResource(player, type, id) {
  const item = ownedResource(player, type, id);
  if (item) delete item.blackmarketListingId;
}

function resourceBuyerBlock(player, type, item, price) {
  const legacyStarter = type === "employee" && isStarterWorkerId(item.id);
  if (!legacyStarter && (player?.workshop?.[resourceBucket(type)] || []).some((entry) => entry.id === item.id)) return "资源编号冲突，请重新选择商品。";
  if (type === "employee") {
    if ((player.workshop?.workers || []).length >= MAX_WORKERS) return "员工人数已经达到 8 人上限。";
    const blocked = employeeRecruitmentBlock(player);
    if (blocked) return blocked.message;
  }
  if (!Number.isSafeInteger(price) || price < 100 || player.cash < price) return "资金不足或报价无效。";
  return null;
}

function receiveResource(player, type, item, price, sellerId = "npc") {
  const { spendCash, randomUUID } = requireApi();
  const now = Date.now();
  if (type === "employee") {
    enterEmployeePayrollDay(player, { spendCash, now, reason: "continued" });
    const blocked = employeeRecruitmentBlock(player, now);
    if (blocked) throw new Error(blocked.message);
  }
  if (resourceBuyerBlock(player, type, item, price)) throw new Error("接收条件已变化，请重新确认。");
  const acquired = structuredClone(item);
  // Legacy starter IDs describe a local roster slot shared by every player.
  // Once transferred, this employee gets a persistent globally unique identity.
  if (type === "employee" && isStarterWorkerId(acquired.id)) acquired.id = randomUUID();
  if (!acquired.id || (player.workshop?.[resourceBucket(type)] || []).some((entry) => entry.id === acquired.id)) throw new Error("资源编号冲突，请重新选择商品。");
  if (!spendCash(player, price, `黑市${type === "employee" ? "转聘" : "购入"}：${item.name}`, { source: "blackmarket", itemId: acquired.id,
    financeCategory: type === "equipment" ? "equipment-purchase" : "operating" })) throw new Error("资金不足。");
  delete acquired.blackmarketListingId;
  delete acquired.workerId;
  delete acquired.busy;
  delete acquired.price;
  delete acquired.value;
  delete acquired._type;
  acquired.resourceOrigin = "blackmarket";
  acquired.acquisitionPrice = price;
  setAcquisitionCost(acquired, price);
  acquired.acquiredAt = now;
  acquired.tradeHistory = [...(acquired.tradeHistory || []), { sellerId, buyerId: player.id, price, at: now }].slice(-20);
  if (type === "employee") acquired.payrollAt = now;
  player.workshop ||= {};
  (player.workshop[resourceBucket(type)] ||= []).push(acquired);
  if (type === "employee") recordEmployeePayrollRoster(player, now);
  return acquired;
}

function releaseSoldResource(seller, type, row) {
  const item = ownedResource(seller, type, row.item.id);
  if (!item || item.blackmarketListingId !== row.id) throw new Error("挂牌资源已失效。");
  let payroll;
  if (type === "employee") payroll = settleEmployeePayroll(seller, {
    spendCash: requireApi().spendCash, closingWorkerId: item.id, closingReason: "transfer",
    closingWorkerOnly: !requireApi().isPlayerOnline?.(seller)
  });
  if (type === "employee" && isStarterWorkerId(item.id)) {
    seller.workshop.dismissedStarterIds = normalizeDismissedStarterIds([...(seller.workshop.dismissedStarterIds || []), item.id]);
  }
  seller.workshop[resourceBucket(type)] = seller.workshop[resourceBucket(type)].filter((entry) => entry.id !== item.id);
  for (const device of seller.workshop.devices || []) if (type === "employee" && device.workerId === item.id) delete device.workerId;
  if (type === "equipment") {
    for (const key of ["selectedDeviceId", "defaultDeviceId"]) if (seller.workshop[key] === item.id) delete seller.workshop[key];
  }
  return payroll;
}

function reconcileResourceListings(state) {
  const expected = new Map();
  let changed = false;
  for (const stall of state.blackStalls || []) {
    if (stall.npc || stall.type !== "goods") continue;
    const owner = state.players?.get?.(stall.ownerId);
    stall.items = (stall.items || []).filter((row) => {
      if (!isBlackmarketResource(row.type)) return true;
      const item = ownedResource(owner, row.type, row.item?.id);
      const key = `${stall.ownerId}:${row.type}:${row.item?.id}`;
      if (!item || expected.has(key)) { changed = true; return false; }
      expected.set(key, row.id);
      if (item.blackmarketListingId !== row.id) { item.blackmarketListingId = row.id; changed = true; }
      return true;
    });
  }
  for (const player of state.players?.values?.() || []) for (const type of ["employee", "equipment"]) {
    for (const item of player.workshop?.[resourceBucket(type)] || []) {
      if (item.blackmarketListingId && expected.get(`${player.id}:${type}:${item.id}`) !== item.blackmarketListingId) {
        delete item.blackmarketListingId;
        changed = true;
      }
    }
  }
  return changed;
}

  return {
    ownedResource,
    lockResource,
    unlockResource,
    resourceBuyerBlock,
    receiveResource,
    releaseSoldResource,
    reconcileResourceListings
  };
}
