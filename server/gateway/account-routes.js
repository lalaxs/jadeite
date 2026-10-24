import * as cookie from "cookie";
import { rateLimit, MemoryStore } from "express-rate-limit";
import { originAllowed } from "../config/runtime-config.js";

export const ACCOUNT_COOKIE_NAME = "jade_session";
const ACCOUNT_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function encodeAccountSession(playerId, resumeToken) {
  return Buffer.from(JSON.stringify({ playerId, resumeToken }), "utf8").toString("base64url");
}

export function decodeAccountSession(value) {
  try {
    const parsed = JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
    if (!parsed?.playerId || !parsed?.resumeToken) return null;
    return { playerId: String(parsed.playerId), resumeToken: String(parsed.resumeToken) };
  } catch (_) {
    return null;
  }
}

export function accountSessionFromCookie(header) {
  const cookies = cookie.parseCookie(String(header || ""));
  return decodeAccountSession(cookies[ACCOUNT_COOKIE_NAME]);
}

function setSessionCookie(res, config, session) {
  res.setHeader("Set-Cookie", cookie.stringifySetCookie({
      name: ACCOUNT_COOKIE_NAME,
      value: encodeAccountSession(session.playerId, session.resumeToken),
      httpOnly: true,
      secure: config.isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: ACCOUNT_COOKIE_MAX_AGE_SECONDS
    }));
}

function clearSessionCookie(res, config) {
  res.setHeader("Set-Cookie", cookie.stringifySetCookie({
    name: ACCOUNT_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 0
  }));
}

export function installAccountRoutes({
  app,
  config,
  world,
  playerSessions,
  accountService,
  durableMutations,
  io,
  logger = console
}) {
  if (!app) return;
  const loginStore = new MemoryStore();
  const loginLimiter = rateLimit({
    store: loginStore,
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({
      ok: false,
      code: "LOGIN_RATE_LIMITED",
      message: "登录尝试过于频繁，请稍后再试。"
    })
  });

  function suppliedSession(req) {
    return accountSessionFromCookie(req.headers.cookie) || (
      req.body?.playerId && req.body?.resumeToken
        ? { playerId: String(req.body.playerId), resumeToken: String(req.body.resumeToken) }
        : null
    );
  }

  function authenticated(req) {
    const session = suppliedSession(req);
    const player = session ? world.getPlayer(session.playerId) : null;
    return player && playerSessions.verifySession(player, session.resumeToken)
      ? { player, session }
      : null;
  }

  async function durable(label, operation) {
    return durableMutations ? durableMutations.run(label, operation) : operation();
  }

  app.use("/api/account", (req, res, next) => {
    const unsafeMethod = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (unsafeMethod && !originAllowed(config, req.headers.origin) && config.isProduction) {
      return res.status(403).json({ ok: false, code: "ORIGIN_DENIED", message: "请求来源无效。" });
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  const read = (operation) => durableMutations ? durableMutations.read(operation) : Promise.resolve(operation());
  const sessionError = { ok: false, code: "SESSION_REQUIRED", message: "身份已失效。" };
  function disconnectRevoked(playerId, sessionId = null) {
    const effect = () => {
      for (const socket of io?.sockets?.sockets?.values?.() || []) {
        if (world.playerIdForSocket(socket.id) === playerId && (!sessionId || socket.data?.jadeSessionId === sessionId)) socket.disconnect(true);
      }
    };
    if (!durableMutations?.deferEffect(effect)) effect();
  }

  app.get("/api/account/session", async (req, res) => {
    try {
      const result = await read(() => {
        const auth = authenticated(req);
        return auth ? { ok: true, player: { id: auth.player.id, name: auth.player.name }, account: accountService.publicAccount(auth.player) } : sessionError;
      });
      return res.status(result.ok ? 200 : 401).json(result);
    } catch (_) { return res.status(503).json({ ok: false, code: "SERVER_BUSY" }); }
  });

  app.post("/api/account/bind", loginLimiter, async (req, res) => {
    try {
      if (!await read(() => Boolean(authenticated(req)))) return res.status(401).json(sessionError);
      const prepared = await accountService.prepareBind(req.body);
      const result = await durable("account:bind", () => {
        const auth = authenticated(req);
        if (!auth) return sessionError;
        const bound = accountService.commitBind(auth.player, prepared);
        return bound.ok ? { ...bound, session: auth.session, account: accountService.publicAccount(auth.player) } : bound;
      });
      if (!result.ok) return res.status(result.code === "SESSION_REQUIRED" ? 401 : 400).json(result);
      setSessionCookie(res, config, result.session);
      return res.status(201).json({ ok: true, account: result.account });
    } catch (error) {
      logger.error?.({ error: error.message }, "account bind failed");
      return res.status(503).json({ ok: false, code: "PERSISTENCE_FAILED", message: "账号暂时无法绑定。" });
    }
  });

  app.post("/api/account/login", loginLimiter, async (req, res) => {
    try {
      const snapshot = await read(() => accountService.credentialSnapshot(req.body?.username));
      const proof = await accountService.verifyCredentials(req.body?.username, req.body?.password, snapshot);
      const result = await durable("account:login", () => {
        const login = accountService.commitLogin(proof.ok ? world.getPlayer(proof.playerId) : null, proof);
        return login.ok ? { ok: true, resumeToken: login.resumeToken,
          player: { id: login.player.id, name: login.player.name }, account: accountService.publicAccount(login.player) } : login;
      });
      if (!result.ok) return res.status(401).json(result);
      setSessionCookie(res, config, { playerId: result.player.id, resumeToken: result.resumeToken });
      return res.json({ ok: true, player: { id: result.player.id, name: result.player.name }, account: result.account });
    } catch (error) {
      logger.error?.({ error: error.message }, "account login failed");
      return res.status(503).json({ ok: false, code: "LOGIN_UNAVAILABLE", message: "暂时无法登录。" });
    }
  });

  app.post("/api/account/logout", async (req, res) => {
    try {
      await durable("account:logout", () => {
        const auth = authenticated(req);
        if (!auth) return;
        const sessionId = playerSessions.sessionIdFor(auth.player, auth.session.resumeToken);
        playerSessions.revokeSession(auth.player, auth.session.resumeToken);
        disconnectRevoked(auth.player.id, sessionId);
      });
      clearSessionCookie(res, config);
      return res.json({ ok: true });
    } catch (error) {
      logger.error?.({ error: error.message }, "account logout failed");
      return res.status(503).json({ ok: false, code: "PERSISTENCE_FAILED" });
    }
  });

  app.post("/api/account/logout-all", async (req, res) => {
    try {
      const result = await durable("account:logout-all", () => {
        const auth = authenticated(req);
        if (!auth) return sessionError;
        playerSessions.revokeAllSessions(auth.player);
        disconnectRevoked(auth.player.id);
        return { ok: true };
      });
      if (!result.ok) return res.status(401).json(result);
      clearSessionCookie(res, config);
      return res.json({ ok: true });
    } catch (error) {
      logger.error?.({ error: error.message }, "account logout-all failed");
      return res.status(503).json({ ok: false, code: "PERSISTENCE_FAILED" });
    }
  });
  return () => loginStore.shutdown();
}
