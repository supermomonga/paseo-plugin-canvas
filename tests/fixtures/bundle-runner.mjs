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

// Runs the compiled server bundle inside the stock Paseo AgentManager. The
// plugin context is a test double: hooks run through Paseo's own
// PluginHookHandlers, and `paseo` models the one PaseoApi the plugin process
// hands to hooks, handlers and subscriptions (the session stamps pluginId on
// appended rows).
const AGENT_ID = "10000000-0000-4000-8000-000000000001";
const WORKSPACE_ID = "bundle-workspace";
const require = createRequire(import.meta.url);
const hooks = new PluginHookHandlers(() => {});
const handlers = new Map();
let manager;
const paseo = {
  agents: {
    ref: (agentId) => ({
      timeline: {
        append: (item) =>
          manager.appendTimelineItem(agentId, {
            ...item,
            pluginId: "paseo-canvas",
          }),
      },
    }),
  },
};
const invoke = (name, input) => hooks.invoke(randomUUID(), name, input, paseo);
const factory = (0, eval)(readFileSync(process.argv[2], "utf8"));
const module = factory(require);
const cleanupPlugin = module.default({
  addHook: hooks.addHook,
  handle(contract, handler) {
    handlers.set(contract.name, handler);
  },
  // A stored document is absent, so Paseo serves the schema defaults.
  registerSettings(definition) {
    return {
      read: async () => ({
        status: "ready",
        revision: "0",
        values: definition.schema.parse({}),
      }),
      subscribe: () => () => {},
    };
  },
});
/** Runs a subscription handler the way a connected client would. */
function subscribe(name, input) {
  const events = [];
  const controller = new AbortController();
  const finished = handlers.get(name)(input, {
    paseo,
    signal: controller.signal,
    push: async (event) => {
      events.push(event);
    },
  });
  return {
    events,
    finished,
    release: () => controller.abort(),
  };
}
const logger = pino({ level: "silent" });
const registry = new AgentStorage(`${process.argv[2]}.agents`, logger);
const providers = new PluginAgentClientRegistry(logger);
// What the provider received when each session opened.
const opened = [];
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
            const config = input.config.mcpServers.paseo_canvas;
            if (!input.config.mcpServers.existing)
              throw new Error("Existing MCP setting lost");
            if (!config) throw new Error("Canvas MCP was not added");
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
            opened.push(config);
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
manager = new AgentManager({
  logger,
  registry,
  clients: providers.clients(),
  providerDefinitions: providers.definitions(),
  paseoToolsEnabled: false,
  pluginLifecycle: {
    before: invoke,
    emit: (name, event) => {
      void invoke(name, event);
    },
  },
});
async function cleanup() {
  if (manager.getAgent(AGENT_ID)?.session) await manager.closeAgent(AGENT_ID);
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
    const saved = await registry.get(AGENT_ID);
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
      AGENT_ID,
      { workspaceId: WORKSPACE_ID },
    );
  }
  await manager.flush();
  await registry.flush();
  const saved = await registry.get(AGENT_ID);
  // History reads and agents without a workspace get no Canvas server.
  const history = await invoke("agent.open.before", {
    agentId: "history-agent",
    workspaceId: WORKSPACE_ID,
    provider: "custom",
    cwd: process.cwd(),
    reason: "resume",
    purpose: "history",
    title: null,
    background: false,
    labels: {},
    metadata: {},
    tools: [],
    env: {},
    mcpServers: {},
  });
  const detached = await invoke("agent.open.before", {
    agentId: "detached-agent",
    workspaceId: null,
    provider: "custom",
    cwd: process.cwd(),
    reason: "create",
    purpose: "interactive",
    title: null,
    background: false,
    labels: {},
    metadata: {},
    tools: [],
    env: {},
    mcpServers: {},
  });
  process.send({
    type: "ready",
    config: opened.at(-1),
    savedServers: Object.keys(saved.config.mcpServers ?? {}),
    historyServers: Object.keys(history.mcpServers),
    detachedServers: Object.keys(detached.mcpServers),
  });
  let watch;
  process.on("message", async (message) => {
    if (message === "watch") {
      watch = subscribe("canvas.watch", { workspaceId: WORKSPACE_ID });
      await new Promise((resolve) => setTimeout(resolve, 20));
      process.send({ type: "watching", events: watch.events });
    }
    if (message === "watched") {
      process.send({ type: "watched", events: watch.events });
      watch.release();
      await watch.finished;
    }
    if (message === "activity") {
      // Rows arrive through the daemon session the plugin kept from its hooks.
      const deadline = Date.now() + 5_000;
      let items = [];
      while (Date.now() < deadline) {
        items = manager
          .getTimeline(agent.id)
          .filter((item) => item.type === "plugin");
        if (items.length) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      process.send({ type: "activity", items });
    }
    if (message === "list")
      process.send({
        type: "list",
        result: await handlers.get("canvas.list")({ workspaceId: WORKSPACE_ID }),
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
    if (message === "svg") {
      try {
        const image = await handlers.get("canvas.render_graphic")({
          kind: "svg",
          source:
            '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#336699"/></svg>',
        });
        process.send({
          type: "svg",
          width: image.width,
          height: image.height,
          png: image.uri.startsWith("data:image/png;base64,"),
        });
      } catch (error) {
        process.send({ type: "svg-error", message: error.stack });
      }
    }
    if (message === "get") {
      const result = await handlers.get("canvas.get")({
        workspaceId: WORKSPACE_ID,
        canvasId: (
          await handlers.get("canvas.list")({ workspaceId: WORKSPACE_ID })
        ).items[0].canvasId,
      });
      process.send({ type: "document", document: result.document });
    }
    if (message === "close-agent") {
      // The stock AgentManager emits agent.close.after through pluginLifecycle.
      await manager.closeAgent(agent.id);
      process.send({ type: "closed" });
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
