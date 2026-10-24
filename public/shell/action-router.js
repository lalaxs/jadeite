/**
 * Client data-action router — feature modules register handlers; shell only dispatches.
 * Handler signature: (ctx) => void
 * ctx: { action, payload, target, event, socket, getState }
 */

export function createActionRouter() {
  const handlers = new Map();

  return {
    on(name, handler) {
      if (!name || typeof handler !== "function") return this;
      handlers.set(String(name), handler);
      return this;
    },

    off(name, handler) {
      const key = String(name || "");
      if (!handler || handlers.get(key) === handler) handlers.delete(key);
      return this;
    },

    register(map = {}) {
      for (const [name, handler] of Object.entries(map)) {
        this.on(name, handler);
      }
      return this;
    },

    dispatch(action, ctx = {}) {
      const handler = handlers.get(String(action || ""));
      if (!handler) return false;
      handler(ctx);
      return true;
    },

    has(action) {
      return handlers.has(String(action || ""));
    },

    list() {
      return [...handlers.keys()].sort();
    }
  };
}
