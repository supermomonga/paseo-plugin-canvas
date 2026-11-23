import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createTestPaseoDaemon } from "../node_modules/@getpaseo/server/dist/server/server/test-utils/paseo-daemon.js";
import { createTestAgentClient } from "../node_modules/@getpaseo/server/dist/server/server/test-utils/fake-agent-client.js";
import { DaemonClient } from "../node_modules/@getpaseo/server/dist/server/server/test-utils/daemon-client.js";

// Installs this directory into a real Paseo 0.17.3 daemon, the way a user's
// daemon loads it: compiled by Paseo, run as a plugin subprocess, with hooks,
// handlers and timeline appends crossing the real plugin session.
type McpServer = { type: string; url: string; headers?: Record<string, string> };
const saved = { ...process.env };
afterEach(() => {
  for (const name of ["HOME", "XDG_DATA_HOME", "LOCALAPPDATA", "PASEO_HOME"])
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
});

test("a real daemon gives existing and new agents launch-only Canvas MCP, and a turn delivers the timeline row", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "canvas-daemon-"));
  // The plugin subprocess inherits this environment: keep Canvas storage away
  // from the user's own daemon and its lock.
  process.env.HOME = root;
  process.env.XDG_DATA_HOME = path.join(root, "data");
  process.env.LOCALAPPDATA = path.join(root, "data");
  const launches: { agentId?: string; servers: Record<string, McpServer> }[] = [];
  let saveDuringTurn: (() => Promise<unknown>) | undefined;
  const inner = createTestAgentClient("codex", {
    supportsMcpServers: true,
    beforeTurnComplete: async () => {
      await saveDuringTurn?.();
    },
  });
  const daemon = await createTestPaseoDaemon({
    daemonVersion: "0.17.3",
    mcpEnabled: false,
    agentClients: {
      codex: {
        ...inner,
        isAvailable: () => inner.isAvailable(),
        fetchCatalog: (options: never) => inner.fetchCatalog(options),
        createSession: async (...args: Parameters<typeof inner.createSession>) => {
          launches.push({
            agentId: args[1]?.agentId,
            servers: (args[0].mcpServers ?? {}) as Record<string, McpServer>,
          });
          return inner.createSession(...args);
        },
        resumeSession: async (...args: Parameters<typeof inner.resumeSession>) => {
          launches.push({
            agentId: args[2]?.agentId,
            servers: {
              ...(args[1]?.mcpServers ?? {}),
              ...(args[2]?.mcpServers ?? {}),
            } as Record<string, McpServer>,
          });
          return inner.resumeSession(...args);
        },
      } as typeof inner,
    },
  });
  process.env.PASEO_HOME = daemon.paseoHome;
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.17.3",
  });
  const mcp = new Client({ name: "canvas-e2e", version: "1" });
  const workspaceDirectory = path.join(root, "workspace");
  try {
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
    const { mkdir } = await import("node:fs/promises");
    await mkdir(workspaceDirectory);
    // An agent that exists before Canvas is installed.
    const existing = await client.createAgent({
      provider: "codex",
      cwd: workspaceDirectory,
    });
    expect(launches.at(-1)?.servers.paseo_canvas).toBeUndefined();
    await client.patchDaemonConfig({ pluginsEnabled: true });
    const installed = await client.installDirectoryPlugin(process.cwd());
    expect(installed).toMatchObject({ id: "paseo-canvas" });
    await expect
      .poll(async () =>
        (await client.listPlugins()).find((plugin) => plugin.id === "paseo-canvas"),
      { timeout: 30_000 })
      .toMatchObject({ status: "running" });

    // A new agent receives the server for this launch only.
    const agent = await client.createAgent({
      provider: "codex",
      cwd: workspaceDirectory,
    });
    const descriptor = launches.at(-1)!.servers.paseo_canvas;
    expect(descriptor).toMatchObject({ type: "http" });
    expect(descriptor.headers?.Authorization).toMatch(/^Bearer /);
    expect(
      daemon.daemon.agentManager.getAgent(agent.id)?.config.mcpServers ?? {},
    ).not.toHaveProperty("paseo_canvas");

    // The agent created before the plugin gets Canvas when it reopens.
    await daemon.daemon.agentManager.reloadAgentSession(existing.id);
    expect(launches.at(-1)?.servers.paseo_canvas).toMatchObject({
      type: "http",
      url: descriptor.url,
    });

    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(descriptor.url), {
        requestInit: { headers: descriptor.headers },
      }),
    );
    expect((await mcp.listTools()).tools).toHaveLength(11);
    // The agent saves a canvas during its turn; the turn-end hook delivers the
    // row through the plugin's own daemon session, with no app subscribed.
    let created: { canvasId: string; timeline: string } | undefined;
    saveDuringTurn = async () => {
      const result = await mcp.callTool({
        name: "canvas.create",
        arguments: { title: "Plan", content: "# Plan" },
      });
      created = JSON.parse((result.content as { text: string }[])[0].text);
    };
    await client.sendMessage(agent.id, "Write the plan to a canvas");
    await client.waitForFinish(agent.id, 30_000);
    expect(created).toMatchObject({ saved: true, timeline: "queued" });
    await expect
      .poll(
        () =>
          daemon.daemon.agentManager
            .getTimeline(agent.id)
            .filter((item) => item.type === "plugin"),
        { timeout: 15_000 },
      )
      .toMatchObject([
        {
          type: "plugin",
          pluginId: "paseo-canvas",
          kind: "canvas-activity",
          id: `canvas-${created!.canvasId}-1`,
          data: { title: "Plan", revision: 1, action: "created" },
        },
      ]);
  } finally {
    await mcp.close();
    await client.close();
    await daemon.close();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
