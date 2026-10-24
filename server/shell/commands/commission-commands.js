/** NPC supplied-material work: authoritative timers and one-time cash settlement. */
export function registerCommissionCommands(socket, { getPlayer, acceptMutation, startCommissionForPlayer, claimCommissionForPlayer, broadcast }) {
  for (const [event, run] of [["startCommission", startCommissionForPlayer], ["claimCommission", claimCommissionForPlayer]]) {
    if (typeof run !== "function") continue;
    socket.on(event, (payload = {}, acknowledge) => {
      const player = getPlayer(socket);
      if (!player) return acknowledge?.({ ok: false, message: "未找到玩家，请重新连接。" });
      if (!acceptMutation(player, payload, "该来料加工操作已处理，请刷新查看。", acknowledge)) return;
      const result = run(player, payload);
      if (typeof acknowledge === "function") acknowledge(result);
      else socket.emit("toast", result.message);
      if (result.ok) broadcast();
    });
  }
}
