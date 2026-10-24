import assert from "node:assert/strict";
import { buildInventoryItems } from "../public/inventory-module.js";
import { inventoryDetailStats } from "../public/features/inventory/item-detail-model.js";
import { deliveryItemDetails } from "../public/features/workshop/delivery-details-ui.js";

const helpers = {
  materialStageForClient: (item) => item.materialStage,
  materialStageLabel: (stage) => ({ opened: "明料", carved: "精雕毛坯", finished: "最终成品" }[stage] || stage),
  typeName: (type) => ({ material: "明料", bracelet: "成品", slice: "片料" }[type] || type)
};
for (const [type, source, stage] of [["material", "materials", "opened"], ["slice", "slices", "opened"], ["bracelet", "bracelets", "carved"], ["bracelet", "bracelets", "finished"]]) {
  const item = { id: type + stage, name: "测试料子", type, materialStage: stage, quality: "冰种", color: "飘花绿", value: 12500, craftGrade: "A", miningOrigin: { mineName: "测试矿山", beltLabel: "老矿带" } };
  const before = structuredClone(item);
  const [entry] = buildInventoryItems({ me: { [source]: [item] } }, helpers);
  const expected = inventoryDetailStats(entry, helpers);
  const actual = deliveryItemDetails(item, helpers);
  assert.deepEqual(actual.stats, expected, "unclaimed outputs use the same detail fields as inventory");
  assert.equal(actual.stats.filter((row) => row.label === "花色").length, 1, "shared color fields are never duplicated");
  assert.equal(actual.stats.find((row) => row.label === "估值").value, "¥12,500");
  assert.equal(actual.stats.find((row) => row.label === "矿山来源").value, "测试矿山");
  assert.equal(actual.stats.find((row) => row.label === "花色").value, "飘花绿");
  assert.deepEqual(item, before, "viewing pending outputs never changes their ownership or values");
}
const escrow = inventoryDetailStats({ item: { escrowOrderId: "commission" }, isEscrow: true, totalValue: 0 });
assert.deepEqual(escrow[0], { label: "归属", value: "黑市委托物" });
console.log("workshop-delivery-details: inventory parity, raw/slices/blanks/finished, value, origin, escrow and read-only inspection ok");
