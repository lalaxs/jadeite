// Integration gate for intentionally updated business rules. The historical
// differential comparison remains available in the frozen refactor snapshot.
process.argv.push("--current-rules");
await import("./trading-equivalence-smoke.mjs");
