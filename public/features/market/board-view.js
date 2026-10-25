import { EQUIPMENT_STAGE_LABELS } from "../../equipment-trading.js";
import { paintJadeCanvases } from "../../jade-renderer.js";
import { createVirtualGridController } from "../../virtual-grid.js";
import { MARKET_TAX_PERCENT, MARKET_LISTING_PER_PLAYER_CAP } from "../../market-rules.js";
import { MARKET_VIRTUAL_THRESHOLD, MARKET_QUALITY, MARKET_STALLS, marketRefValue } from "./catalog.js";

export function createMarketBoardView({ getState, elsRef, getDocument, observeLazyPreviews, ui, helpers, ports }) {
  const { marketUi } = ui;
  const { formatMoney, escapeHtml } = helpers;
  const { marketCardHtml, marketSellables, marketActiveFilterCount, marketFilterSort, filterWantsForBrowse, wantCardHtml, bindMarketOnce, syncMarketFilterInputs } = ports;

function renderMarket() {
  if (!elsRef?.marketGrid || !getState()) return;
  bindMarketOnce();

  const all = getState().listings;
  const mine = all.filter((l) => l.ownerId === getState().me.id);
  const sellables = marketSellables();
  const wants = getState().wants || [];
  const fp = [
    marketUi.section,
    marketUi.cat,
    marketUi.search,
    marketUi.sort,
    [...marketUi.q].join(","),
    marketUi.equipmentStage, marketUi.equipmentBrand, marketUi.equipmentTech, marketUi.equipmentCondition,
    marketUi.min ?? "",
    marketUi.max ?? "",
    marketUi.afford ? 1 : 0,
    getState().me?.cash ?? 0,
    all.map((listing) => `${listing.id}:${listing.price}:${listing.ownerId}:${listing.item?.id || ""}:${listing.npcOffer?.id || ""}`).join("|"),
    sellables.map((item) => item.id).join(","),
    wants.map((w) => `${w.id}:${w.expiresAt}:${(w.offers || []).map((o) => `${o.id}:${o.price}`).join(",")}`).join("|"),
    Date.now() - (wants[0]?.expiresAt || 0) < 0 ? 0 : Math.floor(Date.now() / 60000)
  ].join("::");
  if (fp === ui.lastMarketRenderFp && elsRef.marketGrid.childElementCount) return;
  ui.lastMarketRenderFp = fp;

  if (elsRef.marketMineCnt) elsRef.marketMineCnt.textContent = mine.length;

  renderMarketStalls();
  renderMarketFilters();
  syncMarketFilterInputs();
  renderMarketSection(all, mine);
}

function renderMarketSection(listings, mine) {
  const sec = marketUi.section;
  const isList = sec === "listings";
  if (elsRef.marketShop) elsRef.marketShop.classList.toggle("solo", !isList);
  // 头图「我的挂单」按钮高亮
  const root = elsRef.marketGrid.closest?.('[data-view="market"]') || getDocument();
  root.querySelector('[data-market-section="mine"]')?.classList.toggle("active", sec === "mine");
  if (sec === "mine") {
    elsRef.marketGrid.className = "jm-grid";
    renderMarketMine(mine);
  } else if (sec === "want") {
    elsRef.marketGrid.className = "jm-grid as-wants";
    renderMarketWants();
  } else {
    elsRef.marketGrid.className = "jm-grid";
    renderMarketGrid(listings);
  }
}

function renderMarketStalls() {
  const cats = MARKET_STALLS.map((s) =>
    `<button class="jm-stall ${marketUi.section === "listings" && s.id === marketUi.cat ? "active" : ""}" data-action="marketStall" data-market-cat="${s.id}" type="button" aria-pressed="${marketUi.section === "listings" && s.id === marketUi.cat}"><span class="dot" style="background:${s.color}"></span>${s.label}</button>`
  ).join("");
  const wants = getState().wants || [];
  const want = `<button class="jm-stall jm-stall-want ${marketUi.section === "want" ? "active" : ""}" data-action="marketSection" data-market-section="want" type="button" aria-pressed="${marketUi.section === "want"}"><span class="dot" style="background:var(--blue)"></span>求购 <span class="jm-stall-cnt">${wants.length}</span></button>`;
  elsRef.marketStalls.innerHTML = cats + want;
}

function renderMarketFilters() {
  const equipment = marketUi.section === "listings" && marketUi.cat === "equipment";
  elsRef.marketQFilters.classList?.toggle("is-equipment", equipment);
  const label = elsRef.marketQFilters.closest?.(".jm-fgroup-quality")?.querySelector("label");
  if (label) label.textContent = equipment ? "设备筛选" : "种水";
  if (equipment) {
    const brands = [...new Map([...(getState().equipmentCatalog || []), ...(getState().listings || []).filter((row) => row.type === "equipment").map((row) => row.item)].map((row) => [row.brandKey, row.brand])).entries()].filter(([key]) => key);
    const select = (key, title, rows) => `<select data-equipment-filter="${key}" aria-label="${title}"><option value="">${title}</option>${rows.map(([value, text]) => `<option value="${escapeHtml(String(value))}" ${marketUi[key] === String(value) ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select>`;
    elsRef.marketQFilters.innerHTML = select("equipmentStage", "全部工序", Object.entries(EQUIPMENT_STAGE_LABELS)) + select("equipmentBrand", "全部品牌", brands) + select("equipmentTech", "科技等级", [1, 2, 3].map((level) => [level, `科技 ${level} 级`])) + select("equipmentCondition", "全部耐久", [["80", "耐久 ≥80%"], ["50", "耐久 ≥50%"], ["0", "需维修（0%）"]]);
  } else {
  const order = ["glass", "highIce", "ice", "stickyIce", "violet", "red", "ink", "glutinous", "bean"];
  elsRef.marketQFilters.innerHTML = order.map((k) => {
    const on = marketUi.q.has(k);
    return `<button type="button" class="jm-qchip ${on ? "on" : ""}" data-action="marketQ" data-market-q="${k}" aria-pressed="${on}" style="${on ? `background:${MARKET_QUALITY[k].color}` : ""}">${MARKET_QUALITY[k].name}</button>`;
  }).join("");
  }
  if (elsRef.marketAfford) {
    elsRef.marketAfford.classList.toggle("on", marketUi.afford);
    elsRef.marketAfford.setAttribute("aria-checked", marketUi.afford ? "true" : "false");
  }
}

function updateMarketResultStatus(count, noun = "条结果") {
  if (!elsRef.marketResultStatus) return;
  const active = marketActiveFilterCount();
  elsRef.marketResultStatus.textContent = `${count} ${noun}${active ? ` · ${active} 项筛选` : ""}`;
  elsRef.marketResultStatus.classList.toggle("is-filtered", active > 0);
}

function renderMarketGrid(listings) {
  const meId = getState().me.id;
  const arr = marketFilterSort(listings);
  const includeWants = marketUi.section === "listings" && marketUi.cat === "all";
  const wants = includeWants ? filterWantsForBrowse(getState().wants || []) : [];
  updateMarketResultStatus(arr.length + wants.length, "条交易");

  if (!arr.length && !wants.length) {
    ui.marketVirtual?.destroy();
    ui.marketVirtual = null;
    elsRef.marketGrid.classList?.remove?.("virtual-grid-host", "as-wants", "as-feed");
    const hasAnyListing = (getState().listings || []).length > 0;
    const hasAnyWant = (getState().wants || []).length > 0;
    const emptyText = (hasAnyListing || hasAnyWant)
      ? "没有符合条件的挂单或求购，调整筛选或搜索试试。"
      : "玩家交易行还没有挂单，也没有求购。等别人上货、发求购，或自己先挂一件。";
    elsRef.marketGrid.innerHTML = `
      <div class="jm-empty game-empty-state">
        <span class="game-empty-state-mark" aria-hidden="true">玉</span>
        <strong>${hasAnyListing || hasAnyWant ? "暂时没有匹配结果" : "交易行还在等第一批货"}</strong>
        <p>${emptyText}</p>
        ${hasAnyListing || hasAnyWant
          ? `<button class="secondary" type="button" data-action="resetMarketFilters">清除筛选</button>`
          : `<button type="button" data-action="openMarketListModal">挂牌第一件商品</button>`}
      </div>`;
    return;
  }

  // 「全部」混入求购：按时间/价格与挂单一起排，不用虚拟列表（卡片高度差异大）
  if (wants.length) {
    ui.marketVirtual?.destroy();
    ui.marketVirtual = null;
    elsRef.marketGrid.classList?.remove?.("virtual-grid-host");
    elsRef.marketGrid.classList?.add?.("as-feed");
    const feed = [
      ...arr.map((listing) => ({
        kind: "listing",
        at: Number(listing.createdAt) || 0,
        price: Number(listing.price) || 0,
        deal: (Number(listing.price) || 0) - marketRefValue(listing.item),
        listing
      })),
      ...wants.map((want) => ({
        kind: "want",
        at: Number(want.createdAt) || 0,
        price: Number(want.budget) || 0,
        deal: 0,
        want
      }))
    ];
    if (marketUi.sort === "priceAsc") feed.sort((a, b) => a.price - b.price || b.at - a.at);
    else if (marketUi.sort === "priceDesc") feed.sort((a, b) => b.price - a.price || b.at - a.at);
    else if (marketUi.sort === "deal") feed.sort((a, b) => a.deal - b.deal || b.at - a.at);
    else feed.sort((a, b) => b.at - a.at);
    elsRef.marketGrid.innerHTML = feed.map((row) =>
      row.kind === "want"
        ? wantCardHtml(row.want)
        : marketCardHtml(row.listing, row.listing.ownerId === meId)
    ).join("");
    if (arr.length) {
      paintJadeCanvases(elsRef.marketGrid);
      observeLazyPreviews(elsRef.marketGrid);
    }
    return;
  }

  elsRef.marketGrid.classList?.remove?.("as-feed", "as-wants");
  if (
    arr.length >= MARKET_VIRTUAL_THRESHOLD
    && !elsRef.marketGrid.classList?.contains?.("as-list")
    && typeof elsRef.marketGrid.classList?.add === "function"
  ) {
    if (!ui.marketVirtual) ui.marketVirtual = createVirtualGridController({
      minItemWidth: 180,
      gap: 10,
      estimateRowHeight: 280,
      overscanRows: 1
    });
    if (!elsRef.marketGrid.classList.contains("virtual-grid-host")) ui.marketVirtual.mount(elsRef.marketGrid);
    ui.marketVirtual.setItems(arr, (listing) => marketCardHtml(listing, listing.ownerId === meId), (windowEl) => {
      paintJadeCanvases(windowEl);
      observeLazyPreviews(windowEl);
    });
    return;
  }
  ui.marketVirtual?.destroy();
  ui.marketVirtual = null;
  elsRef.marketGrid.classList?.remove?.("virtual-grid-host");
  elsRef.marketGrid.innerHTML = arr.map((listing) => marketCardHtml(listing, listing.ownerId === meId)).join("");
  paintJadeCanvases(elsRef.marketGrid);
  observeLazyPreviews(elsRef.marketGrid);
}

function renderMarketMine(mine) {
  ui.marketVirtual?.destroy();
  ui.marketVirtual = null;
  elsRef.marketGrid.classList?.remove?.("virtual-grid-host");
  if (!mine.length) {
    elsRef.marketGrid.innerHTML = `
      <div class="jm-mine-empty">
        <b>还没有挂单</b>
        <p>把库存上架到交易行，等买家来成交。成交后买家另付 ${MARKET_TAX_PERCENT}% 市场税。</p>
        <button class="jm-hero-btn primary" data-action="openMarketListModal" type="button">＋ 挂牌出售</button>
      </div>`;
    return;
  }
  const slotsLeft = Math.max(0, MARKET_LISTING_PER_PLAYER_CAP - mine.length);
  const totalValue = mine.reduce((sum, l) => sum + Number(l.price || 0), 0);
  // 与集市在售同一套竖向卡片；汇总条通栏，不再放「继续挂牌」（顶栏已有挂牌出售）
  elsRef.marketGrid.innerHTML = `
    <div class="jm-mine-summary jm-mine-summary-span">
      <div class="jm-mine-summary-copy">
        <strong>我的挂单</strong>
        <span>${mine.length}/${MARKET_LISTING_PER_PLAYER_CAP} 栏位 · 挂出价合计 ${formatMoney(totalValue)} · 剩余 ${slotsLeft} 栏</span>
      </div>
    </div>
    ${mine.map((l) => marketCardHtml(l, true)).join("")}`;
  observeLazyPreviews(elsRef.marketGrid);
}

function renderMarketWants() {
  ui.marketVirtual?.destroy();
  ui.marketVirtual = null;
  elsRef.marketGrid.classList?.remove?.("virtual-grid-host");
  const wants = filterWantsForBrowse(getState().wants || []);
  updateMarketResultStatus(wants.length, "条求购");
  if (!wants.length) {
    const rawCount = (getState().wants || []).length;
    elsRef.marketGrid.innerHTML = `
      <div class="jm-empty game-empty-state">
        <span class="game-empty-state-mark" aria-hidden="true">求</span>
        <strong>${rawCount ? "暂时没有匹配的求购" : "还没有求购"}</strong>
        <p>${rawCount ? "调整筛选或搜索条件后再看看。" : "发布需求后，其他掌柜可以带货应征报价。"}</p>
        ${rawCount
          ? `<button class="secondary" type="button" data-action="resetMarketFilters">清除筛选</button>`
          : `<button type="button" data-action="openMarketWantPost">发布求购</button>`}
      </div>`;
    return;
  }
  elsRef.marketGrid.innerHTML = wants.map(wantCardHtml).join("");
}

  return { renderMarket, renderMarketSection, renderMarketStalls, renderMarketFilters, updateMarketResultStatus, renderMarketGrid, renderMarketMine, renderMarketWants };
}
