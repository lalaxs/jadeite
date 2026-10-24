import {
  createFinishPlanDraft,
  normalizeFinishPlanDraft
} from "./finish-plan-model.js";
import { SETTING_GEMS, finishedMotifKind, finishGemPolicy, normalizeFinishGemLayout } from "../shared/domain/workshop/finished-product-design.js";
import { isBangle, applyBangleFinish } from "../shared/domain/workshop/bangle-finish.js";

const PREVIEW_MATERIAL_VISUALS = {
  cabochon: {
    seed: 76121,
    shape: "round",
    skin: "#b8b7a8",
    vein: "#21a868",
    window: true,
    crack: true,
    belt: true
  },
  carving: {
    seed: 82417,
    shape: "long",
    skin: "#9f9383",
    vein: "#2f8f72",
    window: true,
    crack: false,
    belt: true
  },
  pierced: {
    seed: 69384,
    shape: "round",
    skin: "#c2b7a4",
    vein: "#188a55",
    window: true,
    crack: true,
    belt: false
  },
  bangle: {
    seed: 91842,
    shape: "chunk",
    skin: "#7d7467",
    vein: "#2f9d61",
    window: true,
    crack: false,
    belt: true
  }
};

function previewSourceMaterial(shape, openingTpl, placement) {
  const visual = PREVIEW_MATERIAL_VISUALS[shape] || PREVIEW_MATERIAL_VISUALS.cabochon;
  return {
    roughId: `preview-rough-${shape}`,
    roughName: "镶嵌预览明料",
    visual,
    qualityKey: "ice",
    quality: "冰种",
    color: "苹果绿",
    openingSeed: visual.seed + 97,
    placement: {
      id: `preview-kit-${shape}`,
      openingTpl,
      x: placement.x,
      y: placement.y,
      rot: placement.rot || 0,
      scale: placement.scale,
      svgSpace: true,
      kitType: placement.kitType
    }
  };
}

export const INLAY_PREVIEW_SHAPES = [
  {
    id: "cabochon",
    label: "蛋面",
    item: {
      id: "preview-cabochon",
      name: "测试蛋面",
      type: "product",
      materialStage: "carved",
      kind: "cabochon",
      design: "cabochon",
      templateSize: { w: 22, h: 28 },
      sourceMaterial: previewSourceMaterial("cabochon", "egg", { x: 268, y: 286, rot: -8, scale: 1.12, kitType: "cabochon" }),
      value: 8800
    }
  },
  {
    id: "carving",
    label: "佛公",
    item: {
      id: "preview-carving",
      name: "测试佛公",
      type: "product",
      materialStage: "carved",
      kind: "buddhaPendant",
      design: "buddhaPendant",
      templateSize: { w: 28, h: 38 },
      sourceMaterial: previewSourceMaterial("carving", "buddha", { x: 306, y: 310, rot: 5, scale: 0.95, kitType: "buddhaPendant" }),
      value: 10800
    }
  },
  {
    id: "pierced",
    label: "平安扣",
    item: {
      id: "preview-pierced",
      name: "测试平安扣",
      type: "product",
      materialStage: "carved",
      kind: "peacePendant",
      design: "peacePendant",
      templateSize: { w: 30, h: 30 },
      sourceMaterial: previewSourceMaterial("pierced", "ping", { x: 296, y: 296, rot: -3, scale: 0.88, kitType: "peacePendant" }),
      value: 7600
    }
  },
  {
    id: "bangle",
    label: "手镯精修",
    item: {
      id: "preview-bangle",
      name: "测试手镯",
      type: "product",
      materialStage: "carved",
      kind: "bracelet",
      design: "bracelet",
      templateSize: { w: 34, h: 34 },
      ringSize: 56,
      sourceMaterial: previewSourceMaterial("bangle", "bangle", { x: 302, y: 304, rot: 10, scale: 0.82, kitType: "bangle" }),
      value: 6800
    }
  }
];

INLAY_PREVIEW_SHAPES.push(
  { id: "plaque", catalogShape: "pierced", label: "方牌", item: {
    id: "preview-plaque", name: "测试方牌", kind: "plaque", materialStage: "carved", templateSize: { w: 30, h: 32 }, value: 9200,
    sourceMaterial: previewSourceMaterial("pierced", "rect", { x: 296, y: 296, scale: 1, kitType: "plaque" })
  } },
  { id: "leaf", catalogShape: "carving", label: "叶子", item: {
    id: "preview-leaf", name: "测试叶子", kind: "leafPendant", materialStage: "carved", templateSize: { w: 24, h: 36 }, value: 8600,
    sourceMaterial: previewSourceMaterial("carving", "leaf", { x: 306, y: 310, scale: 1, kitType: "leafPendant" })
  } }
);

