import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PluginAttachmentSearchPayloadSchema } from "@getpaseo/plugin";
import { CanvasStore } from "../server/store";
import { CanvasError } from "../server/errors";
import { searchAttachments } from "../server/attachments";
import {
  CANVAS_ATTACHMENT_LIMIT,
  canvasResourceUrl,
} from "../shared/attachments";
import type { Actor } from "../shared/contracts";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const actor = (workspaceId: string): Actor => ({
  agentId: "agent-a",
  workspaceId,
  title: "Plan",
  sessionId: "session-a",
});
const paseo = (workspaces: { id: string; name: string; title?: string }[]) =>
  ({
    workspaces: {
      list: vi.fn(async () => ({
        entries: workspaces,
        pageInfo: { hasMore: false, nextCursor: null },
      })),
    },
  }) as never;
async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "canvas-attachments-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  let now = Date.parse("2026-11-01T00:00:00Z");
  const store = await CanvasStore.open(dir, { clock: () => (now += 1000) });
  cleanup.push(() => store.close());
  return store;
}

test("search ranks title prefixes first and returns complete snapshots Paseo accepts", async () => {
  const store = await setup();
  const plan = await store.create(
    actor("workspace-a"),
    "Plan review",
    "# Plan\n\n- [ ] Ship",
  );
  await store.create(actor("workspace-b"), "Release plan", "# Release");
  await store.create(actor("workspace-a"), "Notes", "# Notes");
  await store.create(actor("archived"), "Plan in archive", "# Hidden");
  const api = paseo([
    { id: "workspace-a", name: "repo", title: "Feature A" },
    { id: "workspace-b", name: "repo-b" },
  ]);
  const result = await searchAttachments(store, api, "  PLAN ");
  expect(PluginAttachmentSearchPayloadSchema.parse(result)).toEqual(result);
  // A title prefix ranks above a newer later-word match; the archived
  // workspace is absent.
  expect(result.items.map((item) => item.title)).toEqual([
    "Plan review",
    "Release plan",
  ]);
  const [first] = result.items;
  expect(first).toMatchObject({
    id: `workspace-a/${plan.canvasId}`,
    identifier: "Feature A",
    resourceType: "canvas",
    url: canvasResourceUrl("workspace-a", plan.canvasId),
    subtitle: "2026-11-01",
  });
  expect(new URL(first.url).protocol).toBe("paseo-canvas:");
  expect(first.text).toContain('Canvas "Plan review"');
  expect(first.text).toContain("revision 1");
  expect(first.text.endsWith("# Plan\n\n- [ ] Ship")).toBe(true);
  // Several words must all match, in the title or the workspace name.
  expect(
    (await searchAttachments(store, api, "feature notes")).items.map(
      (item) => item.title,
    ),
  ).toEqual(["Notes"]);
  expect((await searchAttachments(store, api, "missing")).items).toEqual([]);
});

test("an empty query lists recent canvases up to the limit", async () => {
  const store = await setup();
  for (let index = 0; index < CANVAS_ATTACHMENT_LIMIT + 3; index++)
    await store.create(actor("workspace-a"), `Canvas ${index}`, "# Body");
  const result = await searchAttachments(
    store,
    paseo([{ id: "workspace-a", name: "repo" }]),
    "",
  );
  expect(result.items).toHaveLength(CANVAS_ATTACHMENT_LIMIT);
  expect(result.items[0].title).toBe(`Canvas ${CANVAS_ATTACHMENT_LIMIT + 2}`);
});

test("a canvas deleted after listing is skipped; a stopped store fails the search", async () => {
  const items = [
    { workspaceId: "w", canvasId: "gone", title: "Gone", updatedAt: "2026-11-02T00:00:00Z" },
    { workspaceId: "w", canvasId: "kept", title: "Kept", updatedAt: "2026-11-01T00:00:00Z" },
  ];
  const store = {
    list: vi.fn(async () => ({ items, observedAt: "" })),
    get: vi.fn(async (_workspaceId: string, canvasId: string) => {
      if (canvasId === "gone")
        throw new CanvasError("NOT_FOUND", "Canvas does not exist");
      return {
        canvas: {
          ...items[1],
          revision: 3,
          content: "# Kept",
        },
      };
    }),
  };
  const api = paseo([{ id: "w", name: "repo" }]);
  const result = await searchAttachments(store as never, api, "");
  expect(result.items.map((item) => item.title)).toEqual(["Kept"]);
  store.get.mockRejectedValue(
    new CanvasError("STORE_UNAVAILABLE", "Canvas store is closed"),
  );
  await expect(searchAttachments(store as never, api, "")).rejects.toThrow(
    "Canvas store is closed",
  );
});
