import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const workshopSource = readFileSync("public/workshop-module.js", "utf8");
assert.match(
  workshopSource,
  /import\s*\{\s*WORKER_SKILL_DEFS,\s*renderWorkerDetailPanel\s*\}\s*from "\.\/worker-detail-view\.js"/
);
assert.doesNotMatch(workshopSource, /const SKILL_DEFS\s*=/);
assert.match(workshopSource, /WORKER_SKILL_DEFS\[key\]\.full\s*\*\s*skillK/);

const extraSource = readFileSync("public/extra-module.js", "utf8");
assert.match(extraSource, /data-action="openRecruitCandidateDetail"/);
assert.match(extraSource, /if\s*\(!root\.querySelector\("\.recruit-detail-modal"\)\)/);
assert.match(extraSource, /patchRecruitDetailView\(root,\s*\{/);
assert.match(extraSource, /socketRef\.emit\("recruitWorker",[\s\S]*?,\s*\(result = \{\}\) =>/);

const server = readFileSync("server.js", "utf8");
assert.match(server, /socket\.on\("recruitWorker",\s*\(payload = \{\}, acknowledge\)/);
assert.match(server, /typeof acknowledge === "function"/);

console.log("worker-detail-view-smoke: shared nine-skill detail and recruit ack guard ok");
