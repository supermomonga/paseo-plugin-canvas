import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { CanvasActivityQueue } from "../server/activity";
import { syncDirectory } from "../server/durability";
import { startMcp } from "../server/mcp";
import { Sessions } from "../server/sessions";
import { CanvasStore } from "../server/store";
import type { Actor } from "../shared/contracts";

// Node on Windows opens a directory but cannot fsync it (issue #6): file
// handles sync normally, directory handles fail with EPERM.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const open = (async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args);
    if ((await handle.stat()).isDirectory())
      handle.sync = async () => {
        throw Object.assign(
          new Error("EPERM: operation not permitted, fsync"),
          { code: "EPERM", syscall: "fsync" },
        );
      };
    return handle;
  }) as typeof actual.open;
  return { ...actual, default: { ...actual, open }, open };
});

const platform = process.platform;
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  Object.defineProperty(process, "platform", { value: platform });
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function temporary() {
  const directory = await mkdtemp(path.join(tmpdir(), "canvas-durability-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
const actor: Actor = {
  agentId: "agent-a",
  workspaceId: "workspace",
  title: "Plan",
  sessionId: "session-a",
};

test("directory sync errors still surface outside Windows", async () => {
  expect(platform).not.toBe("win32");
  const directory = await temporary();
  await expect(syncDirectory(directory)).rejects.toMatchObject({
    code: "EPERM",
  });
  await expect(CanvasActivityQueue.open(directory)).rejects.toMatchObject({
    code: "EPERM",
  });
  const store = await CanvasStore.open(directory);
  cleanup.push(() => store.close());
  await expect(store.create(actor, "Plan", "text")).rejects.toMatchObject({
    code: "EPERM",
  });
});

test("Windows skips directory sync without touching the directory", async () => {
  const missing = path.join(await temporary(), "missing");
  await expect(syncDirectory(missing, "linux")).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(syncDirectory(missing, "win32")).resolves.toBeUndefined();
});

test("on Windows, startup, agent registration, canvas writes, reviews and notifications succeed", async () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  const directory = await temporary();
  // Same order as plugin initialization, which `before agent.create` awaits.
  const store = await CanvasStore.open(directory);
  cleanup.push(() => store.close());
  const sessions = await Sessions.open(store);
  cleanup.push(() => sessions.close());
  const activity = await CanvasActivityQueue.open(directory);
  cleanup.push(() => activity.close());
  const mcp = await startMcp(store, sessions, activity);
  cleanup.push(() => mcp.close());

  const { token } = (await sessions.connect(
    actor.agentId,
    actor.workspaceId,
    null,
  ))!;
  expect(sessions.resolve(token).agentId).toBe(actor.agentId);
  expect(
    JSON.parse(await readFile(path.join(directory, "mcp.json"), "utf8")),
  ).toMatchObject({ port: sessions.port });

  const { canvasId } = await store.create(actor, "Plan", "# Plan\n\nHello.\n");
  const { lockToken } = await store.acquire(actor, canvasId);
  const updated = await store.update(actor, {
    canvasId,
    lockToken,
    expectedRevision: 1,
    content: "# Plan\n\nHello world.\n",
  });
  expect(updated.revision).toBe(2);
  const review = await store.reviews.mutate(actor.workspaceId, canvasId, {
    action: "create",
    selection: {
      documentRevision: 2,
      ranges: [{ kind: "block", start: 8, end: 13, selectedText: "Hello" }],
    },
    body: "Make this clearer",
  });
  expect(Object.keys(review.state.threads)).toHaveLength(1);

  const append = vi.fn(async (_item: unknown) => {});
  const context = {
    paseo: {
      agents: {
        ref: () => ({
          timeline: { append },
        }),
      },
    },
  } as unknown as PluginHandlerContext;
  await activity.enqueue(actor.agentId, {
    workspaceId: actor.workspaceId,
    canvasId,
    title: "Plan",
    revision: 2,
    action: "updated",
    warningCount: 0,
    savedAt: new Date().toISOString(),
  });
  await activity.deliver(context.paseo);
  expect(append).toHaveBeenCalledOnce();

  await store.delete(actor, { canvasId, lockToken, expectedRevision: 2 });
  await expect(store.get(actor.workspaceId, canvasId)).rejects.toThrow();
});
