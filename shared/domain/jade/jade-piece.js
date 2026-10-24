// A piece is captured once at extraction. Finishing may add craft and assembly,
// but never derives a new material field or silhouette from the finished id.
export const JADE_PIECE_VERSION = 1;

export function jadePieceFor(item) {
  const piece = item?.jadePiece;
  return piece?.version === JADE_PIECE_VERSION && piece.geometry && piece.material && piece.kit
    ? piece : null;
}

function signature(value) {
  let hash = 2166136261;
  for (const ch of JSON.stringify(value)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function captureJadePiece(item, stone, kit, geometry) {
  const source = item.sourceMaterial || {};
  const { bestAngle, ...visibleTraits } = source.visual || {};
  const material = Object.fromEntries(
    ["id", "seed", "palList", "grade", "skin", "stonePath", "material", "seeds"]
      .map((key) => [key, stone[key]])
  );
  // Persist in its canonical JSON shape from day one, so save/reload does not
  // change the record (for example by dropping optional undefined properties).
  const piece = JSON.parse(JSON.stringify({
    version: JADE_PIECE_VERSION,
    id: item.id,
    name: item.baseName || item.name,
    roughId: source.roughId || item.sourceRoughId,
    roughName: source.roughName,
    kitId: source.placement?.id,
    placement: source.placement,
    kind: geometry.kind,
    size: item.size,
    ringSize: item.ringSize,
    intrinsic: {
      qualityKey: item.qualityKey, quality: item.quality, color: item.color,
      score: item.score, visual: visibleTraits,
      openingGrade: item.openingGrade, openingEval: item.openingEval,
      // Thickness is only claimed when the source actually measured it.
      thicknessMm: item.thicknessMm ?? source.thicknessMm ?? null
    },
    kit, geometry, material
  }));
  piece.signature = signature(piece);
  return piece;
}

export function jadePieceSizeLabel(item) {
  const piece = jadePieceFor(item);
  if (!piece) return item?.ringSize ? `${item.ringSize} 圈口` : ({ S: "小号", M: "中号", L: "大号" }[item?.size] || "沿用原件规格");
  const g = piece.geometry;
  const dims = `${g.width.toFixed(1)} × ${g.height.toFixed(1)} mm`;
  return piece.ringSize ? `${piece.ringSize} 圈口 · 外径 ${g.width.toFixed(1)} mm`
    : `${dims}${piece.intrinsic.thicknessMm ? ` · 厚 ${piece.intrinsic.thicknessMm} mm` : ""}`;
}

export function originalJadeItem(item) {
  const piece = jadePieceFor(item);
  return {
    ...item,
    ...(piece?.intrinsic || {}),
    name: piece?.name || item.baseName || item.name,
    kind: piece?.kind || item.motifKind || item.sourceMaterial?.placement?.layout || item.kind,
    components: [], inlay: null, finish: null, inlaid: false, polished: false,
    materialStage: "carved", stage: "carved", preview: false
  };
}
