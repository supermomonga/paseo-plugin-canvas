import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import type { PluginSubscriptionState } from "@getpaseo/plugin/client";

// Stands in for the host's subscription: one listener per mounted input.
const subscription = vi.hoisted(() => ({
  inputs: [] as { workspaceId: string }[],
  listener: undefined as ((event: { cursor: string }) => void) | undefined,
  state: { status: "live" } as { status: string; error?: Error },
}));
vi.mock("@getpaseo/plugin/client", async () => ({
  useSubscription: (
    _contract: unknown,
    input: { workspaceId: string },
    onEvent: (event: { cursor: string }) => void,
  ) => {
    subscription.inputs.push(input);
    subscription.listener = onEvent;
    return subscription.state as PluginSubscriptionState;
  },
}));
import { useCanvasUpdates } from "../client/updates";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.useRealTimers();
  subscription.inputs = [];
  subscription.listener = undefined;
  subscription.state = { status: "live" };
});
async function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  cleanups.push(() => client.clear());
  const list = vi.fn(async () => ({ items: [{ canvasId: "a" }] }));
  const detail = vi.fn(async () => ({ revision: 1 }));
  const other = vi.fn(async () => ({ items: [] }));
  for (const [name, input, queryFn] of [
    ["canvas.list", { workspaceId: "w" }, list],
    ["canvas.get", { workspaceId: "w", canvasId: "a" }, detail],
    ["canvas.list", { workspaceId: "other" }, other],
  ] as const) {
    const observer = new QueryObserver(client, {
      queryKey: [name, input],
      queryFn: queryFn as () => Promise<unknown>,
    });
    cleanups.push(observer.subscribe(() => {}));
    await observer.refetch();
  }
  list.mockClear();
  detail.mockClear();
  other.mockClear();
  let error: Error | null = null;
  function Follow({ workspaceId }: { workspaceId: string }) {
    error = useCanvasUpdates(workspaceId);
    return null;
  }
  let tree!: ReactTestRenderer;
  const render = (workspaceId: string) => (
    <QueryClientProvider client={client}>
      <Follow workspaceId={workspaceId} />
    </QueryClientProvider>
  );
  await act(async () => {
    tree = create(render("w"));
  });
  cleanups.push(async () => {
    await act(async () => tree.unmount());
  });
  const send = (cursor: string) =>
    act(async () => {
      subscription.listener!({ cursor });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  return { client, list, detail, other, tree, render, send, error: () => error };
}

test("a new cursor refreshes the list and active detail; a repeated cursor and other workspaces do not", async () => {
  const s = await setup();
  expect(subscription.inputs.at(-1)).toEqual({ workspaceId: "w" });
  // The first event after (re)subscribing carries the current cursor; it is
  // read once, which also covers changes missed while disconnected.
  await s.send("epoch:0");
  expect(s.list).toHaveBeenCalledTimes(1);
  expect(s.detail).toHaveBeenCalledTimes(1);
  expect(s.other).not.toHaveBeenCalled();
  await s.send("epoch:0");
  expect(s.list).toHaveBeenCalledTimes(1);
  await s.send("epoch:1");
  expect(s.list).toHaveBeenCalledTimes(2);
  expect(s.detail).toHaveBeenCalledTimes(2);
  // A deleted canvas is not fetched again.
  s.list.mockResolvedValue({ items: [] });
  await s.send("epoch:2");
  expect(s.detail).toHaveBeenCalledTimes(2);
});

test("a failed read is retried without waiting for another change", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const s = await setup();
  s.list.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    subscription.listener!({ cursor: "epoch:0" });
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(s.error()?.message).toBe("offline");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(s.list).toHaveBeenCalledTimes(2);
  expect(s.detail).toHaveBeenCalledTimes(1);
  expect(s.error()).toBeNull();
});

test("a failed subscription is reported; switching workspaces follows the new one", async () => {
  const s = await setup();
  subscription.state = { status: "error", error: new Error("Plugin stopped") };
  await act(async () => s.tree.update(s.render("w")));
  expect(s.error()?.message).toBe("Plugin stopped");
  subscription.state = { status: "live" };
  await act(async () => s.tree.update(s.render("other")));
  expect(subscription.inputs.at(-1)).toEqual({ workspaceId: "other" });
  await s.send("other:1");
  expect(s.other).toHaveBeenCalledTimes(1);
  expect(s.list).not.toHaveBeenCalled();
});

test("a new cursor during the retry delay reads again at once", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const s = await setup();
  s.list.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    subscription.listener!({ cursor: "epoch:0" });
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(s.error()?.message).toBe("offline");
  // Paseo resubscribed after a reconnect and sent the current cursor.
  await act(async () => {
    subscription.listener!({ cursor: "epoch:1" });
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(s.list).toHaveBeenCalledTimes(2);
  expect(s.error()).toBeNull();
});
