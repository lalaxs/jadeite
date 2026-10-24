import { timingSafeEqual } from "node:crypto";

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function installAdminRoutes({
  app,
  config,
  world,
  persister,
  saveCheckpoint = null,
  durableMutations,
  health,
  io,
  logger = console
}) {
  if (!app) return;

  app.use("/api/admin", (req, res, next) => {
    const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!config.adminToken || !safeEqual(supplied, config.adminToken)) {
      return res.status(404).end();
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  async function durable(action, operation, metadata = {}) {
    if (!durableMutations) return operation();
    return durableMutations.run(action, operation, {
      actorType: "admin",
      actorId: "admin-api",
      metadata
    });
  }

  app.get("/api/admin/status", async (_req, res) => {
    const read = durableMutations ? (fn) => durableMutations.read(fn) : async (fn) => fn();
    try { await read(() => {
    const state = world.raw;
    res.json({
      ok: true,
      health: health?.snapshot?.() || null,
      counts: {
        players: state.players.size,
        onlinePlayers: new Set(state.sockets.values()).size,
        listings: state.listings.length,
        wants: state.wants.length,
        blackStalls: state.blackStalls.length
      },
      persistence: persister?.driver || (persister ? "file" : "disabled")
    });
    }); } catch (_) { res.status(503).json({ ok: false, code: "SERVER_BUSY" }); }
  });

  app.get("/api/admin/checkpoints", async (_req, res) => {
    const rows = typeof persister?.checkpoints === "function" ? await persister.checkpoints() : [];
    res.json({ ok: true, checkpoints: rows });
  });

  app.post("/api/admin/flush", async (_req, res) => {
    try {
      const save = saveCheckpoint || (() => typeof persister?.flush === "function" ? persister.flush() : persister?.flushSync?.());
      if (durableMutations) await durableMutations.checkpoint(save);
      else await save();
      res.json({ ok: true, savedAt: Date.now() });
    } catch (error) {
      logger.error?.({ error: error.message }, "admin flush failed");
      res.status(503).json({ ok: false, code: "PERSISTENCE_FAILED" });
    }
  });

  app.post("/api/admin/players/:playerId/moderation", async (req, res) => {
    const playerId = String(req.params.playerId);
    const action = String(req.body?.action || "");
    const durationMs = Math.max(60_000, Math.min(30 * 24 * 60 * 60 * 1000, Number(req.body?.durationMs) || 0));
    const reason = String(req.body?.reason || "违反社区规则").trim().slice(0, 200);
    if (!["ban", "unban", "mute", "unmute"].includes(action)) {
      return res.status(400).json({ ok: false, code: "INVALID_ACTION" });
    }
    try {
      const result = await durable(`admin:moderation:${action}`, () => {
        const player = world.getPlayer(playerId);
        if (!player) return { ok: false, code: "PLAYER_NOT_FOUND" };
        player.moderation ||= {};
        if (action === "ban") {
          player.moderation.bannedUntil = Date.now() + durationMs;
          player.moderation.banReason = reason;
        } else if (action === "unban") {
          player.moderation.bannedUntil = 0;
          player.moderation.banReason = null;
        } else if (action === "mute") {
          player.moderation.mutedUntil = Date.now() + durationMs;
          player.moderation.muteReason = reason;
        } else {
          player.moderation.mutedUntil = 0;
          player.moderation.muteReason = null;
        }
        if (action === "ban") {
          const disconnect = () => io.in?.(`player:${playerId}`).disconnectSockets?.(true);
          if (!durableMutations?.deferEffect(disconnect)) disconnect();
        }
        return { ok: true, moderation: structuredClone(player.moderation) };
      }, { playerId, reason, durationMs });
      return res.status(result.ok ? 200 : 404).json(result);
    } catch (error) {
      logger.error?.({ error: error.message, playerId, action }, "admin moderation failed");
      return res.status(503).json({ ok: false, code: "PERSISTENCE_FAILED" });
    }
  });
}

