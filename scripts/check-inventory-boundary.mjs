import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { parse } from "acorn";

const buckets = new Set(["rough", "materials", "slices", "bracelets", "collection"]);
const mutators = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"]);
const propertyName = node => node?.computed ? node.property?.value : node?.property?.name;

export function assertInventoryBoundary() {
  const files = [];
  function list(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory() && file !== "server/persistence") list(file);
      else if (entry.isFile() && file.endsWith(".js")) files.push(file);
    }
  }
  list("server");
  const violations = [];
  for (const file of files) {
    // Snapshot projections own their arrays; player normalization owns saved-data transforms.
    if (["server/services/inventory-items.js", "server/services/snapshot-public.js"].includes(file)) continue;
    const source = readFileSync(file, "utf8");
    const ast = parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });

    function lookup(scope, name) {
      for (let current = scope; current; current = current.parent) {
        if (current.variables.has(name)) return current.variables.get(name);
      }
      return null;
    }
    function bucketKey(node, scope) {
      if (!node) return false;
      if (node.type === "Literal") return buckets.has(node.value);
      if (node.type === "Identifier") return bucketKey(lookup(scope, node.name), scope);
      if (node.type === "CallExpression") return ["wantBucketName", "inventoryBucketName"].includes(node.callee.name);
      return node.type === "MemberExpression" && ["bucket", "bucketName"].includes(propertyName(node));
    }
    function inventoryArray(node, scope, seen = new Set()) {
      if (!node || seen.has(node)) return false;
      seen.add(node);
      if (node.type === "Identifier") return inventoryArray(lookup(scope, node.name), scope, seen);
      if (node.type === "LogicalExpression" || node.type === "ConditionalExpression") {
        return inventoryArray(node.left || node.consequent, scope, seen) || inventoryArray(node.right || node.alternate, scope, seen);
      }
      return node.type === "MemberExpression"
        && (buckets.has(propertyName(node)) || (node.computed && bucketKey(node.property, scope)));
    }
    function visit(node, scope) {
      if (!node || typeof node !== "object") return;
      if (["Program", "BlockStatement", "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) {
        scope = { parent: scope, variables: new Map(), name: node.id?.name || scope?.name };
      }
      if (node.type === "VariableDeclarator" && node.id.type === "Identifier") scope.variables.set(node.id.name, node.init);
      const migratedPlayer = file === "server/services/player-service.js" && scope.name === "normalizePlayer";
      if (!migratedPlayer) {
        const write = node.type === "AssignmentExpression" || node.type === "UpdateExpression";
        const target = node.left || node.argument;
        const changesArray = write && target?.type === "MemberExpression"
          && (inventoryArray(target, scope) || inventoryArray(target.object, scope));
        const callsMutator = node.type === "CallExpression" && node.callee.type === "MemberExpression"
          && mutators.has(propertyName(node.callee)) && inventoryArray(node.callee.object, scope);
        if (changesArray || callsMutator) violations.push(`${file}:${node.loc.start.line}: ${source.slice(node.start, node.end).split("\n")[0]}`);
      }
      for (const [key, value] of Object.entries(node)) {
        if (["loc", "start", "end"].includes(key)) continue;
        if (Array.isArray(value)) value.forEach(child => visit(child, scope));
        else if (value && typeof value === "object") visit(value, scope);
      }
    }
    visit(ast, null);
  }
  assert.deepEqual(violations, [], `Runtime inventory writes must use inventory-items.js:\n${violations.join("\n")}`);
  return files.length;
}
