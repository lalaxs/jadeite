// Opening planner state + size selection (moved from main.js)

import { KIT_LIB as OPENING_KIT_LIB } from "../../jade-opening-engine.js";

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
export function createOpeningState(onChange = () => {}) {
  const state = {
    roughKits: new Map(), openingStoneCache: new Map(),
    selectedBangleRingSize: 56, selectedPendantSize: "M", selectedOpeningKitTpl: "ping",
    selectedOpeningKitId: null, activeDragKit: null
  };

function setSelectedBangleRingSize(v) { state.selectedBangleRingSize = v; onChange(state); }
function setSelectedPendantSize(v) { state.selectedPendantSize = v; onChange(state); }
function setSelectedOpeningKitId(v) { state.selectedOpeningKitId = v; onChange(state); }
function setActiveDragKit(v) { state.activeDragKit = v; onChange(state); }

function normalizePendantSize(value) {
  return PENDANT_SIZE_OPTIONS.some((option) => option.id === value) ? value : "M";
}

function normalizeBangleRingSize(value) {
  const n = Math.round(Number(value) || 56);
  const clamped = Math.max(52, Math.min(62, n));
  return Math.round(clamped / 2) * 2;
}

function setSelectedOpeningKitTpl(tplId) {
  state.selectedOpeningKitTpl = OPENING_KIT_LIB.some((kit) => kit.id === tplId) ? tplId : "ping"; onChange(state);
}

function syncOpeningSizeDefaultsFromKit(kit) {
  if (!kit) return;
  const tpl = kit.tpl || "ping";
  setSelectedOpeningKitTpl(tpl);
  if (tpl === "bangle") {
    state.selectedBangleRingSize = normalizeBangleRingSize(kit.ringSize || kit.size || 56); onChange(state);
  } else {
    state.selectedPendantSize = normalizePendantSize(kit.size); onChange(state);
  }
}

function openingKitSizeValue(tplId) {
  return tplId === "bangle" ? state.selectedBangleRingSize : state.selectedPendantSize;
}

function openingKitSizeLabel(tplId, sizeVal = openingKitSizeValue(tplId)) {
  if (tplId === "bangle") return `${normalizeBangleRingSize(sizeVal)}圈口`;
  const hit = PENDANT_SIZE_OPTIONS.find((option) => option.id === sizeVal);
  return hit ? `${hit.label}号` : "中号";
}

  return Object.assign(state, { setSelectedBangleRingSize, setSelectedPendantSize, setSelectedOpeningKitId, setActiveDragKit, normalizePendantSize, normalizeBangleRingSize, setSelectedOpeningKitTpl, syncOpeningSizeDefaultsFromKit, openingKitSizeValue, openingKitSizeLabel });
}

export let selectedBangleRingSize = 56;
export let selectedPendantSize = "M";
export let selectedOpeningKitTpl = "ping";
export let selectedOpeningKitId = null;
export let activeDragKit = null;
export const defaultOpeningState = createOpeningState((state) => {
  ({ selectedBangleRingSize, selectedPendantSize, selectedOpeningKitTpl, selectedOpeningKitId, activeDragKit } = state);
});
export const { roughKits, openingStoneCache, setSelectedBangleRingSize, setSelectedPendantSize, setSelectedOpeningKitId, setActiveDragKit, normalizePendantSize, normalizeBangleRingSize, setSelectedOpeningKitTpl, syncOpeningSizeDefaultsFromKit, openingKitSizeValue, openingKitSizeLabel } = defaultOpeningState;
