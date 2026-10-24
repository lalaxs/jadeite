import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "acorn";
import { materialStageFor, takeItem, markInventoryItemNew } from "../server/services/inventory-service.js";
import { qualityByKey } from "../server/services/rough-pool-service.js";
import { OWNER_OPERATOR_ID } from "../shared/domain/economy/public-workstations.js";
import { createMutationTracking } from "../server/persistence/mutation-scope.js";

const directory = "scripts/fixtures/workshop-server-baseline";
const contract = JSON.parse(readFileSync(`${directory}/server-contract.json`, "utf8"));
const players = JSON.parse(readFileSync(`${directory}/players.json`, "utf8"));
let original = readFileSync(`${directory}/server-service.js`, "utf8");
assert.equal(createHash("sha256").update(original.replaceAll("\r\n", "\n")).digest("hex"), contract.normalizedSourceSha256);
for (const node of parse(original, { ecmaVersion: "latest", sourceType: "module" }).body.reverse()) {
  if (node.type !== "ImportDeclaration") continue;
  original = original.slice(0, node.source.start) + JSON.stringify(pathToFileURL(path.resolve("server/services", node.source.value)).href) + original.slice(node.source.end);
}
const before = (await import(`data:text/javascript;base64,${Buffer.from(original).toString("base64")}`)).createWorkshopService;
const after = (await import(process.env.WORKSHOP_SERVER_CANDIDATE_URL || pathToFileURL(path.resolve("server/services/workshop-service.js")).href)).createWorkshopService;
Date.now = () => contract.now;

