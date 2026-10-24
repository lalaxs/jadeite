import { scaleForOpeningKit } from "../../jade-opening-engine.js";
import { OPENING_KIT_SERVER_TYPES, BANGLE_RING_SIZES } from "./opening-state.js";

export const PLANNER_DRAFT_VERSION = 1;
export const PLANNER_RULES_VERSION = 1;
export const PLANNER_DRAFT_PREFIX = "jade:planner-draft:v1:";
const clone = (value) => structuredClone(value);

// Only material identity/geometry belongs in this fingerprint. Prices and cash
// change independently and must not invalidate someone's carefully placed cuts.
export function plannerMaterialFingerprint(item = {}) {
  const cuts = (item.extractionKits || item.braceletPlacements || []).map((kit) => ({
    id: kit.id, type: kit.type, openingTpl: kit.openingTpl || kit.tpl,
    x: kit.x, y: kit.y, rot: kit.rot ?? kit.rotation ?? 0,
    size: kit.size, ringSize: kit.ringSize, scale: kit.scale
  }));
  return JSON.stringify({
    id: item.id, stage: item.materialStage || item.stage || "opened",
    seed: item.openingSeed || item.visual?.openingSeed || item.visual?.seed || item.id || item.name,
    quality: item.qualityKey || item.quality?.name || item.quality,
    color: item.color, geometry: item.leftoverGeometryVersion || 0,
    remaining: item.remainingRatio ?? item.openingEval?.remainRatio ?? 1, cuts
  });
}

export function plannerKitsSignature(kits = []) {
  return JSON.stringify(kits.map(({ id, tpl, x, y, rot, size, ringSize }) => ({ id, tpl, x, y, rot, size, ringSize })));
}

export function normalizePlannerDraftKits(value) {
  if (!Array.isArray(value) || value.length > 10) throw new Error("草稿套件数量无效");
  const ids = new Set();
  return value.map((kit) => {
    if (!kit || !Object.hasOwn(OPENING_KIT_SERVER_TYPES, kit.tpl)) throw new Error("草稿套件类型无效");
    if (typeof kit.id !== "string" || !/^[A-Za-z0-9:_-]{1,64}$/.test(kit.id) || ids.has(kit.id)) throw new Error("草稿套件编号无效");
    ids.add(kit.id);
    const x = Number(kit.x), y = Number(kit.y), rot = Number(kit.rot || 0);
    if (![x, y, rot].every(Number.isFinite) || x < 0 || x > 600 || y < 0 || y > 600) throw new Error("草稿坐标无效");
    const bangle = kit.tpl === "bangle";
    const size = bangle ? Number(kit.ringSize || kit.size || 56) : String(kit.size || "M");
    if (bangle ? !BANGLE_RING_SIZES.includes(size) : !["S", "M", "L"].includes(size)) throw new Error("草稿尺寸无效");
    return { id: kit.id, tpl: kit.tpl, type: OPENING_KIT_SERVER_TYPES[kit.tpl],
      x, y, rot: ((rot % 180) + 180) % 180, size,
      ...(bangle ? { ringSize: size } : {}), scale: scaleForOpeningKit(kit.tpl, size), svgSpace: true };
  });
}

function readRecord(raw, playerId, itemId) {
  const data = JSON.parse(raw);
  if (data.version !== PLANNER_DRAFT_VERSION || data.rulesVersion !== PLANNER_RULES_VERSION
    || data.playerId !== playerId || data.itemId !== itemId || typeof data.fingerprint !== "string"
    || typeof data.writerId !== "string" || !Number.isFinite(data.savedAt)) throw new Error("草稿版本无效");
  const current = normalizePlannerDraftKits(data.current), confirmed = normalizePlannerDraftKits(data.confirmed || []);
  if (data.pending != null && (typeof data.pending !== "object" || Array.isArray(data.pending)
    || typeof data.pending.requestId !== "string" || data.pending.requestId.length < 1 || data.pending.requestId.length > 128
    || !Number.isFinite(data.pending.submittedAt) || !Array.isArray(data.pending.kitIds)
    || data.pending.kitIds.length !== current.length || current.length < 1
    || new Set(data.pending.kitIds).size !== current.length
    || !data.pending.kitIds.every(id => current.some(kit => kit.id === id)))) throw new Error("待确认规划无效");
  if (data.pending?.request && (data.pending.request.requestId !== data.pending.requestId
    || data.pending.request.itemId !== itemId || typeof data.pending.request.deviceId !== "string"
    || !Array.isArray(data.pending.request.kits) || data.pending.request.kits.length !== current.length
    || !data.pending.request.kits.every(kit => current.some(row => row.id === kit.id)))) throw new Error("待确认开工请求无效");
  return { ...data, current, confirmed };
}

