import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { ACTIVITY_MAX_AGE_MS, CanvasActivityQueue } from "../server/activity";
import type { CanvasActivity } from "../shared/activity";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const close of cleanup.splice(0).reverse()) await close();
});
function connection() {
  const append = vi.fn(async (_item: unknown) => {});
  const ref = vi.fn((_id: string) => ({ timeline: { append } }));
  const paseo = { agents: { ref } } as unknown as PluginHandlerContext["paseo"];
  return { paseo, append, ref };
}
async function setup(options: { clock?: () => number } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "canvas-activity-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const queue = await CanvasActivityQueue.open(dir, options);
  cleanup.push(() => queue.close());
  return { dir, queue };
}
const activity: CanvasActivity = {
  workspaceId: "workspace",
  canvasId: "canvas",
  title: "Plan",
  revision: 1,
  action: "created",
  warningCount: 0,
  savedAt: new Date().toISOString(),
};
const row = (data: CanvasActivity) => ({
  type: "plugin",
  id: `canvas-${data.canvasId}-${data.revision}`,
  kind: "canvas-activity",
  version: 1,
  data,
});

test("pending rows survive restart and a hook connection delivers each once", async () => {
  const { dir, queue } = await setup();
  await queue.enqueue("agent-a", activity);
  await queue.close();
  const restored = await CanvasActivityQueue.open(dir);
  cleanup.push(() => restored.close());
  expect(restored.size).toBe(1);
  const { paseo, append, ref } = connection();
  // Concurrent hooks are serialized; the second finds nothing left.
  await Promise.all([restored.deliver(paseo), restored.deliver(paseo)]);
  expect(append).toHaveBeenCalledOnce();
  expect(ref).toHaveBeenCalledWith("agent-a");
  expect(append.mock.calls[0][0]).toEqual(row(activity));
  await restored.close();
  expect(
    (await readdir(path.join(dir, "activity"))).filter((name) =>
      name.endsWith(".json"),
    ),
  ).toEqual([]);
});

test("the remembered daemon session delivers a save at once", async () => {
  const { queue } = await setup();
  const { paseo, append } = connection();
  queue.remember(paseo);
  // Remembering the same session again does not start another round.
  queue.remember(paseo);
  await queue.enqueue("agent-a", activity);
  await vi.waitFor(() => expect(append).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(queue.size).toBe(0));
  await queue.close();
  // A closed queue forgets the session.
  queue.remember(paseo);
  expect(append).toHaveBeenCalledOnce();
});

test("failed appends keep their row identity for retry without blocking other agents", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { queue } = await setup();
  await queue.enqueue("agent-a", activity);
  await queue.enqueue("agent-b", { ...activity, canvasId: "other" });
  const { paseo, append } = connection();
  append.mockRejectedValueOnce(new Error("Agent is not loaded"));
  await expect(queue.deliver(paseo)).rejects.toThrow("Agent is not loaded");
  expect(append).toHaveBeenCalledTimes(2);
  expect(queue.size).toBe(1);
  // With a remembered session it retries after a delay; the same ID replaces
  // any row whose append response was lost.
  queue.remember(paseo);
  await vi.advanceTimersByTimeAsync(0);
  await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(3));
  expect(append.mock.calls[2][0]).toEqual(append.mock.calls[0][0]);
  await vi.waitFor(() => expect(queue.size).toBe(0));
});

test("archived agents and expired notifications are dropped", async () => {
  let now = Date.parse(activity.savedAt);
  const { queue } = await setup({ clock: () => now });
  await queue.enqueue("archived", activity);
  await queue.enqueue("agent-b", { ...activity, canvasId: "old" });
  await queue.drop("archived");
  expect(queue.size).toBe(1);
  now += ACTIVITY_MAX_AGE_MS + 1;
  const { paseo, append } = connection();
  await queue.deliver(paseo);
  expect(append).not.toHaveBeenCalled();
  expect(queue.size).toBe(0);
});

test("a notification dropped while its append fails is not restored", async () => {
  const { queue } = await setup();
  await queue.enqueue("archived", activity);
  const { paseo, append } = connection();
  append.mockImplementationOnce(async () => {
    await queue.drop("archived");
    throw new Error("Agent was archived");
  });
  await queue.deliver(paseo);
  expect(queue.size).toBe(0);
});
