import { openGameModal } from "../../shell/game-modal.js";
import { showToast } from "../../shell/toast-fx.js";
import { buildSaleComparison } from "./sale-comparison.js";
import { financeBatchForItem, financeBatchHtml, saleComparisonHtml } from "./finance-view.js";

export { financeReportHtml, financeBatchForItem } from "./finance-view.js";
export { buildSaleComparison } from "./sale-comparison.js";

let getState = () => null;
let boundForm = false;

export function financeSnapshot(state = getState()) {
  return state?.me?.reports?.find((report) => report.finance)?.finance || state?.me?.finance || null;
}

export function initFinanceModule(deps = {}) {
  if (typeof deps.getState === "function") getState = deps.getState;
  deps.registerAction?.("openSaleComparison", ({ payload }) => openSaleComparison(payload));
  deps.registerAction?.("openFinanceBatch", ({ payload }) => openFinanceBatch(payload));
  deps.registerAction?.("refreshSaleComparison", ({ payload, event }) => {
    event?.preventDefault?.();
    const input = globalThis.document?.querySelector("[data-finance-target]");
    if (input && !input.reportValidity()) return;
    openSaleComparison(payload, { targetPrice: input?.value, focusTarget: true });
  });
  if (!boundForm && globalThis.document?.addEventListener) {
    document.addEventListener("submit", (event) => {
      if (!event.target.matches?.("[data-finance-form]")) return;
      event.preventDefault();
      const input = event.target.querySelector("[data-finance-target]");
      if (!input?.reportValidity()) return;
      openSaleComparison(event.target.querySelector("[data-payload]")?.dataset.payload, { targetPrice: input.value, focusTarget: true });
    });
    boundForm = true;
  }
}

function findProduct(state, id) {
  const me = state?.me || {};
  return [...(me.bracelets || []), ...(state?.listings || []).filter((row) => row.ownerId === me.id).map((row) => row.item)]
    .find((item) => String(item?.id) === String(id));
}

export function openSaleComparison(id, options = {}) {
  const state = getState();
  const product = findProduct(state, id);
  if (!product) { showToast("此件已离开可比较的库存，请重新打开详情。"); return; }
  const model = buildSaleComparison(state, product, options);
  const inInventory = (state.me?.bracelets || []).some((row) => String(row.id) === String(product.id));
  openGameModal({ id: `sale-comparison:${product.id}`, title: "比较卖法", subtitle: product.name,
    size: "wide", modalClass: "finance-modal", html: saleComparisonHtml(model),
    actions: [...(inInventory ? [{ label: "返回货品详情", clientAction: "routeInventoryItem", payload: `inspect|${product.id}`, variant: "secondary" }] : []), { label: "关闭" }] });
  if (options.focusTarget) document.querySelector("[data-finance-target]")?.focus();
}

export function openFinanceBatch(id) {
  const finance = financeSnapshot();
  const batch = (finance?.batches || []).find((row) => String(row.id) === String(id));
  if (!batch) { showToast("当前没有这批料的成本明细。"); return; }
  openGameModal({ id: `finance-batch:${batch.id}`, title: "同料账本", subtitle: batch.name,
    size: "wide", modalClass: "finance-modal", html: financeBatchHtml(batch), actions: [{ label: "知道了" }] });
}
