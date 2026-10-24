import { readWorkshopSource } from "./load-workshop-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadResolvedStyles } from "./load-styles.mjs";
import {
  WORKER_SKILL_DEFS,
  renderWorkerDetailPanel,
  workerJobLabel,
  workerStepForJob
} from "../public/worker-detail-view.js";
import { patchRecruitDetailView } from "../public/recruit-detail-dom.js";

const skills = {};
for (const [key, definition] of Object.entries(WORKER_SKILL_DEFS)) {
  skills[definition.dir] ||= {};
  skills[definition.dir][key] = { level: 3, exp: 20 };
}

const worker = {
  id: "candidate-1",
  name: "小满",
  tier: 4,
  job: "planner",
  traits: ["净料"],
  flaws: ["手重"],
  skills
};

const workshopHtml = renderWorkerDetailPanel({
  worker,
  step: "plan",
  mode: "workshop",
  summaryHtml: "<div>工分 74</div>",
  footerHtml: "<button>选择</button>"
});
const recruitHtml = renderWorkerDetailPanel({
  worker,
  step: workerStepForJob(worker.job),
  mode: "recruit",
  footerHtml: "<button>确认招募</button>"
});

assert.deepEqual(
  Object.fromEntries(Object.entries(WORKER_SKILL_DEFS).map(([key, value]) => [key, value.full])),
  {
    jieliao: 18,
    damo: 15,
    qieliao: 12,
    xiuxing: 14,
    diaozhuo: 22,
    xiangqian: 16,
    huashu: 12,
    kongchang: 10,
    cuidan: 10
  },
  "shared display definitions must preserve the workshop formula constants"
);
assert.equal((workshopHtml.match(/class="wsp-skill-card /g) || []).length, 9);
assert.equal((recruitHtml.match(/class="wsp-skill-card /g) || []).length, 9);
for (const definition of Object.values(WORKER_SKILL_DEFS)) {
  const renderedAttribute = `${definition.attr}：${definition.full}`;
  assert.ok(
    workshopHtml.includes(`<span class="wsp-skill-attr">${renderedAttribute}</span>`),
    `workshop detail should visibly render ${renderedAttribute}`
  );
  assert.ok(
    recruitHtml.includes(`<span class="wsp-skill-attr">${renderedAttribute}</span>`),
    `recruit detail should visibly render ${renderedAttribute}`
  );
}
assert.match(workshopHtml, /净料/);
assert.match(workshopHtml, /净料处理到位，减少脏点 \/ 棉絮。/);
assert.match(recruitHtml, /手重/);
assert.match(recruitHtml, /下手偏重，压裂 \/ 崩口风险略高。/);
assert.match(recruitHtml, /确认招募/);
assert.match(recruitHtml, /规划师傅/);
assert.match(recruitHtml, /class="wsp-tier-badge" style="background:linear-gradient/);
assert.match(recruitHtml, /Lv\.3/);
assert.match(recruitHtml, /20 \/ 150/);
assert.equal(workerStepForJob("planner"), "plan");
assert.equal(workerStepForJob("streamer"), "speak");
assert.equal(workerJobLabel("finisher"), "精加工师傅");

let detailWrites = 0;
let footerWrites = 0;
const detailScroller = { scrollTop: 126 };
const detailBody = {
  dataset: {},
  _html: "",
  get innerHTML() {
    return this._html;
  },
  set innerHTML(value) {
    detailWrites += 1;
    this._html = value;
    detailScroller.scrollTop = 0;
  }
};
const detailFooter = {
  _html: "",
  get innerHTML() {
    return this._html;
  },
  set innerHTML(value) {
    footerWrites += 1;
    this._html = value;
  }
};
const detailRoot = {
  querySelector(selector) {
    if (selector === "[data-recruit-detail-body]") return detailBody;
    if (selector === "[data-recruit-footer]") return detailFooter;
    return null;
  }
};
patchRecruitDetailView(detailRoot, {
  candidateId: worker.id,
  detailHtml: recruitHtml,
  footerHtml: "<button>正在招募…</button>"
});
assert.equal(detailWrites, 1);
detailScroller.scrollTop = 126;
patchRecruitDetailView(detailRoot, {
  candidateId: worker.id,
  detailHtml: recruitHtml,
  footerHtml: "<p>现金不足</p><button>确认招募</button>"
});
assert.equal(detailWrites, 1, "same candidate refresh must retain detail DOM identity");
assert.equal(footerWrites, 2, "acknowledgement state should patch only the footer");
assert.equal(detailScroller.scrollTop, 126, "failed acknowledgement should preserve detail scroll");

const workshopSource = readWorkshopSource();
const craftScoringSource = readFileSync("public/workshop-craft-scoring.js", "utf8");
const sharedCraftScoringSource = readFileSync("shared/domain/workshop/workshop-craft-scoring.js", "utf8");
assert.match(
  workshopSource,
  /import\s*\{[^}]*\brenderWorkerDetailPanel\b[^}]*\}\s*from "\.\.\/\.\.\/worker-detail-view\.js"/
);
assert.match(
  craftScoringSource,
  /export \* from '\.\.\/shared\/domain\/workshop\/workshop-craft-scoring\.js'/
);
assert.doesNotMatch(workshopSource, /const SKILL_DEFS\s*=/);
assert.match(sharedCraftScoringSource, /export const WORKER_SKILL_DEFS/);
assert.match(sharedCraftScoringSource, /WORKER_SKILL_DEFS\[key\]\?\.full[\s\S]*skillK/);

const hireSource = readFileSync("public/features/hire/hire-module.js", "utf8");
assert.match(hireSource, /data-action="openRecruitCandidateDetail"/);
assert.match(hireSource, /if\s*\(!root\.querySelector\("\.recruit-detail-modal"\)\)/);
assert.match(hireSource, /patchRecruitDetailView\(root,\s*\{/);
assert.match(hireSource, /createRecruitDetailController\(\{/);
assert.match(hireSource, /emit:\s*\(event, payload, acknowledge\) => socketRef\.emit\(event, payload, acknowledge\)/);

const socketHandlers = readFileSync("server/shell/socket-handlers.js", "utf8");
assert.match(socketHandlers, /socket\.on\("recruitWorker",\s*\(payload = \{\}, acknowledge\)/);
assert.match(socketHandlers, /socket\.on\("dismissWorker",\s*\(payload = \{\}, acknowledge\)/);
assert.match(socketHandlers, /typeof acknowledge === "function"/);

const styles = loadResolvedStyles();assert.match(
  styles,
  /\.game-modal\.recruit-detail-modal\s*\{[^}]*width:\s*min\(860px,\s*100%\)[^}]*overflow:\s*hidden/
);
assert.match(
  styles,
  /\.recruit-detail-modal \.mode-recruit\s*\{[^}]*max-height:\s*calc\(100dvh - 36px\)[^}]*overflow:\s*auto/
);
assert.match(
  styles,
  /@media \(max-width: 767px\)[\s\S]*?\.game-modal\.recruit-detail-modal\s*\{[^}]*width:\s*calc\(100vw - 24px\)[^}]*overflow:\s*hidden/
);

console.log("worker-detail-view-smoke: shared nine-skill detail and recruit ack guard ok");
