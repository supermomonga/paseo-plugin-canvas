import { CanvasStore } from "../../server/store";
const store = await CanvasStore.open(process.argv[2]);
const created = await store.create(
  {
    agentId: "agent",
    workspaceId: "workspace",
    title: null,
    sessionId: "session",
  },
  "Crash recovery",
  "# Durable",
);
await store.acquire(
  {
    agentId: "agent",
    workspaceId: "workspace",
    title: null,
    sessionId: "session",
  },
  created.canvasId,
);
process.send?.(created);
process.on("message", () => {});
