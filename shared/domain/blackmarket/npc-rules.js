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
export const NPC_MARKET_REFRESH_MS = 10 * 60_000;
export const NPC_TARGET_STALLS = 36;

const specialistStalls = [
  { role: "stone", title: "老周石料摊", ownerName: "老周", blurb: "原石与明料都有，按表现挑料，丰俭由人。", stock: 6, discount: 1 },
  { role: "offcut", title: "阿青工坊散货", ownerName: "阿青", blurb: "片料、毛坯和余料，小本练手也能挑到合用的。", stock: 6, discount: 1 },
  { role: "finished", title: "玉姐成品铺", ownerName: "玉姐", blurb: "镯、牌、挂件与蛋面，做工和尺寸看明白再买。", stock: 6, discount: 1 },
  { role: "employee", title: "何叔人才行", ownerName: "何叔", blurb: "开料、规划、精加工、直播师傅，技能与日薪看明白再签约。", stock: 4, discount: 1 },
  { role: "equipment", title: "老鲁设备铺", ownerName: "老鲁", blurb: "三道工序的二手设备，型号、耐久和维修价明码展示。", stock: 6, discount: 1 },
  { role: "traveler", title: "行商临时柜", ownerName: "南来客", blurb: "轮换带来各地玉器成品，高货售完等下一批。", stock: 4, discount: 1, roaming: true }
];

const neighborhoodSpecialists = [
  ["stone", "老赵选料", "老赵"], ["stone", "阿林山货", "阿林"], ["stone", "木那小铺", "小杨"], ["stone", "桥头石摊", "阿荣"],
  ["offcut", "小陈边角料", "小陈"], ["offcut", "青禾散件", "阿禾"], ["offcut", "阿文练手料", "阿文"], ["offcut", "巷尾余料", "老胡"],
  ["finished", "兰姐玉铺", "兰姐"], ["finished", "小满挂件", "小满"], ["finished", "清和玉器", "阿清"], ["finished", "老许成品摊", "老许"]
].map(([role, title, ownerName], index) => ({ key: `neighbor-${index + 1}`, role, title, ownerName,
  blurb: role === "stone" ? "带了几块新料，按皮壳和开窗表现挑。" : role === "offcut" ? "工坊腾出来的边角料和毛坯，合用就带走。" : "自己挑的玉器小件，尺寸做工都摆明白。",
  stock: 4, discount: 1 }));

const mixedStalls = [
  ["阿成工坊转让", "阿成", ["offcut", "equipment"], "工坊换机，旧设备和余料一起转。"],
  ["老张师徒小摊", "老张", ["employee", "equipment"], "替熟识的师傅找下家，也带几台顺手的旧机。"],
  ["阿莲玉料铺", "阿莲", ["stone", "finished"], "进料时顺带收些成品，各挑了几件。"],
  ["小吴工坊清柜", "小吴", ["offcut", "finished", "equipment"], "清理工坊腾位置，有散件也有闲置机器。"],
  ["桥西同行摊", "阿凯", ["equipment", "employee", "offcut"], "帮同行周转设备、牵线师傅，也收些练手料。"],
  ["秀姐随身货", "秀姐", ["finished", "stone"], "玉器是主业，碰上顺眼的石头也带两块。"],
  ["老邓换班铺", "老邓", ["employee", "equipment"], "工坊换班，替师傅和闲置设备找个合适去处。"],
  ["长街小作坊", "小罗", ["offcut", "finished"], "自家余料和做好的小件，凑一摊慢慢卖。"],
  ["阿海进货摊", "阿海", ["stone", "equipment"], "这趟带了石料，也替朋友转一批旧设备。"],
  ["春生工坊", "春生", ["offcut", "equipment"], "工坊添了新机，旧机和边角料顺手转让。"],
  ["桂姨玉件", "桂姨", ["finished", "offcut"], "成品、毛坯各有几件，自己看合不合眼缘。"],
  ["阿宝周转铺", "阿宝", ["stone", "offcut", "equipment"], "常给附近工坊跑腿，带的都是同行托卖的货。"],
  ["南桥同行柜", "小范", ["employee", "offcut"], "帮师傅介绍工坊，闲时也替大家转点散料。"],
  ["溪边玉坊", "阿溪", ["finished", "equipment"], "小件成品摆几件，工坊闲机也在这儿转。"],
  ["老郑收料摊", "老郑", ["stone", "offcut"], "整料和散料都有，按各自的表现挑。"],
  ["阿岚手作摊", "阿岚", ["finished", "offcut"], "做好的玉件和没用完的料子，都是自家工坊的。"],
  ["石桥工坊闲置", "阿坤", ["equipment", "offcut", "employee"], "同行搬工坊，帮忙转机器、散料和介绍师傅。"],
  ["小宁代卖", "小宁", ["stone", "finished", "equipment"], "替几家相熟工坊代卖，东西不多，慢慢挑。"]
].map(([title, ownerName, assortment, blurb], index) => ({ key: `mixed-${index + 1}`, role: "traveler", title, ownerName,
  assortment, blurb, stock: 5, discount: 1 }));

const blindStalls = [
  ["阿桃小包", "阿桃", ["finished", "offcut"]], ["老唐随缘袋", "老唐", ["offcut", "stone"]],
  ["玉巷试手盒", "小梅", ["offcut", "finished"]], ["阿锦玉件盒", "阿锦", ["finished"]],
  ["桥头小盲包", "小林", ["stone", "offcut"]], ["阿福杂件袋", "阿福", ["offcut", "finished"]],
  ["溪南随缘柜", "阿南", ["finished", "stone"]], ["小月工坊盲包", "小月", ["offcut"]]
].map(([title, ownerName, assortment], index) => ({ key: `blind-${index + 1}`, role: "traveler", type: "blindbox", title, ownerName,
  assortment, blurb: "自家挑的几样料和玉件装成盲包，喜欢就试一盒。", stock: 9, discount: 0 }));

export const NPC_STALLS = Object.freeze([...specialistStalls.map((rule) => ({ ...rule, key: rule.role, permanent: true })),
  ...neighborhoodSpecialists, ...mixedStalls, ...blindStalls]);

export function npcRuleForStall(stall) {
  return NPC_STALLS.find((rule) => stall?.id === `bm-npc:${rule.key}`);
}

export function isNpcBlackStall(stall) {
  const rule = npcRuleForStall(stall);
  return stall?.npc === true && Boolean(rule) && stall.type === (rule.type || "goods")
    && stall.npcRole === rule.role && stall.ownerId === `npc:blackmarket:${rule.key}`
    && (!["employee", "equipment"].includes(rule.role) || stall.npcResourceVersion === 1);
}

export function isNpcGoodsRow(stall, row) {
  const rule = npcRuleForStall(stall);
  if (!rule) return false;
  const assortment = rule.assortment || [rule.role];
  if (["employee", "equipment"].includes(row.type)) return assortment.includes(row.type);
  return assortment.some((role) => !["employee", "equipment"].includes(role))
    && ["rough", "material", "slice", "bracelet"].includes(row.type);
}
