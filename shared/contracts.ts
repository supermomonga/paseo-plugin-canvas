import { defineRpc, defineSubscription } from "@getpaseo/plugin";
import { documentSchema } from "./document";
import { z } from "zod";

export const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
export const titleSchema = z.string().trim().min(1).max(240);
export const contentSchema = z.string().max(1_000_000);
export const editorSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user") }).strict(),
  z.object({ role: z.literal("agent"), agentId: idSchema }).strict(),
]);
export type Editor = z.infer<typeof editorSchema>;
export const metadataSchema = z
  .object({
    schemaVersion: z.literal(2),
    workspaceId: idSchema,
    canvasId: idSchema,
    title: titleSchema,
    revision: z.number().int().positive().safe(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    updatedBy: editorSchema,
  })
  .strict();
export const publicLockSchema = z.object({
  id: z.string(),
  owner: editorSchema,
  ownerTitle: z.string().nullable(),
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
export const listCanvases = defineRpc({
  name: "canvas.list",
  input: z.object({ workspaceId: idSchema }),
  output: listResultSchema,
});
export const recentCanvasSchema = canvasSummarySchema.extend({
  workspaceName: z.string(),
});
export type RecentCanvas = z.infer<typeof recentCanvasSchema>;
// Most recently updated canvases across the host's active workspaces.
export const recentCanvases = defineRpc({
  name: "canvas.recent",
  input: z.object({ limit: z.number().int().min(1).max(50) }),
  output: z.object({ items: z.array(recentCanvasSchema) }),
});
export const getCanvas = defineRpc({
  name: "canvas.get",
  input: z.object({ workspaceId: idSchema, canvasId: idSchema }),
  output: getResultSchema,
});
// Sends the current cursor on subscribe, then a new cursor after each committed
// or lock change. A cursor never repeats across plugin restarts.
export const watchCanvases = defineSubscription({
  name: "canvas.watch",
  input: z.object({ workspaceId: idSchema }),
  event: z.object({ cursor: z.string().max(100) }),
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
export type UserActor = {
  role: "user";
  workspaceId: string;
  sessionId: string;
};
export type EditActor = Actor | UserActor;
export function actorEditor(actor: EditActor): Editor {
  return "role" in actor
    ? { role: "user" }
    : { role: "agent", agentId: idSchema.parse(actor.agentId) };
}
export const editInputSchema = z
  .object({
    canvasId: idSchema,
    lockToken: z.string().min(1),
    expectedRevision: z.number().int().positive().safe(),
  })
  .strict();
