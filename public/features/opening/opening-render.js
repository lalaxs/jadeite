// Opening stone / product / board render (moved from main.js)

import { jadeCanvasMarkup } from "../../jade-renderer.js";
import { productKindLabel } from "../../jade-categories.js";
import { resolveExactOpeningProductPlacement } from "../../product-meta.js";
import { componentJewelrySvg } from "../../inlay-product-renderer.js";
import { jadePieceFor } from "../../../shared/domain/jade/jade-piece.js";
import {
  KIT_LIB as OPENING_KIT_LIB,
  buildOpeningStone,
  computeGrade as computeOpeningGrade,
  evaluateOpeningKit,
  evaluateLeftoverMaterial,
  mapOpeningKitToProductKind,
  renderJadeOpeningProductSvg,
  renderJadeOpeningSvg,
  scaleForOpeningKit
} from "../../jade-opening-engine.js";
import { materialEvaluationWeight, partitionMaterialValue } from "../../../shared/domain/workshop/material-value-pool.js";
import { escapeHtml, formatMoney } from "../../shell/format-utils.js";
import {
  OPENING_KIT_BY_SERVER_TYPE,
  OPENING_KIT_SERVER_TYPES,
  OPENING_KIT_TEMPLATE_IDS,
  BANGLE_RING_SIZES,
  PENDANT_SIZE_OPTIONS,
  openingStoneCache,
  selectedBangleRingSize,
  selectedOpeningKitId,
  selectedOpeningKitTpl,
  selectedPendantSize,
  setSelectedOpeningKitId,
  openingKitSizeLabel
} from "./opening-state.js";
import { kitsFor } from "./opening-kits.js";

export let getState = () => null;
export let materialStageForClient = () => "unknown";

export function bindOpeningRenderDeps(deps = {}) {
  if (typeof deps.getState === "function") getState = deps.getState;
  if (typeof deps.materialStageForClient === "function") materialStageForClient = deps.materialStageForClient;
}

export function openingSeedFor(rough) {
  return rough.openingSeed || rough.visual?.openingSeed || rough.visual?.seed || rough.id || rough.name;
}

export function openingStoneFor(rough) {
  const qualityToken = rough.qualityKey || rough.quality || "hidden";
  const colorToken = rough.color || "hidden";
  const key = `${rough.id || rough.name}:${openingSeedFor(rough)}:${qualityToken}:${colorToken}`;
  if (!openingStoneCache.has(key)) {
    openingStoneCache.set(key, buildOpeningStone({
      seed: `${rough.id || rough.name}:${openingSeedFor(rough)}`,
      roughId: rough.id || rough.name,
      qualityKey: rough.qualityKey,
      quality: rough.quality,
      color: rough.color
    }));
  }
  return openingStoneCache.get(key);
}

export function openingKitTemplate(tplId) {
  return OPENING_KIT_LIB.find((kit) => kit.id === tplId) || OPENING_KIT_LIB[0];
}

export function serverTypeForOpeningKit(tplId) {
  return OPENING_KIT_SERVER_TYPES[tplId] || "peacePendant";
}

export function openingTplForServerType(type) {
  return OPENING_KIT_BY_SERVER_TYPE[type] || "ping";
}

export function openingKitProductLabel(tplId) {
  return productKindLabel(mapOpeningKitToProductKind(tplId));
}

export function openingKitFromStored(kit, saved = false) {
  const tpl = kit.tpl || kit.openingTpl || openingTplForServerType(kit.type);
  const scale = Number(kit.scale) || scaleForOpeningKit(tpl, kit.size || kit.ringSize || (tpl === "bangle" ? 56 : "M"));
  const rawX = Number(kit.x) || 50;
  const rawY = Number(kit.y) || 50;
  const usesPercent = rawX <= 100 && rawY <= 100 && !kit.svgSpace;
  return {
    uid: kit.id,
    id: kit.id,
    tpl,
    type: serverTypeForOpeningKit(tpl),
    x: usesPercent ? rawX * 6 : rawX,
    y: usesPercent ? rawY * 6 : rawY,
    rot: Number(kit.rot ?? kit.rotation ?? 0),
    scale,
    size: kit.size || kit.ringSize || (tpl === "bangle" ? 56 : "M"),
    extracted: saved,
    saved
  };
}

