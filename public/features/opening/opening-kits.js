import {
  KIT_LIB as OPENING_KIT_LIB,
  computeOverlaps as computeOpeningOverlaps,
  scaleForOpeningKit
} from "../../jade-opening-engine.js";
import { clampClient } from "../../shell/format-utils.js";
import { defaultOpeningState } from "./opening-state.js";
import { defaultPlannerDraftRuntime } from "./planner-drafts.js";
export function createOpeningKits({ openingState = defaultOpeningState, drafts = defaultPlannerDraftRuntime, document = globalThis.document } = {}) {
  const { roughKits, setSelectedOpeningKitId, setSelectedOpeningKitTpl, syncOpeningSizeDefaultsFromKit, normalizeBangleRingSize, normalizePendantSize, openingKitSizeValue } = openingState;
  const { ensurePlannerDraft, replacePlannerDraft } = drafts;
// Late-bound render helpers (filled by bindOpeningKitsRenderDeps)
let openingKitTemplate = (tplId) => ({ id: tplId, r: 40, name: tplId });
let openingKitFromStored = (kit) => kit;
let serverTypeForOpeningKit = (tplId) => tplId;

let workshopRefreshPlanner = () => {};
let renderWorkshop = () => {};
let paintJades = () => {};

function bindOpeningKitsRenderDeps(deps = {}) {
  if (typeof deps.openingKitTemplate === "function") openingKitTemplate = deps.openingKitTemplate;
  if (typeof deps.openingKitFromStored === "function") openingKitFromStored = deps.openingKitFromStored;
  if (typeof deps.serverTypeForOpeningKit === "function") serverTypeForOpeningKit = deps.serverTypeForOpeningKit;
}

function bindOpeningKitsUiDeps(deps = {}) {
  if (typeof deps.workshopRefreshPlanner === "function") workshopRefreshPlanner = deps.workshopRefreshPlanner;
  if (typeof deps.renderWorkshop === "function") renderWorkshop = deps.renderWorkshop;
  if (typeof deps.paintJades === "function") paintJades = deps.paintJades;
}

function kitsFor(roughId) {
  ensurePlannerDraft(roughId);
  if (!roughKits.has(roughId)) roughKits.set(roughId, []);
  return roughKits.get(roughId);
}

function selectOpeningDraftKit(roughId, kitId) {
  const kit = kitsFor(roughId).find((entry) => entry.id === kitId);
  if (!kit) {
    setSelectedOpeningKitId(null);
    return null;
  }
  setSelectedOpeningKitId(kit.id);
  syncOpeningSizeDefaultsFromKit(kit);
  return kit;
}

function clampOpeningKitPosition(tplId, x, y, scale = 1) {
  const template = openingKitTemplate(tplId);
  // The server's product placement uses 12%–88% centers. Keep the visual
  // drafts inside that same range instead of silently moving small cuts later.
  const radius = clampClient(template.r * scale, 72, 148);
  return {
    x: clampClient(Math.round(Number(x) || 300), radius, 600 - radius),
    y: clampClient(Math.round(Number(y) || 300), radius, 600 - radius)
  };
}

function openingKitsOverlapAt(current, nextKit) {
  return computeOpeningOverlaps([...current.map((kit) => openingKitFromStored(kit)), nextKit]).has(nextKit.uid);
}

function findSafeOpeningPosition(tplId, preferX, preferY, current, sizeVal = openingKitSizeValue(tplId)) {
  const scale = scaleForOpeningKit(tplId, sizeVal);
  const base = { uid: "candidate", tpl: tplId, x: preferX, y: preferY, rot: 0, scale, size: sizeVal };
  const first = { ...base, ...clampOpeningKitPosition(tplId, preferX, preferY, scale) };
  if (!openingKitsOverlapAt(current, first)) return first;
  for (let radius = 34; radius <= 260; radius += 22) {
    const steps = Math.max(8, Math.ceil(radius * Math.PI * 2 / 34));
    for (let index = 0; index < steps; index += 1) {
      const angle = index / steps * Math.PI * 2;
      const candidate = {
        ...base,
        ...clampOpeningKitPosition(tplId, preferX + Math.cos(angle) * radius, preferY + Math.sin(angle) * radius, scale)
      };
      if (!openingKitsOverlapAt(current, candidate)) return candidate;
    }
  }
  return first;
}

function refreshOpeningPlanUi(roughId, options = {}) {
  workshopRefreshPlanner(roughId, options);
  if (options.dragging) return;
  if (!(document || globalThis.document).getElementById("ws-planner-root")) renderWorkshop();
  paintJades();
}

function applyOpeningKitSizeToSelected(roughId, kind) {
  const sizeVal = kind === "bangle" ? openingState.selectedBangleRingSize : openingState.selectedPendantSize;
  const drafts = kitsFor(roughId);
  const target = openingState.selectedOpeningKitId
    ? drafts.find((kit) => kit.id === openingState.selectedOpeningKitId)
    : null;
  if (!target) return;
  const isBangle = (target.tpl || "bangle") === "bangle";
  if (kind === "bangle" ? !isBangle : isBangle) return;
  const tpl = target.tpl || "bangle";
  const scale = scaleForOpeningKit(tpl, sizeVal);
  replacePlannerDraft(roughId, drafts.map((kit) => {
    if (kit.id !== target.id) return kit;
    return {
      ...kit,
      ...clampOpeningKitPosition(tpl, kit.x, kit.y, scale),
      scale,
      size: sizeVal,
      ringSize: isBangle ? normalizeBangleRingSize(sizeVal) : undefined
    };
  }));
}

function addRoughKit(roughId, tplId) {
  const current = kitsFor(roughId);
  const safeTpl = OPENING_KIT_LIB.some((kit) => kit.id === tplId) ? tplId : "bangle";
  setSelectedOpeningKitTpl(safeTpl);
  const sizeVal = openingKitSizeValue(safeTpl);
  const same = current.filter((kit) => kit.tpl === safeTpl).length;
  const position = findSafeOpeningPosition(
    safeTpl,
    300 + ((same % 4) - 1.5) * 36,
    300 + Math.floor(same / 4) * 44,
    current,
    sizeVal
  );
  const scale = scaleForOpeningKit(safeTpl, sizeVal);
  const kit = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    tpl: safeTpl,
    type: serverTypeForOpeningKit(safeTpl),
    x: position.x,
    y: position.y,
    rot: 0,
    scale,
    size: sizeVal,
    ringSize: safeTpl === "bangle" ? normalizeBangleRingSize(sizeVal) : undefined,
    svgSpace: true
  };
  replacePlannerDraft(roughId, [...current, kit].slice(0, 10));
  setSelectedOpeningKitId(kit.id);
  refreshOpeningPlanUi(roughId);
}

