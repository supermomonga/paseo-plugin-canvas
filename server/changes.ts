import { randomUUID } from "node:crypto";

// Paseo's plugin RPC timeout is 30 seconds. Renew idle waits before that limit.
export const CHANGE_WAIT_MS = 20_000;

/** Workspace-scoped invalidation cursors. No document content or edit tokens. */
export class CanvasChanges {
  private readonly epoch = randomUUID();
  private revisions = new Map<string, number>();
  private waiters = new Map<string, Set<() => void>>();
  private stopped: Error | null = null;

  private cursor(workspaceId: string) {
    return `${this.epoch}:${this.revisions.get(workspaceId) ?? 0}`;
  }

  publish(workspaceId: string) {
    if (this.stopped) return;
    this.revisions.set(workspaceId, (this.revisions.get(workspaceId) ?? 0) + 1);
    for (const finish of [...(this.waiters.get(workspaceId) ?? [])]) finish();
  }

  wait(
    workspaceId: string,
    cursor: string | null,
  ): Promise<{ cursor: string }> {
    if (this.stopped) return Promise.reject(this.stopped);
    if (cursor !== this.cursor(workspaceId))
      return Promise.resolve({ cursor: this.cursor(workspaceId) });
    return new Promise((resolve, reject) => {
      const listeners = this.waiters.get(workspaceId) ?? new Set<() => void>();
      const finish = () => {
        clearTimeout(timer);
        listeners.delete(finish);
        if (!listeners.size) this.waiters.delete(workspaceId);
        if (this.stopped) reject(this.stopped);
        else resolve({ cursor: this.cursor(workspaceId) });
      };
      const timer = setTimeout(finish, CHANGE_WAIT_MS);
      timer.unref();
      listeners.add(finish);
      this.waiters.set(workspaceId, listeners);
    });
  }

  close(error: Error) {
    this.stopped = error;
    for (const listeners of [...this.waiters.values()])
      for (const finish of [...listeners]) finish();
    this.revisions.clear();
  }
}
