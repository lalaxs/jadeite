// Directional boundary between the plaza coordinator and feature panels.
// Panels depend on this small contract instead of importing plaza.js back,
// which keeps the black-market module graph acyclic.
const handlers = Object.create(null);

export function bindBlackmarketController(nextHandlers = {}) {
  Object.assign(handlers, nextHandlers);
}

export function renderBlackmarket(...args) {
  return handlers.renderBlackmarket?.(...args);
}

export function openBmSetupModal(...args) {
  return handlers.openBmSetupModal?.(...args);
}

export function closeBmModals(...args) {
  return handlers.closeBmModals?.(...args);
}

export function serviceProfileHtml(...args) {
  return handlers.serviceProfileHtml?.(...args) || "";
}

export function serviceOfferCapabilityHtml(...args) {
  return handlers.serviceOfferCapabilityHtml?.(...args) || "";
}

export function serviceOfferBasisHtml(...args) {
  return handlers.serviceOfferBasisHtml?.(...args) || "";
}
