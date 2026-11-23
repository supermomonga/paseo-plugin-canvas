import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { CanvasChanges, type ChangeObserver } from "../server/changes";
import { CanvasStore, LOCK_TTL_MS } from "../server/store";
import type { Actor } from "../shared/contracts";

const actor: Actor = {
  agentId: "agent",
  workspaceId: "workspace",
  sessionId: "session",
  title: "Agent",
};
afterEach(() => vi.useRealTimers());

/** Records the cursors one subscriber receives. */
function recorder() {
  const cursors: string[] = [];
  let closed: Error | null = null;
  const observer: ChangeObserver = {
    change: (cursor) => cursors.push(cursor),
    closed: (error) => {
      closed = error;
    },
  };
  return {
    observer,
    cursors,
    get closed() {
      return closed;
    },
  };
}

test("watchers receive their workspace's cursor changes only, and stop on request", () => {
  const changes = new CanvasChanges();
  const a1 = recorder();
  const a2 = recorder();
  const b = recorder();
  const first = changes.watch("a", a1.observer);
  const second = changes.watch("a", a2.observer);
  changes.watch("b", b.observer);
  expect(second.cursor).toBe(first.cursor);
  changes.publish("a");
  expect(a1.cursors).toHaveLength(1);
  expect(a1.cursors).toEqual(a2.cursors);
  expect(a1.cursors[0]).not.toBe(first.cursor);
  expect(b.cursors).toEqual([]);
  first.stop();
  changes.publish("a");
  expect(a1.cursors).toHaveLength(1);
  expect(a2.cursors).toHaveLength(2);
  expect(changes.cursor("a")).toBe(a2.cursors[1]);
  // A replacement process never repeats an earlier cursor, even for an
  // untouched workspace, so a resubscribed client always reads once.
  expect(new CanvasChanges().cursor("b")).not.toBe(changes.cursor("b"));
  changes.close(new Error("closed"));
});

test("closing notifies every watcher once and refuses new ones", () => {
  const changes = new CanvasChanges();
  const watcher = recorder();
  changes.watch("a", watcher.observer);
  changes.close(new Error("closed"));
  expect(watcher.closed).toMatchObject({ message: "closed" });
  changes.publish("a");
  expect(watcher.cursors).toEqual([]);
  expect(() => changes.watch("a", recorder().observer)).toThrow("closed");
});

test("store publishes committed create, lock, renew, update, release and delete operations", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "canvas-changes-"));
  const store = await CanvasStore.open(dir);
  try {
    const watcher = recorder();
    const { cursor: initial } = store.watchChanges(
      actor.workspaceId,
      watcher.observer,
    );
    let seen = 0;
    const changed = async <T>(action: () => Promise<T>) => {
      const value = await action();
      expect(watcher.cursors.length).toBeGreaterThan(seen);
      seen = watcher.cursors.length;
      return value;
    };
    const { canvasId } = await changed(() =>
      store.create(actor, "Plan", "# One"),
    );
    expect(watcher.cursors[0]).not.toBe(initial);
    const lock = await changed(() => store.acquire(actor, canvasId));
    await changed(() => store.renew(actor, canvasId, lock.lockToken));
    await changed(() =>
      store.update(actor, {
        canvasId,
        lockToken: lock.lockToken,
        expectedRevision: 1,
        content: "# Two",
      }),
    );
    expect((await store.get(actor.workspaceId, canvasId)).canvas.content).toBe(
      "# Two",
    );
    await expect(
      store.update(actor, {
        canvasId,
        lockToken: "invalid",
        expectedRevision: 2,
        content: "bad",
      }),
    ).rejects.toThrow();
    // A rejected write publishes nothing.
    expect(watcher.cursors).toHaveLength(seen);
    await changed(() => store.releaseLock(actor, canvasId, lock.lockToken));
    const nextLock = await changed(() => store.acquire(actor, canvasId));
    await changed(() =>
      store.delete(actor, {
        canvasId,
        lockToken: nextLock.lockToken,
        expectedRevision: 2,
      }),
    );
    expect((await store.list(actor.workspaceId)).items).toEqual([]);
    await store.close();
    expect(watcher.closed).toMatchObject({ message: "Canvas store is closed" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("lock expiry notifies watchers without a read or another MCP call", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let now = Date.now();
  const dir = await mkdtemp(path.join(tmpdir(), "canvas-expiry-"));
  const store = await CanvasStore.open(dir, {
    clock: () => now,
    monotonic: () => now,
  });
  try {
    const { canvasId } = await store.create(actor, "Plan", "");
    await store.acquire(actor, canvasId);
    const watcher = recorder();
    store.watchChanges(actor.workspaceId, watcher.observer);
    now += LOCK_TTL_MS - 1000;
    await vi.advanceTimersByTimeAsync(LOCK_TTL_MS - 1000);
    expect(watcher.cursors).toEqual([]);
    now += 1000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(watcher.cursors).toHaveLength(1);
    expect(
      (await store.get(actor.workspaceId, canvasId)).canvas.editState.status,
    ).toBe("unlocked");
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