// Match authoritative submission/placement normalization before quoting. Draft
// SVG positions are rounded to integer percentages by openingKitsForServer;
// historical positions and scales retain their saved precision.
export function openingKitForValuePreview(kit, { saved = false, maxScale = 1.45 } = {}) {
  // Saved extractionKits are server percentage records, including legacy
  // entries carrying an erroneous svgSpace flag. That flag is only meaningful
  // for client drafts and independent product-placement rendering.
  const savedCoordinate = (value) => Math.max(4, Math.min(96, Number(value) || 50));
  const source = saved ? { ...kit, x: savedCoordinate(kit.x), y: savedCoordinate(kit.y), svgSpace: false } : kit;
  const opening = openingKitFromStored(source, saved);
  const tpl = OPENING_KIT_TEMPLATE_IDS.has(opening.tpl) ? opening.tpl : "ping";
  const size = tpl === "bangle"
    ? (BANGLE_RING_SIZES.includes(Number(opening.size)) ? Number(opening.size) : 56)
    : (["S", "M", "L"].includes(opening.size) ? opening.size : "M");
  const clampPosition = (value) => Math.max(72, Math.min(528, saved ? value : Math.round(value / 6) * 6));
  return { ...opening, tpl, size,
    x: clampPosition(opening.x), y: clampPosition(opening.y),
    rot: Math.round(((Number(opening.rot || 0) % 180) + 180) % 180),
    scale: saved ? Math.max(.45, Math.min(maxScale, opening.scale)) : scaleForOpeningKit(tpl, size) };
}

/** Geometry supplies weights only; quoted money always comes from one material pool. */
export function openingPlanningValuePreview(rough, kits = []) {
  const stone = openingStoneFor(rough);
  const maxScale = rough.leftoverGeometryVersion === 2 ? 5 : 1.45;
  const saved = (rough.extractionKits || rough.braceletPlacements || [])
    .map((kit) => openingKitForValuePreview(kit, { saved: true, maxScale }));
  const planned = kits.map((kit) => openingKitForValuePreview(kit));
  const evaluations = planned.map((kit) => evaluateOpeningKit(kit, stone));
  const options = { withinStone: rough.leftoverGeometryVersion === 2 };
  const before = evaluateLeftoverMaterial(saved, stone, options);
  const after = evaluateLeftoverMaterial([...saved, ...planned], stone, options);
  const previousRatio = Math.max(.0001, Math.min(1, Number(rough.remainingRatio ?? rough.openingEval?.remainRatio ?? 1) || 0));
  const beforeWeight = materialEvaluationWeight(before, stone);
  const valueRetainedRatio = beforeWeight > 0 ? materialEvaluationWeight(after, stone) / beforeWeight : after.remainRatio / previousRatio;
  const partition = partitionMaterialValue(rough, after.remainRatio, evaluations.map((evaluation) => evaluation.price), { valueRetainedRatio });
  return { stone, planned, evaluations, partition };
}

export function productsReferencingRough(roughId) {
  const id = String(roughId || "");
  const state = getState();
  if (!id || !state?.me) return [];
  const me = state.me;
  const out = [];
  for (const product of me.bracelets || []) {
    if (product) out.push(product);
  }
  // 加工中的产物已离开 bracelets，仍要算进父料已扣缺口
  for (const job of me.jobs || []) {
    if (job?.item) out.push(job.item);
  }
  for (const job of me.polishingJobs || []) {
    if (job?.item) out.push(job.item);
  }
  return out.filter((product) => (
    String(product.sourceRoughId || product.sourceMaterial?.roughId || "") === id
  ));
}

