import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  unlink,
  lstat,
} from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import {
  contentSchema,
  idSchema,
  titleSchema,
  type Actor,
  type EditState,
  type Metadata,
  type PublicLock,
} from "../shared/contracts";
import { CanvasChanges } from "./changes";
import { CanvasError, isMissing } from "./errors";
import { decodeDocument, encodeDocument } from "./format";

type Lock = {
  info: PublicLock;
  token: string;
  sessionId: string;
  deadline: number;
};
export const LOCK_TTL_MS = 300_000;
const MAX_FILE_BYTES = 4_100_000;
export class CanvasStore {
  private readonly changes = new CanvasChanges();
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private locks = new Map<string, Lock>();
  private queues = new Map<string, Promise<unknown>>();
  private stopped: Error | null = null;
  private constructor(
    readonly directory: string,
    private release: () => Promise<void>,
    private clock: () => number,
    private monotonic: () => number,
  ) {}
  static async open(
    directory: string,
    options: {
      clock?: () => number;
      monotonic?: () => number;
      waitForOwner?: boolean;
    } = {},
  ) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let store: CanvasStore | undefined;
    const release = await lockfile.lock(directory, {
      realpath: true,
      stale: 30_000,
      update: 5_000,
      retries: options.waitForOwner
        ? { retries: 35, minTimeout: 1000, maxTimeout: 1000, factor: 1 }
        : 0,
      onCompromised(error) {
        if (store) store.stop(error);
      },
    });
    store = new CanvasStore(
      directory,
      release,
      options.clock ?? Date.now,
      options.monotonic ?? (() => performance.now()),
    );
    return store;
  }
  async close() {
    this.stop(new Error("Canvas store is closed"));
    await Promise.allSettled(this.queues.values());
    this.locks.clear();
    await this.release();
  }
  private stop(error: Error) {
    this.stopped = error;
    clearTimeout(this.expiryTimer);
    this.changes.close(error);
  }
  waitForChange(workspaceId: string, cursor: string | null) {
    this.assertOpen();
    idSchema.parse(workspaceId);
    // Expiry is also checked here after sleep or a system-clock adjustment.
    for (const key of this.locks.keys()) this.state(key);
    return this.changes.wait(workspaceId, cursor);
  }
  private changed(key: string) {
    this.changes.publish(key.split("/")[0]);
  }
  private scheduleExpiry() {
    clearTimeout(this.expiryTimer);
    if (this.stopped || !this.locks.size) return;
    const now = this.clock(),
      monotonic = this.monotonic();
    const delay = Math.min(
      ...[...this.locks.values()].map((lock) =>
        Math.min(
          Date.parse(lock.info.expiresAt) - now,
          lock.deadline - monotonic,
        ),
      ),
    );
    this.expiryTimer = setTimeout(
      () => {
        for (const key of this.locks.keys()) this.state(key);
        this.scheduleExpiry();
      },
      Math.max(1, delay),
    );
    this.expiryTimer.unref();
  }
  assertOpen() {
    if (this.stopped)
      throw new CanvasError("STORE_UNAVAILABLE", this.stopped.message);
  }
  private key(workspaceId: string, canvasId: string) {
    return `${idSchema.parse(workspaceId)}/${idSchema.parse(canvasId)}`;
  }
  private async serial<T>(key: string, action: () => Promise<T>): Promise<T> {
    this.assertOpen();
    const previous = this.queues.get(key) ?? Promise.resolve();
    const result = previous
      .catch(() => {})
      .then(() => {
        this.assertOpen();
        return action();
      });
    this.queues.set(key, result);
    try {
      return await result;
    } finally {
      if (this.queues.get(key) === result) this.queues.delete(key);
    }
  }
  private filename(key: string) {
    return path.join(this.directory, `${key}.md`);
  }
  private async workspaceDirectory(workspaceId: string) {
    const directory = path.join(this.directory, idSchema.parse(workspaceId));
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new CanvasError(
        "INVALID_STORAGE",
        "Workspace storage must be a real directory",
      );
    return directory;
  }
  private async read(key: string) {
    try {
      await this.workspaceDirectory(key.split("/")[0]);
      const file = this.filename(key);
      const stat = await lstat(file);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
        throw new CanvasError(
          "CORRUPT_DOCUMENT",
          "Canvas must be a regular file within the size limit",
        );
      const [workspaceId, canvasId] = key.split("/");
      let source: string;
      try {
        source = new TextDecoder("utf-8", { fatal: true }).decode(
          await readFile(file),
        );
      } catch (error) {
        if (error instanceof TypeError)
          throw new CanvasError(
            "CORRUPT_DOCUMENT",
            "Canvas is not valid UTF-8",
          );
        throw error;
      }
      return decodeDocument(source, workspaceId, canvasId);
    } catch (error) {
      if (isMissing(error))
        throw new CanvasError("NOT_FOUND", "Canvas does not exist");
      throw error;
    }
  }
  private state(key: string, now = this.clock()): EditState {
    const lock = this.locks.get(key);
    if (!lock) return { status: "unlocked" };
    if (
      now >= Date.parse(lock.info.expiresAt) ||
      this.monotonic() >= lock.deadline
    ) {
      this.locks.delete(key);
      this.scheduleExpiry();
      this.changed(key);
      return { status: "unlocked" };
    }
    return { status: "locked", lock: { ...lock.info } };
  }
  private async syncDirectory(directory: string) {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  private async write(key: string, metadata: Metadata, content: string) {
    const file = this.filename(key),
      directory = path.dirname(file);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await this.workspaceDirectory(metadata.workspaceId);
    await this.syncDirectory(this.directory);
    const temporary = path.join(
      directory,
      `.${metadata.canvasId}.${randomUUID()}.tmp`,
    );
    const handle = await open(temporary, "wx", 0o600);
    let committed = false;
    try {
      await handle.writeFile(encodeDocument(metadata, content), "utf8");
      await handle.sync();
      await handle.close();
      this.assertOpen();
      await rename(temporary, file);
      committed = true;
      await this.syncDirectory(directory);
    } catch (error) {
      // A directory-sync failure after rename leaves the commit outcome uncertain.
      // Stop writes rather than returning a success or reusing an uncertain revision.
      if (committed)
        this.stop(
          new Error(
            "Canvas durability could not be confirmed; reopen the store",
          ),
        );
      throw error;
    } finally {
      await handle.close();
      if (!committed)
        await unlink(temporary).catch((error) => {
          if (!isMissing(error)) throw error;
        });
    }
  }
  async list(workspaceId: string) {
    this.assertOpen();
    idSchema.parse(workspaceId);
    let entries;
    try {
      entries = await readdir(await this.workspaceDirectory(workspaceId), {
        withFileTypes: true,
      });
    } catch (error) {
      if (isMissing(error))
        return { items: [], observedAt: new Date(this.clock()).toISOString() };
      throw error;
    }
    const documents = await Promise.all(
      entries
        .filter((e) => e.name.endsWith(".md"))
        .map((e) => {
          const key = this.key(workspaceId, e.name.slice(0, -3));
          return this.serial(key, async () => ({
            key,
            ...(await this.read(key)),
          }));
        }),
    );
    const now = this.clock();
    const items = documents.map(({ key, metadata }) => ({
      ...metadata,
      editState: this.state(key, now),
    }));
    items.sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.canvasId.localeCompare(b.canvasId),
    );
    return { items, observedAt: new Date(now).toISOString() };
  }
  async get(workspaceId: string, canvasId: string) {
    const key = this.key(workspaceId, canvasId);
    return this.serial(key, async () => {
      const { metadata, content } = await this.read(key),
        now = this.clock();
      return {
        canvas: { ...metadata, content, editState: this.state(key, now) },
        observedAt: new Date(now).toISOString(),
      };
    });
  }
  async create(actor: Actor, title: string, content: string) {
    const canvasId = randomUUID(),
      key = this.key(actor.workspaceId, canvasId);
    return this.serial(key, async () => {
      const timestamp = new Date(this.clock()).toISOString();
      const metadata: Metadata = {
        schemaVersion: 1,
        workspaceId: actor.workspaceId,
        canvasId,
        title: titleSchema.parse(title),
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        updatedByAgentId: idSchema.parse(actor.agentId),
      };
      await this.write(key, metadata, contentSchema.parse(content));
      this.changed(key);
      return { canvasId, revision: 1, snapshot: { metadata, content } };
    });
  }
  private verify(
    key: string,
    actor: Actor,
    token: string,
    metadata: Metadata,
    revision?: number,
  ) {
    const editState = this.state(key),
      lock = this.locks.get(key);
    if (
      !lock ||
      lock.token !== token ||
      lock.sessionId !== actor.sessionId ||
      lock.info.ownerAgentId !== actor.agentId ||
      (revision !== undefined && metadata.revision !== revision)
    ) {
      throw new CanvasError(
        "CONFLICT",
        "Lock ownership, expiry, or revision does not match; read the Canvas again",
        { revision: metadata.revision, editState },
      );
    }
    return lock;
  }
  async acquire(actor: Actor, canvasId: string) {
    const key = this.key(actor.workspaceId, canvasId);
    return this.serial(key, async () => {
      const { metadata } = await this.read(key),
        now = this.clock();
      if (this.state(key, now).status === "locked")
        throw new CanvasError("LOCKED", "Canvas is already being edited", {
          revision: metadata.revision,
          editState: this.state(key, now),
        });
      const timestamp = new Date(now).toISOString();
      const info: PublicLock = {
        id: randomUUID(),
        ownerAgentId: actor.agentId,
        ownerAgentTitle: actor.title,
        acquiredAt: timestamp,
        renewedAt: timestamp,
        expiresAt: new Date(now + LOCK_TTL_MS).toISOString(),
      };
      const token = randomBytes(32).toString("base64url");
      this.locks.set(key, {
        info,
        token,
        sessionId: actor.sessionId,
        deadline: this.monotonic() + LOCK_TTL_MS,
      });
      this.scheduleExpiry();
      this.changed(key);
      return {
        editState: { status: "locked" as const, lock: { ...info } },
        lockToken: token,
        revision: metadata.revision,
      };
    });
  }
  async renew(actor: Actor, canvasId: string, token: string) {
    const key = this.key(actor.workspaceId, canvasId);
    return this.serial(key, async () => {
      const { metadata } = await this.read(key),
        lock = this.verify(key, actor, token, metadata),
        now = this.clock();
      lock.info.renewedAt = new Date(now).toISOString();
      lock.info.expiresAt = new Date(now + LOCK_TTL_MS).toISOString();
      lock.deadline = this.monotonic() + LOCK_TTL_MS;
      this.scheduleExpiry();
      this.changed(key);
      return { editState: this.state(key, now) };
    });
  }
  async releaseLock(actor: Actor, canvasId: string, token: string) {
    const key = this.key(actor.workspaceId, canvasId);
    return this.serial(key, async () => {
      const { metadata } = await this.read(key);
      this.verify(key, actor, token, metadata);
      this.locks.delete(key);
      this.scheduleExpiry();
      this.changed(key);
      return { editState: { status: "unlocked" as const } };
    });
  }
  async update(
    actor: Actor,
    input: {
      canvasId: string;
      lockToken: string;
      expectedRevision: number;
      title?: string;
      content?: string;
    },
  ) {
    const key = this.key(actor.workspaceId, input.canvasId);
    return this.serial(key, async () => {
      const previous = await this.read(key);
      this.verify(
        key,
        actor,
        input.lockToken,
        previous.metadata,
        input.expectedRevision,
      );
      const metadata = {
        ...previous.metadata,
        title:
          input.title === undefined
            ? previous.metadata.title
            : titleSchema.parse(input.title),
        revision: previous.metadata.revision + 1,
        updatedAt: new Date(this.clock()).toISOString(),
        updatedByAgentId: actor.agentId,
      };
      const content =
        input.content === undefined
          ? previous.content
          : contentSchema.parse(input.content);
      await this.write(key, metadata, content);
      this.changed(key);
      return {
        canvasId: input.canvasId,
        revision: metadata.revision,
        snapshot: { metadata, content },
      };
    });
  }
  async delete(
    actor: Actor,
    input: { canvasId: string; lockToken: string; expectedRevision: number },
  ) {
    const key = this.key(actor.workspaceId, input.canvasId);
    return this.serial(key, async () => {
      const { metadata } = await this.read(key);
      this.verify(
        key,
        actor,
        input.lockToken,
        metadata,
        input.expectedRevision,
      );
      await unlink(this.filename(key));
      try {
        await this.syncDirectory(path.dirname(this.filename(key)));
      } catch (error) {
        this.stop(
          new Error("Canvas deletion durability could not be confirmed"),
        );
        throw error;
      }
      this.locks.delete(key);
      this.scheduleExpiry();
      this.changed(key);
      return { deleted: true };
    });
  }
}
