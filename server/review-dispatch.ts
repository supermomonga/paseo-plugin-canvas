import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { RpcInput } from "@getpaseo/plugin";
import type { PaseoAgent } from "@getpaseo/client";
import { sendReview, retryReview, type ReviewDelivery } from "../shared/review";
import type { Sessions } from "./sessions";
import type { ReviewStore } from "./reviews";
import { CanvasError } from "./errors";
type Paseo = PluginHandlerContext["paseo"];
async function availableAgents(
  sessions: Sessions,
  paseo: Paseo,
  workspaceId: string,
) {
  const agents = new Map<string, PaseoAgent>();
  let cursor: string | null = null;
  do {
    const page = await paseo.agents.list({
      filter: { includeArchived: false },
      sort: [{ key: "created_at", direction: "asc" }],
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    for (const { agent } of page.entries) {
      if (agent.workspaceId === workspaceId && !agent.archivedAt)
        agents.set(agent.id, agent);
    }
    cursor = page.pageInfo.nextCursor;
  } while (cursor);

  // Bindings authorize MCP access; they do not establish that an agent exists.
  // Check them after listing, including any revocations received while awaiting it.
  const registered = new Set(sessions.eligible(workspaceId).map((s) => s.id));
  return [...agents.values()].filter((agent) => registered.has(agent.id));
}
async function target(
  sessions: Sessions,
  paseo: Paseo,
  workspaceId: string,
  id: string,
  allowInterrupt: boolean,
) {
  const agent = (await availableAgents(sessions, paseo, workspaceId)).find(
    (agent) => agent.id === id,
  );
  if (!agent)
    throw new CanvasError(
      "RECIPIENT_UNAVAILABLE",
      "Session is no longer available in this workspace with active Canvas MCP access",
    );
  if (agent.pendingPermissions?.length)
    throw new CanvasError(
      "PERMISSION_PENDING",
      "Handle this session's pending permission in Paseo before sending",
    );
  if (agent.activeTurn && !allowInterrupt)
    throw new CanvasError(
      "INTERRUPT_CONFIRMATION",
      "This session is running. Sending may interrupt its current work",
    );
  return paseo.agents.ref(agent);
}
export async function recipients(
  sessions: Sessions,
  paseo: Paseo,
  workspaceId: string,
) {
  const candidates = await availableAgents(sessions, paseo, workspaceId);
  const output = [];
  const catalogs = new Map<
    string,
    Awaited<ReturnType<Paseo["providers"]["snapshot"]>>
  >();
  for (const current of candidates) {
    // The tab title lives in the current Paseo snapshot. The MCP binding may
    // predate its first prompt or a rename, so it is not a display-name source.
    let catalog = catalogs.get(current.cwd);
    if (!catalog) {
      catalog = await paseo.providers.snapshot({ cwd: current.cwd });
      catalogs.set(current.cwd, catalog);
    }
    const provider = catalog.entries.find(
      (entry) => entry.provider === current.provider,
    );
    const modelId = current.model;
    const model =
      modelId === null
        ? undefined
        : provider?.models?.find(
            (entry) => entry.id === modelId || entry.aliases?.includes(modelId),
          );
    const title =
      current.title?.trim().replace(/\s+/g, " ") || "Untitled session";
    const providerName = provider?.label ?? current.provider;
    const modelName = model?.label ?? current.model ?? "Model not reported";
    output.push({
      id: current.id,
      title: `${title} · ${providerName} / ${modelName}`,
      running: !!current.activeTurn,
      blocked: !!current.pendingPermissions?.length,
    });
  }
  return output;
}
async function send(
  store: ReviewStore,
  sessions: Sessions,
  paseo: Paseo,
  input: { workspaceId: string; canvasId: string; allowInterrupt: boolean },
  delivery: ReviewDelivery,
) {
  const attempt = delivery.attempts.at(-1)!;
  let started = false;
  try {
    const agent = await target(
      sessions,
      paseo,
      input.workspaceId,
      delivery.agentId,
      input.allowInterrupt,
    );
    started = true;
    await agent.send(delivery.prompt, { messageId: delivery.id });
  } catch (error) {
    return store.finish(
      input.workspaceId,
      input.canvasId,
      delivery.id,
      attempt.id,
      started ? "unknown" : "failed",
      started
        ? "Send result is unknown. Check the session before retrying."
        : error instanceof Error
          ? error.message
          : "Session could not be checked",
    );
  }
  return store.finish(
    input.workspaceId,
    input.canvasId,
    delivery.id,
    attempt.id,
    "accepted",
    null,
  );
}
export async function dispatchReview(
  store: ReviewStore,
  sessions: Sessions,
  paseo: Paseo,
  input: RpcInput<typeof sendReview>,
) {
  await target(
    sessions,
    paseo,
    input.workspaceId,
    input.agentId,
    input.allowInterrupt,
  );
  const delivery = await store.begin(
    input.workspaceId,
    input.canvasId,
    input.agentId,
    input.threads,
  );
  return send(store, sessions, paseo, input, delivery);
}
export async function retryDispatch(
  store: ReviewStore,
  sessions: Sessions,
  paseo: Paseo,
  input: RpcInput<typeof retryReview>,
) {
  const original = await store.delivery(
    input.workspaceId,
    input.canvasId,
    input.requestId,
  );
  await target(
    sessions,
    paseo,
    input.workspaceId,
    original.agentId,
    input.allowInterrupt,
  );
  return send(
    store,
    sessions,
    paseo,
    input,
    await store.retry(input.workspaceId, input.canvasId, input.requestId),
  );
}
