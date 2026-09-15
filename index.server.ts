import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createPluginLogger } from "paseo-plugin-helper/server";
import {
  getCanvas,
  listCanvases,
  waitForCanvasChange,
} from "./shared/contracts";
import { CanvasStore } from "./server/store";
import { storageDirectory } from "./server/paths";
import { Sessions } from "./server/sessions";
import { startMcp } from "./server/mcp";
import { CanvasActivityQueue } from "./server/activity";
import { syncCanvasActivity } from "./shared/activity";

import { parseDocument } from "./server/document";
import { renderGraphic, readImage } from "./shared/media";
import { GraphicsRenderer } from "./server/graphics";
import { workspaceImage } from "./server/images";
import {
  getReviews,
  mutateReview,
  getReviewRecipients,
  sendReview,
  retryReview,
} from "./shared/review";
import {
  recipients,
  dispatchReview,
  retryDispatch,
} from "./server/review-dispatch";

import { registerUserEditing } from "./server/user-editing";

const REGISTRATION_ENV = "PASEO_CANVAS_REGISTRATION";
export default function contribute(server: PluginServerContext) {
  const logger = createPluginLogger("paseo-canvas", { version: "0.1.0" });
  const graphics = new GraphicsRenderer();
  server.handle(renderGraphic, (input) => graphics.render(input));
  server.handle(readImage, async ({ workspaceId, src }, { paseo }) => {
    const workspace = paseo.workspaces.ref(workspaceId);
    await workspace.refresh();
    if (!workspace.directory) throw new Error("Workspace directory not found");
    return workspaceImage(workspace.directory, src);
  });
  const ready = storageDirectory().then(async (directory) => {
    const store = await CanvasStore.open(directory, { waitForOwner: true });
    let sessions: Sessions | undefined;
    let activity: CanvasActivityQueue | undefined;
    try {
      sessions = await Sessions.open(store);
      activity = await CanvasActivityQueue.open(directory);
      const mcp = await startMcp(store, sessions, activity);
      logger.info("Canvas storage and MCP are ready");
      return { store, mcp, sessions, activity };
    } catch (error) {
      await sessions?.close();
      await activity?.close();
      await store.close();
      throw error;
    }
  });
  // Observe initialization failure without turning it into a successful empty store.
  void ready.catch(() =>
    logger.error("Canvas initialization failed; operations are unavailable"),
  );
  registerUserEditing(server, async () => (await ready).store);
  server.handle(listCanvases, async ({ workspaceId }) =>
    (await ready).store.list(workspaceId),
  );
  server.handle(syncCanvasActivity, async ({ cursor }, context) =>
    (await ready).activity.sync(cursor, context),
  );
  server.handle(waitForCanvasChange, async ({ workspaceId, cursor }) =>
    (await ready).store.waitForChange(workspaceId, cursor),
  );
  server.handle(getCanvas, async ({ workspaceId, canvasId }) => {
    const result = await (await ready).store.get(workspaceId, canvasId);
    return { ...result, document: parseDocument(result.canvas.content) };
  });
  server.handle(getReviews, async ({ workspaceId, canvasId }) =>
    (await ready).store.reviews.get(workspaceId, canvasId),
  );
  server.handle(mutateReview, async ({ workspaceId, canvasId, mutation }) =>
    (await ready).store.reviews.mutate(workspaceId, canvasId, mutation),
  );
  server.handle(getReviewRecipients, async ({ workspaceId }, context) =>
    recipients((await ready).sessions, context.paseo, workspaceId),
  );
  server.handle(sendReview, async (input, context) => {
    const { store, sessions } = await ready;
    return dispatchReview(store.reviews, sessions, context.paseo, input);
  });
  server.handle(retryReview, async (input, context) => {
    const { store, sessions } = await ready;
    return retryDispatch(store.reviews, sessions, context.paseo, input);
  });
  server.before("agent.create", async ({ request }) => {
    if (request.config.mcpServers?.["paseo-canvas"])
      throw new Error("MCP name paseo-canvas is already configured");
    if (request.env?.[REGISTRATION_ENV] !== undefined)
      throw new Error("Environment name PASEO_CANVAS_REGISTRATION is reserved");
    const { mcp, sessions } = await ready;
    const token = sessions.register();
    return {
      ...request,
      env: { ...request.env, [REGISTRATION_ENV]: token },
      config: {
        ...request.config,
        mcpServers: {
          ...request.config.mcpServers,
          "paseo-canvas": {
            type: "http" as const,
            url: mcp.url,
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      },
    };
  });
  server.before("agent.session_open", async ({ request }) => {
    const env = { ...request.env };
    const registration = env[REGISTRATION_ENV];
    delete env[REGISTRATION_ENV];
    if (request.purpose === "interactive" && request.workspaceId !== null) {
      await (
        await ready
      ).sessions.activate(request.agentId, request.workspaceId, registration);
    }
    return { ...request, env };
  });
  server.on("agent.created", async ({ agent }) =>
    (await ready).sessions.title(agent.id, agent.title),
  );
  server.on("agent.turn_started", async ({ agent }) =>
    (await ready).sessions.title(agent.id, agent.title),
  );
  server.on("agent.archived", async ({ agent }) =>
    (await ready).sessions.revoke(agent.id),
  );
  return async () => {
    await graphics.close();
    const runtime = await ready.catch(() => null);
    if (runtime) {
      await runtime.mcp.close();
      await runtime.activity.close();
      await runtime.sessions.close();
      await runtime.store.close();
    }
  };
}
