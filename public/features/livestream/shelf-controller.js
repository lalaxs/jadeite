

export function createLivestreamShelfController({ getState, elsRef, getActiveView, scope, ui, helpers, ports }) {
  const { slideIndexByRoom, shelfScrollByRoom } = ui;
  const { paintProductCanvases } = helpers;
  const { rooms, roomForId, currentSlideIndex, captureChatScroll, restoreChatScroll, roomHeroMarkup } = ports;

function shelfRoomIdFromEl(el) {
  return el?.getAttribute("data-room-id")
    || el?.closest("[data-room-id]")?.getAttribute("data-room-id")
    || null;
}

function captureShelfScroll(root = elsRef?.livestream) {
  if (!root) return;
  root.querySelectorAll("[data-livestream-shelf-scroll]").forEach((el) => {
    const roomId = shelfRoomIdFromEl(el);
    if (!roomId) return;
    shelfScrollByRoom.set(roomId, el.scrollLeft);
  });
}

function restoreShelfScroll(root = elsRef?.livestream, roomId = null) {
  if (!root) return;
  root.querySelectorAll("[data-livestream-shelf-scroll]").forEach((el) => {
    const id = shelfRoomIdFromEl(el);
    if (!id || (roomId && id !== roomId) || !shelfScrollByRoom.has(id)) return;
    const left = shelfScrollByRoom.get(id);
    el.scrollLeft = left;
    // 布局/画布回填后再写一次，避免被重置为 0
    scope.requestAnimationFrame(() => {
      if (el.isConnected) el.scrollLeft = left;
    });
  });
}

function capturePreservedShelves(root = elsRef?.livestream) {
  /** @type {Map<string, { node: Element, itemsKey: string }>} */
  const preserved = new Map();
  if (!root) return preserved;
  root.querySelectorAll("[data-livestream-shelf-host]").forEach((host) => {
    const roomId = host.closest("[data-room-id]")?.getAttribute("data-room-id");
    const node = host.firstElementChild;
    const itemsKey = host.querySelector("[data-livestream-shelf-scroll]")?.getAttribute("data-shelf-items") || "";
    if (!roomId || !node) return;
    preserved.set(roomId, { node, itemsKey });
  });
  return preserved;
}

function restorePreservedShelves(preserved, root = elsRef?.livestream) {
  if (!root || !preserved?.size) return;
  const state = getState?.();
  const myRoom = state?.me?.livestreamRoom;
  preserved.forEach(({ node, itemsKey }, roomId) => {
    const host = root.querySelector(`[data-room-id="${CSS.escape(roomId)}"] [data-livestream-shelf-host]`);
    if (!host) return;
    const freshKey = host.querySelector("[data-livestream-shelf-scroll]")?.getAttribute("data-shelf-items") || "";
    if (freshKey !== itemsKey) return;
    host.replaceChildren(node);
    const room = myRoom?.id === roomId ? myRoom : roomForId(roomId);
    if (room) syncShelfCurrent(host, room);
  });
}

function syncShelfCurrent(root, room) {
  if (!root || !room) return;
  const index = currentSlideIndex(room);
  root.querySelectorAll(".livestream-shelf-thumb[data-slide-index]").forEach((thumb) => {
    const on = Number(thumb.dataset.slideIndex) === index;
    thumb.classList.toggle("is-current", on);
    thumb.setAttribute("aria-current", on ? "true" : "false");
  });
}

function refreshRoomStage(roomId) {
  const state = getState();
  const myRoom = state?.me?.livestreamRoom;
  const room = myRoom?.id === roomId ? myRoom : roomForId(roomId);
  const card = elsRef.livestream?.querySelector(`[data-room-id="${CSS.escape(roomId)}"]`);
  const stage = card?.querySelector("[data-livestream-stage]");
  if (!room || !stage) return;
  captureChatScroll(stage);
  captureShelfScroll(card);
  const mine = room.ownerId === state.me.id || myRoom?.id === roomId;
  const hallCard = card.classList.contains("is-hall-card");

  stage.innerHTML = roomHeroMarkup(room, mine, hallCard
    ? { showChat: false, showFooter: false, showShelf: false }
    : undefined);

  // 主播货盘在右侧独立节点：切讲品只改高亮，不重建
  const shelfHost = card.querySelector("[data-livestream-shelf-host]");
  if (shelfHost) {
    syncShelfCurrent(shelfHost, room);
  }

  paintProductCanvases();
  restoreChatScroll(stage, roomId);
  restoreShelfScroll(card, roomId);
}

function moveSlide(roomId, delta) {
  const state = getState();
  const myRoom = state?.me?.livestreamRoom;
  const room = myRoom?.id === roomId ? myRoom : roomForId(roomId);
  if (!room?.items?.length) return;
  if (ui.buyConfirm?.roomId === roomId) ui.buyConfirm = null;
  slideIndexByRoom.set(roomId, currentSlideIndex(room) + delta);
  refreshRoomStage(roomId);
}

function selectSlide(roomId, index) {
  const state = getState();
  const myRoom = state?.me?.livestreamRoom;
  const room = myRoom?.id === roomId ? myRoom : roomForId(roomId);
  if (!room?.items?.length) return;
  if (ui.buyConfirm?.roomId === roomId) ui.buyConfirm = null;
  const next = Math.max(0, Math.min(room.items.length - 1, Number(index) || 0));
  slideIndexByRoom.set(roomId, next);
  refreshRoomStage(roomId);
}

function advanceVisibleCarousels() {
  if (getActiveView?.() !== "livestream") return;
  if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
  if (ui.buyConfirm) return;
  if (ui.watchingRoomId) {
    moveSlide(ui.watchingRoomId, 1);
    return;
  }
  if (ui.activeLivestreamTab === "mine") {
    const myRoom = getState()?.me?.livestreamRoom;
    if (myRoom?.id) moveSlide(myRoom.id, 1);
    return;
  }
  for (const room of rooms()) {
    moveSlide(room.id, 1);
  }
}

  return { shelfRoomIdFromEl, captureShelfScroll, restoreShelfScroll, capturePreservedShelves, restorePreservedShelves, syncShelfCurrent, refreshRoomStage, moveSlide, selectSlide, advanceVisibleCarousels };
}
