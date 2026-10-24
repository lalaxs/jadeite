// Disposable browser QA world; never read/write the player's persisted world.
// PORT=3012 JADE_WORLD_PERSIST=0 node --import ./scripts/inlay-art-browser-fixture.mjs server.js
if (process.env.PORT !== "3012" || process.env.JADE_WORLD_PERSIST !== "0") throw new Error("inlay-art fixture requires PORT=3012 and JADE_WORLD_PERSIST=0");
const { __testHooks: H } = await import("../server.js");
const { canonicalizeFinishPlan, applyInlay, quoteFinishPlan } = await import("../server/systems/inlay-system.js");
const seeded = new Set();
setInterval(() => {
  for (const player of H.state.players.values()) {
    if (seeded.has(player.id)) continue;
    seeded.add(player.id);
    const rough = { ...player.rough[0], id: "painted-art-qa-source", type: "material", materialStage: "opened", stage: "material", name: "手绘配件验证料", qualityKey: "ice", quality: "冰种", color: "飘花绿", score: 4, rep: 20, mass: 1.5, price: 36000, value: 36000, visual: { seed: 32198, cotton: .65, crack: true, translucency: .55, vein: "#247854" } };
    const blanks = H.extractProductsFromJob({ item: rough, options: { kits: [
      { id: "art-egg", type: "cabochon", openingTpl: "egg", x: 32, y: 46, rot: 27, size: "M", scale: 1 },
      { id: "art-buddha", type: "buddhaPendant", openingTpl: "buddha", x: 60, y: 45, rot: 0, size: "M", scale: 1 },
      { id: "art-leaf", type: "leafPendant", openingTpl: "leaf", x: 47, y: 72, rot: 16, size: "S", scale: .75 }
    ] } });
    const samples = [
      [0, "金托红宝石戒指", "ring", "claw", "gold18k", "ruby"],
      [0, "铂金方蓝宝石戒指", "ring", "invisible", "platinum", "sapphire"],
      [0, "足金包镶吊坠", "pendant", "bezel", "goldPure", null],
      [1, "铂金微镶佛公", "pendant", "micro", "platinum", "diamond"],
      [2, "随形微镶叶子", "pendant", "micro", "gold18k", "ruby"],
      [1, "编绳佛公", "pendant", "cord", null, null]
    ];
    for (const [index, name, productType, settingId, metalId, gemId] of samples) {
      const blank = structuredClone(blanks[index]);
      if (!blank) throw new Error(`QA extraction missing ${index}`);
      blank.id = `art-qa-${samples.findIndex((s) => s[1] === name)}`;
      const result = canonicalizeFinishPlan(blank, { productType, settingId, metalId, gemId, polishId: "soft", backingId: productType === "ring" ? "open" : null });
      if (!result.ok) throw new Error(result.message);
      const product = applyInlay(blank, result.plan, quoteFinishPlan(blank, result.plan));
      product.name = name;
      product.materialStage = "finished";
      product.stage = "finished";
      player.bracelets.push(product);
    }
    player.bracelets.push(...blanks);
    player.externalMaterials = { goldPure: 100, gold18k: 100, platinum: 100, silver925: 100, diamond: 500, ruby: 500, sapphire: 500 };
    H.broadcast();
    console.log("hand-painted inlay QA samples ready");
  }
}, 700).unref();
