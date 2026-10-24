import assert from "node:assert/strict";

import {
  MINES,
  MINING_MAX_SHIFTS_PER_LEASE,
  MINING_QUALITY_KEYS,
  miningBasicShiftPlan
} from "../shared/domain/mining/mining-rules.js";
import { QUALITIES } from "../server/services/rough-pool-service.js";

const RENT_BANDS = Object.freeze({
  mist: [28_000, 36_000],
  ridge: [45_000, 60_000],
  glacier: [70_000, 95_000],
  deep: [95_000, 125_000],
  core: [110_000, 140_000]
});

const qualities = Object.fromEntries(QUALITIES.map((quality) => [quality.key, quality]));
const priceNoiseMean = (0.82 + 1.22) / 2;

function expectedStoneTrueValue(mine) {
  const totalWeight = mine.weights.reduce((sum, weight) => sum + weight, 0);
  const meanMass = (mine.massMin + mine.massMax) / 2;
  return mine.weights.reduce((sum, weight, index) => {
    const quality = qualities[MINING_QUALITY_KEYS[index]];
    const meanPrice = priceNoiseMean * (
      900
      + quality.score * quality.score * 720
      + meanMass * 620
    );
    return sum + (weight / totalWeight) * meanPrice * quality.value;
  }, 0);
}

assert.equal(MINING_MAX_SHIFTS_PER_LEASE, 5);
for (const mine of MINES) {
  const [minimum, maximum] = RENT_BANDS[mine.beltId];
  assert.ok(mine.rent >= minimum && mine.rent <= maximum,
    `${mine.name} rent must stay inside the ${mine.beltLabel} balance band`);
}

const oldCore = MINES.find((mine) => mine.id === "core-06");
assert.deepEqual([oldCore.yieldMin, oldCore.yieldMax], [1, 2],
  "the old core should be low-yield rather than a guaranteed single-stone loss leader");

const maxCrewPlan = miningBasicShiftPlan(MINES[0], [
  { id: "veteran-a", tier: 5 },
  { id: "veteran-b", tier: 5 },
  { id: "veteran-c", tier: 5 }
]);
assert.equal(maxCrewPlan.wageCost, 4_500);
assert.equal(maxCrewPlan.extraYieldChance, 0.45);

const expectedNets = MINES.map((mine) => {
  const plan = miningBasicShiftPlan(mine, [{ id: "ordinary", tier: 1 }]);
  const expectedCount = (plan.baseYieldMin + plan.baseYieldMax) / 2
    + plan.extraYieldChance
    - plan.risk;
  const allInShiftCost = mine.rent / MINING_MAX_SHIFTS_PER_LEASE + plan.total;
  return expectedStoneTrueValue(mine) * expectedCount - allInShiftCost;
});

const minimumNet = Math.min(...expectedNets);
const maximumNet = Math.max(...expectedNets);
assert.ok(minimumNet > 0, "every mine should remain positive in hidden-value expectation at full lease use");
assert.ok(maximumNet / minimumNet <= 5,
  "the strongest and weakest mines should stay within a fivefold expected-net band");

console.log("mining-balance-smoke: five rent bands, five-shift leases, capped crew bonus and <=5x expected-net spread ok");
