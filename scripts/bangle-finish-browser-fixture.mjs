// Disposable QA world only; never open or write the user's saved world.
if (process.env.PORT !== "3014" || process.env.JADE_WORLD_PERSIST !== "0") throw new Error("bangle QA requires PORT=3014 and JADE_WORLD_PERSIST=0");
const { __testHooks: H } = await import("../server.js");
const { applyInlay, quoteFinishPlan } = await import("../server/systems/inlay-system.js");
const seeded = new Set();
setInterval(() => {
  for (const player of H.state.players.values()) {
    if (seeded.has(player.id)) continue;
    seeded.add(player.id);
    const rough = { ...player.rough[0], id: "bangle-browser-source", name: "飘花明料", type: "material", materialStage: "opened",
      qualityKey: "ice", quality: "冰种", color: "飘花绿", value: 30000, price: 30000, rep: 20, score: 4,
      visual: { seed: 32198, vein: "#247854", cotton: .65, crack: false } };
    const [blank] = H.extractProductsFromJob({ item: rough, options: { kits: [{ id: "qa-bangle", type: "bangle", openingTpl: "bangle", x: 50, y: 50, ringSize: 56, scale: 1, rot: 17 }] } });
    const plan = { process: "bangle", productType: "bangle", refinementId: "artisan", polishId: "soft" };
    const product = applyInlay(structuredClone(blank), plan, quoteFinishPlan(blank, plan));
    product.id = "qa-finished-bangle";
    product.materialStage = product.stage = "finished";
    product.craftScore = 90;
    product.craftGrade = "A";
    player.bracelets.push(blank, product);
    player.orders = [{ ...H.makeOrder(player), hard: { kind: "bracelet", kindLabel: "手镯", budgetUnlimited: true }, requirements: [{ type: "requirePolish", polishId: "soft", label: "抛光：柔光" }] }];
    for (const worker of player.workshop.workers) {
      worker.tier = 5;
      for (const skills of Object.values(worker.skills)) for (const skill of Object.values(skills)) skill.level = 8;
      worker.flaws = [];
    }
    player.externalMaterials = {};
    H.broadcast();
    console.log("bangle visual QA samples ready");
  }
  for (const player of H.state.players.values()) for (const job of player.jobs || []) job.readyAt = Math.min(job.readyAt, Date.now() - 1);
}, 700).unref();
