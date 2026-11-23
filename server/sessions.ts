import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, readFile, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { idSchema, type Actor } from "../shared/contracts";
import { syncDirectory } from "./durability";
import { CanvasError, isMissing } from "./errors";
import type { CanvasStore } from "./store";

/** Name of the MCP server added to each agent launch (ADR 18). */
export const MCP_SERVER_NAME = "paseo_canvas";
/** Name saved in the configuration of agents created by Canvas 0.3 or earlier. */
export const SAVED_MCP_SERVER_NAME = "paseo-canvas";

const bindingSchema = z
  .object({
    agentId: idSchema,
    workspaceId: idSchema,
    sessionId: z.string().uuid(),
    title: z.string().nullable(),
    active: z.boolean(),
    /** The credential lives in the agent's saved configuration (Canvas 0.3 or earlier). */
    saved: z.boolean(),
  })
  .strict();
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const portSchema = z.number().int().min(1).max(65535);
const stateSchema = z
  .object({
    version: z.literal(2),
    port: portSchema,
    /** Port in the saved descriptors of earlier agents; they work only while it is unchanged. */
    savedPort: portSchema.nullable(),
    bindings: z.record(digestSchema, bindingSchema),
  })
  .strict();
const legacyStateSchema = z
  .object({
    version: z.literal(1),
    port: portSchema,
    bindings: z.record(
      digestSchema,
      bindingSchema.omit({ saved: true }).strict(),
    ),
  })
  .strict();
type Binding = z.infer<typeof bindingSchema>;
type State = z.infer<typeof stateSchema>;
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");

function upgrade(value: unknown): State {
  const version = (value as { version?: unknown } | null)?.version;
  if (version === 2) return stateSchema.parse(value);
  // Every version 1 credential was saved into an agent configuration.
  const legacy = legacyStateSchema.parse(value);
  return {
    version: 2,
    port: legacy.port,
    savedPort: legacy.port,
    bindings: Object.fromEntries(
      Object.entries(legacy.bindings).map(([hash, binding]) => [
        hash,
        { ...binding, saved: true },
      ]),
    ),
  };
}

/** Owned by the same exclusive storage lease as the documents. Each agent
 * launch receives a new credential; this registry stores only its hash. */
export class Sessions {
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
      state = upgrade(JSON.parse(await readFile(file, "utf8")));
      // An agent has at most one saved and one launch credential.
      const keys = Object.values(state.bindings).map(
        (binding) => `${binding.saved}:${binding.agentId}`,
      );
      if (new Set(keys).size !== keys.length)
        throw new Error(
          "Canvas MCP state contains duplicate agent registrations",
        );
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    return new Sessions(store, state);
  }

  /** The preferred listening port; 0 until one has been allocated. */
  get port() {
    return this.state?.port ?? 0;
  }

  async setPort(port: number) {
    await this.mutate(() =>
      this.state
        ? this.state.port === port
          ? this.state
          : { ...this.state, port }
        : { version: 2, port, savedPort: null, bindings: {} },
    );
  }

  /**
   * Binds one interactive opening of an agent. Returns the credential for its
   * launch-only MCP descriptor, or null when the agent already connects through
   * a descriptor saved by an earlier Canvas version.
   */
  async connect(
    agentId: string,
    workspaceId: string,
    title: string | null,
  ): Promise<{ token: string } | null> {
    idSchema.parse(agentId);
    idSchema.parse(workspaceId);
    let result: { token: string } | null = null;
    await this.mutate(() => {
      const state = this.requireState();
      const entries = Object.entries(state.bindings).filter(
        ([, binding]) => binding.agentId === agentId,
      );
      const saved = entries.find(([, binding]) => binding.saved);
      if (saved && state.savedPort === state.port) {
        const [hash, prior] = saved;
        if (prior.workspaceId !== workspaceId)
          throw new Error(
            "Canvas MCP registration does not belong to this agent and workspace",
          );
        // A reopened agent starts a new edit session; its old lock tokens lapse.
        const binding: Binding = {
          ...prior,
          sessionId: randomUUID(),
          title: title ?? prior.title,
          active: true,
        };
        return { ...state, bindings: { ...state.bindings, [hash]: binding } };
      }
      const token = randomBytes(32).toString("base64url");
      result = { token };
      // Keep an unusable saved binding, so unarchiving cannot duplicate tools later.
      const bindings = Object.fromEntries(
        Object.entries(state.bindings).filter(
          ([, binding]) => binding.agentId !== agentId || binding.saved,
        ),
      );
      if (saved) bindings[saved[0]] = { ...saved[1], active: false };
      bindings[digest(token)] = {
        agentId,
        workspaceId,
        sessionId: randomUUID(),
        title: title ?? entries.find(([, b]) => b.title !== null)?.[1].title ?? null,
        active: true,
        saved: false,
      };
      return { ...state, bindings };
    });
    return result;
  }

  resolve(token: string): Actor {
    this.assertOpen();
    const binding = this.state?.bindings[digest(token)];
    if (!binding?.active)
      throw new CanvasError(
        "UNAUTHORIZED",
        "Canvas session credential is not active",
      );
    return {
      agentId: binding.agentId,
      workspaceId: binding.workspaceId,
      sessionId: binding.sessionId,
      title: binding.title,
    };
  }

  async title(agentId: string, title: string | null) {
    await this.mutate(() => {
      const state = this.requireState();
      let changed = false;
      const bindings = Object.fromEntries(
        Object.entries(state.bindings).map(([hash, binding]) => {
          if (binding.agentId !== agentId || binding.title === title)
            return [hash, binding];
          changed = true;
          return [hash, { ...binding, title }];
        }),
      );
      return changed ? { ...state, bindings } : state;
    });
  }

  /** Archived agents lose access. A saved binding stays to recognize its descriptor. */
  async revoke(agentId: string) {
    await this.mutate(() => {
      const state = this.requireState();
      let changed = false;
      const bindings: Record<string, Binding> = {};
      for (const [hash, binding] of Object.entries(state.bindings)) {
        if (binding.agentId !== agentId) bindings[hash] = binding;
        else if (binding.saved) {
          changed ||= binding.active;
          bindings[hash] = { ...binding, active: false };
        } else changed = true;
      }
      return changed ? { ...state, bindings } : state;
    });
  }

  async close() {
    this.closing = true;
    await this.queue.catch(() => {});
    this.stopped = true;
    this.state = null;
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
      await syncDirectory(this.store.directory);
    } finally {
      await file.close();
      if (!renamed)
        await unlink(temporary).catch((error) => {
          if (!isMissing(error)) throw error;
        });
    }
  }
}
