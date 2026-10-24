// Real service-driven economic scenarios. Virtual clocks only; no running server or save is loaded.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createCommissionService } from '../server/services/commission-service.js';
import { COMMISSION_OFFERS, quoteCommission } from '../shared/domain/economy/commission-rules.js';
import { createEconomyService } from '../server/services/economy-service.js';
import { equipmentCatalog, buyEquipment, createDeviceInstance } from '../server/systems/equipment-system.js';
import { enterEmployeePayrollDay, normalizeEmployeePayroll } from '../server/systems/employee-payroll.js';
import { recruitWorker } from '../server/systems/employee-system.js';
import { recruitPrice, employeePayrollQuote } from '../shared/domain/economy/worker-economy.js';
import { operatingReserveFor } from '../shared/domain/economy/operating-reserve.js';
import { quoteSystemDemand, systemDemandSnapshot } from '../shared/domain/economy/system-demand.js';
import { startLivestreamRoom, replenishLivestreamRoom, processAiLivestreamRooms, closeLivestreamRoom } from '../server/systems/livestream-room-system.js';
import { createAssetsService } from '../server/services/assets-service.js';
import { createRoughPoolService } from '../server/services/rough-pool-service.js';
import { buildOpeningStone, evaluateOpeningKit, scaleForOpeningKit } from '../shared/domain/jade/jade-opening-engine.js';
import { createMarketLiquidityService } from '../server/services/market-liquidity-service.js';
import { acceptMarketOfferForPlayer } from '../server/services/market-service.js';
import { recycleInventoryItemForPlayer } from '../server/services/inventory-service.js';
import { claimWorkshopOutputs } from './workshop-test-utils.mjs';

process.env.JADE_WORLD_PERSIST = '0';
process.env.LOG_LEVEL = 'silent';
const { __testHooks: H } = await import('../server.js');
const options = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const riskOnly = Object.hasOwn(options, 'risk-only');
const accounts = Math.max(4, Math.floor(Number(options.accounts) || 10_000));
const days = Math.max(14, Math.floor(Number(options.days) || 14));
const rawCount = options.raw === undefined ? 1000 : Math.max(0, Math.floor(Number(options.raw) || 0));
const output = path.resolve(options.output || 'docs/reports/2026-10-23-economy-implementation/simulation.json');
const commissionRulesHash = crypto.createHash('sha256').update(fs.readFileSync('shared/domain/economy/commission-rules.js')).digest('hex');
const BASE_TIME = Date.parse('2026-10-23T04:00:00Z');
const DAY = 86_400_000;
let clock = BASE_TIME;
let sequence = 0;
let randomState = 20261023;
const random = () => { randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0; return randomState / 4294967296; };
const realNow = Date.now;
const realRandom = Math.random;
Date.now = () => clock;
Math.random = random;
const round = (v, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;
const economy = createEconomyService({ refreshPlayerReport() {} });
const commissions = createCommissionService({
  // Full player normalization runs on every simulated login and persisted reload.
  // During an unchanged session only payroll's schema is refreshed; the actual
  // commission service still validates active contracts on every start/claim.
  normalizePlayer: p => normalizeEmployeePayroll(p, clock),
  earnCash: economy.earnCash, refreshPlayerReport() {}, TIMING_PROFILE: 'normal',
  makeId: () => `sim-contract-${++sequence}`
});
const catalog = equipmentCatalog();
const catalogByKey = new Map(catalog.map(model => [model.modelKey, model]));
const stages = ['opening', 'carving', 'finishing'];
const template = H.makePlayer('simulation-template');
const profiles = [
  { id: 'conservative', label: '保守', minutes: 30, delay: [45, 120], offer: 'cord', assistants: [], upgrade: 'sequence' },
  { id: 'ordinary', label: '普通', minutes: 60, delay: [20, 60], offer: 'standard', assistants: [], upgrade: 'sequence' },
  { id: 'skilled', label: '熟练', minutes: 90, delay: [10, 30], offer: 'best', assistants: [1], upgrade: 'roi' },
  { id: 'frequent', label: '高频', minutes: 240, delay: [3, 12], offer: 'best', assistants: [1, 2], upgrade: 'roi' }
];
const purchasePlan = [
  ...stages.map(stage => `used-${stage}-1`),
  ...stages.map(stage => `cuijie-${stage}-1`),
  ...stages.map(stage => `cuijie-${stage}-2`),
  ...stages.map(stage => `cuijie-${stage}-3`)
];
function fresh(id) {
  const p = structuredClone(template);
  p.id = id; p.name = id;
  p.onboarding.startedAt = clock;
  for (const item of p.rough) { item.owner = id; item.starterOwnerId = id; }
  return p;
}
function stats(values) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { n: 0 };
  return { n: sorted.length, min: round(sorted[0]), p10: round(sorted[Math.floor((sorted.length - 1) * .1)]),
    median: round(sorted[Math.floor((sorted.length - 1) * .5)]), p90: round(sorted[Math.floor((sorted.length - 1) * .9)]),
    max: round(sorted.at(-1)), mean: round(sorted.reduce((s, value) => s + value, 0) / sorted.length) };
}
function bestOffer(devices) {
  return COMMISSION_OFFERS.map(offer => quoteCommission(devices, offer.id))
    .sort((a, b) => b.netPay / b.durationMs - a.netPay / a.durationMs)[0];
}
function ownedHourly(devices, profile) {
  const quote = profile.offer === 'best' ? bestOffer(devices) : quoteCommission(devices, profile.offer);
  return quote.netPay / (quote.durationMs + (profile.delay[0] + profile.delay[1]) * 500) * 3_600_000;
}
function nextModel(player, profile) {
  const owned = new Set(player.workshop.devices.map(device => device.modelKey));
  const missingEntry = stages.map(stage => `used-${stage}-1`).find(key => !owned.has(key));
  if (missingEntry) return catalogByKey.get(missingEntry);
  if (profile.upgrade === 'sequence') return catalogByKey.get(purchasePlan.find(key => !owned.has(key)));
  const hourly = ownedHourly(player.workshop.devices, profile);
  const candidates = purchasePlan.filter(key => !owned.has(key)).map(key => {
    const model = catalogByKey.get(key);
    const projected = [...player.workshop.devices, createDeviceInstance(model.stage, key, 'projected')];
    const delta = ownedHourly(projected, profile) - hourly;
    return { model, delta, roi: delta > 0 ? model.price / delta : Infinity };
  }).sort((a, b) => a.roi - b.roi || a.model.price - b.model.price);
  return candidates.find(row => row.delta > 0)?.model;
}
function acquire(player, model) {
  const result = buyEquipment(player, model.modelKey, { spendCash: economy.spendCash, makeId: () => `${player.id}-device-${++sequence}` });
  assert.equal(result.ok, true, result.message);
  return result;
}
function hireAssistant(player, tier) {
  const candidate = { id: `${player.id}-assistant-${tier}`, name: `实测${tier}阶助手`, job: 'cutter', tier, tierLevel: 1,
    price: recruitPrice(tier), skills: structuredClone(player.workshop.owner.skills), traits: [], flaws: [] };
  player.recruitCandidates.push(candidate);
  const result = recruitWorker(player, candidate.id, { spendCash: economy.spendCash, now: clock });
  assert.equal(result.ok, true, result.message);
  return candidate.price;
}

