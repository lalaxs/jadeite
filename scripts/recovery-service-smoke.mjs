import assert from "node:assert/strict";
import { createEconomyService } from "../server/services/economy-service.js";
import {
  RECOVERY_CASH_THRESHOLD,
  RECOVERY_CASH_TARGET,
  RECOVERY_COOLDOWN_MS,
  RECOVERY_DEBT_MULTIPLIER,
  RECOVERY_REPAY_RATE,
  createRecoveryService,
  normalizeRecovery
} from "../server/services/recovery-service.js";

const state = {
  listings: [],
  wants: [],
  blackStalls: [],
  blackServiceOrders: []
};
const economy = createEconomyService({ refreshPlayerReport() {} });
const service = createRecoveryService({
  getState: () => state,
  earnCash: economy.earnCash,
  refreshPlayerReport() {}
});

function emptyPlayer() {
  return {
    id: "recovery-player",
    cash: 250,
    rep: 0,
    stats: { orderCount: 1 },
    rough: [],
    materials: [],
    slices: [],
    bracelets: [],
    collection: [],
    externalMaterials: {},
    jobs: [],
    polishingJobs: [],
    payouts: [],
    blackPayouts: [],
    ledger: [],
    reports: []
  };
}

const now = 1_000_000;
const player = emptyPlayer();
assert.equal(service.recoverPlayerIfNeeded(player, now).applied, false, "loans require an explicit application");
const recovered = service.recoverPlayerIfNeeded(player, now, { requested: true });
assert.equal(recovered.applied, true);
assert.equal(RECOVERY_CASH_THRESHOLD, 2_000);
assert.equal(player.cash, RECOVERY_CASH_TARGET);
assert.equal(RECOVERY_CASH_TARGET, 12_000);
assert.equal(RECOVERY_COOLDOWN_MS, 30 * 60 * 1_000);
assert.equal(RECOVERY_DEBT_MULTIPLIER, 1.05);
assert.equal(player.recovery.debt, Math.round(recovered.grant * RECOVERY_DEBT_MULTIPLIER));
assert.equal(service.recoverPlayerIfNeeded(player, now + RECOVERY_COOLDOWN_MS - 1).applied, false);

player.cash = 0;
player.rough.push({ id: "still-owned" });
assert.equal(service.recoverPlayerIfNeeded(player, now + RECOVERY_COOLDOWN_MS).applied, false);
player.rough.length = 0;

const debtBefore = normalizeRecovery(player).debt;
const cashBefore = player.cash;
economy.earnCash(player, 1_000, "订单收入", { source: "order" });
assert.equal(RECOVERY_REPAY_RATE, 0.1);
assert.equal(player.cash, cashBefore + 1000, "zero-cash recovery preserves the next working-capital cycle");
assert.equal(player.recovery.debt, debtBefore);
player.cash = 5000;
economy.earnCash(player, 1000, "订单收入", { source: "order" });
assert.equal(player.cash, 5900);
assert.equal(player.recovery.debt, debtBefore - 100);
assert.equal(player.ledger[0].source, "recovery-repayment");

console.log("recovery-service-smoke: ok");
