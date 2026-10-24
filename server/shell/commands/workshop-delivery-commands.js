export function registerWorkshopDeliveryCommands(socket, { getPlayer, acceptMutation, revealWorkshopDeliveryForPlayer, claimWorkshopDeliveryForPlayer, broadcast }) {
  for (const [event, run] of [["revealWorkshopDelivery", revealWorkshopDeliveryForPlayer], ["claimWorkshopDelivery", claimWorkshopDeliveryForPlayer]]) {
    socket.on(event, (payload = {}, acknowledge) => {
      const player = getPlayer(socket);
      if (!player) return acknowledge?.({ ok: false, message: "未找到玩家，请重新连接。" });
      if (!acceptMutation(player, payload, "该领取操作已处理，请刷新领取状态。", acknowledge)) return;
      const result = run(player, payload.deliveryId, payload);
      if (typeof acknowledge === "function") acknowledge(result);
      else if (!result.ok) socket.emit("toast", result.message);
      if (result.ok) broadcast();
    });
  }
}
