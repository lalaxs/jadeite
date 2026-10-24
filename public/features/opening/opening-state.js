// Opening planner state + size selection (moved from main.js)

import { KIT_LIB as OPENING_KIT_LIB } from "../../jade-opening-engine.js";

export const roughKits = new Map();
export const openingStoneCache = new Map();

export const OPENING_KIT_SERVER_TYPES = {
  egg: "cabochon",
  ping: "peacePendant",
  rect: "plaque",
  drop: "dropPendant",
  leaf: "leafPendant",
  bangle: "bangle",
  buddha: "buddhaPendant"
};
export const OPENING_KIT_BY_SERVER_TYPE = Object.fromEntries(
  Object.entries(OPENING_KIT_SERVER_TYPES).map(([tpl, type]) => [type, tpl])
);
export const OPENING_KIT_TEMPLATE_IDS = new Set(OPENING_KIT_LIB.map((template) => template.id));
export const BANGLE_RING_SIZES = [52, 54, 56, 58, 60, 62];
export const PENDANT_SIZE_OPTIONS = [
  { id: "S", label: "小" },
  { id: "M", label: "中" },
  { id: "L", label: "大" }
];
export let selectedBangleRingSize = 56;
export let selectedPendantSize = "M";
export let selectedOpeningKitTpl = "ping";
export let selectedOpeningKitId = null;
export let activeDragKit = null;

export function setSelectedBangleRingSize(v) { selectedBangleRingSize = v; }
export function setSelectedPendantSize(v) { selectedPendantSize = v; }
export function setSelectedOpeningKitId(v) { selectedOpeningKitId = v; }
export function setActiveDragKit(v) { activeDragKit = v; }

export function normalizePendantSize(value) {
  return PENDANT_SIZE_OPTIONS.some((option) => option.id === value) ? value : "M";
}

export function normalizeBangleRingSize(value) {
  const n = Math.round(Number(value) || 56);
  const clamped = Math.max(52, Math.min(62, n));
  return Math.round(clamped / 2) * 2;
}

export function setSelectedOpeningKitTpl(tplId) {
  selectedOpeningKitTpl = OPENING_KIT_LIB.some((kit) => kit.id === tplId) ? tplId : "ping";
}

export function syncOpeningSizeDefaultsFromKit(kit) {
  if (!kit) return;
  const tpl = kit.tpl || "ping";
  setSelectedOpeningKitTpl(tpl);
  if (tpl === "bangle") {
    selectedBangleRingSize = normalizeBangleRingSize(kit.ringSize || kit.size || 56);
  } else {
    selectedPendantSize = normalizePendantSize(kit.size);
  }
}

export function openingKitSizeValue(tplId) {
  return tplId === "bangle" ? selectedBangleRingSize : selectedPendantSize;
}

export function openingKitSizeLabel(tplId, sizeVal = openingKitSizeValue(tplId)) {
  if (tplId === "bangle") return `${normalizeBangleRingSize(sizeVal)}圈口`;
  const hit = PENDANT_SIZE_OPTIONS.find((option) => option.id === sizeVal);
  return hit ? `${hit.label}号` : "中号";
}
