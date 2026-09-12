import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
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
    workspaceId: "workspace",
    archivedAt: null,
    pendingPermissions: [] as unknown[],
    activeTurn: null as object | null,
    refresh: vi.fn(async () => {}),
    send: vi.fn(async (_text: string, _options: object) => {}),
  };
  return {
    agent,
    paseo: { agents: { ref: () => agent } } as unknown as Parameters<
      typeof dispatchReview
    >[2],
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

test("recipient labels use refreshed tab titles and provider/model display names, not cached bindings or agent IDs", async () => {
  await sessions.title(actor.agentId, "Old cached name");
  const current = {
    cwd: "/workspace",
    title: "古いタブ名",
    provider: "custom-codex",
    model: "fast",
  };
  const { agent, paseo } = sdk();
  Object.assign(agent, { current: () => current });
  agent.refresh.mockImplementation(async () => {
    current.title = "  Canvasレビューを改善する\n仕様を確認  ";
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
});

test("unnamed sessions and unreported models have explicit labels without guessing the default model", async () => {
  const { agent, paseo } = sdk();
  const current = {
    cwd: "/workspace",
    title: null,
    provider: "claude",
    model: null,
  };
  Object.assign(agent, { current: () => current });
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
  const { agent, paseo } = sdk();
  const ref = vi.fn((id: string) => ({
    ...agent,
    current: () => ({
      cwd: "/workspace",
      title: id === "agent-a" ? "Plan" : "Implement",
      provider: "codex",
      model: "new-model",
    }),
  }));
  const snapshot = vi.fn(async () => ({
    entries: [{ provider: "codex", label: "Codex", models: [] }],
  }));
  Object.assign(paseo, { agents: { ref }, providers: { snapshot } });
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
