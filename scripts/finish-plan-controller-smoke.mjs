import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

async function importRequired(path, exportName) {
  try {
    const module = await import(path);
    assert.equal(typeof module[exportName], "function", `${exportName} should be exported`);
    return module[exportName];
  } catch (error) {
    assert.fail(`${exportName} should be importable: ${error.message}`);
  }
}

const createFinishPlanModalController = await importRequired(
  "../public/finish-plan-modal-controller.js",
  "createFinishPlanModalController"
);
const patchFinishPlanSelectOptions = await importRequired(
  "../public/finish-plan-dom.js",
  "patchFinishPlanSelectOptions"
);
const preserveFinishPlanUiState = await importRequired(
  "../public/finish-plan-dom.js",
  "preserveFinishPlanUiState"
);
const handleStartWorkshopJobRequest = await importRequired(
  "../workshop-start-handler.js",
  "handleStartWorkshopJobRequest"
);

function createDomFixture(initialOptionsHtml) {
  const ownerDocument = { activeElement: null };
  const body = { scrollTop: 84, ownerDocument };
  let optionsHtml = initialOptionsHtml;
  let options = [...initialOptionsHtml.matchAll(/value="([^"]*)"/g)]
    .map((match) => ({ value: match[1] }));
  let selectedValue = "";
  let optionWrites = 0;
  const select = {
    dataset: {
      finishField: "productType",
      optionsHtml: initialOptionsHtml
    },
    ownerDocument,
    focusCalls: [],
    focus(options) {
      this.focusCalls.push(options);
      ownerDocument.activeElement = this;
    }
  };
  Object.defineProperty(select, "innerHTML", {
    get() {
      return optionsHtml;
    },
    set(value) {
      optionsHtml = value;
      options = [...value.matchAll(/value="([^"]*)"/g)]
        .map((match) => ({ value: match[1] }));
      optionWrites += 1;
      if (ownerDocument.activeElement === select) {
        ownerDocument.activeElement = null;
        body.scrollTop = 0;
      }
    }
  });
  Object.defineProperty(select, "options", {
    get() {
      return options;
    }
  });
  Object.defineProperty(select, "value", {
    get() {
      return selectedValue;
    },
    set(value) {
      selectedValue = options.some((option) => option.value === value) ? value : "";
    }
  });
  const root = {
    ownerDocument,
    querySelector(selector) {
      if (selector === ".game-modal-body") return body;
      if (selector === '[data-finish-field="productType"]') return select;
      return null;
    },
    contains(node) {
      return node === body || node === select;
    }
  };
  return {
    root,
    body,
    select,
    ownerDocument,
    optionWrites: () => optionWrites
  };
}

const initialOptionsHtml = [
  '<option value="ring">戒指</option>',
  '<option value="pendant">吊坠</option>'
].join("");
const fixture = createDomFixture(initialOptionsHtml);
const root = fixture.root;
fixture.ownerDocument.activeElement = fixture.select;
let mountCount = 0;
let patchCount = 0;
let unmountCount = 0;
let emittedPayload;
let emittedAcknowledge;
let currentFromHook = null;
const controller = createFinishPlanModalController({
  mount() {
    mountCount += 1;
    return root;
  },
  patch(modal, mountedRoot) {
    patchCount += 1;
    assert.strictEqual(mountedRoot, root, "patches should retain the mounted root identity");
    assert.strictEqual(modal, currentFromHook, "patches should use the active modal draft");
    preserveFinishPlanUiState(mountedRoot, () => {
      patchFinishPlanSelectOptions(
        fixture.select,
        modal.testOptionsHtml,
        modal.testSelectedValue
      );
    });
  },
  unmount() {
    unmountCount += 1;
  },
  emit(payload, acknowledge) {
    emittedPayload = payload;
    emittedAcknowledge = acknowledge;
  },
  createRequestId: () => "request-1",
  onActiveChange(modal) {
    currentFromHook = modal;
  }
});

const modal = {
  deviceId: "finishing",
  itemId: "item-1",
  workerId: "worker-1",
  draft: { metalId: "gold18k", gemId: "diamond", gemCount: 2 },
  testOptionsHtml: initialOptionsHtml,
  testSelectedValue: "ring",
  submitting: false,
  error: ""
};
assert.strictEqual(controller.open(modal), root);
assert.strictEqual(controller.refresh(), root);
assert.equal(mountCount, 1, "normal refreshes should not remount the shell");
assert.equal(patchCount, 2);
assert.equal(fixture.optionWrites(), 0, "unchanged options should not rewrite the select");
assert.strictEqual(fixture.ownerDocument.activeElement, fixture.select);
assert.equal(fixture.body.scrollTop, 84);
assert.equal(fixture.select.value, "ring");

