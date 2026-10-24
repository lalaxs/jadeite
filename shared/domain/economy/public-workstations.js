export const OWNER_OPERATOR_ID = "owner-operator";
export const PUBLIC_STATION_TIME_SCALE = 1.25;

export const PUBLIC_STATION_ROUTES = Object.freeze({
  opening: Object.freeze({ name: "公共开料工位", inputType: "rough", inputStage: "rough", outputStage: "opened", durationStage: "rough", needsKits: false, publicFee: 25 }),
  carving: Object.freeze({ name: "公共取件工位", inputType: "rough", inputStage: "opened", outputStage: "carved", durationStage: "refine", needsKits: true, publicFee: 35 }),
  finishing: Object.freeze({ name: "公共精加工位", inputType: "bracelet", inputStage: "carved", outputStage: "finished", durationStage: "inlay", needsKits: false, publicFee: 40 })
});

export function publicStationFee(device, item, playerId) {
  if (!device?.publicStation) return 0;
  if (item?.starterProtection && item.starterOwnerId === playerId) return 0;
  return Math.max(0, Math.round(Number(device.publicFee) || PUBLIC_STATION_ROUTES[device.stage]?.publicFee || 0));
}

export function publicWorkshopStations() {
  return Object.entries(PUBLIC_STATION_ROUTES).map(([stage, route]) => ({
    ...route, id: `public-${stage}`, stage, modelKey: `public-${stage}`,
    modelName: "街坊共享工位", model: "公共基础型", category: "公共工位", brand: "街坊",
    publicStation: true, resourceOrigin: "public", workerId: OWNER_OPERATOR_ID,
    capacity: 1, condition: 100, basePrice: 0, techLevel: 1,
    timeMultiplier: PUBLIC_STATION_TIME_SCALE,
    attrs: { quality: 0, risk: 1, speed: 0, perfectFloor: 0, valueBonusCap: 0 },
    specs: `按次使用 ¥${route.publicFee} · 无需购机 · 赠料免工位费`,
    description: "掌柜可亲自使用；公共工位速度较慢，按次结算使用费，不属于可交易资产。"
  }));
}
