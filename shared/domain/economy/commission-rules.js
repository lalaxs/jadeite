// Fixed-price NPC supplied-material labour. No player appraisal or purchase
// price is an input, so buying expensive jade cannot amplify these rewards.
export const COMMISSION_OFFERS = Object.freeze([
  Object.freeze({ id: "cord", name: "街坊绳饰来料单", description: "来料检视、取件和绳饰收光，适合起步练手。", minutes: 10, grossPay: 270, stationFee: 80, consumables: 30 }),
  Object.freeze({ id: "standard", name: "商户标准加工单", description: "完成一套开料、取件与精加工；NPC供料，费用在结算时扣除。", minutes: 11, grossPay: 310, stationFee: 100, consumables: 30 }),
  Object.freeze({ id: "bangle", name: "手镯整理来料单", description: "检视镯坯、修形与细光，耗时略长，固定报酬更高。", minutes: 12, grossPay: 350, stationFee: 120, consumables: 30 })
]);

export const COMMISSION_STAGES = Object.freeze(["opening", "carving", "finishing"]);
export const MAX_COMMISSION_NET_PAY = 5_000;
const STAGE_FEE_SHARE = Object.freeze({ opening: .25, carving: .35, finishing: .40 });
const ENTRY_EQUIPMENT_PRICE = Object.freeze({ opening: 3200, carving: 4600, finishing: 6200 });
const ENTRY_MAINTENANCE = Object.freeze({ opening: 8, carving: 12, finishing: 16 });
export const COMMISSION_CAPITAL_RETURN_PER_JOB = .005;
export const COMMISSION_STAGE_CRAFT_BONUS_CAP = 750;

function maintenanceQuote(device) {
  const tech = Math.max(1, Math.min(3, Math.round(Number(device.techLevel) || 1)));
  const risk = Number(device.attrs?.risk ?? 1);
  const wear = Math.max(1, Math.min(3, Math.round(1 + Math.max(0, risk - 1) * 5)));
  const rate = { 1: .25, 2: .20, 3: .15 }[tech];
  return Math.ceil(Math.max(0, Number(device.basePrice) || 0) * wear / 100 * rate);
}

export function quoteCommission(devices = [], offerId = "standard", profile = "normal", busyDeviceIds = []) {
  const offer = COMMISSION_OFFERS.find((row) => row.id === offerId);
  if (!offer) return null;
  const blocked = new Set(busyDeviceIds);
  let stationFee = offer.stationFee;
  let maintenanceFee = 0;
  let craftBonus = 0;
  let maintenanceAllowance = 0;
  let timeSaving = 0;
  const deviceIds = [];
  const ownedStages = [];
  for (const stage of COMMISSION_STAGES) {
    const stageFee = Math.round(offer.stationFee * STAGE_FEE_SHARE[stage]);
    const options = devices.filter((device) => device && device.stage === stage && !device.publicStation
      && !device.blackmarketListingId && Number(device.condition ?? 100) > 0 && !blocked.has(device.id))
      .map((device) => {
        const maintenance = maintenanceQuote(device);
        const tech = Math.max(1, Math.min(3, Math.round(Number(device.techLevel) || 1)));
        // A bounded service grade for the owned machine. It uses acquisition
        // tier, never jade value; extra upkeep is reimbursed within the quote
        // so higher technology is not penalized on these fixed-price jobs.
        const standardGradeBonus = device.brandKey === "used" ? 0 : (tech === 1 ? 15 : tech * 10);
        const capitalBonus = Math.min(COMMISSION_STAGE_CRAFT_BONUS_CAP,
          Math.round(Math.max(0, (Number(device.basePrice) || 0) - ENTRY_EQUIPMENT_PRICE[stage]) * COMMISSION_CAPITAL_RETURN_PER_JOB) + standardGradeBonus);
        const maintenanceSubsidy = Math.max(0, maintenance - ENTRY_MAINTENANCE[stage]);
        const bonus = 15 + capitalBonus;
        return { device, bonus, maintenance, maintenanceSubsidy,
          benefit: stageFee + bonus + maintenanceSubsidy - maintenance };
      }).filter((row) => row.benefit > 0)
      .sort((a, b) => b.benefit - a.benefit || Number(b.device.attrs?.speed || 0) - Number(a.device.attrs?.speed || 0));
    const selected = options[0];
    if (!selected) continue;
    stationFee -= stageFee;
    maintenanceFee += selected.maintenance;
    maintenanceAllowance += selected.maintenanceSubsidy;
    craftBonus += selected.bonus;
    timeSaving += .025 + Math.min(.025, Math.max(0, Number(selected.device.attrs?.speed) || 0) / 1000);
    deviceIds.push(selected.device.id);
    ownedStages.push(stage);
  }
  const grossPay = offer.grossPay + craftBonus + maintenanceAllowance;
  const normalDurationMs = Math.round(offer.minutes * 60_000 * (1 - Math.min(.15, timeSaving)));
  return {
    id: offer.id, offerId: offer.id, name: offer.name, description: offer.description,
    grossPay, craftBonus, maintenanceAllowance, stationFee, consumables: offer.consumables, maintenanceFee,
    netPay: grossPay - stationFee - offer.consumables - maintenanceFee,
    durationMs: profile === "test" ? Math.max(300, Math.round(normalDurationMs / 600)) : normalDurationMs,
    normalDurationMs, deviceIds, ownedStages,
    maintenanceIncluded: true
  };
}
