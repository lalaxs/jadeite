import assert from "node:assert/strict";
import { createActionRouter } from "../public/shell/action-router.js";
import { createWorkshopScope } from "../public/features/workshop/scope.js";

const actions = createActionRouter();
const listeners = new Map();
const acknowledgements = [];
const socket = {
  on(name, fn) { listeners.set(name, fn); },
  off(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
  emit(name, payload, ack) { acknowledgements.push(ack); }
};
let registeredAction;
const scope = createWorkshopScope({ socket, registerAction: (name, fn) => {
  registeredAction = fn;
  return actions.on(name, fn);
} });
scope.activate();
let actionsRun = 0, statesSeen = 0, requestFinished = 0;
scope.registerAction("openWorkshopDevice", () => actionsRun++);
scope.socket.on("state", () => statesSeen++);
actions.dispatch("openWorkshopDevice");
listeners.get("state")();
const staleAction = registeredAction, staleState = listeners.get("state");
scope.socket.emit("revealWorkshopDelivery", { deliveryId: "delivery" }, result => {
  assert.equal(result.code, "FEATURE_DISPOSED"); requestFinished++;
});
assert.equal(actionsRun, 1); assert.equal(statesSeen, 1);
scope.dispose(); scope.dispose();
assert.equal(actions.has("openWorkshopDevice"), false);
assert.equal(listeners.size, 0);
assert.equal(requestFinished, 1, "pending delivery UI requests settle exactly once so their timeout is cleared");
acknowledgements[0]({ ok: true });
assert.equal(requestFinished, 1, "a late server acknowledgement cannot finish an abandoned UI request twice");

scope.activate();
scope.registerAction("openWorkshopDevice", () => actionsRun++);
staleAction(); staleState();
assert.equal(actionsRun, 1, "disposed action stays inert after remount");
assert.equal(statesSeen, 1, "disposed subscription stays inert after remount");
const replacement = () => actionsRun += 10;
actions.on("openWorkshopDevice", replacement);
scope.dispose();
actions.dispatch("openWorkshopDevice");
assert.equal(actionsRun, 11, "stale cleanup must preserve a newer registration");
console.log("workshop-scope-smoke: action ownership, subscriptions, pending requests, late acknowledgements and idempotent cleanup ok");
