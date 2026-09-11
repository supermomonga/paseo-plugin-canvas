import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CanvasStore } from "../server/store";
import { Sessions } from "../server/sessions";
import { dispatchReview, retryDispatch } from "../server/review-dispatch";
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
      start: 0,
      end: 5,
      kind: "text",
      selectedText: "Hello",
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
