/**
 * Adds a stable request id to browser-originated state mutations.
 *
 * Keeping this at the socket boundary means feature modules cannot silently
 * forget idempotency metadata. Read-only events and debug helpers are left
 * untouched.
 */
import { MUTATION_SOCKET_EVENTS } from "../../shared/protocol/mutation-events.js";

export { MUTATION_SOCKET_EVENTS };

export function createMutationRequestId(event = "mutation") {
  return globalThis.crypto?.randomUUID?.()
    || `${String(event).replace(/[^a-z0-9:-]/gi, "-")}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function mutationEnvelope(event, payload, makeRequestId = createMutationRequestId) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    if (payload.requestId) return payload;
    return { ...payload, requestId: makeRequestId(event) };
  }
  return {
    value: payload,
    requestId: makeRequestId(event)
  };
}

export function installMutationRequestIds(socket, options = {}) {
  if (!socket || typeof socket.emit !== "function" || socket.__jadeMutationIdsInstalled) {
    return socket;
  }
  const events = options.events || MUTATION_SOCKET_EVENTS;
  const makeRequestId = options.makeRequestId || createMutationRequestId;
  const rawEmit = socket.emit.bind(socket);
  socket.emit = (event, ...args) => {
    if (events.has(event)) {
      const firstIsAck = typeof args[0] === "function";
      if (args.length === 0 || firstIsAck) {
        args.unshift(mutationEnvelope(event, undefined, makeRequestId));
      } else {
        args[0] = mutationEnvelope(event, args[0], makeRequestId);
      }
    }
    return rawEmit(event, ...args);
  };
  Object.defineProperty(socket, "__jadeMutationIdsInstalled", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
  return socket;
}
