import { z } from "zod";
import { defineContract } from "paseo-plugin-helper/shared";
import {
  canvasSchema,
  contentSchema,
  editStateSchema,
  idSchema,
  titleSchema,
} from "./contracts";
import { documentSchema } from "./document";
const target = z.object({ workspaceId: idSchema, canvasId: idSchema }).strict();
const lease = target.extend({ lockToken: z.string().min(1) });
const revision = z.number().int().positive().safe();
const failure = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
});
const result = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }),
    failure,
  ]);
const saved = z.object({ canvasId: idSchema, revision });
export const createUserCanvas = defineContract({
  name: "canvas.user.create",
  input: z
    .object({
      workspaceId: idSchema,
      title: titleSchema,
      content: contentSchema.refine((v) => v.trim().length > 0),
    })
    .strict(),
  output: result(saved),
});
export const beginCanvasEdit = defineContract({
  name: "canvas.user.begin",
  input: target,
  output: result(z.object({ canvas: canvasSchema, lockToken: z.string() })),
});
export const renewCanvasEdit = defineContract({
  name: "canvas.user.renew",
  input: lease,
  output: result(z.object({ editState: editStateSchema })),
});
export const cancelCanvasEdit = defineContract({
  name: "canvas.user.cancel",
  input: lease,
  output: result(z.object({ editState: editStateSchema })),
});
export const saveCanvasEdit = defineContract({
  name: "canvas.user.save",
  input: lease.extend({
    expectedRevision: revision,
    title: titleSchema,
    content: contentSchema,
  }),
  output: result(saved),
});
export const deleteUserCanvas = defineContract({
  name: "canvas.user.delete",
  input: target.extend({ expectedRevision: revision }),
  output: result(z.object({ deleted: z.literal(true) })),
});
export const previewCanvasDraft = defineContract({
  name: "canvas.user.preview",
  input: z.object({ content: contentSchema }).strict(),
  output: z.object({ document: documentSchema }),
});