const changedOptionsHtml = [
  '<option value="ring">戒指（当前形态）</option>',
  '<option value="pendant">吊坠（当前形态）</option>'
].join("");
modal.testOptionsHtml = changedOptionsHtml;
modal.testSelectedValue = "pendant";
fixture.body.scrollTop = 57;
fixture.ownerDocument.activeElement = fixture.select;
assert.strictEqual(controller.refresh(), root);
assert.equal(mountCount, 1, "compatible option changes should not remount the shell");
assert.equal(fixture.optionWrites(), 1, "changed options should update select.innerHTML");
assert.equal(fixture.select.innerHTML, changedOptionsHtml);
assert.deepEqual(fixture.select.options.map((option) => option.value), ["ring", "pendant"]);
assert.equal(fixture.select.value, "pendant");
assert.strictEqual(fixture.ownerDocument.activeElement, fixture.select, "focus should be restored");
assert.equal(fixture.body.scrollTop, 57, "body scroll should be restored after focus");
assert.deepEqual(fixture.select.focusCalls.at(-1), { preventScroll: true });

controller.confirm();
assert.equal(modal.submitting, true);
assert.equal(emittedPayload.requestId, "request-1");
assert.deepEqual(emittedPayload.finishPlan, modal.draft);
assert.notStrictEqual(emittedPayload.finishPlan, modal.draft, "submission should snapshot the draft");
emittedAcknowledge({ ok: false, message: "库存刚刚变化。" });
assert.strictEqual(controller.current(), modal, "failure should retain the active modal");
assert.deepEqual(modal.draft, { metalId: "gold18k", gemId: "diamond", gemCount: 2 });
assert.equal(modal.submitting, false, "failure should reset submitting state");
assert.equal(modal.error, "库存刚刚变化。");

controller.confirm();
emittedAcknowledge({ ok: true, message: "已开工", requestId: "request-1" });
assert.equal(controller.current(), null, "success should close through acknowledgement");
assert.equal(unmountCount, 1);

function runServerCase({
  player = { id: "player-1" },
  consume = true,
  startResult = { ok: true, job: { id: "job-1" } }
} = {}) {
  const acknowledgements = [];
  const toasts = [];
  const successes = [];
  let consumeCalls = 0;
  let startCalls = 0;
  const result = handleStartWorkshopJobRequest({
    player,
    payload: { deviceId: "finishing", requestId: "request-2" },
    acknowledge: (value) => acknowledgements.push(value),
    consumeRequestId() {
      consumeCalls += 1;
      return consume;
    },
    startWorkshopJob() {
      startCalls += 1;
      return startResult;
    },
    emitToast: (message) => toasts.push(message),
    onSuccess: (value) => successes.push(value)
  });
  return { acknowledgements, toasts, successes, consumeCalls, startCalls, result };
}

const unavailable = runServerCase({ player: null });
assert.deepEqual(unavailable.acknowledgements, [{ ok: false, message: "玩家状态不可用。" }]);
assert.equal(unavailable.consumeCalls, 0);
assert.equal(unavailable.startCalls, 0);

const duplicate = runServerCase({ consume: false });
assert.deepEqual(duplicate.acknowledgements, [{
  ok: false,
  message: "该开工请求已处理，请勿重复提交。"
}]);
assert.deepEqual(duplicate.toasts, ["该开工请求已处理，请勿重复提交。"]);
assert.equal(duplicate.startCalls, 0);

const rejected = runServerCase({ startResult: { ok: false, message: "设备加工中。" } });
assert.deepEqual(rejected.acknowledgements, [{ ok: false, message: "设备加工中。" }]);
assert.deepEqual(rejected.toasts, ["设备加工中。"]);
assert.equal(rejected.successes.length, 0);

const accepted = runServerCase();
assert.deepEqual(accepted.acknowledgements, [{
  ok: true,
  message: "已开工",
  requestId: "request-2"
}]);
assert.equal(accepted.toasts.length, 0);
assert.deepEqual(accepted.successes, [{ ok: true, job: { id: "job-1" } }]);

const workshopSource = readFileSync("public/workshop-module.js", "utf8");
assert.match(
  workshopSource,
  /import\s*\{\s*patchFinishPlanSelectOptions,\s*preserveFinishPlanUiState\s*\}\s*from "\.\/finish-plan-dom\.js"/
);
assert.doesNotMatch(workshopSource, /function setSelectOptions\b/);

console.log("finish-plan-controller-smoke: stable lifecycle and acknowledgements ok");
