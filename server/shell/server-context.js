import { createBroadcastScheduler } from "./broadcast-scheduler.js";
import { createStateSignatureBuilder } from "./state-signatures.js";
import { performance } from "node:perf_hooks";
/**
 * Server shell context — UI emitters, broadcast, request dedupe, player/socket helpers.
 */
import {
  normalizeRequestId,
  normalizeRequestIdHistory,
  REQUEST_ID_HISTORY_LIMIT
} from "../services/request-id-policy.js";

export function createServerContext(deps) {
  const { io, world, getState, randomUUID, deferEffect = null, scheduleRead = null, sessionIsActive = null, metrics = null } = deps;
  if (!io || !world || typeof getState !== "function" || typeof randomUUID !== "function") {
    throw new Error("server-context: io, world, getState, randomUUID are required");
  }

  const snapshotBridge = { snapshotFor: null, sharedSnapshotFor: null };
  const stateCacheBySocket = new Map();
  const snapshotSignatures = createStateSignatureBuilder();
  const scheduleBroadcast = scheduleRead ? createBroadcastScheduler(scheduleRead, broadcast) : null;

  function bindSnapshotFor(snapshotFor, sharedSnapshotFor = null) {
    snapshotBridge.snapshotFor = snapshotFor;
    snapshotBridge.sharedSnapshotFor = sharedSnapshotFor;
  }

  function emitUiEvent(socket, event = {}) {
    if (!socket || !event || typeof event !== "object") return;
    socket.emit("ui:event", {
      id: event.id || randomUUID(),
      ...event
    });
  }

  function emitUiEventToPlayer(player, event = {}) {
    if (!player) return;
    const state = getState();
    const targetId = String(player.id || "");
    if (!targetId) return;
    for (const [socketId, playerId] of state.sockets.entries()) {
      if (String(playerId) !== targetId) continue;
      emitUiEvent(io.sockets.sockets.get(socketId), event);
    }
  }

  function consumeRequestId(player, requestId) {
    const id = normalizeRequestId(requestId);
    if (!player || !id) return false;
    const recent = normalizeRequestIdHistory(player.processedRequestIds);
    if (recent.includes(id)) return false;
    recent.push(id);
    player.processedRequestIds = recent.slice(-REQUEST_ID_HISTORY_LIMIT);
    return true;
  }

  function normalizeMutationPayload(payload) {
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : {};
  }

  function notifyPlayerToast(player, text) {
    if (!player) return;
    const state = getState();
    for (const [socketId, playerId] of state.sockets.entries()) {
      if (playerId !== player.id) continue;
      const socket = io.sockets.sockets.get(socketId);
      if (socket) socket.emit("toast", text);
    }
  }

  function supportsStatePatches(socket) {
    return socket?.handshake?.auth?.capabilities?.statePatchV1 === true;
  }

  function emitState(socket, player, now = Date.now(), options = {}) {
    const snapshotFor = snapshotBridge.snapshotFor;
    if (!socket || !player || typeof snapshotFor !== "function") return false;
    const previous = stateCacheBySocket.get(socket.id);
    const patchCapable = supportsStatePatches(socket);
    const full = !patchCapable || options.forceFull === true || !previous;
    const snapshot = snapshotFor(player, now, full
      ? { ...options, includePrivatePlayer: true, includeStaticCatalogs: true }
      : options);
    if (full) {
      const version = Math.max(1, Number(previous?.version || 0) + 1);
      snapshot.stateVersion = version;
      socket.emit("state", snapshot);
      if (patchCapable) {
        stateCacheBySocket.set(socket.id, {
          version,
          signatures: snapshotSignatures(snapshot, options.sharedSnapshot)
        });
      }
      return true;
    }

    const nextSignatures = snapshotSignatures(snapshot, options.sharedSnapshot);
    const signatures = new Map(previous.signatures);
    const changes = {};
    for (const [key, signature] of nextSignatures) {
      if (previous.signatures.get(key) !== signature) changes[key] = snapshot[key];
      signatures.set(key, signature);
    }
    if (!Object.keys(changes).length) return false;
    const version = previous.version + 1;
    socket.emit("state:patch", {
      baseVersion: previous.version,
      stateVersion: version,
      serverNow: now,
      changes
    });
    stateCacheBySocket.set(socket.id, { version, signatures });
    return true;
  }

  function forgetSocketState(socketId) {
    stateCacheBySocket.delete(String(socketId || ""));
  }

  function resetStateCache() {
    stateCacheBySocket.clear();
  }

  function broadcast(options = {}) {
    if (options.immediate !== true && typeof deferEffect === "function") {
      const deferred = deferEffect((summary) => broadcast({
        ...options,
        immediate: true,
        mutationSummary: summary || options.mutationSummary
      }), "world-broadcast");
      if (deferred) return;
    }
    if (scheduleBroadcast && !options.scheduled) return scheduleBroadcast(options);
    const state = getState();
    const snapshotFor = snapshotBridge.snapshotFor;
    if (typeof snapshotFor !== "function") return;
    const started = performance.now();
    try {
      const now = Date.now();
      const sharedSnapshot = typeof snapshotBridge.sharedSnapshotFor === "function"
        ? snapshotBridge.sharedSnapshotFor(now)
        : null;
      metrics?.observe?.("jade_broadcast_phase_milliseconds", { phase: "shared_snapshot" }, performance.now() - started);
      const emitStarted = performance.now();
      const explicitPrivateIds = Array.isArray(options.privatePlayerIds)
        ? new Set(options.privatePlayerIds.map(String))
        : null;
      const changedPlayerIds = explicitPrivateIds || new Set(
        options.mutationSummary?.changedPlayerIds?.map(String) || []
      );
      const canOmitUnchangedPrivateState = Boolean(sharedSnapshot && (explicitPrivateIds || options.mutationSummary));
      for (const [socketId, playerId] of state.sockets.entries()) {
        if (options.excludeSocketId && socketId === options.excludeSocketId) continue;
        const player = state.players.get(playerId);
        const socket = io.sockets.sockets.get(socketId);
        if (player && socket) {
          emitState(socket, player, now, {
            includeStaticCatalogs: options.includeStaticCatalogs === true,
            includePrivatePlayer: !canOmitUnchangedPrivateState || changedPlayerIds.has(String(playerId)),
            sharedSnapshot
          });
        }
      }
      metrics?.observe?.("jade_broadcast_phase_milliseconds", { phase: "personalize_and_emit" }, performance.now() - emitStarted);
    } finally {
      metrics?.observe?.("jade_broadcast_milliseconds", {}, performance.now() - started);
    }
  }

  function addNews(text, tone = "info") {
    const state = getState();
    state.news.unshift({
      id: randomUUID(),
      text,
      tone,
      at: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    });
    state.news = state.news.slice(0, 12);
  }

  function getPlayer(socket) {
    const playerId = world.playerIdForSocket(socket?.id);
    const player = world.getPlayer(playerId);
    return player && (!sessionIsActive || sessionIsActive(player, socket)) ? player : null;
  }

  function playerSocketCount(playerId) {
    return world.socketCountForPlayer(playerId);
  }

  function isPlayerOnline(player) {
    return Boolean(player?.id) && playerSocketCount(player.id) > 0;
  }

  return {
    bindSnapshotFor,
    emitUiEvent,
    emitUiEventToPlayer,
    consumeRequestId,
    normalizeMutationPayload,
    notifyPlayerToast,
    emitState,
    forgetSocketState,
    resetStateCache,
    broadcast,
    addNews,
    getPlayer,
    playerSocketCount,
    isPlayerOnline
  };
}
