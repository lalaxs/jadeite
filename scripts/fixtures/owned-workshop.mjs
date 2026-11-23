// Explicit mature-workshop fixture. New accounts intentionally own no machines
// or paid staff; tests of unrelated craft workflows opt into these assets.
import { createDeviceInstance } from "../../server/systems/equipment-system.js";
import { WORKSHOP_WORKER_DEFS } from "../../server/services/workshop-roster.js";
import { normalizeBusiness } from "../../shared/domain/progression/business-growth.js";
import { createRoughPoolService } from "../../server/services/rough-pool-service.js";
import { money, clamp, pick } from "../../server/services/economy-service.js";

export function installOwnedWorkshopFixture(player) {
  if (player.business && !player.business.choice) player.cash = 12_000;
  player.assets ||= {};
  player.assets.workshopOwned = true;
  delete player.business;
  normalizeBusiness(player);
  if (!player.rough?.length) {
    const { makeStarterRoughs } = createRoughPoolService({ money, clamp, pick, getState: () => ({ roughPool: [] }) });
    player.rough = makeStarterRoughs(player.id);
  }
  player.workshop ||= {};
  player.workshop.devices = [
    createDeviceInstance("opening", "cuijie-opening-1", `${player.id}-opening`),
    createDeviceInstance("carving", "gongzao-carving-1", `${player.id}-carving`),
    createDeviceInstance("finishing", "zhuoguang-finishing-1", `${player.id}-finishing`)
  ].map((device) => ({ ...device, resourceOrigin: "fixture" }));
  player.workshop.workers = structuredClone(WORKSHOP_WORKER_DEFS);
  player.workshop.selectedDeviceId = player.workshop.devices[0].id;
  return player;
}
