import { escapeHtml as esc, formatMoney } from "../../shell/format-utils.js";

const signed = (value) => value == null || !Number.isFinite(Number(value)) ? "待补全"
  : `${Number(value) > 0 ? "+" : Number(value) < 0 ? "−" : ""}${formatMoney(Math.abs(Number(value)))}`;
const money = (value) => value == null || !Number.isFinite(Number(value)) ? "待补全" : formatMoney(value);
const tone = (value) => value == null ? "" : Number(value) < 0 ? "is-loss" : Number(value) > 0 ? "is-profit" : "";
const STATUS = { inventory: "在库", processing: "加工中", delivery: "待领取", listed: "交易行在售", blackmarket: "黑市在售", want: "求购应征中", livestream: "直播在售", collection: "已收藏", sold: "已售", lost: "损失" };

function accountingPeriod(startedAt) {
  const timestamp = Number(startedAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "启用后开始记录";
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "启用后开始记录";
  return `开始记录：${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date)}（北京时间）`;
}

export function financeBatchForItem(finance, item) {
  return (finance?.batches || []).find((batch) => String(batch.id) === String(item?.financeBatchId || "")
    || (batch.items || []).some((row) => String(row.id) === String(item?.id || ""))) || null;
}

export function financeReportHtml(finance) {
  if (!finance?.summary) return `<section class="panel finance-panel"><div class="panel-head"><h3>经营收益</h3><span>启用后开始记录</span></div><p class="finance-note">成本账本尚未建立，不追溯全部历史。旧库存缺失的采购成本会保留为未知，不按零成本计算利润。</p></section>`;
  const summary = finance.summary;
  const batches = finance.batches || [];
  return `<section class="panel finance-panel" aria-label="经营收益与设备资金">
    <div class="panel-head"><h3>经营收益</h3><span>账本累计</span></div>
    <p class="finance-note finance-period">${esc(accountingPeriod(finance.startedAt))}；不代表全部历史记录。</p>
    <p class="finance-note">销售毛利按已售货品成本核算；进料尚未出售的部分仍在库存。自动还款影响现金，不重复扣作销售成本。经营收益未计设备折旧。</p>
    <div class="finance-metrics">
      <div><span>已售货款</span><strong>${money(summary.salesRevenue)}</strong></div>
      <div><span>已售货品成本</span><strong>${money(summary.soldCost)}</strong><small>${Number(summary.unknownCostSales || 0) ? `${Number(summary.unknownCostSales)} 笔成本记录不全；此数为已记部分` : "按交付货品归集"}</small></div>
      <div class="${tone(summary.grossProfit)}"><span>销售毛利</span><strong>${signed(summary.grossProfit)}</strong>${summary.grossProfit == null ? `<small>按已记录成本计算 ${signed(summary.grossProfitKnown)}，非完整利润</small>` : `<small>已扣销售费用 ${money(summary.salesFees)}</small>`}</div>
      <div class="${tone(summary.operatingNet)}"><span>已记经营收益</span><strong>${signed(summary.operatingNet)}</strong>${summary.operatingNet == null ? `<small>成本不完整，暂不判定盈亏</small>` : `<small>含加工与服务收益、已记经营费用${Number(summary.currentPayrollEstimate || 0) > 0 ? `；未结工资预估 ${money(summary.currentPayrollEstimate)}` : ""}</small>`}</div>
    </div>
    <details class="finance-breakdown"><summary>查看收益构成</summary><dl class="finance-rows">
      <div><dt>来料加工净报酬</dt><dd>${signed(summary.commissionNet)}</dd></div>
      <div><dt>技术服务收入</dt><dd>${signed(summary.serviceNet)}</dd></div>
      <div><dt>其他经营收入</dt><dd>${signed(summary.otherOperatingIncome ?? 0)}</dd></div>
      <div><dt>经营费用</dt><dd>${money(summary.operatingExpenses)}</dd></div>
      <div><dt>已记材料损失</dt><dd>${money(summary.materialLoss)}</dd></div>
      <div><dt>融资成本</dt><dd>${money(summary.financeCosts)}</dd></div>
      <div><dt>本营业日未结工资（预估）</dt><dd>${money(summary.currentPayrollEstimate ?? 0)}</dd></div>
      ${Number(summary.currentPayrollEstimate || 0) > 0 ? `<div><dt>扣除未结工资预估后</dt><dd>${signed(summary.operatingNetAfterPayrollEstimate)}</dd></div>` : ""}
    </dl><p class="finance-note">未知历史成本不补记为零；购机、售机、借款和本金还款单独影响资金，不等同当期经营盈亏。</p></details>
    <div class="finance-equipment"><h4>设备与许可资金</h4><dl class="finance-rows"><div><dt>购机与许可投入</dt><dd>${money(summary.equipmentOutflow)}</dd></div><div><dt>售机回款</dt><dd>${money(summary.equipmentInflow)}</dd></div></dl><p class="finance-note">设备与许可采购计入现金支出；此处不把整项采购直接记作销售亏损。</p></div>
    <div class="finance-equipment finance-funds"><h4>资金往来</h4><dl class="finance-rows">
      <div><dt>借款到账</dt><dd>${money(summary.financingInflow)}</dd></div>
      <div><dt>累计借款还款</dt><dd>${money(summary.debtRepayment)}</dd></div>
      <div><dt>累计冻结资金</dt><dd>${money(summary.depositsHeld)}</dd></div>
      <div><dt>累计返还冻结资金</dt><dd>${money(summary.depositsReleased)}</dd></div>
      <div><dt>奖励等非经营收入</dt><dd>${money(summary.nonOperatingIncome)}</dd></div>
    </dl><p class="finance-note">累计借款还款可能含周转费用。上述往来不作为销售利润；本金和冻结资金变化不等同经营盈亏。</p></div>
  </section>
  <section class="panel finance-panel" aria-label="同料批次账本"><div class="panel-head"><h3>同料批次</h3><span>${batches.length} 批</span></div>
    <p class="finance-note">把同一来源的取件、余料和成品放在一起看。尚有在库、在制或待领取货品时，不下最终盈亏结论。</p>
    <div class="finance-batch-list">${batches.length ? batches.map((batch) => `<button class="finance-batch-row secondary" type="button" data-action="openFinanceBatch" data-payload="${esc(batch.id)}"><span><strong>${esc(batch.name || "玉料批次")}</strong><small>${batch.status === "closed" ? "已清批" : "未清批"}${batch.legacy ? " · 历史成本待核" : ""} · 持有 ${Math.max(0, Number(batch.heldCount) || 0)} 件</small></span><span>已成交 ${money(batch.revenue)}<small>${batch.costComplete ? `直接成本 ${money(batch.directCost)}` : "成本记录不全"}</small></span><span aria-hidden="true">›</span></button>`).join("") : '<p class="finance-note">新采购或加工后，这里会显示批次记录。</p>'}</div>
    ${Number(finance.archivedBatchCount || 0) > 0 ? `<p class="finance-note">另有 ${Math.max(0, Math.floor(Number(finance.archivedBatchCount)))} 个历史已结清批次，累计汇总仍保留。</p>` : ""}
  </section>`;
}

export function financeBatchHtml(batch) {
  const complete = batch.costComplete === true;
  const closed = batch.status === "closed";
  const finalProfit = closed && complete && batch.finalProfit != null && Number.isFinite(Number(batch.finalProfit)) ? Number(batch.finalProfit) : null;
  const costLabel = complete ? "" : "（已记录部分）";
  return `<div class="finance-batch-detail">
    <p class="finance-state ${closed ? "" : "is-open"}">${closed ? "本批已清" : "本批尚未清完"} · ${!closed ? "剩余货品或待领货款仍在本批，暂不判定最终盈亏。" : finalProfit != null ? `本批直接收益 ${signed(finalProfit)}，未分摊店铺公共费用。` : "历史成本记录不完整，最终盈亏待补全。"}</p>
    <dl class="finance-rows">
      <div><dt>本批直接成本${costLabel}</dt><dd>${money(batch.directCost)}</dd></div>
      <div><dt>已成交货款</dt><dd>${money(batch.revenue)}</dd></div>
      <div><dt>其中待领取货款</dt><dd>${money(batch.pendingRevenue)}</dd></div>
      <div><dt>已售成本${costLabel}</dt><dd>${money(batch.soldCost)}</dd></div>
      <div><dt>销售费用</dt><dd>${money(batch.salesFees)}</dd></div>
      <div><dt>剩余货品成本${costLabel}</dt><dd>${money(batch.heldCost)}</dd></div>
      <div><dt>已记损失成本${costLabel}</dt><dd>${money(batch.lossCost)}</dd></div>
    </dl>
    <h4>取件、余料与成品</h4><div class="finance-batch-items" role="list">${(batch.items || []).map((item) => `<article class="finance-batch-item" role="listitem"><div><strong>${esc(item.name || "货品")}</strong><span>${esc(STATUS[item.status] || "待核实")}</span></div><p>已记成本 ${item.costComplete === false || item.cost == null ? "待补全" : money(item.cost)} · 参考估值 ${money(item.value)}</p>${item.status === "listed" ? `<button type="button" class="secondary small" data-action="openSaleComparison" data-payload="${esc(item.id)}">查看在售报价</button>` : ""}</article>`).join("") || '<p class="finance-note">暂无可展示的货品明细。</p>'}</div>
    <p class="finance-note">参考估值不是已实现收入。待领取货款已包含在已成交货款内；同料多件共享原料成本，不能把每件都按整块原石进价重复计成本。</p>
  </div>`;
}

export function saleComparisonHtml(model) {
  return `<section class="finance-compare" aria-label="销售渠道比较">
    <p class="finance-note">已记货品成本 ${model.cost.complete ? money(model.cost.amount) : "待补全"} · 参考估值 ${money(model.value)}。销售毛利不含店铺公共费用；现金增加已另计本笔自动还款。</p>
    <form class="finance-target" data-finance-form><label for="financeTargetPrice">直播／挂牌目标售价</label><div><input id="financeTargetPrice" data-finance-target inputmode="numeric" type="number" min="1" step="1" value="${model.targetValid ? model.target : ""}" aria-describedby="financeTargetHint"><button type="submit" class="secondary" data-action="refreshSaleComparison" data-payload="${esc(model.productId)}">重新比较</button></div><small id="financeTargetHint">仅用于预估，不会替你定价、上架或成交。</small></form>
    <div class="finance-compare-list">${model.rows.map((row) => {
      const action = row.listingId ? "openMarketOffer" : row.action || (row.destination ? "routeInventoryItem" : "");
      const payload = row.listingId || (row.action ? model.productId : `${row.destination}|${model.productId}`);
      const cash = row.cash;
      return `<article class="finance-channel${row.available ? "" : " is-unavailable"}"><header><h4>${esc(row.channel)}</h4><span>${esc(row.label || "暂无报价")}</span></header>
        ${row.kind === "bundle" ? `<p class="finance-bundle">${money(row.bundlePay)} / ${row.quantity} 件整单</p>` : row.revenue != null ? `<dl class="finance-channel-stats"><div><dt>${row.kind === "target" ? "若成交回款" : "预计回款"}</dt><dd>${money(row.revenue)}</dd></div><div class="${tone(row.grossProfit)}"><dt>销售毛利</dt><dd>${signed(row.grossProfit)}</dd></div><div><dt>自动还款后现金增加</dt><dd>${cash ? money(cash.cashIncrease) : "待核实"}</dd></div></dl>${cash ? `<p class="finance-cash-detail">补薪 ${money(cash.payrollRepayment)} · 纾困还款 ${money(cash.recoveryRepayment)} · 入账后现金 ${money(cash.cashAfter)}</p>` : ""}` : ""}
        <p class="finance-channel-note">${esc(row.note || "")}</p>
        ${action && row.available ? `<button type="button" class="${row.id === "recycle" ? "secondary" : ""}" data-action="${esc(action)}" data-payload="${esc(payload)}">${row.id === "recycle" ? "去回收确认" : row.listingId ? "查看报价并确认" : "去原渠道选择并确认"}</button>` : ""}
      </article>`;
    }).join("")}</div>
    <p class="finance-note">此处不扣货、不成交。报价、库存、客户额度与欠款可能变化，以原渠道最终确认为准。</p>
  </section>`;
}
