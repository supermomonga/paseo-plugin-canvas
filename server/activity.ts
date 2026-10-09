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
import { CanvasChanges } from "./changes";
import { isMissing } from "./errors";

const entrySchema = z.object({
  agentId: idSchema,
  activity: canvasActivitySchema,
});
type Entry = z.infer<typeof entrySchema>;
// Derived from the host SDK: npm installations omit @getpaseo/client (ADR 14).
type PaseoAgentTimelineHandle = ReturnType<
  PluginHandlerContext["paseo"]["agents"]["ref"]
>["timeline"];
type PaseoAgentTimelineRefetchOptions = NonNullable<
  Parameters<PaseoAgentTimelineHandle["refetch"]>[0]
>;

async function alreadyAppended(timeline: PaseoAgentTimelineHandle, id: string) {
  let cursor: PaseoAgentTimelineRefetchOptions["cursor"];
  for (;;) {
    const page = await timeline.refetch({
      direction: cursor ? "before" : "tail",
      cursor,
      limit: 200,
      projection: "canonical",
    });
    if (page.error) throw new Error(page.error);
    if (page.staleCursor || page.reset || page.gap)
      throw new Error(
        "Timeline changed while checking canvas notification delivery",
      );
    if (
      page.entries.some(
        ({ item }) =>
          item.type === "plugin" &&
          item.pluginId === "paseo-canvas" &&
          item.id === id,
      )
    )
      return true;
    if (!page.hasOlder) return false;
    if (!page.startCursor || (cursor && page.startCursor.seq >= cursor.seq))
      throw new Error("Timeline pagination did not advance");
    cursor = page.startCursor;
  }
}

export class CanvasActivityQueue {
  private changes = new CanvasChanges();
  private pending = new Map<string, Entry>();
  private publishing: Promise<void> = Promise.resolve();
  private constructor(private directory: string) {}

  static async open(root: string) {
    const queue = new CanvasActivityQueue(path.join(root, "activity"));
    await mkdir(queue.directory, { recursive: true, mode: 0o700 });
    const directory = await open(root, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    for (const filename of (await readdir(queue.directory)).sort()) {
      if (!filename.endsWith(".json")) continue;
      const entry = entrySchema.parse(
        JSON.parse(
          await readFile(path.join(queue.directory, filename), "utf8"),
        ),
      );
      if (filename !== `${queue.key(entry.activity)}.json`)
        throw new Error("Canvas activity identity mismatch");
      queue.pending.set(queue.key(entry.activity), entry);
    }
    queue.pending = new Map(
      [...queue.pending].sort(
        (a, b) =>
          a[1].activity.savedAt.localeCompare(b[1].activity.savedAt) ||
          a[1].activity.revision - b[1].activity.revision,
      ),
    );
    return queue;
  }

  private key(activity: CanvasActivity) {
    return `${activity.canvasId}-${activity.revision}`;
  }

  private async syncDirectory() {
    const file = await open(this.directory, "r");
    try {
      await file.sync();
    } finally {
      await file.close();
    }
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
      await this.syncDirectory();
    } finally {
      await unlink(temporary).catch((error) => {
        if (!isMissing(error)) throw error;
      });
    }
    this.pending.set(key, entry);
    this.changes.publish("activity");
  }

  async sync(cursor: string | null, context: PluginHandlerContext) {
    const next = await this.changes.wait(
      "activity",
      this.pending.size ? null : cursor,
    );
    const publish = this.publishing.then(async () => {
      let failure: unknown;
      for (const [key, entry] of [...this.pending].slice(0, 10)) {
        try {
          const timeline = context.paseo.agents.ref(entry.agentId).timeline;
          const id = `canvas-${key}`;
          if (!(await alreadyAppended(timeline, id)))
            await timeline.append({
              type: "plugin",
              id,
              kind: "canvas-activity",
              version: 1,
              data: entry.activity,
            });
          await unlink(path.join(this.directory, `${key}.json`)).catch(
            (error) => {
              if (!isMissing(error)) throw error;
            },
          );
          await this.syncDirectory();
          this.pending.delete(key);
        } catch (error) {
          // Keep failed notifications for retry without starving other agents.
          this.pending.delete(key);
          this.pending.set(key, entry);
          failure = error;
        }
      }
      if (failure) throw failure;
    });
    this.publishing = publish.catch(() => {});
    await publish;
    return next;
  }

  async close() {
    this.changes.close(new Error("Canvas activity stopped"));
    await this.publishing;
  }
}
