import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PluginHookHandlers } from "../../node_modules/@getpaseo/server/dist/server/server/plugins/lifecycle/index.js";
import { createRequire } from "node:module";
import pino from "pino";
import { AgentManager } from "../../node_modules/@getpaseo/server/dist/server/server/agent/agent-manager.js";
import { AgentStorage } from "../../node_modules/@getpaseo/server/dist/server/server/agent/agent-storage.js";
import { PluginAgentClientRegistry } from "../../node_modules/@getpaseo/server/dist/server/server/agent/plugin-provider.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const require = createRequire(import.meta.url);
const hooks = new PluginHookHandlers(() => {}),
  handlers = new Map();
const invoke = (name, request) =>
  hooks.invoke(randomUUID(), "before", name, request, {});
const factory = (0, eval)(readFileSync(process.argv[2], "utf8"));
const module = factory(require);
const cleanupPlugin = module.default({
  before: hooks.before,
  on: hooks.on,
  handle(contract, handler) {
    handlers.set(contract.name, handler);
  },
});
const logger = pino({ level: "silent" });
const registry = new AgentStorage(`${process.argv[2]}.agents`, logger);
const providers = new PluginAgentClientRegistry(logger);
providers.replace([
  {
    id: "custom",
    label: "MCP test provider",
    async connect() {
      let listener;
      const clients = new Map();
      const capabilities = ["prompt.message", "session.persistence"];
      return {
        version: 1,
        capabilities,
        onEvent(next) {
          listener = next;
          return () => {
            listener = undefined;
          };
        },
        async close() {
          await Promise.all(
            [...clients.values()].map((client) => client.close()),
          );
        },
        async send(input) {
          if (input.type === "catalog") {
            listener({
              type: "catalog",
              requestId: input.requestId,
              catalog: {
                models: [{ id: "fixture", label: "Fixture" }],
                modes: [],
                thinkingOptions: [],
              },
            });
          } else if (input.type === "session.open") {
            if ("PASEO_CANVAS_REGISTRATION" in input.config.env)
              throw new Error(
                "Bootstrap secret leaked into provider environment",
              );
            const config = input.config.mcpServers["paseo-canvas"];
            if (!input.config.mcpServers.existing)
              throw new Error("Existing MCP setting lost");
            const client = new Client({
              name: "custom-provider-fixture",
              version: "1",
            });
            await client.connect(
              new StreamableHTTPClientTransport(new URL(config.url), {
                requestInit: { headers: config.headers },
              }),
            );
            if ((await client.listTools()).tools.length !== 11)
              throw new Error("Canvas tools unavailable");
            clients.set(input.sessionId, client);
            listener({
              type: "session.opened",
              requestId: input.requestId,
              sessionId: input.sessionId,
              capabilities,
              restoration: "core",
              persistence: { version: 1, data: { id: input.sessionId } },
              cwd: input.config.cwd,
            });
            listener({
              type: "session.ready",
              requestId: input.requestId,
              sessionId: input.sessionId,
            });
          } else if (input.type === "session.close") {
            await clients.get(input.sessionId)?.close();
            clients.delete(input.sessionId);
            listener({ type: "session.closed", sessionId: input.sessionId });
          } else if (input.requestId) {
            listener({ type: "request.completed", requestId: input.requestId });
          }
        },
      };
    },
  },
]);
await registry.initialize();
const manager = new AgentManager({
  logger,
  registry,
  clients: providers.clients(),
  providerDefinitions: providers.definitions(),
  paseoToolsEnabled: false,
  pluginLifecycle: {
    before: invoke,
    emit: (name, event) => {
      void hooks.invoke(randomUUID(), "event", name, event, {});
    },
  },
});
async function cleanup() {
  if (manager.getAgent("10000000-0000-4000-8000-000000000001")?.session)
    await manager.closeAgent("10000000-0000-4000-8000-000000000001");
  await manager.flush();
  await registry.flush();
  await providers.shutdown();
  await cleanupPlugin();
  hooks.close();
}
try {
  const resume = process.argv[3] === "resume";
  let agent;
  if (resume) {
    const saved = await registry.get("10000000-0000-4000-8000-000000000001");
    if (!saved?.persistence) throw new Error("Agent persistence was not saved");
    agent = await manager.resumeAgentFromPersistence(
      saved.persistence,
      { ...saved.config, provider: saved.provider, cwd: saved.cwd },
      saved.id,
      { workspaceId: saved.workspaceId },
    );
  } else {
    agent = await manager.createAgent(
      {
        provider: "custom",
        cwd: process.cwd(),
        mcpServers: {
          existing: { type: "http", url: "https://existing.example.com/mcp" },
        },
      },
      "10000000-0000-4000-8000-000000000001",
      { workspaceId: "bundle-workspace", env: { PRESERVED_ENV: "present" } },
    );
  }
  await manager.flush();
  await registry.flush();
  const legacy = await invoke("agent.session_open", {
    agentId: "legacy-agent",
    workspaceId: "bundle-workspace",
    provider: "custom",
    cwd: process.cwd(),
    reason: "resume",
    purpose: "interactive",
    env: {},
  });
  if ("mcpServers" in legacy) throw new Error("Legacy agent was modified");
  process.send({
    type: "ready",
    config: agent.config.mcpServers["paseo-canvas"],
  });
  process.on("message", async (message) => {
    if (message === "sync-activity") {
      // Model the public RPC context. The session stamps pluginId; the real
      // stock AgentManager below owns timeline storage. It does not deduplicate.
      await handlers.get("canvas.sync_activity")(
        { cursor: null },
        {
          paseo: {
            agents: {
              ref: (agentId) => ({
                timeline: {
                  append: (item) =>
                    manager.appendTimelineItem(agentId, {
                      ...item,
                      pluginId: "paseo-canvas",
                    }),
                  refetch: async (options) => {
                    const page = manager.fetchTimeline(agentId, options);
                    return {
                      ...page,
                      entries: page.rows.map((row) => ({ item: row.item })),
                      startCursor: page.rows.length
                        ? { epoch: page.epoch, seq: page.rows[0].seq }
                        : null,
                    };
                  },
                },
              }),
            },
          },
        },
      );
      await manager.flush();
      process.send({
        type: "activity",
        items: manager
          .getTimeline(agent.id)
          .filter((item) => item.type === "plugin"),
      });
    }
    if (message?.type === "watch") {
      const result = await handlers.get("canvas.wait_for_change")({
        workspaceId: "bundle-workspace",
        cursor: message.cursor,
      });
      process.send({ type: "changed", ...result });
    }
    if (message === "list")
      process.send({
        type: "list",
        result: await handlers.get("canvas.list")({
          workspaceId: "bundle-workspace",
        }),
      });
    if (message === "graphic") {
      try {
        const image = await handlers.get("canvas.render_graphic")({
          kind: "math",
          source: "E=mc^2",
          display: true,
          foreground: "#111111",
          background: "#ffffff",
          fontSize: 16,
        });
        process.send({
          type: "graphic",
          width: image.width,
          height: image.height,
          png: image.uri.startsWith("data:image/png;base64,"),
        });
      } catch (error) {
        process.send({ type: "graphic-error", message: error.stack });
      }
    }
    if (message === "get") {
      const result = await handlers.get("canvas.get")({
        workspaceId: "bundle-workspace",
        canvasId: (
          await handlers.get("canvas.list")({ workspaceId: "bundle-workspace" })
        ).items[0].canvasId,
      });
      process.send({ type: "document", document: result.document });
    }
    if (message === "stop") {
      await cleanup();
      process.exit(0);
    }
  });
} catch (error) {
  process.send({ type: "error", message: error.stack });
  await cleanup();
  process.exit(1);
}