export function previewCapabilityShape(shape) {
  return INLAY_PREVIEW_SHAPES.find((entry) => entry.id === shape)?.catalogShape || shape;
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function previewShapeIds(catalog) {
  return INLAY_PREVIEW_SHAPES
    .map((shape) => shape.id)
    .filter((shape) => (catalog.productTypes?.[previewCapabilityShape(shape)] || []).length && (shape === "bangle" || (catalog.shapeSettings?.[previewCapabilityShape(shape)] || []).length));
}

function firstShape(catalog) {
  return previewShapeIds(catalog)[0] || INLAY_PREVIEW_SHAPES[0].id;
}

function normalizeTesterMetal(draft, catalog) {
  if (draft.process === "bangle") return;
  const metals = catalog.settings?.[draft.settingId]?.metals || [];
  if (!metals.length) {
    draft.metalId = null;
  } else if (!draft.metalId || !metals.includes(draft.metalId)) {
    draft.metalId = metals[0];
  }
}

export function buildInlayPreviewBaseItem(shape, size = "M") {
  const found = INLAY_PREVIEW_SHAPES.find((entry) => entry.id === shape) || INLAY_PREVIEW_SHAPES[0];
  const item = clone(found.item);
  if (shape !== "bangle") {
    item.size = size;
    item.sourceMaterial.placement.size = size;
  }
  return item;
}

export function normalizeInlayPreviewTesterState(state = {}, catalog = {}) {
  const allowedShapes = previewShapeIds(catalog);
  const shape = allowedShapes.includes(state.shape) ? state.shape : firstShape(catalog);
  const size = ["S", "M", "L"].includes(state.size) ? state.size : "M";
  const baseDraft = createFinishPlanDraft(previewCapabilityShape(shape), catalog);
  const draft = { ...baseDraft, ...(state.draft || {}) };
  normalizeFinishPlanDraft(previewCapabilityShape(shape), draft, catalog, buildInlayPreviewBaseItem(shape, size));
  normalizeTesterMetal(draft, catalog);
  return { shape, size, draft };
}

export function createInlayPreviewTesterState(catalog = {}) {
  return normalizeInlayPreviewTesterState({ shape: firstShape(catalog), draft: {} }, catalog);
}

export function applyInlayPreviewTesterField(state, field, value, catalog = {}) {
  const next = normalizeInlayPreviewTesterState(state, catalog);
  if (field === "shape") {
    next.shape = String(value || "");
    next.draft = {
      ...createFinishPlanDraft(previewCapabilityShape(next.shape), catalog),
      polishId: next.draft.polishId,
      gemId: next.draft.gemId,
      gemCount: next.draft.gemCount
    };
  } else if (field === "size") {
    next.size = String(value);
  } else if (field === "gemCount") {
    next.draft.gemCount = Number(value || 0);
  } else {
    next.draft[field] = value === "" ? null : value;
    if (field === "gemId" && next.draft.gemId && next.draft.gemCount < 1) next.draft.gemCount = 1;
    if (field === "gemId" && !next.draft.gemId) next.draft.gemCount = 0;
  }
  return normalizeInlayPreviewTesterState(next, catalog);
}

export function buildFinishPreviewProduct(item, draft = null) {
  if (isBangle(item) && draft?.process === "bangle") return { ...applyBangleFinish(clone(item), draft), preview: true };
  if (!draft?.productType || !draft?.settingId) return item;
  draft = normalizeFinishGemLayout(item, { ...draft });
  const jadeKind = finishedMotifKind(item);
  const components = [{
    type: "jade",
    role: "mainStone",
    pieceId: item.jadePiece?.id || item.id,
    kind: jadeKind,
    polishId: draft.polishId,
    sourceMaterial: item?.sourceMaterial ? clone(item.sourceMaterial) : null,
    templateSize: item?.templateSize || null
  }];

  if (draft.settingId === "cord") {
    components.push({
      type: "cord",
      role: "hanger",
      productType: draft.productType,
      settingId: draft.settingId,
      polishId: draft.polishId
    });
  } else {
    components.push({
      type: "mount",
      role: "setting",
      productType: draft.productType,
      settingId: draft.settingId,
      metalId: draft.metalId,
      backingId: draft.backingId || null
    });
  }

  if (Number(draft.gemCount || 0) > 0 && draft.gemId) {
    components.push({
      type: "accentStones",
      role: draft.gemLayout === SETTING_GEMS ? finishGemPolicy(draft).kind : draft.settingId === "channel" ? "channel" : "halo",
      gemId: draft.gemId,
      count: Number(draft.gemCount || 0),
      layout: draft.gemLayout || "legacy"
    });
  }

  return {
    ...item,
    id: item?.id || "finish-preview",
    productType: draft.productType,
    motifKind: jadeKind,
    inlay: { ...(item.inlay || {}), ...draft },
    kind: draft.productType,
    components,
    preview: true
  };
}

function variantDraft(state, catalog, patch) {
  const next = normalizeInlayPreviewTesterState(state, catalog);
  next.draft = { ...next.draft, ...patch };
  normalizeFinishPlanDraft(previewCapabilityShape(next.shape), next.draft, catalog, buildInlayPreviewBaseItem(next.shape, next.size));
  normalizeTesterMetal(next.draft, catalog);
  return next.draft;
}

export function settingPreviewVariants(state, catalog = {}) {
  const normalized = normalizeInlayPreviewTesterState(state, catalog);
  return (catalog.shapeSettings?.[previewCapabilityShape(normalized.shape)] || []).map((settingId) => {
    const draft = variantDraft(normalized, catalog, { settingId });
    return {
      id: settingId,
      label: catalog.settings?.[settingId]?.name || settingId,
      draft,
      selected: settingId === normalized.draft.settingId
    };
  });
}

export function metalPreviewVariants(state, catalog = {}) {
  const normalized = normalizeInlayPreviewTesterState(state, catalog);
  const metals = catalog.settings?.[normalized.draft.settingId]?.metals || [];
  if (!metals.length) {
    return [{
      id: "",
      label: "不使用金属",
      draft: variantDraft(normalized, catalog, { metalId: null }),
      selected: true
    }];
  }
  return metals.map((metalId) => ({
    id: metalId,
    label: catalog.metals?.[metalId] || metalId,
    draft: variantDraft(normalized, catalog, { metalId }),
    selected: metalId === normalized.draft.metalId
  }));
}
