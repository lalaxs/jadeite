const MODELS = {
  opening: [
    { modelKey: "rough", name: "粗加工台", category: "打磨机", model: "角磨机 CJ-1 基础型", price: 9000, quality: 3, risk: 1.20, speed: 12, perfectFloor: 0 },
    { modelKey: "refine", name: "精磨台", category: "精磨机", model: "精磨机 JM-2 稳型", price: 12000, quality: 5, risk: 0.85, speed: 4, perfectFloor: 2 },
    { modelKey: "waterbed", name: "水床切片机", category: "水床机", model: "水床切片 WB-3", price: 11000, quality: 4, risk: 1.00, speed: 8, perfectFloor: 1 }
  ],
  carving: [
    { modelKey: "carve", name: "套件雕刻台", category: "套料机", model: "数控套料机 SK-2", price: 13000, quality: 3, risk: 1.10, speed: 10, perfectFloor: 0 },
    { modelKey: "cnc", name: "数控取件台", category: "取件机", model: "数控取件 NC-4", price: 16000, quality: 5, risk: 0.90, speed: 6, perfectFloor: 1 },
    { modelKey: "scan3d", name: "3D扫描设计台", category: "扫描设计台", model: "3D扫描 SD-5", price: 18000, quality: 6, risk: 0.95, speed: 5, perfectFloor: 2 }
  ],
  finishing: [
    { modelKey: "polish", name: "精加工抛光台", category: "玉雕机·抛光机", model: "精雕抛光一体机 JP-3", price: 12000, quality: 3, risk: 1.10, speed: 8, perfectFloor: 0 },
    { modelKey: "inlay", name: "镶嵌一体机", category: "镶嵌机", model: "镶嵌一体 IJ-6", price: 15000, quality: 5, risk: 1.00, speed: 6, perfectFloor: 1 },
    { modelKey: "hiperf", name: "高光精雕机", category: "高光精雕机", model: "高光精雕 HG-7", price: 20000, quality: 7, risk: 1.15, speed: 4, perfectFloor: 2 }
  ]
};

const ROUTES = {
  opening: {
    inputType: "rough",
    inputStage: "rough",
    outputStage: "opened",
    durationStage: "rough",
    workerId: "worker-opening",
    fee: 620,
    needsKits: false
  },
  carving: {
    inputType: "rough",
    inputStage: "opened",
    outputStage: "carved",
    durationStage: "refine",
    workerId: "worker-polishing",
    fee: 900,
    needsKits: true
  },
  finishing: {
    inputType: "bracelet",
    inputStage: "carved",
    outputStage: "finished",
    durationStage: "inlay",
    workerId: "worker-carving",
    fee: 680,
    needsKits: false
  }
};

export function equipmentCatalog() {
  return Object.entries(MODELS).flatMap(([stage, rows]) =>
    rows.map((row) => ({ ...row, stage, tier: 1 }))
  );
}

export function createDeviceInstance(stage, modelKey, id) {
  const model = equipmentCatalog().find(
    (entry) => entry.stage === stage && entry.modelKey === modelKey
  );
  if (!model) return null;
  const baseAttrs = {
    quality: model.quality,
    risk: model.risk,
    speed: model.speed,
    perfectFloor: model.perfectFloor
  };
  return {
    id,
    stage,
    modelKey,
    name: model.name,
    category: model.category,
    model: model.model,
    tier: 1,
    basePrice: model.price,
    baseAttrs,
    attrs: { ...baseAttrs },
    ...ROUTES[stage],
    capacity: 1,
    condition: 100,
    specs: `品质+${model.quality}% · 风险×${model.risk} · 速度+${model.speed}% · 保底${model.perfectFloor}%`
  };
}

export function normalizeDevice(device) {
  const model = equipmentCatalog().find(
    (entry) => entry.stage === device?.stage && entry.modelKey === device?.modelKey
  );
  const canonical = model
    ? createDeviceInstance(model.stage, model.modelKey, device?.id)
    : {};
  return {
    ...canonical,
    ...device,
    id: device?.id,
    stage: model?.stage || device?.stage,
    modelKey: model?.modelKey || device?.modelKey,
    tier: 1,
    basePrice: Number(device?.basePrice || model?.price || 0),
    baseAttrs: {
      ...(canonical.baseAttrs || {}),
      ...(device?.baseAttrs || {})
    },
    attrs: {
      ...(canonical.attrs || {}),
      ...(device?.attrs || {})
    },
    capacity: 1,
    condition: Math.max(0, Math.min(100, Number(device?.condition ?? 100)))
  };
}

export function durabilityLoss(device) {
  const risk = Number(device?.attrs?.risk ?? 1);
  return Math.max(1, Math.min(3, Math.round(1 + Math.max(0, risk - 1) * 5)));
}

export function repairQuote(device) {
  const missing = 100 - Math.max(0, Math.min(100, Number(device?.condition ?? 100)));
  return Math.ceil(Number(device?.basePrice || 0) * (missing / 100) * 0.35);
}

export function buyEquipment(player, modelKey, { spendCash, makeId }) {
  const model = equipmentCatalog().find((entry) => entry.modelKey === modelKey);
  if (!model) {
    return { ok: false, code: "NOT_FOUND", message: "设备型号不存在。" };
  }
  if (!spendCash(
    player,
    model.price,
    `购入设备：${model.name}`,
    { source: "equipment", itemId: model.modelKey }
  )) {
    return {
      ok: false,
      code: "INSUFFICIENT_CASH",
      message: `购买 ${model.name} 需要 ¥${model.price}。`
    };
  }
  const device = createDeviceInstance(model.stage, model.modelKey, makeId());
  player.workshop ||= {};
  player.workshop.devices ||= [];
  player.workshop.devices.push(device);
  return { ok: true, message: `${model.name} 已加入工坊。`, device };
}

export function repairEquipment(player, deviceId, { spendCash }) {
  const device = player?.workshop?.devices?.find((item) => item.id === deviceId);
  if (!device) {
    return { ok: false, code: "NOT_FOUND", message: "设备不存在。" };
  }
  const cost = repairQuote(device);
  if (cost === 0) {
    return { ok: false, code: "INVALID_QUANTITY", message: "设备无需维修。" };
  }
  if (!spendCash(
    player,
    cost,
    `维修设备：${device.name}`,
    { source: "equipmentRepair", itemId: device.id }
  )) {
    return {
      ok: false,
      code: "INSUFFICIENT_CASH",
      message: `维修需要 ¥${cost}。`
    };
  }
  device.condition = 100;
  return { ok: true, message: `${device.name} 已维修至 100%。`, device, cost };
}
