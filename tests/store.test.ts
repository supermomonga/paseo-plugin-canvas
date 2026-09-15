import { afterEach, expect, test } from "vitest";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CanvasStore, LOCK_TTL_MS } from "../server/store";
import { dataRoot } from "../server/paths";
import { decodeDocument, encodeDocument } from "../server/format";
import type { Actor } from "../shared/contracts";
const a: Actor = {
  agentId: "agent-a",
  workspaceId: "workspace-a",
  title: "Plan",
  sessionId: "session-a",
};
const b: Actor = { ...a, agentId: "agent-b", sessionId: "session-b" };
const opened: CanvasStore[] = [],
  directories: string[] = [];
afterEach(async () => {
  await Promise.allSettled(opened.splice(0).map((store) => store.close()));
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "canvas-test-"));
  directories.push(dir);
  let now = Date.now();
  const store = await CanvasStore.open(dir, {
    clock: () => now,
    monotonic: () => now,
  });
  opened.push(store);
  return {
    store,
    dir,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
test("A writes Markdown, B reads it, restart preserves files and invalidates locks", async () => {
  const { store, dir } = await setup();
  const created = await store.create(
    a,
    "title: # test",
    "# Plan\n\n- [x] A\n---\n本文",
  );
  const lease = await store.acquire(a, created.canvasId);
  await store.update(a, {
    ...created,
    lockToken: lease.lockToken,
    expectedRevision: 1,
    content: "# 保存済み\n",
  });
  const before = await store.get(a.workspaceId, created.canvasId);
  expect(before.canvas.revision).toBe(2);
  expect(JSON.stringify(before)).not.toContain(lease.lockToken);
  const source = await readFile(
    path.join(dir, a.workspaceId, `${created.canvasId}.md`),
    "utf8",
  );
  expect(source).toContain("---\n# 保存済み");
  await store.close();
  opened.splice(opened.indexOf(store), 1);
  const restored = await CanvasStore.open(dir);
  opened.push(restored);
  expect(
    (await restored.get(b.workspaceId, created.canvasId)).canvas,
  ).toMatchObject({
    content: "# 保存済み\n",
    revision: 2,
    editState: { status: "unlocked" },
  });
  await expect(
    restored.update(a, {
      canvasId: created.canvasId,
      lockToken: lease.lockToken,
      expectedRevision: 2,
      content: "stale",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
test("concurrent acquisition/update, stale revisions and old sessions cannot overwrite", async () => {
  const { store } = await setup();
  const { canvasId } = await store.create(a, "Plan", "initial");
  const results = await Promise.allSettled([
    store.acquire(a, canvasId),
    store.acquire(b, canvasId),
  ]);
  expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  const lease = (
    results[0] as PromiseFulfilledResult<
      Awaited<ReturnType<typeof store.acquire>>
    >
  ).value;
  const input = {
    canvasId,
    lockToken: lease.lockToken,
    expectedRevision: 1,
    content: "saved",
  };
  await expect(
    store.update({ ...a, sessionId: "other" }, input),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const updates = await Promise.allSettled([
    store.update(a, input),
    store.update(a, input),
  ]);
  expect(updates.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  await expect(store.update(b, input)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect((await store.get(a.workspaceId, canvasId)).canvas.content).toBe(
    "saved",
  );
});
test("renew retains acquisition time; expiry/reacquisition replaces identity and rejects old release", async () => {
  const { store, advance } = await setup();
  const { canvasId } = await store.create(a, "Plan", "");
  const first = await store.acquire(a, canvasId);
  advance(1000);
  const renewed = await store.renew(a, canvasId, first.lockToken);
  expect(renewed.editState).toMatchObject({
    status: "locked",
    lock: {
      acquiredAt: first.editState.lock.acquiredAt,
      id: first.editState.lock.id,
    },
  });
  advance(LOCK_TTL_MS);
  expect(
    (await store.get(a.workspaceId, canvasId)).canvas.editState.status,
  ).toBe("unlocked");
  const second = await store.acquire(b, canvasId);
  expect(second.editState.lock.id).not.toBe(first.editState.lock.id);
  await expect(
    store.releaseLock(a, canvasId, first.lockToken),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await store.list(a.workspaceId)).items[0].revision).toBe(1);
});
test("separates workspaces, rejects traversal and preserves corrupted documents", async () => {
  const { store, dir } = await setup();
  const { canvasId } = await store.create(a, "Plan", "");
  await expect(store.get("another-workspace", canvasId)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(store.get("../escape", canvasId)).rejects.toThrow();
  const file = path.join(dir, a.workspaceId, `${canvasId}.md`);
  await writeFile(file, "---\ninvalid: [\n---\nkeep me");
  await expect(store.list(a.workspaceId)).rejects.toMatchObject({
    code: "CORRUPT_DOCUMENT",
  });
  expect(await readFile(file, "utf8")).toContain("keep me");
  expect(await readdir(path.join(dir, a.workspaceId))).toEqual([
    `${canvasId}.md`,
  ]);
});
test("refuses another owner of the same storage directory and allows reopen after close", async () => {
  const { store, dir } = await setup();
  await expect(CanvasStore.open(dir)).rejects.toMatchObject({
    code: "ELOCKED",
  });
  await store.close();
  opened.splice(opened.indexOf(store), 1);
  const next = await CanvasStore.open(dir);
  opened.push(next);
});
test("format round-trips frontmatter-like content and rejects aliases/duplicate keys", () => {
  const metadata = {
    schemaVersion: 2 as const,
    workspaceId: a.workspaceId,
    canvasId: "canvas",
    title: 'Colon: " #',
    revision: 1,
    createdAt: "2026-09-11T09:00:00.000Z",
    updatedAt: "2026-09-11T09:00:00.000Z",
    updatedBy: { role: "agent" as const, agentId: a.agentId },
  };
  const content = "---\nuser: frontmatter\n---\n\n# 保持\n";
  const encoded = encodeDocument(metadata, content);
  expect(decodeDocument(encoded, a.workspaceId, "canvas")).toEqual({
    metadata,
    content,
  });
  expect(() =>
    decodeDocument(
      encoded.replace("schemaVersion: 2", "schemaVersion: 2\nschemaVersion: 2"),
      a.workspaceId,
      "canvas",
    ),
  ).toThrow();
});
test("resolves OS application-data locations", () => {
  expect(dataRoot("linux", {}, "/home/test")).toBe(
    "/home/test/.local/share/paseo-canvas",
  );
  expect(dataRoot("linux", { XDG_DATA_HOME: "/data" }, "/home/test")).toBe(
    "/data/paseo-canvas",
  );
  expect(dataRoot("darwin", {}, "/Users/test")).toBe(
    "/Users/test/Library/Application Support/paseo-canvas",
  );
  expect(
    dataRoot("win32", { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" }),
  ).toBe("C:\\Users\\test\\AppData\\Local\\paseo-canvas");
});
