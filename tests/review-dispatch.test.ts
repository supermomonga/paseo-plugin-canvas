import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CanvasStore } from "../server/store";
import {
  dispatchReview,
  retryDispatch,
  recipients,
} from "../server/review-dispatch";
let store: CanvasStore,
  root: string,
  canvasId: string,
  threadId: string;
const actor = {
  agentId: "agent-a",
  workspaceId: "workspace",
  sessionId: "session",
  title: "Agent A",
};
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "canvas-dispatch-"));
  store = await CanvasStore.open(root);
  canvasId = (await store.create(actor, "Test", "Hello")).canvasId;
  const result = await store.reviews.mutate(actor.workspaceId, canvasId, {
    action: "create",
    selection: {
      documentRevision: 1,
      ranges: [
        {
          start: 0,
          end: 5,
          kind: "block",
          selectedText: "Hello",
        },
      ],
    },
    body: "Clarify",
  });
  threadId = Object.keys(result.state.threads)[0];
});
afterEach(async () => {
  await store.close();
  await rm(root, { recursive: true, force: true });
});
const input = () => ({
  workspaceId: "workspace",
  canvasId,
  agentId: actor.agentId,
  threads: [{ threadId, expectedRevision: 1 }],
  allowInterrupt: false,
});
function sdk() {
  const agent = {
    id: actor.agentId,
    workspaceId: "workspace",
    archivedAt: null as string | null,
    background: false,
    cwd: "/workspace",
    title: "Agent A" as string | null,
    provider: "codex",
    model: "gpt-5.4" as string | null,
    status: "idle",
    pendingPermissions: [] as unknown[],
    activeTurn: null as object | null,
    send: vi.fn(async (_text: string, _options: object) => {}),
  };
  const agents = [agent];
  const list = vi.fn(async (_options: unknown) => ({
    entries: agents.map((agent) => ({ agent: { ...agent }, project: null })),
    pageInfo: { nextCursor: null as string | null },
  }));
  const ref = vi.fn(() => ({ send: agent.send }));
  const snapshot = vi.fn(async (_options: unknown) => ({
    entries: [{ provider: "codex", label: "Codex", models: [] }],
  }));
  return {
    agent,
    agents,
    list,
    ref,
    snapshot,
    paseo: {
      agents: { list, ref },
      providers: { snapshot },
    } as unknown as Parameters<typeof dispatchReview>[1],
  };
}
test("only explicit send dispatches once, with a durable message ID and real prompt", async () => {
  const { agent, paseo } = sdk();
  agent.send.mockImplementation(async (text, options) => {
    const state = (await store.reviews.get("workspace", canvasId)).state;
    const delivery = Object.values(state.deliveries)[0];
    expect(delivery.attempts[0].status).toBe("sending");
    expect(options).toEqual({ messageId: delivery.id });
    expect(text).toContain("canvas.review.reply");
  });
  const d = await dispatchReview(store.reviews, paseo, input());
  expect(d.attempts[0].status).toBe("accepted");
  expect(agent.send).toHaveBeenCalledOnce();
  await expect(
    retryDispatch(store.reviews, paseo, {
      workspaceId: "workspace",
      canvasId,
      requestId: d.id,
      allowInterrupt: false,
    }),
  ).rejects.toThrow("already accepted");
});
test("running and permission-waiting agents require action before any SDK send", async () => {
  const { agent, paseo } = sdk();
  agent.activeTurn = {};
  await expect(
    dispatchReview(store.reviews, paseo, input()),
  ).rejects.toThrow("interrupt");
  agent.pendingPermissions = [{}];
  await expect(
    dispatchReview(store.reviews, paseo, {
      ...input(),
      allowInterrupt: true,
    }),
  ).rejects.toThrow("permission");
  expect(agent.send).not.toHaveBeenCalled();
});
test("a lost send response is unknown and is only retried explicitly with the same message ID", async () => {
  const { agent, paseo } = sdk();
  agent.send.mockRejectedValueOnce(new Error("Connection lost"));
  const first = await dispatchReview(store.reviews, paseo, input());
  expect(first.attempts[0].status).toBe("unknown");
  expect(agent.send).toHaveBeenCalledOnce();
  const next = await retryDispatch(store.reviews, paseo, {
    workspaceId: "workspace",
    canvasId,
    requestId: first.id,
    allowInterrupt: false,
  });
  expect(next.attempts.map((a) => a.status)).toEqual(["unknown", "accepted"]);
  expect(agent.send.mock.calls[1][1]).toEqual({ messageId: first.id });
});

