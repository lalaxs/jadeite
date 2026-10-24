/**
 * Black market — one stall per player, exclusive type:
 * goods | blindbox | service. Optional anonymity at open time.
 * Post-trade mutual ratings adjust player.satisfaction (客户评级).
 *
 * Implementation lives in ./blackmarket/ (stage D split). This file is a thin facade.
 */
export * from "./blackmarket/index.js";
