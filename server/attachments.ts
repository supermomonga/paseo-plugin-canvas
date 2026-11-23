import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { PluginAttachmentItem } from "@getpaseo/plugin";
import {
  CANVAS_ATTACHMENT_LIMIT,
  canvasResourceUrl,
} from "../shared/attachments";
import type { RecentCanvas } from "../shared/contracts";
import { CanvasError } from "./errors";
import { hostCanvases } from "./recent";
import type { CanvasStore } from "./store";

type Paseo = PluginHandlerContext["paseo"];

const normalize = (text: string) => text.normalize("NFKC").toLowerCase();

/** Ranks title prefixes before other title or workspace matches. */
function rank(item: RecentCanvas, terms: string[]) {
  const title = normalize(item.title);
  const haystack = `${title} ${normalize(item.workspaceName)}`;
  if (!terms.every((term) => haystack.includes(term))) return null;
  return title.startsWith(terms[0]) ? 0 : 1;
}

/**
 * Returns complete text snapshots of matching canvases. An empty query lists
 * the most recently updated canvases of the host's active workspaces.
 */
export async function searchAttachments(
  store: Pick<CanvasStore, "list" | "get">,
  paseo: Paseo,
  query: string,
): Promise<{ items: PluginAttachmentItem[] }> {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const candidates = (await hostCanvases(store, paseo))
    .map((item, order) => ({
      item,
      order,
      rank: terms.length ? rank(item, terms) : 0,
    }))
    .filter((entry) => entry.rank !== null)
    .sort((a, b) => a.rank! - b.rank! || a.order - b.order)
    .slice(0, CANVAS_ATTACHMENT_LIMIT)
    .map((entry) => entry.item);
  const items = await Promise.all(
    candidates.map(async (item): Promise<PluginAttachmentItem | null> => {
      try {
        const { canvas } = await store.get(item.workspaceId, item.canvasId);
        return {
          id: `${canvas.workspaceId}/${canvas.canvasId}`,
          identifier: item.workspaceName,
          title: canvas.title,
          // Paseo renders this text; keep it language-neutral.
          subtitle: canvas.updatedAt.slice(0, 10),
          url: canvasResourceUrl(canvas.workspaceId, canvas.canvasId),
          resourceType: "canvas",
          text: [
            `Canvas "${canvas.title}" from the Paseo workspace "${item.workspaceName}"`,
            `(canvas ID ${canvas.canvasId}, workspace ID ${canvas.workspaceId}, revision ${canvas.revision}, saved ${canvas.updatedAt}).`,
            "This is a snapshot; Canvas tools read the latest saved version.",
            "",
            canvas.content,
          ].join("\n"),
        };
      } catch (error) {
        // A canvas deleted after listing is skipped; a stopped store fails the search.
        if (error instanceof CanvasError && error.code === "NOT_FOUND")
          return null;
        throw error;
      }
    }),
  );
  return {
    items: items.filter((item): item is PluginAttachmentItem => item !== null),
  };
}
