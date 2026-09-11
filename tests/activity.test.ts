import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { CanvasActivityQueue } from "../server/activity";
import type { CanvasActivity } from "../shared/activity";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "canvas-activity-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const queue = await CanvasActivityQueue.open(dir);
  cleanup.push(() => queue.close());
  const append = vi.fn(async (_item: unknown) => {});
  const refetch = vi.fn(async () => ({
    entries: [] as { item: unknown }[],
    hasOlder: false,
  }));
  const ref = vi.fn((_id: string) => ({ timeline: { append, refetch } }));
  const context = {
    paseo: { agents: { ref } },
  } as unknown as PluginHandlerContext;
  return { dir, queue, append, ref, refetch, context };
}
const activity: CanvasActivity = {
  workspaceId: "workspace",
  canvasId: "canvas",
  title: "Plan",
  revision: 1,
  action: "created",
  warningCount: 2,
  savedAt: "2026-09-12T00:00:00Z",
};

test("pending rows survive restart and concurrent clients publish each row once", async () => {
  const { dir, queue, append, ref, context } = await setup();
  await queue.enqueue("agent-a", activity);
  await queue.close();
  const restored = await CanvasActivityQueue.open(dir);
  cleanup.push(() => restored.close());
  await Promise.all([
    restored.sync(null, context),
    restored.sync(null, context),
  ]);
  expect(append).toHaveBeenCalledTimes(1);
  expect(ref).toHaveBeenCalledWith("agent-a");
  expect(append.mock.calls[0][0]).toEqual({
    type: "plugin",
    id: "canvas-canvas-1",
    kind: "canvas-activity",
    version: 1,
    data: activity,
  });
  await restored.close();
  const empty = await CanvasActivityQueue.open(dir);
  cleanup.push(() => empty.close());
  await empty.sync(null, context);
  expect(append).toHaveBeenCalledTimes(1);
});

test("new saves wake idle clients and failed appends retry with the same identity without blocking other rows", async () => {
  const { queue, append, context } = await setup();
  const initial = await queue.sync(null, context);
  const pending = queue.sync(initial.cursor, context);
  await queue.enqueue("agent-a", activity);
  const next = await pending;
  expect(next.cursor).not.toBe(initial.cursor);
  await queue.enqueue("agent-a", {
    ...activity,
    revision: 2,
    action: "updated",
  });
  await queue.enqueue("agent-b", { ...activity, canvasId: "other" });
  append.mockRejectedValueOnce(new Error("offline"));
  await expect(queue.sync(next.cursor, context)).rejects.toThrow("offline");
  expect(append).toHaveBeenCalledTimes(3);
  await queue.sync(next.cursor, context);
  expect(append.mock.calls[1][0]).toEqual(append.mock.calls[3][0]);
});

test("a lost append response is reconciled against canonical history before retrying", async () => {
  const { queue, append, refetch, context } = await setup();
  await queue.enqueue("agent-a", activity);
  append.mockImplementationOnce(async (item) => {
    refetch.mockResolvedValue({
      entries: [{ item: { ...(item as object), pluginId: "paseo-canvas" } }],
      hasOlder: false,
    });
    throw new Error("Response lost after append");
  });
  await expect(queue.sync(null, context)).rejects.toThrow("Response lost");
  await queue.sync(null, context);
  expect(append).toHaveBeenCalledOnce();
});

test("delivery searches older pages and does not append if history cannot be checked", async () => {
  const { queue, append, refetch, context } = await setup();
  await queue.enqueue("agent-a", activity);
  refetch.mockResolvedValueOnce({
    entries: [],
    hasOlder: true,
    startCursor: { epoch: "epoch", seq: 200 },
  } as any);
  refetch.mockResolvedValueOnce({
    entries: [
      {
        item: {
          type: "plugin",
          pluginId: "paseo-canvas",
          id: "canvas-canvas-1",
        },
      },
    ],
    hasOlder: false,
  });
  await queue.sync(null, context);
  expect(refetch.mock.calls[1]).toEqual([
    {
      direction: "before",
      cursor: { epoch: "epoch", seq: 200 },
      limit: 200,
      projection: "canonical",
    },
  ]);
  expect(append).not.toHaveBeenCalled();
  await queue.enqueue("agent-a", { ...activity, revision: 2 });
  refetch.mockResolvedValueOnce({
    entries: [],
    hasOlder: false,
    error: "History unavailable",
  } as any);
  await expect(queue.sync(null, context)).rejects.toThrow(
    "History unavailable",
  );
  expect(append).not.toHaveBeenCalled();
});
