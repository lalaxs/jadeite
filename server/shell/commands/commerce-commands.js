import {
  ORDER_SINGLE_REFRESH_DAILY_CAP,
  ORDER_BATCH_REFRESH_DAILY_CAP
} from "../../../shared/domain/economy/order-refresh.js";

/** Player market, materials, inventory commerce, order refresh and want-board commands. */
export function registerCommerceCommands(socket, deps) {
  const {
    getPlayer,
    acceptMutation,
    listItemForPlayer,
    emitUiEvent,
    uiMoney,
    broadcast,
    mutationValue,
    buyAssetListingForPlayer,
    addNews,
    consumeRequestId,
    buyMaterialPack,
    advanceTask,
    materialHistoryPayload,
    buyListingForPlayer,
    acceptMarketOfferForPlayer,
    normalizeMutationPayload,
    markInventoryItemsSeen,
    recycleInventoryItemForPlayer,
    withdrawListingForPlayer,
    ensureDailyOrderRefresh,
    ensureRefreshCounts,
    orderBatchRefreshFee,
    spendCash,
    replaceOrdersPool,
    refillOrders,
    replaceOrderSlot,
    orderSingleRefreshFee,
    collectMarketPayoutForPlayer,
    postWantForPlayer,
    cancelWantForPlayer,
    applyWantForPlayer,
    withdrawWantOfferForPlayer,
    settleWantForPlayer,
    recoverPlayerIfNeeded
  } = deps;
  socket.on("requestRecovery", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player || !acceptMutation(player, payload, "该借款申请已处理。")) return;
    const result = recoverPlayerIfNeeded(player, Date.now(), { requested: true });
    socket.emit("toast", result.applied
      ? `周转借款到账 ${uiMoney(result.grant)}，应还 ${uiMoney(result.debtAdded)}。`
      : "暂不符合申请条件：需已有经营记录、无可用库存及待结算资产，且无未还纾困款。");
    if (result.applied) broadcast();
  });

  socket.on("listItem", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该挂牌请求已处理，请勿重复提交。")) return;
    const { type, itemId, price } = payload;
    const result = listItemForPlayer(player, { type, itemId, price });
    if (!result.ok) {
      if (result.message) socket.emit("toast", result.message);
      return;
    }
    emitUiEvent(socket, {
      type: "float",
      tone: "trade",
      text: `已挂牌 ${uiMoney(result.price)}`,
      x: 66,
      y: 66
    });
    broadcast();
  });

  socket.on("buyAssetListing", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该资产购买请求已处理，请勿重复提交。")) return;
    const listingId = mutationValue(payload, "listingId");
    const result = buyAssetListingForPlayer(player, listingId);
    socket.emit("toast", {
      text: result.message,
      tone: result.ok ? "info" : (result.code === "INSUFFICIENT_CASH" ? "danger" : "warn")
    });
    if (result.ok) {
      addNews(`${player.name} 买下 ${result.listing.name}。`, "trade");
      emitUiEvent(socket, {
        type: "modal",
        tone: "success",
        title: "资产入手",
        subtitle: result.listing.name,
        body: result.listing.description
      });
      broadcast();
    }
  });

  socket.on("buyMaterialPack", ({ materialId, amount, requestId } = {}) => {
    const player = getPlayer(socket);
    if (!consumeRequestId(player, requestId)) {
      return socket.emit("toast", "该材料购买请求已处理，请勿重复提交。");
    }
    if (!player || !materialId || !Number.isFinite(Number(amount))) return;
    const result = buyMaterialPack(player, materialId, Number(amount));
    socket.emit("toast", result.message);
    if (result.ok) {
      advanceTask(player, "material_buy");
      addNews(`${player.name} 购入镶嵌材料 ${result.listing.name}。`, "trade");
      emitUiEvent(socket, {
        type: "modal",
        tone: "success",
        title: "材料入手",
        subtitle: result.listing.name
      });
      broadcast();
    }
  });

  socket.on("getMaterialHistory", (key, cb) => {
    if (typeof cb !== "function") return;
    cb(materialHistoryPayload(key));
  });

  socket.on("buyListing", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该交易购买请求已处理，请勿重复提交。")) return;
    const listingId = mutationValue(payload, "listingId");
    const result = buyListingForPlayer(player, listingId);
    if (!result.ok) {
      if (result.message) socket.emit("toast", result.message);
      return;
    }
    const { listing } = result;
    emitUiEvent(socket, {
      type: "modal",
      tone: "trade",
      title: "交易成交",
      subtitle: listing.item.name,
      body: listing.type === "equipment"
        ? `你从 ${listing.ownerName} 处购入的设备已加入工坊，保留原耐久；请在工坊安排员工，必要时先维修。`
        : `你从 ${listing.ownerName} 的摊位买下了这件货。`
    });
    broadcast();
  });

  socket.on("markInventorySeen", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    const body = normalizeMutationPayload(payload);
    const ids = Array.isArray(body.ids) ? body.ids : (body.id != null ? [body.id] : []);
    if (!markInventoryItemsSeen(player, ids)) return;
    broadcast();
  });

  socket.on("recycleInventoryItem", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该回收请求已处理，请勿重复提交。")) return;
    const result = recycleInventoryItemForPlayer(player, payload);
    socket.emit("toast", result.message || (result.ok ? "已回收。" : "回收失败。"));
    if (!result.ok) {
      socket.emit("inventoryRecycleResult", result);
      return;
    }
    if (result.payout > 0) {
      emitUiEvent(socket, {
        type: "float",
        tone: "trade",
        text: `回收 +${uiMoney(result.payout)}`,
        x: 66,
        y: 66
      });
    }
    socket.emit("inventoryRecycleResult", result);
    broadcast();
  });

  socket.on("withdrawListing", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该撤单请求已处理，请勿重复提交。")) return;
    const listingId = mutationValue(payload, "listingId");
    const result = withdrawListingForPlayer(player, listingId);
    if (!result.ok) {
      if (result.message) socket.emit("toast", result.message);
      return;
    }
    emitUiEvent(socket, {
      type: "float",
      tone: "trade",
      text: result.listing.type === "equipment" ? "已撤单，设备退回工坊。" : "已撤单，退回库。", x: 66,
      y: 66
    });
    broadcast();
  });

  socket.on("acceptMarketOffer", (payload) => {
    const player = getPlayer(socket);
    if (!player || !acceptMutation(player, payload, "该收购成交请求已处理。")) return;
    const result = acceptMarketOfferForPlayer(player, payload?.listingId, payload?.offerId);
    socket.emit("toast", result.message);
    if (result.ok) broadcast();
  });

  socket.on("refreshOrders", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该批量刷新请求已处理，请勿重复提交。")) return;
    if (typeof ensureDailyOrderRefresh === "function") ensureDailyOrderRefresh(player);
    const counts = typeof ensureRefreshCounts === "function" ? ensureRefreshCounts(player) : null;
    if (counts && counts.batch >= ORDER_BATCH_REFRESH_DAILY_CAP) {
      return socket.emit("toast", "今日批量刷新次数已用尽。");
    }
    const fee = typeof orderBatchRefreshFee === "function" ? orderBatchRefreshFee(player) : 1500;
    if (!spendCash(player, fee, "批量刷新订单", { source: "orderRefresh" })) {
      return socket.emit("toast", `批量刷新需要 ${uiMoney(fee)}。`);
    }
    if (counts) counts.batch += 1;
    if (typeof replaceOrdersPool === "function") replaceOrdersPool(player);
    else {
      player.orders = [];
      refillOrders(player);
    }
    emitUiEvent(socket, {
      type: "float",
      tone: "expense",
      text: `刷新全部订单 -${uiMoney(fee)}`,
      x: 66,
      y: 70
    });
    broadcast();
  });

  socket.on("refreshOrderSlot", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该订单刷新请求已处理，请勿重复提交。")) return;
    const { orderId } = payload;
    if (typeof ensureDailyOrderRefresh === "function") ensureDailyOrderRefresh(player);
    if (!orderId || !(player.orders || []).some((item) => item.id === orderId)) {
      return socket.emit("toast", "订单不存在。");
    }
    const counts = typeof ensureRefreshCounts === "function" ? ensureRefreshCounts(player) : null;
    if (counts && counts.single >= ORDER_SINGLE_REFRESH_DAILY_CAP) {
      return socket.emit("toast", "今日单槽刷新次数已用尽。");
    }
    const fee = typeof orderSingleRefreshFee === "function" ? orderSingleRefreshFee(player) : 500;
    if (!spendCash(player, fee, "刷新订单", { source: "orderRefresh" })) {
      return socket.emit("toast", `刷新该订单需要 ${uiMoney(fee)}。`);
    }
    const result = typeof replaceOrderSlot === "function"
      ? replaceOrderSlot(player, orderId)
      : { ok: false, message: "刷新不可用。" };
    if (!result.ok) return socket.emit("toast", result.message || "刷新失败。");
    if (counts) counts.single += 1;
    emitUiEvent(socket, {
      type: "float",
      tone: "expense",
      text: `刷新订单 -${uiMoney(fee)}`,
      x: 66,
      y: 70
    });
    broadcast();
  });

  socket.on("collectPayout", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该收益领取请求已处理，请勿重复提交。")) return;
    const result = collectMarketPayoutForPlayer(player);
    if (!result.ok) return socket.emit("toast", result.message);
    emitUiEvent(socket, { type: "float", tone: "profit", text: `领取 ${uiMoney(result.total)}`, x: 66, y: 66 });
    broadcast();
  });

  socket.on("postWant", (payload = {}, acknowledge) => {
    const player = getPlayer(socket);
    const reply = (ok, message) => {
      if (typeof acknowledge === "function") {
        acknowledge({ ok: Boolean(ok), message: message || "" });
      } else if (message) {
        socket.emit("toast", message);
      }
    };
    if (!player) return reply(false, "未找到玩家。");
    if (!acceptMutation(player, payload, "该求购发布请求已处理，请勿重复提交。", acknowledge)) return;
    const result = postWantForPlayer(player, payload);
    if (!result.ok) return reply(false, result.message);
    emitUiEvent(socket, {
      type: "float",
      tone: "trade",
      text: `已冻结 ${uiMoney(result.escrowAmount)}`,
      x: 66,
      y: 66
    });
    reply(true, result.message);
    broadcast();
  });

  socket.on("cancelWant", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该求购取消请求已处理，请勿重复提交。")) return;
    const wantId = mutationValue(payload, "wantId");
    const result = cancelWantForPlayer(player, wantId);
    if (!result.ok) return socket.emit("toast", result.message);
    emitUiEvent(socket, {
      type: "float",
      tone: "trade",
      text: result.message,
      x: 66,
      y: 66
    });
    broadcast();
  });

  socket.on("applyWant", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该求购应征请求已处理，请勿重复提交。")) return;
    const { wantId, type, itemId, price } = payload;
    const result = applyWantForPlayer(player, { wantId, type, itemId, price });
    if (!result.ok) return socket.emit("toast", result.message);
    emitUiEvent(socket, { type: "float", tone: "trade", text: result.message, x: 66, y: 66 });
    broadcast();
  });

  socket.on("withdrawWantOffer", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该应征撤回请求已处理，请勿重复提交。")) return;
    const { wantId, offerId } = payload;
    const result = withdrawWantOfferForPlayer(player, { wantId, offerId });
    if (!result.ok) return socket.emit("toast", result.message);
    emitUiEvent(socket, { type: "float", tone: "trade", text: "已撤回应征。", x: 66, y: 66 });
    broadcast();
  });

  socket.on("settleWant", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该求购结算请求已处理，请勿重复提交。")) return;
    const result = settleWantForPlayer(player, payload);
    if (!result.ok && result.reason && result.reason !== "cash") {
      socket.emit("toast", result.reason);
    }
    broadcast();
  });
}

