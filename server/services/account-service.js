import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const PASSWORD_BYTES = 64;
const SCRYPT_OPTIONS = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const DUMMY_PASSWORD_SALT = "00000000000000000000000000000000";

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function validateCredentials(username, password) {
  if (!/^[a-z0-9_]{4,24}$/.test(username)) {
    return { ok: false, code: "INVALID_USERNAME", message: "登录名需为 4–24 位英文字母、数字或下划线。" };
  }
  if (typeof password !== "string" || password.length < 10 || password.length > 128) {
    return { ok: false, code: "INVALID_PASSWORD", message: "密码长度需为 10–128 位。" };
  }
  return { ok: true };
}

async function derivePassword(password, salt) {
  const result = await scrypt(password, salt, PASSWORD_BYTES, SCRYPT_OPTIONS);
  return Buffer.from(result).toString("hex");
}

export function createAccountService({ getPlayers, findAccountPlayer = null, playerSessions, now = () => Date.now() }) {
  if (typeof getPlayers !== "function" || !playerSessions) {
    throw new Error("account-service: getPlayers and playerSessions required");
  }

  function accountPlayer(username) {
    const normalized = normalizeUsername(username);
    if (findAccountPlayer) return findAccountPlayer(normalized);
    return [...getPlayers()].find((player) => player?.auth?.account?.username === normalized) || null;
  }

  async function prepareBind({ username, password } = {}) {
    const normalized = normalizeUsername(username);
    const validation = validateCredentials(normalized, password);
    if (!validation.ok) return validation;
    const salt = randomBytes(16).toString("hex");
    return { ok: true, username: normalized, salt, passwordHash: await derivePassword(password, salt) };
  }

  function commitBind(player, prepared) {
    if (!player?.id) return { ok: false, code: "SESSION_REQUIRED", message: "请先进入游戏。" };
    if (!prepared.ok) return prepared;
    if (player.auth?.account?.username) return { ok: false, code: "ACCOUNT_EXISTS", message: "当前角色已经绑定登录账号。" };
    if (accountPlayer(prepared.username)) return { ok: false, code: "USERNAME_TAKEN", message: "该登录名已被使用。" };
    player.auth ||= {};
    player.auth.account = {
      username: prepared.username, passwordHash: prepared.passwordHash, passwordSalt: prepared.salt,
      passwordAlgorithm: "scrypt-v1", boundAt: now(), passwordChangedAt: now()
    };
    return { ok: true, username: prepared.username, playerId: player.id };
  }

  async function bindAccount(player, credentials) {
    return commitBind(player, await prepareBind(credentials));
  }

  function credentialSnapshot(username) {
    const player = accountPlayer(username);
    return player ? { playerId: player.id, account: structuredClone(player.auth.account) } : null;
  }

  async function verifyCredentials(username, password, snapshot) {
    const validation = validateCredentials(normalizeUsername(username), password);
    if (!validation.ok) return { ok: false, code: "INVALID_CREDENTIALS", message: "登录名或密码错误。" };
    const account = snapshot?.account;
    const candidate = Buffer.from(await derivePassword(password, account?.passwordSalt || DUMMY_PASSWORD_SALT), "hex");
    const expected = account?.passwordHash ? Buffer.from(account.passwordHash, "hex") : Buffer.alloc(PASSWORD_BYTES);
    if (!snapshot || !account?.passwordSalt || candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      return { ok: false, code: "INVALID_CREDENTIALS", message: "登录名或密码错误。" };
    }
    return { ok: true, ...snapshot };
  }

  function commitLogin(player, proof) {
    if (!proof.ok) return proof;
    const account = player?.auth?.account;
    if (!account || player.id !== proof.playerId || account.username !== proof.account.username
      || account.passwordHash !== proof.account.passwordHash || account.passwordSalt !== proof.account.passwordSalt) {
      return { ok: false, code: "INVALID_CREDENTIALS", message: "登录凭据已变更，请重试。" };
    }
    const resumeToken = playerSessions.issueSession(player, "account-login");
    account.lastLoginAt = now();
    return { ok: true, player, resumeToken };
  }

  async function authenticate(username, password) {
    const proof = await verifyCredentials(username, password, credentialSnapshot(username));
    return commitLogin(proof.ok ? accountPlayer(username) : null, proof);
  }

  function publicAccount(player) {
    const username = player?.auth?.account?.username;
    return username ? { bound: true, username } : { bound: false, username: null };
  }

  return { prepareBind, commitBind, credentialSnapshot, verifyCredentials, commitLogin, bindAccount, authenticate, publicAccount, accountPlayer };
}
