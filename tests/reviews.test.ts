import { afterEach, beforeEach, expect, test } from "vitest";
import {
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CanvasStore } from "../server/store";
import { type Actor } from "../shared/contracts";
import { trackAnchor } from "../server/review-tracking";
let store: CanvasStore, root: string, canvasId: string;
const actor: Actor = {
  agentId: "agent-a",
  workspaceId: "workspace",
  sessionId: "session-a",
  title: "Agent A",
};
const body = "# Plan\n\nHello world.\n\nNext paragraph.\n";
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "canvas-review-"));
  store = await CanvasStore.open(root);
  canvasId = (await store.create(actor, "Plan", body)).canvasId;
});
afterEach(async () => {
  await store.close();
  await rm(root, { recursive: true, force: true });
});
const selection = {
  documentRevision: 1,
  kind: "text" as const,
  start: 8,
  end: 13,
  selectedText: "Hello",
};
async function create() {
  return store.reviews.mutate("workspace", canvasId, {
    action: "create",
    selection,
    body: "Make this clearer",
  });
}
async function update(content: string) {
  const { lockToken } = await store.acquire(actor, canvasId);
  const { canvas } = await store.get("workspace", canvasId);
  await store.update(actor, {
    canvasId,
    lockToken,
    expectedRevision: canvas.revision,
    content,
  });
  await store.releaseLock(actor, canvasId, lockToken);
}
test("read does not create files; persisted comments restore with exact source snapshots", async () => {
  expect((await store.reviews.get("workspace", canvasId)).state.revision).toBe(
    0,
  );
  expect(await readdir(path.join(root, "workspace"))).toEqual([
    canvasId + ".md",
  ]);
  const result = await create(),
    thread = Object.values(result.state.threads)[0];
  expect(result.projections[thread.id]).toEqual({
    start: 8,
    end: 13,
    reason: null,
  });
  const dir = path.join(root, "workspace", "reviews", canvasId);
  expect(await readFile(path.join(dir, "snapshots", "1.md"), "utf8")).toBe(
    body,
  );
  const json = await readFile(path.join(dir, "state.json"), "utf8");
  expect(json).toBe(JSON.stringify(result.state, null, 2) + "\n");
  expect((await store.get("workspace", canvasId)).canvas.revision).toBe(1);
  await store.close();
  store = await CanvasStore.open(root);
  expect((await store.reviews.get("workspace", canvasId)).state).toEqual(
    result.state,
  );
});
test("unchanged ranges follow inserts; changed source becomes outdated and reattachment retains history", async () => {
  const thread = Object.values((await create()).state.threads)[0];
  await update("Preface\n" + body);
  expect(
    (await store.reviews.get("workspace", canvasId)).projections[thread.id]
      .start,
  ).toBe(16);
  await update("Preface\n" + body.replace("Hello", "Goodbye"));
  expect(
    (await store.reviews.get("workspace", canvasId)).projections[thread.id]
      .reason,
  ).not.toBeNull();
  const result = await store.reviews.mutate("workspace", canvasId, {
    action: "reattach",
    threadId: thread.id,
    expectedRevision: 1,
    selection: {
      ...selection,
      documentRevision: 3,
      start: 16,
      end: 23,
      selectedText: "Goodbye",
    },
  });
  expect(result.state.threads[thread.id].anchors).toHaveLength(2);
  expect(Object.keys(result.state.snapshots)).toEqual(["1", "3"]);
});
test("rejects stale selections, message edits and concurrent resolve without losing content", async () => {
  const t = Object.values((await create()).state.threads)[0];
  await store.reviews.mutate("workspace", canvasId, {
    action: "reply",
    threadId: t.id,
    expectedRevision: 1,
    body: "Also explain why",
  });
  await expect(
    store.reviews.mutate("workspace", canvasId, {
      action: "status",
      threadId: t.id,
      expectedRevision: 1,
      resolved: true,
    }),
  ).rejects.toThrow("Review changed");
  await update(body + "Added");
  await expect(create()).rejects.toThrow("Canvas changed");
  expect(
    (await store.reviews.get("workspace", canvasId)).state.threads[t.id]
      .messages,
  ).toHaveLength(2);
});
test("dispatch freezes content, replies require current assignee, restart marks unknown without resending", async () => {
  const t = Object.values((await create()).state.threads)[0];
  const delivery = await store.reviews.begin("workspace", canvasId, "agent-a", [
    { threadId: t.id, expectedRevision: 1 },
  ]);
  await expect(
    store.reviews.mutate("workspace", canvasId, {
      action: "edit",
      threadId: t.id,
      expectedRevision: 2,
      messageId: t.messages[0].id,
      body: "Changed",
    }),
  ).rejects.toThrow("Only unsent");
  await expect(
    store.reviews.reply(
      { ...actor, agentId: "agent-b" },
      {
        canvasId,
        threadId: t.id,
        expectedRevision: 2,
        requestId: delivery.id,
        kind: "question",
        body: "Why?",
      },
    ),
  ).rejects.toThrow("not assigned");
  await store.close();
  store = await CanvasStore.open(root);
  expect(
    (await store.reviews.delivery("workspace", canvasId, delivery.id))
      .attempts[0].status,
  ).toBe("unknown");
  await store.reviews.reply(actor, {
    canvasId,
    threadId: t.id,
    expectedRevision: 2,
    requestId: delivery.id,
    kind: "question",
    body: "Which audience?",
  });
  const next = (await store.reviews.get("workspace", canvasId)).state.threads[
    t.id
  ];
  expect(next.status).toBe("needs_user_review");
  await expect(store.reviews.get("other", canvasId)).rejects.toThrow(
    "Canvas does not exist",
  );
});
test("corrupt snapshots are errors and never replaced with empty comments", async () => {
  await create();
  const file = path.join(
    root,
    "workspace",
    "reviews",
    canvasId,
    "snapshots",
    "1.md",
  );
  await writeFile(file, "wrong");
  await expect(store.reviews.get("workspace", canvasId)).rejects.toThrow(
    "hash",
  );
  expect(await readFile(file, "utf8")).toBe("wrong");
});
test("ambiguous repetitions and changes within a selection are not guessed", () => {
  const source = "same same",
    a = {
      ...selection,
      id: "anchor",
      documentRevision: 1,
      start: 0,
      end: 4,
      sourceText: "same",
      prefix: "",
      suffix: "",
      createdAt: new Date().toISOString(),
    };
  expect(trackAnchor(a, source, "intro same same").reason).toContain(
    "ambiguous",
  );
  expect(
    trackAnchor({ ...a, end: 9, sourceText: source }, source, "same new same")
      .reason,
  ).toContain("changed");
});

