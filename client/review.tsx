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
import {
  Button,
  TextInput,
  useRpcQuery,
  getClientHost,
} from "paseo-plugin-helper/client";
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
  const [width, setWidth] = useState<number | null>(null),
    [open, setOpen] = useState(false),
    [selecting, setSelecting] = useState(false);
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
    scroll = useRef<NativeScrollView>(null),
    rail = useRef<NativeScrollView>(null);
  const cards = useRef(new Map<string, View>()),
    railRoot = useRef<View>(null);
  const narrow = width === null || width < 920;
  const targets = reviewTargets(document);
  const targetRanges = new Set(
    targets.map((node) => {
      const range = sourceRange(node)!;
      return `${range.start}:${range.end}`;
    }),
  );
  const selectionCurrent = selection?.documentRevision === canvas.revision;
  useEffect(() => {
    if (open && selection && !selecting)
      rail.current?.scrollTo({ y: 0, animated: true });
  }, [open, selecting]);
  useEffect(() => {
    if (!recipient && recipients.data?.length === 1)
      setRecipient(recipients.data[0].id);
  }, [recipients.data, recipient]);
  useEffect(() => {
    setNavigate(null);
  }, [mode, canvas.revision]);
  function moveToTarget() {
    if (navigate === null || !root.current) return;
    const candidates = [...blocks.current.values()]
      .filter((b) => b.start <= navigate && b.end > navigate)
      .sort((a, b) => a.end - a.start - (b.end - b.start));
    candidates[0]?.node.measureLayout(
      root.current,
      (_x, y) =>
        scroll.current?.scrollTo({ y: Math.max(0, y - 12), animated: true }),
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
    setSelection((previous) => {
      const ranges =
        previous?.documentRevision === canvas.revision ? previous.ranges : [];
      const exists = ranges.some(
        (item) => item.start === range.start && item.end === range.end,
      );
      const next = exists
        ? ranges.filter(
            (item) => item.start !== range.start || item.end !== range.end,
          )
        : [
            ...ranges,
            {
              ...range,
              kind: "block" as const,
              selectedText: targetQuote(node),
            },
          ];
      return next.length
        ? {
            documentRevision: canvas.revision,
            ranges: next.sort((a, b) => a.start - b.start),
          }
        : null;
    });
  }
  function activate(id: string, fromBody = false, rangeIndex = 0) {
    setActive(id);
    setOpen(true);
    if (fromBody) {
      setTimeout(() => {
        const card = cards.current.get(id);
        if (card && railRoot.current)
          card.measureLayout(
            railRoot.current,
            (_x, y) => rail.current?.scrollTo({ y, animated: true }),
            () => {},
          );
      }, 0);
    } else {
      const projection = positions[id]?.ranges[rangeIndex];
      if (projection?.start != null) {
        setNavigate(projection.start);
        setNavigationRequest((value) => value + 1);
      }
    }
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
      setSelection(null);
      setDraft("");
      setReattach(null);
      setSelecting(false);
      setOpen(true);
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
                activate(s.ids[0], true);
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
                onPress={() => activate(id, true)}
              />
            ))}
          </View>
        )}
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
  const commentPanel = (
    <View ref={railRoot} style={{ gap: 16, padding: 16 }}>
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
      {!!selection && !selecting && (
        <View
          style={{
            gap: 8,
            padding: 12,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 8,
          }}
        >
          <Text style={{ ...titleText, color: colors.foreground }}>
            {reattach ? "Reattach comment" : "New comment"}
          </Text>
          {selection.ranges.map((range) => (
            <Text
              key={`${range.start}:${range.end}`}
              selectable
              numberOfLines={5}
              style={{
                ...metaText,
                color: colors.foregroundMuted,
                borderLeftWidth: 2,
                borderColor: colors.border,
                paddingLeft: 8,
              }}
            >
              {range.selectedText}
            </Text>
          ))}
          <ToolbarButton
            icon="MousePointer2"
            label="Change selection"
            onPress={() => {
              setSelecting(true);
              setOpen(false);
            }}
          />
          {!reattach && (
            <TextInput
              label="Comment"
              value={draft}
              onChangeText={setDraft}
              multiline
              numberOfLines={4}
              placeholder="Describe the change you want"
            />
          )}
          {selection.documentRevision !== canvas.revision && (
            <Text style={{ color: colors.statusWarning }}>
              Canvas changed. Select the target again; your comment is
              preserved.
            </Text>
          )}
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
                setSelection(null);
                setDraft("");
                setReattach(null);
              }}
            />
          </View>
        </View>
      )}
      {!threads.length && (
        <Text style={{ color: colors.foregroundMuted }}>
          Choose Select elements, then tap or click the elements you want to
          comment on.
        </Text>
      )}
      {threads
        .filter((t) => showResolved || t.status !== "resolved")
        .map((t) => (
          <View
            key={t.id}
            ref={(node) => {
              if (node) cards.current.set(t.id, node);
              else cards.current.delete(t.id);
            }}
          >
            <ReviewCard
              thread={t}
              number={numbers.get(t.id)!}
              assignedName={
                recipients.data?.find((r) => r.id === t.assignedAgentId)?.title
              }
              review={review!}
              theme={theme}
              active={active === t.id}
              busy={busy}
              checked={checked.includes(t.id)}
              toggle={() =>
                setChecked((ids) =>
                  ids.includes(t.id)
                    ? ids.filter((id) => id !== t.id)
                    : [...ids, t.id],
                )
              }
              positionsReady={review?.documentRevision === canvas.revision}
              navigate={(index) => activate(t.id, false, index)}
              reattach={() => {
                setReattach(t.id);
                setSelecting(true);
                setOpen(false);
                setSelection(null);
              }}
              onError={setError}
              change={(m) => operate(() => change(m))}
            />
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
    <View
      testID="review-document"
      style={{ flex: 1, minHeight: 0 }}
      onLayout={(e) => {
        const measuredWidth = e.nativeEvent.layout.width;
        // Hidden workspace tabs have no usable width. Keep the last layout
        // until the document is visible and can be measured again.
        if (measuredWidth > 0) setWidth(measuredWidth);
      }}
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
          onPress={() => setOpen(!open)}
        />
        <ToolbarButton
          icon={selecting ? "X" : "MousePointer2"}
          label={selecting ? "Cancel selection" : "Select elements"}
          onPress={() => {
            if (selecting) {
              setSelecting(false);
              setSelection(null);
              setReattach(null);
            } else {
              setSelecting(true);
              setOpen(false);
            }
          }}
        />
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
      <View
        testID="review-panes"
        style={{
          flex: 1,
          minHeight: 0,
          flexDirection: narrow ? "column" : "row",
        }}
      >
        <ScrollView
          testID="review-body"
          ref={scroll}
          style={{ flex: 1, minWidth: 0, minHeight: 0 }}
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
          <View
            testID="review-comments"
            style={{
              flex: narrow ? 1 : undefined,
              width: narrow ? "100%" : 340,
              minHeight: 0,
              borderLeftWidth: narrow ? 0 : 1,
              borderTopWidth: narrow ? 1 : 0,
              borderColor: colors.border,
            }}
          >
            <ScrollView ref={rail} style={{ flex: 1, minHeight: 0 }}>
              {commentPanel}
            </ScrollView>
          </View>
        )}
      </View>
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
            onPress={() => {
              setSelecting(false);
              setOpen(true);
            }}
          />
        </View>
      )}
    </View>
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
}) {
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState<string | null>(null),
    [edit, setEdit] = useState("");
  const colors = theme.colors,
    anchor = thread.anchors.find((a) => a.id === thread.currentAnchorId)!;
  const scope = { threadId: thread.id, expectedRevision: thread.revision };
  const projections = review.projections[thread.id]?.ranges;
  return (
    <View
      style={{
        padding: 12,
        gap: 10,
        borderWidth: 1,
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
      {anchor.ranges.map((range, index) => {
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
          {editing === m.id ? (
            <>
              <TextInput
                label="Edit comment"
                value={edit}
                onChangeText={setEdit}
                multiline
                numberOfLines={3}
              />
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
                      if (result) setEditing(null);
                    })
                  }
                />
                <ToolbarButton
                  icon="X"
                  label="Cancel"
                  onPress={() => setEditing(null)}
                />
              </View>
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
          {thread.status !== "resolved" &&
            m.author.role === "user" &&
            !messageLocked(review.state, m.id) && (
              <View style={{ flexDirection: "row", gap: 6 }}>
                <ToolbarButton
                  icon="Pencil"
                  label="Edit"
                  disabled={busy}
                  onPress={() => {
                    setEditing(m.id);
                    setEdit(m.body);
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
      {thread.status !== "resolved" && (
        <>
          <TextInput
            label="Reply"
            value={reply}
            onChangeText={setReply}
            multiline
            numberOfLines={3}
            placeholder="Reply or clarify the request"
          />
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
