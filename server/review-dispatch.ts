import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { RpcInput } from "@getpaseo/plugin";
import { sendReview, retryReview, type ReviewDelivery } from "../shared/review";
import type { Sessions } from "./sessions";
import type { ReviewStore } from "./reviews";
import { CanvasError } from "./errors";
type Paseo = PluginHandlerContext["paseo"];
async function target(
  sessions: Sessions,
  paseo: Paseo,
  workspaceId: string,
  id: string,
  allowInterrupt: boolean,
) {
  if (!sessions.eligible(workspaceId).some((s) => s.id === id))
    throw new CanvasError(
      "RECIPIENT_UNAVAILABLE",
      "This session does not have active Canvas MCP access",
    );
  const agent = paseo.agents.ref(id);
  await agent.refresh();
  if (agent.workspaceId !== workspaceId || agent.archivedAt)
    throw new CanvasError(
      "RECIPIENT_UNAVAILABLE",
      "Session is no longer available in this workspace",
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
  return agent;
}
export async function recipients(
  sessions: Sessions,
  paseo: Paseo,
  workspaceId: string,
) {
  const candidates = sessions.eligible(workspaceId);
  const output = [];
  const catalogs = new Map<
    string,
    Awaited<ReturnType<Paseo["providers"]["snapshot"]>>
  >();
  for (const candidate of candidates) {
    const agent = paseo.agents.ref(candidate.id);
    await agent.refresh();
    if (agent.workspaceId !== workspaceId || agent.archivedAt) continue;
    const current = agent.current();
    if (!current)
      throw new CanvasError(
        "RECIPIENT_UNAVAILABLE",
        "Unable to load session details",
      );
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
      id: candidate.id,
      title: `${title} · ${providerName} / ${modelName}`,
      running: !!agent.activeTurn,
      blocked: !!agent.pendingPermissions?.length,
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
