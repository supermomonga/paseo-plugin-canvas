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

test("persistent endpoint and scoped registrations survive reload; revoked access remains revoked", async () => {
  const { directory, store, sessions } = await setup();
  const mcp = await startMcp(store, sessions, { enqueue: async () => {} });
  const tokens = await Promise.all(
    ["a", "b", "c"].map(async (id) => {
      const token = sessions.register();
      await sessions.activate(
        id,
        id === "c" ? "other-workspace" : "workspace",
        token,
      );
      return token;
    }),
  );
  const actor = sessions.resolve(tokens[0]);
  await sessions.revoke("b");
  await sessions.title("a", "Agent A");
  await mcp.close();
  await sessions.close();
  const persisted = await readFile(path.join(directory, "mcp.json"), "utf8");
  for (const token of tokens) expect(persisted).not.toContain(token);
  expect((await stat(path.join(directory, "mcp.json"))).mode & 0o777).toBe(
    0o600,
  );
  const restored = await Sessions.open(store);
  cleanup.push(() => restored.close());
  const next = await startMcp(store, restored, { enqueue: async () => {} });
  cleanup.push(() => next.close());
  expect(next.url).toBe(mcp.url);
  expect(restored.resolve(tokens[0])).toEqual({ ...actor, title: "Agent A" });
  expect(() => restored.resolve(tokens[1])).toThrow(/not active/);
  expect(restored.resolve(tokens[2]).workspaceId).toBe("other-workspace");
  await restored.activate("a", "workspace");
  expect(restored.resolve(tokens[0]).sessionId).not.toBe(actor.sessionId);
  await restored.activate("b", "workspace");
  expect(restored.resolve(tokens[1]).agentId).toBe("b");
});

test("unbound credentials, cross-agent rebinding and workspace changes are rejected; old agents remain untouched", async () => {
  const { sessions } = await setup();
  await sessions.setPort(12345);
  const token = sessions.register();
  expect(() => sessions.resolve(token)).toThrow(/not active/);
  await sessions.activate("a", "workspace", token);
  await expect(sessions.activate("b", "workspace", token)).rejects.toThrow(
    /does not belong/,
  );
  await expect(sessions.activate("a", "other-workspace")).rejects.toThrow(
    /does not belong/,
  );
  await expect(sessions.activate("b", "workspace", "forged")).rejects.toThrow(
    /Unknown/,
  );
  await sessions.activate("legacy-agent", "workspace");
  expect(sessions.resolve(token).agentId).toBe("a");
});

test("a saved port conflict fails without silently changing persisted connection settings", async () => {
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
  const before = await readFile(path.join(directory, "mcp.json"), "utf8");
  await expect(
    startMcp(store, sessions, { enqueue: async () => {} }),
  ).rejects.toMatchObject({
    code: "EADDRINUSE",
  });
  expect(await readFile(path.join(directory, "mcp.json"), "utf8")).toBe(before);
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
  const token = sessions.register();
  await sessions.activate("a", "workspace", token);
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
