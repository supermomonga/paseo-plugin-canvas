import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CanvasStore } from "../server/store";
import { Sessions } from "../server/sessions";
import {
  dispatchReview,
  retryDispatch,
  recipients,
} from "../server/review-dispatch";
let store: CanvasStore,
  sessions: Sessions,
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
  sessions = await Sessions.open(store);
  await sessions.setPort(12345);
  const token = sessions.register();
  await sessions.activate(actor.agentId, actor.workspaceId, token);
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
  await sessions.close();
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
    } as unknown as Parameters<typeof dispatchReview>[2],
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
  const d = await dispatchReview(store.reviews, sessions, paseo, input());
  expect(d.attempts[0].status).toBe("accepted");
  expect(agent.send).toHaveBeenCalledOnce();
  await expect(
    retryDispatch(store.reviews, sessions, paseo, {
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
    dispatchReview(store.reviews, sessions, paseo, input()),
  ).rejects.toThrow("interrupt");
  agent.pendingPermissions = [{}];
  await expect(
    dispatchReview(store.reviews, sessions, paseo, {
      ...input(),
      allowInterrupt: true,
    }),
  ).rejects.toThrow("permission");
  expect(agent.send).not.toHaveBeenCalled();
});
test("a lost send response is unknown and is only retried explicitly with the same message ID", async () => {
  const { agent, paseo } = sdk();
  agent.send.mockRejectedValueOnce(new Error("Connection lost"));
  const first = await dispatchReview(store.reviews, sessions, paseo, input());
  expect(first.attempts[0].status).toBe("unknown");
  expect(agent.send).toHaveBeenCalledOnce();
  const next = await retryDispatch(store.reviews, sessions, paseo, {
    workspaceId: "workspace",
    canvasId,
    requestId: first.id,
    allowInterrupt: false,
  });
  expect(next.attempts.map((a) => a.status)).toEqual(["unknown", "accepted"]);
  expect(agent.send.mock.calls[1][1]).toEqual({ messageId: first.id });
});

test("recipient labels use listed tab titles and provider/model display names, not cached bindings or agent IDs", async () => {
  await sessions.title(actor.agentId, "Old cached name");
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
  const options = await recipients(sessions, paseo, "workspace");
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
  expect((await recipients(sessions, paseo, "workspace"))[0].title).toBe(
    "Untitled session · Claude Code / Model not reported",
  );
});

test("recipient discovery shares a cwd catalog and preserves distinct send IDs", async () => {
  const token = sessions.register();
  await sessions.activate("agent-b", "workspace", token);
  const { agent, agents, paseo, snapshot } = sdk();
  Object.assign(agent, { title: "Plan", model: "new-model" });
  agents.push({ ...agent, id: "agent-b", title: "Implement" });
  expect(await recipients(sessions, paseo, "workspace")).toEqual([
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
  expect(await recipients(sessions, paseo, "other-workspace")).toEqual([]);
});

test("orphaned registrations survive reload without hiding existing, resumable recipients", async () => {
  for (const id of ["failed-creation", "deleted-agent"])
    await sessions.activate(id, "workspace", sessions.register());
  const saved = await readFile(path.join(root, "mcp.json"), "utf8");
  await sessions.close();
  sessions = await Sessions.open(store);
  const { agent, paseo, ref } = sdk();
  agent.status = "closed";
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(
      (await recipients(sessions, paseo, "workspace")).map((r) => r.id),
    ).toEqual([actor.agentId]);
  }
  expect(ref).not.toHaveBeenCalled();
  expect(
    (await dispatchReview(store.reviews, sessions, paseo, input())).attempts[0]
      .status,
  ).toBe("accepted");
  expect(agent.send).toHaveBeenCalledOnce();
  expect(await readFile(path.join(root, "mcp.json"), "utf8")).toBe(saved);
});

test("recipient discovery reads every page and retains a candidate after 200 other agents", async () => {
  const { agent, paseo, list } = sdk();
  list.mockResolvedValueOnce({
    entries: Array.from({ length: 200 }, (_, i) => ({
      agent: { ...agent, id: `other-${i}` },
      project: null,
    })),
    pageInfo: { nextCursor: "next-page" },
  });
  expect(
    (await recipients(sessions, paseo, "workspace")).map((r) => r.id),
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

test("only matching workspace, unarchived agents with active registrations are eligible", async () => {
  const { agent, agents, paseo } = sdk();
  for (const id of ["other-workspace", "archived", "revoked"]) {
    await sessions.activate(id, "workspace", sessions.register());
    agents.push({ ...agent, id });
  }
  agents[1].workspaceId = "other-workspace";
  agents[2].archivedAt = new Date().toISOString();
  await sessions.revoke("revoked");
  agents.push({ ...agent, id: "unregistered" });
  expect(
    (await recipients(sessions, paseo, "workspace")).map((r) => r.id),
  ).toEqual([actor.agentId]);
});

test("a registration revoked during listing cannot become a recipient", async () => {
  const { paseo, list, agent } = sdk();
  list.mockImplementationOnce(async () => {
    await sessions.revoke(actor.agentId);
    return {
      entries: [{ agent, project: null }],
      pageInfo: { nextCursor: null },
    };
  });
  expect(await recipients(sessions, paseo, "workspace")).toEqual([]);
});

test.each(["first page", "later page", "provider catalog"])(
  "%s failures reject discovery without altering registrations or returning partial results",
  async (failure) => {
    const { paseo, list, snapshot, agent } = sdk();
    const saved = await readFile(path.join(root, "mcp.json"), "utf8");
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
    await expect(recipients(sessions, paseo, "workspace")).rejects.toBe(error);
    expect(await readFile(path.join(root, "mcp.json"), "utf8")).toBe(saved);
    expect(agent.send).not.toHaveBeenCalled();
  },
);

test.each(["deleted", "archived", "moved", "revoked"])(
  "a recipient %s after selection is rejected before recording or sending",
  async (change) => {
    const { agent, agents, paseo } = sdk();
    expect(await recipients(sessions, paseo, "workspace")).toHaveLength(1);
    if (change === "deleted") agents.length = 0;
    if (change === "archived") agent.archivedAt = new Date().toISOString();
    if (change === "moved") agent.workspaceId = "other-workspace";
    if (change === "revoked") await sessions.revoke(actor.agentId);
    await expect(
      dispatchReview(store.reviews, sessions, paseo, input()),
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
    sessions,
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
    sessions,
    paseo,
    input(),
  );
  agents.length = 0;
  await expect(
    retryDispatch(store.reviews, sessions, paseo, {
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
    dispatchReview(store.reviews, sessions, paseo, input()),
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
    sessions,
    paseo,
    input(),
  );
  expect(delivery.attempts[0]).toMatchObject({
    status: "failed",
    error: "Directory offline",
  });
  expect(agent.send).not.toHaveBeenCalled();
});
