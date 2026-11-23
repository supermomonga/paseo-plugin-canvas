import { createServer } from "node:http";
import { CanvasStore } from "../../server/store";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "../../server/document";
import { GraphicsRenderer } from "../../server/graphics";
import { workspaceImage } from "../../server/images";
import { getFixtureQuery } from "./query";
import { registerUserEditing } from "../../server/user-editing";
import type { PluginServerContext } from "@getpaseo/plugin/server";
const userHandlers = new Map<string, (input: unknown) => Promise<unknown>>();
const root = path.resolve(".test-output/visual");
const graphics = new GraphicsRenderer();
const markdown = await readFile("tests/fixtures/gfm.md", "utf8");
const store = await CanvasStore.open(
  await mkdtemp(path.join(tmpdir(), "canvas-review-ui-")),
);
registerUserEditing(
  {
    handle(contract, handler) {
      const rpc = contract as Extract<typeof contract, { output: unknown }>;
      userHandlers.set(rpc.name, async (input) =>
        rpc.output.parse(
          await (handler as (input: unknown, context: never) => unknown)(
            rpc.input.parse(input),
            {} as never,
          ),
        ),
      );
    },
  } as Pick<PluginServerContext, "handle">,
  async () => store,
);
const actor = {
  agentId: "fixture-agent",
  workspaceId: "test",
  sessionId: "fixture-session",
  title: "Fixture agent",
};
await store.create(actor, "GFM review example", markdown);
const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url?.startsWith("/rpc/")) {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1_000_000) throw new Error("Request too large");
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString());
      const name = req.url.slice(5);
      let result;
      if (userHandlers.has(name)) result = await userHandlers.get(name)!(input);
      else if (name === "canvas.watch")
        // Long-polls stand in for the daemon subscription in this fixture.
        result = await new Promise((resolve) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const watcher = store.watchChanges(input.workspaceId, {
            change: (cursor) => finish(cursor),
            closed: () => finish(watcher.cursor),
          });
          const finish = (cursor: string) => {
            clearTimeout(timer);
            watcher.stop();
            resolve({ cursor });
          };
          if (input.cursor !== watcher.cursor) finish(watcher.cursor);
          else timer = setTimeout(() => finish(watcher.cursor), 20_000);
        });
      else if (name === "canvas.render_graphic")
        result = await graphics.render(input);
      else if (name === "canvas.read_image")
        result = await workspaceImage(root, input.src, graphics);
      else if (name === "canvas.list")
        result = await store.list(input.workspaceId);
      else if (name === "canvas.get") {
        const value = await store.get(input.workspaceId, input.canvasId);
        result = { ...value, document: parseDocument(value.canvas.content) };
      } else if (name === "canvas.review.get")
        result = await store.reviews.get(input.workspaceId, input.canvasId);
      else if (name === "canvas.review.mutate")
        result = await store.reviews.mutate(
          input.workspaceId,
          input.canvasId,
          input.mutation,
        );
      else if (name === "canvas.review.recipients")
        result = [
          {
            id: "preview-agent",
            title: "Preview agent (simulated)",
            running: false,
            blocked: false,
          },
          {
            id: "running-agent",
            title: "Running agent (simulated)",
            running: true,
            blocked: false,
          },
          {
            id: "blocked-agent",
            title: "Permission pending (simulated)",
            running: false,
            blocked: true,
          },
        ];
      // Exercise persistence and UI transitions without sending to a real agent.
      else if (
        name === "canvas.review.send" ||
        name === "canvas.review.retry"
      ) {
        const delivery =
          name === "canvas.review.send"
            ? await store.reviews.begin(
                input.workspaceId,
                input.canvasId,
                input.agentId,
                input.threads,
              )
            : await store.reviews.retry(
                input.workspaceId,
                input.canvasId,
                input.requestId,
              );
        result = await store.reviews.finish(
          input.workspaceId,
          input.canvasId,
          delivery.id,
          delivery.attempts.at(-1)!.id,
          "accepted",
          null,
        );
      } else throw new Error("Unknown fixture RPC");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
      return;
    }
    // `?locale=ja` and other query strings select options in the page.
    const pathname = new URL(req.url ?? "/", "http://fixture").pathname;
    const filename = pathname === "/" ? "index.html" : pathname.slice(1);
    if (!/^[\w.-]+$/.test(filename)) {
      res.writeHead(404).end();
      return;
    }
    const data = await readFile(path.join(root, filename));
    res.setHeader(
      "Content-Type",
      filename.endsWith("js")
        ? "application/javascript"
        : filename.endsWith("png")
          ? "image/png"
          : "text/html",
    );
    res.end(data);
  } catch (error) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
});
server.listen(49618, "127.0.0.1", () =>
  console.log("Canvas preview: http://127.0.0.1:49618"),
);
process.once("SIGINT", () => {
  server.close();
  void Promise.all([store.close(), graphics.close()]).then(() =>
    process.exit(0),
  );
});