function simulateAccount(profile, index) {
  clock = BASE_TIME;
  let player = fresh(`${profile.id}-${index}`);
  const result = { id: player.id, profile: profile.id, operatingIncome: 0, operatingProfit: 0, deviceInvestment: 0,
    recruitInvestment: 0, effectiveSeconds: 0, commissions: 0, firstFullLineHours: null, firstFullLineDay: null,
    persistedReloads: 0, duplicateClaimsRejected: 0, lowestCash: 12000, minimumReserveSurplus: Infinity, dailyProfit: [] };
  let nextHireIndex = 0;
  for (let day = 0; day < days; day++) {
    clock = BASE_TIME + day * DAY;
    H.normalizePlayer(player);
    enterEmployeePayrollDay(player, { spendCash: economy.spendCash, now: clock });
    const startIncome = player.commissions?.totalEarned || 0;
    const end = clock + profile.minutes * (0.85 + random() * .3) * 60_000;
    function invest() {
      let model = nextModel(player, profile);
      while (model && player.cash >= model.price + operatingReserveFor(player) && clock + 10_000 <= end) {
        acquire(player, model);
        result.deviceInvestment += model.price;
        result.effectiveSeconds += 10; clock += 10_000;
        result.lowestCash = Math.min(result.lowestCash, player.cash);
        if (result.firstFullLineHours == null && stages.every(stage => player.workshop.devices.some(device => device.modelKey === `used-${stage}-1`))
          && player.cash >= operatingReserveFor(player)) {
          result.firstFullLineHours = result.effectiveSeconds / 3600;
          result.firstFullLineDay = day + 1;
        }
        model = nextModel(player, profile);
      }
      // Staff stress cases pay real recruitment fees and wages. Their extra
      // output is deliberately not credited to this proprietor-only labor run.
      if (result.firstFullLineHours != null && nextHireIndex < profile.assistants.length) {
        const tier = profile.assistants[nextHireIndex];
        if (player.cash >= recruitPrice(tier) + operatingReserveFor(player) + 500 && clock + 10_000 <= end) {
          result.recruitInvestment += hireAssistant(player, tier);
          nextHireIndex++;
          result.effectiveSeconds += 10; clock += 10_000;
        }
      }
    }
    invest();
    while (true) {
      const quote = profile.offer === 'best' ? bestOffer(player.workshop.devices) : quoteCommission(player.workshop.devices, profile.offer);
      const delay = Math.round((profile.delay[0] + random() * (profile.delay[1] - profile.delay[0])) * 1000);
      if (clock + quote.durationMs + delay > end) break;
      const started = commissions.startCommissionForPlayer(player, { offerId: quote.offerId }, clock);
      assert.equal(started.ok, true, started.message);
      assert.equal(started.commission.durationMs, quote.normalDurationMs, 'production timing must remain normal');
      if ((result.commissions + index) % 31 === 0) {
        const cash = player.cash;
        const activeId = started.commission.id;
        player = JSON.parse(JSON.stringify(player));
        H.normalizePlayer(player);
        assert.equal(player.cash, cash);
        assert.equal(player.commissions.active.id, activeId);
        result.persistedReloads++;
      }
      clock = started.commission.readyAt + delay;
      const claimed = commissions.claimCommissionForPlayer(player, { commissionId: started.commission.id }, clock);
      assert.equal(claimed.ok, true, claimed.message);
      result.operatingIncome += claimed.finalPay;
      result.commissions++;
      result.effectiveSeconds += (quote.durationMs + delay) / 1000;
      if ((result.commissions + index) % 73 === 0) {
        const cash = player.cash;
        assert.equal(commissions.claimCommissionForPlayer(player, { commissionId: started.commission.id }, clock).ok, false);
        assert.equal(player.cash, cash);
        result.duplicateClaimsRejected++;
      }
      invest();
    }
    const wagesForDay = (player.employeePayroll.currentBill?.entries || []).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const netForDay = (player.commissions?.totalEarned || 0) - startIncome - wagesForDay;
    result.dailyProfit.push(netForDay);
    result.operatingProfit += netForDay;
    result.minimumReserveSurplus = Math.min(result.minimumReserveSurplus, player.cash - operatingReserveFor(player));
    if (day % 4 === 3) {
      const cash = player.cash;
      player = JSON.parse(JSON.stringify(player)); H.normalizePlayer(player);
      assert.equal(player.cash, cash);
      result.persistedReloads++;
    }
  }
  const unpaid = employeePayrollQuote(player, clock).totalDue;
  assert.equal(player.employeePayroll.debt, 0, 'planned ordinary operations must not accumulate wage debt');
  assert.equal(player.cash + result.deviceInvestment + result.recruitInvestment - 12000 - unpaid, result.operatingProfit,
    'operating profit must reconcile with actual cash, investments and accrued wages');
  result.cash = player.cash;
  result.unpaidCurrentDayWages = unpaid;
  result.deviceAssetsAtCost = result.deviceInvestment;
  result.cashAndDeviceAssetsLessWages = player.cash + result.deviceInvestment - unpaid;
  result.ownedModels = player.workshop.devices.map(device => device.modelKey);
  result.workers = player.workshop.workers.length;
  result.debt = player.employeePayroll.debt + (player.recovery?.debt || 0);
  result.nextGoal = nextModel(player, profile)?.modelKey || null;
  return result;
}

