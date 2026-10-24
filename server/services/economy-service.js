/**
 * Economy helpers — money utils + cash/ledger/deposit mutations.
 * Pure money/clamp/pick/uiMoney can be imported early; ledger APIs need createEconomyService.
 */
import { ledgerEntry, repFromCashFlow } from "../../shared/domain/economy/jade-loop.js";
import {
  CASH_LEDGER_LIMIT,
  applyRepDelta,
  trimCashLedger
} from "../../shared/domain/economy/metric-history.js";
import { normalizeRecovery, recoveryRepaymentFor } from "./recovery-service.js";
import { repayEmployeePayrollFromIncome } from "../systems/employee-payroll.js";
import { recordFinanceCash } from "../../shared/domain/economy/finance-book.js";
import { bookRewardCash } from "../../shared/domain/economy/new-player-economy.js";
import { availableDebtRepayment } from "../../shared/domain/economy/operating-reserve.js";

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function money(value) {
  const amount = Number(value);
  return Math.max(0, Math.round(Number.isFinite(amount) ? amount : 0));
}

export function uiMoney(value) {
  return `¥${money(value).toLocaleString("zh-CN")}`;
}

/**
 * Validate a batch of deferred seller payouts before consuming the queue.
 * Early saves may contain numeric strings, so those remain compatible, but a
 * malformed row must never be silently converted to a zero-value claim.
 */
export function pendingPayoutTotal(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, code: "EMPTY_PAYOUT", total: 0 };
  }
  let total = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const raw = rows[index]?.amount;
    if (
      raw == null
      || (typeof raw !== "number" && typeof raw !== "string")
      || (typeof raw === "string" && !raw.trim())
    ) {
      return { ok: false, code: "INVALID_PAYOUT", total: 0, index };
    }
    const numeric = Number(raw);
    const amount = Math.round(numeric);
    if (!Number.isFinite(numeric) || numeric < 0 || !Number.isSafeInteger(amount)) {
      return { ok: false, code: "INVALID_PAYOUT", total: 0, index };
    }
    if (!Number.isSafeInteger(total + amount)) {
      return { ok: false, code: "INVALID_PAYOUT", total: 0, index };
    }
    total += amount;
  }
  return { ok: true, total };
}

export function createEconomyService(deps) {
  const { refreshPlayerReport } = deps;
  if (typeof refreshPlayerReport !== "function") {
    throw new Error("economy-service: refreshPlayerReport is required");
  }

  function recordLedger(player, kind, amount, note, meta = {}) {
    player.ledger ||= [];
    const cost = money(amount);
    const before = meta.before != null
      ? money(meta.before)
      : money(player.cash) + (kind === "expense" ? cost : -cost);
    const after = meta.after != null ? money(meta.after) : money(player.cash);
    const entry = ledgerEntry(kind, amount, note, { ...meta, before, after });
    entry.before = before;
    entry.after = after;
    player.ledger.unshift(entry);
    recordFinanceCash(player, kind, amount, { ...meta, id: entry.id, at: entry.at });
    if (player.onboarding?.firstSaleAt && !player.onboarding.completedAt
      && kind === "expense" && ["market", "blackmarket", "auction", "equipment"].includes(entry.source)) {
      player.onboarding.completedAt = entry.at;
    }
    trimCashLedger(player, CASH_LEDGER_LIMIT);
    if (meta.repEligible !== false) {
      const repSource = entry.kind === "expense" ? "expense" : entry.source;
      const repGain = repFromCashFlow(repSource, Math.abs(entry.amount));
      if (repGain) {
        applyRepDelta(player, repGain, `经营流水${note || entry.source}`, {
          source: "cashflow",
          itemId: entry.itemId,
          at: entry.at
        });
      }
    }
    refreshPlayerReport(player);
    return entry;
  }

  function spendCash(player, amount, note, meta = {}) {
    const cost = money(amount);
    if (player.cash < cost) return false;
    const before = money(player.cash);
    player.cash -= cost;
    recordLedger(player, "expense", cost, note, { ...meta, before, after: money(player.cash) });
    return true;
  }

  function earnCash(player, amount, note, meta = {}) {
    const now = Number(meta.at) || Date.now();
    const income = ["taskReward", "achievementReward"].includes(meta.source)
      ? bookRewardCash(player, money(amount), meta.source, now) : money(amount);
    if (income <= 0) return 0;
    if (player.onboarding && !player.onboarding.firstSaleAt
      && ["order", "market-payout", "livestream", "blackmarket-sale", "blackmarket-payout", "commission"].includes(meta.source)) {
      player.onboarding.firstSaleAt = now;
    }
    // 被动/离线收入只偿还已存在的欠薪，不创建登录日、不追扣待结账单。
    const before = money(player.cash);
    player.cash += income;
    recordLedger(player, "income", income, note, { ...meta, before, after: money(player.cash) });
    const repayment = Math.min(recoveryRepaymentFor(player, income, meta), Math.floor(income * 0.3), availableDebtRepayment(player));
    if (repayment > 0) {
      const recovery = normalizeRecovery(player);
      const repaymentBefore = money(player.cash);
      player.cash -= repayment;
      recovery.debt -= repayment;
      recovery.repaidTotal += repayment;
      recordLedger(player, "expense", repayment, "经营纾困还款", {
        source: "recovery-repayment",
        repEligible: false,
        before: repaymentBefore,
        after: money(player.cash)
      });
    }
    repayEmployeePayrollFromIncome(player, income, meta, {
      spendCash, now, maxPayment: Math.min(availableDebtRepayment(player), Math.max(0, Math.floor(income * 0.3) - repayment))
    });
    return income;
  }

  function holdDeposit(player, amount, note, meta = {}) {
    const cost = money(amount);
    if (player.cash < cost) return false;
    const before = money(player.cash);
    player.cash -= cost;
    recordLedger(player, "expense", cost, note, {
      ...meta,
      source: meta.source || "auctionDeposit",
      repEligible: false,
      before,
      after: money(player.cash)
    });
    return true;
  }

  function releaseDeposit(player, amount, note, meta = {}) {
    const income = money(amount);
    const before = money(player.cash);
    player.cash += income;
    recordLedger(player, "income", income, note, {
      ...meta,
      source: meta.source || "auctionRefund",
      repEligible: false,
      before,
      after: money(player.cash)
    });
    return income;
  }

  return {
    pick,
    clamp,
    money,
    uiMoney,
    recordLedger,
    spendCash,
    earnCash,
    holdDeposit,
    releaseDeposit
  };
}
