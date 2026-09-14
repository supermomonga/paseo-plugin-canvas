import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import {
  Platform,
  Pressable,
  Text,
  View,
  type ScrollView as NativeScrollView,
} from "react-native";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { SettingsSelect } from "@getpaseo/plugin/client/ui";
import type { PluginTheme } from "@getpaseo/plugin";
import { Button, useRpcQuery, getClientHost } from "paseo-plugin-helper/client";
import { useQueryClient } from "@tanstack/react-query";
import type { Root, Element } from "hast";
import type { Canvas } from "../shared/contracts";
import {
  getReviews,
  mutateReview,
  getReviewRecipients,
  sendReview,
  retryReview,
  messageLocked,
  unsentMessages,
  type ReviewSelection,
  type ReviewMutation,
  type ReviewResult,
  type ReviewThread,
} from "../shared/review";
import {
  reviewTargets,
  targetLabel,
  targetQuote,
} from "../shared/review-targets";
import { Markdown } from "./markdown";
import { ToolbarButton, metaText, titleText } from "./controls";
import { sourceRange, type ReviewBindings } from "./review-bindings";
import {
  CommentEditor,
  ReviewKeyboard,
  ReviewEntry,
  type EditorDraft,
  emptyEditorDraft,
} from "./review-input";

const statuses = {
  needs_agent_review: "Needs agent review",
  needs_user_review: "Needs your review",
  resolved: "Resolved",
};
export function ReviewDocument({
  canvas,
  document,
  theme,
  mode,
  fontSize,
}: {
  canvas: Canvas;
  document: Root;
  theme: PluginTheme;
  mode: "preview" | "source";
  fontSize: number;
}) {
  const scope = { workspaceId: canvas.workspaceId, canvasId: canvas.canvasId };
  const colors = theme.colors,
    client = useQueryClient(),
    host = getClientHost();
  const mutate = host.useRpc(mutateReview),
    send = host.useRpc(sendReview),
    retry = host.useRpc(retryReview);
  const query = useRpcQuery(getReviews, scope, { retry: false });
  const recipients = useRpcQuery(
    getReviewRecipients,
    { workspaceId: canvas.workspaceId },
    { retry: false },
  );
  const review = query.data;
  const positions =
    review?.documentRevision === canvas.revision ? review.projections : {};
  const [open, setOpen] = useState(false),
    [selecting, setSelecting] = useState(false);
  const [inline, setInline] = useState<
    { kind: "new" } | { kind: "thread"; id: string; rangeIndex: number } | null
  >(null);
  const [draftAt, setDraftAt] = useState<number | null>(null);
  const selectedOrder = useRef<number[]>([]);
  const suspendedNew = useRef<{
    selection: ReviewSelection | null;
    at: number | null;
    order: number[];
  } | null>(null);
  const [threadDrafts, setThreadDrafts] = useState<Record<string, EditorDraft>>(
    {},
  );
  const [selection, setSelection] = useState<ReviewSelection | null>(null),
    [draft, setDraft] = useState("");
  const [reattach, setReattach] = useState<string | null>(null),
    [active, setActive] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]),
    [showResolved, setShowResolved] = useState(false);
  const [recipient, setRecipient] = useState(""),
    [interrupt, setInterrupt] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [navigate, setNavigate] = useState<number | null>(null);
  const [navigationRequest, setNavigationRequest] = useState(0);
  const blocks = useRef(
    new Map<string, { node: View | Text; start: number; end: number }>(),
  );
  const root = useRef<View>(null),
    scroll = useRef<NativeScrollView>(null);
  const scrollY = useRef(0);
  const overviewScroll = useRef<NativeScrollView>(null);
  const overviewY = useRef(0);
  const [reveal, setReveal] = useState(0);
  const pendingTarget = useRef(false);
  const pendingRestore = useRef(false);
  const targets = reviewTargets(document);
  const targetRanges = new Set(
    targets.map((node) => {
      const range = sourceRange(node)!;
      return `${range.start}:${range.end}`;
    }),
  );
  const selectionCurrent = selection?.documentRevision === canvas.revision;
  useEffect(() => {
    if (!recipient && recipients.data?.length === 1)
      setRecipient(recipients.data[0].id);
  }, [recipients.data, recipient]);
  useEffect(() => {
    setNavigate(null);
  }, [mode, canvas.revision]);
  function moveToTarget() {
    if (!pendingTarget.current || navigate === null || !root.current || open)
      return;
    const candidates = [...blocks.current.values()]
      .filter((b) => b.start <= navigate && b.end > navigate)
      .sort((a, b) => a.end - a.start - (b.end - b.start));
    candidates[0]?.node.measureLayout(
      root.current,
      (_x, y) => {
        pendingTarget.current = false;
        scroll.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
      },
      () => {},
    );
  }
  useEffect(() => {
    moveToTarget();
  }, [navigate, navigationRequest, mode, canvas.revision]);
  function selectBlock(node: Element) {
    if (!selecting) return;
    const range = sourceRange(node);
    if (!range || !targetRanges.has(`${range.start}:${range.end}`)) return;
    const ranges = selectionCurrent ? selection!.ranges : [];
    const exists = ranges.some(
      (item) => item.start === range.start && item.end === range.end,
    );
    const next = exists
      ? ranges.filter(
          (item) => item.start !== range.start || item.end !== range.end,
        )
      : [
          ...ranges,
          { ...range, kind: "block" as const, selectedText: targetQuote(node) },
        ];
    selectedOrder.current = (
      selectionCurrent ? selectedOrder.current : []
    ).filter((start) => start !== range.start);
    if (!exists) selectedOrder.current.push(range.start);
    setDraftAt(selectedOrder.current.at(-1) ?? null);
    setSelection(
      next.length
        ? {
            documentRevision: canvas.revision,
            ranges: next.sort((a, b) => a.start - b.start),
          }
        : null,
    );
  }
  function returnToDocument() {
    pendingRestore.current = true;
    setOpen(false);
  }
  function activate(id: string, at?: number, rangeIndex = 0) {
    const ranges = positions[id]?.ranges ?? [];
    if (at !== undefined) {
      const index = ranges.findIndex(
        (range) =>
          range.start !== null &&
          range.end !== null &&
          range.start <= at &&
          range.end > at,
      );
      if (index >= 0) rangeIndex = index;
    }
    setActive(id);
    setSelecting(false);
    setInline({ kind: "thread", id, rangeIndex });
    const projection = ranges[rangeIndex];
    if (projection?.start != null) {
      setOpen(false);
      if (at === undefined) {
        pendingTarget.current = true;
        setNavigate(projection.start);
        setNavigationRequest((value) => value + 1);
      } else setReveal((value) => value + 1);
    } else setOpen(true);
  }
  function resumeDraft() {
    returnToDocument();
    setSelecting(false);
    setInline({ kind: "new" });
    setReveal((value) => value + 1);
  }
  async function operate(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
      void query.refetch();
    }
  }
  async function change(mutation: ReviewMutation) {
    const result = await mutate({ ...scope, mutation });
    client.setQueryData([getReviews.name, scope], result);
    return result;
  }
  function finishSelection(clearDraft: boolean) {
    const suspended = suspendedNew.current;
    setSelection(suspended?.selection ?? null);
    setDraftAt(suspended?.at ?? null);
    selectedOrder.current = suspended?.order ?? [];
    if (clearDraft && !reattach) setDraft("");
    suspendedNew.current = null;
    setReattach(null);
    setSelecting(false);
    setInline(null);
  }
  async function save() {
    if (!selection) return;
    const result = await operate(() =>
      reattach
        ? change({
            action: "reattach",
            threadId: reattach,
            expectedRevision: review!.state.threads[reattach].revision,
            selection,
          })
        : change({ action: "create", selection, body: draft }),
    );
    if (result) {
      finishSelection(true);
    }
  }
  function markedText(
    value: string,
    map: number[] | undefined,
    key: string,
  ): ReactNode {
    if (!map || map.length !== value.length * 2) return value;
    const segments: { start: number; end: number; ids: string[] }[] = [];
    for (let i = 0; i < value.length; i++) {
      const ids = Object.entries(positions)
        .filter(
          ([id, p]) =>
            p.ranges.some(
              (range) =>
                range.start !== null &&
                range.end !== null &&
                map[i * 2] < range.end &&
                map[i * 2 + 1] > range.start,
            ) &&
            (showResolved || review!.state.threads[id].status !== "resolved"),
        )
        .map(([id]) => id);
      const previous = segments.at(-1);
      if (previous && previous.ids.join() === ids.join()) previous.end = i + 1;
      else segments.push({ start: i, end: i + 1, ids });
    }
    return segments.map((s) => (
      <Text
        key={`${key}:${s.start}`}
        onPress={
          !selecting && s.ids.length
            ? () => {
                setChecked(s.ids);
                activate(s.ids[0], map[s.start * 2]);
              }
            : undefined
        }
        style={
          s.ids.length
            ? {
                backgroundColor: colors.surface2,
                textDecorationLine: "underline",
                textDecorationColor: colors.accent,
              }
            : undefined
        }
      >
        {value.slice(s.start, s.end)}
      </Text>
    ));
  }
  function wrap(node: Element, child: ReactNode, key: string) {
    const range = sourceRange(node);
    if (!range) return child;
    const selected =
      selectionCurrent &&
      !!selection?.ranges.some(
        (item) => item.start === range.start && item.end === range.end,
      );
    const ids = Object.entries(positions)
      .filter(
        ([id, p]) =>
          p.ranges.some(
            (part) =>
              part.start !== null &&
              part.end !== null &&
              part.start < range.end &&
              part.end > range.start,
          ) &&
          (showResolved || review!.state.threads[id].status !== "resolved"),
      )
      .map(([id]) => id);
    return (
      <View key={key} style={{ gap: 6 }}>
        <Pressable
          ref={(node) => {
            if (node) blocks.current.set(key, { node, ...range });
            else blocks.current.delete(key);
          }}
          onLayout={moveToTarget}
          testID={`review-target-${range.start}-${range.end}`}
          accessible={selecting}
          focusable={selecting}
          onPress={selecting ? () => selectBlock(node) : undefined}
          {...(Platform.OS === "web" && selecting
            ? {
                onKeyDown: (event: KeyboardEvent) => {
                  // React Native Web handles Enter, but checkbox Space is not a press.
                  if (
                    event.key === " " &&
                    event.target === event.currentTarget
                  ) {
                    event.preventDefault();
                    if (!event.repeat) selectBlock(node);
                  }
                },
              }
            : {})}
          accessibilityRole={selecting ? "checkbox" : undefined}
          accessibilityLabel={
            selecting
              ? `Select ${targetLabel(node)} for comment: ${targetQuote(node).replace(/\s+/g, " ").slice(0, 120)}`
              : undefined
          }
          aria-checked={selecting ? selected : undefined}
          style={{
            borderWidth: 2,
            borderRadius: 6,
            borderColor:
              selected || ids.includes(active ?? "")
                ? colors.accent
                : ids.length || selecting
                  ? colors.border
                  : "transparent",
            backgroundColor: selected ? colors.surface2 : undefined,
            padding: 8,
          }}
        >
          <View
            pointerEvents={selecting ? "none" : "auto"}
            accessibilityElementsHidden={selecting}
            importantForAccessibility={
              selecting ? "no-hide-descendants" : "auto"
            }
          >
            {child}
          </View>
          {selected && (
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                borderRadius: 12,
                padding: 3,
                backgroundColor: colors.accent,
              }}
            >
              <Icon name="Check" size={16} color={colors.accentForeground} />
            </View>
          )}
        </Pressable>
        {!selecting && !!ids.length && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
            {ids.map((id) => (
              <ToolbarButton
                key={id}
                icon="MessageSquare"
                label={`#${numbers.get(id)}`}
                accessibilityLabel={`Open comment ${numbers.get(id)}`}
                onPress={() =>
                  activate(
                    id,
                    positions[id]?.ranges.find(
                      (part) =>
                        part.start !== null &&
                        part.end !== null &&
                        part.start < range.end &&
                        part.end > range.start,
                    )?.start ?? range.start,
                  )
                }
              />
            ))}
          </View>
        )}
        {inlineAt === range.start && renderInline()}
      </View>
    );
  }
  const threads = Object.values(review?.state.threads ?? {}).sort(
    (a, b) =>
      (review?.projections[a.id]?.ranges.find((range) => range.start !== null)
        ?.start ?? Infinity) -
        (review?.projections[b.id]?.ranges.find((range) => range.start !== null)
          ?.start ?? Infinity) || a.createdAt.localeCompare(b.createdAt),
  );
  const numbers = new Map(threads.map((t, i) => [t.id, i + 1]));
  const bindings: ReviewBindings = {
    enabled: selecting,
    navigate,
    navigationRequest,
    text: markedText,
    wrap,
    register: (key, node, range) => {
      if (node && range) blocks.current.set(key, { node, ...range });
      else blocks.current.delete(key);
    },
  };
  function source() {
    const output: ReactNode[] = [];
    let offset = 0;
    function render(start: number, end: number) {
      const value = canvas.content.slice(start, end);
      const map = Array.from({ length: value.length }, (_, i) => [
        start + i,
        start + i + 1,
      ]).flat();
      return (
        <Text
          key={`source:${start}`}
          selectable={!selecting}
          style={{
            fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
            fontSize: 12,
            lineHeight: 22,
            color: colors.foreground,
          }}
        >
          {markedText(value, map, `source:${start}`)}
        </Text>
      );
    }
    for (const node of targets) {
      const range = sourceRange(node)!;
      if (range.start > offset) output.push(render(offset, range.start));
      output.push(
        wrap(
          node,
          render(range.start, range.end),
          `source-block:${range.start}`,
        ),
      );
      offset = range.end;
    }
    if (offset < canvas.content.length)
      output.push(render(offset, canvas.content.length));
    return output;
  }
  const selectedThreads = threads.filter(
    (t) => checked.includes(t.id) && t.status !== "resolved",
  );
  const target = recipients.data?.find((r) => r.id === recipient);
  const inlineOffset =
    inline?.kind === "new"
      ? draftAt
      : inline?.kind === "thread"
        ? positions[inline.id]?.ranges[inline.rangeIndex]?.start
        : null;
  const inlineAt =
    inlineOffset == null
      ? null
      : (targets
          .map((node) => sourceRange(node)!)
          .find(
            (range) => range.start <= inlineOffset && range.end > inlineOffset,
          )?.start ?? null);
  function renderCard(thread: ReviewThread, expanded: boolean) {
    return (
      <ReviewCard
        thread={thread}
        number={numbers.get(thread.id)!}
        assignedName={
          recipients.data?.find((r) => r.id === thread.assignedAgentId)?.title
        }
        review={review!}
        theme={theme}
        active={active === thread.id}
        busy={busy}
        checked={checked.includes(thread.id)}
        toggle={() =>
          setChecked((ids) =>
            ids.includes(thread.id)
              ? ids.filter((id) => id !== thread.id)
              : [...ids, thread.id],
          )
        }
        positionsReady={review?.documentRevision === canvas.revision}
        navigate={(index) => activate(thread.id, undefined, index)}
        reattach={() => {
          if (!reattach)
            suspendedNew.current = {
              selection,
              at: draftAt,
              order: [...selectedOrder.current],
            };
          setReattach(thread.id);
          setSelecting(true);
          setOpen(false);
          setSelection(null);
          setInline(null);
          selectedOrder.current = [];
        }}
        onError={setError}
        change={(m) => operate(() => change(m))}
        expanded={expanded}
        showTargets={open}
        draft={threadDrafts[thread.id] ?? emptyEditorDraft}
        setDraft={(update) =>
          setThreadDrafts((drafts) => ({
            ...drafts,
            [thread.id]: {
              ...(drafts[thread.id] ?? emptyEditorDraft),
              ...update,
            },
          }))
        }
      />
    );
  }
  function renderInline() {
    if (!inline || selecting || open) return null;
    const thread =
      inline.kind === "thread" ? review?.state.threads[inline.id] : null;
    return (
      <ReviewEntry
        theme={theme}
        header={
          <>
            <Icon name="MessageSquare" size={18} color={colors.accent} />
            <Text style={{ ...titleText, flex: 1, color: colors.foreground }}>
              {inline.kind === "new"
                ? reattach
                  ? "Reattach comment"
                  : "New comment"
                : "Comment"}
            </Text>
            <ToolbarButton
              icon="X"
              accessibilityLabel="Close comment"
              onPress={() => setInline(null)}
            />
          </>
        }
      >
        {inline.kind === "new" ? (
          <>
            {selection && (
              <View style={{ gap: 8 }}>
                <ToolbarButton
                  icon="MousePointer2"
                  label="Change selection"
                  onPress={() => {
                    setSelecting(true);
                    setInline(null);
                    setOpen(false);
                  }}
                />
                {selection.documentRevision !== canvas.revision && (
                  <Text style={{ color: colors.statusWarning }}>
                    Canvas changed. Select the target again; your comment is
                    preserved.
                  </Text>
                )}
                <CommentEditor
                  theme={theme}
                  label="Comment"
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Describe the change you want"
                  hideInput={!!reattach}
                  actions={
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <ToolbarButton
                        icon="Check"
                        label={reattach ? "Reattach" : "Save comment"}
                        onPress={() => void save()}
                        disabled={
                          busy ||
                          (!reattach && !draft.trim()) ||
                          selection.documentRevision !== canvas.revision
                        }
                      />
                      <ToolbarButton
                        icon="X"
                        label="Cancel"
                        onPress={() => {
                          finishSelection(true);
                        }}
                      />
                    </View>
                  }
                />
              </View>
            )}
          </>
        ) : thread ? (
          renderCard(thread, true)
        ) : null}
      </ReviewEntry>
    );
  }
  const commentPanel = (
    <View style={{ gap: 16, padding: 16 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Text style={{ ...titleText, color: colors.foreground }}>
          Comments ({threads.length})
        </Text>
        <ToolbarButton
          icon={showResolved ? "EyeOff" : "Eye"}
          label="Resolved"
          onPress={() => setShowResolved(!showResolved)}
        />
      </View>
      {!threads.length && (
        <Text style={{ color: colors.foregroundMuted }}>
          Choose Add comment, then tap or click the elements you want to comment
          on.
        </Text>
      )}
      {threads
        .filter((t) => showResolved || t.status !== "resolved")
        .map((thread) => (
          <View key={thread.id} style={{ gap: 8 }}>
            <ToolbarButton
              icon="MessageSquare"
              label={`Open comment ${numbers.get(thread.id)}`}
              onPress={() =>
                activate(
                  thread.id,
                  undefined,
                  Math.max(
                    0,
                    positions[thread.id]?.ranges.findIndex(
                      (r) => r.start !== null,
                    ) ?? 0,
                  ),
                )
              }
            />
            {renderCard(
              thread,
              inline?.kind === "thread" &&
                inline.id === thread.id &&
                inlineAt === null,
            )}
          </View>
        ))}
      {!!threads.length && (
        <View
          style={{
            gap: 10,
            borderTopWidth: 1,
            borderColor: colors.border,
            paddingTop: 12,
          }}
        >
          <SettingsSelect
            label="Agent session"
            value={recipient}
            options={[
              { label: "Select a session", value: "" },
              ...(recipients.data ?? []).map((r) => ({
                value: r.id,
                label:
                  r.title +
                  (r.blocked
                    ? " · Permission pending"
                    : r.running
                      ? " · Running"
                      : ""),
              })),
            ]}
            onValueChange={(id) => {
              setRecipient(id);
              setInterrupt(false);
            }}
          />
          {recipients.error && (
            <Text style={{ color: colors.statusDanger }}>
              {recipients.error.message}
            </Text>
          )}
          {recipients.data?.length === 0 && (
            <Text style={{ color: colors.foregroundMuted }}>
              No sessions with Canvas MCP are available in this workspace.
            </Text>
          )}
          <ToolbarButton
            icon="RefreshCw"
            label="Refresh sessions"
            onPress={() => void recipients.refetch()}
            disabled={recipients.isFetching}
          />
          {target?.blocked && (
            <Text style={{ color: colors.statusWarning }}>
              Handle the pending permission in Paseo before sending.
            </Text>
          )}
          {target?.running && (
            <>
              <Text style={{ color: colors.statusWarning }}>
                Sending may interrupt this session's current work.
              </Text>
              <ToolbarButton
                icon={interrupt ? "CheckSquare" : "Square"}
                label="Allow interruption"
                onPress={() => setInterrupt(!interrupt)}
              />
            </>
          )}
          <ToolbarButton
            icon="Send"
            label={`Send ${selectedThreads.length} selected`}
            disabled={
              busy ||
              !recipient ||
              !selectedThreads.length ||
              !!target?.blocked ||
              (!!target?.running && !interrupt)
            }
            onPress={() =>
              void operate(async () => {
                const delivery = await send({
                  ...scope,
                  agentId: recipient,
                  threads: selectedThreads.map((t) => ({
                    threadId: t.id,
                    expectedRevision: t.revision,
                  })),
                  allowInterrupt: interrupt,
                });
                if (delivery.attempts.at(-1)?.status === "accepted")
                  setChecked([]);
              })
            }
          />
        </View>
      )}
      {Object.values(review?.state.deliveries ?? {}).map((d) => {
        const last = d.attempts.at(-1)!;
        return (
          <View
            key={d.id}
            style={{
              gap: 6,
              padding: 10,
              backgroundColor: colors.surface1,
              borderRadius: 6,
            }}
          >
            <Text
              style={{
                ...metaText,
                color:
                  last.status === "unknown" || last.status === "failed"
                    ? colors.statusWarning
                    : colors.foregroundMuted,
              }}
            >
              Request ·{" "}
              {last.status === "accepted" ? "Sent to agent" : last.status}
            </Text>
            {!!last.error && (
              <Text style={{ ...metaText, color: colors.foregroundMuted }}>
                {last.error}
              </Text>
            )}
            {(last.status === "failed" || last.status === "unknown") && (
              <ToolbarButton
                icon="Send"
                label={
                  last.status === "unknown"
                    ? "Retry (may send twice)"
                    : "Retry request"
                }
                disabled={busy}
                onPress={() =>
                  void operate(() =>
                    retry({
                      ...scope,
                      requestId: d.id,
                      allowInterrupt: interrupt,
                    }),
                  )
                }
              />
            )}
          </View>
        );
      })}
    </View>
  );
  const errors = error ?? query.error?.message;
  return (
    <ReviewKeyboard
      scroll={open ? overviewScroll : scroll}
      scrollY={open ? overviewY : scrollY}
      reveal={reveal}
    >
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 8,
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          borderBottomWidth: 1,
          borderColor: colors.border,
        }}
      >
        <ToolbarButton
          icon="MessageSquare"
          label={`Comments${threads.length ? ` (${threads.length})` : ""}`}
          onPress={() => {
            if (open) returnToDocument();
            else setOpen(true);
          }}
        />
        <ToolbarButton
          icon={selecting ? "X" : "MessageSquarePlus"}
          label={selecting ? "Cancel selection" : "Add comment"}
          onPress={() => {
            if (selecting) {
              finishSelection(false);
            } else {
              setSelecting(true);
              setInline(null);
              setOpen(false);
            }
          }}
        />
        {open && (
          <ToolbarButton
            icon="ArrowLeft"
            label="Back to document"
            onPress={returnToDocument}
          />
        )}
        {selection && !selecting && inline?.kind !== "new" && (
          <ToolbarButton
            icon="MessageSquare"
            label="Resume comment"
            onPress={resumeDraft}
          />
        )}
        {selecting && (
          <Text style={{ ...metaText, color: colors.foregroundMuted }}>
            Tap or click elements to select them. Select again to remove.
          </Text>
        )}
        {selecting && selection && !selectionCurrent && (
          <Text
            accessibilityRole="alert"
            style={{ ...metaText, color: colors.statusWarning }}
          >
            Canvas changed. Select the elements again; your comment is
            preserved.
          </Text>
        )}
      </View>
      {errors && (
        <Text
          accessibilityRole="alert"
          style={{ padding: 12, color: colors.statusDanger }}
        >
          {errors}
        </Text>
      )}
      <ScrollView
        testID="review-body"
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        onScroll={(e) => {
          if (!open) scrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        onLayout={() => {
          if (!open && pendingRestore.current) {
            pendingRestore.current = false;
            scroll.current?.scrollTo({ y: scrollY.current, animated: false });
          }
          moveToTarget();
        }}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: open ? "none" : "flex",
        }}
        contentContainerStyle={{
          padding: 16,
          paddingBottom: selecting ? 96 : 32,
        }}
      >
        <View
          ref={root}
          style={{
            width: "100%",
            maxWidth: mode === "preview" ? 820 : undefined,
            alignSelf: "center",
          }}
        >
          {inline?.kind === "new" && inlineAt === null && renderInline()}
          {mode === "preview" ? (
            <Markdown
              document={document}
              theme={theme}
              workspaceId={canvas.workspaceId}
              contentFontSize={fontSize}
              onError={setError}
              review={bindings}
              onNavigate={(y) =>
                scroll.current?.scrollTo({ y: y + 16, animated: true })
              }
            />
          ) : (
            source()
          )}
        </View>
      </ScrollView>
      {open && (
        <ScrollView
          ref={overviewScroll}
          onScroll={(e) => {
            overviewY.current = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          testID="review-overview"
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1, minHeight: 0 }}
        >
          {commentPanel}
        </ScrollView>
      )}
      {selecting && selection && selectionCurrent && (
        <View
          testID="review-comment-action"
          style={{ position: "absolute", right: 16, bottom: 16 }}
        >
          <Button
            icon="MessageSquare"
            label="Comment"
            size="md"
            variant="primary"
            onPress={resumeDraft}
          />
        </View>
      )}
    </ReviewKeyboard>
  );
}