function roiTable() {
  const lines = [
    { id: 'public', devices: [], cost: 0 },
    ...[['used', 1], ['cuijie', 1], ['cuijie', 2], ['cuijie', 3]].map(([brand, tech]) => {
      const devices = stages.map(stage => createDeviceInstance(stage, `${brand}-${stage}-${tech}`, `${brand}-${stage}-${tech}`));
      return { id: `${brand}-T${tech}`, devices, cost: devices.reduce((sum, device) => sum + device.basePrice, 0) };
    })
  ];
  return lines.map((line, index) => {
    const quote = quoteCommission(line.devices, 'standard');
    const hourly = quote.netPay / quote.durationMs * 3_600_000;
    const previous = index ? lines[index - 1] : null;
    const previousQuote = previous ? quoteCommission(previous.devices, 'standard') : null;
    const previousHourly = previousQuote ? previousQuote.netPay / previousQuote.durationMs * 3_600_000 : 0;
    return { id: line.id, purchase: line.cost, netPerJob: quote.netPay, minutes: round(quote.durationMs / 60000),
      idealNetPerHour: round(hourly), incrementalNetPerHour: index ? round(hourly - previousHourly) : null,
      fullPurchasePaybackHours: index ? round(line.cost / (hourly - previousHourly)) : null,
      assumesOldMachineResold: false };
  });
}

