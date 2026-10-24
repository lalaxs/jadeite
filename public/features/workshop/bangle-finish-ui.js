import { BANGLE_REFINEMENTS, BANGLE_POLISHES, bangleRingSize, previewBangleFinish } from "../../../shared/domain/workshop/bangle-finish.js";
import { workshopShatterChance } from "../../workshop-craft-scoring.js";

export function bangleFinishControls(escapeHtml) {
  return `<div class="bangle-finish-identity"><strong>翡翠手镯</strong><span>修形 → 细磨 → 抛光 → 验收</span></div>
    <label class="finish-plan-field"><span>精修档次</span><select data-finish-field="refinementId">${Object.entries(BANGLE_REFINEMENTS).map(([id, v]) => `<option value="${id}">${escapeHtml(v.name)}${id === "standard" ? "（推荐）" : ""}</option>`).join("")}</select></label>
    <label class="finish-plan-field"><span>抛光效果</span><select data-finish-field="polishId">${Object.entries(BANGLE_POLISHES).map(([id, name]) => `<option value="${id}">${name}</option>`).join("")}</select></label>`;
}

export function patchBangleFinishUi(root, { item, draft, worker, device, durationMs, formatMoney, formatDuration, escapeHtml, error, canStart, submitting, stationFee = 0, upkeep = 0 }) {
  root.querySelector("h3").textContent = "制定手镯精修方案";
  const ring = bangleRingSize(item);
  root.querySelector("[data-finish-item-title]").textContent = `${item.name} · ${ring ? `${ring}圈口 · ` : ""}${worker?.name || "师傅"}`;
  root.querySelector('[data-finish-field="refinementId"]').value = draft.refinementId;
  root.querySelector('[data-finish-field="polishId"]').value = draft.polishId;
  const estimate = previewBangleFinish(item, draft, worker, device?.attrs);
  const risk = workshopShatterChance(device?.attrs, worker, "finishing");
  const time = Math.max(1, Math.round(durationMs * BANGLE_REFINEMENTS[draft.refinementId].timeMultiplier));
  root.querySelector(".finish-plan-summary").innerHTML = `
    <div><span>预计用时</span><strong>${escapeHtml(formatDuration(time))}</strong></div>
    <div><span>预计工艺</span><strong>${estimate.craftGrade}级 · ${estimate.craftScore}分</strong></div>
    <div><span>预计成品估值</span><strong>${escapeHtml(formatMoney(estimate.value))}</strong></div>
    <div><span>预计估值变化</span><strong>${escapeHtml(formatMoney(estimate.value - Number(item.value || item.price || 0)))}</strong></div>
    <div><span>工位与维护</span><strong>${escapeHtml(formatMoney(stationFee + upkeep))}</strong></div>
    <div><span>加工风险</span><strong>${(risk * 100).toFixed(1)}%</strong></div>
    <p class="bangle-finish-estimate-note">评分：打磨60%＋修形40%。失败退回原坯，结算设备损耗与员工经验。</p>`;
  root.querySelector("[data-finish-warning-wrap]").hidden = !error;
  root.querySelector("[data-finish-warning]").textContent = error || "";
  const confirm = root.querySelector('[data-finish-action="confirm"]');
  confirm.disabled = !canStart || submitting;
  confirm.textContent = submitting ? "正在提交…" : "开始精修";
}
