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
  for (const candidate of candidates) {
    const agent = paseo.agents.ref(candidate.id);
    await agent.refresh();
    if (agent.workspaceId !== workspaceId || agent.archivedAt) continue;
    output.push({
      id: candidate.id,
      title: candidate.title ?? candidate.id,
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
