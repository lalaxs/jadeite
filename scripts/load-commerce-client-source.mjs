import { readFileSync } from "node:fs";

const market = ["catalog", "state", "selectors", "item-view", "board-view", "want-view",
  "listing-view", "listing-controller", "want-controller", "bindings", "modal-controller",
  "create-market-feature", "market-module"];
const livestream = ["catalog", "state", "selectors", "chat", "stock-view", "room-view",
  "owner-view", "hall-view", "shelf-controller", "actions", "bindings", "view",
  "create-livestream-feature", "livestream-module"];
const blackmarket = ["catalog", "state", "shared", "goods-display", "item-detail-view", "previews",
  "goods", "blind-ui", "service-ui", "plaza", "actions", "create-blackmarket-feature", "index"];

export function readCommerceClientSource(feature) {
  const files = { market, livestream, blackmarket }[feature];
  const common = ["product-catalog", "product-view", "equipment-view"];
  return [...(feature === "livestream" ? [] : common.map(name => readFileSync(`public/commerce/${name}.js`, "utf8"))),
    ...files.map(name => readFileSync(`public/features/${feature}/${name}.js`, "utf8"))].join("\n");
}
