// Merge committed updates over a short window, then read behind the same
// transaction queue. Private roots from every merged commit remain included.
export function createBroadcastScheduler(read, send) {
  let pending = null;
  let timer = null;
  return (options) => {
    const ids = options.privatePlayerIds || options.mutationSummary?.changedPlayerIds;
    if (!pending) pending = { ids: new Set(), allPrivate: false, catalogs: false };
    if (!ids) pending.allPrivate = true;
    for (const id of ids || []) pending.ids.add(String(id));
    pending.catalogs ||= options.includeStaticCatalogs === true;
    if (timer) return;
    timer = setTimeout(() => {
      const batch = pending;
      pending = null;
      timer = null;
      read(() => send({ immediate: true, scheduled: true,
        includeStaticCatalogs: batch.catalogs,
        ...(batch.allPrivate ? {} : { privatePlayerIds: [...batch.ids] })
      })).catch(() => {});
    }, 25);
    timer.unref?.();
  };
}
