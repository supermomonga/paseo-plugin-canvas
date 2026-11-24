// Listing screenshot server (ADR 20): the visual-test fixture server with
// sample canvases, and POST /fixture/reply for the assigned agent's answer.
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CanvasStore } from "../../server/store";
import { parseDocument } from "../../server/document";
import { GraphicsRenderer } from "../../server/graphics";
import { workspaceImage } from "../../server/images";
import { registerUserEditing } from "../../server/user-editing";
import type { PluginServerContext } from "@getpaseo/plugin/server";

const root = path.resolve(".test-output/listing");
const graphics = new GraphicsRenderer();
const store = await CanvasStore.open(
  await mkdtemp(path.join(tmpdir(), "canvas-listing-")),
);
const userHandlers = new Map<string, (input: unknown) => Promise<unknown>>();
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

const recipients = [
  { id: "agent-impl", title: "Implement background indexing", running: false, blocked: false },
  { id: "agent-review", title: "Review the indexing plan", running: false, blocked: false },
  { id: "agent-docs", title: "Update the search docs", running: true, blocked: false },
];
const actor = (id: string) => ({
  agentId: id,
  workspaceId: "test",
  sessionId: `${id}-session`,
  title: recipients.find((r) => r.id === id)?.title ?? id,
});

const plan = `# Search indexing plan

Move search indexing out of the request path, so that saving a document in a large workspace stays fast.

> [!IMPORTANT]
> Ship behind the \`search.backgroundIndex\` flag until the backfill has finished in every region.

## Milestones

| Step | Owner | Status |
|:---|:---|:---|
| Queue writes to the indexer | Implementation agent | Done |
| Backfill existing workspaces | Implementation agent | In progress |
| Remove the synchronous path | You | Not started |

## Checklist

- [x] Measure p95 save latency on the largest workspace
- [x] Retry failed batches with a budget
- [ ] Review the backfill rate limit
- [ ] Announce the change in the release notes

## Backfill time

With $w$ workers that each index $r$ documents per minute, a backfill of $N$ documents takes

$$
t = \\frac{N}{w \\cdot r}
$$

minutes. At $r = 1200$ and $w = 8$, ten million documents take about 17 hours.

\`\`\`ts
await indexQueue.enqueue({ workspaceId, documentId, revision });
\`\`\`
`;

const notes = `# API review notes

Decisions from the API review on Monday.

- Pagination uses opaque cursors.
- Errors keep the \`code\` and \`message\` fields.
`;
const checklist = `# Release checklist 2.4

- [x] Freeze the branch
- [ ] Run the migration on staging
- [ ] Publish the release notes
`;
const incident = `# Incident follow-up: slow saves

> [!WARNING]
> Saves in workspaces with more than 50,000 documents took up to 9 seconds.

The fix is tracked in the search indexing plan.
`;

const created: Record<string, string> = {};
for (const [id, title, content] of [
  ["agent-docs", "Incident follow-up: slow saves", incident],
  ["agent-review", "Release checklist 2.4", checklist],
  ["agent-review", "API review notes", notes],
  ["agent-impl", "Search indexing plan", plan],
] as const) {
  const result = (await store.create(actor(id), title, content)) as {
    canvasId?: string;
    canvas?: { canvasId: string };
  };
  created[title] = result.canvasId ?? result.canvas!.canvasId;
}
// One canvas is being edited by an agent, as in a real workspace.
await store.acquire(actor("agent-docs"), created["Release checklist 2.4"]);
console.log(JSON.stringify(created));

const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url?.startsWith("/rpc/")) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString());
      const name = req.url.slice(5);
      let result;
      if (userHandlers.has(name)) result = await userHandlers.get(name)!(input);
      else if (name === "canvas.watch")
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
      else if (name === "canvas.review.recipients") result = recipients;
      else if (name === "canvas.review.send") {
        const delivery = await store.reviews.begin(
          input.workspaceId,
          input.canvasId,
          input.agentId,
          input.threads,
        );
        result = await store.reviews.finish(
          input.workspaceId,
          input.canvasId,
          delivery.id,
          delivery.attempts.at(-1)!.id,
          "accepted",
          null,
        );
      } else throw new Error(`Unknown fixture RPC ${name}`);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
      return;
    }
    // POST /fixture/reply {canvasId, body, kind}: the assigned agent answers.
    if (req.method === "POST" && req.url === "/fixture/reply") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString());
      const reviews = await store.reviews.get("test", input.canvasId);
      const replies = [];
      for (const thread of Object.values(reviews.state.threads)) {
        if (!thread.currentRequestId || !thread.assignedAgentId) continue;
        let documentRevision: number | undefined;
        if (input.replace) {
          // The agent edits the canvas under its own lock, then reports it.
          const agent = actor(thread.assignedAgentId);
          const lease = (await store.acquire(agent, input.canvasId)) as {
            lockToken: string;
          };
          const current = await store.get("test", input.canvasId);
          const saved = (await store.update(
            agent,
            {
              canvasId: input.canvasId,
              lockToken: lease.lockToken,
              expectedRevision: current.canvas.revision,
              content: current.canvas.content.replace(
                input.replace[0],
                input.replace[1],
              ),
            },
            true,
          )) as { revision: number };
          documentRevision = saved.revision;
        }
        replies.push(
          await store.reviews.reply(actor(thread.assignedAgentId), {
            canvasId: input.canvasId,
            threadId: thread.id,
            expectedRevision: thread.revision,
            requestId: thread.currentRequestId,
            kind: input.kind ?? "explanation",
            body: input.body,
            ...(documentRevision ? { documentRevision } : {}),
          }),
        );
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(replies));
      return;
    }
    const pathname = new URL(req.url ?? "/", "http://fixture").pathname;
    const filename = pathname === "/" ? "index.html" : pathname.slice(1);
    if (!/^[\w.-]+$/.test(filename)) {
      res.writeHead(404).end();
      return;
    }
    const data = await readFile(path.join(root, filename));
    const type = filename.endsWith(".js")
      ? "application/javascript"
      : filename.endsWith(".woff2")
        ? "font/woff2"
        : filename.endsWith(".png")
          ? "image/png"
          : "text/html";
    res.setHeader("Content-Type", type);
    res.end(data);
  } catch (error) {
    console.error(error);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
});
server.listen(49619, "127.0.0.1", () =>
  console.log("Listing preview: http://127.0.0.1:49619"),
);
