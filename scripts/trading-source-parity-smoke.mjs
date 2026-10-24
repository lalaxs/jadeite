import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "acorn";
const sources = JSON.parse(readFileSync("scripts/fixtures/trading-service-baseline/sources.json", "utf8"));
const options = { ecmaVersion: "latest", sourceType: "module" };
const semantic = value => Array.isArray(value) ? value.map(semantic) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !["start", "end", "raw"].includes(key)).map(([key, val]) => [key, semantic(val)])) : value;
function allFunctions(node, output = []) {
  if (!node || typeof node !== "object") return output;
  if (node.type === "FunctionDeclaration") output.push(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => allFunctions(child, output));
    else if (value && typeof value === "object") allFunctions(value, output);
  }
  return output;
}
function declarations(node, output = []) {
  if (!node || typeof node !== "object") return output;
  if (node.type === "VariableDeclarator") output.push(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => declarations(child, output));
    else if (value && typeof value === "object") declarations(value, output);
  }
  return output;
}
let functions = 0, constants = 0;
for (const [file, original] of Object.entries(sources)) {
  if (file.endsWith("index.js")) continue;
  const implementation = file.startsWith("blackmarket/") ? file.replace("blackmarket/", "blackmarket/instances/")
    : file.replace(/(?:-service)?\.js$/, "-instance.js");
  const implementationTree = parse(readFileSync(`server/services/${implementation}`, "utf8"), options);
  const actual = allFunctions(implementationTree);
  const variables = declarations(implementationTree);
  for (const statement of parse(original, options).body) {
    const node = statement.declaration || statement;
    if (node.type !== "FunctionDeclaration" || /^bind/.test(node.id.name) || node.id.name === "requireApi") continue;
    assert.ok(actual.some(candidate => candidate.id.name === node.id.name && JSON.stringify(semantic(candidate)) === JSON.stringify(semantic(node))),
      `${file}:${node.id.name}: function body, parameters, defaults or effect order changed`);
    functions++;
  }
  for (const statement of parse(original, options).body) {
    const node = statement.declaration || statement;
    if (node.type !== "VariableDeclaration" || node.kind !== "const") continue;
    for (const declaration of node.declarations) {
      assert.ok(variables.some(candidate => JSON.stringify(semantic(candidate)) === JSON.stringify(semantic(declaration))), `${file}:${declaration.id.name}: original rule/configuration initializer changed`);
      constants++;
    }
  }
}
console.log(`trading-source-parity-smoke: ${functions} original function bodies/defaults and ${constants} constant initializers preserved across three services and reward hooks`);
