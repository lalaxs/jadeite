import { STARTUP_OPTIONS, businessAccess } from "../../../shared/domain/progression/business-growth.js";

let deps;
const money = value => `¥${Math.round(Number(value) || 0).toLocaleString("zh-CN")}`;
const signatures = new WeakMap();
const escape = value => deps.escapeHtml(String(value ?? ""));
const button = (label, action, payload = "", secondary = false, disabled = false) => `<button type="button" class="${secondary ? "secondary" : ""}" data-action="${action}" data-payload="${escape(payload)}"${disabled ? " disabled" : ""}>${escape(label)}</button>`;
function clock(at) { return new Date(at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }); }
function send(event, payload = {}) {
  deps.socket.emit(event, payload, result => {
    if (result?.ok) deps.closeGameModal();
  });
}
function startupHtml() {
  return `<div class="business-title"><div><p class="eyebrow">初入翡翠街</p><h3>选择你的经营方式</h3></div></div>
    <p>从黑市起步，赚到第一笔利润，再建设自己的工坊。</p><div class="business-start-options">${STARTUP_OPTIONS.map(option => {
      const debt = option.cash + option.target * .5 + Math.ceil(option.cash * .01);
      return `<article class="business-start-option"><h4>${escape(option.name)}</h4><strong class="business-start-cash">${money(option.cash)}</strong>
        ${option.target ? `<p>现实24小时内净赚 <b>${money(option.target)}</b></p><p>成功额外奖励 <b>${money(option.reward)}</b></p><p class="business-risk">失败初始应还 ${money(debt)}<br>含本金、目标50%违约金和首期利息</p>` : `<p>自由安排经营节奏</p><p>无需签约，没有开局限时负担</p>`}
        ${button(option.target ? "查看并签约" : "领取500元开始", "businessChoose", option.id)}
      </article>`;
    }).join("")}</div><p class="business-note">合约离线也计时。启动金、奖励和贷款不算经营利润；每个角色选择一次。</p>`;
}
function contractHtml(b) {
  const c = b.contract;
  if (!c) return "";
  const label = { active: "履约中", succeeded: "已达标", failed: "已到期" }[c.status];
  return `<section class="business-contract" data-contract-status="${c.status}"><div class="business-title"><h4>${escape(c.name)} · ${label}</h4>
    ${c.status === "active" ? `<span data-business-clock="${c.endsAt}"></span>` : `<span>${c.status === "succeeded" ? `奖励 ${money(c.reward)}` : `结算应付 ${money(c.initialDebt)}`}</span>`}</div>
    <progress max="${c.target}" value="${Math.max(0, Math.min(c.target, c.progress))}" aria-label="合约利润进度"></progress>
    <p>已赚 ${money(c.progress)} / ${money(c.target)}${c.status === "active" ? ` · 截止 ${clock(c.endsAt)}（北京时间）` : ""}</p>
    ${c.status === "active" ? `<small>达标奖励 ${money(c.reward)}；失败应付 ${money(c.cash + c.target*.5 + Math.ceil(c.cash*.01))}，先保留周转金再偿付。</small>` : c.status === "failed" ? `<small>已偿付 ${money(c.paidAtSettlement)}；未还部分在账房查看。</small>` : ""}</section>`;
}
function buildingsHtml(b) {
  return `<details class="business-roadmap"><summary>查看产业成长路线</summary><div>${b.buildings.map(row => `<div class="business-roadmap-row"><span>${escape(row.name)}${row.built ? " · 已营业" : ""}</span><span>利润 ${money(row.target)} · ${row.built ? "已建成" : `建设 ${money(row.totalPrice)}`}</span></div>`).join("")}</div></details>`;
}
function homeHtml(me) {
  const b = me.business;
  const next = b.next;
  const used = b.loans.filter(row => row.source === "working").reduce((sum, row) => sum + row.principal, 0);
  const available = Math.max(0, b.creditLimit - used);
  const canBorrow = b.trades > 0 || Number(me.stats?.bmDeals) > 0;
  const progress = next ? Math.max(0, Math.min(next.target, b.profit)) : 1;
  return `<div class="business-title"><h3>${b.built.includes("store") ? `${escape(me.name)} · 翡翠名店` : b.built.includes("workshop") ? "我的工坊与生意" : "我的生意"}</h3><span>${b.built.includes("legendary") ? "传奇掌柜" : escape(STARTUP_OPTIONS.find(row => row.id === b.choice)?.name || "既有经营")}</span></div>
    <div class="business-money"><div><span>累计经营净利润</span><strong class="${b.profit < 0 ? "business-loss" : ""}">${money(b.profit)}</strong></div><div><span>可用现金</span><strong>${money(me.cash)}</strong></div><div><span>周转参考额</span><strong>${money(me.operatingReserve)}</strong></div><div><span>未还债务</span><strong>${money(b.debt)}</strong></div></div>
    ${contractHtml(b)}
    ${next ? `<section class="business-next"><div class="business-title"><h4>${escape(next.name)}</h4><span>${next.ok ? "资格已达成" : `还差利润 ${money(Math.max(0,next.target-b.profit))}`}</span></div>
      <progress max="${next.target || 1}" value="${progress}" aria-label="产业成长进度"></progress><p>${escape(next.reward)}</p>
      <p>许可 ${money(next.permit)}＋建设 ${money(next.construction)}${next.equipment ? `＋入门机 ${money(next.equipment)}` : ""}＝${money(next.totalPrice)}</p>
      ${next.ok ? button(me.cash >= next.totalPrice ? "建设并开业" : "查看建设费用", "businessBuild", next.id) : `<small>${escape(next.message)}</small>`}
      ${button("去黑市经营", "openLocation", "blackmarket", true)}</section>` : `<p>已取得传奇经营资格，可继续经营高档原石、精品与自己的藏品。</p>`}
    ${buildingsHtml(b)}
    ${b.built.includes("workshop") ? `<section class="business-consignment"><div><h4>街坊开料委托</h4><p>客户供料，亲自开料并交还明料，加工报酬200元。</p></div>${b.openingCommission ? `${button("继续开料", "businessStartOpening", "", true)}${button("交还客户明料", "businessClaimOpening")}` : button("接单并开工", "businessStartOpening")}</section>` : ""}
    <details class="business-treasury"><summary>经营账房 · 贷款与还款</summary><p>周转授信 ${money(b.creditLimit)}，可新增借款 ${money(available)}。每24小时按未还本金计息1%，最低一期，7天到期。</p>
      ${!canBorrow ? "<p>完成首笔交易后可申请周转贷款。</p>" : ""}
      <div class="business-actions">${button("申请贷款", "businessBorrow", "", false, available < 100 || b.overdue || !canBorrow)}${button("主动还款", "businessRepay", "", true, b.debt <= 0 || me.cash <= 0)}</div>
      ${b.overdue ? `<p class="business-risk">存在逾期债务，结清前暂停新增放款，经营继续。</p>` : ""}
      <div>${b.loans.filter(row => row.principal + row.interest + row.penalty > 0).map(row => `<div class="business-debt-row"><b>${row.source === "contract" ? "合约债务" : "周转贷款"}</b><span>本金 ${money(row.principal)} · 违约金 ${money(row.penalty)} · 利息 ${money(row.interest)}</span><small>到期 ${clock(row.dueAt)} · 下次计息 ${clock(row.nextInterestAt)}</small></div>`).join("") || "<p>当前没有未还贷款。</p>"}</div>
    </details>${b.signatureWork ? `<p>代表作：${escape(b.signatureWork.name)}</p>` : ""}
    ${b.regularCustomer ? `<p>常客：${escape(b.regularCustomer.name)} · 已完成 ${b.regularCustomer.completed}/3 次委托 ${button("查看客户订单", "openLocation", "orders", true)}</p>` : ""}`;
}
function neighborhoodHtml(me) {
  const b = me.business;
  const goods = [...(me.rough || []), ...(me.materials || []), ...(me.slices || []), ...(me.bracelets || [])].filter(item => !item.escrowOrderId && !item.customerCommissionId);
  return `<div class="business-title"><h3>街坊供货与收购</h3><span>明确报价 · 成交看盈亏</span></div>
    <div class="business-offers">${(b.supply || []).map(row => `<article class="business-offer"><h4>${escape(row.item.name)}</h4><p>${escape(row.customer)}收购 ${money(row.buyerPay)}</p><p>进价 ${money(row.price)} · 交易利润 <b>＋${money(row.buyerPay-row.price)}</b></p>${button("买入并保留收购价", "businessBuy", row.id, false, me.cash < row.price)}</article>`).join("")}</div>
    <details class="business-sell"${goods.some(item => item.neighborhoodBuyer) ? " open" : ""}><summary>交付库存与加工产物（${goods.length}）</summary>${goods.slice(0,40).map(item => {
      const own = item.materialStage === "opened" || item.materialStage === "carved" || item.craftedByPlayerId === me.id;
      const pay = item.neighborhoodBuyer?.pay || Math.round(Number(item.value || item.price) * (own ? 1.05 : .98));
      const cost = item.costBasis;
      return `<div class="business-sell-row"><div><b>${escape(item.name)}</b><small>收购 ${money(pay)} · ${cost?.complete ? `成本 ${money(cost.amount)} · 交易${pay >= cost.amount ? "赚" : "亏"} ${money(Math.abs(pay-cost.amount))}` : "历史成本未知"}</small></div>${button("交付收款", "businessSell", item.id)}</div>`;
    }).join("") || "<p>先买一件合用的小货，再交付给街坊。</p>"}</details>
    <div class="business-consignment"><div><h4>街坊寄售</h4><p>无需垫资，2分钟服务收入20元。</p></div>${b.consignment ? `<span data-business-clock="${b.consignment.readyAt}"></span>${button("交付寄售", "businessClaimConsignment")}` : button("接一笔寄售", "businessStartConsignment", "", true)}</div>`;
}
export function initBusinessFeature(options) {
  deps = options;
  const on = options.registerAction;
  on("businessChoose", ({ payload }) => {
    const option = STARTUP_OPTIONS.find(row => row.id === payload);
    if (!option) return;
    if (!option.target) return send("chooseBusinessStart", { optionId: payload });
    options.openGameModal({ title: `签订${option.name}`, tone: "expense", confirmation: true, closeOnBackdrop: false,
      body: [`启动资金 ${money(option.cash)}；现实24小时内净赚 ${money(option.target)}。`, `达标保留启动金，额外奖励 ${money(option.reward)}。`,
        `失败应付本金 ${money(option.cash)}＋违约金 ${money(option.target*.5)}＋首期利息 ${money(Math.ceil(option.cash*.01))}。`, "离线继续计时；到期先保留周转金，再以现金偿付。未还本金每24小时计息1%。"],
      actions: [{ label: "返回", variant: "secondary" }, { label: "签约并领取资金", clientAction: "businessConfirmStart", payload }] });
  });
  on("businessConfirmStart", ({ payload }) => send("chooseBusinessStart", { optionId: payload }));
  on("businessBuild", ({ payload }) => {
    const me = options.getState()?.me;
    const row = me?.business?.buildings.find(item => item.id === payload);
    if (!row) return;
    options.openGameModal({ title: `建设${row.name}`, tone: "expense", confirmation: true, closeOnBackdrop: false,
      body: [`许可 ${money(row.permit)}，建设 ${money(row.construction)}${row.equipment ? `，入门设备 ${money(row.equipment)}` : ""}。`,
        `本次合计 ${money(row.totalPrice)}，付款后余额 ${money(me.cash-row.totalPrice)}；周转参考额 ${money(me.operatingReserve)}。`, row.reward],
      actions: [{ label: "返回", variant: "secondary" }, ...(row.equipment ? [{ label: `仅建车间 ${money(row.price)}`, variant: "secondary", clientAction: "businessConfirmBuildOnly", payload }] : []), { label: "建设并开业", clientAction: "businessConfirmBuild", payload }] });
  });
  on("businessConfirmBuild", ({ payload }) => send("buildBusiness", { buildingId: payload }));
  on("businessConfirmBuildOnly", ({ payload }) => send("buildBusiness", { buildingId: payload, buyEquipment: false }));
  on("businessBorrow", () => {
    const b = options.getState()?.me?.business;
    const used = b.loans.filter(row => row.source === "working").reduce((sum,row)=>sum+row.principal,0);
    const available = b.creditLimit-used;
    options.openGameModal({ title: "申请周转贷款", tone: "expense", confirmation: true, closeOnBackdrop: false,
      body: [`可新增本金 ${money(available)}。首期利息为本金1%，每24小时一期，7天到期。`, "借款不增加经营利润；自动还款保留周转金。"],
      html: `<label class="business-amount">借款金额<input id="businessLoanAmount" type="number" min="100" max="${available}" step="100" value="${Math.min(500, Math.floor(available/100)*100)}" inputmode="numeric"></label>`,
      actions: [{ label: "返回", variant: "secondary" }, { label: "借款", clientAction: "businessConfirmBorrow" }] });
  });
  on("businessConfirmBorrow", () => send("borrowBusinessLoan", { amount: Number(document.getElementById("businessLoanAmount")?.value) }));
  on("businessRepay", () => {
    const me = options.getState()?.me;
    options.openGameModal({ title: "主动还款", tone: "expense", confirmation: true, closeOnBackdrop: false,
      body: [`总债务 ${money(me.business.debt)}，可用现金 ${money(me.cash)}。依次偿还利息、违约金与本金。`],
      html: `<label class="business-amount">还款金额<input id="businessRepayAmount" type="number" min="1" max="${Math.min(me.cash,me.business.debt)}" value="${Math.min(me.cash,me.business.debt)}" inputmode="numeric"></label>`,
      actions: [{ label: "返回", variant: "secondary" }, { label: "还款", clientAction: "businessConfirmRepay" }] });
  });
  on("businessConfirmRepay", () => send("repayBusinessLoan", { amount: Number(document.getElementById("businessRepayAmount")?.value) }));
  on("businessBuy", ({ payload }) => send("buyNeighborhoodItem", { offerId: payload }));
  on("businessSell", ({ payload }) => send("sellNeighborhoodItem", { itemId: payload }));
  on("businessStartConsignment", () => send("startConsignment"));
  on("businessClaimConsignment", () => send("claimConsignment"));
  on("businessStartOpening", () => send("startOpeningCommission"));
  on("businessClaimOpening", () => send("claimOpeningCommission"));
}
export function renderBusinessView(view, root, state) {
  const me = state?.me;
  if (!deps || !root || !me?.business) return;
  const pending = !me.business.choice;
  const chosenNow = !pending && root.classList.contains("business-pending");
  root.classList.toggle("business-pending", pending);
  root.classList.add("business-enabled");
  let panel = root.querySelector(":scope > .business-panel");
  if (!pending && !["overview", "blackmarket"].includes(view)) { panel?.remove(); return; }
  if (!panel) { panel = document.createElement("section"); panel.className = "panel business-panel"; root.prepend(panel); }
  const signature = JSON.stringify([view,pending,me.business,me.cash,me.operatingReserve,view === "blackmarket" ? [me.rough,me.materials,me.slices,me.bracelets] : null]);
  if (signatures.get(panel) !== signature) {
    const active = panel.contains(document.activeElement) ? document.activeElement?.dataset?.action : "";
    panel.innerHTML = pending ? startupHtml() : view === "blackmarket" ? neighborhoodHtml(me) : homeHtml(me);
    signatures.set(panel, signature);
    if (active) panel.querySelector(`[data-action="${active}"]`)?.focus({ preventScroll: true });
  }
  tickBusinessClocks();
  if (chosenNow) panel.scrollIntoView({ block: "start", behavior: "auto" });
}
export function tickBusinessClocks() {
  if (!deps) return;
  const now = deps.nowMs();
  document.querySelectorAll("[data-business-clock]").forEach(node => {
    const seconds = Math.max(0, Math.ceil((Number(node.dataset.businessClock)-now)/1000));
    const text = seconds ? `${Math.floor(seconds/3600)}:${String(Math.floor(seconds%3600/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}` : "等待结算";
    if (node.textContent !== text) node.textContent = text;
  });
}
