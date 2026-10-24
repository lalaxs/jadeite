import { readWorkshopServiceSource } from "./load-workshop-service-source.mjs";
import { readWorkshopSource } from "./load-workshop-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FLAW_DEFS,
  FLAW_SCORE,
  GRADE_RULES,
  PERFECT_SCORE,
  PROCESS_BONUS_CAP,
  STEP_ATTR_WEIGHTS,
  WORKER_SKILL_DEFS,
  applyCraftValue,
  craftFlawTag,
  craftGrade,
  craftPerfectLabel,
  employeeShatterDefense,
  gradeMult,
  overallScore,
  skillAttrValue,
  skillK,
  speedTimeScale,
  stageToStep,
  stepScore,
  workerSkill,
  workerStepPreview,
  workerTierM,
  workshopShatterChance
} from "../public/workshop-craft-scoring.js";
import { WORKER_SKILL_DEFS as detailSkillDefs } from "../public/worker-detail-view.js";

const worker = {
  id: "w1",
  name: "测工",
  tier: 5,
  tierLevel: 1,
  flaws: ["手重"],
  skills: {
    cut: { jieliao: { level: 6, exp: 180 }, damo: { level: 5, exp: 150 } },
    set: { qieliao: { level: 3, exp: 80 }, xiuxing: { level: 2, exp: 50 } },
    finish: { diaozhuo: { level: 2, exp: 40 }, xiangqian: { level: 2, exp: 30 } },
    speak: { huashu: { level: 1, exp: 15 }, kongchang: { level: 1, exp: 10 }, cuidan: { level: 1, exp: 5 } }
  }
};

assert.deepEqual(detailSkillDefs, WORKER_SKILL_DEFS, "worker-detail must re-export shared skill defs");
assert.equal(PERFECT_SCORE, 100);
assert.equal(FLAW_SCORE, 35);
assert.equal(PROCESS_BONUS_CAP, 0.3);
assert.deepEqual(STEP_ATTR_WEIGHTS.open, { jieliao: 0.55, damo: 0.45 });
assert.deepEqual(
  Object.fromEntries(Object.entries(WORKER_SKILL_DEFS).map(([k, v]) => [k, v.full])),
  {
    jieliao: 18, damo: 15, qieliao: 12, xiuxing: 14,
    diaozhuo: 22, xiangqian: 16, huashu: 12, kongchang: 10, cuidan: 10
  }
);

assert.equal(stageToStep("rough"), "open");
assert.equal(stageToStep("opening"), "open");
assert.equal(stageToStep("refine"), "plan");
assert.equal(stageToStep("carving"), "plan");
assert.equal(stageToStep("inlay"), "finish");

const openScore = stepScore(worker, "open");
assert.ok(openScore > 0 && openScore <= 120);
assert.equal(craftGrade(openScore), GRADE_RULES.find((r) => openScore >= r.min).grade);
assert.equal(craftPerfectLabel(100), "完美");
assert.equal(craftPerfectLabel(20), "瑕疵");
assert.equal(craftPerfectLabel(70), "");
assert.equal(craftFlawTag({ flaws: ["易裂"] }), "裂");
assert.equal(craftFlawTag({ flaws: [] }), "绵");

const preview = workerStepPreview(worker, "open");
assert.equal(preview.quality, openScore);
assert.equal(preview.grade, craftGrade(openScore));
assert.ok(Array.isArray(preview.attrs) && preview.attrs.length === 2);

const overall = overallScore({ craftScores: { open: 80, plan: 90 } });
assert.ok(Math.abs(overall - (0.30 * 80 + 0.35 * 90) / (0.30 + 0.35)) < 1e-9);

const item = { baseValue: 1000, craftScore: 100 };
applyCraftValue(item, (100 / 100) * PROCESS_BONUS_CAP, gradeMult(100), worker, (v) => Math.round(v));
assert.equal(item.craftPerfect, true);
assert.equal(item.craftFlaw, null);
assert.equal(item.value, Math.round(1000 * (1 + PROCESS_BONUS_CAP) * gradeMult(100)));
assert.ok(skillK(1, 0) > 0);
assert.ok(workerTierM(worker) > 1);
assert.ok(skillAttrValue(worker, "jieliao") > 0);
assert.ok(speedTimeScale(worker) < 1);
assert.ok(Number.isFinite(employeeShatterDefense(worker)));
const riskyChance = workshopShatterChance({ risk: 1.2 }, worker, "rough");
const safeChance = workshopShatterChance({ risk: 0.8 }, worker, "rough");
assert.ok(riskyChance > safeChance);
assert.ok(riskyChance >= 0 && riskyChance <= 0.12);
assert.ok(workshopShatterChance({ risk: 9 }, worker, "finishing") <= 0.06);
assert.deepEqual(workerSkill(worker, "jieliao"), worker.skills.cut.jieliao);
assert.equal(FLAW_DEFS["巧手"], 0.05);

const serverSource = readFileSync("server.js", "utf8");
const wireSource = readFileSync("server/boot/wire-server.js", "utf8");
const bootSource = `${serverSource}\n${wireSource}`;
const workshopServiceSource = readWorkshopServiceSource();
assert.match(workshopServiceSource, /from "(?:\.\.\/){2,3}shared\/domain\/workshop\/workshop-craft-scoring\.js"/);
assert.match(bootSource, /createWorkshopService/);
assert.doesNotMatch(serverSource, /const WS_TIER_MULT\s*=/);
assert.doesNotMatch(serverSource, /const WS_STEP_ATTR_WEIGHTS\s*=/);
assert.doesNotMatch(serverSource, /const WS_GRADE_RULES\s*=/);

const workshopSource = readWorkshopSource();
assert.match(workshopSource, /from "\.\.\/\.\.\/workshop-craft-scoring\.js"/);
assert.doesNotMatch(workshopSource, /const STEP_ATTR_WEIGHTS\s*=/);
assert.doesNotMatch(workshopSource, /const TIER_MULT\s*=/);
assert.doesNotMatch(workshopSource, /const K_CURVE\s*=/);
assert.doesNotMatch(workshopSource, /与 server\.js 共用同一套/);

console.log("workshop-craft-scoring-smoke: ok");
