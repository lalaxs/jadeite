// collection-module.js — 藏品柜
import { inlaySummary } from "../../product-meta.js";
import { MAX_COLLECTION_SIZE, collectRepLabel } from "../../player-progression.js";

let getState, elsRef, socketRef;
let formatMoney, escapeHtml, empty, productCanvas;
let boundCollectionList = false;

function emitReturnCollectionItem(itemId, sock = socketRef) {
  const id = String(itemId || "").trim();
  if (!id || !sock) return false;
  sock.emit("returnCollectionItem", {
    itemId: id,
    requestId: globalThis.crypto?.randomUUID?.() || `return-collection-${Date.now()}`
  });
  return true;
}

function bindCollectionListOnce() {
  if (boundCollectionList || !elsRef?.collectionList) return;
  boundCollectionList = true;
  elsRef.collectionList.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-action='returnCollectionItem']");
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    emitReturnCollectionItem(btn.dataset.payload, socketRef);
  });
}

export function initCollectionModule(deps) {
  getState = deps.getState;
  elsRef = deps.els;
  socketRef = deps.socket;
  ({ formatMoney, escapeHtml, empty, productCanvas } = deps.helpers);
  bindCollectionListOnce();
  const register = deps.registerAction;
  if (typeof register === "function") {
    register("returnCollectionItem", ({ payload, socket: sock, event }) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      emitReturnCollectionItem(payload, sock || socketRef);
    });
  }
}

export function renderCollection() {
  bindCollectionListOnce();
  const collection = getState()?.me?.collection || [];
  const totalValue = collection.reduce((sum, item) => sum + Number(item?.value || 0), 0);
  const grantedRep = collection.reduce((sum, item) => sum + Number(item?.collectRepGrantedAmount || 0), 0);
  const capacityRate = Math.min(100, Math.round((collection.length / MAX_COLLECTION_SIZE) * 100));
  const overview = collection.length ? `
    <section class="collection-overview" aria-label="藏宝阁概览">
      <div class="collection-capacity">
        <div class="collection-overview-copy">
          <span>藏品席位</span>
          <strong>${collection.length}/${MAX_COLLECTION_SIZE}</strong>
          <small>${MAX_COLLECTION_SIZE - collection.length > 0 ? `还可收藏 ${MAX_COLLECTION_SIZE - collection.length} 件` : "藏宝阁已满"}</small>
        </div>
        <div class="collection-capacity-track" role="progressbar" aria-label="藏宝阁容量" aria-valuemin="0" aria-valuemax="${MAX_COLLECTION_SIZE}" aria-valuenow="${collection.length}">
          <span style="width:${capacityRate}%"></span>
        </div>
      </div>
      <div class="collection-overview-stat"><span>藏品总估值</span><strong>${formatMoney(totalValue)}</strong></div>
      <div class="collection-overview-stat"><span>已获典藏声望</span><strong>+${grantedRep}</strong></div>
    </section>` : "";
  const cards = collection.map((item) => {
    const summary = inlaySummary(item);
    const itemId = escapeHtml(item.id);
    return `
      <article class="treasure-card">
        <div class="treasure-card-visual">
          <span class="treasure-card-freeze" title="冻结中：不可上架黑市/交易所，不可工坊加工">冻结</span>
          ${productCanvas(item, "finished showcase")}
        </div>
        <div class="treasure-card-body">
          <div class="treasure-card-head">
            <div>
              <h3>${escapeHtml(item.name)}</h3>
            </div>
            <span class="treasure-card-rep">${escapeHtml(
              item.collectedRepGranted
                ? (Number(item.collectRepGrantedAmount) > 0
                  ? `已获 +${Number(item.collectRepGrantedAmount)}`
                  : "未加声望")
                : collectRepLabel(item.value)
            )}</span>
          </div>
          <div class="treasure-card-meta">
            <span>${escapeHtml(item.quality)}</span>
            <span>${escapeHtml(item.color)}</span>
          </div>
          ${summary ? `<p class="inlay-summary">${escapeHtml(summary)}</p>` : ""}
          <div class="treasure-card-value"><span>藏品估值</span><strong>${formatMoney(item.value)}</strong></div>
          <button class="secondary small treasure-card-return" data-action="returnCollectionItem" data-payload="${itemId}" type="button">放回仓库</button>
        </div>
      </article>
    `;
  }).join("");
  elsRef.collectionList.innerHTML = cards ? `${overview}${cards}` : `
    <div class="empty game-empty-state">
      <span class="game-empty-state-mark" aria-hidden="true">藏</span>
      <strong>藏宝阁还没有藏品</strong>
      <p>将成品收入藏宝阁后会冻结并提升门面，上限 ${MAX_COLLECTION_SIZE} 件，可随时放回仓库。</p>
      <button type="button" data-view-link="inventory">从库存挑选成品</button>
    </div>`;
}
