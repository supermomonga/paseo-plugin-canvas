import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { idSchema, type RecentCanvas } from "../shared/contracts";
import { CanvasError } from "./errors";
import type { CanvasStore } from "./store";

type Paseo = PluginHandlerContext["paseo"];
// Derived from the host SDK: npm installations omit @getpaseo/client (ADR 14).
type PaseoWorkspacePage = Awaited<ReturnType<Paseo["workspaces"]["list"]>>;

/** Lists the host's active workspaces, so archived workspaces do not appear. */
async function activeWorkspaces(paseo: Paseo) {
  const workspaces: PaseoWorkspacePage["entries"] = [];
  let cursor: string | undefined;
  for (;;) {
    const page: PaseoWorkspacePage = await paseo.workspaces.list({
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    workspaces.push(...page.entries);
    if (!page.pageInfo.hasMore) return workspaces;
    if (!page.pageInfo.nextCursor)
      throw new Error("Workspace list is missing its next cursor");
    cursor = page.pageInfo.nextCursor;
  }
}

/** Every canvas of the host's active workspaces, most recently updated first. */
export async function hostCanvases(
  store: Pick<CanvasStore, "list">,
  paseo: Paseo,
) {
  const workspaces = (await activeWorkspaces(paseo)).filter(
    (workspace) => idSchema.safeParse(workspace.id).success,
  );
  const lists = await Promise.all(
    workspaces.map(async (workspace): Promise<RecentCanvas[]> => {
      try {
        const { items } = await store.list(workspace.id);
        const workspaceName = workspace.title || workspace.name;
        return items.map((item) => ({ ...item, workspaceName }));
      } catch (error) {
        if (error instanceof CanvasError && error.code === "STORE_UNAVAILABLE")
          throw error;
        // One unreadable workspace must not hide the others' canvases.
        console.error(
          `[paseo-canvas] Unable to list canvases of workspace ${workspace.id}`,
          error,
        );
        return [];
      }
    }),
  );
  return lists
    .flat()
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.canvasId.localeCompare(b.canvasId),
    );
}

export async function recentCanvases(
  store: Pick<CanvasStore, "list">,
  paseo: Paseo,
  limit: number,
) {
  return { items: (await hostCanvases(store, paseo)).slice(0, limit) };
}