function harness(create, variant = "owned") {
  const player = structuredClone(players[variant]);
  const trace = [], outputs = [];
  const holder = { value: { players: new Map([[player.id, player]]), sockets: new Map(), news: [] } };
  const context = { player, holder, trace, outputs, online: new Set([player.id]), rejectSpend: false, rejectReport: false };
  let ids = 0;
  const record = (...event) => trace.push(structuredClone(event));
  const deps = {
    money: value => Math.max(0, Math.round(Number(value) || 0)), clamp: (value, low, high) => Math.max(low, Math.min(high, value)),
    spendCash(p, amount, reason, options) {
      record("spend", p.id, amount, reason, options);
      if (context.rejectSpend || p.cash < amount) return false;
      p.cash -= amount; return true;
    },
    takeItem(p, type, id) { record("take", p.id, type, id); return takeItem(p, type, id); },
    markInventoryItemNew(item) { record("unseen", item.id); return markInventoryItemNew(item); },
    normalizePlayer(p) {
      record("normalize", p.id);
      for (const name of ["rough", "materials", "slices", "bracelets", "jobs", "polishingJobs", "cuttingJobs", "workshopDeliveries"]) p[name] ||= [];
    },
    materialStageFor, qualityByKey,
    refreshPlayerReport(p, now) {
      record("report", p.id, now, p.cash, p.jobs.map(job => job.id), p.workshopDeliveries.map(delivery => delivery.id));
      if (context.rejectReport) throw new Error("injected report failure");
    },
    advanceTask(p, event) { record("task", p.id, event); },
    addNews(text, tone) { record("news", text, tone); holder.value.news.push({ text, tone }); },
    emitUiEventToPlayer(p, event) { record("ui", p.id, event); },
    getState() { record("getState"); return holder.value; },
    isPlayerOnline(p) { record("online", p.id); return context.online.has(p.id); },
    broadcast() { record("broadcast"); },
    randomUUID() { const id = `workshop-test-${++ids}`; record("id", id); return id; },
    refillOrders(p) { record("refillOrders", p.id); }, TIMING_PROFILE: "normal"
  };
  context.service = create(deps);
  assert.deepEqual(Object.keys(context.service), contract.methods, "public method names and enumeration order stay compatible");
  context.call = (method, ...args) => {
    const result = context.service[method](...args);
    outputs.push([method, structuredClone(result)]);
    return result;
  };
  context.device = (stage, isPublic = false) => context.service.workshopDevicesForPlayer(player).find(device => device.stage === stage && Boolean(device.publicStation) === isPublic);
  return context;
}
function withRandom(context, operation, roll) {
  const saved = Math.random;
  let count = 0;
  Math.random = () => {
    const value = roll ?? (.91 + (count++ % 9) / 100);
    context.trace.push(["random", value]); return value;
  };
  try { return operation(); } finally { Math.random = saved; }
}
const material = context => context.player.materials.find(item => item.id === "baseline-opened");
const blank = (context, id = "baseline-bangle") => context.player.bracelets.find(item => item.id === id);
const kits = [{ type: "leafPendant", x: 30, y: 40, rot: 27, size: "M" }, { type: "cabochon", x: 70, y: 42, rot: 0, size: "M" }];
const banglePlan = { process: "bangle", productType: "bangle", refinementId: "standard", polishId: "soft" };
const inlayPlan = { productType: "pendant", settingId: "micro", metalId: "platinum", gemId: "diamond", gemCount: 1, polishId: "soft", backingId: null };
function start(context, stage, item, payload = {}, isPublic = false) {
  const device = context.device(stage, isPublic);
  return context.call("startWorkshopJobForPlayer", context.player, device.id, { itemId: item.id, workerId: device.workerId, ...payload });
}
function finish(context) {
  const job = context.player.jobs.at(-1);
  assert.ok(job, "scenario actually started a production job");
  job.readyAt = contract.now - 1;
  const events = context.call("settleProductionJobsForPlayer", context.player, contract.now);
  assert.equal(context.player.jobs.length, 0);
  assert.ok(events.length);
  return job;
}
function claim(context) {
  const delivery = context.player.workshopDeliveries.at(-1);
  assert.ok(delivery, "successful production creates a handover batch");
  assert.equal(context.call("claimWorkshopDeliveryForPlayer", context.player, delivery.id).ok, false, "cannot claim before reveal");
  assert.equal(context.call("revealWorkshopDeliveryForPlayer", context.player, delivery.id).ok, true);
  if (delivery.scratchReveal?.itemIds.length) {
    assert.equal(context.call("claimWorkshopDeliveryForPlayer", context.player, delivery.id).ok, false, "scratch progress remains authoritative");
    assert.equal(context.call("revealWorkshopDeliveryForPlayer", context.player, delivery.id, { itemIds: delivery.scratchReveal.itemIds }).ok, true);
  }
  assert.equal(context.call("claimWorkshopDeliveryForPlayer", context.player, delivery.id).ok, true);
  assert.equal(context.call("claimWorkshopDeliveryForPlayer", context.player, delivery.id).ok, false, "handover cannot duplicate outputs");
}
const cases = [
  ["lookup-and-legacy-stage", "owned", c => {
    for (const device of c.service.workshopDevicesForPlayer(c.player)) {
      c.call("workshopDeviceForPlayer", c.player, device.id);
      c.call("workshopJobsForDevice", c.player, device.id);
      c.call("workshopProcessableItems", c.player, device.id);
    }
    for (const stage of ["rough", "refine", "inlay", "opening"]) c.call("legacyDeviceIdForStage", stage);
    c.call("workshopWorkerForPlayer", c.player, OWNER_OPERATOR_ID);
    c.call("productBaseName", { name: "冰种挂件精雕毛坯" });
    c.call("stagedProduct", structuredClone(blank(c)), "carved", "精雕毛坯", 1.05);
    c.call("wsApplyWorker", structuredClone(blank(c)), 1.03, 1.02, c.player.workshop.workers[0]);
  }],
  ["invalid-start-inputs", "owned", c => {
    assert.equal(c.call("startWorkshopJobForPlayer", null, "opening").ok, false);
    assert.equal(c.call("startWorkshopJobForPlayer", c.player, "missing").ok, false);
    assert.equal(start(c, "opening", c.player.rough[0], { workerId: "missing" }).ok, false);
    assert.equal(start(c, "opening", c.player.rough[0], { itemId: "missing" }).ok, false);
    assert.equal(start(c, "opening", material(c)).ok, false);
  }],
  ["listed-machine", "owned", c => { c.player.workshop.devices[0].blackmarketListingId = "listed"; assert.equal(start(c, "opening", c.player.rough[0]).code, "RESOURCE_LISTED"); }],
  ["broken-machine", "owned", c => { c.player.workshop.devices[0].condition = 0; assert.equal(start(c, "opening", c.player.rough[0]).ok, false); }],
  ["machine-busy", "owned", c => { const item = c.player.rough[0]; assert.equal(start(c, "opening", item).ok, true); assert.equal(start(c, "opening", item).ok, false); }],
  ["commission-lock", "owned", c => { c.player.commissions = { active: { id: "commission", name: "来料单", deviceIds: [c.player.workshop.devices[0].id] } }; assert.equal(start(c, "opening", c.player.rough[0]).code, "BUSY"); c.call("workshopJobsForDevice", c.player, c.player.workshop.devices[0].id); }],
  ["owner-commission-lock", "starter", c => { c.player.commissions = { active: { id: "commission", deviceIds: [] } }; assert.equal(start(c, "opening", c.player.rough[0], {}, true).code, "WORKER_BUSY"); }],
  ["stopped-payroll", "owned", c => { Object.assign(c.player.employeePayroll, { status: "stopped", debt: 1500 }); assert.equal(start(c, "opening", c.player.rough[0]).ok, false); }],
  ["opening-and-authoritative-handover", "owned", c => {
    const input = c.player.rough[0]; assert.equal(start(c, "opening", input).ok, true);
    const job = finish(c); const condition = c.player.workshop.devices[0].condition;
    assert.equal(c.call("applyJobDurability", c.player, job), 0, "durability applies once");
    assert.equal(c.player.workshop.devices[0].condition, condition); claim(c);
    assert.ok(c.player.materials.some(item => item.id === input.id));
  }],
  ["public-fee-and-owner", "starter", c => {
    const input = c.player.rough[0]; delete input.starterProtection; const cash = c.player.cash;
    const result = start(c, "opening", input, {}, true); assert.equal(result.ok, true);
    assert.equal(result.job.fee, 25); assert.equal(c.player.cash, cash - 25);
    finish(c); claim(c); assert.equal(c.player.workshop.devices.length, 0);
  }],
  ["public-gift-fee-waiver", "starter", c => { const result = start(c, "opening", c.player.rough[0], {}, true); assert.equal(result.ok, true); assert.equal(result.job.fee, 0); }],
  ["public-cash-shortage", "starter", c => { delete c.player.rough[0].starterProtection; c.player.cash = 0; assert.equal(start(c, "opening", c.player.rough[0], {}, true).code, "INSUFFICIENT_CASH"); }],
  ["carving-value-pool-and-escrow", "owned", c => {
    Object.assign(material(c), { escrowOrderId: "escrow", escrowFromBuyerId: "buyer" });
    assert.equal(start(c, "carving", material(c), { kits }).ok, true); finish(c);
    const batch = c.player.workshopDeliveries.at(-1); assert.equal(batch.items.length, 2);
    assert.equal(batch.auxiliaryItems.length, 1); assert.ok(batch.items.every(item => item.escrowOrderId === "escrow"));
    assert.equal(batch.auxiliaryItems[0].escrowOrderId, undefined); claim(c);
  }],
  ["legacy-placement-input", "owned", c => { assert.equal(start(c, "carving", material(c), { placements: [{ id: "legacy-kit", x: 50, y: 50, ringSize: 56, rot: 17 }] }).ok, true); finish(c); }],
  ["overlapping-planning", "owned", c => { assert.equal(start(c, "carving", material(c), { kits: [kits[0], kits[0]] }).ok, false); assert.equal(c.player.jobs.length, 0); }],
  ["bangle-finishing", "owned", c => { assert.equal(start(c, "finishing", blank(c), { finishPlan: banglePlan }).ok, true); finish(c); claim(c); assert.equal(blank(c).materialStage, "finished"); }],
  ["inlay-finishing", "owned", c => { assert.equal(start(c, "finishing", blank(c, "baseline-cabochon"), { finishPlan: inlayPlan }).ok, true); finish(c); claim(c); }],
  ["material-reservation-rejection", "owned", c => { c.player.externalMaterials = {}; const item = blank(c, "baseline-cabochon"); assert.equal(start(c, "finishing", item, { finishPlan: inlayPlan }).ok, false); assert.ok(c.player.bracelets.some(row => row.id === item.id)); }],
  ["fee-failure-restores-reserved-materials", "owned", c => {
    const item = blank(c, "baseline-cabochon"); delete item.starterProtection;
    const stock = structuredClone(c.player.externalMaterials); c.rejectSpend = true;
    assert.equal(start(c, "finishing", item, { finishPlan: inlayPlan, workerId: OWNER_OPERATOR_ID }, true).ok, false);
    assert.deepEqual(c.player.externalMaterials, stock); assert.equal(c.player.jobs.length, 0);
  }],
  ["opening-starter-failure", "owned", c => { const item = c.player.rough[0]; assert.equal(start(c, "opening", item).ok, true); finish(c); assert.ok(c.player.rough.some(row => row.id === item.id)); assert.equal(c.player.workshopDeliveries.length, 0); }, 0],
  ["carving-starter-failure", "owned", c => { const item = material(c); assert.equal(start(c, "carving", item, { kits }).ok, true); finish(c); assert.ok(c.player.materials.some(row => row.id === item.id)); assert.equal(c.player.workshopDeliveries.length, 0); }, 0],
  ["finishing-failure-refunds", "owned", c => { const item = blank(c, "baseline-cabochon"); const stock = structuredClone(c.player.externalMaterials); assert.equal(start(c, "finishing", item, { finishPlan: inlayPlan }).ok, true); finish(c); assert.ok(c.player.bracelets.some(row => row.id === item.id)); assert.deepEqual(c.player.externalMaterials, stock); assert.equal(c.player.workshopDeliveries.length, 0); }, 0],
  ["assign-current-device-reference", "owned", c => {
    const device = c.device("opening"), worker = c.player.workshop.workers.find(worker => worker.id !== device.workerId);
    const result = c.call("assignWorkshopWorkerForPlayer", c.player, { deviceId: device.id, workerId: worker.id });
    assert.equal(result.ok, true); assert.equal(result.device, c.player.workshop.devices.find(row => row.id === device.id));
    assert.equal(c.call("assignWorkshopWorkerForPlayer", c.player, { deviceId: c.device("opening", true).id, workerId: OWNER_OPERATOR_ID }).ok, false);
  }],
  ["legacy-job-and-pending-job", "owned", c => {
    const rough = c.player.rough.shift(); c.player.polishingJobs.push({ id: "legacy", rough, readyAt: contract.now - 1 });
    c.player.jobs.push({ id: "future", stage: "opening", item: structuredClone(rough), readyAt: contract.now + 60000 });
    c.call("normalizeProductionJob", c.player.polishingJobs[0]); c.call("settleProductionJobsForPlayer", c.player, contract.now);
    assert.deepEqual(c.player.jobs.map(job => job.id), ["future"]); assert.equal(c.player.polishingJobs.length, 0);
  }],
  ["online-offline-and-broadcast", "owned", c => {
    assert.equal(start(c, "opening", c.player.rough[0]).ok, true); c.player.jobs[0].readyAt = contract.now - 1;
    c.online.clear(); assert.equal(c.call("processProductionJobs", contract.now), false);
    assert.equal(c.call("processProductionJobs", contract.now, { onlineOnly: false, broadcast: false }), true);
    assert.equal(c.player.jobs.length, 0);
  }],
  ["mutable-participants-and-rollback", "owned", c => {
    assert.equal(start(c, "opening", c.player.rough[0]).ok, true); c.player.jobs[0].readyAt = contract.now - 1;
    const idle = structuredClone(players.starter); idle.id = "idle-player"; c.holder.value.players.set(idle.id, idle);
    const state = c.holder.value; const tracking = createMutationTracking(state, () => {}, 1);
    const saved = structuredClone([...state.players]); const transaction = tracking.begin(contract.now); c.rejectReport = true;
    assert.throws(() => transaction.run(() => c.service.processProductionJobs(contract.now, { onlineOnly: false })), /injected report failure/);
    assert.deepEqual(transaction.snapshots().before.players.map(([id]) => id), [c.player.id], "only matching mutable player roots join the transaction");
    transaction.rollback(); assert.deepEqual([...state.players], saved, "rollback restores job, item, durability, payroll and handover together");
    c.rejectReport = false; c.call("processProductionJobs", contract.now, { onlineOnly: false });
    assert.equal(state.players.get(c.player.id).jobs.length, 0, "retry reacquires the rolled-back player rather than retaining an abandoned reference");
  }]
];