function commissionContractMatrix() {
  const rows = [];
  for (const model of catalog) {
    clock = BASE_TIME;
    let p = fresh(`contract-${model.modelKey}`);
    p.workshop.devices = [createDeviceInstance(model.stage, model.modelKey, `matrix-${model.modelKey}`)];
    const quote = quoteCommission(p.workshop.devices, 'standard');
    assert.ok(quote.deviceIds.includes(p.workshop.devices[0].id), `${model.modelKey} must remain economically useful on labor contracts`);
    const start = commissions.startCommissionForPlayer(p, { offerId: 'standard' }, clock);
    assert.equal(start.ok, true, start.message);
    p = JSON.parse(JSON.stringify(p)); H.normalizePlayer(p);
    clock = start.commission.readyAt + 1;
    const claim = commissions.claimCommissionForPlayer(p, { commissionId: start.commission.id }, clock);
    assert.equal(claim.ok, true, `${model.modelKey}: ${claim.message}`);
    assert.equal(claim.finalPay, quote.netPay);
    rows.push({ modelKey: model.modelKey, price: model.price, netPay: quote.netPay,
      hourly: round(quote.netPay / quote.durationMs * 3_600_000), restoredAndClaimed: true });
  }
  return { models: rows.length, allSelectedAndClaimableAfterReload: true, rows };
}

function resaleScenario(purchaseRatio) {
  clock = BASE_TIME;
  const p = fresh(`resale-${purchaseRatio}`);
  p.cash = 30000; // Explicit established-business bankroll; the license is paid, not gifted.
  p.rough = [];
  const assets = createAssetsService({ normalizePlayer: H.normalizePlayer, spendCash: economy.spendCash, refreshPlayerReport() {} });
  assert.equal(assets.buyAssetListingForPlayer(p, 'livestream-permit').ok, true);
  let stockId = 0, roomSequence = 0;
  const reference = 1000;
  const salePrice = 1030;
  let bought = 0, sold = 0, revenue = 0, stockCost = 0, actualWaitMs = 0;
  const salesPerDay = [];
  const deps = () => ({ now: clock, rng: random, makeId: () => `resale-room-${++roomSequence}`,
    earnCash: (seller, amount, note, meta) => { revenue += amount; sold++; return economy.earnCash(seller, amount, note, meta); } });
  function buyStock() {
    while (p.bracelets.length < 3 && p.cash >= Math.round(reference * purchaseRatio)) {
      const cost = Math.round(reference * purchaseRatio);
      const product = { id: `resale-stock-${++stockId}`, name: 'NPC成品', type: 'bracelet', materialStage: 'finished',
        npcOrigin: 'blackmarket', value: reference, score: 2, costBasis: { amount: cost, complete: true } };
      assert.equal(economy.spendCash(p, cost, '黑市现货上界供货', { source: 'blackmarket', itemId: product.id }), true);
      p.bracelets.push(product); bought++; stockCost += cost;
    }
  }
  for (let day = 0; day < days; day++) {
    clock = BASE_TIME + day * DAY;
    const startSold = sold, startRevenue = revenue;
    const start = clock;
    // 60 minutes of actual room visitation. Assumes unlimited supplier stock
    // at the chosen ratio; real rotating/global NPC stock can only lower this.
    const end = clock + 3_600_000;
    buyStock();
    while (clock < end) {
      if (!p.livestreamRoom) {
        buyStock();
        const listings = p.bracelets.slice(0, 3).map(product => ({ productId: product.id, price: salePrice }));
        assert.equal(startLivestreamRoom(p, listings, deps()).ok, true);
      }
      const room = p.livestreamRoom;
      const next = Math.min(room.nextAiVisitAt, room.endsAt + 1, end);
      clock = next;
      processAiLivestreamRooms([p], deps());
      if (p.livestreamRoom && p.livestreamRoom.items.length < 3) {
        buyStock();
        const needed = 3 - p.livestreamRoom.items.length;
        if (needed && p.bracelets.length) replenishLivestreamRoom(p,
          p.bracelets.slice(0, needed).map(product => ({ productId: product.id, price: salePrice })), deps());
      }
      if (next === end) break;
    }
    if (p.livestreamRoom) closeLivestreamRoom(p, deps());
    actualWaitMs += clock - start;
    salesPerDay.push({ count: sold - startSold, revenue: revenue - startRevenue,
      tradingProfit: (sold - startSold) * (salePrice - Math.round(reference * purchaseRatio)),
      demand: systemDemandSnapshot(p, clock).remaining });
    const budget = JSON.stringify(p.systemDemandBudget);
    const reloaded = JSON.parse(JSON.stringify(p));
    assert.equal(JSON.stringify(reloaded.systemDemandBudget), budget);
  }
  return { purchaseRatio, days, initialCash: 30000, licensePaid: 10000, reference, salePrice,
    bought, sold, revenue, paidStockCost: stockCost, unsoldAtCost: (bought - sold) * Math.round(reference * purchaseRatio),
    tradingProfit: sold * (salePrice - Math.round(reference * purchaseRatio)),
    cash: p.cash, customerWaitingHours: round(actualWaitMs / 3_600_000),
    profitPerHour: round(sold * (salePrice - Math.round(reference * purchaseRatio)) / (actualWaitMs / 3_600_000)),
    daily: stats(salesPerDay.map(row => row.tradingProfit)), sampleDays: salesPerDay.slice(0, 3),
    assumesUnlimitedSupplierStock: true, licensePaybackDaysAtObservedDailyProfit: round(10000 / (sold * (salePrice - Math.round(reference * purchaseRatio)) / days)) };
}

