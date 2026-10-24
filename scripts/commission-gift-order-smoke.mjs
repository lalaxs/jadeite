import assert from 'node:assert/strict';
import { createCommissionService } from '../server/services/commission-service.js';
import { claimWorkshopOutputs } from './workshop-test-utils.mjs';
process.env.JADE_WORLD_PERSIST = '0';
const { __testHooks: H } = await import('../server.js');
let now = Date.parse('2026-10-23T04:00:00Z');
const originalNow = Date.now;
const originalRandom = Math.random;
Date.now = () => now;
try {
  H.world.clear();
  const p = H.makePlayer('commission-before-gift');
  H.state.players.set(p.id, p);
  const commissions = createCommissionService({ normalizePlayer: H.normalizePlayer, earnCash: H.earnCash });
  const job = commissions.startCommissionForPlayer(p, { offerId: 'standard' }, now);
  assert.equal(job.ok, true, job.message);
  now = job.commission.readyAt + 1;
  assert.equal(commissions.claimCommissionForPlayer(p, { commissionId: job.commission.id }, now).ok, true);
  assert.ok(p.onboarding.firstSaleAt, 'paid labor counts as genuine business activity');
  const roughId = p.rough[0].id;
  for (const stage of ['opening', 'carving', 'finishing']) {
    const payload = stage === 'opening' ? { itemId: roughId }
      : stage === 'carving' ? { itemId: roughId, kits: [{ type: 'peacePendant', x: 50, y: 50, rot: 0, size: 'M' }] }
        : { itemId: p.bracelets[0].id, finishPlan: { productType: 'pendant', settingId: 'cord', metalId: null, gemId: null,
          gemCount: 0, polishId: 'bright', backingId: null } };
    const started = H.startWorkshopJobForPlayer(p, `public-${stage}`, payload);
    assert.equal(started.ok, true, started.message);
    now = started.job.readyAt + 1;
    p.jobs = p.jobs.filter(row => row.id !== started.job.id);
    let first = true;
    Math.random = () => { if (first) { first = false; return .999999; } return originalRandom(); };
    H.completeProductionJob(p, started.job);
    Math.random = originalRandom;
    claimWorkshopOutputs(H, p);
  }
  const order = p.orders.find(row => row.starterOrder);
  assert.ok(order, 'earlier labor income must not suppress the protected gifted-product customer');
  const product = p.bracelets[0];
  const completed = H.completeOrderForPlayer(p, { orderId: order.id, braceletIds: [product.id] });
  assert.equal(completed.ok, true, completed.message);
  assert.equal(p.onboarding.starterOrderCompletedAt, now);
  assert.equal(p.orders.some(row => row.starterOrder), false);
  const reloaded = JSON.parse(JSON.stringify(p)); H.normalizePlayer(reloaded); H.refillOrders(reloaded);
  assert.equal(reloaded.orders.some(row => row.starterOrder), false, 'completed protected customer never reappears after reload');
  console.log('commission-gift-order-smoke: labor before gifted-product tutorial still provides exactly one protected customer');
} finally { Date.now = originalNow; Math.random = originalRandom; }
process.exit(0);
