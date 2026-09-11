import { Platform } from "react-native";
import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";

/** Native workspace menus omit plugin panels in Paseo 0.8.0. */
export function registerNativeCanvasHeaders(client: PluginClientContext) {
  if (Platform.OS === "web") return () => {};
  const buttons = new Map<string, PluginButtonRegistration>();
  const changedDuringLoad = new Set<string>();
  let loading = true;
  let stopped = false;
  const register = (workspaceId: string) => {
    if (stopped || buttons.has(workspaceId)) return;
    buttons.set(workspaceId, client.addHeaderButton({
      id: "open-canvas",
      workspaceId,
      button: {
        title: "Open Canvas",
        icon: "NotebookPen",
        behavior: {
          kind: "action",
          onPress: () => client.openPanel("canvas", { workspaceId }),
        },
      },
    }));
  };
  // Use the public connection-local directory stream, as in Paseo 0.8.0's
  // plugin example. The app owns its workspace subscription; do not replace it.
  const unsubscribe = client.paseo.workspaces.subscribe((update) => {
    if (stopped) return;
    const id = update.kind === "remove" ? update.id : update.workspace.id;
    if (loading) changedDuringLoad.add(id);
    if (update.kind === "remove") {
      buttons.get(id)?.remove();
      buttons.delete(id);
    } else register(id);
  });
  async function load() {
    let cursor: string | undefined;
    try {
      do {
        const page = await client.paseo.workspaces.list({ page: { limit: 200, cursor } });
        if (stopped) return;
        for (const workspace of page.entries) {
          if (!changedDuringLoad.has(workspace.id)) register(workspace.id);
        }
        if (!page.pageInfo.hasMore) break;
        if (!page.pageInfo.nextCursor) throw new Error("Workspace list is missing its next cursor");
        cursor = page.pageInfo.nextCursor;
      } while (!stopped);
    } catch (error) {
      if (!stopped) console.error("[paseo-canvas] Unable to load native workspace buttons", error);
    } finally {
      loading = false;
      changedDuringLoad.clear();
    }
  }
  void load();
  return () => {
    stopped = true;
    unsubscribe();
    for (const button of buttons.values()) button.remove();
    buttons.clear();
  };
}