test("recipient labels use listed tab titles and provider/model display names, not agent IDs", async () => {
  const { agent, paseo, ref } = sdk();
  Object.assign(agent, {
    cwd: "/workspace",
    title: "  Canvasレビューを改善する\n仕様を確認  ",
    provider: "custom-codex",
    model: "fast",
  });
  const snapshot = vi.fn(async () => ({
    entries: [
      {
        provider: "custom-codex",
        label: "Team Codex",
        models: [{ id: "gpt-5.4", aliases: ["fast"], label: "GPT-5.4" }],
      },
    ],
  }));
  Object.assign(paseo, { providers: { snapshot } });
  const options = await recipients(paseo, "workspace");
  expect(options).toEqual([
    {
      id: actor.agentId,
      title: "Canvasレビューを改善する 仕様を確認 · Team Codex / GPT-5.4",
      running: false,
      blocked: false,
    },
  ]);
  expect(snapshot).toHaveBeenCalledWith({ cwd: "/workspace" });
  expect(agent.send).not.toHaveBeenCalled();
  expect(ref).not.toHaveBeenCalled();
});

test("unnamed sessions and unreported models have explicit labels without guessing the default model", async () => {
  const { agent, paseo } = sdk();
  Object.assign(agent, {
    cwd: "/workspace",
    title: null,
    provider: "claude",
    model: null,
  });
  Object.assign(paseo, {
    providers: {
      snapshot: vi.fn(async () => ({
        entries: [
          {
            provider: "claude",
            label: "Claude Code",
            models: [
              { id: "default", label: "Default Sonnet", isDefault: true },
            ],
          },
        ],
      })),
    },
  });
  expect((await recipients(paseo, "workspace"))[0].title).toBe(
    "Untitled session · Claude Code / Model not reported",
  );
});

test("recipient discovery shares a cwd catalog and preserves distinct send IDs", async () => {
  const { agent, agents, paseo, snapshot } = sdk();
  Object.assign(agent, { title: "Plan", model: "new-model" });
  agents.push({ ...agent, id: "agent-b", title: "Implement" });
  expect(await recipients(paseo, "workspace")).toEqual([
    {
      id: "agent-a",
      title: "Plan · Codex / new-model",
      running: false,
      blocked: false,
    },
    {
      id: "agent-b",
      title: "Implement · Codex / new-model",
      running: false,
      blocked: false,
    },
  ]);
  expect(snapshot).toHaveBeenCalledOnce();
  expect(await recipients(paseo, "other-workspace")).toEqual([]);
});

test("agents opened before Canvas started are recipients; sending reopens them with Canvas", async () => {
  // No Canvas credential exists for this agent yet. Paseo reopens a stale or
  // closed session before the prompt, and that opening adds Canvas (ADR 18).
  const { agent, paseo, ref } = sdk();
  agent.status = "closed";
  expect((await recipients(paseo, "workspace")).map((r) => r.id)).toEqual([
    actor.agentId,
  ]);
  expect(ref).not.toHaveBeenCalled();
  expect(
    (await dispatchReview(store.reviews, paseo, input())).attempts[0].status,
  ).toBe("accepted");
  expect(agent.send).toHaveBeenCalledOnce();
});

test("recipient discovery reads every page and retains a candidate after 200 other agents", async () => {
  const { agent, paseo, list } = sdk();
  list.mockResolvedValueOnce({
    entries: Array.from({ length: 200 }, (_, i) => ({
      agent: { ...agent, id: `other-${i}`, workspaceId: "other-workspace" },
      project: null,
    })),
    pageInfo: { nextCursor: "next-page" },
  });
  expect(
    (await recipients(paseo, "workspace")).map((r) => r.id),
  ).toEqual([actor.agentId]);
  expect(list.mock.calls.map(([options]) => options)).toEqual([
    {
      filter: { includeArchived: false },
      sort: [{ key: "created_at", direction: "asc" }],
      page: { limit: 200 },
    },
    {
      filter: { includeArchived: false },
      sort: [{ key: "created_at", direction: "asc" }],
      page: { limit: 200, cursor: "next-page" },
    },
  ]);
});

