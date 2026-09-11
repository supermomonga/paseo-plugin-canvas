import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const hooks = new Map(),
  handlers = new Map();
const factory = (0, eval)(readFileSync(process.argv[2], "utf8"));
const module = factory(require);
const cleanup = module.default({
  before(name, handler) {
    hooks.set(name, handler);
    return () => {};
  },
  on() {
    return () => {};
  },
  handle(contract, handler) {
    handlers.set(contract.name, handler);
  },
});
try {
  const request = await hooks.get("agent.session_open")({
    request: {
      agentId: "bundle-agent",
      workspaceId: "bundle-workspace",
      provider: "custom",
      cwd: process.cwd(),
      reason: "create",
      purpose: "interactive",
      env: {},
      mcpServers: {},
    },
  });
  process.send({ type: "ready", config: request.mcpServers["paseo-canvas"] });
  process.on("message", async (message) => {
    if (message?.type === "watch") {
      const result = await handlers.get("canvas.wait_for_change")({
        workspaceId: "bundle-workspace",
        cursor: message.cursor,
      });
      process.send({ type: "changed", ...result });
    }
    if (message === "list")
      process.send({
        type: "list",
        result: await handlers.get("canvas.list")({
          workspaceId: "bundle-workspace",
        }),
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
    if (message === "get") {
      const result = await handlers.get("canvas.get")({
        workspaceId: "bundle-workspace",
        canvasId: (
          await handlers.get("canvas.list")({ workspaceId: "bundle-workspace" })
        ).items[0].canvasId,
      });
      process.send({ type: "document", document: result.document });
    }
    if (message === "stop") {
      await cleanup();
      process.exit(0);
    }
  });
} catch (error) {
  process.send({ type: "error", message: error.message });
  await cleanup();
  process.exit(1);
}
