// Isolated visual QA only:
// PORT=3011 JADE_WORLD_PERSIST=0 node --import ./scripts/jade-piece-browser-fixture.mjs server.js
if (process.env.PORT !== "3011" || process.env.JADE_WORLD_PERSIST !== "0") {
  throw new Error("jade-piece-browser-fixture requires PORT=3011 and JADE_WORLD_PERSIST=0");
}
const { __testHooks: H } = await import("../server.js");
const seeded = new Set();
setInterval(() => {
  for (const player of H.state.players.values()) {
    if (seeded.has(player.id)) continue;
    seeded.add(player.id);
    const rough = {
      ...player.rough[0], id: "visual-qa-source", name: "飘花明料 · 对照样本", type: "material",
      materialStage: "opened", stage: "material", qualityKey: "ice", quality: "冰种", color: "飘花绿",
      score: 4, mass: 1.5, price: 36000, value: 36000, rep: 20,
      visual: { seed: 32198, cotton: .65, crack: true, translucency: .55, vein: "#247854" }
    };
    const kits = [
      { id: "qa-bangle", type: "bracelet", openingTpl: "bangle", x: 50, y: 50, rot: 0, ringSize: 56, scale: 1 },
      { id: "qa-leaf", type: "leafPendant", openingTpl: "leaf", x: 32, y: 46, rot: 27, size: "M", scale: 1 },
      { id: "qa-egg", type: "cabochon", openingTpl: "egg", x: 69, y: 47, rot: 122, size: "L", scale: 1.25 },
      { id: "qa-ping", type: "peacePendant", openingTpl: "ping", x: 47, y: 72, rot: 16, size: "S", scale: .75 },
      { id: "qa-plaque", type: "plaque", openingTpl: "rect", x: 50, y: 50, rot: 0, size: "L", scale: 1.25 },
      { id: "qa-drop", type: "dropPendant", openingTpl: "drop", x: 50, y: 50, rot: 0, size: "L", scale: 1.25 },
      { id: "qa-buddha", type: "buddhaPendant", openingTpl: "buddha", x: 50, y: 50, rot: 0, size: "L", scale: 1.25 }
    ];
    const products = H.extractProductsFromJob({ item: rough, options: { kits } });
    player.bracelets.push(...products);
    player.externalMaterials = { goldPure: 100, gold18k: 100, platinum: 100, silver925: 100, diamond: 500, ruby: 500, sapphire: 500 };
    H.broadcast();
    console.log(`jade-piece visual fixtures ready (${products.length} pieces)`);
  }
  // Speed up only jobs in this disposable world. Successful jobs still pass
  // through the production completion code, rather than a UI mock.
  for (const player of H.state.players.values()) {
    for (const job of player.jobs || []) job.readyAt = Math.min(job.readyAt, Date.now() - 1);
  }
}, 700).unref();
