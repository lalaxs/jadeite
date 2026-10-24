// Own only this feature's registrations and in-flight UI acknowledgements.
// Disposing a view does not cancel an authoritative server command.
export function createWorkshopScope({ socket, registerAction }) {
  let active = false;
  let generation = 0;
  const cleanups = [];
  const pending = new Set();

  function register(name, handler) {
    const owner = generation;
    const guarded = (...args) => active && owner === generation ? handler(...args) : undefined;
    const registration = registerAction?.(name, guarded);
    if (typeof registration === "function") cleanups.push(registration);
    else if (typeof registration?.off === "function") cleanups.push(() => registration.off(name, guarded));
  }

  const scopedSocket = socket && {
    on(name, handler) {
      const owner = generation;
      const guarded = (...args) => { if (active && owner === generation) handler(...args); };
      socket.on?.(name, guarded);
      cleanups.push(() => socket.off?.(name, guarded));
      return this;
    },
    emit(name, ...args) {
      if (!active) return this;
      const index = args.findIndex(value => typeof value === "function");
      if (index >= 0) {
        const acknowledge = args[index];
        let done = false;
        const finish = (...result) => {
          if (done) return;
          done = true;
          pending.delete(finish);
          acknowledge(...result);
        };
        pending.add(finish);
        args[index] = finish;
      }
      return socket.emit(name, ...args);
    }
  };

  function dispose() {
    active = false;
    generation++;
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    // Delivery request callbacks clear their own bounded timeout when resolved.
    for (const finish of pending) finish({ ok: false, code: "FEATURE_DISPOSED" });
    pending.clear();
  }

  return { activate() { active = true; }, registerAction: register, socket: scopedSocket, dispose };
}
