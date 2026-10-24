/**
 * Workshop roster — starter devices/workers + normalizeWorkshop.
 */
import { randomUUID } from "node:crypto";
import { normalizeDevices } from "../systems/equipment-system.js";
import { OWNER_OPERATOR_ID, publicWorkshopStations } from "../../shared/domain/economy/public-workstations.js";
export { OWNER_OPERATOR_ID, publicWorkshopStations } from "../../shared/domain/economy/public-workstations.js";
import {
  ensureRecruitCandidates,
  baseWageForTier,
  sanitizeWorkerTraits,
  normalizeDismissedStarterIds,
  normalizeEmployeePayroll
} from "../systems/employee-system.js";

export const WORKSHOP_WORKER_DEFS = [
  {
    id: "worker-opening",
    name: "阿成",
    job: "cutter",
    tier: 5,
    tierLevel: 1,
    traits: ["稳手"],
    flaws: ["易裂"],
    skills: {
      cut:    { jieliao: { level: 6, exp: 240 }, damo: { level: 5, exp: 180 } },
      set:    { qieliao: { level: 6, exp: 210 }, xiuxing: { level: 5, exp: 170 } },
      finish: { diaozhuo: { level: 4, exp: 120 }, xiangqian: { level: 4, exp: 110 } },
      speak:  { huashu: { level: 2, exp: 35 }, kongchang: { level: 1, exp: 22 }, cuidan: { level: 2, exp: 18 } }
    }
  },
  {
    id: "worker-carving",
    name: "林师傅",
    job: "finisher",
    tier: 8,
    tierLevel: 1,
    traits: ["按线稳"],
    flaws: ["易脏"],
    skills: {
      cut:    { jieliao: { level: 2, exp: 60 }, damo: { level: 2, exp: 40 } },
      set:    { qieliao: { level: 2, exp: 50 }, xiuxing: { level: 2, exp: 45 } },
      finish: { diaozhuo: { level: 6, exp: 200 }, xiangqian: { level: 5, exp: 180 } },
      speak:  { huashu: { level: 1, exp: 20 }, kongchang: { level: 1, exp: 12 }, cuidan: { level: 1, exp: 8 } }
    }
  },
  {
    id: "worker-polishing",
    name: "小周",
    job: "planner",
    tier: 3,
    tierLevel: 1,
    traits: ["细光"],
    flaws: ["手重"],
    skills: {
      cut:    { jieliao: { level: 3, exp: 90 }, damo: { level: 3, exp: 70 } },
      set:    { qieliao: { level: 6, exp: 240 }, xiuxing: { level: 5, exp: 210 } },
      finish: { diaozhuo: { level: 2, exp: 35 }, xiangqian: { level: 2, exp: 25 } },
      speak:  { huashu: { level: 1, exp: 18 }, kongchang: { level: 1, exp: 11 }, cuidan: { level: 1, exp: 6 } }
    }
  },
  {
    id: "worker-finishing",
    name: "许工",
    job: "streamer",
    tier: 6,
    tierLevel: 1,
    traits: ["收口准"],
    flaws: ["易出绵"],
    skills: {
      cut:    { jieliao: { level: 2, exp: 55 }, damo: { level: 2, exp: 45 } },
      set:    { qieliao: { level: 2, exp: 48 }, xiuxing: { level: 2, exp: 42 } },
      finish: { diaozhuo: { level: 2, exp: 38 }, xiangqian: { level: 2, exp: 28 } },
      speak:  { huashu: { level: 6, exp: 190 }, kongchang: { level: 5, exp: 160 }, cuidan: { level: 5, exp: 155 } }
    }
  }
];

/** The proprietor is not an employee and never enters the salary/trading roster. */
export function createOwnerOperator(existing = {}) {
  const skill = (key, dir) => ({ level: 3, exp: 0, ...existing.skills?.[dir]?.[key] });
  return {
    ...existing,
    id: OWNER_OPERATOR_ID,
    name: "掌柜（亲自操作）",
    job: "proprietor",
    tier: 1,
    tierLevel: 1,
    baseWage: 0,
    isOwner: true,
    virtual: true,
    resourceOrigin: "owner",
    traits: [],
    flaws: [],
    skills: {
      cut: { jieliao: skill("jieliao", "cut"), damo: skill("damo", "cut") },
      set: { qieliao: skill("qieliao", "set"), xiuxing: skill("xiuxing", "set") },
      finish: { diaozhuo: skill("diaozhuo", "finish"), xiangqian: skill("xiangqian", "finish") },
      speak: { huashu: { level: 1, exp: 0 }, kongchang: { level: 1, exp: 0 }, cuidan: { level: 1, exp: 0 } }
    }
  };
}

