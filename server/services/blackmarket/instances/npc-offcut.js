// Instance-owned implementation; legacy entry points remain one directory above.
import { buildOpeningStone, evaluateLeftoverMaterial } from "../../../../shared/domain/jade/jade-opening-engine.js";
import { createOffcutLayout, storedOffcutKit } from "../../../../shared/domain/jade/offcut-layout.js";
import { materialEvaluationWeight } from "../../../../shared/domain/workshop/material-value-pool.js";

export function createNpcOffcut({
  buildLeftoverMaterial
}) {
const NPC_OFFCUT_POLICY_VERSION = 3;

function createNpcOffcut(material, rng, deps, avoidProfile, avoidCount) {
  const stone = buildOpeningStone({
    seed: `${material.id}:${material.openingSeed || material.visual?.openingSeed || material.visual?.seed || material.id}`,
    roughId: material.id, qualityKey: material.qualityKey, quality: material.quality, color: material.color
  });
  let layout;
  let leftover;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    layout = createOffcutLayout(stone, rng, deps.randomUUID, { avoidProfile, avoidCount });
    leftover = buildLeftoverMaterial({ ...material, extractionKits: [], braceletPlacements: [], remainingRatio: 1, leftoverGeometryVersion: 2 }, layout.kits, deps.randomUUID, deps.money);
    const cuts = layout.kits.map(storedOffcutKit);
    const before = materialEvaluationWeight(evaluateLeftoverMaterial(cuts, stone, { withinStone: true }), stone);
    const after = materialEvaluationWeight(evaluateLeftoverMaterial([...cuts, layout.usableKit], stone, { withinStone: true }), stone);
    // A reserved gap must contain saleable jade, not just empty geometry, and
    // must yield at least one currency unit after the material pool rounds.
    if (before > after && Math.round(leftover.value * after / before) < leftover.value) break;
    leftover = null;
  }
  if (!leftover) throw new Error("Could not source an offcut with a positive-value usable reserve");
  // Keep the exact source map across shop, inventory and subsequent processing.
  leftover.id = material.id;
  leftover.name = `${material.quality}边角余料`;
  leftover.mass = Number((material.mass * leftover.remainingRatio).toFixed(2));
  leftover.npcOffcut = { version: 2, policyVersion: NPC_OFFCUT_POLICY_VERSION, profile: layout.profile, usableKit: layout.usableKit, margin: layout.margin, gap: layout.gap,
    sourceValue: material.value, sourceBaseValue: material.baseValue ?? material.value, sourceMass: material.mass };
  return leftover;
}

  return {
    NPC_OFFCUT_POLICY_VERSION,
    createNpcOffcut
  };
}
