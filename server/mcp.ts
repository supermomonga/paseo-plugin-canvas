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
export async function startMcp(store: CanvasStore, sessions: Sessions) {
  const active = new Set<McpServer>();
  const http = createServer(async (request, response) => {
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
    } catch {
      response.writeHead(401).end();
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
          "Shared GFM documents in your Paseo workspace. Use canvas.list/get to read. Before update/delete acquire a lock, use its lockToken and the current expectedRevision. Locks last five minutes; renew before expiry and release after editing. On conflict, read again. Canvas files are outside the project. Never write them directly.",
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
      try {
        const value = await action();
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
        description: "Create a new persistent GFM canvas in this workspace.",
        inputSchema: z
          .object({ title: titleSchema, content: contentSchema })
          .strict(),
      },
      ({ title, content }) =>
        result(() => store.create(sessions.resolve(token), title, content)),
    );
    server.registerTool(
      "canvas.update",
      {
        description:
          "Save title and/or GFM content with a valid edit lock and expectedRevision.",
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
      (input) => result(() => store.update(sessions.resolve(token), input)),
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
    http.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`,
    async close() {
      sessions.clear();
      await Promise.allSettled([...active].map((server) => server.close()));
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
