// PORT=3013 JADE_WORLD_PERSIST=0 node --import ./scripts/workshop-delivery-browser-fixture.mjs server.js
if (process.env.PORT !== "3013" || process.env.JADE_WORLD_PERSIST !== "0") {
  throw new Error("workshop delivery visual QA requires disposable PORT=3013 and JADE_WORLD_PERSIST=0");
}
const { __testHooks: H } = await import("../server.js");
const { seedWorkshopDeliveryFixtures } = await import("./workshop-delivery-fixtures.mjs");
const seeded = new Set();
setInterval(() => {
  for (const player of H.state.players.values()) {
    if (seeded.has(player.id)) continue;
    seeded.add(player.id);
    seedWorkshopDeliveryFixtures(H, player);
    H.broadcast();
  }
}, 500).unref();
