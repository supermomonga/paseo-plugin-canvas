import { z } from "zod";
import { defineContract } from "paseo-plugin-helper/shared";
import { idSchema, titleSchema } from "./contracts";

export const canvasActivitySchema = z.object({
  workspaceId: idSchema,
  canvasId: idSchema,
  title: titleSchema,
  revision: z.number().int().positive().safe(),
  action: z.enum(["created", "updated"]),
  warningCount: z.number().int().nonnegative(),
  savedAt: z.iso.datetime(),
});
export type CanvasActivity = z.infer<typeof canvasActivitySchema>;
export const syncCanvasActivity = defineContract({
  name: "canvas.sync_activity",
  input: z.object({ cursor: z.string().max(100).nullable() }),
  output: z.object({ cursor: z.string() }),
});
