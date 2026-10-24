import { roughKits, setSelectedOpeningKitId } from "./opening-state.js";
import { createPlannerDraftStore, plannerMaterialFingerprint, plannerKitsSignature, PLANNER_DRAFT_PREFIX } from "./planner-draft-store.js";

const clone = (value) => structuredClone(value);
const sessions = new Map();
const listeners = new Set();
const HISTORY_LIMIT = 50;
let getState = () => null;
let now = Date.now;
let store;
let ownerId = null;
let stopEvents = null;
const newWriterId = () => globalThis.crypto?.randomUUID?.() || `page-${Date.now()}-${Math.random().toString(36).slice(2)}`;
function browserStorage() { try { return globalThis.localStorage; } catch { return null; } }

export function bindPlannerDraftDeps(deps = {}) {
  if (typeof deps.getState === "function") getState = deps.getState;
  if (typeof deps.now === "function") now = deps.now;
  if (!store || Object.hasOwn(deps, "storage") || deps.writerId) {
    store = createPlannerDraftStore({ storage: Object.hasOwn(deps, "storage") ? deps.storage : browserStorage(), writerId: deps.writerId || newWriterId(), now });
  }
  if (stopEvents) return;
  const target = deps.eventTarget || globalThis.window;
  if (!target?.addEventListener) return;
  const onStorage = (event) => {
    if (event.key && !event.key.startsWith(PLANNER_DRAFT_PREFIX)) return;
    for (const session of sessions.values()) { refreshAlternatives(session); notify(session.itemId); }
  };
  const flush = () => { for (const session of sessions.values()) if (!session.completed) save(session); };
  target.addEventListener("storage", onStorage);
  target.addEventListener("pagehide", flush);
  target.addEventListener("visibilitychange", flush);
  stopEvents = () => {
    target.removeEventListener("storage", onStorage); target.removeEventListener("pagehide", flush); target.removeEventListener("visibilitychange", flush);
  };
}

function notify(itemId) { for (const listener of listeners) listener(itemId); }
export function subscribePlannerDrafts(listener) { listeners.add(listener); return () => listeners.delete(listener); }
function identity() {
  const playerId = String(getState()?.me?.id || "");
  if (ownerId !== null && ownerId !== playerId) { sessions.clear(); roughKits.clear(); }
  ownerId = playerId;
  return playerId;
}
function materialFor(id) {
  const me = getState()?.me;
  return [...(me?.rough || []), ...(me?.materials || []), ...(me?.slices || [])].find((item) => String(item.id) === String(id));
}
function refreshAlternatives(session) {
  if (!session.playerId || !store) return;
  const listed = store.list(session.playerId, session.itemId);
  const signature = plannerKitsSignature(roughKits.get(session.itemId) || []);
  const seen = new Set([signature]);
  session.alternatives = listed.records.filter((record) => {
    if (record.fingerprint !== session.fingerprint || record.writerId === store.writerId) return false;
    const sig = plannerKitsSignature(record.current);
    if (seen.has(sig)) return false;
    seen.add(sig); return true;
  });
  session.staleCount = listed.records.filter((record) => record.fingerprint !== session.fingerprint).length;
  session.invalidCount = listed.invalid;
}
function save(session) {
  if (session.completed) return true;
  if (!session.playerId) { session.saved = false; session.error = "当前草稿仅在本页面保留"; return false; }
  store ||= createPlannerDraftStore({ storage: browserStorage(), writerId: newWriterId(), now });
  const result = store.save(session.playerId, session.itemId, { fingerprint: session.fingerprint,
    current: roughKits.get(session.itemId) || [], confirmed: session.confirmed,
    pending: session.pending, revision: session.revision });
  session.saved = result.ok;
  session.error = result.ok ? "" : result.message;
  if (result.ok) { session.savedAt = result.record.savedAt; session.revision = result.record.revision; }
  refreshAlternatives(session);
  return result.ok;
}

