import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CanvasStore } from "../server/store";
import { Sessions } from "../server/sessions";
import { CanvasActivityQueue } from "../server/activity";
import { startMcp } from "../server/mcp";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
test("real HTTP MCP: scoped A/B sharing, locks, third workspace isolation and credential revocation", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "canvas-mcp-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const store = await CanvasStore.open(dir);
  cleanup.push(() => store.close());
  const activity = await CanvasActivityQueue.open(dir);
  cleanup.push(() => activity.close());
  const enqueue = vi.spyOn(activity, "enqueue");
  const sessions = await Sessions.open(store),
    mcp = await startMcp(store, sessions, activity);
  cleanup.push(() => sessions.close());
  cleanup.push(() => mcp.close());
  async function connect(agent: string, workspace: string) {
    const token = sessions.register();
    await sessions.activate(agent, workspace, token);
    const client = new Client({ name: agent, version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(mcp.url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    cleanup.push(() => client.close());
    return { client, token };
  }
  const a = await connect("agent-a", "workspace-a"),
    b = await connect("agent-b", "workspace-a"),
    c = await connect("agent-c", "workspace-b");
  async function call(client: Client, name: string, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    return {
      error: result.isError,
      data: JSON.parse((result.content as { text: string }[])[0].text),
    };
  }
  expect((await a.client.listTools()).tools).toHaveLength(11);
  const created = await call(a.client, "canvas.create", {
    title: "Plan",
    content: "# Plan",
  });
  expect(created.error).not.toBe(true);
  expect(created.data).toMatchObject({
    saved: true,
    revision: 1,
    diagnostics: [],
    timeline: "queued",
  });
  expect(enqueue).toHaveBeenCalledWith(
    "agent-a",
    expect.objectContaining({ action: "created", workspaceId: "workspace-a" }),
  );
  const canvasId = created.data.canvasId;
  const review = await store.reviews.mutate("workspace-a", canvasId, {
    action: "create",
    selection: {
      documentRevision: 1,
      ranges: [
        {
          start: 2,
          end: 6,
          kind: "block",
          selectedText: "Plan",
        },
      ],
    },
    body: "Explain the implementation",
  });
  const thread = Object.values(review.state.threads)[0];
  const request = await store.reviews.begin(
    "workspace-a",
    canvasId,
    "agent-b",
    [{ threadId: thread.id, expectedRevision: thread.revision }],
  );
  const current = await call(b.client, "canvas.review.get", {
    canvasId,
    threadId: thread.id,
  });
  expect(current.data.thread.currentRequestId).toBe(request.id);
  expect(
    (await call(c.client, "canvas.review.list", { canvasId })).data.code,
  ).toBe("NOT_FOUND");
  expect(
    (
      await call(a.client, "canvas.review.reply", {
        canvasId,
        threadId: thread.id,
        expectedRevision: 2,
        requestId: request.id,
        kind: "question",
        body: "Which scope?",
      })
    ).error,
  ).toBe(true);
  const reply = await call(b.client, "canvas.review.reply", {
    canvasId,
    threadId: thread.id,
    expectedRevision: 2,
    requestId: request.id,
    kind: "question",
    body: "Which scope?",
  });
  expect(reply.data.thread.status).toBe("needs_user_review");
  expect(reply.data.thread.messages.at(-1).author.agentId).toBe("agent-b");
  const lease = await call(a.client, "lock.acquire", { canvasId });
  expect(
    (await call(b.client, "canvas.get", { canvasId })).data.canvas.editState
      .lock.owner.agentId,
  ).toBe("agent-a");
  expect((await call(b.client, "lock.acquire", { canvasId })).data.code).toBe(
    "LOCKED",
  );
  expect((await call(c.client, "canvas.get", { canvasId })).data.code).toBe(
    "NOT_FOUND",
  );
  await call(a.client, "canvas.update", {
    canvasId,
    lockToken: lease.data.lockToken,
    expectedRevision: 1,
    content: "## 実装プラン\n- [x] 保存",
  });
  expect(
    (await call(b.client, "canvas.get", { canvasId })).data.canvas.content,
  ).toContain("実装プラン");
  expect(
    JSON.stringify((await call(b.client, "canvas.list")).data),
  ).not.toContain(lease.data.lockToken);
  expect((await fetch(mcp.url, { method: "POST" })).status).toBe(401);
  expect(
    (
      await fetch(mcp.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${a.token}`,
          Origin: "https://example.com",
        },
      })
    ).status,
  ).toBe(403);
  const invalid = await call(a.client, "canvas.update", {
    canvasId,
    lockToken: lease.data.lockToken,
    expectedRevision: 2,
    content:
      "# Plan\n\n```mermaid\nsequenceDiagram\nA->>B: hi\nloop retry\nend\n```",
  });
  expect(invalid.error).not.toBe(true);
  expect(invalid.data).toMatchObject({
    saved: true,
    revision: 3,
    diagnosticCount: 2,
  });
  expect(invalid.data.diagnostics[0]).toMatchObject({
    line: 6,
    source: "loop retry",
  });
  const renamed = await call(a.client, "canvas.update", {
    canvasId,
    lockToken: lease.data.lockToken,
    expectedRevision: 3,
    title: "Renamed",
  });
  expect(renamed.data).toMatchObject({
    saved: true,
    revision: 4,
    diagnosticCount: 2,
  });
  expect(enqueue).toHaveBeenLastCalledWith(
    "agent-a",
    expect.objectContaining({ title: "Renamed", revision: 4 }),
  );
  enqueue.mockRejectedValueOnce(new Error("Disk full"));
  const repaired = await call(a.client, "canvas.update", {
    canvasId,
    lockToken: lease.data.lockToken,
    expectedRevision: 4,
    content: "```mermaid\nsequenceDiagram\nA->>B: fixed\n```",
  });
  expect(repaired.error).not.toBe(true);
  expect(repaired.data).toMatchObject({
    saved: true,
    revision: 5,
    diagnostics: [],
    timeline: "failed",
  });
  expect(repaired.data.warnings[0].code).toBe("TIMELINE_QUEUE_FAILED");
  expect((await store.get("workspace-a", canvasId)).canvas.revision).toBe(5);
  const beforeConflict = enqueue.mock.calls.length;
  const conflict = await call(a.client, "canvas.update", {
    canvasId,
    lockToken: lease.data.lockToken,
    expectedRevision: 1,
    content: "wrong",
  });
  expect(conflict.error).toBe(true);
  expect(enqueue.mock.calls.length).toBe(beforeConflict);
  await sessions.revoke("agent-a");
  expect(
    (
      await fetch(mcp.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${a.token}` },
      })
    ).status,
  ).toBe(401);
});
