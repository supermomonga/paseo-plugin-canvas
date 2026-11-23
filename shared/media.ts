import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { idSchema } from "./contracts";
/** Workspace and remote SVG files share the local image size limit. */
export const svgSourceLimit = 5_000_000;
export const mathInputSchema = z.object({
  kind: z.literal("math"),
  source: z.string().min(1).max(50_000),
  display: z.boolean(),
  foreground: z.string().regex(/^#[a-f\d]{3,8}$/i),
  background: z.string().regex(/^#[a-f\d]{3,8}$/i),
  fontSize: z.number().min(10).max(24),
});
export const svgInputSchema = z.object({
  kind: z.literal("svg"),
  source: z.string().min(1).max(svgSourceLimit),
});
export const graphicInputSchema = z.discriminatedUnion("kind", [
  mathInputSchema,
  svgInputSchema,
]);
/** Display size; the rasterizer bounds pixels separately. */
export const displaySizeLimit = 16_384;
export const imageResultSchema = z.object({
  uri: z.string().startsWith("data:image/png;base64,").max(8_000_000),
  width: z.number().positive().max(displaySizeLimit),
  height: z.number().positive().max(displaySizeLimit),
});
export const renderGraphic = defineRpc({
  name: "canvas.render_graphic",
  input: graphicInputSchema,
  output: imageResultSchema,
});
export const readImage = defineRpc({
  name: "canvas.read_image",
  input: z.object({ workspaceId: idSchema, src: z.string().min(1).max(4096) }),
  // Rasterized SVGs report their display size; other formats are measured by the client.
  output: z.object({
    uri: z.string().max(8_000_000),
    width: z.number().positive().max(displaySizeLimit).optional(),
    height: z.number().positive().max(displaySizeLimit).optional(),
  }),
});
/** Whether text is an SVG document: an `svg` root after an optional BOM, prolog, comments and doctype. */
export function isSvgSource(text: string) {
  // Scans forward once; a regular expression with repeated lazy groups backtracks exponentially.
  const after = (token: string, from: number) => {
    const index = from < 0 ? -1 : text.indexOf(token, from);
    return index < 0 ? -1 : index + token.length;
  };
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (/\s/.test(text[at] ?? "")) at++;
    if (text.startsWith("<?", at)) at = after("?>", at + 2);
    else if (text.startsWith("<!--", at)) at = after("-->", at + 4);
    else if (text.startsWith("<!DOCTYPE", at)) {
      const subset = text.indexOf("[", at);
      const close = text.indexOf(">", at);
      at = after(">", subset >= 0 && subset < close ? after("]", subset) : at);
    } else return /^<svg[\s/>]/.test(text.slice(at, at + 5));
    if (at < 0) return false;
  }
}
export type MathInput = z.infer<typeof mathInputSchema>;
export type GraphicInput = z.infer<typeof graphicInputSchema>;
export type GraphicImage = z.infer<typeof imageResultSchema>;
