/**
 * Guest player sessions.
 *
 * The browser keeps the opaque resume token; the world save only stores its
 * SHA-256 digest. An existing public player id never grants access. Older hashed tokens
 * can still be verified and rotated.
 */
import {
  createHash,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

export const PLAYER_SESSION_TOKEN_BYTES = 32;
export const PLAYER_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const PLAYER_SESSION_LIMIT = 8;

function hashResumeToken(token) {
  return createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function safeHashEqual(left, right) {
  const a = Buffer.from(String(left || ""), "hex");
  const b = Buffer.from(String(right || ""), "hex");
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function createPlayerSessionService(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const makeToken = typeof options.makeToken === "function"
    ? options.makeToken
    : () => randomBytes(PLAYER_SESSION_TOKEN_BYTES).toString("base64url");

  function normalizedSessions(player) {
    const current = Array.isArray(player?.auth?.sessions) ? player.auth.sessions : [];
    const at = now();
    return current
      .filter((entry) => entry?.tokenHash && Number(entry.expiresAt) > at)
      .slice(-PLAYER_SESSION_LIMIT);
  }

  function hasSession(player) {
    return Boolean(player?.auth?.resumeTokenHash) || normalizedSessions(player).length > 0;
  }

  function issueSession(player, reason = "new") {
    if (!player?.id) throw new Error("player-session: player.id required");
    const resumeToken = String(makeToken() || "");
    if (resumeToken.length < 24) {
      throw new Error("player-session: generated token is too short");
    }
    const issuedAt = now();
    const auth = player.auth && typeof player.auth === "object" ? player.auth : {};
    const sessions = normalizedSessions(player);
    sessions.push({
      id: createHash("sha256").update(`${player.id}:${resumeToken}`, "utf8").digest("hex").slice(0, 24),
      tokenHash: hashResumeToken(resumeToken),
      issuedAt,
      lastUsedAt: issuedAt,
      expiresAt: issuedAt + PLAYER_SESSION_MAX_AGE_MS,
      reason: String(reason || "new")
    });
    player.auth = {
      ...auth,
      sessions: sessions.slice(-PLAYER_SESSION_LIMIT),
      issuedAt: Number(auth.issuedAt) || issuedAt,
      rotatedAt: issuedAt,
      reason: String(reason || "new")
    };
    delete player.auth.resumeTokenHash;
    return resumeToken;
  }

  function verifySession(player, resumeToken) {
    if (!hasSession(player)) return false;
    const candidateHash = hashResumeToken(resumeToken);
    if (player.auth.resumeTokenHash && safeHashEqual(player.auth.resumeTokenHash, candidateHash)) return true;
    const session = normalizedSessions(player).find((entry) => safeHashEqual(entry.tokenHash, candidateHash));
    if (!session) return false;
    return true;
  }

  function revokeSession(player, resumeToken) {
    if (!player?.auth) return false;
    const candidateHash = hashResumeToken(resumeToken);
    const before = normalizedSessions(player);
    const after = before.filter((entry) => !safeHashEqual(entry.tokenHash, candidateHash));
    const removedLegacy = player.auth.resumeTokenHash
      ? safeHashEqual(player.auth.resumeTokenHash, candidateHash)
      : false;
    player.auth.sessions = after;
    if (removedLegacy) delete player.auth.resumeTokenHash;
    return after.length !== before.length || removedLegacy;
  }

  function revokeAllSessions(player) {
    if (!player?.auth) return 0;
    const count = normalizedSessions(player).length + (player.auth.resumeTokenHash ? 1 : 0);
    player.auth.sessions = [];
    delete player.auth.resumeTokenHash;
    return count;
  }

  function authenticateExistingPlayer(player, resumeToken) {
    if (!player) return { ok: false, code: "PLAYER_NOT_FOUND" };
    if (!verifySession(player, resumeToken)) {
      return {
        ok: false,
        code: "INVALID_PLAYER_SESSION",
        message: "本地身份凭据已失效，请重新进入游戏。"
      };
    }
    if (player.auth.resumeTokenHash) {
      delete player.auth.resumeTokenHash;
      const migratedToken = issueSession(player, "legacy-token-rotation");
      return { ok: true, migratedLegacySession: true, resumeToken: migratedToken };
    }
    return { ok: true, migratedLegacySession: false, resumeToken: null };
  }

  function sessionIdFor(player, token) {
    const hash = hashResumeToken(token);
    if (player?.auth?.resumeTokenHash && safeHashEqual(player.auth.resumeTokenHash, hash)) return `legacy:${hash}`;
    return normalizedSessions(player).find((entry) => safeHashEqual(entry.tokenHash, hash))?.id || null;
  }

  function isSessionActive(player, sessionId) {
    if (!sessionId) return false;
    if (String(sessionId).startsWith("legacy:")) return Boolean(player?.auth?.resumeTokenHash)
      && safeHashEqual(player.auth.resumeTokenHash, String(sessionId).slice(7));
    return normalizedSessions(player).some((entry) => entry.id === sessionId);
  }

  return {
    sessionIdFor,
    isSessionActive,
    hasSession,
    issueSession,
    verifySession,
    revokeSession,
    revokeAllSessions,
    authenticateExistingPlayer
  };
}
