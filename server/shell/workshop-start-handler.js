export function handleStartWorkshopJobRequest({
  player,
  payload = {},
  acknowledge,
  consumeRequestId,
  startWorkshopJob,
  emitToast,
  onSuccess
}) {
  const reply = (result) => {
    if (typeof acknowledge === "function") acknowledge(result);
  };
  if (!player) {
    const result = { ok: false, message: "玩家状态不可用。" };
    reply(result);
    return result;
  }
  if (!consumeRequestId(player, payload.requestId)) {
    const result = { ok: false, message: "该开工请求已处理，请勿重复提交。" };
    emitToast(result.message);
    reply(result);
    return result;
  }
  const result = startWorkshopJob(player, payload.deviceId, payload);
  if (!result.ok) {
    emitToast(result.message);
    reply({ ok: false, message: result.message });
    return result;
  }
  onSuccess(result);
  reply({ ok: true, message: "已开工", requestId: payload.requestId });
  return result;
}
