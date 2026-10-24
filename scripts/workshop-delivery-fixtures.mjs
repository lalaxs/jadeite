import assert from "node:assert/strict";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";

/** Real production jobs for isolated socket and visual QA worlds. */
export function seedWorkshopDeliveryFixtures(H, player) {
  installOwnedWorkshopFixture(player);
  const devices = H.workshopDevicesForPlayer(player);
  const device = (stage) => devices.find((row) => row.stage === stage);
  const complete = (started) => {
    assert.equal(started.ok, true, started.message);
    started.job.startedAt = Date.now() - 2;
    started.job.readyAt = Date.now() - 1;
    const random = Math.random;
    try { Math.random = () => .99; H.processProductionJobs(Date.now(), { onlineOnly: false, broadcast: false }); }
    finally { Math.random = random; }
  };
  complete(H.startWorkshopJobForPlayer(player, device("opening").id, { itemId: player.rough[0].id }));
  const material = {
    ...player.rough.shift(), id: `${player.id}-delivery-source`, name: "冰种飘花明料", type: "material",
    materialStage: "opened", stage: "material", qualityKey: "ice", quality: "冰种", color: "飘花绿",
    score: 4, mass: 1.5, price: 36000, value: 36000, rep: 20,
    visual: { seed: 32198, cotton: .45, crack: false, translucency: .55, vein: "#247854" }
  };
  player.materials.push(material);
  complete(H.startWorkshopJobForPlayer(player, device("carving").id, { itemId: material.id, kits: [
    { type: "leafPendant", x: 30, y: 40, rot: 27, size: "M" },
    { type: "cabochon", x: 70, y: 42, rot: 0, size: "M" },
    { type: "peacePendant", x: 50, y: 73, rot: 15, size: "S" }
  ] }));
  const [blank] = H.extractProductsFromJob({ item: { ...material, id: `${material.id}-finish` }, options: { kits: [{ type: "cabochon", x: 50, y: 50, size: "M" }] } });
  player.bracelets.push(blank);
  player.externalMaterials = { platinum: 100, diamond: 500 };
  complete(H.startWorkshopJobForPlayer(player, device("finishing").id, { itemId: blank.id, finishPlan: {
    productType: "pendant", settingId: "micro", metalId: "platinum", gemId: "diamond", gemCount: 1, polishId: "soft", backingId: null
  } }));
  return player.workshopDeliveries;
}
