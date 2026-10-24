import assert from "node:assert/strict";
import {
  bmSellables,
  bmSelectionConflicts,
  buildBmListEntry,
  buildPlanPoolExtras
} from "../public/bm-plan-pool.js";

const kitsByParent = new Map([
  ["p1", [
    { id: "k1", tpl: "bangle", type: "bangle", x: 300, y: 300, rot: 0, scale: 1, size: 56, svgSpace: true },
    { id: "k2", tpl: "egg", type: "cabochon", x: 420, y: 360, rot: 0, scale: 1, size: "M", svgSpace: true }
  ]]
]);

const helpers = {
  kitsFor: (id) => kitsByParent.get(id) || [],
  openingKitProductLabel: (tpl) => ({ bangle: "手镯", egg: "蛋面" }[tpl] || tpl),
  openingKitsForServer: (id) => (kitsByParent.get(id) || []).map((kit) => ({
    id: kit.id,
    type: kit.type,
    openingTpl: kit.tpl,
    x: Math.round(kit.x / 6),
    y: Math.round(kit.y / 6),
    rot: kit.rot,
    scale: kit.scale,
    size: kit.tpl === "bangle" ? undefined : kit.size,
    ringSize: kit.tpl === "bangle" ? kit.size : undefined
  }))
};

const state = {
  me: {
    rough: [],
    materials: [{
      id: "p1",
      name: "规划测试料",
      type: "material",
      materialStage: "opened",
      value: 4000,
      quality: "冰种",
      qualityKey: "icy",
      color: "晴绿",
      visual: { seed: "p1" }
    }],
    slices: [],
    bracelets: []
  }
};

const extras = buildPlanPoolExtras(state, helpers);
assert.equal(extras.filter((row) => row._planned).length, 2);
assert.equal(extras.filter((row) => row._leftover).length, 1);
assert.ok(extras.every((row) => Number(row.value) > 0));
const leftoverExtra = extras.find((row) => row._leftover);
assert.ok(leftoverExtra?._leftoverEval?.remainPct >= 0);
assert.ok(leftoverExtra.value < state.me.materials[0].value, "planned cutouts must reduce the leftover's value");

const pool = bmSellables(state, helpers);
assert.ok(pool.some((row) => row.id === "p1"));
assert.ok(pool.some((row) => String(row.id).startsWith("planned:p1:")));
assert.ok(pool.some((row) => row.id === "leftover:p1"));

const selected = new Set(["p1"]);
assert.deepEqual(bmSelectionConflicts(selected, "leftover:p1", pool), ["p1"]);
assert.deepEqual(bmSelectionConflicts(new Set(["leftover:p1"]), "p1", pool), ["leftover:p1"]);

const planned = pool.find((row) => row.id === "planned:p1:k1");
const entry = buildBmListEntry(planned, 900);
assert.equal(entry.type, "planned");
assert.equal(entry.parentId, "p1");
assert.ok(entry.kit);
assert.equal(entry.kits.length, 2);

console.log("bm-plan-pool-smoke: ok");
