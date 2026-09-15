import type { Canvas } from "../shared/contracts";

type Result<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };
type LeaseInput = { workspaceId: string; canvasId: string; lockToken: string };
export type EditingApi = {
  begin: (input: {
    workspaceId: string;
    canvasId: string;
  }) => Promise<Result<{ canvas: Canvas; lockToken: string }>>;
  create: (input: {
    workspaceId: string;
    title: string;
    content: string;
  }) => Promise<Result<{ canvasId: string; revision: number }>>;
  save: (
    input: LeaseInput & {
      title: string;
      content: string;
      expectedRevision: number;
    },
  ) => Promise<Result<{ canvasId: string; revision: number }>>;
  renew: (
    input: LeaseInput,
  ) => Promise<Result<{ editState: Canvas["editState"] }>>;
  cancel: (input: LeaseInput) => Promise<Result<unknown>>;
  delete: (input: {
    workspaceId: string;
    canvasId: string;
    expectedRevision: number;
  }) => Promise<Result<unknown>>;
  refresh: () => Promise<unknown>;
  select: (canvasId: string | null) => void;
};
export type CanvasDraft = {
  original: Canvas | null;
  title: string;
  content: string;
  lockToken: string | null;
  expiresAt: string | null;
  lost: boolean;
  uncertain: boolean;
};
export type EditorState = {
  draft: CanvasDraft | null;
  busy: boolean;
  error: string | null;
  confirmation: "discard" | "delete" | null;
};
export const draftChanged = (draft: CanvasDraft) =>
  draft.original
    ? draft.title.trim() !== draft.original.title ||
      draft.content !== draft.original.content
    : !!(draft.title || draft.content);
