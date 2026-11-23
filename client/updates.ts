import { getReviews } from "../shared/review";
import { useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSubscription } from "@getpaseo/plugin/client";
import {
  listCanvases,
  getCanvas,
  watchCanvases,
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
      (name === getCanvas.name || name === getReviews.name) &&
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

/**
 * Follows committed and lock changes of a workspace through the daemon's
 * subscription (ADR 18). Paseo subscribes again after a reconnect; the first
 * event then carries the current cursor, so missed changes are read once.
 * Returns the current interruption, if any.
 */
export function useCanvasUpdates(workspaceId: string) {
  const client = useQueryClient();
  const [readError, setReadError] = useState<Error | null>(null);
  const target = useRef<string | null>(null);
  const applied = useRef<string | null>(null);
  const draining = useRef(false);
  const stopped = useRef(false);
  const wake = useRef<(() => void) | null>(null);
  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
      wake.current?.();
    };
  }, []);
  async function drain() {
    if (draining.current) return;
    draining.current = true;
    let failures = 0;
    try {
      while (!stopped.current && target.current !== applied.current) {
        const cursor = target.current;
        try {
          await refreshCanvases(client, workspaceId);
          // Advance only after every read succeeded; a failed read is retried
          // even when no later change arrives.
          applied.current = cursor;
          failures = 0;
          if (!stopped.current) setReadError(null);
        } catch (cause) {
          if (stopped.current) return;
          setReadError(cause instanceof Error ? cause : new Error(String(cause)));
          const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, delay);
            wake.current = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          wake.current = null;
        }
      }
    } finally {
      draining.current = false;
    }
  }
  // Cursors are per workspace; another workspace must be read once.
  const followed = useRef(workspaceId);
  if (followed.current !== workspaceId) {
    followed.current = workspaceId;
    applied.current = null;
  }
  const subscription = useSubscription(
    watchCanvases,
    { workspaceId },
    ({ cursor }) => {
      target.current = cursor;
      // A new cursor (for example after a reconnect) retries a failed read now.
      wake.current?.();
      void drain();
    },
  );
  if (subscription.status === "error") return subscription.error;
  return readError;
}
