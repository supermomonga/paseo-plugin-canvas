import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { CanvasChanges, CHANGE_WAIT_MS } from "../server/changes";
import { CanvasStore, LOCK_TTL_MS } from "../server/store";
import type { Actor } from "../shared/contracts";

const actor: Actor = {
  agentId: "agent",
  workspaceId: "workspace",
  sessionId: "session",
  title: "Agent",
};
afterEach(() => vi.useRealTimers());

test("change cursors isolate workspaces, reach every reader, and retain changes between waits", async () => {
  const changes = new CanvasChanges();
  const initial = await changes.wait("a", null);
  const readerA = changes.wait("a", initial.cursor);
  const readerB = changes.wait("a", initial.cursor);
  let resolved = false;
  void readerA.then(() => {
    resolved = true;
  });
  changes.publish("b");
  await Promise.resolve();
  expect(resolved).toBe(false);
  changes.publish("a");
  const [a, b] = await Promise.all([readerA, readerB]);
  expect(a).toEqual(b);
  expect(a.cursor).not.toBe(initial.cursor);
  changes.publish("a");
  expect((await changes.wait("a", a.cursor)).cursor).not.toBe(a.cursor);
  // A replacement process must force a read even if its workspace is still empty.
  const replacement = new CanvasChanges();
  expect((await replacement.wait("a", a.cursor)).cursor).not.toBe(a.cursor);
  changes.close(new Error("closed"));
  replacement.close(new Error("closed"));
});

test("idle waits expire without a change; close rejects and releases pending waits", async () => {
  vi.useFakeTimers();
  const changes = new CanvasChanges();
  const initial = await changes.wait("a", null);
  const idle = changes.wait("a", initial.cursor);
  await vi.advanceTimersByTimeAsync(CHANGE_WAIT_MS);
  expect(await idle).toEqual(initial);
  expect(vi.getTimerCount()).toBe(0);
  const pending = expect(changes.wait("a", initial.cursor)).rejects.toThrow(
    "closed",
  );
  changes.close(new Error("closed"));
  await pending;
  expect(vi.getTimerCount()).toBe(0);
  await expect(changes.wait("a", null)).rejects.toThrow("closed");
});

test("store publishes committed create, lock, renew, update, release and delete operations", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "canvas-changes-"));
  const store = await CanvasStore.open(dir);
  try {
    let cursor = (await store.waitForChange(actor.workspaceId, null)).cursor;
    const changed = async <T>(action: () => Promise<T>) => {
      const waiting = store.waitForChange(actor.workspaceId, cursor);
      const value = await action();
      const next = await waiting;
      expect(next.cursor).not.toBe(cursor);
      cursor = next.cursor;
      return value;
    };
    const { canvasId } = await changed(() =>
      store.create(actor, "Plan", "# One"),
    );
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
    expect((await store.waitForChange(actor.workspaceId, null)).cursor).toBe(
      cursor,
    );
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
    const waiting = expect(
      store.waitForChange(actor.workspaceId, cursor),
    ).rejects.toThrow("closed");
    await store.close();
    await waiting;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("lock expiry notifies waiting readers without a read or another MCP call", async () => {
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
    const initial = await store.waitForChange(actor.workspaceId, null);
    now += LOCK_TTL_MS - 1000;
    await vi.advanceTimersByTimeAsync(LOCK_TTL_MS - 1000);
    const pending = store.waitForChange(actor.workspaceId, initial.cursor);
    now += 1000;
    await vi.advanceTimersByTimeAsync(1000);
    // A null-cursor read cannot trigger expiry before this pending promise resolves.
    expect((await pending).cursor).not.toBe(initial.cursor);
    expect(
      (await store.get(actor.workspaceId, canvasId)).canvas.editState.status,
    ).toBe("unlocked");
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
