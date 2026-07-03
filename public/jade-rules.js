const KIND_LABELS = {
  bracelet: "手镯",
  cabochon: "蛋面",
  peacePendant: "平安扣",
  ruyiPendant: "如意",
  leafPendant: "叶子"
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function money(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function placementRadius(placement = {}) {
  if (placement.layout === "bracelet" || placement.kind === "bracelet") {
    const ringSize = Number(placement.ringSize) || 56;
    return clamp(12 + (ringSize - 52) * 0.55, 12, 18);
  }
  if (placement.layout === "cabochon" || placement.kind === "cabochon") return 7;
  if (placement.layout === "peacePendant" || placement.kind === "peacePendant") return 12;
  if (placement.layout === "ruyiPendant" || placement.kind === "ruyiPendant") return 11;
  if (placement.layout === "leafPendant" || placement.kind === "leafPendant") return 10;
  return 14;
}

function isNearWindow(rough = {}, placement = {}, radius) {
  return (rough.windows || rough.visual?.windows || []).some((win) => (
    Math.hypot(Number(placement.x || 50) - Number(win.x || 50), Number(placement.y || 50) - Number(win.y || 50)) < radius + Number(win.r || 10)
  ));
}

function colorLineHit(rough = {}, placement = {}) {
  const visual = rough.visual || {};
  if (!visual.belt) return false;
  const angle = Number(visual.beltAngle || 18) * Math.PI / 180;
  const dx = (Number(placement.x || 50) - 50) / 50;
  const dy = (Number(placement.y || 50) - 50) / 50;
  const cross = Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle));
  return cross < 0.24 || isNearWindow(rough, placement, placementRadius(placement));
}

function crackHit(rough = {}, placement = {}) {
  const visual = rough.visual || {};
  if (!visual.crack) return false;
  const x = Number(placement.x || 50);
  const y = Number(placement.y || 50);
  return Math.abs(x - 50) < 9 && Math.abs(y - 50) < 20;
}

export function analyzeRoughPlacement(rough = {}, placement = {}) {
  const radius = placementRadius(placement);
  const x = Number(placement.x || 50);
  const y = Number(placement.y || 50);
  const reasons = [];
  let score = 82;

  if (x - radius < 7 || x + radius > 93 || y - radius < 7 || y + radius > 93) {
    score -= 22;
    reasons.push("靠边取件，损耗偏高");
  }

  if (colorLineHit(rough, placement)) {
    score += 18;
    reasons.push("吃色位，成品颜色更容易出彩");
  }

  if (isNearWindow(rough, placement, radius)) {
    score += 8;
    reasons.push("靠近开窗，判断可信度更高");
  }

  if ((placement.layout || placement.kind) === "bracelet" && Number(placement.ringSize || 56) >= 58) {
    score += 5;
    reasons.push("大圈口，销售溢价更好");
  }

  if (["cabochon", "peacePendant", "ruyiPendant", "leafPendant"].includes(placement.layout || placement.kind)) {
    score += 5;
    reasons.push("小件路线，适合避裂保料");
  }

  if (crackHit(rough, placement)) {
    score -= 30;
    reasons.push("压裂风险，可能拉低净度");
  }

  const normalized = clamp(Math.round(score), 45, 122);
  const tone = normalized >= 100 ? "profit" : normalized < 78 || reasons.some((reason) => reason.includes("压裂")) ? "danger" : "info";
  return {
    score: normalized,
    tone,
    reasons: reasons.length ? reasons : ["常规位置，收益主要看料性"]
  };
}

export function productMatchesOrder(product = {}, order = {}) {
  const kind = product.kind || "bracelet";
  const acceptedKinds = Array.isArray(order.acceptedKinds) && order.acceptedKinds.length ? order.acceptedKinds : ["bracelet"];
  return Number(product.score || 0) >= Number(order.minScore || 1) && acceptedKinds.includes(kind);
}

export function productOrderFitReasons(product = {}, order = {}) {
  const reasons = [];
  const kind = product.kind || "bracelet";
  const acceptedKinds = Array.isArray(order.acceptedKinds) && order.acceptedKinds.length ? order.acceptedKinds : ["bracelet"];
  const preferredKinds = Array.isArray(order.preferredKinds) ? order.preferredKinds : [];
  const tasteTags = Array.isArray(order.tasteTags) ? order.tasteTags : [];

  if (Number(product.score || 0) >= Number(order.minScore || 1)) reasons.push("种水达标");
  else reasons.push("种水不足");

  if (acceptedKinds.includes(kind)) reasons.push(`题材匹配：${KIND_LABELS[kind] || "成品"}`);
  else reasons.push(`题材不符：客户不收${KIND_LABELS[kind] || "这类货"}`);

  if (preferredKinds.includes(kind)) reasons.push("偏好加成");
  if (tasteTags.includes("highGrade") && Number(product.score || 0) >= 4) reasons.push("高货偏好命中");
  if (tasteTags.includes("batch") && Number(product.score || 0) >= 2) reasons.push("适合稳定供货");
  if (tasteTags.includes("budget") && Number(product.value || 0) <= Number(order.pay || Infinity) * 1.35) reasons.push("预算友好");

  return reasons;
}

export function liveSaleRange(product = {}, rep = 0) {
  const value = Number(product.value || product.price || 0);
  const heat = clamp(Number(rep || 0) / 900, 0, 0.34);
  return {
    low: money(value * (0.78 + heat * 0.5)),
    high: money(value * (1.18 + heat))
  };
}

export function routeRecommendation(product = {}, orders = [], rep = 0) {
  const matchingOrders = orders.filter((order) => productMatchesOrder(product, order));
  if (matchingOrders.length) {
    const best = matchingOrders.slice().sort((a, b) => Number(b.pay || 0) - Number(a.pay || 0))[0];
    return {
      route: "order",
      label: "优先接单",
      detail: `${best.client || "客户"} 可消化，报价 ${money(best.pay)}`
    };
  }

  if (Number(product.score || 0) >= 4 && Number(product.rep || 0) >= 28) {
    return {
      route: "collection",
      label: "适合收藏",
      detail: `门面声望 +${Math.round(Number(product.rep || 0))}`
    };
  }

  const range = liveSaleRange(product, rep);
  return {
    route: "livestream",
    label: "直播回款",
    detail: `预估 ${money(range.low)}-${money(range.high)}`
  };
}
