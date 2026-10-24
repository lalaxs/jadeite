import { payEmployeePayroll, resumeEmployeeWork } from "../../systems/employee-payroll.js";

export function registerPayrollCommands(socket, { getPlayer, normalizePlayer, consumeRequestId, spendCash, broadcast }) {
  socket.on("ackEmployeePayrollSettle", (payload = {}) => {
    const player = getPlayer(socket);
    if (!player || typeof payload.receiptId !== "string") return;
    if (player.employeePayroll?.pendingSettlement?.id !== payload.receiptId) return;
    player.employeePayroll.pendingSettlement = null;
    broadcast();
  });
  function run(event, action) {
    socket.on(event, (payload = {}, acknowledge) => {
      const reply = (result) => { if (typeof acknowledge === "function") acknowledge(result); };
      const player = getPlayer(socket);
      if (!player) return reply({ ok: false, message: "玩家状态不可用。" });
      if (!consumeRequestId(player, payload.requestId)) return reply({ ok: false, message: "该请求已处理，请勿重复提交。" });
      normalizePlayer(player);
      const result = action(player, payload);
      socket.emit("toast", result.message);
      reply(result);
      // 即使手动操作失败，也可能刚发生到期结薪／停工，仍需同步。
      broadcast();
    });
  }
  run("payEmployeePayroll", (player, payload) => payEmployeePayroll(player, payload.amount, { spendCash }));
  run("resumeEmployeeWork", (player) => resumeEmployeeWork(player, { spendCash }));
}
