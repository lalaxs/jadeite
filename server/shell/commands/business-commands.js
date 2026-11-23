export function registerBusinessCommands(socket, deps) {
  const { getPlayer, acceptMutation, broadcast, businessService, emitUiEvent } = deps;
  const commands = {
    chooseBusinessStart: (player, body) => businessService.chooseBusinessStart(player, body.optionId),
    buildBusiness: (player, body) => businessService.buildBusiness(player, body.buildingId, { buyEquipment: body.buyEquipment !== false }),
    borrowBusinessLoan: (player, body) => businessService.borrowBusinessLoan(player, body.amount),
    repayBusinessLoan: (player, body) => businessService.repayBusinessLoan(player, body.amount),
    buyNeighborhoodItem: (player, body) => businessService.buyNeighborhoodItem(player, body.offerId),
    sellNeighborhoodItem: (player, body) => businessService.sellNeighborhoodItem(player, body.itemId),
    startConsignment: player => businessService.startConsignment(player),
    claimConsignment: player => businessService.claimConsignment(player),
    startOpeningCommission: player => businessService.startOpeningCommission(player),
    claimOpeningCommission: player => businessService.claimOpeningCommission(player)
  };
  for (const [event, operation] of Object.entries(commands)) {
    socket.on(event, (payload = {}, acknowledge) => {
      const player = getPlayer(socket);
      if (!player || !acceptMutation(player, payload, "该经营操作已处理。", acknowledge)) return;
      const result = operation(player, payload);
      if (!result.ok || !["chooseBusinessStart", "buildBusiness", "borrowBusinessLoan"].includes(event)) socket.emit("toast", { text: result.message, tone: result.ok ? "info" : "warn" });
      if (result.ok && event === "buildBusiness") emitUiEvent?.(socket, { type: "modal", tone: "success", title: "开业", body: result.message });
      acknowledge?.(result);
      broadcast();
    });
  }
}
