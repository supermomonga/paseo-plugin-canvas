import { defineContract } from "paseo-plugin-helper/shared";
import { z } from "zod";
import { idSchema } from "./contracts";
export const graphicInputSchema = z.object({
  kind: z.literal("math"),
  source: z.string().min(1).max(50_000),
  display: z.boolean(),
  foreground: z.string().regex(/^#[a-f\d]{3,8}$/i),
  background: z.string().regex(/^#[a-f\d]{3,8}$/i),
  fontSize: z.number().min(10).max(24),
});
export const imageResultSchema = z.object({
  uri: z.string().startsWith("data:image/png;base64,").max(8_000_000),
  width: z.number().positive().max(4096),
  height: z.number().positive().max(4096),
});
export const renderGraphic = defineContract({
  name: "canvas.render_graphic",
  input: graphicInputSchema,
  output: imageResultSchema,
});
export const readImage = defineContract({
  name: "canvas.read_image",
  input: z.object({ workspaceId: idSchema, src: z.string().min(1).max(4096) }),
  output: z.object({ uri: z.string().max(8_000_000) }),
});
export type GraphicInput = z.infer<typeof graphicInputSchema>;
export type GraphicImage = z.infer<typeof imageResultSchema>;