function ReviewCard({
  thread,
  number,
  assignedName,
  review,
  theme,
  active,
  busy,
  checked,
  toggle,
  navigate,
  positionsReady,
  reattach,
  onError,
  change,
  expanded,
  showTargets,
  draft,
  setDraft,
}: {
  thread: ReviewThread;
  number: number;
  assignedName?: string;
  review: ReviewResult;
  theme: PluginTheme;
  active: boolean;
  busy: boolean;
  checked: boolean;
  toggle: () => void;
  navigate: (rangeIndex: number) => void;
  positionsReady: boolean;
  reattach: () => void;
  onError: (message: string) => void;
  change: (m: ReviewMutation) => Promise<unknown>;
  expanded: boolean;
  showTargets: boolean;
  draft: EditorDraft;
  setDraft: (update: Partial<EditorDraft>) => void;
}) {
  const { reply, editing, edits } = draft;
  const edit = editing ? (edits[editing] ?? "") : "";
  const setReply = (reply: string) => setDraft({ reply });
  const finishEdit = () => {
    const remaining = { ...edits };
    if (editing) delete remaining[editing];
    setDraft({ editing: null, edits: remaining });
  };
  const setEdit = (edit: string) => {
    if (editing) setDraft({ edits: { ...edits, [editing]: edit } });
  };
  const colors = theme.colors,
    anchor = thread.anchors.find((a) => a.id === thread.currentAnchorId)!;
  const scope = { threadId: thread.id, expectedRevision: thread.revision };
  const projections = review.projections[thread.id]?.ranges;
  return (
    <View
      style={{
        padding: showTargets ? 12 : 0,
        gap: 10,
        borderWidth: showTargets ? 1 : 0,
        borderColor: active ? colors.accent : colors.border,
        borderRadius: 8,
        backgroundColor: colors.surface1,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {thread.status !== "resolved" && (
          <ToolbarButton
            icon={checked ? "CheckSquare" : "Square"}
            accessibilityLabel={`Select comment ${number} for sending`}
            onPress={toggle}
          />
        )}
        <Text style={{ ...titleText, flex: 1, color: colors.foreground }}>
          #{number}
        </Text>
        <Text style={{ ...metaText, color: colors.foregroundMuted }}>
          {statuses[thread.status]}
        </Text>
      </View>
      {showTargets &&
        anchor.ranges.map((range, index) => {
          const projection = projections?.[index];
          return (
            <View
              key={`${range.start}:${range.end}`}
              style={{
                gap: 6,
                borderLeftWidth: 2,
                borderColor: colors.border,
                paddingLeft: 8,
              }}
            >
              <Text
                selectable
                numberOfLines={5}
                style={{ ...metaText, color: colors.foregroundMuted }}
              >
                {range.selectedText}
              </Text>
              <ToolbarButton
                icon="Locate"
                label="Go to target"
                onPress={() => navigate(index)}
                disabled={
                  !positionsReady ||
                  projection?.start == null ||
                  !!projection.reason
                }
              />
              {projection?.reason && (
                <Text style={{ ...metaText, color: colors.statusWarning }}>
                  Outdated · {projection.reason}
                </Text>
              )}
            </View>
          );
        })}
      {thread.status !== "resolved" && (
        <ToolbarButton
          icon="MousePointer2"
          label="Reattach"
          onPress={reattach}
        />
      )}
      {!!thread.assignedAgentId && (
        <Text style={{ ...metaText, color: colors.foregroundMuted }}>
          Assigned to {assignedName ?? thread.assignedAgentId}
        </Text>
      )}
      {!!unsentMessages(review.state, thread).length && (
        <Text style={{ ...metaText, color: colors.statusWarning }}>
          Unsent changes
        </Text>
      )}
      {thread.messages.map((m) => (
        <View
          key={m.id}
          style={{
            gap: 6,
            borderTopWidth: 1,
            borderColor: colors.border,
            paddingTop: 8,
          }}
        >
          <Text style={{ ...metaText, color: colors.foregroundMuted }}>
            {m.author.role === "user"
              ? "You"
              : (m.author.name ?? m.author.agentId)}
            {m.kind === "applied"
              ? ` · Applied at revision ${m.documentRevision}`
              : ""}
          </Text>
          {expanded && editing === m.id ? (
            <>
              <CommentEditor
                theme={theme}
                label="Edit comment"
                value={edit}
                onChangeText={setEdit}
                actions={
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <ToolbarButton
                      icon="Check"
                      label="Save"
                      disabled={busy || !edit.trim()}
                      onPress={() =>
                        void change({
                          action: "edit",
                          ...scope,
                          messageId: m.id,
                          body: edit,
                        }).then((result) => {
                          if (result) finishEdit();
                        })
                      }
                    />
                    <ToolbarButton
                      icon="X"
                      label="Cancel"
                      onPress={() => finishEdit()}
                    />
                  </View>
                }
              />
            </>
          ) : (
            <Markdown
              document={review.messageDocuments[m.id]}
              theme={theme}
              contentFontSize={14}
              workspaceId={review.state.workspaceId}
              onError={onError}
            />
          )}
          {expanded &&
            thread.status !== "resolved" &&
            m.author.role === "user" &&
            !messageLocked(review.state, m.id) && (
              <View style={{ flexDirection: "row", gap: 6 }}>
                <ToolbarButton
                  icon="Pencil"
                  label="Edit"
                  disabled={busy}
                  onPress={() => {
                    setDraft({
                      editing: m.id,
                      edits: { ...edits, [m.id]: edits[m.id] ?? m.body },
                    });
                  }}
                />
                <ToolbarButton
                  icon="Trash2"
                  label="Delete"
                  disabled={busy}
                  onPress={() =>
                    void change({ action: "delete", ...scope, messageId: m.id })
                  }
                />
              </View>
            )}
        </View>
      ))}
      {expanded && !editing && thread.status !== "resolved" && (
        <>
          <CommentEditor
            theme={theme}
            label="Reply"
            value={reply}
            onChangeText={setReply}
            placeholder="Reply or clarify the request"
            actions={
              <ToolbarButton
                icon="MessageSquarePlus"
                label="Save reply"
                disabled={busy || !reply.trim()}
                onPress={() =>
                  void change({ action: "reply", ...scope, body: reply }).then(
                    (result) => {
                      if (result) setReply("");
                    },
                  )
                }
              />
            }
          />
        </>
      )}
      <ToolbarButton
        icon={thread.status === "resolved" ? "RotateCcw" : "Check"}
        label={thread.status === "resolved" ? "Reopen" : "Resolve"}
        disabled={busy}
        onPress={() =>
          void change({
            action: "status",
            ...scope,
            resolved: thread.status !== "resolved",
          })
        }
      />
    </View>
  );
}
