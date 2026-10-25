import { inventoryEntries } from "../inventory-items.js";
// Device/worker lookup, reservations and processable items.
import { OWNER_OPERATOR_ID } from "../../../shared/domain/economy/public-workstations.js";

export function createWorkshopQueries({
  normalizePlayer,
  materialStageFor,
  normalizeWorkshop
}) {
function workshopDevicesForPlayer(player) {
  normalizeWorkshop(player);
  return player.workshop.devices;
}

function workshopDeviceForPlayer(player, deviceId) {
  const devs = workshopDevicesForPlayer(player);
  return devs.find((device) => device.id === deviceId) || devs.find((device) => device.stage === deviceId) || null;
}

function workshopWorkerForPlayer(player, workerId) {
  normalizeWorkshop(player);
  if (workerId === OWNER_OPERATOR_ID) return player.workshop.owner;
  return player.workshop.workers.find((worker) => worker.id === workerId) || null;
}

function legacyDeviceIdForStage(stage) {
  if (stage === "rough") return "opening";
  if (stage === "refine") return "carving";
  if (stage === "inlay") return "finishing";
  return stage;
}

function workshopJobsForDevice(player, deviceId) {
  normalizePlayer(player);
  const jobs = (player.jobs || []).filter((job) => (job.deviceId || legacyDeviceIdForStage(job.stage)) === deviceId);
  const commission = player.commissions?.active;
  if (commission?.deviceIds?.includes(deviceId)) jobs.push({
    id: commission.id, type: "commissionJob", deviceId, workerId: OWNER_OPERATOR_ID,
    startedAt: commission.startedAt, readyAt: commission.readyAt,
    item: { name: commission.name }, commission: true
  });
  return jobs;
}

function workshopProcessableItems(player, deviceId) {
  normalizePlayer(player);
  const device = workshopDeviceForPlayer(player, deviceId);
  if (!device) return [];
  const types = device.inputType === "rough" ? ["rough", "material", "slice"] : ["bracelet"];
  const bucket = inventoryEntries(player, types).map(({ item }) => item);
  return bucket.filter((item) => materialStageFor(item) === device.inputStage);
}

function playerOwnsWorkshop(player) {
  normalizePlayer(player);
  return Boolean(player.assets.workshopOwned);
}

function findWorkshopItem(player, device, itemId) {
  const types = device.inputType === "rough" ? ["rough", "material", "slice"] : ["bracelet"];
  const bucket = inventoryEntries(player, types).map(({ item }) => item);
  return bucket.find((item) => item.id === itemId) || null;
}

  return { workshopDevicesForPlayer, workshopDeviceForPlayer, workshopWorkerForPlayer, legacyDeviceIdForStage, workshopJobsForDevice, workshopProcessableItems, playerOwnsWorkshop, findWorkshopItem };
}
