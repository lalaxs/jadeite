export function inlaySummary(product) {
  const inlay = product?.inlay;
  if (!inlay) return "";
  const gem = Number(inlay.gemCount) > 0
    ? `${inlay.gemName}×${inlay.gemCount}`
    : "无配石";
  return [
    inlay.productTypeName,
    inlay.settingName,
    inlay.metalName || "无金属",
    gem,
    inlay.polishName,
    inlay.backingName
  ].filter(Boolean).join(" · ");
}
