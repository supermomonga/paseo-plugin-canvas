import type {
  PluginServerContext,
  PluginSessionOpenRequest,
} from "@getpaseo/plugin/server";
import type { AgentSessionConfig } from "@getpaseo/protocol/agent-types";
import { createPluginLogger } from "paseo-plugin-helper/server";
import { getCanvas, idSchema, listCanvases } from "./shared/contracts";
import { CanvasStore } from "./server/store";
import { storageDirectory } from "./server/paths";
import { Sessions } from "./server/sessions";
import { startMcp } from "./server/mcp";

import { parseDocument } from "./server/document";
import { renderGraphic, readImage } from "./shared/media";
import { GraphicsRenderer } from "./server/graphics";
import { workspaceImage } from "./server/images";

type McpRequest = PluginSessionOpenRequest & {
  mcpServers: NonNullable<AgentSessionConfig["mcpServers"]>;
};
export default function contribute(server: PluginServerContext) {
  const logger = createPluginLogger("paseo-canvas", { version: "0.1.0" });
  const sessions = new Sessions();
  const graphics = new GraphicsRenderer();
  server.handle(renderGraphic, (input) => graphics.render(input));
  server.handle(readImage, async ({ workspaceId, src }, { paseo }) => {
    const workspace = paseo.workspaces.ref(workspaceId);
    await workspace.refresh();
    if (!workspace.directory)
      throw new Error("Workspace directory not found");
    return workspaceImage(workspace.directory, src);
  });
  const ready = storageDirectory().then(async (directory) => {
    const store = await CanvasStore.open(directory, { waitForOwner: true });
    try {
      const mcp = await startMcp(store, sessions);
      logger.info("Canvas storage and MCP are ready");
      return { store, mcp };
    } catch (error) {
      await store.close();
      throw error;
    }
  });
  // Observe initialization failure without turning it into a successful empty store.
  void ready.catch(() =>
    logger.error("Canvas initialization failed; operations are unavailable"),
  );
  server.handle(listCanvases, async ({ workspaceId }) =>
    (await ready).store.list(workspaceId),
  );
  server.handle(getCanvas, async ({ workspaceId, canvasId }) => {
    const result = await (await ready).store.get(workspaceId, canvasId);
    return { ...result, document: parseDocument(result.canvas.content) };
  });
  server.before("agent.session_open", async ({ request }) => {
    if (request.purpose !== "interactive" || request.workspaceId === null)
      return request;
    if (!("mcpServers" in request))
      throw new Error(
        "paseo-canvas requires the session_open MCP extension. Apply integrations/paseo-session-mcp.patch to Paseo before opening an agent session.",
      );
    const scoped = request as McpRequest;
    idSchema.parse(scoped.agentId);
    idSchema.parse(scoped.workspaceId);
    const { mcp } = await ready;
    if (scoped.mcpServers["paseo-canvas"])
      throw new Error("MCP name paseo-canvas is already configured");
    const token = sessions.issue(scoped.agentId, scoped.workspaceId!);
    return {
      ...scoped,
      mcpServers: {
        ...scoped.mcpServers,
        "paseo-canvas": {
          type: "http" as const,
          url: mcp.url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    };
  });
  server.on("agent.created", ({ agent }) =>
    sessions.title(agent.id, agent.title),
  );
  server.on("agent.turn_started", ({ agent }) =>
    sessions.title(agent.id, agent.title),
  );
  server.on("agent.archived", ({ agent }) => sessions.revoke(agent.id));
  return async () => {
    sessions.clear();
    await graphics.close();
    const runtime = await ready.catch(() => null);
    if (runtime) {
      await runtime.mcp.close();
      await runtime.store.close();
    }
  };
}
