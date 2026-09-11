import { expect, test } from "vitest";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, utimes, symlink, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CanvasStore } from "../server/store";
test("exclusive process owner; after a killed owner and stale lease, saved content is recovered without its edit lock", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "canvas-recovery-"));
  const child = fork(path.resolve("tests/fixtures/store-process.ts"), [dir], {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  try {
    const [created] = await once(child, "message");
    await expect(CanvasStore.open(dir)).rejects.toMatchObject({
      code: "ELOCKED",
    });
    const exit = once(child, "exit");
    child.kill("SIGKILL");
    await exit;
    // Simulate the documented 30-second stale-owner interval without slowing the suite.
    await utimes(`${dir}.lock`, new Date(0), new Date(0));
    const store = await CanvasStore.open(dir);
    try {
      expect(
        (await store.get("workspace", created.canvasId)).canvas,
      ).toMatchObject({
        content: "# Durable",
        editState: { status: "unlocked" },
      });
    } finally {
      await store.close();
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await rm(dir, { recursive: true, force: true });
  }
});
test("workspace symlinks cannot redirect Canvas writes outside the store", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "canvas-symlink-")),
    outside = await mkdtemp(path.join(tmpdir(), "canvas-outside-"));
  const store = await CanvasStore.open(dir);
  try {
    await symlink(outside, path.join(dir, "workspace"), "dir");
    await expect(
      store.create(
        {
          agentId: "agent",
          workspaceId: "workspace",
          title: null,
          sessionId: "session",
        },
        "title",
        "content",
      ),
    ).rejects.toMatchObject({ code: "INVALID_STORAGE" });
    expect(await readdir(outside)).toEqual([]);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