test("only visible, unarchived agents of the workspace are eligible", async () => {
  const { agent, agents, paseo } = sdk();
  for (const id of ["other-workspace", "archived", "background", "plain"])
    agents.push({ ...agent, id });
  agents[1].workspaceId = "other-workspace";
  agents[2].archivedAt = new Date().toISOString();
  agents[3].background = true;
  expect((await recipients(paseo, "workspace")).map((r) => r.id)).toEqual([
    actor.agentId,
    "plain",
  ]);
});

test.each(["first page", "later page", "provider catalog"])(
  "%s failures reject discovery without returning partial results",
  async (failure) => {
    const { paseo, list, snapshot, agent } = sdk();
    const error = new Error("Unavailable");
    if (failure === "provider catalog") snapshot.mockRejectedValueOnce(error);
    else {
      if (failure === "later page")
        list.mockResolvedValueOnce({
          entries: [{ agent, project: null }],
          pageInfo: { nextCursor: "next-page" },
        });
      list.mockRejectedValueOnce(error);
    }
    await expect(recipients(paseo, "workspace")).rejects.toBe(error);
    expect(agent.send).not.toHaveBeenCalled();
  },
);

test.each(["deleted", "archived", "moved", "hidden"])(
  "a recipient %s after selection is rejected before recording or sending",
  async (change) => {
    const { agent, agents, paseo } = sdk();
    expect(await recipients(paseo, "workspace")).toHaveLength(1);
    if (change === "deleted") agents.length = 0;
    if (change === "archived") agent.archivedAt = new Date().toISOString();
    if (change === "moved") agent.workspaceId = "other-workspace";
    if (change === "hidden") agent.background = true;
    await expect(
      dispatchReview(store.reviews, paseo, input()),
    ).rejects.toMatchObject({ code: "RECIPIENT_UNAVAILABLE" });
    expect(
      (await store.reviews.get("workspace", canvasId)).state.deliveries,
    ).toEqual({});
    expect(agent.send).not.toHaveBeenCalled();
  },
);

test("the second preflight catches disappearance after recording and marks the attempt failed", async () => {
  const { paseo, list, agent } = sdk();
  list.mockResolvedValueOnce({
    entries: [{ agent, project: null }],
    pageInfo: { nextCursor: null },
  });
  list.mockResolvedValue({ entries: [], pageInfo: { nextCursor: null } });
  const delivery = await dispatchReview(
    store.reviews,
    paseo,
    input(),
  );
  expect(delivery.attempts[0]).toMatchObject({
    status: "failed",
    error: expect.stringContaining("no longer available"),
  });
  expect(agent.send).not.toHaveBeenCalled();
});

test("manual retry checks the current directory before creating another attempt", async () => {
  const { paseo, agent, agents } = sdk();
  agent.send.mockRejectedValueOnce(new Error("Connection lost"));
  const delivery = await dispatchReview(
    store.reviews,
    paseo,
    input(),
  );
  agents.length = 0;
  await expect(
    retryDispatch(store.reviews, paseo, {
      workspaceId: "workspace",
      canvasId,
      requestId: delivery.id,
      allowInterrupt: false,
    }),
  ).rejects.toMatchObject({ code: "RECIPIENT_UNAVAILABLE" });
  expect(
    (await store.reviews.delivery("workspace", canvasId, delivery.id)).attempts,
  ).toHaveLength(1);
  expect(agent.send).toHaveBeenCalledOnce();
});

test("listing failures prevent initial dispatch and keep recorded attempts failed before SDK send", async () => {
  const { paseo, agent, list } = sdk();
  const error = new Error("Directory offline");
  list.mockRejectedValueOnce(error);
  await expect(
    dispatchReview(store.reviews, paseo, input()),
  ).rejects.toBe(error);
  expect(
    (await store.reviews.get("workspace", canvasId)).state.deliveries,
  ).toEqual({});
  list.mockResolvedValueOnce({
    entries: [{ agent, project: null }],
    pageInfo: { nextCursor: null },
  });
  list.mockRejectedValueOnce(error);
  const delivery = await dispatchReview(
    store.reviews,
    paseo,
    input(),
  );
  expect(delivery.attempts[0]).toMatchObject({
    status: "failed",
    error: "Directory offline",
  });
  expect(agent.send).not.toHaveBeenCalled();
});