export function openingKitsFromProductPlacements(roughId) {
  const id = String(roughId || "");
  if (!id) return [];
  const kits = [];
  const seen = new Set();
  for (const product of productsReferencingRough(id)) {
    const placement = product.sourceMaterial?.placement || product.plan;
    if (!placement) continue;
    const key = String(placement.id || placement.kitId || product.id || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kits.push(openingKitFromStored({
      id: key,
      uid: key,
      type: placement.kitType || product.kind || placement.openingTpl,
      openingTpl: placement.openingTpl,
      tpl: placement.openingTpl,
      x: placement.x,
      y: placement.y,
      rot: placement.rot ?? placement.rotation,
      scale: placement.scale,
      size: placement.size,
      ringSize: placement.ringSize,
      svgSpace: placement.svgSpace
    }, true));
  }
  return kits;
}

export function openingKitsForRender(rough) {
  // 黑市规划余料虚拟项：套件挂在 _planKitsServer，按已取件黑洞绘制
  if (rough?._leftover && Array.isArray(rough._planKitsServer) && rough._planKitsServer.length) {
    return rough._planKitsServer.map((kit) => openingKitFromStored(kit, true));
  }
  const saved = (rough.extractionKits || rough.braceletPlacements || []).map((kit) => openingKitFromStored(kit, true));
  // 与库存产物 + 加工中产物 placement 合并回补（旧存档缺 extractionKits，或产物进 job 后仍要显示缺口）
  const fromProducts = openingKitsFromProductPlacements(rough.id || rough.sourceRoughId);
  const merged = [];
  const seen = new Set();
  for (const kit of [...saved, ...fromProducts]) {
    const key = String(kit?.id || kit?.uid || "");
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    merged.push(kit);
  }
  const active = kitsFor(rough.id).map((kit) => openingKitFromStored(kit));
  return [...merged, ...active];
}

export function openingStoneSvg(rough, options = {}) {
  return renderJadeOpeningSvg(openingStoneFor(rough), {
    scratches: [],
    kits: options.kits || [],
    revealed: Boolean(options.revealed),
    label: rough.name,
    selectedUid: options.selectedUid,
    outlineOnly: options.outlineOnly
  });
}

export function openingProductKitFor(item, placement) {
  const rawX = Number(placement.x);
  const rawY = Number(placement.y);
  const usesPercent = rawX <= 100 && rawY <= 100 && !placement.svgSpace;
  return {
    uid: item.id || placement.id,
    id: item.id || placement.id,
    tpl: placement.openingTpl,
    x: usesPercent ? rawX * 6 : rawX,
    y: usesPercent ? rawY * 6 : rawY,
    rot: Number(placement.rot ?? placement.rotation ?? 0),
    scale: Number(placement.scale),
    size: placement.ringSize || item.ringSize || (placement.openingTpl === "bangle" ? 56 : "M")
  };
}

export function openingProductSvg(item, size = "finished") {
  const source = item?.sourceMaterial;
  const placement = resolveExactOpeningProductPlacement(source, {
    validTemplateIds: OPENING_KIT_TEMPLATE_IDS,
    templateByKitType: OPENING_KIT_BY_SERVER_TYPE
  });
  if (!placement) return "";
  const rough = {
    id: source.roughId || item.sourceRoughId || item.id,
    name: source.roughName || item.name,
    visual: source.visual,
    openingSeed: source.openingSeed,
    qualityKey: source.qualityKey || item.qualityKey,
    quality: source.quality || item.quality,
    color: source.color || item.color
  };
  return `
    <div class="jade-opening-product ${escapeHtml(size)}" aria-label="${escapeHtml(item.name)}对应料子裁片">
      ${renderJadeOpeningProductSvg(openingStoneFor(rough), openingProductKitFor(item, placement), {
        label: item.name
      })}
    </div>
  `;
}

export function productCutoutPlaceholder(item, size = "finished") {
  const label = escapeHtml(item?.name || "套件");
  return `
    <div class="jade-opening-product ${escapeHtml(size)} is-placeholder" role="img" aria-label="${label}裁切数据缺失">
      <svg class="jade-opening-product-svg" viewBox="-80 -80 160 160" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
        <path d="M0-58C39-58 58-32 58 2C58 39 33 58 0 58C-36 58-58 34-58 0C-58-35-34-58 0-58Z"
          fill="rgba(48,166,105,.16)" stroke="currentColor" stroke-width="4" stroke-dasharray="8 7"/>
      </svg>
      <span class="sr-only">${label}缺少原始裁切数据</span>
    </div>
  `;
}

export function componentJadeCutoutMarkup(item, size = "finished") {
  const jade = Array.isArray(item?.components)
    ? item.components.find((component) => component?.type === "jade")
    : null;
  const sourceMaterial = jade?.sourceMaterial || item?.sourceMaterial;
  if (!sourceMaterial) return "";
  return openingProductSvg({
    ...item,
    kind: jade?.kind || item?.kind,
    sourceMaterial,
    templateSize: jade?.templateSize || item?.templateSize
  }, size);
}

export function productCanvas(item, size = "finished") {
  if (Array.isArray(item?.components) && item.components.length) {
    return componentJewelrySvg(item, size);
  }
  if (jadePieceFor(item)) {
    return componentJewelrySvg(item, size, { viewMode: item.polished ? "jade" : "original" });
  }
  // Raw material has no product silhouette. In particular, opened slices
  // must keep the same source map used by the carving planner, not fall
  // through to the canvas renderer's default bracelet.
  const sourceType = item.type || item._type;
  if (["rough", "material", "slice"].includes(sourceType) && !item._planned) {
    const revealed = sourceType !== "rough"
      || ["opened", "material"].includes(item.materialStage || item.stage)
      || Boolean(item.revealed || item.windows?.length);
    return openingStoneSvg(item, { revealed, kits: openingKitsForRender(item) });
  }
  const exactCutout = openingProductSvg(item, size);
  if (exactCutout) return exactCutout;
  const stage = materialStageForClient(item);
  if (item?.sourceMaterial || stage === "carved" || stage === "finished") {
    return productCutoutPlaceholder(item, size);
  }
  return jadeCanvasMarkup("product", item, size);
}

export function roughBoard(rough) {
  const kits = openingKitsForRender(rough);
  return `
    <div class="rough-board-wrap jade-opening-board" data-opening-board="${rough.id}" data-rough-board="${rough.id}" aria-label="${escapeHtml(rough.name)}取件规划">
      ${openingStoneSvg(rough, { revealed: true, kits, selectedUid: selectedOpeningKitId, outlineOnly: true })}
    </div>
  `;
}

export function roughPlannerControls(rough) {
  const kits = kitsFor(rough.id);
  if (selectedOpeningKitId && !kits.some((kit) => kit.id === selectedOpeningKitId)) {
    setSelectedOpeningKitId(null);
  }
  const savedCount = (rough.extractionKits || rough.braceletPlacements || []).length;
  const planningBangle = selectedOpeningKitTpl === "bangle";
  const sizeRow = planningBangle
    ? `
      <div class="kit-size-row" role="group" aria-label="手镯圈口">
        <span class="kit-size-label">手镯圈口</span>
        <div class="kit-size-options">
          ${BANGLE_RING_SIZES.map((size) => `
            <button class="kit-size-choice ${selectedBangleRingSize === size ? "on" : ""}" type="button"
              data-opening-kit-size="${size}" data-opening-kit-size-kind="bangle" data-rough="${rough.id}">${size}</button>
          `).join("")}
        </div>
      </div>
    `
    : `
      <div class="kit-size-row" role="group" aria-label="挂件尺寸">
        <span class="kit-size-label">挂件尺寸</span>
        <div class="kit-size-options">
          ${PENDANT_SIZE_OPTIONS.map((option) => `
            <button class="kit-size-choice ${selectedPendantSize === option.id ? "on" : ""}" type="button"
              data-opening-kit-size="${option.id}" data-opening-kit-size-kind="pendant" data-rough="${rough.id}">${option.label}</button>
          `).join("")}
        </div>
      </div>
    `;
  return `
    <div class="layout-tools">
      <div class="kit-choice-row">
        ${OPENING_KIT_LIB.map((template) => `<button class="kit-choice opening-kit-choice ${selectedOpeningKitTpl === template.id ? "on" : ""}" data-opening-kit-choice="${template.id}" data-rough="${rough.id}" type="button">${escapeHtml(template.name)}</button>`).join("")}
      </div>
      ${sizeRow}
      <div class="placement-summary">
        <div class="placement-summary-copy">
          <strong>本次 ${kits.length} 件</strong>
          <span>已取 ${savedCount} 件</span>
        </div>
        <button class="secondary" data-action="clearRoughKits" data-payload="${rough.id}" ${kits.length ? "" : "disabled"}>清空</button>
      </div>
    </div>
  `;
}

export function placementAnalysisRows(rough, kits) {
  if (!kits.length) return `<div class="placement-analysis muted">选择套件后显示吃色、压裂和边缘风险。</div>`;
  const { stone, planned, evaluations, partition } = openingPlanningValuePreview(rough, kits);
  const pieceValue = partition.pieces.reduce((sum, piece) => sum + piece.value, 0);
  return `
    <div class="placement-analysis">
      <div class="placement-summary"><strong>取件料值 ${formatMoney(pieceValue)}</strong><span>余料料值 ${formatMoney(partition.leftover.value)}</span></div>
      ${kits.map((kit, index) => {
        const openingKit = planned[index];
        const template = openingKitTemplate(openingKit.tpl);
        const evalResult = evaluations[index];
        const grade = computeOpeningGrade(evalResult, stone);
        const tone = evalResult.penalty > 0.42 || grade.score < 34 ? "danger" : grade.score >= 65 ? "profit" : "";
        const crackPct = Math.round(evalResult.crackRatio * 100);
        const wastePct = Math.round(evalResult.wasteRatio * 100);
        const crackWarn = crackPct >= 20 ? "is-warn" : "";
        const wasteWarn = wastePct >= 40 ? "is-warn" : "";
        return `
          <article class="analysis-row ${tone}">
            <header class="analysis-head">
              <div class="analysis-title">
                <span class="analysis-kind">${escapeHtml(template.name)} · ${escapeHtml(openingKitSizeLabel(openingKit.tpl, openingKit.size))}</span>
                <strong class="analysis-grade">${escapeHtml(grade.letter)}</strong>
              </div>
              <strong class="analysis-price" data-value-kind="material">料值 ${formatMoney(partition.pieces[index].value)}</strong>
            </header>
            <div class="analysis-metrics" aria-label="取件风险与吃色">
              <div class="analysis-metric ${crackWarn}"><em>裂</em><b>${crackPct}%</b></div>
              <div class="analysis-metric ${wasteWarn}"><em>废料</em><b>${wastePct}%</b></div>
              <div class="analysis-metric"><em>色</em><b>${Number(grade.breakdown.color) || 0}</b></div>
              <div class="analysis-metric"><em>种水</em><b>${Number(grade.breakdown.water) || 0}</b></div>
            </div>
          </article>
        `;
      }).join("")}
      <p class="muted">取件料值按当前明料分摊，未含本次加工与精修增值；实际收入以成交为准。</p>
    </div>
  `;
}
