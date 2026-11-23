import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";

// Controls when Canvas storage becomes available to the server entry.
const storage = vi.hoisted(() => ({
  directory: Promise.resolve("") as Promise<string>,
}));
vi.mock("../server/paths", () => ({
  storageDirectory: () => storage.directory,
}));
import contribute from "../index.server";

type Hook = (event: unknown, context: unknown) => Promise<unknown>;
const cleanup: (() => Promise<unknown> | unknown)[] = [];
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function load() {
  const hooks = new Map<string, Hook>();
  const context = {
    addHook: (name: string, handler: Hook) => {
      hooks.set(name, handler);
      return () => {};
    },
    handle: () => {},
    registerSettings: (definition: { schema: { parse(v: unknown): unknown } }) => ({
      read: async () => ({
        status: "ready",
        revision: "0",
        values: definition.schema.parse({}),
      }),
      subscribe: () => () => {},
    }),
  } as unknown as PluginServerContext;
  const stop = contribute(context) as () => Promise<void>;
  cleanup.push(stop);
  const open = (request: Record<string, unknown>, hookContext: object = {}) =>
    hooks.get("agent.open.before")!(
      {
        request: {
          agentId: "agent-a",
          workspaceId: "workspace-a",
          provider: "codex",
          cwd: "/workspace",
          reason: "create",
          purpose: "interactive",
          title: "Plan",
          background: false,
          labels: {},
          metadata: {},
          tools: [],
          env: {},
          mcpServers: {},
          ...request,
        },
      },
      hookContext,
    );
  return { hooks, open };
}

test("interactive openings in a workspace get a launch-only Canvas MCP; history and detached openings do not", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "canvas-entry-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  storage.directory = Promise.resolve(directory);
  const { open } = load();
  const first = (await open({})) as {
    mcpServers: Record<string, { type: string; url: string; headers: Record<string, string> }>;
  };
  const server = first.mcpServers.paseo_canvas;
  expect(server).toMatchObject({ type: "http" });
  expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  expect(server.headers.Authorization).toMatch(/^Bearer [\w-]{20,}$/);
  // Each opening gets its own credential.
  const second = (await open({ reason: "resume" })) as typeof first;
  expect(second.mcpServers.paseo_canvas.headers).not.toEqual(server.headers);
  expect(await open({ purpose: "history" })).toBeUndefined();
  expect(await open({ workspaceId: null })).toBeUndefined();
});

test("an agent opens without Canvas when its storage is slow or unavailable", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const output = vi.fn();
  for (const level of ["log", "info", "warn", "error"] as const)
    vi.spyOn(console, level).mockImplementation(output);
  let fail!: (error: Error) => void;
  storage.directory = new Promise<string>((_resolve, reject) => {
    fail = reject;
  });
  const slow = load();
  const opening = slow.open({});
  await vi.advanceTimersByTimeAsync(20_000);
  expect(await opening).toBeUndefined();
  expect(output.mock.calls.flat().join(" ")).toContain("opens without it");
  // Let the entry's cleanup finish.
  fail(new Error("Storage never became available"));

  vi.useRealTimers();
  output.mockClear();
  storage.directory = Promise.reject(new Error("Disk unavailable"));
  storage.directory.catch(() => {});
  const failed = load();
  expect(await failed.open({})).toBeUndefined();
  expect(output.mock.calls.flat().join(" ")).toContain(
    "Unable to give Canvas to an agent",
  );
});

test("agents that opened while Canvas was starting reopen with it once idle", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  for (const level of ["log", "info", "warn"] as const)
    vi.spyOn(console, level).mockImplementation(() => {});
  const directory = await mkdtemp(path.join(tmpdir(), "canvas-entry-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  let finish!: (directory: string) => void;
  storage.directory = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const agents = new Map<string, { status: string; activeTurn: object | null }>([
    ["idle-agent", { status: "idle", activeTurn: null }],
    ["busy-agent", { status: "running", activeTurn: {} }],
  ]);
  const reloaded: string[] = [];
  const paseo = {
    agents: {
      ref: (agentId: string) => ({
        refresh: async () => {},
        get status() {
          return agents.get(agentId)!.status;
        },
        get activeTurn() {
          return agents.get(agentId)!.activeTurn;
        },
        reload: async () => {
          reloaded.push(agentId);
        },
        timeline: { append: async () => {} },
      }),
    },
  };
  const { open } = load();
  const first = open({ agentId: "idle-agent" }, { paseo });
  const second = open({ agentId: "busy-agent" }, { paseo });
  await vi.advanceTimersByTimeAsync(20_000);
  expect(await first).toBeUndefined();
  expect(await second).toBeUndefined();
  vi.useRealTimers();
  finish(directory);
  // Reopening waits briefly so the missed opening can finish first; a busy
  // agent is never interrupted.
  await vi.waitFor(() => expect(reloaded).toEqual(["idle-agent"]), {
    timeout: 5_000,
  });
});
