import { randomUUID } from "node:crypto";

export type ChangeObserver = {
  change(cursor: string): void;
  /** The coordinator stopped; no further changes are delivered. */
  closed(error: Error): void;
};

/** Workspace-scoped invalidation cursors. No document content or edit tokens. */
export class CanvasChanges {
  // A restarted plugin can never repeat an earlier cursor.
  private readonly epoch = randomUUID();
  private revisions = new Map<string, number>();
  private observers = new Map<string, Set<ChangeObserver>>();
  private stopped: Error | null = null;

  cursor(workspaceId: string) {
    return `${this.epoch}:${this.revisions.get(workspaceId) ?? 0}`;
  }

  publish(workspaceId: string) {
    if (this.stopped) return;
    this.revisions.set(workspaceId, (this.revisions.get(workspaceId) ?? 0) + 1);
    const cursor = this.cursor(workspaceId);
    for (const observer of [...(this.observers.get(workspaceId) ?? [])])
      observer.change(cursor);
  }

  /** Follows one workspace. Returns its current cursor and a stop function. */
  watch(workspaceId: string, observer: ChangeObserver) {
    if (this.stopped) throw this.stopped;
    const observers = this.observers.get(workspaceId) ?? new Set();
    observers.add(observer);
    this.observers.set(workspaceId, observers);
    return {
      cursor: this.cursor(workspaceId),
      stop: () => {
        observers.delete(observer);
        if (!observers.size && this.observers.get(workspaceId) === observers)
          this.observers.delete(workspaceId);
      },
    };
  }

  close(error: Error) {
    if (this.stopped) return;
    this.stopped = error;
    const observers = [...this.observers.values()].flatMap((set) => [...set]);
    this.observers.clear();
    this.revisions.clear();
    for (const observer of observers) observer.closed(error);
  }
}