function unwrap<T>(result: Result<T>): T {
  if (!result.ok)
    throw Object.assign(new Error(result.message), { code: result.code });
  return result.value;
}
const errorCode = (error: unknown) => (error as { code?: string })?.code;
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// A workspace owns its edit state, independently of list/detail topology.
// Factory functions also work in the host's Hermes source-evaluation runtime.
export function createCanvasEditor(workspaceId: string, api: EditingApi) {
  let state: EditorState = {
    draft: null,
    busy: false,
    error: null,
    confirmation: null,
  };
  let disposed = false;
  let navigation: (() => void) | null = null;
  let deletion: Canvas | null = null;
  const listeners = new Set<() => void>();
  const emit = (patch: Partial<EditorState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const lease = (d: CanvasDraft): LeaseInput => ({
    workspaceId,
    canvasId: d.original!.canvasId,
    lockToken: d.lockToken!,
  });
  async function refresh() {
    try {
      await api.refresh();
    } catch {
      emit({
        error:
          "Unable to refresh canvases. Your last operation will not be repeated automatically.",
      });
    }
  }
  async function release(d: CanvasDraft) {
    if (!d.original || !d.lockToken) return;
    const result = await api.cancel(lease(d));
    if (!result.ok && result.code !== "CONFLICT" && result.code !== "NOT_FOUND")
      unwrap(result);
  }
  async function finishNavigation() {
    if (state.busy) return;
    const action = navigation;
    const d = state.draft;
    emit({ busy: true, error: null });
    try {
      if (d) await release(d);
      navigation = null;
      emit({ draft: null, confirmation: null, busy: false });
      action?.();
      await refresh();
    } catch (error) {
      emit({ busy: false, error: message(error) });
    }
  }
  function navigate(action: () => void) {
    if (state.busy) return;
    navigation = action;
    if (state.draft && (draftChanged(state.draft) || state.draft.uncertain))
      emit({ confirmation: "discard" });
    else if (state.draft) void finishNavigation();
    else {
      navigation = null;
      action();
    }
  }
  async function begin(canvasId: string, retain = false) {
    if (state.busy) return;
    const old = state.draft;
    emit({ busy: true, error: null });
    try {
      if (retain && old) await release(old);
      const acquired = unwrap(await api.begin({ workspaceId, canvasId }));
      const d: CanvasDraft = {
        original: acquired.canvas,
        title: acquired.canvas.title,
        content: acquired.canvas.content,
        lockToken: acquired.lockToken,
        expiresAt:
          acquired.canvas.editState.status === "locked"
            ? acquired.canvas.editState.lock.expiresAt
            : null,
        lost: false,
        uncertain: false,
      };
      if (disposed) {
        await release(d);
        return;
      }
      if (
        retain &&
        old?.original &&
        old.original.revision !== acquired.canvas.revision
      ) {
        await release(d);
        emit({
          error:
            "This canvas changed while your lock was unavailable. Copy your draft, then cancel to read the latest version. Your draft has not been saved.",
        });
        return;
      }
      emit({
        draft:
          retain && old ? { ...d, title: old.title, content: old.content } : d,
      });
    } catch (error) {
      emit({ error: message(error) });
    } finally {
      emit({ busy: false });
    }
    await refresh();
  }
  async function renew() {
    const d = state.draft;
    if (
      !d?.original ||
      !d.lockToken ||
      d.lost ||
      d.uncertain ||
      state.busy ||
      disposed
    )
      return;
    emit({ busy: true });
    try {
      const result = unwrap(await api.renew(lease(d)));
      if (state.draft && result.editState.status === "locked")
        emit({
          draft: { ...state.draft, expiresAt: result.editState.lock.expiresAt },
          error: null,
        });
    } catch (error) {
      if (state.draft)
        emit({
          draft: { ...state.draft, lost: true },
          error: `Editing paused: ${message(error)}. Your draft is retained.`,
        });
    } finally {
      emit({ busy: false });
    }
  }
  return {
    activate() {
      disposed = false;
      if (state.draft?.original)
        emit({ draft: { ...state.draft, lost: true } });
    },
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    navigate,
    newCanvas() {
      navigate(() =>
        emit({
          draft: {
            original: null,
            title: "",
            content: "",
            lockToken: null,
            expiresAt: null,
            lost: false,
            uncertain: false,
          },
          error: null,
        }),
      );
    },
    begin: (canvasId: string) => begin(canvasId),
    reacquire: () =>
      state.draft?.original && !state.draft.uncertain
        ? begin(state.draft.original.canvasId, true)
        : Promise.resolve(),
    change(patch: Partial<Pick<CanvasDraft, "title" | "content">>) {
      if (state.draft) emit({ draft: { ...state.draft, ...patch } });
    },
    cancel() {
      navigate(() => {});
    },
    dismissConfirmation() {
      navigation = null;
      deletion = null;
      emit({ confirmation: null });
    },
    requestDelete(canvas: Canvas) {
      if (!state.busy) {
        deletion = canvas;
        emit({ confirmation: "delete", error: null });
      }
    },
    deletionTitle: () => deletion?.title ?? "",
    confirmDiscard: finishNavigation,
    async confirmDelete() {
      if (!deletion || state.busy) return;
      const target = deletion;
      emit({ busy: true, error: null });
      try {
        unwrap(
          await api.delete({
            workspaceId,
            canvasId: target.canvasId,
            expectedRevision: target.revision,
          }),
        );
        emit({ confirmation: null });
        deletion = null;
        api.select(null);
      } catch (error) {
        emit({ confirmation: null, error: message(error) });
        deletion = null;
      } finally {
        emit({ busy: false });
      }
      await refresh();
    },
    async save() {
      const d = state.draft;
      if (
        !d ||
        state.busy ||
        d.lost ||
        d.uncertain ||
        !draftChanged(d) ||
        !d.title.trim() ||
        d.title.trim().length > 240 ||
        d.content.length > 1_000_000 ||
        (!d.original && !d.content.trim())
      )
        return;
      // The daemon owns the lease clock; a remote client clock may differ.
      emit({ busy: true, error: null });
      try {
        const fields = { workspaceId, title: d.title, content: d.content };
        const saved = unwrap(
          await (d.original
            ? api.save({
                ...fields,
                ...lease(d),
                expectedRevision: d.original.revision,
              })
            : api.create(fields)),
        );
        emit({ draft: null, busy: false });
        if (!disposed) api.select(saved.canvasId);
      } catch (error) {
        const code = errorCode(error);
        const uncertain =
          !code || code === "UNKNOWN" || code === "STORE_UNAVAILABLE";
        if (state.draft)
          emit({
            draft: {
              ...state.draft,
              lost: code === "CONFLICT" || state.draft.lost,
              uncertain,
            },
            error: uncertain
              ? "Save could not be confirmed. Check the latest canvases before creating or saving again. Copy your draft before cancelling."
              : message(error),
          });
      } finally {
        emit({ busy: false });
      }
      await refresh();
    },
    renew,
    refresh,
    dispose() {
      disposed = true;
      listeners.clear();
      const d = state.draft;
      if (d)
        void release(d).catch(() =>
          console.warn(
            "[paseo-canvas] Edit lock release failed; the lease will expire.",
          ),
        );
    },
  };
}
export type CanvasEditor = ReturnType<typeof createCanvasEditor>;
