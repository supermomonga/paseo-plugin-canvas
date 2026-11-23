import { expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { createPaseoClient, type PaseoClient } from "@getpaseo/client";
import {
  createPaseoDaemon,
  type PaseoDaemon,
} from "../node_modules/@getpaseo/server/dist/server/server/bootstrap.js";
import type {
  AgentClient,
  AgentSession,
  AgentStreamEvent,
} from "../node_modules/@getpaseo/server/dist/server/server/agent/agent-sdk-types.js";
import { CanvasStore } from "../server/store";
import { dispatchReview, recipients } from "../server/review-dispatch";

// Only the provider is a fixture. Directory paging, persistence, lazy resume,
// SDK transport and message dispatch use the installed, unmodified Paseo host.
function providerFixture() {
  const calls = { created: 0, resumed: 0, prompts: [] as string[] };
  const capabilities = {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: false,
    supportsMcpServers: true,
    supportsReasoningStream: false,
    supportsToolInvocations: false,
  };
  function session(id: string): AgentSession {
    const subscribers = new Set<(event: AgentStreamEvent) => void>();
    return {
      id,
      provider: "codex",
      capabilities,
      async run() {
        return { sessionId: id, finalText: "", timeline: [] };
      },
      async startTurn(prompt) {
        calls.prompts.push(
          typeof prompt === "string" ? prompt : JSON.stringify(prompt),
        );
        const turnId = randomUUID();
        setImmediate(() => {
          for (const type of ["turn_started", "turn_completed"] as const)
            for (const listener of subscribers)
              listener({ type, provider: "codex", turnId });
        });
        return { turnId };
      },
      subscribe(listener) {
        subscribers.add(listener);
        return () => {
          subscribers.delete(listener);
        };
      },
      async *streamHistory() {},
      async getRuntimeInfo() {
        return { provider: "codex", sessionId: id, model: "fixture" };
      },
      async getAvailableModes() {
        return [];
      },
      async getCurrentMode() {
        return null;
      },
      async setMode() {},
      getPendingPermissions() {
        return [];
      },
      async respondToPermission() {},
      describePersistence() {
        return { provider: "codex", sessionId: id };
      },
      async interrupt() {},
      async close() {
        subscribers.clear();
      },
    };
  }
  const client: AgentClient = {
    provider: "codex",
    capabilities,
    async createSession() {
      calls.created++;
      return session(randomUUID());
    },
    async resumeSession(handle) {
      calls.resumed++;
      return session(handle.sessionId);
    },
    async fetchCatalog() {
      return {
        models: [
          {
            provider: "codex",
            id: "fixture",
            label: "Fixture",
            isDefault: true,
          },
        ],
        modes: [],
      };
    },
    async isAvailable() {
      return true;
    },
  };
  return { calls, client };
}

test("public SDK lists stored recipients after host restart and sends to them", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "canvas-dispatch-host-"));
  const paseoHome = path.join(root, "paseo");
  const workspaceDirectory = path.join(root, "workspace");
  await mkdir(paseoHome);
  await mkdir(workspaceDirectory);
  const logger = pino({ level: "silent" });
  const fixture = providerFixture();
  let daemon: PaseoDaemon | undefined;
  let client: PaseoClient | undefined;
  let store: CanvasStore | undefined;

  async function start() {
    daemon = await createPaseoDaemon(
      {
        listen: "127.0.0.1:0",
        paseoHome,
        corsAllowedOrigins: [],
        hostnames: true,
        staticDir: root,
        mcpEnabled: false,
        mcpDebug: false,
        relayEnabled: false,
        voiceLlmProvider: null,
        voiceLlmProviderExplicit: false,
        agentClients: { codex: fixture.client },
        agentStoragePath: path.join(paseoHome, "agents"),
      },
      logger,
    );
    await daemon.start();
    const listen = daemon.getListenTarget();
    if (listen?.type !== "tcp") throw new Error("Test host did not bind TCP");
    client = createPaseoClient({
      url: `ws://127.0.0.1:${listen.port}/ws`,
      logger,
    });
    await client.connect();
    return { host: daemon, api: client };
  }
  try {
    const first = await start();
    const workspace = await first.api.workspaces.open({
      cwd: workspaceDirectory,
    });
    const agent = await workspace.agents.create({
      config: { provider: "codex/fixture" },
    });
    store = await CanvasStore.open(path.join(root, "canvas"));
    await first.host.agentManager.flush();
    await first.host.agentStorage.flush();
    expect(await first.host.agentStorage.get(agent.id)).not.toBeNull();
    await first.api.close();
    client = undefined;
    await first.host.stop();
    daemon = undefined;
    await store.close();

    const second = await start();
    store = await CanvasStore.open(path.join(root, "canvas"));
    expect(second.host.agentManager.getAgent(agent.id)).toBeNull();
    const resumedBefore = fixture.calls.resumed;
    const createdBefore = fixture.calls.created;
    for (let attempt = 0; attempt < 2; attempt++) {
      const options = await recipients(second.api, workspace.id);
      expect(options.map((option) => option.id)).toEqual([agent.id]);
      expect(options[0]).toMatchObject({ running: false, blocked: false });
    }
    expect(fixture.calls.resumed).toBe(resumedBefore);
    expect(fixture.calls.created).toBe(createdBefore);
    expect(fixture.calls.prompts).toEqual([]);
    expect(second.host.agentManager.getAgent(agent.id)).toBeNull();

    const actor = {
      agentId: agent.id,
      workspaceId: workspace.id,
      sessionId: "fixture",
      title: "Fixture",
    };
    const canvas = await store.create(actor, "Restart", "Hello");
    const review = await store.reviews.mutate(workspace.id, canvas.canvasId, {
      action: "create",
      body: "Check after restart",
      selection: {
        documentRevision: 1,
        ranges: [{ start: 0, end: 5, kind: "block", selectedText: "Hello" }],
      },
    });
    const thread = Object.values(review.state.threads)[0];
    const delivery = await dispatchReview(store.reviews, second.api, {
      workspaceId: workspace.id,
      canvasId: canvas.canvasId,
      agentId: agent.id,
      threads: [{ threadId: thread.id, expectedRevision: thread.revision }],
      allowInterrupt: false,
    });
    expect(delivery.attempts[0].status).toBe("accepted");
    await expect.poll(() => fixture.calls.prompts.length).toBe(1);
    expect(fixture.calls.prompts[0]).toContain("Check after restart");
    expect(fixture.calls.resumed).toBe(resumedBefore + 1);
  } finally {
    await client?.close();
    await daemon?.stop();
    await store?.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
