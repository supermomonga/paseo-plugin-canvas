import { afterEach, expect, test } from "vitest";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  stat,
  symlink,
  rename,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { CanvasStore } from "../server/store";
import { Sessions } from "../server/sessions";
import { startMcp } from "../server/mcp";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), "canvas-sessions-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const store = await CanvasStore.open(directory);
  cleanup.push(() => store.close());
  const sessions = await Sessions.open(store);
  cleanup.push(() => sessions.close());
  return { directory, store, sessions };
}

test("each opening gets a new launch credential; only hashes persist and reload keeps the current one", async () => {
  const { directory, store, sessions } = await setup();
  const mcp = await startMcp(store, sessions, { enqueue: async () => {} });
  const first = await sessions.connect("a", "workspace", "Agent A");
  const other = await sessions.connect("c", "other-workspace", null);
  expect(first).not.toBeNull();
  const actor = sessions.resolve(first!.token);
  expect(actor).toMatchObject({
    agentId: "a",
    workspaceId: "workspace",
    title: "Agent A",
  });
  // Reopening rotates the credential and starts a new edit session.
  const second = await sessions.connect("a", "workspace", null);
  expect(second!.token).not.toBe(first!.token);
  expect(() => sessions.resolve(first!.token)).toThrow(/not active/);
  const reopened = sessions.resolve(second!.token);
  expect(reopened.sessionId).not.toBe(actor.sessionId);
  expect(reopened.title).toBe("Agent A");
  await sessions.title("a", "Renamed");
  await mcp.close();
  await sessions.close();
  const persisted = await readFile(path.join(directory, "mcp.json"), "utf8");
  for (const token of [first!.token, second!.token, other!.token])
    expect(persisted).not.toContain(token);
  expect(JSON.parse(persisted)).toMatchObject({ version: 2, savedPort: null });
  expect((await stat(path.join(directory, "mcp.json"))).mode & 0o777).toBe(
    0o600,
  );
  const restored = await Sessions.open(store);
  cleanup.push(() => restored.close());
  const next = await startMcp(store, restored, { enqueue: async () => {} });
  cleanup.push(() => next.close());
  // Running sessions keep their address across a plugin reload.
  expect(next.url).toBe(mcp.url);
  expect(restored.resolve(second!.token)).toEqual({
    ...reopened,
    title: "Renamed",
  });
  expect(restored.resolve(other!.token).workspaceId).toBe("other-workspace");
  await restored.revoke("a");
  expect(() => restored.resolve(second!.token)).toThrow(/not active/);
});

test("descriptors saved by Canvas 0.3 keep working; their agents get no second server", async () => {
  const { directory, store } = await setup();
  const savedToken = "saved-token-from-0.3";
  await writeFile(
    path.join(directory, "mcp.json"),
    JSON.stringify({
      version: 1,
      port: 12345,
      bindings: {
        [createHash("sha256").update(savedToken).digest("hex")]: {
          agentId: "legacy",
          workspaceId: "workspace",
          sessionId: "00000000-0000-4000-8000-000000000001",
          title: "Legacy agent",
          active: false,
        },
      },
    }),
  );
  const sessions = await Sessions.open(store);
  cleanup.push(() => sessions.close());
  expect(sessions.port).toBe(12345);
  expect(() => sessions.resolve(savedToken)).toThrow(/not active/);
  // An archived legacy agent that reopens is reactivated with a new session.
  expect(await sessions.connect("legacy", "workspace", null)).toBeNull();
  const actor = sessions.resolve(savedToken);
  expect(actor).toMatchObject({ agentId: "legacy", title: "Legacy agent" });
  expect(actor.sessionId).not.toBe("00000000-0000-4000-8000-000000000001");
  await expect(
    sessions.connect("legacy", "other-workspace", null),
  ).rejects.toThrow(/does not belong/);
  await sessions.revoke("legacy");
  expect(() => sessions.resolve(savedToken)).toThrow(/not active/);
  expect(await sessions.connect("legacy", "workspace", null)).toBeNull();
  expect(sessions.resolve(savedToken).agentId).toBe("legacy");
  // Once the port moves, the saved address is dead: the agent gets a launch
  // credential instead and the saved one stays inactive.
  await sessions.setPort(23456);
  const launched = await sessions.connect("legacy", "workspace", null);
  expect(launched).not.toBeNull();
  expect(() => sessions.resolve(savedToken)).toThrow(/not active/);
  expect(sessions.resolve(launched!.token).title).toBe("Legacy agent");
  expect(
    JSON.parse(await readFile(path.join(directory, "mcp.json"), "utf8")),
  ).toMatchObject({ version: 2, port: 23456, savedPort: 12345 });
});

test("a taken port moves the endpoint instead of failing", async () => {
  const { store, sessions, directory } = await setup();
  const occupied = createServer();
  await new Promise<void>((resolve) =>
    occupied.listen(0, "127.0.0.1", resolve),
  );
  cleanup.push(
    () => new Promise<void>((resolve) => occupied.close(() => resolve())),
  );
  const port = (occupied.address() as AddressInfo).port;
  await sessions.setPort(port);
  const mcp = await startMcp(store, sessions, { enqueue: async () => {} });
  cleanup.push(() => mcp.close());
  expect(new URL(mcp.url).port).not.toBe(String(port));
  expect(sessions.port).toBe(Number(new URL(mcp.url).port));
  expect(
    JSON.parse(await readFile(path.join(directory, "mcp.json"), "utf8")).port,
  ).toBe(sessions.port);
});

test("corrupt or symlinked registration files are not overwritten", async () => {
  const { store, directory } = await setup();
  const file = path.join(directory, "mcp.json");
  await writeFile(file, "broken");
  await expect(Sessions.open(store)).rejects.toThrow();
  expect(await readFile(file, "utf8")).toBe("broken");
  await rm(file);
  const target = path.join(directory, "target.json");
  await writeFile(target, '{"version":1,"port":12345,"bindings":{}}');
  await symlink(target, file);
  await expect(Sessions.open(store)).rejects.toThrow(/regular file/);
});

test("failed authorization persistence disables access instead of serving uncertain state", async () => {
  const { directory, store, sessions } = await setup();
  const mcp = await startMcp(store, sessions, { enqueue: async () => {} });
  cleanup.push(() => mcp.close());
  const { token } = (await sessions.connect("a", "workspace", null))!;
  const file = path.join(directory, "mcp.json");
  await rename(file, `${file}.saved`);
  await mkdir(file); // Force atomic replacement to fail, independent of OS permissions.
  await expect(sessions.revoke("a")).rejects.toThrow();
  expect(() => sessions.resolve(token)).toThrow(/unavailable/);
  expect(
    (
      await fetch(mcp.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
    ).status,
  ).toBe(503);
});