function fingerprintKey(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

// Every page writes its own key. A second window can never silently overwrite
// the first, including simultaneous edits; no fragile localStorage CAS needed.
export function createPlannerDraftStore({ storage, writerId, now = Date.now } = {}) {
  const prefixFor = (playerId, itemId) => `${PLANNER_DRAFT_PREFIX}${encodeURIComponent(playerId)}:${encodeURIComponent(itemId)}:`;
  function list(playerId, itemId) {
    if (!storage) return { records: [], unavailable: true, invalid: 0 };
    try {
      const prefix = prefixFor(playerId, itemId);
      const records = [];
      let invalid = 0;
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (!key?.startsWith(prefix)) continue;
        try { records.push({ ...readRecord(storage.getItem(key), playerId, itemId), key }); }
        catch { invalid++; }
      }
      records.sort((a, b) => b.savedAt - a.savedAt || b.revision - a.revision || a.key.localeCompare(b.key));
      return { records, invalid, unavailable: false };
    } catch { return { records: [], unavailable: true, invalid: 0 }; }
  }
  function save(playerId, itemId, record) {
    if (!storage) return { ok: false, message: "当前浏览器无法保存草稿" };
    try {
      const data = { version: PLANNER_DRAFT_VERSION, rulesVersion: PLANNER_RULES_VERSION,
        playerId, itemId, writerId, savedAt: now(), revision: (Number(record.revision) || 0) + 1,
        fingerprint: record.fingerprint, current: normalizePlannerDraftKits(record.current),
        confirmed: normalizePlannerDraftKits(record.confirmed || []), pending: record.pending || null };
      const serialized = JSON.stringify(data);
      if (serialized.length > 64_000) throw new Error("草稿数据过大");
      const own = list(playerId, itemId).records.find(entry => entry.writerId === writerId && entry.fingerprint === record.fingerprint);
      let key = own?.key || `${prefixFor(playerId, itemId)}${fingerprintKey(record.fingerprint)}:${encodeURIComponent(writerId)}`;
      // Keep a prior material revision even in the unlikely event of a hash collision.
      const existing = storage.getItem(key);
      if (existing && JSON.parse(existing).fingerprint !== record.fingerprint) key = `${prefixFor(playerId, itemId)}${fingerprintKey(record.fingerprint)}-${data.savedAt}:${encodeURIComponent(writerId)}`;
      storage.setItem(key, serialized);
      return { ok: true, record: { ...clone(data), key } };
    } catch { return { ok: false, message: "草稿未能保存，请检查浏览器存储空间后重试" }; }
  }
  function remove(playerId, itemId, { fingerprint, allWriters = false } = {}) {
    if (!storage) return false;
    try {
      const prefix = prefixFor(playerId, itemId);
      const keys = [];
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (!key?.startsWith(prefix)) continue;
        try {
          const record = JSON.parse(storage.getItem(key));
          if ((allWriters || record.writerId === writerId) && (!fingerprint || record.fingerprint === fingerprint)) keys.push(key);
        } catch { /* Keep damaged/unknown versions separate from active data. */ }
      }
      for (const key of keys) storage.removeItem(key);
      return true;
    } catch { return false; }
  }
  return { list, save, remove, writerId };
}
