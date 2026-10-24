// Compatibility exports for existing consumers and tests.
import { legacyBlackmarketModule } from "./legacy.js";
export function defaultServiceProfile(...args) { return legacyBlackmarketModule("service").defaultServiceProfile(...args); }
export function normalizeServiceProfile(...args) { return legacyBlackmarketModule("service").normalizeServiceProfile(...args); }
export function buildServiceProfileOptions(...args) { return legacyBlackmarketModule("service").buildServiceProfileOptions(...args); }
export function applyServiceCuration(...args) { return legacyBlackmarketModule("service").applyServiceCuration(...args); }
export function buildOfferCapabilityRefs(...args) { return legacyBlackmarketModule("service").buildOfferCapabilityRefs(...args); }
export function sortServiceOffers(...args) { return legacyBlackmarketModule("service").sortServiceOffers(...args); }
export function publicServiceOffer(...args) { return legacyBlackmarketModule("service").publicServiceOffer(...args); }
export function freezeOrderCapabilitySnapshot(...args) { return legacyBlackmarketModule("service").freezeOrderCapabilitySnapshot(...args); }
export function buildServiceProof(...args) { return legacyBlackmarketModule("service").buildServiceProof(...args); }
export function buildServiceSnapshot(...args) { return legacyBlackmarketModule("service").buildServiceSnapshot(...args); }
export function computeOrderFinished(...args) { return legacyBlackmarketModule("service").computeOrderFinished(...args); }
export function linkWorkshopJobToServiceOrder(...args) { return legacyBlackmarketModule("service").linkWorkshopJobToServiceOrder(...args); }
export function refreshBlackServiceOrderStates(...args) { return legacyBlackmarketModule("service").refreshBlackServiceOrderStates(...args); }
export function updateServiceProfileForPlayer(...args) { return legacyBlackmarketModule("service").updateServiceProfileForPlayer(...args); }
export function addServiceOfferForPlayer(...args) { return legacyBlackmarketModule("service").addServiceOfferForPlayer(...args); }
export function removeServiceOfferForPlayer(...args) { return legacyBlackmarketModule("service").removeServiceOfferForPlayer(...args); }
export function orderBlackServiceForPlayer(...args) { return legacyBlackmarketModule("service").orderBlackServiceForPlayer(...args); }
export function acceptBlackServiceForPlayer(...args) { return legacyBlackmarketModule("service").acceptBlackServiceForPlayer(...args); }
export function submitBlackServiceForPlayer(...args) { return legacyBlackmarketModule("service").submitBlackServiceForPlayer(...args); }
export function deliverBlackServiceForPlayer(...args) { return legacyBlackmarketModule("service").deliverBlackServiceForPlayer(...args); }
export function confirmBlackServiceForPlayer(...args) { return legacyBlackmarketModule("service").confirmBlackServiceForPlayer(...args); }
export function cancelBlackServiceForPlayer(...args) { return legacyBlackmarketModule("service").cancelBlackServiceForPlayer(...args); }
export function processExpiredBlackServiceOrders(...args) { return legacyBlackmarketModule("service").processExpiredBlackServiceOrders(...args); }
export function publicServiceOrdersForPlayer(...args) { return legacyBlackmarketModule("service").publicServiceOrdersForPlayer(...args); }