function rawRiskScenario(count) {
  if (!count) return { n: 0 };
  const rows = [];
  const generator = createRoughPoolService({ money: v => Math.round(v), clamp: (v, low, high) => Math.max(low, Math.min(high, v)),
    pick: list => list[Math.floor(random() * list.length)], getState: () => ({ roughPool: [] }) });
  const liquidity = createMarketLiquidityService({ getState: () => H.state, money: v => Math.round(v),
    itemValue: item => Number(item.value ?? item.price), randomUUID: () => `raw-quote-${++sequence}` });
  const recycle = (p, item) => {
    const result = recycleInventoryItemForPlayer(p, { kind: 'jade', itemId: item.id }, { money: v => Math.round(v), earnCash: H.earnCash });
    assert.equal(result.ok, true, result.message);
  };
  for (let index = 0; index < count; index++) {
    clock = BASE_TIME;
    H.world.clear();
    const p = fresh(`raw-risk-${index}`);
    // A separate capitalized risk experiment, never credited with commissions,
    // gifts, achievements, tasks, borrowings or asset appreciation as income.
    p.cash = 100000; p.rough = []; p.materials = []; p.bracelets = []; p.orders = [];
    H.state.players.set(p.id, p);
    const rough = { ...generator.makeRoughStone({ mass: round(.7 + random() * 1.5, 1) }), type: 'rough' };
    rough.id = `${p.id}-stone`;
    const acquisition = Math.round(rough.price * 1.1) + 200;
    rough.costBasis = { amount: acquisition, complete: true };
    H.spendCash(p, acquisition, '风险原料情景采购', { source: 'auction', itemId: rough.id });
    p.rough.push(rough);
    let shattered = false, seconds = 0, produced = 0;
    function complete(stage, payload) {
      const r = H.startWorkshopJobForPlayer(p, `public-${stage}`, payload);
      assert.equal(r.ok, true, r.message);
      seconds += (r.job.readyAt - r.job.startedAt) / 1000;
      clock = r.job.readyAt + 1;
      p.jobs = p.jobs.filter(job => job.id !== r.job.id);
      const done = H.completeProductionJob(p, r.job); // All RNG is natural seeded RNG, including shatter.
      claimWorkshopOutputs(H, p);
      shattered ||= Boolean(done?.shattered);
      return done;
    }
    complete('opening', { itemId: rough.id });
    const material = p.materials[0];
    if (material) {
      const stone = buildOpeningStone({ seed: `${material.id}:${material.openingSeed || material.visual?.openingSeed || material.visual?.seed || material.id}`,
        roughId: material.id, qualityKey: material.qualityKey, quality: material.quality, color: material.color });
      const candidates = [];
      for (const x of [25, 50, 75]) for (const y of [25, 50, 75]) {
        const e = evaluateOpeningKit({ tpl: 'ping', x: x * 6, y: y * 6, rot: 0, scale: scaleForOpeningKit('ping', 'M'), size: 'M' }, stone);
        if (e.wasteRatio <= .2 && e.crackRatio <= .2) candidates.push({ x, y, value: e.price });
      }
      candidates.sort((a, b) => b.value - a.value);
      const kits = [];
      for (const c of candidates) {
        const kit = { type: 'peacePendant', x: c.x, y: c.y, rot: 0, size: 'M' };
        if (!H.extractionKitsOverlap([...kits, kit])) kits.push(kit);
        if (kits.length === 3) break;
      }
      if (kits.length) complete('carving', { itemId: material.id, kits });
      for (const blank of [...p.bracelets]) {
        // Finishing failures return material; a real retry pays another station fee.
        let attempts = 0;
        while (p.bracelets.find(item => item.id === blank.id)?.materialStage !== 'finished' && attempts++ < 5) {
          complete('finishing', { itemId: blank.id, finishPlan: { productType: 'pendant', settingId: 'cord', metalId: null,
            gemId: null, gemCount: 0, polishId: 'bright', backingId: null } });
        }
      }
      produced = p.bracelets.filter(item => item.materialStage === 'finished').length;
    }
    for (const leftover of [...p.materials]) recycle(p, leftover);
    for (const product of [...p.bracelets]) {
      if (product.value < 154) { recycle(p, product); continue; }
      const listed = H.listItemForPlayer(p, { type: 'bracelet', itemId: product.id, price: product.value });
      assert.equal(listed.ok, true, listed.message);
    }
    clock += 10 * 60000 + 1;
    seconds += 600;
    liquidity.processMarketLiquidity(clock);
    liquidity.processMarketLiquidity(clock);
    for (const listing of [...H.state.listings]) {
      if (!listing.npcOffer) continue;
      assert.equal(acceptMarketOfferForPlayer(p, listing.id, listing.npcOffer.id).ok, true);
    }
    for (const listing of [...H.state.listings]) {
      H.withdrawListingForPlayer(p, listing.id);
      recycle(p, listing.item);
    }
    const cashNet = p.cash - 100000;
    assert.equal((p.commissions?.completedCount || 0), 0);
    rows.push({ quality: rough.trueQualityKey, acquisition, produced, shattered, cashNet, hours: round(seconds / 3600, 3) });
  }
  return { n: rows.length, netCash: stats(rows.map(row => row.cashNet)), lossShare: rows.filter(row => row.cashNet < 0).length / rows.length,
    shatterShare: rows.filter(row => row.shattered).length / rows.length,
    byQuality: Object.fromEntries([...new Set(rows.map(row => row.quality))].map(quality => {
      const subset = rows.filter(row => row.quality === quality);
      return [quality, { n: subset.length, cashNet: stats(subset.map(row => row.cashNet)), lossShare: subset.filter(row => row.cashNet < 0).length / subset.length }];
    })), sample: rows.slice(0, 15), assumptions: [
      'Ordinary 0.7-2.2kg rough with current weighted quality distribution; acquisition assumed at 110% reserve +200 fee, actual spendCash applied, no auction bidding simulation.',
      'Three non-overlapping M peace pendants at most, 3x3 displayed planning choices; natural seeded shatter, real public-station fees and retries.',
      'Leftovers immediately recycled at 20%; finished products receive real 10-minute 65% NPC offers subject to count/cash caps; remaining products recycled.',
      'Initial capital 100000 is isolated scenario funding; gift stock and every subsidy are excluded. No commission income offsets a bad stone.',
      'This is an optional-risk liquidation scenario, not the normal no-capital commission route. It is not an optimal planner or a guarantee of any player result.'
    ] };
}