test("snapshot committed before state is an orphan; state remains valid and recovery removes only unreferenced files", async () => {
  const reviews = store.reviews as unknown as {
    write: (file: string, body: string) => Promise<void>;
  };
  const original = reviews.write.bind(reviews);
  let states = 0;
  reviews.write = async (file, body) => {
    if (file.endsWith("state.json") && ++states === 2)
      throw new Error("Stopped before state replacement");
    return original(file, body);
  };
  await expect(create()).rejects.toThrow("Stopped");
  await store.close();
  store = await CanvasStore.open(root);
  const result = await store.reviews.get("workspace", canvasId);
  expect(Object.keys(result.state.threads)).toHaveLength(0);
  expect(
    await readdir(
      path.join(root, "workspace", "reviews", canvasId, "snapshots"),
    ),
  ).toEqual([]);
});
test("a replaced state survives a lost response and missing snapshots fail closed on restart", async () => {
  const reviews = store.reviews as unknown as {
    write: (file: string, body: string) => Promise<void>;
  };
  const original = reviews.write.bind(reviews);
  let states = 0;
  reviews.write = async (file, body) => {
    await original(file, body);
    if (file.endsWith("state.json") && ++states === 2)
      throw new Error("Lost response after replacement");
  };
  await expect(create()).rejects.toThrow("Lost response");
  await store.close();
  store = await CanvasStore.open(root);
  expect(
    Object.keys((await store.reviews.get("workspace", canvasId)).state.threads),
  ).toHaveLength(1);
  await rm(
    path.join(root, "workspace", "reviews", canvasId, "snapshots", "1.md"),
  );
  await expect(store.reviews.get("workspace", canvasId)).rejects.toThrow(
    "snapshot is missing",
  );
});
test("unknown schemas cannot erase review data", async () => {
  await create();
  const file = path.join(root, "workspace", "reviews", canvasId, "state.json"),
    original = await readFile(file, "utf8");
  await writeFile(
    file,
    original.replace('"schemaVersion": 1', '"schemaVersion": 999'),
  );
  await expect(store.reviews.get("workspace", canvasId)).rejects.toThrow(
    "schemaVersion",
  );
  expect(await readFile(file, "utf8")).toContain('"schemaVersion": 999');
});
test("canvas deletion makes reviews inaccessible and removes snapshots", async () => {
  await create();
  const { lockToken } = await store.acquire(actor, canvasId);
  await store.delete(actor, { canvasId, lockToken, expectedRevision: 1 });
  await expect(store.reviews.get("workspace", canvasId)).rejects.toThrow(
    "Canvas does not exist",
  );
  expect(await readdir(path.join(root, "workspace", "reviews"))).toEqual([]);
});

test("symbolic links in review storage fail closed without changing their target", async () => {
  await create();
  const file = path.join(
    root,
    "workspace",
    "reviews",
    canvasId,
    "snapshots",
    "1.md",
  );
  const target = path.join(root, "external.md");
  await writeFile(target, body);
  await rm(file);
  await symlink(target, file);
  await expect(store.reviews.get("workspace", canvasId)).rejects.toThrow(
    "file type",
  );
  await store.close();
  await expect(CanvasStore.open(root)).rejects.toThrow("file type");
  expect(await readFile(target, "utf8")).toBe(body);
  await rm(file);
  await writeFile(file, body);
  store = await CanvasStore.open(root);
});

test("directory sync failure after state replacement stops document and review writes", async () => {
  await create();
  const io = store.reviews as unknown as {
    sync: (dir: string) => Promise<void>;
  };
  const original = io.sync.bind(io);
  const dir = path.join(root, "workspace", "reviews", canvasId);
  io.sync = async (target) => {
    if (target === dir) throw new Error("Injected directory sync failure");
    await original(target);
  };
  const t = Object.values(
    (await store.reviews.get("workspace", canvasId)).state.threads,
  )[0];
  await expect(
    store.reviews.mutate("workspace", canvasId, {
      action: "reply",
      threadId: t.id,
      expectedRevision: t.revision,
      body: "Preserve this reply",
    }),
  ).rejects.toThrow("sync failure");
  await expect(store.create(actor, "Blocked", "text")).rejects.toThrow();
  await store.close();
  store = await CanvasStore.open(root);
  expect(
    Object.values(
      (await store.reviews.get("workspace", canvasId)).state.threads,
    )[0].messages.at(-1)?.body,
  ).toBe("Preserve this reply");
});
