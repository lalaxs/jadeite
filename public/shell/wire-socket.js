// Socket event wiring (moved from main.js)
import { createPayrollNotifier } from "./payroll-notifications.js";
import { formatMoney } from "./format-utils.js";

export function wireSocket(deps = {}) {
  const PLAYER_SESSION_STORAGE_KEY = "jade-player-session-v1";
  const {
    socket,
    els,
    setState,
    getState = () => null,
    setServerClockOffset,
    render,
    showToast,
    handleUiEvent,
    maybeShowStateDrivenModals,
    notifyNewAchievements,
    resetAchievementToastState
  } = deps;
  let stateVersion = 0;
  let payrollStorage;
  try { payrollStorage = globalThis.localStorage; } catch { /* private browsing */ }
  const notifyPayroll = createPayrollNotifier({ showToast, formatMoney, storage: payrollStorage });

  socket.on("connect", () => {
    if (els.connection) els.connection.textContent = "已连接";
  });

  socket.on("disconnect", () => {
    if (els.connection) els.connection.textContent = "离线";
  });

  socket.on("hello", ({ playerId, resumeToken }) => {
    let token = String(resumeToken || socket.auth?.resumeToken || "");
    try {
      const existing = JSON.parse(localStorage.getItem(PLAYER_SESSION_STORAGE_KEY) || "null");
      if (!token && existing?.playerId === playerId) token = String(existing.resumeToken || "");
      if (playerId && token) {
        localStorage.setItem(PLAYER_SESSION_STORAGE_KEY, JSON.stringify({ playerId, resumeToken: token }));
      }
    } catch (_) {}
    socket.auth = { ...socket.auth, playerId, resumeToken: token };
    sessionStorage.setItem("jade-player-id", playerId);
    resetAchievementToastState();
  });

  socket.on("session:error", (error = {}) => {
    try {
      localStorage.removeItem(PLAYER_SESSION_STORAGE_KEY);
      sessionStorage.removeItem("jade-player-id");
    } catch (_) {}
    socket.auth = { capabilities: { statePatchV1: true } };
    showToast(error.message || "本地身份凭据已失效，正在创建新档案。");
    setTimeout(() => socket.connect(), 0);
  });

  socket.on("state", (nextState) => {
    if (Number.isFinite(Number(nextState.serverNow))) {
      setServerClockOffset(Number(nextState.serverNow) - Date.now());
    }
    notifyNewAchievements(nextState?.me);
    stateVersion = Math.max(0, Number(nextState?.stateVersion) || 0);
    setState(nextState);
    render();
    maybeShowStateDrivenModals(nextState);
    notifyPayroll(nextState);
  });

  socket.on("state:patch", (patch = {}) => {
    const baseVersion = Number(patch.baseVersion) || 0;
    const nextVersion = Number(patch.stateVersion) || 0;
    if (!stateVersion || baseVersion !== stateVersion || nextVersion <= baseVersion) {
      socket.emit("requestState");
      return;
    }
    if (Number.isFinite(Number(patch.serverNow))) {
      setServerClockOffset(Number(patch.serverNow) - Date.now());
    }
    const changes = patch.changes && typeof patch.changes === "object" ? patch.changes : {};
    notifyNewAchievements(changes.me);
    stateVersion = nextVersion;
    setState({ ...changes, stateVersion: nextVersion, serverNow: patch.serverNow });
    render(Object.keys(changes));
    maybeShowStateDrivenModals(getState() || changes);
    notifyPayroll(getState() || changes);
  });

  socket.on("toast", showToast);
  socket.on("ui:event", handleUiEvent);
}
