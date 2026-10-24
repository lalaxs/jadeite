if (process.env.PORT !== '3021' || process.env.JADE_WORLD_PERSIST !== '0') throw Error('Disposable port 3021 only');
const { __testHooks: H } = await import('../../../server.js');
const seeded = new Set();
setInterval(() => {
  for (const player of H.state.players.values()) {
    if (seeded.has(player.id)) continue;
    seeded.add(player.id);
    player.cash = 10000;
    player.achievementPoints = 9999;
    player.offlineSummary = null;
    H.broadcast();
  }
}, 200).unref();
