import assert from "node:assert/strict";
import {
  ensureRecruitCandidates,
  refreshRecruitCandidates,
  recruitWorker,
  dismissWorker,
  mergeWorkers,
  isWorkerBusy,
  isStarterWorkerId,
  grantActivityExperience,
  workerProcessingFee,
  baseWageForTier,
  recruitPrice
} from "../server/systems/employee-system.js";

const seq = [0.10, 0.20, 0.30, 0.40, 0.50];
let index = 0;
const rng = () => seq[index++ % seq.length];
const makeId = (() => {
  let n = 0;
  return () => `candidate-${++n}`;
})();
const spendCash = (player, amount) => {
  if (player.cash < amount) return false;
  player.cash -= amount;
  return true;
};

const player = {
  cash: 50000,
  workshop: { workers: [] },
  jobs: [],
  livestreamJobs: []
};

const feeWorker = { tier: 3, baseWage: 440 };
assert.equal(workerProcessingFee(feeWorker), 0);
assert.equal(workerProcessingFee(feeWorker, 0, { stage: "opening", itemValue: 10_000 }), 0);
assert.equal(workerProcessingFee(feeWorker, 200, { stage: "carving", itemValue: 100_000 }), 0);
assert.deepEqual(
  Array.from({ length: 10 }, (_, index) => baseWageForTier(index + 1)),
  [100, 140, 190, 250, 320, 400, 490, 590, 700, 820]
);
assert.deepEqual(
  Array.from({ length: 8 }, (_, index) => recruitPrice(index + 1)),
  [2_800, 4_800, 7_500, 11_000, 15_500, 21_000, 27_500, 35_000]
);

const elitePlayer = { workshop: { workers: [] } };
ensureRecruitCandidates(elitePlayer, { rng: () => 0.999, makeId });
assert.equal(elitePlayer.recruitCandidates.every((candidate) => candidate.tier === 8), true);
assert.equal(
  elitePlayer.recruitCandidates.every((candidate) => candidate.skills.speak.huashu.level <= 10),
  true
);

assert.equal(ensureRecruitCandidates(player, { rng, makeId }).length, 3);
assert.equal(player.cash, 50000);
assert.equal(
  refreshRecruitCandidates(player, { rng, makeId, spendCash }).ok,
  true
);
assert.equal(player.cash, 49650);

const candidate = player.recruitCandidates[0];
const hire = recruitWorker(player, candidate.id, { spendCash });
assert.equal(hire.ok, true);
assert.equal(player.workshop.workers.length, 1);

const duplicateHirePlayer = {
  cash: 50000,
  workshop: { workers: [{ id: "candidate-conflict", name: "已入职" }] },
  recruitCandidates: [{ id: "candidate-conflict", name: "重复候选", price: 2700 }]
};
const duplicateHireCash = duplicateHirePlayer.cash;
const duplicateHire = recruitWorker(duplicateHirePlayer, "candidate-conflict", { spendCash });
assert.equal(duplicateHire.ok, false);
assert.equal(duplicateHire.code, "ID_CONFLICT");
assert.equal(duplicateHirePlayer.cash, duplicateHireCash, "worker id conflicts must fail before payment");
assert.equal(duplicateHirePlayer.workshop.workers.length, 1);

const ambiguousCandidatePlayer = {
  cash: 50000,
  workshop: { workers: [] },
  recruitCandidates: [
    { id: "candidate-ambiguous", name: "候选甲", price: 2700 },
    { id: "candidate-ambiguous", name: "候选乙", price: 2700 }
  ]
};
const ambiguousCandidateCash = ambiguousCandidatePlayer.cash;
const ambiguousHire = recruitWorker(ambiguousCandidatePlayer, "candidate-ambiguous", { spendCash });
assert.equal(ambiguousHire.ok, false);
assert.equal(ambiguousHire.code, "ID_CONFLICT");
assert.equal(ambiguousCandidatePlayer.cash, ambiguousCandidateCash);
assert.equal(ambiguousCandidatePlayer.workshop.workers.length, 0);

player.jobs.push({ workerId: hire.worker.id });
assert.equal(isWorkerBusy(player, hire.worker.id), true);
assert.equal(
  dismissWorker(player, hire.worker.id).code,
  "BUSY",
  "busy recruit cannot be dismissed"
);
assert.equal(player.workshop.workers.length, 1);

player.jobs = [];
assert.equal(isWorkerBusy(player, hire.worker.id), false);
const dismissed = dismissWorker(player, hire.worker.id);
assert.equal(dismissed.ok, true);
assert.equal(player.workshop.workers.length, 0);
assert.equal(dismissed.worker.id, hire.worker.id);

