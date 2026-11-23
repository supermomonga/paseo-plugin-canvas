import type {
  PluginHandlerContext,
  PluginServerContext,
} from "@getpaseo/plugin/server";
import {
  getCanvas,
  listCanvases,
  recentCanvases,
  watchCanvases,
} from "./shared/contracts";
import { canvasSettings } from "./shared/settings";
import { CanvasStore } from "./server/store";
import { storageDirectory } from "./server/paths";
import { MCP_SERVER_NAME, Sessions } from "./server/sessions";
import { startMcp } from "./server/mcp";
import { CanvasActivityQueue } from "./server/activity";
import { watchCanvasSettings } from "./server/settings";
import { recentCanvases as listRecentCanvases } from "./server/recent";
import { searchCanvasAttachments } from "./shared/attachments";
import { searchAttachments } from "./server/attachments";

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

/** An agent opens without Canvas rather than wait longer; Paseo fails a hook after 30 s. */
const OPEN_WAIT_MS = 20_000;

type Paseo = PluginHandlerContext["paseo"];

export default function contribute(server: PluginServerContext) {
  const settings = watchCanvasSettings(
    server.registerSettings(canvasSettings),
  );
  const graphics = new GraphicsRenderer();
  server.handle(renderGraphic, (input) => graphics.render(input));
  server.handle(readImage, async ({ workspaceId, src }, { paseo }) => {
    lend(paseo);
    const workspace = paseo.workspaces.ref(workspaceId);
    await workspace.refresh();
    if (!workspace.directory) throw new Error("Workspace directory not found");
    return workspaceImage(workspace.directory, src, graphics);
  });
  const ready = storageDirectory().then(async (directory) => {
    const store = await CanvasStore.open(directory, { waitForOwner: true });
    let sessions: Sessions | undefined;
    let activity: CanvasActivityQueue | undefined;
    try {
      sessions = await Sessions.open(store);
      activity = await CanvasActivityQueue.open(directory);
      const mcp = await startMcp(store, sessions, activity, {
        timelineNotifications: async () =>
          (await settings.current()).timelineNotifications,
      });
      console.log("[paseo-canvas] Canvas storage and MCP are ready");
      return { store, mcp, sessions, activity };
    } catch (error) {
      await sessions?.close();
      await activity?.close();
      await store.close();
      throw error;
    }
  });
  // Observe initialization failure without turning it into a successful empty store.
  void ready.catch((error) =>
    console.error(
      "[paseo-canvas] Canvas initialization failed; operations are unavailable",
      error,
    ),
  );
  // Every hook and handler receives the plugin's daemon session; the activity
  // queue keeps it to deliver timeline rows as soon as an agent saves (ADR 18).
  const lend = (paseo: Paseo) =>
    void ready.then(
      ({ activity }) => activity.remember(paseo),
      () => {},
    );
  registerUserEditing(server, async () => (await ready).store);
  server.handle(listCanvases, async ({ workspaceId }) =>
    (await ready).store.list(workspaceId),
  );
  server.handle(recentCanvases, async ({ limit }, { paseo }) => {
    lend(paseo);
    return listRecentCanvases((await ready).store, paseo, limit);
  });
  server.handle(searchCanvasAttachments, async ({ query }, { paseo }) => {
    lend(paseo);
    return searchAttachments((await ready).store, paseo, query);
  });
  // Each subscriber follows one workspace until it releases the subscription.
  server.handle(watchCanvases, async ({ workspaceId }, { paseo, push, signal }) => {
    lend(paseo);
    const { store } = await ready;
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return resolve();
      const watcher = store.watchChanges(workspaceId, {
        change: (cursor) => void push({ cursor }).catch(() => {}),
        closed: (error) => {
          signal.removeEventListener("abort", stop);
          reject(error);
        },
      });
      const stop = () => {
        watcher.stop();
        resolve();
      };
      signal.addEventListener("abort", stop, { once: true });
      void push({ cursor: watcher.cursor }).catch(() => {});
    });
  });
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
  server.handle(getReviewRecipients, async ({ workspaceId }, { paseo }) => {
    lend(paseo);
    return recipients(paseo, workspaceId);
  });
  server.handle(sendReview, async (input, { paseo }) => {
    lend(paseo);
    return dispatchReview((await ready).store.reviews, paseo, input);
  });
  server.handle(retryReview, async (input, { paseo }) => {
    lend(paseo);
    return retryDispatch((await ready).store.reviews, paseo, input);
  });
  // Agents that opened while Canvas was unavailable, reopened once it is.
  const missed = new Set<string>();
  let reopening: Paseo | null = null;
  let available = false;
  let reopenTimer: ReturnType<typeof setTimeout> | undefined;
  async function reopenMissed() {
    for (const agentId of [...missed]) {
      missed.delete(agentId);
      if (!reopening) continue;
      try {
        const agent = reopening.agents.ref(agentId);
        await agent.refresh();
        // Reloading interrupts a running turn; a busy agent keeps going without Canvas.
        if (agent.status === "idle" && !agent.activeTurn) await agent.reload();
      } catch (error) {
        console.warn("[paseo-canvas] Unable to reopen an agent with Canvas", error);
      }
    }
  }
  // Let the opening that missed Canvas finish before reloading it.
  const scheduleReopen = () => {
    if (!available || reopenTimer || !missed.size) return;
    reopenTimer = setTimeout(() => {
      reopenTimer = undefined;
      void reopenMissed();
    }, 2_000);
  };
  void ready.then(
    () => {
      available = true;
      scheduleReopen();
    },
    () => missed.clear(),
  );
  // Every interactive opening in a workspace gets its own launch-only MCP
  // descriptor, including agents created before the plugin (ADR 18).
  server.addHook("agent.open.before", async ({ request }, { paseo }) => {
    if (request.purpose !== "interactive" || request.workspaceId === null)
      return;
    lend(paseo);
    const workspaceId = request.workspaceId;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), OPEN_WAIT_MS);
    });
    try {
      // One deadline covers both waiting for storage and recording the credential.
      const opened = await Promise.race([
        ready.then(async (runtime) => ({
          runtime,
          credential: await runtime.sessions.connect(
            request.agentId,
            workspaceId,
            request.title,
          ),
        })),
        late,
      ]);
      if (!opened) {
        console.warn(
          "[paseo-canvas] Canvas is still starting; this agent opens without it",
        );
        missed.add(request.agentId);
        reopening = paseo;
        scheduleReopen();
        return;
      }
      if (!opened.credential) return; // Its saved descriptor already reaches Canvas.
      return {
        ...request,
        mcpServers: {
          ...request.mcpServers,
          [MCP_SERVER_NAME]: {
            type: "http" as const,
            url: opened.runtime.mcp.url,
            headers: { Authorization: `Bearer ${opened.credential.token}` },
          },
        },
      };
    } catch (error) {
      // Canvas must never prevent an agent from opening.
      console.error("[paseo-canvas] Unable to give Canvas to an agent", error);
      return;
    } finally {
      clearTimeout(timer);
    }
  });
  server.addHook("agent.create.after", async ({ agent }, { paseo }) => {
    lend(paseo);
    await (await ready).sessions.title(agent.id, agent.title);
  });
  server.addHook("agent.turn.before", async ({ agent }, { paseo }) => {
    lend(paseo);
    await (await ready).sessions.title(agent.id, agent.title);
  });
  // Retry anything still pending once a turn ends.
  server.addHook("agent.turn.after", async (_event, { paseo }) => {
    lend(paseo);
    const { activity } = await ready;
    // A row for an agent that is not loaded stays queued for a later turn.
    if (activity.size)
      await activity.deliver(paseo).catch((error) =>
        console.warn("[paseo-canvas] Timeline delivery deferred", error),
      );
  });
  // Another editor need not wait for the lease to expire once the agent stops.
  server.addHook("agent.close.after", async ({ agent }) => {
    await (await ready).store.releaseAgent(agent.id);
  });
  server.addHook("agent.archive.after", async ({ agent }) => {
    const { sessions, store, activity } = await ready;
    await sessions.revoke(agent.id);
    await store.releaseAgent(agent.id);
    await activity.drop(agent.id);
  });
  return async () => {
    clearTimeout(reopenTimer);
    missed.clear();
    settings.close();
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
