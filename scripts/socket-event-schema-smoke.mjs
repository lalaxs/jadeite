import assert from "node:assert/strict";
import {
  socketPayloadError,
  validateSocketEventPayload
} from "../server/protocol/socket-event-schemas.js";

const requestId = "schema-request-001";
assert.equal(validateSocketEventPayload("setName", { requestId, name: "玉掌柜" }, {
  requireRequestId: true
}).success, true);
assert.equal(validateSocketEventPayload("setName", { requestId, name: "名字超过十个字符不能被接受" }, {
  requireRequestId: true
}).success, false);
assert.equal(validateSocketEventPayload("sendWorldChat", { requestId, text: "大家好" }, {
  requireRequestId: true
}).success, true);
assert.equal(validateSocketEventPayload("buyListing", { listingId: "listing-1" }, {
  requireRequestId: true
}).success, false);
assert.equal(validateSocketEventPayload("buyListing", {
  requestId,
  listingId: "listing-1",
  price: Number.POSITIVE_INFINITY
}, { requireRequestId: true }).success, false);
assert.match(socketPayloadError(validateSocketEventPayload("sendWorldChat", {
  requestId,
  text: ""
}, { requireRequestId: true })), /消息不能为空/);

assert.equal(validateSocketEventPayload("buyWorkshopDevice", {
  requestId, modelKey: "used-opening-1"
}, { requireRequestId: true }).success, true, "modelKey is an identifier, not a y coordinate");
assert.equal(validateSocketEventPayload("buyWorkshopDevice", {
  requestId, modelKey: 123
}, { requireRequestId: true }).success, false);
assert.equal(validateSocketEventPayload("requestWindow", {
  requestId, roughId: "rough-1", x: "not-a-number", y: 10
}, { requireRequestId: true }).success, false, "exact coordinate fields remain numeric");
assert.equal(validateSocketEventPayload("startCommission", {
  requestId, offerId: "standard", netPay: 999999
}, { requireRequestId: true }).success, false, "commission pay cannot be supplied by the client");

console.log("socket-event-schema-smoke: mutation envelopes + semantic fields ok");
