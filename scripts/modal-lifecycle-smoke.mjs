import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activateModalLifecycle } from "../public/modal-lifecycle.js";
import { patchPlannerBody } from "../public/planner-dom.js";

const mainSource = readFileSync("public/main.js", "utf8");
assert.match(mainSource, /import\s+\{\s*activateModalLifecycle\s*\}\s+from\s+"\.\/modal-lifecycle\.js"/);
assert.match(
  mainSource.match(/function openGameModal\([^)]*\)\s*\{[\s\S]*?\n\}/)?.[0] || "",
  /activateModalLifecycle/
);
assert.doesNotMatch(
  mainSource.match(/document\.addEventListener\("keydown"[\s\S]*?\n\}\);/)?.[0] || "",
  /closeGameModal/
);

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event = {}) {
    event.type = type;
    event.preventDefault ||= () => {
      event.defaultPrevented = true;
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

class FakeElement extends FakeEventTarget {
  constructor(ownerDocument, name = "element") {
    super();
    this.ownerDocument = ownerDocument;
    this.name = name;
    this.children = [];
    this.parentElement = null;
    this.disabled = false;
    this.hidden = false;
    this.isConnected = true;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.tagName = "BUTTON";
    this.attributes = new Map();
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  contains(candidate) {
    return candidate === this || this.children.some((child) => child.contains(candidate));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }
}

class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.activeElement = null;
  }
}

function modalFixture() {
  const document = new FakeDocument();
  const shell = new FakeElement(document, "shell");
  shell.inert = false;
  const opener = new FakeElement(document, "opener");
  const root = new FakeElement(document, "root");
  const dialog = new FakeElement(document, "dialog");
  const close = new FakeElement(document, "close");
  const confirm = new FakeElement(document, "confirm");
  dialog.append(close, confirm);
  root.append(dialog);
  dialog.querySelectorAll = () => [close, confirm];
  document.activeElement = opener;
  return { document, shell, opener, root, dialog, close, confirm };
}

{
  const fixture = modalFixture();
  let closeCount = 0;
  const deactivate = activateModalLifecycle({
    root: fixture.root,
    dialog: fixture.dialog,
    shell: fixture.shell,
    onClose: () => {
      closeCount += 1;
    }
  });

  assert.equal(fixture.shell.inert, true, "background shell should become inert");
  assert.equal(fixture.document.activeElement, fixture.close, "first modal control should receive focus");

  fixture.confirm.focus();
  fixture.document.dispatch("keydown", { key: "Tab", shiftKey: false });
  assert.equal(fixture.document.activeElement, fixture.close, "Tab should wrap to first control");

  fixture.close.focus();
  fixture.document.dispatch("keydown", { key: "Tab", shiftKey: true });
  assert.equal(fixture.document.activeElement, fixture.confirm, "Shift+Tab should wrap to last control");

  fixture.document.dispatch("keydown", { key: "Escape" });
  assert.equal(closeCount, 1, "Escape should request closing the topmost modal");

  fixture.root.dispatch("click", { target: fixture.root });
  assert.equal(closeCount, 2, "backdrop click should request closing the modal");

  deactivate();
  assert.equal(fixture.shell.inert, false, "background inert state should be restored");
  assert.equal(fixture.document.activeElement, fixture.opener, "focus should return to the opener");
  fixture.document.dispatch("keydown", { key: "Escape" });
  assert.equal(closeCount, 2, "deactivated modal must remove its keyboard listener");
}

{
  const fixture = modalFixture();
  fixture.opener.setAttribute("data-action", "openRecruitCandidateDetail");
  fixture.opener.setAttribute("data-payload", "candidate-1");
  const replacementOpener = new FakeElement(fixture.document, "replacement-opener");
  replacementOpener.setAttribute("data-action", "openRecruitCandidateDetail");
  replacementOpener.setAttribute("data-payload", "candidate-1");
  fixture.shell.querySelectorAll = () => [replacementOpener];

  const deactivate = activateModalLifecycle({
    root: fixture.root,
    dialog: fixture.dialog,
    shell: fixture.shell,
    onClose: () => {}
  });
  fixture.opener.isConnected = false;
  deactivate();
  assert.equal(
    fixture.document.activeElement,
    replacementOpener,
    "focus should return to an equivalent opener when a live refresh replaced the original node"
  );
}

{
  const fixture = modalFixture();
  fixture.opener.setAttribute("data-action", "startWorkshopJob");
  const disabledReplacement = new FakeElement(fixture.document, "disabled-start");
  disabledReplacement.setAttribute("data-action", "startWorkshopJob");
  disabledReplacement.disabled = true;
  const nearbyControl = new FakeElement(fixture.document, "nearby-control");
  fixture.shell.querySelectorAll = () => [disabledReplacement, nearbyControl];

  const deactivate = activateModalLifecycle({
    root: fixture.root,
    dialog: fixture.dialog,
    shell: fixture.shell,
    onClose: () => {}
  });
  fixture.opener.isConnected = false;
  deactivate();
  assert.equal(
    fixture.document.activeElement,
    nearbyControl,
    "a disabled replacement opener should fall back to a nearby enabled control"
  );
}

{
  const fixture = modalFixture();
  let deactivate = () => {};
  deactivate = activateModalLifecycle({
    root: fixture.root,
    dialog: fixture.dialog,
    shell: fixture.shell,
    onClose: () => {
      deactivate();
      fixture.document.activeElement = null;
    }
  });
  fixture.document.dispatch("keydown", { key: "Escape" });
  await Promise.resolve();
  assert.equal(
    fixture.document.activeElement,
    fixture.opener,
    "focus restoration should survive the browser removing the focused modal control after Escape"
  );
}

{
  const fixture = modalFixture();
  const successRoot = new FakeElement(fixture.document, "success-root");
  const successDialog = new FakeElement(fixture.document, "success-dialog");
  const successClose = new FakeElement(fixture.document, "success-close");
  successDialog.append(successClose);
  successRoot.append(successDialog);
  successDialog.querySelectorAll = () => [successClose];

  const deactivateFinish = activateModalLifecycle({
    root: fixture.root,
    dialog: fixture.dialog,
    shell: fixture.shell,
    onClose: () => {}
  });
  fixture.confirm.focus();
  const deactivateSuccess = activateModalLifecycle({
    root: successRoot,
    dialog: successDialog,
    shell: fixture.shell,
    onClose: () => {}
  });

  deactivateFinish();
  fixture.confirm.isConnected = false;
  assert.equal(fixture.shell.inert, true, "closing an underlying modal must keep the shell inert");
  assert.equal(
    fixture.document.activeElement,
    successClose,
    "closing an underlying modal must not steal focus from the topmost success modal"
  );

  deactivateSuccess();
  await Promise.resolve();
  assert.equal(fixture.shell.inert, false, "closing the final stacked modal should unlock the shell");
  assert.equal(
    fixture.document.activeElement,
    fixture.opener,
    "the topmost modal should inherit the underlying modal's background return target"
  );
}

function plannerFixture() {
  const document = new FakeDocument();
  let writes = 0;
  let version = 0;
  const body = new FakeElement(document, "body");

  Object.defineProperty(body, "innerHTML", {
    get() {
      return this._html || "";
    },
    set(value) {
      writes += 1;
      version += 1;
      this._html = value;
      this.children = [];
      const scrollArea = new FakeElement(document, `scroll-${version}`);
      const control = new FakeElement(document, `control-${version}`);
      scrollArea.append(control);
      this.append(scrollArea);
    }
  });

  return { document, body, writes: () => writes };
}

{
  const fixture = plannerFixture();
  let paints = 0;
  assert.equal(patchPlannerBody(fixture.body, "<div>A</div>", () => paints += 1), true);
  assert.equal(fixture.writes(), 1);
  assert.equal(paints, 1);

  const originalControl = fixture.body.children[0].children[0];
  fixture.body.scrollTop = 11;
  fixture.body.children[0].scrollTop = 29;
  originalControl.focus();

  assert.equal(patchPlannerBody(fixture.body, "<div>A</div>", () => paints += 1), false);
  assert.equal(fixture.writes(), 1, "unchanged planner markup must keep the existing DOM");
  assert.equal(fixture.document.activeElement, originalControl, "unchanged refresh must preserve node identity");
  assert.equal(paints, 1, "unchanged planner markup should not repaint canvases");

  assert.equal(patchPlannerBody(fixture.body, "<div>B</div>", () => paints += 1), true);
  assert.equal(fixture.writes(), 2);
  assert.equal(paints, 2);
  assert.equal(fixture.body.scrollTop, 11, "planner body scroll should survive a real patch");
  assert.equal(fixture.body.children[0].scrollTop, 29, "nested planner scroll should survive a real patch");
  assert.equal(
    fixture.document.activeElement,
    fixture.body.children[0].children[0],
    "focus should move to the equivalent control after a real patch"
  );
}

console.log("modal-lifecycle-smoke: stable planner and accessible modal lifecycle ok");
