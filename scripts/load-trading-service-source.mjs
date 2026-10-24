import { existsSync, readFileSync } from "node:fs";

// Static checks follow moved implementations; runtime tests use actual factories.
export function readTradingServiceSource(file) {
  const implementation = file.startsWith("blackmarket/")
    ? file.replace("blackmarket/", "blackmarket/instances/")
    : file.replace("-service.js", "-instance.js");
  return [file, implementation].filter((name, index, all) => all.indexOf(name) === index)
    .filter(name => existsSync(`server/services/${name}`))
    .map(name => readFileSync(`server/services/${name}`, "utf8")).join("\n");
}
