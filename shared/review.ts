import { z } from "zod";
import { defineContract } from "paseo-plugin-helper/shared";
import { idSchema } from "./contracts";
import { documentSchema } from "./document";

const revision = z.number().int().safe().nonnegative();
const date = z.iso.datetime();
const body = z.string().trim().min(1).max(20_000);
export const selectionRangeSchema = z
  .object({
    kind: z.literal("block"),
    start: revision,
    end: revision,
    selectedText: z.string().min(1).max(1_000_000),
  })
  .strict()
  .refine((v) => v.end > v.start, "Select a nonempty range");
const orderedRanges = (ranges: { start: number; end: number }[]) =>
  ranges.every((range, i) => i === 0 || ranges[i - 1].end <= range.start);
export const selectionSchema = z
  .object({
    documentRevision: revision,
    ranges: z
      .array(selectionRangeSchema)
      .min(1)
      .refine(
        orderedRanges,
        "Select distinct, nonoverlapping elements in document order",
      ),
  })
  .strict();
export const anchorRangeSchema = selectionRangeSchema.safeExtend({
  sourceText: z.string(),
  prefix: z.string(),
  suffix: z.string(),
});
export const anchorSchema = z
  .object({
    id: idSchema,
    documentRevision: revision,
    ranges: z
      .array(anchorRangeSchema)
      .min(1)
      .refine(orderedRanges, "Anchor ranges must be distinct and ordered"),
    createdAt: date,
  })
  .strict();
export const messageSchema = z
  .object({
    id: idSchema,
    revision,
    author: z.discriminatedUnion("role", [
      z.object({ role: z.literal("user") }).strict(),
      z
        .object({
          role: z.literal("agent"),
          agentId: idSchema,
          name: z.string().nullable(),
        })
        .strict(),
    ]),
    kind: z.enum(["comment", "question", "explanation", "applied"]),
    body,
    createdAt: date,
    updatedAt: date,
    requestId: idSchema.nullable(),
    documentRevision: revision.nullable(),
  })
  .strict();
export const threadSchema = z
  .object({
    id: idSchema,
    revision,
    createdAt: date,
    updatedAt: date,
    status: z.enum(["needs_agent_review", "needs_user_review", "resolved"]),
    assignedAgentId: idSchema.nullable(),
    currentRequestId: idSchema.nullable(),
    currentAnchorId: idSchema,
    anchors: z.array(anchorSchema).min(1),
    messages: z.array(messageSchema).min(1),
  })
  .strict();
export const deliverySchema = z
  .object({
    id: idSchema,
    agentId: idSchema,
    createdAt: date,
    prompt: z.string(),
    threads: z
      .array(
        z
          .object({
            threadId: idSchema,
            threadRevision: revision,
            anchor: anchorSchema,
            messages: z.array(messageSchema),
          })
          .strict(),
      )
      .min(1),
    attempts: z
      .array(
        z
          .object({
            id: idSchema,
            status: z.enum(["sending", "accepted", "failed", "unknown"]),
            startedAt: date,
            finishedAt: date.nullable(),
            error: z.string().nullable(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export const reviewStateSchema = z
  .object({
    schemaVersion: z.literal(2),
    workspaceId: idSchema,
    canvasId: idSchema,
    revision,
    createdAt: date,
    updatedAt: date,
    snapshots: z.record(
      z.string().regex(/^[1-9]\d*$/),
      z
        .object({
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          title: z.string(),
        })
        .strict(),
    ),
    threads: z.record(idSchema, threadSchema),
    deliveries: z.record(idSchema, deliverySchema),
  })
  .strict();
export const rangeProjectionSchema = z
  .object({
    start: revision.nullable(),
    end: revision.nullable(),
    reason: z.string().nullable(),
  })
  .strict();
export const projectionSchema = z
  .object({
    ranges: z.array(rangeProjectionSchema).min(1),
  })
  .strict();
export const reviewResultSchema = z.object({
  state: reviewStateSchema,
  documentRevision: revision,
  projections: z.record(idSchema, projectionSchema),
  messageDocuments: z.record(idSchema, documentSchema),
});
const scope = z.object({ workspaceId: idSchema, canvasId: idSchema }).strict();
const threadInput = { threadId: idSchema, expectedRevision: revision };
export const reviewMutationSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("create"), selection: selectionSchema, body })
    .strict(),
  z.object({ action: z.literal("reply"), ...threadInput, body }).strict(),
  z
    .object({
      action: z.literal("edit"),
      ...threadInput,
      messageId: idSchema,
      body,
    })
    .strict(),
  z
    .object({
      action: z.literal("delete"),
      ...threadInput,
      messageId: idSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("status"),
      ...threadInput,
      resolved: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("reattach"),
      ...threadInput,
      selection: selectionSchema,
    })
    .strict(),
]);
export const getReviews = defineContract({
  name: "canvas.review.get",
  input: scope,
  output: reviewResultSchema,
});
export const mutateReview = defineContract({
  name: "canvas.review.mutate",
  input: scope.extend({ mutation: reviewMutationSchema }),
  output: reviewResultSchema,
});
export const recipientSchema = z.object({
  id: idSchema,
  title: z.string(),
  running: z.boolean(),
  blocked: z.boolean(),
});
export const getReviewRecipients = defineContract({
  name: "canvas.review.recipients",
  input: z.object({ workspaceId: idSchema }),
  output: z.array(recipientSchema),
});
export const sendReview = defineContract({
  name: "canvas.review.send",
  input: scope.extend({
    agentId: idSchema,
    threads: z.array(z.object(threadInput)).min(1).max(50),
    allowInterrupt: z.boolean(),
  }),
  output: deliverySchema,
});
export const retryReview = defineContract({
  name: "canvas.review.retry",
  input: scope.extend({ requestId: idSchema, allowInterrupt: z.boolean() }),
  output: deliverySchema,
});
export const agentReplySchema = z
  .object({
    canvasId: idSchema,
    threadId: idSchema,
    expectedRevision: revision,
    requestId: idSchema,
    kind: z.enum(["question", "explanation", "applied"]),
    body,
    documentRevision: revision.optional(),
  })
  .strict();
export type ReviewState = z.infer<typeof reviewStateSchema>;
export type ReviewThread = z.infer<typeof threadSchema>;
export type ReviewMessage = z.infer<typeof messageSchema>;
export type ReviewAnchorRange = z.infer<typeof anchorRangeSchema>;
export type ReviewRangeProjection = z.infer<typeof rangeProjectionSchema>;
export type ReviewAnchor = z.infer<typeof anchorSchema>;
export type ReviewSelection = z.infer<typeof selectionSchema>;
export type ReviewMutation = z.infer<typeof reviewMutationSchema>;
export type ReviewDelivery = z.infer<typeof deliverySchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;
export type ReviewProjection = z.infer<typeof projectionSchema>;
export function messageLocked(state: ReviewState, id: string) {
  return Object.values(state.deliveries).some(
    (d) =>
      d.attempts.some((a) => a.status !== "failed") &&
      d.threads.some((t) => t.messages.some((m) => m.id === id)),
  );
}
export function unsentMessages(state: ReviewState, thread: ReviewThread) {
  return thread.messages.filter(
    (m) => m.author.role === "user" && !messageLocked(state, m.id),
  );
}
