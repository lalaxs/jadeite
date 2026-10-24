import { payEmployeePayroll, enterEmployeePayrollDay } from "../server/systems/employee-payroll.js";
import assert from "node:assert/strict";
import { __testHooks as H } from "../server.js";
import { resolveTiming } from "../shared/domain/economy/jade-loop.js";
import { workerDailyWage, EMPLOYEE_PAYROLL_DAY_MS, employeePayrollDayStart } from "../shared/domain/economy/worker-economy.js";
import { normalizeEmployeePayroll, settleEmployeePayroll, dismissWorker, recruitWorker } from "../server/systems/employee-system.js";
import { auctionBidPhase, auctionSealedStartsAt, publicAuctionSnapshot } from "../shared/domain/auction/jade-auction.js";
import { initAuctionModule, renderAuctionBidControls } from "../public/auction-module.js";
import { validateFinishPlanDraft } from "../shared/domain/workshop/finish-plan-model.js";
import { inlayCatalog } from "../server/systems/inlay-system.js";
import { installOwnedWorkshopFixture } from "./fixtures/owned-workshop.mjs";

const day = EMPLOYEE_PAYROLL_DAY_MS;
const start = employeePayrollDayStart(Date.now());
assert.equal(resolveTiming().day, 4 * 60 * 60 * 1000);
assert.equal(day, 24 * 60 * 60 * 1000);
assert.deepEqual(Array.from({ length: 10 }, (_, i) => workerDailyWage({ tier: i + 1 })),
  [100, 140, 190, 250, 320, 400, 490, 590, 700, 820]);
assert.equal(workerDailyWage({ tier: 5, baseWage: 580 }), 320, "old saved wages must use the new tier table");

const legacy = { cash: 5000, workshop: { workers: [{ id: "old", tier: 1 }] } };
normalizeEmployeePayroll(legacy, start);
assert.equal(enterEmployeePayrollDay(legacy, { spendCash: H.spendCash, now: start }).paid, 0);
assert.equal(settleEmployeePayroll(legacy, { spendCash: H.spendCash, now: start + day - 1 }).paid, 0);
assert.equal(enterEmployeePayrollDay(legacy, { spendCash: H.spendCash, now: start + day }).paid, 100);
assert.equal(legacy.cash, 4900);
assert.equal(settleEmployeePayroll(legacy, { spendCash: H.spendCash, now: start + day }).paid, 0);
assert.equal(enterEmployeePayrollDay(legacy, { spendCash: H.spendCash, now: start + day * 4 }).paid, 100);
assert.equal(legacy.ledger[0].source, "employeeSalary");
assert.equal(legacy.employeePayroll.currentBill.day, start + day * 4);

// Reloading preserves the settlement cursor; dismissal charges the entire current day.
const reloaded = JSON.parse(JSON.stringify(legacy));
assert.equal(settleEmployeePayroll(reloaded, { spendCash: H.spendCash, now: start + day * 4 }).paid, 0);
const dismissed = dismissWorker(reloaded, "old", { spendCash: H.spendCash, now: start + day * 4.5 });
assert.equal(dismissed.ok, true);
assert.equal(reloaded.employeePayroll.paidTotal, 300);

const poor = { cash: 20, workshop: { workers: [{ id: "poor", tier: 1 }] } };
normalizeEmployeePayroll(poor, start);
enterEmployeePayrollDay(poor, { spendCash: H.spendCash, now: start });
const debt = enterEmployeePayrollDay(poor, { spendCash: H.spendCash, now: start + day });
assert.equal(debt.paid, 0);
assert.equal(debt.debt, 100);
assert.equal(poor.cash, 20);
dismissWorker(poor, "poor", { spendCash: H.spendCash, now: start + day * 1.5 });
assert.equal(poor.employeePayroll.debt, 200);
poor.cash = 1500;
assert.equal(payEmployeePayroll(poor, 200, { spendCash: H.spendCash, now: start + day * 1.5 + 1 }).paid, 200);
assert.equal(poor.cash, 1300);

const recruit = H.makePlayer("payroll-recruit");
const candidate = recruit.recruitCandidates[0];
const beforeSigning = recruit.cash = 100_000;
const hired = recruitWorker(recruit, candidate.id, { spendCash: H.spendCash });
assert.equal(hired.ok, true);
assert.equal(recruit.cash, beforeSigning - candidate.price);
assert.ok(hired.worker.payrollAt >= start);

// Runtime/offline progress never opens salary dates; explicit login does.
const offline = installOwnedWorkshopFixture(H.makePlayer("payroll-offline"));
const bill = offline.workshop.workers.reduce((sum, worker) => sum + workerDailyWage(worker), 0);
assert.equal(bill, 1500, "the explicitly saved four-worker roster retains its ¥1500 daily wages");
enterEmployeePayrollDay(offline, { spendCash: H.spendCash, now: start - day });
offline.lastSeenAt = start - day;
H.state.players.set(offline.id, offline);
H.settleOfflinePlayer(offline, start);
assert.equal(offline.cash, 12_000);
H.settleOfflinePlayer(offline, start);
assert.equal(offline.cash, 12_000);
H.reconcileWorld(start + day, { broadcast: false });
assert.equal(offline.cash, 12_000);
assert.equal(enterEmployeePayrollDay(offline, { spendCash: H.spendCash, now: start + day }).paid, bill);

