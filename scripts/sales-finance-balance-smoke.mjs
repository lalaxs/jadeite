import assert from 'node:assert/strict';
import { createEconomyService } from '../server/services/economy-service.js';
import { operatingReserveFor } from '../shared/domain/economy/operating-reserve.js';
import { systemDemandSnapshot, quoteSystemDemand, bookSystemDemand, systemSalePriceCap } from '../shared/domain/economy/system-demand.js';
import { DAILY_TASK_CASH_CAP, bookRewardCash } from '../shared/domain/economy/new-player-economy.js';
import { startLivestreamRoom, closeLivestreamRoom, purchaseLivestreamRoomItem, aiPurchaseChance } from '../server/systems/livestream-room-system.js';

const now = Date.parse('2026-10-23T04:00:00Z');
const economy = createEconomyService({ refreshPlayerReport() {} });
const createPlayer = (id = 'balance') => ({ id, cash: 0, level: 1, ledger: [], rep: 0,
  stats: {}, onboarding: { startedAt: now }, workshop: { workers: [] },
  employeePayroll: { version: 3, debt: 1000, status: 'grace' }, recovery: { debt: 1000 },
  assets: { livestreamPermitOwned: true }, bracelets: [] });

{
  const p = createPlayer();
  economy.earnCash(p, 1000, '销售', { source: 'order', at: now });
  assert.equal(p.cash, 1000);
  assert.equal(p.recovery.debt, 1000);
  assert.equal(p.employeePayroll.debt, 1000);
  economy.spendCash(p, 850, '再次进货', { source: 'auction' });
  economy.earnCash(p, 1000, '销售', { source: 'order', at: now });
  assert.equal(p.cash, 1150, 'a profitable stock cycle must retain its principal');
  p.cash = 4000;
  economy.earnCash(p, 1000, '销售', { source: 'order', at: now });
  assert.equal(p.cash, 4700);
  assert.equal(p.recovery.debt, 900);
  assert.equal(p.employeePayroll.debt, 800);
  assert.equal(operatingReserveFor(p), 4000);
}
{
  const p = createPlayer('commission');
  economy.earnCash(p, 180, '来料单', { source: 'commission', at: now });
  assert.equal(p.cash, 180, 'small recovery labor is not swallowed by debt');
  assert.equal(p.onboarding.firstSaleAt, now);
  p.cash = 12000;
  economy.spendCash(p, 3200, '购设备', { source: 'equipment' });
  assert.ok(p.onboarding.completedAt);
}
{
  const p = createPlayer('stock');
  p.workshop.workers.push({ tier: 1 });
  p.ledger.push({ kind: 'expense', source: 'auction', amount: -10000 });
  assert.equal(operatingReserveFor(p), 10200);
}
assert.equal(DAILY_TASK_CASH_CAP, 300);
{
  const p = createPlayer('rewards');
  assert.equal(bookRewardCash(p, 250, 'taskReward', now), 250);
  assert.equal(bookRewardCash(p, 250, 'taskReward', now), 50);
  assert.equal(bookRewardCash(p, 250, 'taskReward', now), 0);
  assert.equal(bookRewardCash(p, 250, 'taskReward', now + 86400000), 250);
}
const item = (id, extra = {}) => ({ id, name: id, type: 'bracelet', materialStage: 'finished', value: 1000, score: 2, ...extra });
{
  const p = createPlayer('demand');
  const before = structuredClone(p);
  const empty = systemDemandSnapshot(p, now);
  assert.deepEqual(p, before, 'snapshots must not mutate player state');
  assert.equal(empty.remaining.cash, 24000);
  const resale = item('resale', { npcOrigin: 'blackmarket' });
  assert.equal(systemSalePriceCap(p, [resale]), 1030);
  assert.equal(quoteSystemDemand(p, [resale], 1100, now).ok, false);
  assert.equal(quoteSystemDemand(p, [resale], 1030, now).ok, true);
  const clearance = item('clearance', { npcOrigin: 'blackmarket', costBasis: { amount: 900, complete: true } });
  assert.equal(quoteSystemDemand(p, [clearance], 1030, now).premiumCash, 130, 'the clearance trading margin also consumes customer demand');
  resale.craftedByPlayerId = p.id;
  assert.equal(systemSalePriceCap(p, [resale]), 1250, 'actual finishing unlocks craft demand');
  for (let i = 0; i < 2; i++) {
    const q = quoteSystemDemand(p, [item(`premium-${i}`)], 1200, now);
    assert.equal(q.ok, true);
    bookSystemDemand(p, q, i ? 'order' : 'livestream');
  }
  assert.equal(quoteSystemDemand(p, [item('third')], 1200, now).code, 'SYSTEM_PREMIUM_EXHAUSTED');
  assert.equal(quoteSystemDemand(p, [item('normal')], 1050, now).ok, true);
  const reloaded = JSON.parse(JSON.stringify(p));
  assert.equal(quoteSystemDemand(reloaded, [item('third')], 1200, now).ok, false);
  assert.equal(quoteSystemDemand(reloaded, [item('tomorrow')], 1200, now + 86400000).ok, true);
  assert.equal(quoteSystemDemand(p, [item('huge', { value: 25000 })], 25000, now).code, 'SYSTEM_DEMAND_EXHAUSTED');
}
{
  const p = createPlayer('rooms');
  p.employeePayroll.debt = p.recovery.debt = 0;
  p.bracelets = Array.from({ length: 4 }, (_, i) => item(`room-${i}`));
  let sequence = 0;
  const deps = { now, rng: () => 0, makeId: () => `sale-${sequence++}`, earnCash: economy.earnCash };
  assert.equal(startLivestreamRoom(p, p.bracelets.slice(0, 3).map(product => ({ productId: product.id, price: 1000 })), deps).ok, true);
  const soldId = p.livestreamRoom.items[0].id;
  assert.equal(purchaseLivestreamRoomItem({ seller: p, itemId: soldId, buyerType: 'ai' }, deps).ok, true);
  assert.equal(p.cash, 1000);
  assert.equal(purchaseLivestreamRoomItem({ seller: p, itemId: soldId, buyerType: 'ai' }, deps).ok, false);
  assert.equal(p.cash, 1000, 'repeated sale request cannot pay twice');
  const budget = structuredClone(p.systemDemandBudget);
  closeLivestreamRoom(p, deps);
  startLivestreamRoom(p, p.bracelets.map(product => ({ productId: product.id, price: 1000 })), deps);
  assert.deepEqual(p.systemDemandBudget, budget, 'closing/reopening must retain the demand budget');
  const pending = p.livestreamRoom.items[0];
  p.systemDemandBudget.cash = 24000;
  assert.equal(aiPurchaseChance(p, pending, p.livestreamRoom, now), 0);
  assert.equal(purchaseLivestreamRoomItem({ seller: p, itemId: pending.id, buyerType: 'ai' }, deps).code, 'SYSTEM_DEMAND_EXHAUSTED');
  assert.equal(p.livestreamRoom.items.length, 3);
  const buyer = createPlayer('human'); buyer.cash = 3000;
  assert.equal(purchaseLivestreamRoomItem({ seller: p, buyer, itemId: pending.id, buyerType: 'player' }, {
    ...deps, spendCash: economy.spendCash, addItem: (b, product) => { b.bracelets.push(product); return product; }
  }).ok, true, 'human trade remains available after system demand is spent');
}
console.log('sales-finance-balance-smoke: ok');
