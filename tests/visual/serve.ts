import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "../../server/document";
import { CanvasChanges } from "../../server/changes";
import { GraphicsRenderer } from "../../server/graphics";
import { workspaceImage } from "../../server/images";
import { getFixtureQuery } from "./query";
const root = path.resolve(".test-output/visual");
const graphics = new GraphicsRenderer();
const changes = new CanvasChanges();
const markdown = await readFile("tests/fixtures/gfm.md", "utf8");
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
      if (name === "canvas.wait_for_change")
        result = await changes.wait(input.workspaceId, input.cursor);
      else if (name === "canvas.render_graphic")
        result = await graphics.render(input);
      else if (name === "canvas.read_image")
        result = await workspaceImage(root, input.src);
      else {
        result = getFixtureQuery({ name }, input).data;
        if (name === "canvas.get") {
          const canvas = { ...(result as any).canvas, content: markdown };
          result = { canvas, document: parseDocument(markdown) };
        }
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
      return;
    }
    const filename = req.url === "/" ? "index.html" : (req.url?.slice(1) ?? "");
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
process.on("SIGINT", () => {
  server.close();
  void graphics.close().then(() => process.exit(0));
});
