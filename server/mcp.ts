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
import { diagnoseMarkdown } from "./diagnostics";
import type { Actor } from "../shared/contracts";
export async function startMcp(
  store: CanvasStore,
  sessions: Sessions,
  activity: Pick<CanvasActivityQueue, "enqueue">,
) {
  const pending = new Set<Promise<unknown>>();
  let closing = false;
  async function saved(
    actor: Actor,
    action: "created" | "updated",
    value: Awaited<ReturnType<CanvasStore["update"]>>,
  ) {
    const warnings: { code: string; message: string }[] = [];
    let diagnosis: ReturnType<typeof diagnoseMarkdown> | null = null;
    try {
      diagnosis = diagnoseMarkdown(value.snapshot.content);
    } catch (error) {
      console.error("[paseo-canvas] Markdown diagnostics failed", error);
      warnings.push({
        code: "DIAGNOSTICS_FAILED",
        message:
          "Canvas saved, but rendering diagnostics could not be completed.",
      });
    }
    let timeline: "queued" | "failed" = "queued";
    try {
      await activity.enqueue(actor.agentId, {
        workspaceId: actor.workspaceId,
        canvasId: value.canvasId,
        title: value.snapshot.metadata.title,
        revision: value.revision,
        action,
        warningCount: diagnosis?.diagnosticCount ?? 0,
        savedAt: value.snapshot.metadata.updatedAt,
      });
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
      diagnosticsStatus: diagnosis ? "complete" : "failed",
      ...diagnosis,
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
          "Shared GFM documents in your Paseo workspace. Use canvas.list/get to read. Before update/delete acquire a lock, use its lockToken and the current expectedRevision. Locks last five minutes; renew before expiry and release after editing. On conflict, read again. Canvas files are outside the project. Never write them directly. Create/update return rendering diagnostics with document line numbers and repair hints. Fix unsupported Mermaid using canvas.update and the returned revision. saved:true means the write succeeded even when warnings are present; do not repeat canvas.create. A dedicated timeline row lets users open the canvas inside Paseo.",
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
          "Create a persistent GFM canvas. Returns saved revision, Mermaid rendering diagnostics and repair hints, and timeline notification status.",
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
      "canvas.update",
      {
        description:
          "Save title and/or GFM content with a valid edit lock and expectedRevision. Returns saved revision, Mermaid diagnostics and repair hints, and timeline notification status.",
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
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(sessions.port, "127.0.0.1", resolve);
  });
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
