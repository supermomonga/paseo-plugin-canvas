import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, readFile, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { idSchema, type Actor } from "../shared/contracts";
import { CanvasError, isMissing } from "./errors";
import type { CanvasStore } from "./store";

const bindingSchema = z
  .object({
    agentId: idSchema,
    workspaceId: idSchema,
    sessionId: z.string().uuid(),
    title: z.string().nullable(),
    active: z.boolean(),
  })
  .strict();
const stateSchema = z
  .object({
    version: z.literal(1),
    port: z.number().int().min(1).max(65535),
    bindings: z.record(z.string().regex(/^[a-f0-9]{64}$/), bindingSchema),
  })
  .strict();
type Binding = z.infer<typeof bindingSchema>;
type State = z.infer<typeof stateSchema>;
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** Owned by the same exclusive storage lease as the documents. Secrets are
 * persisted in Paseo's agent config; this registry stores only their hashes. */
export class Sessions {
  private pending = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private closing = false;
  private constructor(
    private store: CanvasStore,
    private state: State | null,
  ) {}

  static async open(store: CanvasStore) {
    const file = path.join(store.directory, "mcp.json");
    let state: State | null = null;
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.size > 16_000_000)
        throw new Error(
          "Canvas MCP state must be a regular file within the size limit",
        );
      state = stateSchema.parse(JSON.parse(await readFile(file, "utf8")));
      const ids = Object.values(state.bindings).map(
        (binding) => binding.agentId,
      );
      if (new Set(ids).size !== ids.length)
        throw new Error(
          "Canvas MCP state contains duplicate agent registrations",
        );
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    return new Sessions(store, state);
  }

  get port() {
    return this.state?.port ?? 0;
  }
  eligible(workspaceId: string) {
    this.assertOpen();
    return Object.values(this.state?.bindings ?? {})
      .filter((b) => b.active && b.workspaceId === workspaceId)
      .map((b) => ({ id: b.agentId, title: b.title }));
  }

  async setPort(port: number) {
    await this.mutate(() => {
      if (this.state && this.state.port !== port)
        throw new Error(
          "Canvas MCP port cannot change for existing registrations",
        );
      return this.state ?? { version: 1, port, bindings: {} };
    });
  }

  register() {
    if (this.closing) throw new Error("Canvas MCP registrations are closing");
    this.assertOpen();
    const token = randomBytes(32).toString("base64url");
    this.pending.add(digest(token));
    return token;
  }

  async activate(agentId: string, workspaceId: string, registration?: string) {
    idSchema.parse(agentId);
    idSchema.parse(workspaceId);
    await this.mutate(() => {
      const state = this.requireState();
      const existing = Object.entries(state.bindings).find(
        ([, b]) => b.agentId === agentId,
      );
      const hash = registration ? digest(registration) : existing?.[0];
      if (!hash) return state; // Agents created before installation have no registration.
      const prior = state.bindings[hash];
      if (registration && !this.pending.has(hash) && !prior)
        throw new Error("Unknown Canvas MCP registration");
      if (
        (prior &&
          (prior.agentId !== agentId || prior.workspaceId !== workspaceId)) ||
        (existing && existing[0] !== hash)
      )
        throw new Error(
          "Canvas MCP registration does not belong to this agent and workspace",
        );
      const binding: Binding = {
        agentId,
        workspaceId,
        sessionId: randomUUID(),
        title: prior?.title ?? null,
        active: true,
      };
      return { ...state, bindings: { ...state.bindings, [hash]: binding } };
    });
    if (registration) this.pending.delete(digest(registration));
  }

  resolve(token: string): Actor {
    this.assertOpen();
    const binding = this.state?.bindings[digest(token)];
    if (!binding?.active)
      throw new CanvasError(
        "UNAUTHORIZED",
        "Canvas session credential is not active",
      );
    const { active: _, ...actor } = binding;
    return { ...actor };
  }

  async title(agentId: string, title: string | null) {
    await this.updateAgent(agentId, (binding) =>
      binding.title === title ? binding : { ...binding, title },
    );
  }

  async revoke(agentId: string) {
    await this.updateAgent(agentId, (binding) =>
      binding.active ? { ...binding, active: false } : binding,
    );
  }

  async close() {
    this.closing = true;
    await this.queue.catch(() => {});
    this.stopped = true;
    this.pending.clear();
    this.state = null;
  }

  private async updateAgent(
    agentId: string,
    update: (binding: Binding) => Binding,
  ) {
    await this.mutate(() => {
      const state = this.requireState();
      const entry = Object.entries(state.bindings).find(
        ([, b]) => b.agentId === agentId,
      );
      if (!entry) return state;
      const binding = update(entry[1]);
      return binding === entry[1]
        ? state
        : { ...state, bindings: { ...state.bindings, [entry[0]]: binding } };
    });
  }

  private requireState() {
    if (!this.state) throw new Error("Canvas MCP endpoint is not ready");
    return this.state;
  }

  private assertOpen() {
    this.store.assertOpen();
    if (this.stopped)
      throw new Error("Canvas MCP registrations are unavailable");
  }

  private async mutate(change: () => State) {
    if (this.closing) throw new Error("Canvas MCP registrations are closing");
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        this.assertOpen();
        const next = change();
        if (next === this.state) return;
        // Validate before touching disk. A rejected binding must not break other agents.
        stateSchema.parse(next);
        try {
          await this.persist(next);
          this.state = next;
        } catch (error) {
          // Never serve uncertain authorization state after a failed durable write.
          this.stopped = true;
          throw error;
        }
      });
    this.queue = operation;
    await operation;
  }

  private async persist(state: State) {
    const temporary = path.join(
      this.store.directory,
      `.mcp.${randomUUID()}.tmp`,
    );
    const file = await open(temporary, "wx", 0o600);
    let renamed = false;
    try {
      await file.writeFile(JSON.stringify(state), "utf8");
      await file.sync();
      await file.close();
      this.assertOpen();
      await rename(temporary, path.join(this.store.directory, "mcp.json"));
      renamed = true;
      const directory = await open(this.store.directory, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await file.close();
      if (!renamed)
        await unlink(temporary).catch((error) => {
          if (!isMissing(error)) throw error;
        });
    }
  }
}
