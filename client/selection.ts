// Paseo evaluates plugin bundles from source in Hermes. Keep this store a
// factory: classes in that eval path fail when their constructors are called.
export function createCanvasSelection() {
  const selected = new Map<string, string | null>();
  const guards = new Map<string, (commit: () => void) => void>();
  const commit = (workspaceId: string, canvasId: string | null) => {
    selected.set(workspaceId, canvasId);
    for (const listener of subscriptions.get(workspaceId) ?? []) listener();
  };
  const subscriptions = new Map<string, Set<() => void>>();
  return {
    get(workspaceId: string) {
      return selected.get(workspaceId) ?? null;
    },
    select(workspaceId: string, canvasId: string | null) {
      const guard = guards.get(workspaceId);
      if (guard && canvasId !== (selected.get(workspaceId) ?? null))
        guard(() => commit(workspaceId, canvasId));
      else commit(workspaceId, canvasId);
    },
    selectDirect: commit,
    guard(workspaceId: string, action: (commit: () => void) => void) {
      guards.set(workspaceId, action);
      return () => {
        if (guards.get(workspaceId) === action) guards.delete(workspaceId);
      };
    },
    subscribe(workspaceId: string, listener: () => void) {
      const listeners = subscriptions.get(workspaceId) ?? new Set();
      listeners.add(listener);
      subscriptions.set(workspaceId, listeners);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) subscriptions.delete(workspaceId);
      };
    },
  };
}
export type CanvasSelection = ReturnType<typeof createCanvasSelection>;
