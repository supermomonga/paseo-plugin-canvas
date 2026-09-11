import { randomBytes, randomUUID } from "node:crypto";
import type { Actor } from "../shared/contracts";
import { CanvasError } from "./errors";
export class Sessions {
  private tokens = new Map<string, Actor>();
  issue(agentId: string, workspaceId: string) {
    this.revoke(agentId);
    const token = randomBytes(32).toString("base64url");
    this.tokens.set(token, {
      agentId,
      workspaceId,
      title: null,
      sessionId: randomUUID(),
    });
    return token;
  }
  resolve(token: string): Actor {
    const actor = this.tokens.get(token);
    if (!actor)
      throw new CanvasError(
        "UNAUTHORIZED",
        "Canvas session credential is no longer valid",
      );
    return { ...actor };
  }
  title(agentId: string, title: string | null) {
    for (const actor of this.tokens.values())
      if (actor.agentId === agentId) actor.title = title;
  }
  revoke(agentId: string) {
    for (const [token, actor] of this.tokens)
      if (actor.agentId === agentId) this.tokens.delete(token);
  }
  clear() {
    this.tokens.clear();
  }
}
