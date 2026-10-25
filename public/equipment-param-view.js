const EQUIPMENT_PARAM_KEYS = ["quality", "risk", "speed", "perfectFloor"];

export const EQUIPMENT_PARAM_HELP = {
  quality: {
    label: "品质",
    description: "品质：本设备完成工序时记录设备品质加成，多道工序会累计进最终价值。"
  },
  risk: {
    label: "风险",
    description: "风险：高于 1 会增加碎裂概率和单次耐久损耗；低于 1 代表更稳。"
  },
  speed: {
    label: "速度",
    description: "速度：缩短这台设备完成一次加工所需时间。"
  },
  perfectFloor: {
    label: "保底",
    description: "保底：抬高本工序结算后的加工工分下限，避免成品完美度过低。"
  }
};

function htmlEscape(escapeHtml, value) {
  const text = String(value ?? "");
  if (typeof escapeHtml === "function") return escapeHtml(text);
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function compactNumber(value, fallback = 0, decimals = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(fallback);
  return number.toFixed(decimals).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

export function formatEquipmentParamValue(key, value) {
  if (key === "risk") return `×${compactNumber(value, 1, 2)}`;
  return `+${compactNumber(value, 0, 1)}%`;
}

export function equipmentParamTone(key, value) {
  const number = Number(value ?? (key === "risk" ? 1 : 0));
  if (key === "risk") return number > 1 ? "poor" : number < 1 ? "good" : "neutral";
  if (number < 0) return "poor";
  if (number <= (key === "quality" ? 0.5 : 0)) return "neutral";
  if (number >= ({ quality: 8, speed: 30, perfectFloor: 5 }[key] ?? Infinity)) return "excellent";
  return "good";
}

export function renderEquipmentParamPill(key, value, escapeHtml, options = {}) {
  const help = EQUIPMENT_PARAM_HELP[key];
  if (!help) return "";
  const interactive = options.interactive !== false;
  const tag = interactive ? "button" : "span";
  const tooltip = htmlEscape(escapeHtml, help.description);
  const label = htmlEscape(escapeHtml, help.label);
  const formattedValue = htmlEscape(escapeHtml, formatEquipmentParamValue(key, value));
  const interactiveAttrs = interactive ? ' type="button"' : "";
  return `<${tag} class="equipment-param-pill equipment-param-help is-${equipmentParamTone(key, value)}"${interactiveAttrs} aria-label="${label} ${formattedValue}。${tooltip}" data-tooltip="${tooltip}"><em>${label}</em><strong>${formattedValue}</strong></${tag}>`;
}

export function renderEquipmentParamPills(values = {}, escapeHtml, options = {}) {
  const containerTag = options.containerTag || "div";
  const className = ["equipment-param-pills", options.className].filter(Boolean).join(" ");
  const body = EQUIPMENT_PARAM_KEYS.map((key) => renderEquipmentParamPill(key, values[key], escapeHtml, options)).join("");
  return `<${containerTag} class="${className}" aria-label="设备参数说明">${body}</${containerTag}>`;
}
