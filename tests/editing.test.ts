import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { CanvasStore, LOCK_TTL_MS } from "../server/store";
import { editResult, registerUserEditing } from "../server/user-editing";
import { createCanvasEditor, type EditingApi } from "../client/editing-state";
import { createCanvasSelection } from "../client/selection";
import { canvasSchema } from "../shared/contracts";
import type { PluginServerContext } from "@getpaseo/plugin/server";
const agent = {
  agentId: "agent",
  workspaceId: "workspace",
  sessionId: "session",
  title: "Agent",
};
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
  vi.useRealTimers();
});
async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "canvas-edit-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  let now = Date.now();
  const store = await CanvasStore.open(dir, {
    clock: () => now,
    monotonic: () => now,
  });
  cleanup.push(() => store.close());
  const get = async (canvasId: string) =>
    (await store.get(agent.workspaceId, canvasId)).canvas;
  const api: EditingApi = {
    begin: (i) =>
      editResult(() => store.beginUserEdit(i.workspaceId, i.canvasId)),
    create: (i) =>
      editResult(() => store.createUser(i.workspaceId, i.title, i.content)),
    save: (i) => editResult(() => store.saveUser(i.workspaceId, i)),
    renew: (i) =>
      editResult(() => store.renewUser(i.workspaceId, i.canvasId, i.lockToken)),
    cancel: (i) =>
      editResult(() =>
        store.cancelUser(i.workspaceId, i.canvasId, i.lockToken),
      ),
    delete: (i) =>
      editResult(() =>
        store.deleteUser(i.workspaceId, i.canvasId, i.expectedRevision),
      ),
    refresh: vi.fn(async () => {}),
    select: vi.fn(),
  };
  return {
    store,
    dir,
    get,
    api,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
test("UI creation persists only on Save, starts at revision one and records user ownership", async () => {
  const { store, api, get } = await setup();
  const editor = createCanvasEditor(agent.workspaceId, api);
  editor.newCanvas();
  editor.change({ title: "  User title  ", content: "# User text" });
  expect((await store.list(agent.workspaceId)).items).toHaveLength(0);
  await editor.save();
  const id = (await store.list(agent.workspaceId)).items[0].canvasId;
  expect(canvasSchema.parse(await get(id))).toMatchObject({
    schemaVersion: 2,
    title: "User title",
    content: "# User text",
    revision: 1,
    updatedBy: { role: "user" },
    editState: { status: "unlocked" },
  });
  expect(editor.getSnapshot().draft).toBeNull();
  expect(api.select).toHaveBeenCalledWith(id);
});
test("user edits share MCP locks, save one revision and release atomically", async () => {
  const { store, api, get } = await setup();
  const { canvasId } = await store.create(agent, "A", "before");
  const editor = createCanvasEditor(agent.workspaceId, api);
  await editor.begin(canvasId);
  expect((await get(canvasId)).editState).toMatchObject({
    status: "locked",
    lock: { owner: { role: "user" } },
  });
  await expect(store.acquire(agent, canvasId)).rejects.toMatchObject({
    code: "LOCKED",
  });
  await expect(
    store.beginUserEdit(agent.workspaceId, canvasId),
  ).rejects.toMatchObject({ code: "LOCKED" });
  editor.change({ content: "after" });
  await Promise.all([editor.save(), editor.save()]);
  expect(await get(canvasId)).toMatchObject({
    content: "after",
    revision: 2,
    updatedBy: { role: "user" },
    editState: { status: "unlocked" },
  });
  const agentLock = await store.acquire(agent, canvasId);
  await expect(
    store.beginUserEdit(agent.workspaceId, canvasId),
  ).rejects.toMatchObject({ code: "LOCKED" });
  expect(() =>
    store.saveUser(agent.workspaceId, {
      canvasId,
      lockToken: agentLock.lockToken,
      expectedRevision: 2,
      title: "A",
      content: "impersonation",
    }),
  ).toThrow();
});
test("edit acquisition reads latest content in the same queue and rejects wrong tokens, workspaces and revisions", async () => {
  const { store, get } = await setup();
  const { canvasId } = await store.create(agent, "A", "before");
  const lock = await store.acquire(agent, canvasId);
  await store.update(agent, {
    canvasId,
    lockToken: lock.lockToken,
    expectedRevision: 1,
    content: "latest",
  });
  const release = store.releaseLock(agent, canvasId, lock.lockToken);
  const begin = store.beginUserEdit(agent.workspaceId, canvasId);
  await release;
  const edit = await begin;
  expect(edit.canvas).toMatchObject({ content: "latest", revision: 2 });
  const fields = {
    canvasId,
    lockToken: edit.lockToken,
    expectedRevision: 1,
    title: "A",
    content: "stale",
  };
  await expect(store.saveUser(agent.workspaceId, fields)).rejects.toMatchObject(
    { code: "CONFLICT" },
  );
  expect(() =>
    store.saveUser("other", { ...fields, expectedRevision: 2 }),
  ).toThrow();
  expect(() =>
    store.saveUser(agent.workspaceId, { ...fields, lockToken: "wrong" }),
  ).toThrow();
  expect(JSON.stringify(await get(canvasId))).not.toContain(edit.lockToken);
});
test("discard confirmation guards external selection, keeps drafts on dismissal and releases without revision", async () => {
  const { store, api, get } = await setup();
  const { canvasId } = await store.create(agent, "A", "before");
  const editor = createCanvasEditor(agent.workspaceId, api);
  const selection = createCanvasSelection();
  selection.select(agent.workspaceId, canvasId);
  selection.guard(agent.workspaceId, editor.navigate);
  await editor.begin(canvasId);
  editor.change({ content: "unsaved" });
  selection.select(agent.workspaceId, "other");
  expect(selection.get(agent.workspaceId)).toBe(canvasId);
  expect(editor.getSnapshot().confirmation).toBe("discard");
  editor.dismissConfirmation();
  expect(editor.getSnapshot().draft?.content).toBe("unsaved");
  selection.select(agent.workspaceId, "other");
  await editor.confirmDiscard();
  expect(selection.get(agent.workspaceId)).toBe("other");
  expect(await get(canvasId)).toMatchObject({
    content: "before",
    revision: 1,
    editState: { status: "unlocked" },
  });
});
test("leases renew, expire and can be reacquired without discarding text when revision matches", async () => {
  const { store, api, advance, get } = await setup();
  const { canvasId } = await store.create(agent, "A", "before");
  const editor = createCanvasEditor(agent.workspaceId, api);
  await editor.begin(canvasId);
  editor.change({ content: "draft" });
  const before = editor.getSnapshot().draft!.expiresAt;
  advance(60_000);
  await editor.renew();
  expect(editor.getSnapshot().draft!.expiresAt).not.toBe(before);
  advance(LOCK_TTL_MS + 1);
  await editor.renew();
  expect(editor.getSnapshot().draft).toMatchObject({
    content: "draft",
    lost: true,
  });
  await editor.save();
  expect((await get(canvasId)).revision).toBe(1);
  await editor.reacquire();
  expect(editor.getSnapshot().draft).toMatchObject({
    content: "draft",
    lost: false,
  });
  await editor.save();
  expect((await get(canvasId)).content).toBe("draft");
});
test("reacquisition releases a still-valid lease after a transient renewal failure", async () => {
  const { store, api } = await setup();
  const { canvasId } = await store.create(agent, "A", "before");
  const editor = createCanvasEditor(agent.workspaceId, {
    ...api,
    renew: async () => {
      throw new Error("disconnected");
    },
  });
  await editor.begin(canvasId);
  editor.change({ content: "draft" });
  await editor.renew();
  await editor.reacquire();
  expect(editor.getSnapshot().draft).toMatchObject({
    content: "draft",
    lost: false,
  });
});
test("reacquiring a changed revision preserves the draft and immediately releases the new lease", async () => {
  const { store, api, advance, get } = await setup();
  const { canvasId } = await store.create(agent, "A", "before");
  const editor = createCanvasEditor(agent.workspaceId, api);
  await editor.begin(canvasId);
  editor.change({ content: "draft" });
  advance(LOCK_TTL_MS + 1);
  await editor.renew();
  const lock = await store.acquire(agent, canvasId);
  await store.update(agent, {
    canvasId,
    lockToken: lock.lockToken,
    expectedRevision: 1,
    content: "agent update",
  });
  await store.releaseLock(agent, canvasId, lock.lockToken);
  await editor.reacquire();
  await editor.save();
  expect(editor.getSnapshot().draft).toMatchObject({
    content: "draft",
    lost: true,
  });
  expect(await get(canvasId)).toMatchObject({
    content: "agent update",
    revision: 2,
    editState: { status: "unlocked" },
  });
});
test("a lost save response retains text, refuses retries and does not create another revision", async () => {
  const { store, api, get } = await setup();
  const { canvasId } = await store.create(agent, "A", "before");
  const save = vi.fn(async (i: Parameters<EditingApi["save"]>[0]) => {
    await api.save(i);
    throw new Error("response lost");
  });
  const editor = createCanvasEditor(agent.workspaceId, { ...api, save });
  await editor.begin(canvasId);
  editor.change({ content: "saved" });
  await editor.save();
  await editor.save();
  await editor.reacquire();
  expect(save).toHaveBeenCalledTimes(1);
  expect(editor.getSnapshot().draft).toMatchObject({
    content: "saved",
    uncertain: true,
  });
  expect(await get(canvasId)).toMatchObject({
    content: "saved",
    revision: 2,
    editState: { status: "unlocked" },
  });
});
test("late acquisition after unmount is released", async () => {
  const { store, api, get } = await setup();
  const { canvasId } = await store.create(agent, "A", "before");
  let resolve!: () => void;
  const delayed = new Promise<void>((r) => {
    resolve = r;
  });
  const editor = createCanvasEditor(agent.workspaceId, {
    ...api,
    begin: async (i) => {
      const result = await api.begin(i);
      await delayed;
      return result;
    },
  });
  const pending = editor.begin(canvasId);
  editor.dispose();
  resolve();
  await pending;
  expect((await get(canvasId)).editState.status).toBe("unlocked");
});
test("delete checks locks and revisions, cancellation preserves data and successful delete removes reviews", async () => {
  const { store, api, dir, get } = await setup();
  const { canvasId } = await store.create(agent, "A", "before");
  const editor = createCanvasEditor(agent.workspaceId, api);
  editor.requestDelete(await get(canvasId));
  editor.dismissConfirmation();
  expect((await get(canvasId)).revision).toBe(1);
  const lock = await store.acquire(agent, canvasId);
  await expect(
    store.deleteUser(agent.workspaceId, canvasId, 1),
  ).rejects.toMatchObject({ code: "LOCKED" });
  await store.releaseLock(agent, canvasId, lock.lockToken);
  await expect(
    store.deleteUser(agent.workspaceId, canvasId, 2),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await store.reviews.mutate(agent.workspaceId, canvasId, {
    action: "create",
    selection: {
      documentRevision: 1,
      ranges: [{ kind: "block", start: 0, end: 6, selectedText: "before" }],
    },
    body: "Review",
  });
  editor.requestDelete(await get(canvasId));
  await editor.confirmDelete();
  await expect(get(canvasId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    readFile(
      path.join(dir, agent.workspaceId, "reviews", canvasId, "state.json"),
    ),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
test("user saves preserve source tracking for existing review comments", async () => {
  const { store, api } = await setup();
  const { canvasId } = await store.create(agent, "A", "before");
  await store.reviews.mutate(agent.workspaceId, canvasId, {
    action: "create",
    selection: {
      documentRevision: 1,
      ranges: [{ kind: "block", start: 0, end: 6, selectedText: "before" }],
    },
    body: "Review",
  });
  const editor = createCanvasEditor(agent.workspaceId, api);
  await editor.begin(canvasId);
  editor.change({ content: "# Added\n\nbefore" });
  await editor.save();
  const reviews = await store.reviews.get(agent.workspaceId, canvasId);
  expect(JSON.stringify(reviews)).toContain("Review");
  expect(JSON.stringify(reviews)).toContain('"documentRevision":2');
});
test("only schema version two is accepted; old metadata is never rewritten on read", async () => {
  const { store, dir } = await setup();
  const { canvasId } = await store.create(agent, "A", "body");
  const file = path.join(dir, agent.workspaceId, `${canvasId}.md`);
  const old = (await readFile(file, "utf8")).replace(
    "schemaVersion: 2",
    "schemaVersion: 1",
  );
  await writeFile(file, old);
  await expect(store.get(agent.workspaceId, canvasId)).rejects.toMatchObject({
    code: "CORRUPT_DOCUMENT",
  });
  expect(await readFile(file, "utf8")).toBe(old);
});
test("registered RPCs validate inputs, prevent caller-supplied identities, and return only public save results", async () => {
  const { store } = await setup();
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  registerUserEditing(
    {
      handle(contract, handler) {
        handlers.set(contract.name, async (input) =>
          contract.output.parse(
            await handler(contract.input.parse(input), {} as never),
          ),
        );
      },
    } as Pick<PluginServerContext, "handle">,
    async () => store,
  );
  const create = handlers.get("canvas.user.create")!;
  await expect(
    create({
      workspaceId: agent.workspaceId,
      title: "A",
      content: "body",
      agentId: "fake",
    }),
  ).rejects.toThrow();
  await expect(
    create({ workspaceId: agent.workspaceId, title: "A", content: " " }),
  ).rejects.toThrow();
  const result = (await create({
    workspaceId: agent.workspaceId,
    title: "A",
    content: "body",
  })) as { ok: true; value: { canvasId: string; revision: number } };
  expect(Object.keys(result.value).sort()).toEqual(["canvasId", "revision"]);
  expect(
    await handlers.get("canvas.user.begin")!({
      workspaceId: agent.workspaceId,
      canvasId: result.value.canvasId,
    }),
  ).toMatchObject({
    ok: true,
    value: { canvas: { updatedBy: { role: "user" } } },
  });
});

test("the daemon lease clock is authoritative when the client clock is ahead", async () => {
  const { store, api, get } = await setup();
  const { canvasId } = await store.create(agent, "A", "before");
  const editor = createCanvasEditor(agent.workspaceId, api);
  await editor.begin(canvasId);
  editor.change({ content: "after" });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.now() + 3_600_000));
  await editor.save();
  expect(await get(canvasId)).toMatchObject({ content: "after", revision: 2 });
});

test("an expired lease rejects Save even before a renewal detects the loss", async () => {
  const { store, api, get, advance } = await setup();
  const { canvasId } = await store.create(agent, "A", "before");
  const editor = createCanvasEditor(agent.workspaceId, api);
  await editor.begin(canvasId);
  editor.change({ content: "draft" });
  advance(LOCK_TTL_MS + 1);
  await editor.save();
  expect(editor.getSnapshot().draft).toMatchObject({ content: "draft", lost: true });
  expect(await get(canvasId)).toMatchObject({ content: "before", revision: 1 });
});
