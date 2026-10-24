// Frozen workshop display defaults and stage/shape mappings.
import { isBangle } from "../../../shared/domain/workshop/bangle-finish.js";

export const WORKSHOP_DURATION_FALLBACK = {
  rough: 90 * 1000,
  refine: 4 * 60 * 1000,
  inlay: 2 * 60 * 1000
};

export const WORKSHOP_DEVICE_FALLBACKS = [
  { id: "opening", type: "opening", step: "open", name: "翠捷牌CJ-O1 快切型打磨机", baseName: "开料快切线", brandKey: "cuijie", brand: "翠捷", brandPositioning: "入门快周转", brandPriceTier: "入门", brandBasePrice: 6800, brandPeakPrice: 102500, category: "打磨机", tier: "T1", model: "翠捷 CJ-O1 快切型", modelName: "CJ-O1 快切型", inputStage: "rough", inputType: "rough", outputStage: "opened", capacity: 1, workerId: "worker-opening", fee: 620, condition: 92, attrs: { quality: 2, risk: 1.18, speed: 15, perfectFloor: 0 }, specs: "品质+2% · 风险×1.18 · 速度+15% · 保底0%", description: "低价快切入门款，适合早期把暗料快速推进到开料阶段。" },
  { id: "carving", type: "carving", step: "plan", name: "工造牌GZ-C1 基础套料套料机", baseName: "基础套料线", brandKey: "gongzao", brand: "工造", brandPositioning: "主流均衡", brandPriceTier: "标准", brandBasePrice: 9200, brandPeakPrice: 138700, category: "套料机", tier: "T1", model: "工造 GZ-C1 基础套料", modelName: "GZ-C1 基础套料", inputStage: "opened", inputType: "rough", outputStage: "carved", capacity: 1, workerId: "worker-polishing", fee: 900, condition: 84, attrs: { quality: 3, risk: 1.08, speed: 9, perfectFloor: 1 }, specs: "品质+3% · 风险×1.08 · 速度+9% · 保底1%", description: "基础规划取件线，便宜但不激进。" },
  { id: "finishing", type: "finishing", step: "finish", name: "琢光牌ZG-F1 亮抛型玉雕机·抛光机", baseName: "亮抛收光线", brandKey: "zhuoguang", brand: "琢光", brandPositioning: "出光精修", brandPriceTier: "高端", brandBasePrice: 14400, brandPeakPrice: 217200, category: "玉雕机·抛光机", tier: "T1", model: "琢光 ZG-F1 亮抛型", modelName: "ZG-F1 亮抛型", inputStage: "carved", inputType: "bracelet", outputStage: "finished", capacity: 1, workerId: "worker-carving", fee: 680, condition: 76, attrs: { quality: 5, risk: 1.06, speed: 8, perfectFloor: 1 }, specs: "品质+5% · 风险×1.06 · 速度+8% · 保底1%", description: "精加工基础强势款，适合提升常规成品光感。" }
];

export const WORKSHOP_WORKER_FALLBACKS = [
  { id: "worker-opening", name: "阿成", job: "cutter", tier: 5, tierLevel: 1, traits: ["稳手"], flaws: ["易裂"],
    skills: { cut: { jieliao: { level: 6, exp: 180 }, damo: { level: 5, exp: 150 } }, set: { qieliao: { level: 3, exp: 80 }, xiuxing: { level: 2, exp: 50 } }, finish: { diaozhuo: { level: 2, exp: 40 }, xiangqian: { level: 2, exp: 30 } }, speak: { huashu: { level: 1, exp: 15 }, kongchang: { level: 1, exp: 10 }, cuidan: { level: 1, exp: 5 } } } },
  { id: "worker-carving", name: "林师傅", job: "finisher", tier: 8, tierLevel: 1, traits: ["按线稳"], flaws: ["易脏"],
    skills: { cut: { jieliao: { level: 2, exp: 60 }, damo: { level: 2, exp: 40 } }, set: { qieliao: { level: 2, exp: 50 }, xiuxing: { level: 2, exp: 45 } }, finish: { diaozhuo: { level: 6, exp: 200 }, xiangqian: { level: 5, exp: 180 } }, speak: { huashu: { level: 1, exp: 20 }, kongchang: { level: 1, exp: 12 }, cuidan: { level: 1, exp: 8 } } } },
  { id: "worker-polishing", name: "小周", job: "planner", tier: 3, tierLevel: 1, traits: ["细光"], flaws: ["手重"],
    skills: { cut: { jieliao: { level: 3, exp: 90 }, damo: { level: 3, exp: 70 } }, set: { qieliao: { level: 6, exp: 240 }, xiuxing: { level: 5, exp: 210 } }, finish: { diaozhuo: { level: 2, exp: 35 }, xiangqian: { level: 2, exp: 25 } }, speak: { huashu: { level: 1, exp: 18 }, kongchang: { level: 1, exp: 11 }, cuidan: { level: 1, exp: 6 } } } },
  { id: "worker-finishing", name: "许工", job: "streamer", tier: 6, tierLevel: 1, traits: ["收口准"], flaws: ["易出绵"],
    skills: { cut: { jieliao: { level: 2, exp: 55 }, damo: { level: 2, exp: 45 } }, set: { qieliao: { level: 2, exp: 48 }, xiuxing: { level: 2, exp: 42 } }, finish: { diaozhuo: { level: 2, exp: 38 }, xiangqian: { level: 2, exp: 28 } }, speak: { huashu: { level: 6, exp: 190 }, kongchang: { level: 5, exp: 160 }, cuidan: { level: 5, exp: 155 } } } }
];

export const WORKSHOP_STEPS = [
  { id: "open", label: "开料", desc: "打磨暗料，显出真实料子样子。" },
  { id: "plan", label: "规划", desc: "在明料上摆放套件，规划取件。" },
  { id: "finish", label: "精加工", desc: "手镯修形抛光，挂件按需镶嵌。" }
];

export const STEP_BY_STAGE = { opening: "open", carving: "plan", finishing: "finish" };

export const WORKSHOP_DEVICE_TYPE_LABELS = { opening: "开料", carving: "规划", finishing: "精加工" };

export function deviceStep(d) {
  return STEP_BY_STAGE[d?.stage] || "open";
}

export function workshopDeviceTypeLabel(device) {
  return WORKSHOP_DEVICE_TYPE_LABELS[device?.stage] || "加工";
}

export function finishItemShape(item) {
  if (isBangle(item)) return "bangle";
  const key = String(item?.kind || item?.design || "").toLowerCase();
  if (["cabochon", "egg", "saddle", "蛋面"].includes(key)) return "cabochon";
  if ([
    "buddha", "buddhapendant", "guanyin", "guanyinpendant", "leaf", "leafpendant",
    "gourd", "gourdpendant", "fubean", "fubeanpendant", "droppendant", "ruyipendant",
    "carving", "雕件"
  ].includes(key)) return "carving";
  if (["peacependant", "plaque", "pierced", "平安扣", "无事牌", "山水牌"].includes(key)) return "pierced";
  return null;
}

