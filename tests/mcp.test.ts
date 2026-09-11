import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CanvasStore } from "../server/store";
import { Sessions } from "../server/sessions";
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
  const sessions = await Sessions.open(store),
    mcp = await startMcp(store, sessions);
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
  expect((await a.client.listTools()).tools).toHaveLength(8);
  const created = await call(a.client, "canvas.create", {
    title: "Plan",
    content: "# Plan",
  });
  const canvasId = created.data.canvasId;
  const lease = await call(a.client, "lock.acquire", { canvasId });
  expect(
    (await call(b.client, "canvas.get", { canvasId })).data.canvas.editState
      .lock.ownerAgentId,
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
