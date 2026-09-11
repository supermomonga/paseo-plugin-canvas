import { expect, test, vi } from "vitest";
import type { PluginClientContext, PluginHeaderButtonContribution } from "@getpaseo/plugin/client";
import type { PaseoWorkspaceUpdate } from "@getpaseo/client";
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
import { Platform } from "react-native";
import { registerNativeCanvasHeaders } from "../client/header";

function setup() {
  let update: (value: PaseoWorkspaceUpdate) => void = () => {};
  const unsubscribe = vi.fn();
  const buttons: { contribution: PluginHeaderButtonContribution; remove: ReturnType<typeof vi.fn> }[] = [];
  const list = vi.fn();
  const openPanel = vi.fn();
  const client = {
    paseo: { workspaces: {
      list,
      subscribe: vi.fn((handler) => { update = handler; return unsubscribe; }),
    } },
    openPanel,
    addHeaderButton: vi.fn((contribution: PluginHeaderButtonContribution) => {
      const remove = vi.fn(); buttons.push({ contribution, remove });
      return { remove, update: vi.fn() };
    }),
  };
  return {
    client: client as unknown as PluginClientContext, list, buttons, unsubscribe, openPanel,
    emit: (value: unknown) => update(value as PaseoWorkspaceUpdate),
  };
}
const page = (ids: string[], nextCursor?: string) => ({
  entries: ids.map((id) => ({ id })),
  pageInfo: { hasMore: Boolean(nextCursor), nextCursor },
});

test("native buttons follow all workspace pages and updates, and open the matching panel", async () => {
  const fixture = setup();
  fixture.list.mockResolvedValueOnce(page(["first"], "page-2")).mockResolvedValueOnce(page(["second"]));
  const stop = registerNativeCanvasHeaders(fixture.client);
  await vi.waitFor(() => expect(fixture.buttons).toHaveLength(2));
  expect(fixture.list).toHaveBeenLastCalledWith({ page: { limit: 200, cursor: "page-2" } });
  const button = fixture.buttons[1].contribution;
  expect(button).toMatchObject({ workspaceId: "second", button: { title: "Open Canvas", icon: "NotebookPen" } });
  if (button.button.behavior.kind !== "action") throw new Error("Expected action");
  button.button.behavior.onPress();
  expect(fixture.openPanel).toHaveBeenCalledWith("canvas", { workspaceId: "second" });
  fixture.emit({ kind: "upsert", workspace: { id: "second" } });
  expect(fixture.buttons).toHaveLength(2);
  fixture.emit({ kind: "upsert", workspace: { id: "new" } });
  expect(fixture.buttons).toHaveLength(3);
  fixture.emit({ kind: "remove", id: "first" });
  expect(fixture.buttons[0].remove).toHaveBeenCalledOnce();
  stop();
  expect(fixture.unsubscribe).toHaveBeenCalledOnce();
  for (const button of fixture.buttons) expect(button.remove).toHaveBeenCalledOnce();
});

test("late snapshots neither restore removed workspaces nor register buttons after cleanup", async () => {
  const fixture = setup();
  let resolve!: (value: ReturnType<typeof page>) => void;
  fixture.list.mockImplementation(() => new Promise((done) => { resolve = done; }));
  const stop = registerNativeCanvasHeaders(fixture.client);
  fixture.emit({ kind: "remove", id: "removed" });
  resolve(page(["removed", "live"]));
  await vi.waitFor(() => expect(fixture.buttons).toHaveLength(1));
  expect(fixture.buttons[0].contribution.workspaceId).toBe("live");
  stop();
  const stopAgain = registerNativeCanvasHeaders(fixture.client);
  stopAgain();
  resolve(page(["late"]));
  await Promise.resolve();
  expect(fixture.buttons).toHaveLength(1);
});

test("Web and Electron keep their existing entry points without extra header buttons", () => {
  const fixture = setup();
  const original = Platform.OS;
  Platform.OS = "web";
  try {
    registerNativeCanvasHeaders(fixture.client)();
    expect(fixture.client.paseo.workspaces.subscribe).not.toHaveBeenCalled();
    expect(fixture.list).not.toHaveBeenCalled();
  } finally { Platform.OS = original; }
});
