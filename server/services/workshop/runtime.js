// Legacy job normalization, per-player settlement and online/offline ticks.
import { playersMatching } from "../../persistence/mutation-scope.js";

export function createWorkshopRuntime({
  normalizePlayer,
  refreshPlayerReport,
  advanceTask,
  addNews,
  emitUiEventToPlayer,
  getState,
  isPlayerOnline,
  broadcast,
  workshopWorkerForPlayer,
  completeProductionJob
}) {
const state = new Proxy({}, {
    get(_t, prop) {
      return getState()[prop];
    },
    set(_t, prop, value) {
      getState()[prop] = value;
      return true;
    },
    has(_t, prop) {
      return prop in getState();
    }
  });

function normalizeProductionJob(job) {
  if (job?.stage && job.item) return job;
  if (job?.rough) {
    return {
      ...job,
      type: "productionJob",
      stage: "rough",
      item: job.rough,
      options: { label: "粗加工", ...(job.options || {}) }
    };
  }
  return job;
}

function settleProductionJobsForPlayer(player, now = Date.now()) {
  normalizePlayer(player);
  const events = [];
  const readyJobs = player.jobs.filter((job) => job.readyAt <= now);
  const readyLegacyJobs = player.polishingJobs.filter((job) => job.readyAt <= now);
  if (!readyJobs.length && !readyLegacyJobs.length) return events;

  player.jobs = player.jobs.filter((job) => job.readyAt > now);
  player.polishingJobs = player.polishingJobs.filter((job) => job.readyAt > now);

  for (const rawJob of [...readyJobs, ...readyLegacyJobs]) {
    const job = normalizeProductionJob(rawJob);
    if (!job?.item) continue;
    const result = completeProductionJob(player, job);
    if (!result.shattered) advanceTask(player, "workshop_craft");
    events.push({
      type: "production",
      text: result.text,
      income: 0,
      expense: 0,
      readyAt: job.readyAt,
      levelUps: result.xpResult?.levelUps || []
    });
    if (result.xpResult?.levelUps?.length) {
      const worker = workshopWorkerForPlayer(player, job.workerId);
      emitUiEventToPlayer(player, {
        type: "float",
        tone: "craft",
        text: `${worker?.name || "员工"} 技能升级`,
        x: 58,
        y: 56
      });
    }
    addNews(`${player.name} ${result.text}。`, job.stage === "rough" && result.item?.score >= 5 ? "great" : "craft");
  }

  refreshPlayerReport(player, now);
  return events;
}

function processProductionJobs(now = Date.now(), options = {}) {
  const onlineOnly = options.onlineOnly !== false;
  let changed = false;
  for (const player of playersMatching(state.players, (entry) => (!onlineOnly || isPlayerOnline(entry)) && Boolean(entry.jobs?.length || entry.polishingJobs?.length || entry.cuttingJobs?.length))) {
    normalizePlayer(player);
    if (onlineOnly && !isPlayerOnline(player)) continue;
    const events = settleProductionJobsForPlayer(player, now);
    if (events.length) changed = true;
  }
  if (changed && options.broadcast !== false) broadcast();
  return changed;
}

  return { normalizeProductionJob, settleProductionJobsForPlayer, processProductionJobs };
}
