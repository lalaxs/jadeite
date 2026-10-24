import { equipmentSaleBlockReason } from "../../shared/domain/economy/equipment-trading.js";
import { setAcquisitionCost } from "../../shared/domain/economy/item-cost.js";

export function takeMarketEquipment(player, deviceId, state) {
  const devices = player?.workshop?.devices || [];
  const device = devices.find((row) => row.id === deviceId);
  const reason = equipmentSaleBlockReason(player, device, state);
  if (reason) return { ok: false, code: "EQUIPMENT_UNAVAILABLE", message: reason };
  devices.splice(devices.indexOf(device), 1);
  device.workerId = null;
  if (player.workshop.selectedDeviceId === device.id) player.workshop.selectedDeviceId = devices[0]?.id || null;
  return { ok: true, item: device };
}

export function receiveMarketEquipment(player, device, acquisitionCost, sellerId) {
  if (!device?.id || player?.workshop?.devices?.some((row) => row.id === device.id)) throw new Error("market-equipment: duplicate or missing device id");
  player.workshop ||= {};
  player.workshop.devices ||= [];
  const received = structuredClone({ ...device, workerId: null });
  if (acquisitionCost != null) {
    received.resourceOrigin = "market";
    received.acquisitionPrice = acquisitionCost;
    received.acquiredAt = Date.now();
    received.tradeHistory = [...(received.tradeHistory || []), { sellerId, buyerId: player.id, price: acquisitionCost, at: received.acquiredAt }].slice(-20);
  }
  if (acquisitionCost != null) setAcquisitionCost(received, acquisitionCost);
  player.workshop.devices.push(received);
  player.workshop.selectedDeviceId ||= received.id;
  return received;
}