function run(create, variant, operation, roll) {
  const context = harness(create, variant);
  withRandom(context, () => operation(context), roll);
  return { outputs: context.outputs, trace: context.trace, players: structuredClone([...context.holder.value.players]), news: context.holder.value.news };
}
for (const [name, variant, operation, roll] of cases) {
  assert.deepEqual(run(after, variant, operation, roll), run(before, variant, operation, roll), `${name}: state, numeric values, ids, random consumption and ordered effects must match`);
}

const first = harness(after), second = harness(after);
const untouched = structuredClone(second.player);
withRandom(first, () => { assert.equal(start(first, "opening", first.player.rough[0]).ok, true); });
assert.deepEqual(second.player, untouched, "independently created service instances cannot share player/job state");
const abandoned = first.player;
const replacement = structuredClone(players.owned); replacement.jobs = structuredClone(first.player.jobs); replacement.jobs[0].readyAt = contract.now - 1;
first.holder.value = { players: new Map([[replacement.id, replacement]]), sockets: new Map(), news: [] };
withRandom(first, () => { assert.equal(first.service.processProductionJobs(contract.now), true); });
assert.equal(abandoned.jobs.length, 1, "world replacement does not mutate the old world");
assert.equal(replacement.jobs.length, 0, "the runtime reads the current injected world on every call");
assert.deepEqual(second.player, untouched);
console.log(`workshop-server-equivalence-smoke: ${cases.length} differential scenarios, ${contract.methods.length} APIs, exact state/effect/RNG/id equivalence, isolated instances, dynamic worlds and transactional rollback ok`);
