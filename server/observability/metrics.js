import { monitorEventLoopDelay } from "node:perf_hooks";
export const DURATION_BUCKETS_MS = Object.freeze([0.1, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000]);
function metricKey(name, labels = {}) {
  const pairs = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return `${name}|${pairs.map(([key, value]) => `${key}=${String(value)}`).join(",")}`;
}

function escapeLabel(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

export function createMetrics() {
  const counters = new Map();
  const gauges = new Map();
  const histograms = new Map();
  const startedAt = Date.now();
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  eventLoopDelay.enable();

  function increment(name, labels = {}, amount = 1) {
    const key = metricKey(name, labels);
    const current = counters.get(key) || { name, labels, value: 0 };
    current.value += Number(amount) || 0;
    counters.set(key, current);
  }

  function set(name, labels = {}, value = 0) {
    gauges.set(metricKey(name, labels), { name, labels, value: Number(value) || 0 });
  }

  function observe(name, labels = {}, value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return;
    const key = metricKey(name, labels);
    const histogram = histograms.get(key) || {
      name, labels: { ...labels }, count: 0, sum: 0, buckets: DURATION_BUCKETS_MS.map(() => 0)
    };
    histogram.count++;
    histogram.sum += numeric;
    for (let i = 0; i < DURATION_BUCKETS_MS.length; i++) {
      if (numeric <= DURATION_BUCKETS_MS[i]) histogram.buckets[i]++;
    }
    histograms.set(key, histogram);
  }

  function renderRow(row) {
    const labels = Object.entries(row.labels || {});
    const suffix = labels.length
      ? `{${labels.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`
      : "";
    return `${row.name}${suffix} ${row.value}`;
  }

  function render() {
    const rows = [
      { name: "jade_process_resident_memory_bytes", labels: {}, value: process.memoryUsage().rss },
      { name: "jade_event_loop_delay_p99_milliseconds", labels: {}, value: eventLoopDelay.percentile(99) / 1_000_000 },
      { name: "jade_server_uptime_seconds", labels: {}, value: Math.floor((Date.now() - startedAt) / 1000) },
      ...gauges.values(),
      ...counters.values()
    ];
    eventLoopDelay.reset();
    const output = rows.map(renderRow);
    const declaredTypes = new Set();
    for (const histogram of histograms.values()) {
      if (!declaredTypes.has(histogram.name)) {
        output.push(`# TYPE ${histogram.name} histogram`);
        declaredTypes.add(histogram.name);
      }
      for (let i = 0; i < DURATION_BUCKETS_MS.length; i++) output.push(renderRow({
        name: `${histogram.name}_bucket`, labels: { ...histogram.labels, le: DURATION_BUCKETS_MS[i] }, value: histogram.buckets[i]
      }));
      output.push(renderRow({ name: `${histogram.name}_bucket`, labels: { ...histogram.labels, le: "+Inf" }, value: histogram.count }));
      output.push(renderRow({ name: `${histogram.name}_sum`, labels: histogram.labels, value: histogram.sum }));
      output.push(renderRow({ name: `${histogram.name}_count`, labels: histogram.labels, value: histogram.count }));
    }
    return `${output.join("\n")}\n`;
  }

  return { increment, set, observe, render };
}
