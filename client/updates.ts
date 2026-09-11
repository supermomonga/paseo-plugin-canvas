import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getClientHost } from "paseo-plugin-helper/client";
import {
  listCanvases,
  getCanvas,
  waitForCanvasChange,
  type CanvasSummary,
} from "../shared/contracts";

export async function refreshCanvases(
  client: QueryClient,
  workspaceId: string,
) {
  // Refresh the directory first, so a deleted selection is not fetched again.
  await client.invalidateQueries(
    { queryKey: [listCanvases.name, { workspaceId }], exact: true },
    { throwOnError: true },
  );
  const list = client.getQueryData<{ items: CanvasSummary[] }>([
    listCanvases.name,
    { workspaceId },
  ]);
  const belongsToWorkspace = (query: { queryKey: readonly unknown[] }) => {
    const [name, input] = query.queryKey;
    return (
      name === getCanvas.name &&
      (input as { workspaceId?: string } | undefined)?.workspaceId ===
        workspaceId
    );
  };
  await client.invalidateQueries({
    predicate: belongsToWorkspace,
    refetchType: "none",
  });
  await client.refetchQueries(
    {
      type: "active",
      predicate: (query) =>
        belongsToWorkspace(query) &&
        !!list?.items.some(
          (item) =>
            item.canvasId ===
            (query.queryKey[1] as { canvasId: string }).canvasId,
        ),
    },
    { throwOnError: true },
  );
}

export function useCanvasUpdates(workspaceId: string) {
  const client = useQueryClient();
  const waitForChange = getClientHost().useRpc(waitForCanvasChange);
  const [active, setActive] = useState(
    AppState.currentState !== "background" &&
      AppState.currentState !== "inactive",
  );
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finishDelay: (() => void) | undefined;
    async function follow() {
      let cursor: string | null = null;
      let failures = 0;
      while (!stopped) {
        try {
          const next = await waitForChange({ workspaceId, cursor });
          if (stopped) return;
          if (next.cursor !== cursor) {
            await refreshCanvases(client, workspaceId);
            if (stopped) return;
          }
          // Advance only after all reads succeed. A failed read is retried even
          // when no later mutation occurs. A new server epoch also forces a read.
          cursor = next.cursor;
          failures = 0;
          setError(null);
        } catch (cause) {
          if (stopped) return;
          setError(cause instanceof Error ? cause : new Error(String(cause)));
          // Reconnect with a fresh snapshot, including changes missed offline.
          cursor = null;
          const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
          await new Promise<void>((resolve) => {
            finishDelay = resolve;
            timer = setTimeout(resolve, delay);
          });
        }
      }
    }
    void follow();
    return () => {
      stopped = true;
      clearTimeout(timer);
      finishDelay?.();
      // The public RPC API has no cancellation signal. Its server-side wait
      // expires after 20 seconds; ignore its result after leaving this view.
    };
  }, [active, client, waitForChange, workspaceId]);
  return error;
}
