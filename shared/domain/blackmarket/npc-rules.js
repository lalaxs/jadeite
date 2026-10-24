// NPC supply is shared by the world, never rolled per viewer or per visit.
export const NPC_SCHEDULE_VERSION = 1;
export const NPC_ROTATION_MIN_MS = 45 * 60_000;
export const NPC_ROTATION_MAX_MS = 90 * 60_000;
export const NPC_TRAVELER_ROTATION_MIN_MS = 90 * 60_000;
export const NPC_TRAVELER_ROTATION_MAX_MS = 150 * 60_000;
export const NPC_REFILL_MIN_MS = 15 * 60_000;
export const NPC_REFILL_MAX_MS = 30 * 60_000;
export const NPC_MIN_DISPLAY_MS = 30 * 60_000;
export const NPC_STALE_MS = 3 * 60 * 60_000;
export const NPC_SHIFT_MS = 60 * 60_000;
export const NPC_STALLS = Object.freeze([
  { role: "stone", title: "老周石料摊", ownerName: "老周", blurb: "原石与明料都有，按表现挑料，丰俭由人。", stock: 6, discount: 1 },
  { role: "offcut", title: "阿青工坊散货", ownerName: "阿青", blurb: "片料、毛坯和余料，小本练手也能挑到合用的。", stock: 6, discount: 1 },
  { role: "finished", title: "玉姐成品铺", ownerName: "玉姐", blurb: "镯、牌、挂件与蛋面，做工和尺寸看明白再买。", stock: 6, discount: 1 },
  { role: "employee", title: "何叔人才行", ownerName: "何叔", blurb: "开料、规划、精加工、直播师傅，技能与日薪看明白再签约。", stock: 4, discount: 1 },
  { role: "equipment", title: "老鲁设备铺", ownerName: "老鲁", blurb: "三道工序的二手设备，型号、耐久和维修价明码展示。", stock: 6, discount: 1 },
  { role: "traveler", title: "行商临时柜", ownerName: "南来客", blurb: "轮换带来各地玉器成品，高货售完等下一批。", stock: 4, discount: 1, roaming: true }
]);

export function isNpcBlackStall(stall) {
  return stall?.npc === true && stall.type === "goods"
    && (!["employee", "equipment"].includes(stall.npcRole) || stall.npcResourceVersion === 1)
    && NPC_STALLS.some((rule) => rule.role === stall.npcRole
      && stall.id === `bm-npc:${rule.role}` && stall.ownerId === `npc:blackmarket:${rule.role}`);
}

export function isNpcGoodsRow(stall, row) {
  if (stall.npcRole === "employee" || stall.npcRole === "equipment") return row.type === stall.npcRole;
  return ["rough", "material", "slice", "bracelet"].includes(row.type);
}
