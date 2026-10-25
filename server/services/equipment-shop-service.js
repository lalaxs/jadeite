import { equipmentCatalog, buyEquipment } from "../systems/equipment-system.js";

const DAY_MS = 86_400_000;
const REFRESH_OFFSET_MS = 3 * 3_600_000; // Beijing 05:00.
const STAGES = ["opening", "carving", "finishing"];

export function createEquipmentShopService({ getState, spendCash, makeId, rng = Math.random }) {
  function ensureEquipmentShop(now = Date.now()) {
    const state = getState();
    const day = Math.floor((now + REFRESH_OFFSET_MS) / DAY_MS);
    if (state.equipmentShop?.day === day) return false;
    const catalog = equipmentCatalog();
    const items = [];
    const add = (model, stock) => items.push({ modelKey: model.modelKey, stock, initialStock: stock });
    const pick = (rows) => rows[Math.floor(rng() * rows.length)];
    for (const stage of STAGES) {
      const models = catalog.filter((row) => row.stage === stage).sort((a, b) => a.price - b.price);
      add(models.find((row) => row.brandKey === "used"), 5);
      const basic = models.filter((row) => row.brandKey !== "used" && row.techLevel === 1).slice(0, 3);
      add(pick(basic), 2);
      if (rng() < 0.25) add(pick(models.filter((row) => row.techLevel > 1)), 1);
    }
    state.equipmentShop = { day, refreshAt: (day + 1) * DAY_MS - REFRESH_OFFSET_MS, items };
    return true;
  }

  function buyShopEquipmentForPlayer(player, modelKey, now = Date.now()) {
    ensureEquipmentShop(now);
    const row = getState().equipmentShop.items.find((item) => item.modelKey === modelKey);
    if (!row) return { ok: false, code: "NOT_IN_STOCK", message: "该型号今日未上架，请查看商铺现有设备。" };
    if (row.stock <= 0) return { ok: false, code: "SOLD_OUT", message: "该设备今日已售罄，明日 05:00 补货。" };
    const result = buyEquipment(player, modelKey, { spendCash, makeId });
    if (result.ok) row.stock -= 1;
    return result;
  }

  ensureEquipmentShop();
  return { ensureEquipmentShop, buyShopEquipmentForPlayer };
}