export function ensurePlannerDraft(itemOrId) {
  const playerId = identity();
  const item = typeof itemOrId === "object" ? itemOrId : materialFor(itemOrId);
  const itemId = String(item?.id || itemOrId || "");
  if (!itemId) return null;
  const key = `${playerId}:${itemId}`;
  let session = sessions.get(key);
  // A temporarily absent item may be in flight or listed. Never erase its draft.
  if (!item) return session || null;
  const fingerprint = plannerMaterialFingerprint(item);
  if (session?.fingerprint === fingerprint && !session.completed) return session;
  store ||= createPlannerDraftStore({ storage: browserStorage(), writerId: newWriterId(), now });
  const listed = playerId ? store.list(playerId, itemId) : { records: [], invalid: 0 };
  const record = listed.records.find((entry) => entry.fingerprint === fingerprint);
  const changed = session && session.fingerprint !== fingerprint;
  const current = record?.current || (changed ? [] : roughKits.get(itemId) || []);
  roughKits.set(itemId, clone(current));
  session = { key, playerId, itemId, fingerprint, history: [], future: [], gesture: null,
    confirmed: clone(record?.confirmed || []), pending: record?.pending || null,
    locked: false, completed: false, saved: Boolean(record), savedAt: record?.savedAt || 0,
    revision: 0, restored: Boolean(record?.current.length), alternatives: [],
    staleCount: 0, invalidCount: listed.invalid || 0, error: "" };
  sessions.set(key, session);
  refreshAlternatives(session);
  return session;
}

function remember(session, before) {
  session.history.push(clone(before));
  if (session.history.length > HISTORY_LIMIT) session.history.shift();
  session.future = [];
}
export function replacePlannerDraft(itemId, next, { transient = false } = {}) {
  const session = ensurePlannerDraft(itemId);
  if (session?.locked || session?.pending || session?.completed) return false;
  const before = roughKits.get(itemId) || [];
  if (plannerKitsSignature(before) === plannerKitsSignature(next)) return false;
  if (session && !transient && !session.gesture) remember(session, before);
  roughKits.set(itemId, clone(next));
  if (session) {
    if (!transient || now() - (session.lastTransientSave || 0) >= 500) { save(session); session.lastTransientSave = now(); }
    notify(itemId);
  }
  return true;
}
export function beginPlannerDraftGesture(itemId) {
  const session = ensurePlannerDraft(itemId);
  if (session?.locked || session?.pending) return false;
  if (session && !session.gesture) session.gesture = clone(roughKits.get(itemId) || []);
  return true;
}
export function finishPlannerDraftGesture(itemId) {
  const session = ensurePlannerDraft(itemId);
  if (!session?.gesture) return;
  if (plannerKitsSignature(session.gesture) !== plannerKitsSignature(roughKits.get(itemId) || [])) remember(session, session.gesture);
  session.gesture = null; save(session); notify(itemId);
}
export function undoPlannerDraft(itemId, redo = false) {
  const session = ensurePlannerDraft(itemId);
  if (!session || session.locked || session.pending || session.gesture) return false;
  const from = redo ? session.future : session.history;
  if (!from.length) return false;
  (redo ? session.history : session.future).push(clone(roughKits.get(itemId) || []));
  roughKits.set(itemId, from.pop()); setSelectedOpeningKitId(null);
  save(session); notify(itemId); return true;
}
export function confirmPlannerDraft(itemId) {
  const session = ensurePlannerDraft(itemId);
  if (!session || session.locked || session.pending) return false;
  session.confirmed = clone(roughKits.get(itemId) || []); save(session); notify(itemId); return true;
}
export function persistPlannerDraft(itemId) {
  const session = ensurePlannerDraft(itemId);
  if (session) { save(session); notify(itemId); }
}
export function restoreConfirmedPlannerDraft(itemId) {
  const session = ensurePlannerDraft(itemId);
  return session ? replacePlannerDraft(itemId, session.confirmed) : false;
}
export function loadPlannerDraftVersion(itemId, key) {
  const session = ensurePlannerDraft(itemId);
  if (!session || session.locked || session.pending) return false;
  refreshAlternatives(session);
  const record = session.alternatives.find((entry) => entry.key === key);
  if (!record || record.fingerprint !== session.fingerprint) return false;
  return replacePlannerDraft(itemId, record.current);
}
export function plannerDraftStatus(itemId) {
  const session = ensurePlannerDraft(itemId);
  if (!session) return { canUndo: false, canRedo: false, alternatives: [] };
  return { saved: session.saved, savedAt: session.savedAt, error: session.error,
    canUndo: !session.locked && !session.pending && session.history.length > 0, canRedo: !session.locked && !session.pending && session.future.length > 0,
    locked: session.locked || Boolean(session.pending), pending: Boolean(session.pending), restored: session.restored,
    staleCount: session.staleCount, invalidCount: session.invalidCount,
    confirmedDiffers: plannerKitsSignature(session.confirmed) !== plannerKitsSignature(roughKits.get(itemId) || []),
    alternatives: session.alternatives.map(({ key, savedAt, current }) => ({ key, savedAt, count: current.length })) };
}

