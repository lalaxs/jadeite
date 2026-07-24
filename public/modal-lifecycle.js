const activeModals = [];
const inertShells = new Map();

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])"
].join(",");

function topmostModal(documentRef) {
  for (let index = activeModals.length - 1; index >= 0; index -= 1) {
    if (activeModals[index].document === documentRef) return activeModals[index];
  }
  return null;
}

function focusableControls(dialog) {
  if (!dialog?.querySelectorAll) return [];
  return [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)].filter((control) => {
    if (control.disabled || control.hidden) return false;
    return control.getAttribute?.("aria-hidden") !== "true";
  });
}

function focusWithoutScroll(control) {
  if (!control?.focus) return;
  try {
    control.focus({ preventScroll: true });
  } catch {
    control.focus();
  }
}

function childPath(root, target) {
  if (!root || !target || !root.contains?.(target)) return null;
  const path = [];
  let current = target;
  while (current && current !== root) {
    const parent = current.parentElement;
    if (!parent) return null;
    const index = Array.from(parent.children || []).indexOf(current);
    if (index < 0) return null;
    path.unshift(index);
    current = parent;
  }
  return current === root ? path : null;
}

function elementAtPath(root, path) {
  if (!Array.isArray(path)) return null;
  let current = root;
  for (const index of path) {
    current = current?.children?.[index];
    if (!current) return null;
  }
  return current;
}

function describeOpener(opener, shell) {
  if (!opener) return null;
  const identifyingAttributes = [
    "id",
    "data-action",
    "data-payload",
    "data-planner-action",
    "data-finish-action",
    "aria-label",
    "name"
  ].map((name) => [name, opener.getAttribute?.(name)])
    .filter(([, value]) => value);
  return {
    attributes: identifyingAttributes,
    path: childPath(shell, opener),
    shell,
    tagName: opener.tagName?.toLowerCase?.() || "*"
  };
}

function equivalentOpener(description) {
  if (!description?.shell) return null;
  if (description.attributes.length) {
    const candidates = description.shell.querySelectorAll?.(description.tagName) || [];
    const match = [...candidates].find((candidate) =>
      description.attributes.every(([name, value]) => candidate.getAttribute?.(name) === value)
    );
    if (match) return match;
  }
  return elementAtPath(description.shell, description.path);
}

function lockShell(shell) {
  if (!shell) return;
  const existing = inertShells.get(shell);
  if (existing) {
    existing.count += 1;
    return;
  }
  inertShells.set(shell, { count: 1, inert: Boolean(shell.inert) });
  shell.inert = true;
}

function unlockShell(shell) {
  if (!shell) return;
  const existing = inertShells.get(shell);
  if (!existing) return;
  existing.count -= 1;
  if (existing.count > 0) return;
  shell.inert = existing.inert;
  inertShells.delete(shell);
}

export function activateModalLifecycle({
  root,
  dialog = root?.querySelector?.('[role="dialog"]'),
  shell = root?.ownerDocument?.querySelector?.(".shell"),
  onClose,
  closeOnBackdrop = true
} = {}) {
  if (!root || !dialog) return () => {};
  const documentRef = root.ownerDocument;
  const opener = documentRef?.activeElement || null;
  const openerDescription = describeOpener(opener, shell);
  let active = true;

  const entry = { document: documentRef, root };
  activeModals.push(entry);
  lockShell(shell);

  function requestClose(event) {
    if (!active || topmostModal(documentRef) !== entry) return;
    event?.preventDefault?.();
    onClose?.();
  }

  function handleKeydown(event) {
    if (!active || topmostModal(documentRef) !== entry) return;
    if (event.key === "Escape") {
      requestClose(event);
      return;
    }
    if (event.key !== "Tab") return;

    const controls = focusableControls(dialog);
    if (!controls.length) {
      event.preventDefault();
      focusWithoutScroll(dialog);
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    const focused = documentRef.activeElement;
    if (event.shiftKey && (focused === first || !dialog.contains(focused))) {
      event.preventDefault();
      focusWithoutScroll(last);
    } else if (!event.shiftKey && (focused === last || !dialog.contains(focused))) {
      event.preventDefault();
      focusWithoutScroll(first);
    }
  }

  function handleBackdropClick(event) {
    if (closeOnBackdrop && event.target === root) requestClose(event);
  }

  documentRef?.addEventListener?.("keydown", handleKeydown);
  root.addEventListener?.("click", handleBackdropClick);
  const initialControl =
    dialog.querySelector?.("[data-modal-initial-focus]") ||
    focusableControls(dialog)[0] ||
    dialog;
  focusWithoutScroll(initialControl);

  return function deactivateModalLifecycle() {
    if (!active) return;
    active = false;
    const wasTopmost = topmostModal(documentRef) === entry;
    const index = activeModals.lastIndexOf(entry);
    if (index >= 0) activeModals.splice(index, 1);
    documentRef?.removeEventListener?.("keydown", handleKeydown);
    root.removeEventListener?.("click", handleBackdropClick);
    unlockShell(shell);
    if (wasTopmost) {
      const resolveReturnTarget = () =>
        opener?.isConnected !== false ? opener : equivalentOpener(openerDescription);
      focusWithoutScroll(resolveReturnTarget());
      globalThis.queueMicrotask?.(() => {
        if (topmostModal(documentRef)) return;
        const focused = documentRef?.activeElement;
        const focusFellBack =
          !focused ||
          focused === documentRef?.body ||
          focused === documentRef?.documentElement ||
          root.contains?.(focused);
        if (focusFellBack) focusWithoutScroll(resolveReturnTarget());
      });
    }
  };
}
