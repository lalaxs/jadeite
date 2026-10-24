/** Black-market socket commands, isolated from the root transport shell. */
export function registerBlackmarketCommands(socket, deps) {
  const {
    getPlayer,
    acceptMutation,
    openBlackStallForPlayer,
    closeBlackStallForPlayer,
    setBlackStallPausedForPlayer,
    mutationValue,
    updateBlackStallMetaForPlayer,
    updateServiceProfileForPlayer,
    consumeRequestId,
    addGoodsBatchToStallForPlayer,
    addGoodsToStallForPlayer,
    emitUiEvent,
    uiMoney,
    broadcast,
    addBlindboxItemsForPlayer,
    withdrawBlindboxItemForPlayer,
    buyGoodsFromStallForPlayer,
    buyBlackListingForPlayer,
    publicStone,
    startBlindboxDrawForPlayer,
    settleBlindboxDrawForPlayer,
    withdrawGoodsFromStallForPlayer,
    addServiceOfferForPlayer,
    removeServiceOfferForPlayer,
    orderBlackServiceForPlayer,
    acceptBlackServiceForPlayer,
    submitBlackServiceForPlayer,
    confirmBlackServiceForPlayer,
    cancelBlackServiceForPlayer,
    submitBlackmarketRatingForPlayer,
    collectBlackmarketPayoutForPlayer
  } = deps;

  socket.on("bmOpenStall", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该开摊请求已处理，请勿重复提交。")) return;
    const result = openBlackStallForPlayer(player, payload);
    socket.emit("toast", result.message);
    socket.emit("bmStallResult", {
      ok: result.ok,
      message: result.message,
      action: "open",
      stallType: result.stall?.type || payload.type || "",
      status: result.stall?.status || ""
    });
    if (result.ok) broadcast();
  });

  socket.on("bmCloseStall", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该收摊请求已处理，请勿重复提交。")) return;
    const result = closeBlackStallForPlayer(player);
    socket.emit("toast", result.message);
    if (result.ok) broadcast();
  });

  socket.on("bmPauseStall", (payload = true) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该摊位状态请求已处理，请勿重复提交。")) return;
    const paused = mutationValue(payload, "paused");
    const result = setBlackStallPausedForPlayer(player, paused !== false);
    socket.emit("toast", result.message);
    if (result.ok) broadcast();
  });

  socket.on("bmUpdateStallMeta", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该摊位更新请求已处理，请勿重复提交。")) return;
    const result = updateBlackStallMetaForPlayer(player, payload);
    socket.emit("toast", result.message);
    if (result.ok) broadcast();
  });

  socket.on("bmSetStallAnonymous", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该匿名设置请求已处理，请勿重复提交。")) return;
    const rawAnonymous = mutationValue(payload, "anonymous");
    const anonymous = rawAnonymous === true || rawAnonymous === "true";
    const result = updateBlackStallMetaForPlayer(player, { anonymous });
    socket.emit("toast", result.message);
    if (result.ok) broadcast();
  });

  socket.on("bmUpdateServiceProfile", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该服务资料请求已处理，请勿重复提交。")) return;
    const result = updateServiceProfileForPlayer(player, payload);
    socket.emit("toast", result.message);
    if (result.ok) broadcast();
  });

  socket.on("bmListItem", (payload = {}, acknowledge) => {
    const reply = (ok, message, extra = {}) => {
      const body = {
        ok: Boolean(ok),
        message: message || "",
        itemId: payload?.itemId || null,
        ...extra
      };
      try {
        socket.emit("toast", body.message);
        socket.emit("bmListResult", body);
      } catch (_) {
        /* ignore */
      }
      if (typeof acknowledge === "function") {
        try {
          acknowledge(body);
        } catch (_) {
          /* ignore */
        }
      }
    };
    try {
      const player = getPlayer(socket);
      if (!player) return reply(false, "上架失败：未找到玩家。");
      if (payload?.requestId && !consumeRequestId(player, payload.requestId)) {
        return reply(false, "该黑市上架请求已处理，请勿重复提交。", { duplicate: true });
      }
      const batch = Array.isArray(payload?.entries) ? payload.entries : null;
      const result = batch?.length
        ? addGoodsBatchToStallForPlayer(player, batch)
        : addGoodsToStallForPlayer(player, {
          type: payload?.type,
          itemId: payload?.itemId,
          price: payload?.price
        });
      if (!result.ok) return reply(false, `上架失败${result.message}`);
      emitUiEvent(socket, {
        type: "float",
        tone: "trade",
        text: batch?.length
          ? `黑市上架 ${result.count} 件`
          : `黑市上架 ${uiMoney(result.price)}`,
        x: 66,
        y: 66
      });
      broadcast();
      reply(true, result.message || "上架成功：已摆上摊位货架", {
        price: result.price,
        itemId: payload?.itemId || null,
        count: result.count,
        itemIds: result.itemIds,
        activated: Boolean(result.activated)
      });
    } catch (err) {
      console.error("bmListItem failed", err);
      reply(false, `上架失败${err?.message || "服务器异。" }`);
    }
  });

  socket.on("bmAddBlindItems", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该盲盒补货请求已处理，请勿重复提交。")) return;
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    const result = addBlindboxItemsForPlayer(player, entries, {
      blindPrice: payload.blindPrice
    });
    // 先广播库存，再回结果，避免客户端用旧库存重开补货窗导致幽灵选中
    if (result.ok) broadcast();
    socket.emit("toast", result.message);
    socket.emit("bmListResult", {
      ok: result.ok,
      message: result.message,
      activated: Boolean(result.activated),
      poolCount: result.poolCount,
      blindPrice: result.blindPrice
    });
  });

  socket.on("bmWithdrawBlindItem", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该盲盒撤回请求已处理，请勿重复提交。")) return;
    const poolEntryId = mutationValue(payload, "poolEntryId", "id");
    const result = withdrawBlindboxItemForPlayer(player, poolEntryId);
    socket.emit("toast", result.message);
    if (result.ok) broadcast();
    socket.emit("bmWithdrawBlindResult", {
      ok: result.ok,
      message: result.message,
      poolCount: result.poolCount,
      paused: Boolean(result.paused)
    });
  });

  socket.on("bmBuyListing", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该黑市购买请求已处理，请勿重复提交。")) return;
    let result;
    if (payload && typeof payload === "object" && payload.stallId && payload.listingId) {
      result = buyGoodsFromStallForPlayer(player, payload.stallId, payload.listingId, payload.expectedPrice);
    } else {
      result = buyBlackListingForPlayer(player, mutationValue(payload, "listingId"));
    }
    socket.emit("toast", result.message);
    if (!result.ok) {
      if (result.code === "PRICE_CHANGED") broadcast();
      return;
    }
    emitUiEvent(socket, {
      type: "float",
      tone: "trade",
      text: `黑市买入 -${uiMoney(result.total)}`,
      x: 66,
      y: 66
    });
    broadcast();
  });

  socket.on("bmBuyBlindbox", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该盲盒购买请求已处理，请勿重复提交。")) return;
    const stallId = mutationValue(payload, "stallId");
    const result = startBlindboxDrawForPlayer(player, stallId);
    if (!result.ok) {
      socket.emit("toast", result.message);
      return;
    }
    const raw = result.draw || {};
    const draw = {
      ...raw,
      candidates: (raw.candidates || []).map((row) => ({
        ...row,
        item: typeof publicStone === "function" ? publicStone(row.item) : row.item
      }))
    };
    socket.emit("bmBlindDrawStart", {
      ok: true,
      resumed: Boolean(result.resumed),
      message: result.message,
      draw,
      poolCount: result.poolCount,
      total: result.total
    });
    if (!result.resumed) {
      emitUiEvent(socket, {
        type: "float",
        tone: "trade",
        text: `盲盒 -${uiMoney(result.total || draw.price || 0)}`,
        x: 66,
        y: 66
      });
    }
    broadcast();
  });

  socket.on("bmSettleBlindDraw", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该盲盒结算请求已处理，请勿重复提交。")) return;
    const result = settleBlindboxDrawForPlayer(player, payload);
    socket.emit("toast", result.message);
    socket.emit("bmBlindDrawSettle", {
      ok: result.ok,
      message: result.message,
      items: result.items,
      returnedCount: result.returnedCount,
      extra: result.extra,
      total: result.total,
      degraded: result.degraded,
      stallId: result.stallId
    });
    if (!result.ok) return;
    if (result.extra > 0) {
      emitUiEvent(socket, {
        type: "float",
        tone: "trade",
        text: `加购 -${uiMoney(result.extra)}`,
        x: 66,
        y: 66
      });
    }
    broadcast();
  });

  socket.on("bmWithdrawListing", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该黑市撤单请求已处理，请勿重复提交。")) return;
    const listingId = mutationValue(payload, "listingId");
    const result = withdrawGoodsFromStallForPlayer(player, listingId);
    socket.emit("toast", result.message);
    if (result.ok) {
      socket.emit("bmWithdrawResult", {
        ok: true,
        message: result.message,
        stallClosed: Boolean(result.stallClosed)
      });
      broadcast();
    }
  });

  socket.on("bmAddServiceOffer", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该服务上架请求已处理，请勿重复提交。")) return;
    const result = addServiceOfferForPlayer(player, payload);
    socket.emit("toast", result.message);
    socket.emit("bmServiceOfferResult", {
      ok: result.ok,
      message: result.message,
      activated: Boolean(result.activated)
    });
    if (result.ok) broadcast();
  });

  socket.on("bmRemoveServiceOffer", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该服务撤回请求已处理，请勿重复提交。")) return;
    const offerId = mutationValue(payload, "offerId");
    const result = removeServiceOfferForPlayer(player, offerId);
    socket.emit("toast", result.message);
    if (result.ok) broadcast();
  });

  socket.on("bmOrderService", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该服务下单请求已处理，请勿重复提交。")) return;
    const result = orderBlackServiceForPlayer(player, payload.stallId, payload.offerId, payload);
    socket.emit("toast", result.message);
    if (result.ok) broadcast();
  });

  socket.on("bmAcceptService", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该接单请求已处理，请勿重复提交。")) return;
    const id = mutationValue(payload, "orderId");
    const result = acceptBlackServiceForPlayer(player, id);
    socket.emit("toast", result.message);
    if (result.ok) broadcast();
  });

  socket.on("bmSubmitService", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该交付请求已处理，请勿重复提交。")) return;
    const orderId = mutationValue(payload, "orderId");
    const result = submitBlackServiceForPlayer(player, orderId, {
      forceEarly: Boolean(payload?.forceEarly)
    });
    if (!result.ok && result.needConfirm) {
      socket.emit("bmSubmitServiceConfirm", {
        orderId,
        message: result.message,
        penalty: result.penalty
      });
      return;
    }
    socket.emit("toast", result.message);
    if (result.ok) broadcast();
  });

  socket.on("bmDeliverService", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该交付请求已处理，请勿重复提交。")) return;
    const id = mutationValue(payload, "orderId");
    const result = submitBlackServiceForPlayer(player, id, { forceEarly: false });
    if (!result.ok && result.needConfirm) {
      socket.emit("bmSubmitServiceConfirm", {
        orderId: id,
        message: result.message,
        penalty: result.penalty
      });
      return;
    }
    socket.emit("toast", result.message);
    if (result.ok) broadcast();
  });

  socket.on("bmConfirmService", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该服务确认请求已处理，请勿重复提交。")) return;
    const id = mutationValue(payload, "orderId");
    const result = confirmBlackServiceForPlayer(player, id);
    socket.emit("toast", result.message);
    if (result.ok) broadcast();
  });

  socket.on("bmCancelService", (payload) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该服务取消请求已处理，请勿重复提交。")) return;
    const orderId = mutationValue(payload, "orderId");
    const result = cancelBlackServiceForPlayer(player, orderId);
    socket.emit("toast", result.message);
    if (result.ok) broadcast();
  });

  socket.on("bmSubmitRating", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该评价请求已处理，请勿重复提交。")) return;
    const result = submitBlackmarketRatingForPlayer(player, payload);
    socket.emit("toast", result.message);
    if (result.ok) broadcast();
  });

  socket.on("bmCollectPayout", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    if (!acceptMutation(player, payload, "该黑市收益领取请求已处理，请勿重复提交。")) return;
    const result = collectBlackmarketPayoutForPlayer(player);
    if (!result.ok) return socket.emit("toast", result.message);
    emitUiEvent(socket, { type: "float", tone: "profit", text: `黑市领取 ${uiMoney(result.total)}`, x: 66, y: 66 });
    broadcast();
  });
}

