import { defineContract } from "paseo-plugin-helper/shared";
import { documentSchema } from "./document";
import { z } from "zod";

export const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
export const titleSchema = z.string().trim().min(1).max(240);
export const contentSchema = z.string().max(1_000_000);
export const metadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceId: idSchema,
    canvasId: idSchema,
    title: titleSchema,
    revision: z.number().int().positive().safe(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    updatedByAgentId: idSchema,
  })
  .strict();
export const publicLockSchema = z.object({
  id: z.string(),
  ownerAgentId: idSchema,
  ownerAgentTitle: z.string().nullable(),
  acquiredAt: z.iso.datetime(),
  renewedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export const editStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unlocked") }),
  z.object({ status: z.literal("locked"), lock: publicLockSchema }),
]);
export const canvasSummarySchema = metadataSchema.extend({
  editState: editStateSchema,
});
export const canvasSchema = canvasSummarySchema.extend({
  content: contentSchema,
});
export const listResultSchema = z.object({
  items: z.array(canvasSummarySchema),
  observedAt: z.iso.datetime(),
});
export const getResultSchema = z.object({
  canvas: canvasSchema,
  document: documentSchema,
  observedAt: z.iso.datetime(),
});
export const listCanvases = defineContract({
  name: "canvas.list",
  input: z.object({ workspaceId: idSchema }),
  output: listResultSchema,
});
export const getCanvas = defineContract({
  name: "canvas.get",
  input: z.object({ workspaceId: idSchema, canvasId: idSchema }),
  output: getResultSchema,
});
export type Metadata = z.infer<typeof metadataSchema>;
export type EditState = z.infer<typeof editStateSchema>;
export type PublicLock = z.infer<typeof publicLockSchema>;
export type Canvas = z.infer<typeof canvasSchema>;
export type CanvasSummary = z.infer<typeof canvasSummarySchema>;
export type Actor = {
  agentId: string;
  workspaceId: string;
  title: string | null;
  sessionId: string;
};
export const editInputSchema = z
  .object({
    canvasId: idSchema,
    lockToken: z.string().min(1),
    expectedRevision: z.number().int().positive().safe(),
  })
  .strict();
