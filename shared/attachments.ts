import { defineRpc, PluginAttachmentSearchPayloadSchema } from "@getpaseo/plugin";
import { z } from "zod";

/** Searches the host's canvases for the composer's attachment picker. */
export const searchCanvasAttachments = defineRpc({
  name: "canvas.attachments.search",
  input: z.object({ query: z.string().max(500) }),
  output: PluginAttachmentSearchPayloadSchema,
});

export const CANVAS_ATTACHMENT_LIMIT = 20;

/** Identifies a canvas inside attachment metadata; nothing opens this URL. */
export function canvasResourceUrl(workspaceId: string, canvasId: string) {
  return `paseo-canvas://workspaces/${encodeURIComponent(workspaceId)}/canvases/${encodeURIComponent(canvasId)}`;
}
