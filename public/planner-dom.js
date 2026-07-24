const plannerMarkupCache = new WeakMap();

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

function collectScrollState(root, path = [], state = []) {
  state.push({
    path,
    top: Number(root?.scrollTop) || 0,
    left: Number(root?.scrollLeft) || 0
  });
  for (const [index, child] of Array.from(root?.children || []).entries()) {
    collectScrollState(child, [...path, index], state);
  }
  return state;
}

function focusWithoutScroll(control) {
  if (!control?.focus || control.disabled) return;
  try {
    control.focus({ preventScroll: true });
  } catch {
    control.focus();
  }
}

export function patchPlannerBody(body, markup, paint = () => {}) {
  if (!body || plannerMarkupCache.get(body) === markup) return false;
  const focusedPath = childPath(body, body.ownerDocument?.activeElement);
  const scrollState = collectScrollState(body);

  body.innerHTML = markup;
  plannerMarkupCache.set(body, markup);
  paint();

  focusWithoutScroll(elementAtPath(body, focusedPath));
  for (const position of scrollState) {
    const element = elementAtPath(body, position.path);
    if (!element) continue;
    element.scrollTop = position.top;
    element.scrollLeft = position.left;
  }
  return true;
}
