import assert from "node:assert/strict";
import { createAccountService } from "../server/services/account-service.js";
import { createPlayerSessionService } from "../server/services/player-session-service.js";

let tokenId = 0;
const playerSessions = createPlayerSessionService({
  now: () => 1000,
  makeToken: () => `account-session-token-${String(++tokenId).padStart(24, "0")}`
});
const players = [
  { id: "account-p1", name: "一号掌柜", auth: {} },
  { id: "account-p2", name: "二号掌柜", auth: {} }
];
const service = createAccountService({ getPlayers: () => players, playerSessions, now: () => 1000 });

const weak = await service.bindAccount(players[0], { username: "abc", password: "short" });
assert.equal(weak.ok, false);

const bound = await service.bindAccount(players[0], {
  username: "Jade_Player",
  password: "correct-horse-jade-battery"
});
assert.equal(bound.ok, true);
assert.equal(players[0].auth.account.username, "jade_player");
assert.equal(Object.hasOwn(players[0].auth.account, "password"), false);

const duplicate = await service.bindAccount(players[1], {
  username: "jade_player",
  password: "another-strong-password"
});
assert.equal(duplicate.code, "USERNAME_TAKEN");

const rejected = await service.authenticate("jade_player", "incorrect-password");
assert.equal(rejected.ok, false);
const login = await service.authenticate("jade_player", "correct-horse-jade-battery");
assert.equal(login.ok, true);
assert.equal(login.player.id, "account-p1");
assert.equal(playerSessions.verifySession(players[0], login.resumeToken), true);

console.log("account-service-smoke: bind + secure login + duplicate guard ok");