function clearRoughKits(roughId) {
  replacePlannerDraft(roughId, []);
  setSelectedOpeningKitId(null);
  refreshOpeningPlanUi(roughId);
}

function removeOpeningKit(roughId, kitId) {
  const id = String(kitId || "");
  if (!roughId || !id) return false;
  const next = kitsFor(roughId).filter((kit) => String(kit.id || kit.uid || "") !== id);
  if (next.length === kitsFor(roughId).length) return false;
  if (!replacePlannerDraft(roughId, next)) return false;
  if (openingState.selectedOpeningKitId && String(openingState.selectedOpeningKitId) === id) {
    setSelectedOpeningKitId(null);
  }
  refreshOpeningPlanUi(roughId);
  return true;
}

function moveRoughKit(roughId, kitId, x, y, options = {}) {
  const current = kitsFor(roughId);
  const kit = current.find((entry) => entry.id === kitId);
  if (!kit) return null;
  const position = clampOpeningKitPosition(kit.tpl || "bangle", x, y, kit.scale || 1);
  if (kit.x === position.x && kit.y === position.y && kit.svgSpace) return kit;
  const moved = { ...kit, ...position, svgSpace: true };
  if (!replacePlannerDraft(roughId, current.map((entry) => (
    entry.id === kitId ? moved : entry
  )), { transient: options.transient === true })) return kit;
  if (options.refresh !== false) refreshOpeningPlanUi(roughId);
  return moved;
}

function openingKitsForServer(roughId) {
  return kitsFor(roughId).map((kit) => ({
    id: kit.id,
    type: kit.type || serverTypeForOpeningKit(kit.tpl),
    openingTpl: kit.tpl,
    x: clampClient(Math.round((Number(kit.x) || 300) / 6), 4, 96),
    y: clampClient(Math.round((Number(kit.y) || 300) / 6), 4, 96),
    rot: Number(kit.rot || 0),
    scale: Number(kit.scale || 1),
    size: kit.tpl === "bangle" ? undefined : normalizePendantSize(kit.size),
    ringSize: kit.tpl === "bangle" ? normalizeBangleRingSize(kit.ringSize || kit.size || 56) : undefined
  }));
}

  return { get openingKitTemplate() { return openingKitTemplate; }, get openingKitFromStored() { return openingKitFromStored; }, get serverTypeForOpeningKit() { return serverTypeForOpeningKit; }, get workshopRefreshPlanner() { return workshopRefreshPlanner; }, get renderWorkshop() { return renderWorkshop; }, get paintJades() { return paintJades; }, bindOpeningKitsRenderDeps, bindOpeningKitsUiDeps, kitsFor, selectOpeningDraftKit, clampOpeningKitPosition, openingKitsOverlapAt, findSafeOpeningPosition, refreshOpeningPlanUi, applyOpeningKitSizeToSelected, addRoughKit, clearRoughKits, removeOpeningKit, moveRoughKit, openingKitsForServer };
}

export const defaultOpeningKits = createOpeningKits();
export const { bindOpeningKitsRenderDeps, bindOpeningKitsUiDeps, kitsFor, selectOpeningDraftKit, clampOpeningKitPosition, openingKitsOverlapAt, findSafeOpeningPosition, refreshOpeningPlanUi, applyOpeningKitSizeToSelected, addRoughKit, clearRoughKits, removeOpeningKit, moveRoughKit, openingKitsForServer } = defaultOpeningKits;
export const openingKitTemplate = (...args) => defaultOpeningKits.openingKitTemplate(...args);
export const openingKitFromStored = (...args) => defaultOpeningKits.openingKitFromStored(...args);
export const serverTypeForOpeningKit = (...args) => defaultOpeningKits.serverTypeForOpeningKit(...args);
export const workshopRefreshPlanner = (...args) => defaultOpeningKits.workshopRefreshPlanner(...args);
export const renderWorkshop = (...args) => defaultOpeningKits.renderWorkshop(...args);
export const paintJades = (...args) => defaultOpeningKits.paintJades(...args);
