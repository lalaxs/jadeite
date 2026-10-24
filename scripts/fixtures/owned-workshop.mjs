// Explicit mature-workshop fixture. New accounts intentionally own no machines
// or paid staff; tests of unrelated craft workflows opt into these assets.
import { createDeviceInstance } from "../../server/systems/equipment-system.js";
import { WORKSHOP_WORKER_DEFS } from "../../server/services/workshop-roster.js";

export function installOwnedWorkshopFixture(player) {
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
