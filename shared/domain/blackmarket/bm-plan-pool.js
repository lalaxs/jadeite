/**
 * 黑市选品：已规划明料可拆成「规划产物 + 余料」进入货物/盲盒池。
 * 依赖注入 opening 评价与套件草稿，避免与工坊/库存循环引用。
 */

import {
  buildOpeningStone,
  evaluateOpeningKit,
  evaluateLeftoverMaterial,
  computeGrade,
  scaleForOpeningKit
} from "../jade/jade-opening-engine.js";
import { BLACKMARKET_GOODS_BUCKETS } from "./bm-constants.js";
import { resourceSellables } from "./bm-resources.js";

function numericValue(item) {
  const n = Number(item?.value ?? item?.price ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function openingSeedFor(rough) {
  return rough.openingSeed || rough.visual?.openingSeed || rough.visual?.seed || rough.id || rough.name;
}

function openingStoneFor(rough) {
  return buildOpeningStone({
    seed: `${rough.id || rough.name}:${openingSeedFor(rough)}`,
    roughId: rough.id || rough.name,
    qualityKey: rough.qualityKey,
    quality: rough.quality,
    color: rough.color
  });
}

function openingKitFromDraft(kit, helpers = {}) {
  const fromStored = helpers.openingKitFromStored;
  if (typeof fromStored === "function") return fromStored(kit);
  const tpl = kit.tpl || kit.openingTpl || "bangle";
  const scale = Number(kit.scale) || scaleForOpeningKit(tpl, kit.size || kit.ringSize || (tpl === "bangle" ? 56 : "M"));
  const rawX = Number(kit.x) || 50;
  const rawY = Number(kit.y) || 50;
  const usesPercent = rawX <= 100 && rawY <= 100 && !kit.svgSpace;
  return {
    uid: kit.id || kit.uid,
    id: kit.id || kit.uid,
    tpl,
    type: kit.type,
    x: usesPercent ? rawX * 6 : rawX,
    y: usesPercent ? rawY * 6 : rawY,
    rot: Number(kit.rot ?? kit.rotation ?? 0),
    scale,
    size: kit.size || kit.ringSize || (tpl === "bangle" ? 56 : "M")
  };
}

function kitLabel(kit, helpers = {}) {
  const tpl = kit.tpl || kit.openingTpl || "";
  const labelFor = helpers.openingKitProductLabel;
  if (typeof labelFor === "function") return labelFor(tpl) || "套件";
  return tpl || "套件";
}

function kitToServerPayload(kit, helpers = {}) {
  if (typeof helpers.openingKitsForServer === "function" && kit?._parentId) {
    const all = helpers.openingKitsForServer(kit._parentId) || [];
    const hit = all.find((row) => String(row.id) === String(kit.id || kit.uid));
    if (hit) return hit;
  }
  const opening = openingKitFromDraft(kit, helpers);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  return {
    id: opening.id || opening.uid,
    type: opening.type || kit.type || "bangle",
    openingTpl: opening.tpl,
    x: clamp(Math.round((Number(opening.x) || 300) / 6), 4, 96),
    y: clamp(Math.round((Number(opening.y) || 300) / 6), 4, 96),
    rot: Number(opening.rot || 0),
    scale: Number(opening.scale || 1),
    size: opening.tpl === "bangle" ? undefined : opening.size,
    ringSize: opening.tpl === "bangle" ? Number(opening.size || 56) : undefined
  };
}

export function parentsWithActiveKits(state = {}, helpers = {}) {
  const me = state.me || {};
  const listKits = helpers.kitsFor;
  if (typeof listKits !== "function") return [];
  const parents = [
    ...(me.rough || []).map((item) => ({ ...item, _type: "rough" })),
    ...(me.materials || []).map((item) => ({ ...item, _type: "material" }))
  ];
  return parents
    .filter((item) => !item?.escrowOrderId)
    .map((item) => {
      const kits = listKits(item.id) || [];
      return { item, kits, type: item._type };
    })
    .filter((row) => row.kits.length > 0);
}

export function buildPlanPoolExtras(state = {}, helpers = {}) {
  const extras = [];
  for (const { item: parent, kits, type } of parentsWithActiveKits(state, helpers)) {
    const stone = openingStoneFor(parent);
    const openingKits = kits.map((kit) => openingKitFromDraft(kit, helpers));
    for (let index = 0; index < kits.length; index += 1) {
      const kit = kits[index];
      const openingKit = openingKits[index];
      const evalResult = evaluateOpeningKit(openingKit, stone);
      const grade = computeGrade(evalResult, stone);
      const label = kitLabel(kit, helpers);
      const value = Math.max(1, Number(evalResult.price) || Math.round(numericValue(parent) / Math.max(2, kits.length + 1)));
      const kitId = kit.id || kit.uid || `k${index}`;
      extras.push({
        id: `planned:${parent.id}:${kitId}`,
        _type: "planned",
        type: "planned",
        name: `${parent.name || "明料"} · ${label}`,
        materialStage: "planned",
        stage: "planned",
        value,
        price: value,
        quality: parent.quality,
        qualityKey: parent.qualityKey,
        color: parent.color,
        kind: kit.type || openingKit.tpl,
        _planned: true,
        _plannedParentId: parent.id,
        _plannedParentType: type,
        _planKit: kit,
        _planKitServer: kitToServerPayload({ ...kit, _parentId: parent.id }, helpers),
        _planAllKitsServer: kits.map((row) => kitToServerPayload({ ...row, _parentId: parent.id }, helpers)),
        _planEval: {
          price: evalResult.price,
          letter: grade.letter,
          score: grade.score,
          crackPct: Math.round((evalResult.crackRatio || 0) * 100),
          wastePct: Math.round((evalResult.wasteRatio || 0) * 100)
        },
        sourceMaterial: {
          roughId: parent.id,
          roughName: parent.name,
          visual: parent.visual,
          openingSeed: openingSeedFor(parent),
          windows: parent.windows || [],
          qualityKey: parent.qualityKey,
          quality: parent.quality,
          color: parent.color,
          placement: {
            id: kitId,
            openingTpl: openingKit.tpl,
            kitType: kit.type,
            x: Number(kit.x),
            y: Number(kit.y),
            rot: Number(kit.rot ?? kit.rotation ?? 0),
            scale: Number(kit.scale || 1),
            size: kit.size,
            ringSize: kit.ringSize || (openingKit.tpl === "bangle" ? (kit.size || 56) : undefined),
            svgSpace: Boolean(kit.svgSpace)
          }
        }
      });
    }
    const leftoverEval = evaluateLeftoverMaterial(openingKits, stone);
    const remainingRatio = Math.max(0, Math.min(1, Number(leftoverEval.remainRatio) || 0));
    const leftoverValue = Math.max(1, Math.round(numericValue(parent) * remainingRatio));
    const leftoverGrade = computeGrade(leftoverEval, stone);
    extras.push({
      id: `leftover:${parent.id}`,
      _type: "leftover",
      type: "leftover",
      name: `${parent.name || "明料"} · 规划余料`,
      materialStage: "opened",
      stage: "opened",
      value: leftoverValue,
      price: leftoverValue,
      quality: parent.quality,
      qualityKey: parent.qualityKey,
      color: parent.color,
      visual: parent.visual,
      windows: parent.windows || [],
      openingSeed: openingSeedFor(parent),
      _leftover: true,
      _plannedParentId: parent.id,
      _plannedParentType: type,
      _planKitsServer: kits.map((kit) => kitToServerPayload({ ...kit, _parentId: parent.id }, helpers)),
      // Mirror server leftover so mlVisual / openingKitsForRender can paint consumed masks
      extractionKits: kits.map((kit) => kitToServerPayload({ ...kit, _parentId: parent.id }, helpers)),
      braceletPlacements: kits.map((kit) => kitToServerPayload({ ...kit, _parentId: parent.id }, helpers)),
      leftover: true,
      _leftoverEval: {
        price: leftoverEval.price,
        letter: leftoverGrade.letter,
        score: leftoverGrade.score,
        remainPct: Math.round(remainingRatio * 100),
        crackPct: Math.round((leftoverEval.crackRatio || 0) * 100),
        wastePct: Math.round((leftoverEval.wasteRatio || 0) * 100)
      }
    });
  }
  return extras;
}

/** 黑市货物/盲盒可选池：常规库存 + 规划产物 + 余料 */
export function bmSellables(state = {}, helpers = {}) {
  const me = state.me || {};
  const base = Object.entries(BLACKMARKET_GOODS_BUCKETS).flatMap(([type, bucket]) =>
    (me[bucket] || []).map((item) => ({ ...item, _type: type }))
  ).filter((item) => !item?.escrowOrderId);
  return [...base, ...buildPlanPoolExtras(state, helpers), ...resourceSellables(state)];
}

export function bmPlanParentId(item) {
  if (!item) return null;
  if (item._plannedParentId) return String(item._plannedParentId);
  if (item._leftover) return String(item.id || "").replace(/^leftover:/, "") || null;
  if (item._planned) {
    const m = String(item.id || "").match(/^planned:([^:]+):/);
    return m?.[1] || null;
  }
  return null;
}

/** 选中父料则不可再选其规划件/余料；反之亦然 */
export function bmSelectionConflicts(selectedIds, candidateId, sellables) {
  const byId = new Map(sellables.map((item) => [String(item.id), item]));
  const candidate = byId.get(String(candidateId));
  if (!candidate) return [];
  const selected = [...selectedIds].map((id) => byId.get(String(id))).filter(Boolean);
  const conflicts = [];
  const candParent = bmPlanParentId(candidate);
  const candIsParent = !candidate._planned && !candidate._leftover;
  for (const item of selected) {
    if (String(item.id) === String(candidate.id)) continue;
    const itemParent = bmPlanParentId(item);
    const itemIsParent = !item._planned && !item._leftover;
    if (candIsParent && itemParent && String(itemParent) === String(candidate.id)) {
      conflicts.push(item.id);
      continue;
    }
    if ((candidate._planned || candidate._leftover) && itemIsParent && String(item.id) === String(candParent)) {
      conflicts.push(item.id);
      continue;
    }
  }
  return conflicts;
}

export function buildBmListEntry(item, price) {
  if (!item) return null;
  if (item._type === "planned" || item._planned) {
    return {
      type: "planned",
      itemId: item.id,
      parentId: item._plannedParentId,
      parentType: item._plannedParentType || "material",
      kit: item._planKitServer || null,
      kits: item._planAllKitsServer || (item._planKitServer ? [item._planKitServer] : []),
      price
    };
  }
  if (item._type === "leftover" || item._leftover) {
    return {
      type: "leftover",
      itemId: item.id,
      parentId: item._plannedParentId,
      parentType: item._plannedParentType || "material",
      kits: item._planKitsServer || [],
      price
    };
  }
  if (!item._type) return null;
  return { type: item._type, itemId: item.id, price };
}
