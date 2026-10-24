import assert from "node:assert/strict";
import { createPlayerSessionService } from "../server/services/player-session-service.js";

let tokenIndex = 0;
const service = createPlayerSessionService({
  now: () => 123_456,
  makeToken: () => `test-resume-token-${String(++tokenIndex).padStart(24, "0")}`
});

const player = { id: "p-session" };
assert.equal(service.hasSession(player), false);

assert.equal(service.authenticateExistingPlayer(player, "").ok, false, "public ids do not authorize legacy claims");
const legacy = { resumeToken: service.issueSession(player) };
assert.equal(service.hasSession(player), true);
assert.equal(service.verifySession(player, legacy.resumeToken), true);
assert.equal(service.verifySession(player, "wrong-token"), false);
assert.equal(Object.hasOwn(player.auth, "resumeToken"), false, "raw token must never enter the save");

const restored = structuredClone(player);
assert.equal(service.authenticateExistingPlayer(restored, legacy.resumeToken).ok, true);
assert.equal(service.authenticateExistingPlayer(restored, "wrong-token").code, "INVALID_PLAYER_SESSION");

console.log("player-session-service-smoke: ok");


service.revokeAllSessions(restored);
assert.equal(service.authenticateExistingPlayer(restored, "").ok, false, "revoked guest cannot be claimed");
restored.auth.account = { username: "bound" };
assert.equal(service.authenticateExistingPlayer(restored, "").ok, false, "revoked account cannot be claimed");
const expired = structuredClone(player);
expired.auth.sessions[0].expiresAt = 1;
assert.equal(service.authenticateExistingPlayer(expired, legacy.resumeToken).ok, false);
