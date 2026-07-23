import assert from "node:assert/strict";
import {
  ensureRecruitCandidates,
  refreshRecruitCandidates,
  recruitWorker,
  isWorkerBusy,
  grantActivityExperience
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

assert.equal(ensureRecruitCandidates(player, { rng, makeId }).length, 3);
assert.equal(player.cash, 50000);
assert.equal(
  refreshRecruitCandidates(player, { rng, makeId, spendCash }).ok,
  true
);
assert.equal(player.cash, 49500);

const candidate = player.recruitCandidates[0];
const hire = recruitWorker(player, candidate.id, { spendCash });
assert.equal(hire.ok, true);
assert.equal(player.workshop.workers.length, 1);

player.jobs.push({ workerId: hire.worker.id });
assert.equal(isWorkerBusy(player, hire.worker.id), true);

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

console.log("employee-system-smoke: ok");
