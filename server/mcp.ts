import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  contentSchema,
  editInputSchema,
  idSchema,
  titleSchema,
} from "../shared/contracts";
import { CanvasError } from "./errors";
import type { CanvasStore } from "./store";
import type { Sessions } from "./sessions";
import type { CanvasActivityQueue } from "./activity";
import type { Actor } from "../shared/contracts";
import { agentReplySchema } from "../shared/review";
export async function startMcp(
  store: CanvasStore,
  sessions: Sessions,
  activity: Pick<CanvasActivityQueue, "enqueue">,
  options: { timelineNotifications?: () => Promise<boolean> } = {},
) {
  const pending = new Set<Promise<unknown>>();
  let closing = false;
  async function saved(
    actor: Actor,
    action: "created" | "updated",
    value: Awaited<ReturnType<CanvasStore["update"]>>,
  ) {
    const warnings: { code: string; message: string }[] = [];
    let timeline: "queued" | "disabled" | "failed" = "queued";
    try {
      const notify = (await options.timelineNotifications?.()) ?? true;
      if (notify)
        await activity.enqueue(actor.agentId, {
          workspaceId: actor.workspaceId,
          canvasId: value.canvasId,
          title: value.snapshot.metadata.title,
          revision: value.revision,
          action,
          // Canvas no longer checks diagrams (ADR 19); the version 1 row keeps the field.
          warningCount: 0,
          savedAt: value.snapshot.metadata.updatedAt,
        });
      else timeline = "disabled";
    } catch (error) {
      timeline = "failed";
      console.error(
        "[paseo-canvas] Timeline notification could not be queued",
        error,
      );
      warnings.push({
        code: "TIMELINE_QUEUE_FAILED",
        message:
          "Canvas saved, but its timeline notification could not be queued. Do not repeat the save.",
      });
    }
    return {
      canvasId: value.canvasId,
      revision: value.revision,
      saved: true,
      warnings,
      timeline,
    };
  }
  const active = new Set<McpServer>();
  const http = createServer(async (request, response) => {
    if (closing) {
      response.writeHead(503).end();
      return;
    }
    if (request.url !== "/mcp") {
      response.writeHead(404).end();
      return;
    }
    if (
      request.headers.origin ||
      request.headers.host !==
        `127.0.0.1:${(http.address() as AddressInfo).port}`
    ) {
      response.writeHead(403).end();
      return;
    }
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    try {
      sessions.resolve(token);
    } catch (error) {
      response
        .writeHead(
          error instanceof CanvasError && error.code === "UNAUTHORIZED"
            ? 401
            : 503,
        )
        .end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" }).end();
      return;
    }
    const server = new McpServer(
      { name: "paseo-canvas", version: "0.1.0" },
      {
        instructions:
          "Shared GFM documents in your Paseo workspace. Use canvas.list/get to read. Before update/delete acquire a lock, use its lockToken and the current expectedRevision. Locks last five minutes; renew before expiry and release after editing. On conflict, read again. Canvas files are outside the project. Never write them directly. Mermaid diagrams are shown with Paseo's Mermaid renderer; Canvas does not validate them, so check their syntax yourself. SVG in ```svg fences or workspace .svg images is shown as a static picture with a transparent background; scripts, animation and referenced external files are ignored. saved:true means the write succeeded even when warnings are present; do not repeat canvas.create. Unless the user turned timeline notifications off, a dedicated timeline row lets users open the canvas inside Paseo.",
      },
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    active.add(server);
    response.once("close", () => {
      active.delete(server);
      void server.close();
    });
    const result = async (action: () => Promise<unknown>) => {
      const operation = Promise.resolve().then(action);
      pending.add(operation);
      try {
        const value = await operation;
        return {
          content: [{ type: "text" as const, text: JSON.stringify(value) }],
        };
      } catch (error) {
        const value =
          error instanceof CanvasError
            ? { code: error.code, message: error.message, ...error.details }
            : {
                code: "OPERATION_FAILED",
                message: "Canvas operation failed; inspect Paseo plugin logs",
              };
        if (!(error instanceof CanvasError))
          console.error(
            "[paseo-canvas] operation failed",
            error instanceof Error ? error.message : "unknown error",
          );
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify(value) }],
        };
      } finally {
        pending.delete(operation);
      }
    };
    const readAnnotations = {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    };
    server.registerTool(
      "canvas.list",
      {
        description:
          "List canvases in this session’s workspace, with revision and editState.",
        inputSchema: z.object({}).strict(),
        annotations: readAnnotations,
      },
      () => result(() => store.list(sessions.resolve(token).workspaceId)),
    );
    server.registerTool(
      "canvas.get",
      {
        description: "Read GFM content, revision, editState and observedAt.",
        inputSchema: z.object({ canvasId: idSchema }).strict(),
        annotations: readAnnotations,
      },
      ({ canvasId }) =>
        result(() => store.get(sessions.resolve(token).workspaceId, canvasId)),
    );
    server.registerTool(
      "canvas.create",
      {
        description:
          "Create a persistent GFM canvas. Returns saved revision, warnings and timeline notification status.",
        inputSchema: z
          .object({ title: titleSchema, content: contentSchema })
          .strict(),
      },
      ({ title, content }) =>
        result(async () => {
          const actor = sessions.resolve(token);
          return saved(
            actor,
            "created",
            await store.create(actor, title, content),
          );
        }),
    );
    server.registerTool(
      "canvas.review.list",
      {
        description:
          "List review threads, their current revisions, assignment, source anchors and tracking status. Workspace is inferred from your session.",
        inputSchema: z.object({ canvasId: idSchema }).strict(),
        annotations: readAnnotations,
      },
      ({ canvasId }) =>
        result(async () => {
          const review = await store.reviews.get(
            sessions.resolve(token).workspaceId,
            canvasId,
          );
          return {
            documentRevision: review.documentRevision,
            threads: Object.values(review.state.threads),
            projections: review.projections,
          };
        }),
    );
    server.registerTool(
      "canvas.review.get",
      {
        description:
          "Read a review thread before replying. Use the returned thread revision as expectedRevision. Only the assigned session can reply; only the user can resolve.",
        inputSchema: z
          .object({ canvasId: idSchema, threadId: idSchema })
          .strict(),
        annotations: readAnnotations,
      },
      ({ canvasId, threadId }) =>
        result(async () => {
          const review = await store.reviews.get(
            sessions.resolve(token).workspaceId,
            canvasId,
          );
          const thread = review.state.threads[threadId];
          if (!Object.hasOwn(review.state.threads, threadId))
            throw new CanvasError("NOT_FOUND", "Review thread not found");
          return {
            thread,
            position: review.projections[threadId],
            documentRevision: review.documentRevision,
          };
        }),
    );
    server.registerTool(
      "canvas.review.reply",
      {
        description:
          "Reply to an assigned review request with question, explanation or applied. Applied requires the documentRevision saved by canvas.update. This does not resolve the thread. Read the current thread revision first.",
        inputSchema: agentReplySchema,
      },
      (input) =>
        result(() => store.reviews.reply(sessions.resolve(token), input)),
    );
    server.registerTool(
      "canvas.update",
      {
        description:
          "Save title and/or GFM content with a valid edit lock and expectedRevision. Returns saved revision, warnings and timeline notification status.",
        inputSchema: editInputSchema
          .extend({
            title: titleSchema.optional(),
            content: contentSchema.optional(),
          })
          .refine(
            (x) => x.title !== undefined || x.content !== undefined,
            "Provide title or content",
          ),
      },
      (input) =>
        result(async () => {
          const actor = sessions.resolve(token);
          return saved(actor, "updated", await store.update(actor, input));
        }),
    );
    server.registerTool(
      "canvas.delete",
      {
        description:
          "Permanently delete a canvas, requiring its current edit lock and revision.",
        inputSchema: editInputSchema,
        annotations: { destructiveHint: true },
      },
      (input) => result(() => store.delete(sessions.resolve(token), input)),
    );
    server.registerTool(
      "lock.acquire",
      {
        description:
          "Acquire an exclusive five-minute edit lock. Returns a secret lockToken. Reads remain available.",
        inputSchema: z.object({ canvasId: idSchema }).strict(),
      },
      ({ canvasId }) =>
        result(() => store.acquire(sessions.resolve(token), canvasId)),
    );
    for (const name of ["renew", "release"] as const) {
      server.registerTool(
        `lock.${name}`,
        {
          description:
            name === "renew"
              ? "Extend your current lock by five minutes."
              : "Release your current edit lock.",
          inputSchema: z
            .object({ canvasId: idSchema, lockToken: z.string().min(1) })
            .strict(),
        },
        ({ canvasId, lockToken }) =>
          result(() =>
            name === "renew"
              ? store.renew(sessions.resolve(token), canvasId, lockToken)
              : store.releaseLock(sessions.resolve(token), canvasId, lockToken),
          ),
      );
    }
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response);
    } catch {
      if (!response.headersSent) response.writeHead(500).end();
      else response.end();
      await server.close();
      active.delete(server);
    }
  });
  const listen = (port: number) =>
    new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => {
        http.off("listening", listening);
        reject(error);
      };
      const listening = () => {
        http.off("error", failed);
        resolve();
      };
      http.once("error", failed);
      http.once("listening", listening);
      http.listen(port, "127.0.0.1");
    });
  try {
    await listen(sessions.port);
  } catch (error) {
    // Launch descriptors are rebuilt on every opening, so another port only
    // affects agents still running with the old address (ADR 18).
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || !sessions.port)
      throw error;
    console.warn(
      `[paseo-canvas] Port ${sessions.port} is in use; Canvas MCP moves to another port`,
    );
    await listen(0);
  }
  try {
    await sessions.setPort((http.address() as AddressInfo).port);
  } catch (error) {
    await new Promise<void>((resolve) => http.close(() => resolve()));
    throw error;
  }
  return {
    url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`,
    async close() {
      closing = true;
      await Promise.allSettled([...active].map((server) => server.close()));
      await Promise.allSettled([...pending]);
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