const fresh = H.makePlayer("access-zero");
H.state.players.set(fresh.id, fresh);
assert.equal(fresh.achievementPoints, 0);
const listing = H.listItemForPlayer(fresh, { type: "rough", itemId: fresh.rough[0].id, price: 1000 });
assert.equal(listing.ok, true, listing.message);
assert.equal(H.openBlackStallForPlayer(fresh, { type: "goods" }).ok, true);

const plan = { productType: "ring", settingId: "claw", metalId: "gold18k", gemId: "diamond", gemCount: 2, polishId: "bright", backingId: "open" };
const finishing = validateFinishPlanDraft({ shape: "cabochon", draft: plan, catalog: inlayCatalog(),
  cash: 0, workerFee: 9999, materials: { gold18k: 10, diamond: 2 }, itemValue: 10000 });
assert.equal(finishing.canStart, true);
assert.equal(finishing.quote.laborFee, 0);
assert.ok(finishing.quote.metalAmount > 0);

// Real submissions on both sides of the boundary preserve escrow but hide competitors.
H.state.auction = null;
const bidder1 = H.makePlayer("phase-one");
const bidder2 = H.makePlayer("phase-two");
for (const player of [bidder1, bidder2]) {
  player.cash = 100_000;
  H.state.players.set(player.id, player);
  assert.equal(H.enterAuctionForPlayer(player, { hallId: "novice" }, start).ok, true);
}
const round = H.state.auction;
const rough = round.roughs[0];
const sealedAt = round.endsAt - 120_000;
assert.equal(auctionSealedStartsAt(round), sealedAt);
assert.equal(auctionBidPhase(round, sealedAt - 1), "open");
assert.equal(auctionBidPhase(round, sealedAt), "sealed");
assert.equal(auctionBidPhase(round, round.endsAt), "settlement");
assert.equal(H.submitAuctionBidForPlayer(bidder1, { roughId: rough.id, amount: rough.price + 1000 }, start + 1).ok, true);
assert.equal(H.submitAuctionBidForPlayer(bidder2, { roughId: rough.id, amount: rough.price + 500 }, start + 2).ok, true);
const opened = publicAuctionSnapshot(H.state.auction, bidder1.id, sealedAt - 1);
assert.equal(opened.roughs[0].highestOtherBid, rough.price + 500, "exclude my own higher bid");
assert.equal(publicAuctionSnapshot(H.state.auction, bidder2.id, sealedAt - 1).roughs[0].highestOtherBid, rough.price + 1000);
assert.equal(H.submitAuctionBidForPlayer(bidder2, { roughId: rough.id, amount: rough.price + 1500 }, sealedAt).ok, true);
const sealed = publicAuctionSnapshot(H.state.auction, bidder1.id, sealedAt);
assert.equal(sealed.bidPhase, "sealed");
assert.ok(sealed.roughs.every((lot) => !Object.hasOwn(lot, "highestOtherBid")));
assert.equal(sealed.myBids[0].amount, rough.price + 1000);
assert.equal(Object.hasOwn(sealed, "bids"), false);
assert.deepEqual(publicAuctionSnapshot(H.state.auction, "outside", sealedAt - 1).roughs, []);

// A stale open snapshot must not display its cached price once the local clock crosses.
let clock = sealedAt - 1;
initAuctionModule({ getState: () => ({ auction: opened, me: bidder1 }), helpers: {
  nowMs: () => clock, formatMoney: (amount) => `¥${amount}`, escapeHtml: String
} });
const displayedHighestBid = (lot) => renderAuctionBidControls(lot).match(/<div class="auction-competing-bid">(.*?)<\/div>/)?.[1];
assert.equal(displayedHighestBid(opened.roughs[0]), `当前最高出价：<strong>¥${rough.price + 1000}</strong>`, "show my submitted price when I lead");
assert.equal(displayedHighestBid({ ...opened.roughs[0], highestOtherBid: null }), `当前最高出价：<strong>¥${rough.price + 1000}</strong>`, "show my price when nobody else has bid");
assert.equal(displayedHighestBid({ ...opened.roughs[0], highestOtherBid: rough.price + 1000 }), `当前最高出价：<strong>¥${rough.price + 1000}</strong>`, "tied bids share the same highest price");
assert.equal(displayedHighestBid({ ...opened.roughs[0], highestOtherBid: rough.price + 2000 }), `当前最高出价：<strong>¥${rough.price + 2000}</strong>`, "show a competing price when I am outbid");
assert.equal(displayedHighestBid({ ...opened.roughs[0], id: "unbid", highestOtherBid: null }), "当前最高出价：<strong>暂无出价</strong>");
clock = sealedAt;
const hiddenControls = renderAuctionBidControls(opened.roughs[0]);
assert.match(hiddenControls, /他人最高出价已隐藏/);
assert.ok(!hiddenControls.includes(`¥${rough.price + 500}`));

console.log("gameplay-rules-smoke: zero-AP access, free processing, daily payroll and open/sealed privacy ok");
