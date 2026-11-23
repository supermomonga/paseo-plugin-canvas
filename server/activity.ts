import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { canvasActivitySchema, type CanvasActivity } from "../shared/activity";
import { idSchema } from "../shared/contracts";
import { syncDirectory } from "./durability";
import { isMissing } from "./errors";

const entrySchema = z.object({
  agentId: idSchema,
  activity: canvasActivitySchema,
});
type Entry = z.infer<typeof entrySchema>;
type Paseo = PluginHandlerContext["paseo"];

/** A notification nobody could deliver for this long is dropped. */
export const ACTIVITY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_MAX_MS = 60_000;

export class CanvasActivityQueue {
  private pending = new Map<string, Entry>();
  private delivering: Promise<void> = Promise.resolve();
  // The plugin's daemon session. Paseo hands the same PaseoApi to every hook
  // and handler of the plugin process; it closes when the plugin stops.
  private connection: Paseo | null = null;
  private retry?: ReturnType<typeof setTimeout>;
  private failures = 0;
  private closed = false;
  private constructor(
    private directory: string,
    private clock: () => number,
  ) {}

  static async open(root: string, options: { clock?: () => number } = {}) {
    const queue = new CanvasActivityQueue(
      path.join(root, "activity"),
      options.clock ?? Date.now,
    );
    await mkdir(queue.directory, { recursive: true, mode: 0o700 });
    await syncDirectory(root);
    const entries: [string, Entry][] = [];
    for (const filename of (await readdir(queue.directory)).sort()) {
      if (!filename.endsWith(".json")) continue;
      const entry = entrySchema.parse(
        JSON.parse(
          await readFile(path.join(queue.directory, filename), "utf8"),
        ),
      );
      if (filename !== `${queue.key(entry.activity)}.json`)
        throw new Error("Canvas activity identity mismatch");
      entries.push([queue.key(entry.activity), entry]);
    }
    entries.sort(
      ([, a], [, b]) =>
        a.activity.savedAt.localeCompare(b.activity.savedAt) ||
        a.activity.revision - b.activity.revision,
    );
    queue.pending = new Map(entries);
    return queue;
  }

  get size() {
    return this.pending.size;
  }

  private key(activity: CanvasActivity) {
    return `${activity.canvasId}-${activity.revision}`;
  }

  async enqueue(agentId: string, activity: CanvasActivity) {
    const entry = entrySchema.parse({ agentId, activity });
    const key = this.key(activity);
    const temporary = path.join(this.directory, `${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(entry));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, path.join(this.directory, `${key}.json`));
      await syncDirectory(this.directory);
    } finally {
      await unlink(temporary).catch((error) => {
        if (!isMissing(error)) throw error;
      });
    }
    this.pending.set(key, entry);
    this.kick();
  }

  /**
   * Keeps the daemon session a hook or handler received, so a save can be
   * delivered at once (ADR 18). Pending notifications are retried with it.
   */
  remember(paseo: Paseo) {
    if (this.closed) return;
    const changed = this.connection !== paseo;
    this.connection = paseo;
    if (changed) this.kick();
  }

  /** Delivers every pending notification through `paseo`. */
  deliver(paseo: Paseo): Promise<void> {
    const round = this.delivering.then(() => this.round(paseo));
    this.delivering = round.catch(() => {});
    return round;
  }

  /** An archived agent shows no more rows; forget what it never received. */
  async drop(agentId: string) {
    for (const [key, entry] of [...this.pending])
      if (entry.agentId === agentId) await this.remove(key);
  }

  async close() {
    this.closed = true;
    clearTimeout(this.retry);
    this.connection = null;
    await this.delivering;
  }

  private kick() {
    const paseo = this.connection;
    if (paseo && this.pending.size && !this.closed)
      void this.deliver(paseo).catch(() => {});
  }

  private async round(paseo: Paseo) {
    let failure: unknown;
    for (const [key, entry] of [...this.pending]) {
      if (this.closed) return;
      if (!this.pending.has(key)) continue;
      if (
        this.clock() - Date.parse(entry.activity.savedAt) >
        ACTIVITY_MAX_AGE_MS
      ) {
        await this.remove(key);
        continue;
      }
      try {
        // Appending the same plugin row ID replaces the earlier row, so a
        // retry after a lost response cannot duplicate it.
        await paseo.agents.ref(entry.agentId).timeline.append({
          type: "plugin",
          id: `canvas-${key}`,
          kind: "canvas-activity",
          version: 1,
          data: entry.activity,
        });
        await this.remove(key);
      } catch (error) {
        // Keep it for retry without starving notifications for other agents,
        // unless the agent was archived meanwhile.
        if (this.pending.delete(key)) {
          this.pending.set(key, entry);
          failure = error;
        }
      }
    }
    if (failure === undefined) {
      this.failures = 0;
      return;
    }
    this.scheduleRetry();
    throw failure;
  }

  private scheduleRetry() {
    clearTimeout(this.retry);
    if (this.closed || !this.connection) return;
    const delay = Math.min(RETRY_MAX_MS, 1000 * 2 ** Math.min(this.failures++, 6));
    this.retry = setTimeout(() => this.kick(), delay);
    this.retry.unref?.();
  }

  private async remove(key: string) {
    await unlink(path.join(this.directory, `${key}.json`)).catch((error) => {
      if (!isMissing(error)) throw error;
    });
    await syncDirectory(this.directory);
    this.pending.delete(key);
  }
}
