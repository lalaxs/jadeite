// Disposable visual QA only: do not load or modify the user's world.
if (process.env.PORT !== "3017" || process.env.JADE_WORLD_PERSIST !== "0") throw new Error("auction QA requires PORT=3017 and JADE_WORLD_PERSIST=0");
const { __testHooks: H } = await import("../server.js");
const seeded = new Set();
setInterval(() => {
  let changed = false;
  for (const player of H.state.players.values()) {
    if (seeded.has(player.id)) continue;
    seeded.add(player.id);
    player.exp = 372;
    player.cash = 30_000;
    player.pendingAuctionSettle = null;
    player.pendingAuctionSettles = [];
    H.normalizePlayer(player);
    changed = true;
  }
  if (changed) H.broadcast();
}, 200).unref();