try {
  const startedAt = performance.now();
  if (riskOnly) {
    const existing = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(existing.metadata.commissionsRulesSha256, commissionRulesHash,
      'commission rules changed; the existing long-run cohort results must not be silently retained');
    const cohortHash = crypto.createHash('sha256').update(JSON.stringify({ groups: existing.groups, accounts: existing.accounts })).digest('hex');
    randomState = 20261023;
    const latestRisk = rawRiskScenario(rawCount);
    existing.riskyRough = latestRisk;
    existing.metadata.riskScenarioSeed = 20261023;
    existing.metadata.riskScenarioRerun = {
      mode: 'risk-only', date: '2026-10-23', samples: rawCount,
      wallSeconds: round((performance.now() - startedAt) / 1000),
      materialValuePoolSha256: crypto.createHash('sha256').update(fs.readFileSync('shared/domain/workshop/material-value-pool.js')).digest('hex'),
      npcOffcutSha256: crypto.createHash('sha256').update(fs.readFileSync('server/services/blackmarket/npc-offcut.js')).digest('hex'),
      retainedCohortHash: cohortHash,
      note: 'Only the separate raw-stone liquidation risk scenario was rerun. The 10000-account commission cohorts are unchanged and use the same verified commission-rules hash.'
    };
    assert.equal(crypto.createHash('sha256').update(JSON.stringify({ groups: existing.groups, accounts: existing.accounts })).digest('hex'), cohortHash);
    fs.writeFileSync(output, JSON.stringify(existing, null, 2));
    const notesPath = path.join(path.dirname(output), 'simulation-notes.md');
    if (fs.existsSync(notesPath)) {
      const notes = fs.readFileSync(notesPath, 'utf8');
      const paragraph = `另跑${rawCount.toLocaleString('en-US')}块普通种水分布暗料的急售风险场景：按底价110%+200采购费用、最多取3个M平安扣、公共工位真实收费与自然碎裂、余料立即20%回收，成品等待真实10分钟65%批发并执行4件/6,000日限额，剩余货回收。最新按可加总玉料权重规则单独重跑，亏损占比${round(latestRisk.lossShare * 100)}%，平均${latestRisk.netCash.mean.toLocaleString('en-US')}，P10为${latestRisk.netCash.p10.toLocaleString('en-US')}。没有用来料佣金、奖励或借款抵消这些亏损；10,000账户主组的佣金规则hash未变，主组结果保持原样。`;
      const pattern = /另跑[\d, ]+块[\s\S]*?(?=\r?\n\r?\n)/;
      assert.match(notes, pattern, 'risk paragraph must be replaced, not left stale next to new results');
      fs.writeFileSync(notesPath, notes.replace(pattern, paragraph));
    }
    console.log(JSON.stringify({ mode: 'risk-only', output, retainedCohortHash: cohortHash,
      metadata: existing.metadata.riskScenarioRerun, riskyRough: { n: latestRisk.n, lossShare: latestRisk.lossShare, netCash: latestRisk.netCash },
      mainGroupsSummary: Object.fromEntries(Object.entries(existing.groups).map(([id, group]) => [id, {
        accounts: group.accounts, dailyMinutes: group.profile.minutes, dailyOperatingProfitP10: group.dailyOperatingProfit.p10,
        firstFullLineHoursMedian: group.firstFullLineHours.median, firstFullLineHoursP90: group.firstFullLineHours.p90
      }])) }, null, 2));
    process.exit(0);
  }
  const outcomes = [];
  const groups = {};
  for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
    const profile = profiles[profileIndex];
    const total = Math.floor(accounts / profiles.length) + (profileIndex < accounts % profiles.length ? 1 : 0);
    const rows = [];
    for (let index = 0; index < total; index++) rows.push(simulateAccount(profile, index));
    const allDaily = rows.flatMap(row => row.dailyProfit);
    groups[profile.id] = { profile, accounts: rows.length, operatingProfit: stats(rows.map(row => row.operatingProfit)),
      dailyOperatingProfit: stats(allDaily), operatingCash: stats(rows.map(row => row.cash)),
      operatingIncome: stats(rows.map(row => row.operatingIncome)), deviceInvestment: stats(rows.map(row => row.deviceInvestment)),
      cashAndDeviceAssetsLessWages: stats(rows.map(row => row.cashAndDeviceAssetsLessWages)),
      effectiveHours: stats(rows.map(row => row.effectiveSeconds / 3600)), commissions: stats(rows.map(row => row.commissions)),
      firstFullLineHours: stats(rows.map(row => row.firstFullLineHours).filter(value => value != null)),
      firstFullLineDay: stats(rows.map(row => row.firstFullLineDay).filter(value => value != null)),
      fullLineReachedShare: rows.filter(row => row.firstFullLineHours != null).length / rows.length,
      negativeOperatingDays: allDaily.filter(value => value < 0).length,
      negativeOperatingAccounts: rows.filter(row => row.operatingProfit < 0).length,
      debtAccounts: rows.filter(row => row.debt > 0).length,
      lowestReserveSurplus: Math.min(...rows.map(row => row.minimumReserveSurplus)),
      persistedReloads: rows.reduce((sum, row) => sum + row.persistedReloads, 0),
      duplicateClaimsRejected: rows.reduce((sum, row) => sum + row.duplicateClaimsRejected, 0),
      nextGoals: Object.fromEntries([...new Set(rows.map(row => row.nextGoal))].map(goal => [goal, rows.filter(row => row.nextGoal === goal).length])),
      sampleAccounts: rows.slice(0, 3) };
    outcomes.push(...rows.map(({ dailyProfit, ownedModels, ...row }) => row));
    console.log(`simulated ${profile.id}: ${rows.length} accounts x ${days} days`);
  }
  const resale = [.90, .98, 1.05].map(resaleScenario);
  randomState = 20261023;
  const riskyRough = rawRiskScenario(rawCount);
    const outputData = {
    metadata: { date: '2026-10-23', accounts, days, seed: 20261023, wallSeconds: round((performance.now() - startedAt) / 1000),
      timing: 'normal, virtual clock only', kind: 'real domain/service simulation; not browser or full autonomous player testing',
      commissionsRulesSha256: commissionRulesHash, riskScenarioSeed: 20261023,
      assumptions: ['No gift sales, task/achievement cash or borrowing is counted. Initial gifted rough remains unused in main cohorts.',
        'Every cohort starts at the real 12000 cash with no equipment and no employees, then purchases real catalog equipment with a protected operating reserve.',
        'Full player normalization is applied on daily login and persisted JSON reload; actual commission start/claim, payroll, recruitment, earn/spend and progression run for every action.',
        'Processing and reaction time both count as effective business time. First full line requires all three purchased used machines and at least the reserve remaining.',
        'Existing equipment is retained as an asset; no guaranteed resale credit is fabricated. Hiring expenses are reported separately and never capitalized as liquid assets.',
        'Skilled/frequent staff are an explicit wage stress case; no assistant output is credited to the proprietor-only labor scenario.',
        'No live server, real world file or persistent player save is read or mutated.'] },
    groups, roi: roiTable(), commissionContracts: commissionContractMatrix(), resale, riskyRough,
    assertions: { ordinaryCohortOperatingP10Nonnegative: groups.ordinary.operatingProfit.p10 >= 0,
      ordinaryDailyP10Nonnegative: groups.ordinary.dailyOperatingProfit.p10 >= 0,
      allPlannedPlayersSolvent: Object.values(groups).every(group => group.debtAccounts === 0 && group.lowestReserveSurplus >= 0),
      allCohortsReachUsedLine: Object.values(groups).every(group => group.fullLineReachedShare === 1) },
    accounts: outcomes
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(outputData, null, 2));
  const notes = [
    '# 经济成长仿真记录', '',
    `本次运行 ${accounts} 个账户、${days} 日，四组分别使用真实来料开单/领取、设备购买、工资、经营记账与JSON重载。正常加工时间只用虚拟时钟推进，没有加速产出或赠送钱。`, '',
    '| 组别 | 每日计划时长 | 日经营净利P10 | 首套旧机与4000储备所需有效小时中位 | 期末现金中位 | 期末仍有升级目标 |',
    '|---|---:|---:|---:|---:|---|',
    ...Object.values(groups).map(group => `| ${group.profile.label} | ${group.profile.minutes}分钟 | ${group.dailyOperatingProfit.p10} | ${group.firstFullLineHours.median} | ${group.operatingCash.median} | ${Object.keys(group.nextGoals).join('、')} |`), '',
    '经营净利扣除了来料单工位、耗材、维护和实际员工工资；设备与招聘作为一次性投入另列。未把设备购买记成经营亏损，也未把未卖出的旧机假设为已变现现金。礼包、任务、成就、借款均未计入收益。', '',
    `全部计划账户无工资债，并保留规定周转储备。JSON重载 ${Object.values(groups).reduce((sum, group) => sum + group.persistedReloads, 0)} 次；重复领取拒绝 ${Object.values(groups).reduce((sum, group) => sum + group.duplicateClaimsRejected, 0)} 次。`, '',
    '整线按完整新增采购、不卖旧机计算的增量回本：' + outputData.roi.filter(row => row.fullPurchasePaybackHours != null).map(row => `${row.id} ${row.fullPurchasePaybackHours}小时`).join('；') + '。该值为无操作间隔的报价上界，真实操作回本会更慢。', '',
    `现货转销上界假设NPC无限供货、已有30000本金并实际支付10000直播许可：98%估值买入、103%卖出的日利润 ${resale.find(row => row.purchaseRatio === .98).daily.mean}；90%清仓买入的日利润 ${resale.find(row => row.purchaseRatio === .90).daily.mean}，均运行每天1小时且受共享客户需求限制。真实清仓供货还会更少。不能由此宣称每笔买卖都不亏：105%买入转103%出售仍是主动错误决策。`, '',
    `另跑 ${riskyRough.n} 块自购暗料的急售风险场景：最多取3件、余料立即20%回收、成品实际65%批发且受日额度限制。亏损占比 ${round((riskyRough.lossShare || 0) * 100)}%，均值 ${riskyRough.netCash?.mean ?? 0}。这一结果只说明该急售策略不适合当保本路线，不是所有规划/销售策略的最优利润；没有用来料收入抵消暗料亏损。`, '',
    '此为真实领域服务驱动的限定策略仿真，并非一万名真人或完整浏览器行为测试。账户反应间隔、每日时长、购机策略是公开模型假设。安全稳定收益结论适用于来料加工主线，自购暗料仍需选料、完整取料与销售策略。', '',
    `复验：node scripts/economy-progression-simulation.mjs --accounts=${accounts} --days=${days} --raw=${rawCount}`, ''
  ].join('\n');
  fs.writeFileSync(path.join(path.dirname(output), 'simulation-notes.md'), notes);
  assert.ok(Object.values(outputData.assertions).every(Boolean), 'economic acceptance assertion failed; inspect the recorded output');
  console.log(JSON.stringify({ output, metadata: outputData.metadata, assertions: outputData.assertions,
    groups: Object.fromEntries(Object.entries(groups).map(([key, group]) => [key, { accounts: group.accounts,
      dailyP10: group.dailyOperatingProfit.p10, profitMedian: group.operatingProfit.median,
      cashMedian: group.operatingCash.median, firstLineHours: group.firstFullLineHours,
      reserve: group.lowestReserveSurplus, nextGoals: group.nextGoals }])), roi: outputData.roi,
    resale: resale.map(({ sampleDays, ...row }) => row), riskyRough: { n: riskyRough.n, lossShare: riskyRough.lossShare, netCash: riskyRough.netCash } }, null, 2));
} finally {
  Date.now = realNow; Math.random = realRandom;
}
process.exit(0);