assert.equal(isStarterWorkerId("worker-opening"), true);
player.workshop.workers.push({ id: "worker-opening", name: "阿成" });
const starterDismiss = dismissWorker(player, "worker-opening");
assert.equal(starterDismiss.ok, true, "starter workers can be dismissed");
assert.equal(player.workshop.workers.some((w) => w.id === "worker-opening"), false);
assert.deepEqual(player.workshop.dismissedStarterIds, ["worker-opening"]);
assert.equal(
  mergeWorkers(
    [{ id: "worker-opening", name: "阿成" }, { id: "worker-carving", name: "林师傅" }],
    player.workshop.workers,
    { dismissedStarterIds: player.workshop.dismissedStarterIds }
  ).some((w) => w.id === "worker-opening"),
  false,
  "dismissed starters must not be restored by mergeWorkers"
);
assert.equal(
  mergeWorkers(
    [{ id: "worker-opening", name: "阿成" }, { id: "worker-carving", name: "林师傅" }],
    player.workshop.workers,
    { dismissedStarterIds: player.workshop.dismissedStarterIds }
  ).some((w) => w.id === "worker-carving"),
  true
);
assert.equal(
  dismissWorker(player, "missing-worker").code,
  "NOT_FOUND"
);

const skill = hire.worker.skills.cut.jieliao;
skill.level = 1;
skill.exp = 45;
grantActivityExperience(hire.worker, "opening");
assert.equal(skill.level, 2);
assert.equal(skill.exp, 5);

skill.level = 9;
skill.exp = 445;
grantActivityExperience(hire.worker, "opening");
assert.equal(skill.level, 10);
assert.equal(skill.exp, 0);

const fullPlayer = {
  cash: 50000,
  workshop: {
    workers: Array.from({ length: 8 }, (_, n) => ({ id: `worker-${n}` }))
  },
  recruitCandidates: [structuredClone(player.recruitCandidates[0])]
};
const cashBeforeFullHire = fullPlayer.cash;
assert.equal(
  recruitWorker(fullPlayer, fullPlayer.recruitCandidates[0].id, { spendCash }).code,
  "ROSTER_FULL"
);
assert.equal(fullPlayer.cash, cashBeforeFullHire);

const exhaustedPlayer = {
  cash: 100000,
  workshop: { workers: [] },
  jobs: [],
  livestreamJobs: []
};
assert.equal(
  ensureRecruitCandidates(exhaustedPlayer, { rng, makeId }).length,
  3,
  "the first candidate batch should be generated for free"
);
for (const candidateId of exhaustedPlayer.recruitCandidates.map((item) => item.id)) {
  assert.equal(recruitWorker(exhaustedPlayer, candidateId, { spendCash }).ok, true);
}
const exhaustedCash = exhaustedPlayer.cash;
assert.equal(exhaustedPlayer.recruitCandidates.length, 0);
assert.equal(
  ensureRecruitCandidates(exhaustedPlayer, { rng, makeId }).length,
  0,
  "an exhausted free batch must not silently regenerate"
);
assert.equal(exhaustedPlayer.cash, exhaustedCash);
assert.equal(
  refreshRecruitCandidates(exhaustedPlayer, { rng, makeId, spendCash }).ok,
  true
);
assert.equal(exhaustedPlayer.cash, exhaustedCash - 350);
assert.equal(exhaustedPlayer.recruitCandidates.length, 3);

const hiredNames = new Set(
  exhaustedPlayer.workshop.workers.map((worker) => worker.name)
);
const refreshedNames = exhaustedPlayer.recruitCandidates.map((c) => c.name);
assert.equal(
  new Set(refreshedNames).size,
  refreshedNames.length,
  "refreshed candidates must not share names with each other"
);
for (const name of refreshedNames) {
  assert.equal(
    hiredNames.has(name),
    false,
    `refreshed candidate name "${name}" must not match a hired worker`
  );
}

const reservedPlayer = {
  cash: 50000,
  workshop: {
    workers: [
      { id: "w1", name: "阿良" },
      { id: "w2", name: "玉芬" },
      { id: "w3", name: "周师傅" }
    ]
  },
  jobs: [],
  livestreamJobs: []
};
assert.equal(
  refreshRecruitCandidates(reservedPlayer, { rng, makeId, spendCash }).ok,
  true
);
const reservedBatch = reservedPlayer.recruitCandidates.map((c) => c.name);
assert.equal(new Set(reservedBatch).size, reservedBatch.length);
assert.equal(reservedBatch.includes("阿良"), false);
assert.equal(reservedBatch.includes("玉芬"), false);
assert.equal(reservedBatch.includes("周师傅"), false);

console.log("employee-system-smoke: ok");
