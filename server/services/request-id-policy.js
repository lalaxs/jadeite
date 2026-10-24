/** Persisted idempotency-key policy shared by socket ingress and player saves. */
export const REQUEST_ID_HISTORY_LIMIT = 200;
export const REQUEST_ID_MAX_LENGTH = 128;

export function normalizeRequestId(value) {
  const id = String(value || "").trim();
  if (!id || id.length > REQUEST_ID_MAX_LENGTH) return "";
  return /^[A-Za-z0-9._:-]+$/.test(id) ? id : "";
}

export function normalizeRequestIdHistory(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map(normalizeRequestId)
    .filter(Boolean)
    .slice(-REQUEST_ID_HISTORY_LIMIT);
}
