import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  pick,
  clamp,
  money,
  uiMoney,
  pendingPayoutTotal,
  createEconomyService
} from "../server/services/economy-service.js";
import { __testHooks as H } from "../server.js";

assert.equal(money(-5), 0);
assert.equal(money(12.6), 13);
assert.equal(clamp(5, 0, 3), 3);
assert.equal(uiMoney(1000), "¥1,000");
assert.ok(pick(["a", "b"]));
assert.deepEqual(pendingPayoutTotal([{ amount: "12" }, { amount: 7.6 }]), {
  ok: true,
  total: 20
});
assert.deepEqual(pendingPayoutTotal([]), { ok: false, code: "EMPTY_PAYOUT", total: 0 });
assert.equal(pendingPayoutTotal([{ amount: Infinity }]).code, "INVALID_PAYOUT");
assert.equal(pendingPayoutTotal([{ amount: -1 }]).code, "INVALID_PAYOUT");
const reports = [];
const { recordLedger, spendCash, earnCash, holdDeposit, releaseDeposit } = createEconomyService({
  refreshPlayerReport: (player) => reports.push(player.id)
});

const player = { id: "p1", cash: 1000, rep: 0, ledger: [] };

assert.equal(spendCash(player, 200, "测试支出", { source: "test" }), true);
assert.equal(player.cash, 800);
assert.equal(player.ledger[0].kind, "expense");
assert.equal(spendCash(player, 9999, "不足"), false);
assert.equal(player.cash, 800);

assert.equal(earnCash(player, 50, "测试收入", { source: "test" }), 50);
assert.equal(player.cash, 850);

assert.equal(holdDeposit(player, 100, "保证金"), true);
assert.equal(player.cash, 750);
assert.equal(releaseDeposit(player, 100, "退还保证金"), 100);
assert.equal(player.cash, 850);

assert.ok(reports.length >= 4);
assert.equal(typeof recordLedger, "function");

assert.equal(typeof H.spendCash, "function");
assert.equal(typeof H.earnCash, "function");
assert.equal(typeof H.recordLedger, "function");
assert.equal(typeof H.holdDeposit, "function");
assert.equal(typeof H.releaseDeposit, "function");
assert.equal(typeof money, "function");
assert.equal(typeof uiMoney, "function");

const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
assert.match(bootSource, /economy-service\.js/);
assert.match(bootSource, /createEconomyService/);
assert.doesNotMatch(serverSource, /function spendCash\(/);
assert.doesNotMatch(serverSource, /function recordLedger\(/);
assert.doesNotMatch(serverSource, /function earnCash\(/);
assert.doesNotMatch(serverSource, /function holdDeposit\(/);
assert.doesNotMatch(serverSource, /function money\(/);

const serviceSource = readFileSync("server/services/economy-service.js", "utf8");
assert.match(serviceSource, /export function createEconomyService/);
assert.match(serviceSource, /function spendCash/);
assert.match(serviceSource, /function recordLedger/);

console.log("economy-service-smoke: ok");
process.exit(0);