export function createWorkshopRoster({ clamp, makeId = randomUUID } = {}) {
  if (typeof clamp !== "function") {
    throw new Error("workshop-roster: clamp is required");
  }

  function starterDevices() {
    return [];
  }

  function mergeWorkerSkills(defSkills, existingSkills) {
    const out = {};
    for (const dir of ["cut", "set", "finish", "speak"]) {
      out[dir] = {};
      const defDir = defSkills?.[dir] || {};
      const exDir = existingSkills?.[dir] || {};
      for (const key of Object.keys(defDir)) {
        const ex = exDir[key] || {};
        const defSkill = defDir[key] || { level: 1, exp: 0 };
        out[dir][key] = {
          level: clamp(Math.round(Number(ex.level ?? defSkill.level) || 1), 1, 10),
          exp: Math.max(0, Number(ex.exp ?? defSkill.exp) || 0)
        };
      }
    }
    return out;
  }

  function normalizeWorkshop(player) {
    player.workshop ||= {};
    if (Array.isArray(player.workshop.devices)) {
      // 返回玩家：保留设备实例，但强制统一为固定 1 阶、容量 1。
      player.workshop.devices = normalizeDevices(player.workshop.devices.filter((device) => !device?.publicStation));
      if (player.workshop.resourceTradingVersion !== 1) {
        const starters = new Set(["cuijie-opening-1", "gongzao-carving-1", "zhuoguang-finishing-1"]);
        for (const device of player.workshop.devices) {
          if (!device.resourceOrigin) {
            device.resourceOrigin = starters.has(device.modelKey) ? "starter" : "legacy-purchase";
            starters.delete(device.modelKey);
          }
        }
      }
    } else {
      // New accounts purchase their own machines; public stations stay virtual.
      player.workshop.devices = starterDevices();
    }
    player.workshop.resourceTradingVersion = 1;
    player.workshop.dismissedStarterIds = normalizeDismissedStarterIds(
      player.workshop.dismissedStarterIds
    );
    // Do not resurrect the previous four gifted workers. Saved employees and
    // their acquired skill levels remain intact; fresh accounts start self-run.
    player.workshop.workers = (Array.isArray(player.workshop.workers) ? player.workshop.workers : [])
      .filter((worker) => worker && !worker.isOwner && worker.id !== OWNER_OPERATOR_ID)
      .map((worker) => {
      const definition = WORKSHOP_WORKER_DEFS.find((item) => item.id === worker.id);
      const { traits, flaws } = sanitizeWorkerTraits(worker, definition || {});
      return {
        ...worker,
        resourceOrigin: definition ? "starter" : (worker.resourceOrigin || "legacy-purchase"),
        job: worker.job || definition?.job || "cutter",
        tier: Math.max(1, Math.min(10, Number(worker.tier ?? definition?.tier) || 1)),
        tierLevel: Math.max(1, Math.round(Number(worker.tierLevel ?? definition?.tierLevel) || 1)),
        // 工资属于全局平衡参数；读档时按当前阶位重算，避免旧存档沿用过期工资。
        baseWage: baseWageForTier(worker.tier ?? definition?.tier),
        traits,
        flaws,
        skills: mergeWorkerSkills(definition?.skills || worker.skills, worker.skills)
      };
    });
    player.workshop.owner = createOwnerOperator(player.workshop.owner);
    const availableWorkerIds = new Set([OWNER_OPERATOR_ID, ...player.workshop.workers.map((worker) => worker.id)]);
    for (const device of player.workshop.devices) {
      if (!availableWorkerIds.has(device.workerId)) device.workerId = OWNER_OPERATOR_ID;
    }
    player.workshop.economyVersion = 2;
    normalizeEmployeePayroll(player);
    ensureRecruitCandidates(player, {
      rng: Math.random,
      makeId
    });
    if (!player.workshop.selectedDeviceId || ![...player.workshop.devices, ...publicWorkshopStations()].some((device) => device.id === player.workshop.selectedDeviceId)) {
      player.workshop.selectedDeviceId = player.workshop.devices[0]?.id || "public-opening";
    }
    return player.workshop;
  }

  return {
    WORKSHOP_WORKER_DEFS,
    starterDevices,
    publicWorkshopStations,
    mergeWorkerSkills,
    normalizeWorkshop
  };
}
