export function patchFinishPlanSelectOptions(select, html, value) {
  if (!select) return;
  if (select.dataset.optionsHtml !== html) {
    select.innerHTML = html;
    select.dataset.optionsHtml = html;
  }
  select.value = value ?? "";
}

export function preserveFinishPlanUiState(root, patch) {
  const ownerDocument = root.ownerDocument || globalThis.document;
  const body = root.querySelector(".game-modal-body");
  const activeElement = ownerDocument?.activeElement;
  const focusedField = activeElement
    && root.contains(activeElement)
    && activeElement.dataset?.finishField;
  const scrollTop = body?.scrollTop;

  const result = patch();

  if (focusedField) {
    const field = root.querySelector(`[data-finish-field="${focusedField}"]`);
    if (field && ownerDocument?.activeElement !== field) {
      field.focus({ preventScroll: true });
    }
  }
  const currentBody = root.querySelector(".game-modal-body");
  if (currentBody && typeof scrollTop === "number") currentBody.scrollTop = scrollTop;
  return result;
}
