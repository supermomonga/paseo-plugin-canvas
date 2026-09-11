import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
const runtime = vi.hoisted(() => ({
  wait: vi.fn(),
  state: "active",
  onState: undefined as ((state: string) => void) | undefined,
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return runtime.state;
    },
    addEventListener: (_: string, listener: (state: string) => void) => {
      runtime.onState = listener;
      return {
        remove: () => {
          runtime.onState = undefined;
        },
      };
    },
  },
}));
vi.mock("paseo-plugin-helper/client", () => ({
  getClientHost: () => ({ useRpc: () => runtime.wait }),
}));
import { useCanvasUpdates } from "../client/updates";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.useRealTimers();
  runtime.wait.mockReset();
  runtime.state = "active";
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
  const pending: ReturnType<typeof deferred<{ cursor: string }>>[] = [];
  runtime.wait.mockImplementation(() => {
    const next = deferred<{ cursor: string }>();
    pending.push(next);
    return next.promise;
  });
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
  return {
    client,
    list,
    detail,
    other,
    pending,
    tree,
    render,
    error: () => error,
  };
}

test("changes refresh list and active detail, but idle waits and other workspaces do not", async () => {
  const s = await setup();
  await act(async () => s.pending[0].resolve({ cursor: "epoch:0" }));
  expect(s.list).toHaveBeenCalledTimes(1);
  expect(s.detail).toHaveBeenCalledTimes(1);
  expect(s.other).not.toHaveBeenCalled();
  expect(runtime.wait).toHaveBeenLastCalledWith({
    workspaceId: "w",
    cursor: "epoch:0",
  });
  await act(async () => s.pending[1].resolve({ cursor: "epoch:0" }));
  expect(s.list).toHaveBeenCalledTimes(1);
  await act(async () => s.pending[2].resolve({ cursor: "epoch:1" }));
  expect(s.list).toHaveBeenCalledTimes(2);
  expect(s.detail).toHaveBeenCalledTimes(2);
  s.list.mockResolvedValue({ items: [] });
  await act(async () => s.pending[3].resolve({ cursor: "epoch:2" }));
  expect(s.detail).toHaveBeenCalledTimes(2);
});

test("failed reads and disconnected waits retry automatically without waiting for another change", async () => {
  vi.useFakeTimers();
  const s = await setup();
  s.list.mockRejectedValueOnce(new Error("offline"));
  await act(async () => s.pending[0].resolve({ cursor: "epoch:0" }));
  expect(s.error()?.message).toBe("offline");
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(runtime.wait).toHaveBeenLastCalledWith({
    workspaceId: "w",
    cursor: null,
  });
  await act(async () => s.pending[1].resolve({ cursor: "epoch:0" }));
  expect(s.error()).toBeNull();
  expect(s.detail).toHaveBeenCalledTimes(1);
  await act(async () => s.pending[2].reject(new Error("disconnected")));
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  await act(async () => s.pending[3].resolve({ cursor: "new-epoch:0" }));
  expect(s.detail).toHaveBeenCalledTimes(2);
  expect(s.error()).toBeNull();
});

test("leaving a workspace or backgrounding ignores late replies; resuming starts with a fresh cursor", async () => {
  const s = await setup();
  await act(async () => s.tree.update(s.render("other")));
  await act(async () => s.pending[0].resolve({ cursor: "old:1" }));
  expect(s.list).not.toHaveBeenCalled();
  await act(async () => runtime.onState!("background"));
  await act(async () => s.pending[1].resolve({ cursor: "other:1" }));
  expect(s.other).not.toHaveBeenCalled();
  await act(async () => runtime.onState!("active"));
  expect(runtime.wait).toHaveBeenLastCalledWith({
    workspaceId: "other",
    cursor: null,
  });
  await act(async () => s.pending[2].resolve({ cursor: "other:2" }));
  expect(s.other).toHaveBeenCalledTimes(1);
});
