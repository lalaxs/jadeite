import { existsSync, readFileSync } from "node:fs";

// Source-only checks follow moved responsibilities. Runtime differential tests
// compare the actual original service and the actual composition independently.
export function readWorkshopServiceSource() {
  const root = "server/services/";
  const files = ["workshop-service.js", ...["inventory", "queries", "products", "commands", "completion", "runtime"].map(name => `workshop/${name}.js`)];
  return files.filter(file => existsSync(root + file)).map(file => readFileSync(root + file, "utf8")).join("\n");
}
