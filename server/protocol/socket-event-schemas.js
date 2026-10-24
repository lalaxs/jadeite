import { z } from "zod";
import { MUTATION_SOCKET_EVENTS } from "../../shared/protocol/mutation-events.js";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9:._-]{8,128}$/;
const requestIdSchema = z.string().regex(REQUEST_ID_PATTERN, "操作缺少有效请求编号");
const identifierFields = new Set([
  "id", "playerId", "roughId", "materialId", "itemId", "listingId", "wantId",
  "offerId", "orderId", "stallId", "workerId", "minerId", "facilityId", "jobId",
  "kitId", "parentId", "deviceId", "hallId", "versionId", "specializationId", "modelKey"
]);
const numericFieldPattern = /(?:amount|price|budget|cost|fee|count|quantity|index|rating|level|cash)$|^(?:x|y)$/i;

function validateCommonFields(payload, context) {
  for (const [key, value] of Object.entries(payload)) {
    if (value == null) continue;
    if (identifierFields.has(key) || /Id$/.test(key)) {
      if (typeof value !== "string" || value.length < 1 || value.length > 128) {
        context.addIssue({ code: "custom", path: [key], message: `${key} 格式无效` });
      }
    }
    if (numericFieldPattern.test(key)) {
      const numeric = typeof value === "number"
        ? value
        : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
      if (!Number.isFinite(numeric) || Math.abs(numeric) > 1_000_000_000_000) {
        context.addIssue({ code: "custom", path: [key], message: `${key} 数值无效` });
      }
    }
  }
}

function baseMutationSchema(requireRequestId) {
  return z.object({
    requestId: requireRequestId ? requestIdSchema : requestIdSchema.optional()
  }).passthrough().superRefine(validateCommonFields);
}

function setNameSchema(requireRequestId) {
  return baseMutationSchema(requireRequestId).and(z.object({
    name: z.string().trim().min(1).max(10).optional(),
    value: z.string().trim().min(1).max(10).optional()
  }).passthrough().refine((payload) => payload.name != null || payload.value != null, {
    message: "名称不能为空"
  }));
}

function worldChatSchema(requireRequestId) {
  return baseMutationSchema(requireRequestId).and(z.object({
    text: z.string().trim().min(1, "消息不能为空").max(120, "消息最多 120 字")
  }).passthrough());
}

function workshopDeliverySchema(requireRequestId, reveal = false) {
  return z.object({
    requestId: requireRequestId ? requestIdSchema : requestIdSchema.optional(),
    deliveryId: z.string().trim().min(1).max(128),
    ...(reveal ? { itemIds: z.array(z.string().trim().min(1).max(128)).min(1).max(32).optional() } : {})
  }).strict().superRefine(validateCommonFields);
}

function payrollPaymentSchema(requireRequestId) {
  return z.object({ requestId: requireRequestId ? requestIdSchema : requestIdSchema.optional(),
    amount: z.number().int().positive().max(1_000_000_000_000) }).strict();
}

function commissionSchema(requireRequestId, claim = false) {
  const field = claim ? "commissionId" : "offerId";
  return z.object({
    requestId: requireRequestId ? requestIdSchema : requestIdSchema.optional(),
    [field]: z.string().trim().min(1).max(128)
  }).strict().superRefine(validateCommonFields);
}

const schemaFactories = new Map([
  ["setName", setNameSchema],
  ["sendWorldChat", worldChatSchema],
  ["payEmployeePayroll", payrollPaymentSchema],
  ["revealWorkshopDelivery", (required) => workshopDeliverySchema(required, true)],
  ["claimWorkshopDelivery", workshopDeliverySchema],
  ["startCommission", (required) => commissionSchema(required)],
  ["claimCommission", (required) => commissionSchema(required, true)]
]);

export function validateSocketEventPayload(event, payload, { requireRequestId = false } = {}) {
  if (!MUTATION_SOCKET_EVENTS.has(String(event || ""))) return { success: true, data: payload };
  const schema = (schemaFactories.get(event) || baseMutationSchema)(requireRequestId);
  return schema.safeParse(payload);
}

export function socketPayloadError(result, event = "") {
  if (result?.error?.issues?.some((issue) => issue.path?.[0] === "requestId")) {
    return "操作缺少有效请求编号";
  }
  if (event === "sendWorldChat") return "消息不能为空或格式无效。";
  if (event === "setName") return "名称不能为空或格式无效。";
  return result?.error?.issues?.[0]?.message || "请求格式无效。";
}