export function beginPlannerSubmission(itemId, requestId, request = null) {
  const session = ensurePlannerDraft(itemId);
  if (!session || session.locked || (session.pending && session.pending.requestId !== requestId)) return false;
  if (session.pending?.request && request && JSON.stringify(session.pending.request) !== JSON.stringify(request)) return false;
  session.locked = true;
  session.pending ||= { requestId, submittedAt: now(), kitIds: (roughKits.get(itemId) || []).map((kit) => kit.id), request: request ? clone(request) : null };
  save(session); notify(itemId); return true;
}
export function plannerSubmissionRequestId(itemId) { return ensurePlannerDraft(itemId)?.pending?.requestId || null; }
export function plannerSubmissionRequest(itemId) {
  const request = ensurePlannerDraft(itemId)?.pending?.request;
  return request ? clone(request) : null;
}
export function settlePlannerSubmission(itemId, result = {}, expectedRequestId = null) {
  const session = sessions.get(`${identity()}:${itemId}`) || ensurePlannerDraft(itemId);
  if (!session || (expectedRequestId && session.pending?.requestId !== expectedRequestId)) return false;
  session.locked = false;
  if (result.ok) {
    store?.remove(session.playerId, itemId, { fingerprint: session.fingerprint, allWriters: true });
    roughKits.delete(itemId); session.history = []; session.future = []; session.pending = null; session.completed = true;
  } else if (result.code !== "ACK_TIMEOUT" && result.code !== "FEATURE_DISPOSED") {
    session.pending = null; save(session);
  }
  notify(itemId);
  return true;
}

export function reconcilePlannerDrafts() {
  identity();
  const me = getState()?.me;
  if (!me) return;
  for (const session of sessions.values()) {
    if (session.completed || session.playerId !== ownerId) continue;
    const ids = session.pending?.kitIds || (roughKits.get(session.itemId) || []).map((kit) => kit.id);
    const matches = (item, kits) => String(item?.id) === session.itemId
      && ids.length > 0 && ids.every((id) => (kits || []).some((kit) => kit.id === id));
    const accepted = (me.jobs || []).some((job) => matches(job.item || job.rough, job.options?.kits))
      || [...(me.rough || []), ...(me.materials || []), ...(me.slices || [])].some((item) => matches(item, item.extractionKits || item.braceletPlacements));
    if (accepted) settlePlannerSubmission(session.itemId, { ok: true });
  }
}

// Test seam: independent reloads and private-mode storage failures without a browser.
export function resetPlannerDraftRuntime() {
  stopEvents?.(); stopEvents = null; sessions.clear(); listeners.clear(); ownerId = null; store = null; now = Date.now;
}
