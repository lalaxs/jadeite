import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { createWorldDelta, worldDeltaHasChanges } from "../persistence/world-delta.js";

const RAW_SOCKET_EMIT = Symbol("jade.rawSocketEmit");
const SOCKET_REGISTRATION_WRAPPED = Symbol("jade.socketRegistrationWrapped");

function restoreWorld(world, snapshot, socketBindings) {
  world.importSnapshot(snapshot);
  for (const [socketId, playerId] of socketBindings) {
    if (world.hasPlayer(playerId)) world.bindSocket(socketId, playerId);
  }
}

export function createDurableMutationCoordinator({
  world,
  flush,
  recordAudit = null,
  onRollback = null,
  logger = console,
  metrics = { increment() {} },
  validateSocket = null,
  maxPending = 256,
  maxWaitMs = 10_000
}) {
  if (!world || typeof world.exportSnapshot !== "function") {
    throw new Error("durable-mutation: world store required");
  }
  if (typeof flush !== "function") {
    throw new Error("durable-mutation: flush function required");
  }
  const storage = new AsyncLocalStorage();
  let tail = Promise.resolve();
  let closed = false;
  let pending = 0;
  const coalesced = new Map();

  function queue(operation, key = null, label = "read") {
    if (key && coalesced.has(key)) return coalesced.get(key);
    if (closed || pending >= maxPending) {
      return Promise.reject(Object.assign(new Error("服务繁忙，请稍后重试。"), { code: "SERVER_BUSY" }));
    }
    const enqueuedAt = performance.now();
    pending += 1;
    metrics.set?.("jade_mutation_queue_depth", {}, pending);
    const scheduled = tail.then(async () => {
      const waitMs = performance.now() - enqueuedAt;
      metrics.observe?.("jade_operation_phase_milliseconds", { event: label, phase: "queue" }, waitMs);
      if (waitMs > maxWaitMs) {
        throw Object.assign(new Error("等待操作超时，请重试。"), { code: "SERVER_BUSY" });
      }
      return operation();
    }).finally(() => {
      metrics.observe?.("jade_operation_milliseconds", { event: label }, performance.now() - enqueuedAt);
      pending -= 1;
      metrics.set?.("jade_mutation_queue_depth", {}, pending);
      if (key) coalesced.delete(key);
    });
    tail = scheduled.catch(() => {});
    if (key) coalesced.set(key, scheduled);
    return scheduled;
  }


  function wrapSocket(socket) {
    if (!socket || socket[RAW_SOCKET_EMIT]) return socket;
    const rawEmit = socket.emit.bind(socket);
    Object.defineProperty(socket, RAW_SOCKET_EMIT, { value: rawEmit });
    socket.emit = (event, ...args) => {
      const transaction = storage.getStore();
      if (!transaction) return rawEmit(event, ...args);
      transaction.effects.push(() => rawEmit(event, ...args));
      return true;
    };
    return socket;
  }

  function run(label, operation, options = {}) {
    const execute = async () => {
      const startedAt = performance.now();
      const savedAt = Date.now();
      let scope = null;
      let before = null;
      let computeRecorded = false;
      const transaction = {
        label: String(label || "mutation"),
        effects: [],
        effectKeys: new Set(),
        summary: null
      };
      let cancelAudit = null;
      try {
        scope = world.beginMutation?.(savedAt);
        before = scope ? null : world.exportSnapshot({ savedAt });
        const result = await storage.run(transaction, () => scope ? scope.run(operation) : operation());
        const snapshots = scope ? scope.snapshots() : { before, after: world.exportSnapshot({ savedAt }) };
        before = snapshots.before;
        const after = snapshots.after;
        const delta = createWorldDelta(before, after, {
          savedAt, action: transaction.label, actorId: options.actorId || null, requestId: options.requestId || null
        });
        const shouldPersist = worldDeltaHasChanges(delta);
        metrics.observe?.("jade_operation_phase_milliseconds", { event: transaction.label, phase: "compute" }, performance.now() - startedAt);
        computeRecorded = true;
        if (shouldPersist) {
          if (options.audit !== false && typeof recordAudit === "function") {
            cancelAudit = recordAudit({
              actorType: options.actorType || "player", actorId: options.actorId || null,
              action: transaction.label, requestId: options.requestId || null,
              outcome: "committed", metadata: options.metadata || {}
            });
          }
          transaction.summary = {
            action: transaction.label,
            changedPlayerIds: delta.players.upsert.map(([playerId]) => String(playerId)),
            removedPlayerIds: delta.players.remove.map(String),
            changedWorldKeys: Object.keys(delta.world),
            removedWorldKeys: [...delta.removeWorldKeys]
          };
          const commitStarted = performance.now();
          try {
            await flush({
              beforeSnapshot: before,
              snapshot: after,
              delta,
              savedAt,
              action: transaction.label,
              actorId: options.actorId || null,
              requestId: options.requestId || null
            });
          } finally {
            metrics.observe?.("jade_operation_phase_milliseconds", { event: transaction.label, phase: "commit" }, performance.now() - commitStarted);
          }
        }
        for (const effect of transaction.effects) {
          try {
            effect(transaction.summary);
          } catch (error) {
            metrics.increment("jade_durable_effect_failures_total", { event: transaction.label });
            logger.error?.(
              { event: transaction.label, error: error?.message || error },
              "post-commit network effect failed"
            );
          }
        }
        const elapsedMs = performance.now() - startedAt;
        metrics.increment("jade_durable_mutations_total", {
          event: transaction.label,
          outcome: shouldPersist ? "committed" : "unchanged"
        });
        metrics.increment("jade_durable_mutation_milliseconds_total", { event: transaction.label }, elapsedMs);
        return result;
      } catch (error) {
        if (typeof cancelAudit === "function") cancelAudit();
        if (scope) scope.rollback();
        else if (before) restoreWorld(world, before, [...world.raw.sockets.entries()]);
        try {
          onRollback?.();
        } catch (rollbackError) {
          logger.error?.(
            { event: transaction.label, error: rollbackError?.message || rollbackError },
            "durable rollback cleanup failed"
          );
        }
        metrics.increment("jade_durable_mutations_total", { event: transaction.label, outcome: "rolled_back" });
        logger.error?.({ event: transaction.label, error: error?.message || error }, "durable mutation rolled back");
        throw error;
      } finally {
        if (!computeRecorded) metrics.observe?.("jade_operation_phase_milliseconds", { event: transaction.label, phase: "compute" }, performance.now() - startedAt);
      }
    };
    return queue(execute, options.key || null, String(label || "mutation"));
  }

  function wrapSocketRegistration(socket, mutationEvents) {
    if (!socket || socket[SOCKET_REGISTRATION_WRAPPED]) return socket;
    wrapSocket(socket);
    const rawOn = socket.on.bind(socket);
    Object.defineProperty(socket, SOCKET_REGISTRATION_WRAPPED, { value: true });
    socket.on = (event, listener) => {
      if (!mutationEvents.has(String(event)) || typeof listener !== "function") {
        return rawOn(event, listener);
      }
      return rawOn(event, (...args) => {
        const originalAck = [...args].reverse().find((entry) => typeof entry === "function");
        const deferredArgs = args.map((entry) => {
          if (typeof entry !== "function") return entry;
          return (...ackArgs) => {
            const transaction = storage.getStore();
            if (transaction) transaction.effects.push(() => entry(...ackArgs));
            else entry(...ackArgs);
          };
        });
        const payload = args[0] && typeof args[0] === "object" && !Array.isArray(args[0]) ? args[0] : {};
        run(event, () => {
          if (socket.connected === false || (validateSocket && !validateSocket(socket))) {
            throw Object.assign(new Error("身份已失效，请重新登录。"), { code: "SESSION_REQUIRED" });
          }
          return listener(...deferredArgs);
        }, {
          actorType: "player",
          actorId: world.raw.sockets.get(String(socket.id || "")) || null,
          requestId: payload.requestId || null
        }).catch((error) => {
          const code = ["SERVER_BUSY", "SESSION_REQUIRED"].includes(error.code) ? error.code : "PERSISTENCE_FAILED";
          const message = code === "PERSISTENCE_FAILED" ? "操作未能安全保存，资产状态已恢复，请重试。" : error.message;
          socket[RAW_SOCKET_EMIT]?.("toast", message);
          if (typeof originalAck === "function") {
            originalAck({ ok: false, code, message });
          }
          logger.warn?.({ event, error: error?.message || error }, "socket mutation persistence failed");
        });
      });
    };
    return socket;
  }

  function deferEffect(effect, key = null) {
    const transaction = storage.getStore();
    if (!transaction || typeof effect !== "function") return false;
    if (key && transaction.effectKeys.has(key)) return true;
    if (key) transaction.effectKeys.add(key);
    transaction.effects.push((summary) => effect(summary));
    return true;
  }

  async function drain() {
    await tail;
  }

  async function close() {
    closed = true;
    await drain();
  }

  return {
    wrapSocket,
    wrapSocketRegistration,
    deferEffect,
    run,
    read: (operation, options = {}) => queue(operation, options.key || null, options.label || options.key || "read"),
    checkpoint: (operation) => queue(operation, "checkpoint", "checkpoint"),
    drain,
    close,
    rawSocketEmitSymbol: RAW_SOCKET_EMIT
  };
}
