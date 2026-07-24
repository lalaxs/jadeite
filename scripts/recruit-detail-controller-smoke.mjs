import assert from "node:assert/strict";
import { createRecruitDetailController } from "../public/recruit-detail-controller.js";
import { patchRecruitDetailView } from "../public/recruit-detail-dom.js";
import {
  WORKER_SKILL_DEFS,
  renderWorkerDetailPanel,
  workerStepForJob
} from "../public/worker-detail-view.js";

const skills = {};
for (const [key, definition] of Object.entries(WORKER_SKILL_DEFS)) {
  skills[definition.dir] ||= {};
  skills[definition.dir][key] = { level: 3, exp: 20 };
}
const candidate = {
  id: "candidate-1",
  name: "小满",
  tier: 4,
  job: "planner",
  price: 12_000,
  traits: ["净料"],
  flaws: ["手重"],
  skills
};

function createRecruitDomFixture() {
  let detailWrites = 0;
  let footerWrites = 0;
  let detailPanel = null;
  const body = {
    dataset: {},
    innerHTML: ""
  };
  Object.defineProperty(body, "innerHTML", {
    get() {
      return this._html || "";
    },
    set(value) {
      detailWrites += 1;
      this._html = value;
      detailPanel = { scrollTop: 0 };
    }
  });
  const footer = {
    _html: "",
    get innerHTML() {
      return this._html;
    },
    set innerHTML(value) {
      footerWrites += 1;
      this._html = value;
    }
  };
  const root = {
    querySelector(selector) {
      if (selector === "[data-recruit-detail-body]") return body;
      if (selector === "[data-recruit-footer]") return footer;
      if (selector === ".worker-detail-panel") return detailPanel;
      return null;
    }
  };
  return {
    root,
    body,
    footer,
    detailWrites: () => detailWrites,
    footerWrites: () => footerWrites
  };
}

const fixture = createRecruitDomFixture();
const emitted = [];
let pendingAcknowledge = null;
let mountCount = 0;
let unmountCount = 0;
let requestSequence = 0;
const controller = createRecruitDetailController({
  mount() {
    mountCount += 1;
    return fixture.root;
  },
  patch(modal, root) {
    patchRecruitDetailView(root, {
      candidateId: modal.candidateId,
      detailHtml: renderWorkerDetailPanel({
        worker: candidate,
        step: workerStepForJob(candidate.job),
        mode: "recruit",
        footerHtml: '<div data-recruit-footer></div>'
      }),
      footerHtml: `
        ${modal.error ? `<p role="alert">${modal.error}</p>` : ""}
        <button ${modal.submitting ? "disabled" : ""}>
          ${modal.submitting ? "正在招募…" : "确认招募"}
        </button>
      `
    });
  },
  unmount(root) {
    assert.strictEqual(root, fixture.root);
    unmountCount += 1;
  },
  emit(event, payload, acknowledge) {
    emitted.push({ event, payload });
    pendingAcknowledge = acknowledge;
  },
  createRequestId: () => `request-${++requestSequence}`
});

assert.strictEqual(controller.open(candidate.id), fixture.root);
assert.equal(mountCount, 1);
assert.equal(fixture.detailWrites(), 1);
const originalBody = fixture.body;
const originalDetail = fixture.root.querySelector(".worker-detail-panel");
originalDetail.scrollTop = 137;

const failures = [
  "招募失败，请稍后重试。",
  "该招聘请求已处理，请勿重复提交。",
  "现金不足。",
  "员工人数已达到 8 人上限。"
];
for (const [index, message] of failures.entries()) {
  controller.confirm();
  assert.equal(emitted.at(-1).event, "recruitWorker");
  assert.deepEqual(emitted.at(-1).payload, {
    candidateId: candidate.id,
    requestId: `request-${index + 1}`
  });
  assert.equal(controller.current().submitting, true);
  assert.match(fixture.footer.innerHTML, /disabled/);

  pendingAcknowledge({ ok: false, message });

  assert.strictEqual(controller.current().candidateId, candidate.id);
  assert.equal(controller.current().submitting, false);
  assert.equal(controller.current().error, message);
  assert.strictEqual(fixture.body, originalBody, `${message} should retain the modal body node`);
  assert.strictEqual(
    fixture.root.querySelector(".worker-detail-panel"),
    originalDetail,
    `${message} should retain the worker detail node`
  );
  assert.equal(originalDetail.scrollTop, 137, `${message} should preserve detail scroll`);
  assert.equal(fixture.detailWrites(), 1, `${message} should not rewrite detail HTML`);
  assert.ok(fixture.footer.innerHTML.includes(message), `${message} should be visible`);
  assert.doesNotMatch(
    fixture.footer.innerHTML,
    /<button disabled/,
    `${message} should re-enable confirmation`
  );
}

controller.confirm();
pendingAcknowledge({ ok: true, message: "招聘成功。", requestId: "request-5" });
assert.equal(controller.current(), null, "success should close through acknowledgement");
assert.equal(unmountCount, 1);
assert.equal(fixture.detailWrites(), 1);

console.log("recruit-detail-controller-smoke: real lifecycle keeps modal identity on failures");
