import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Platform,
  Pressable,
  Text,
  View,
  type ScrollView as NativeScrollView,
} from "react-native";
import { Modal, ScrollView } from "@getpaseo/plugin/client/react-native";
import { SettingsSelect } from "@getpaseo/plugin/client/ui";
import type { PluginTheme } from "@getpaseo/plugin";
import {
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
import { textContent } from "../shared/document";
import { Markdown } from "./markdown";
import { ToolbarButton, metaText, titleText } from "./controls";
import {
  observeTextSelection,
  registerSelectionLeaf,
  type SelectionLeaf,
} from "./web";
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
  const [width, setWidth] = useState(0),
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
  const [navigate, setNavigate] = useState<number | null>(null),
    [lineStart, setLineStart] = useState<number | null>(null);
  const [navigationRequest, setNavigationRequest] = useState(0);
  const leaves = useRef(new Map<string, SelectionLeaf>()),
    blocks = useRef(
      new Map<string, { node: View | Text; start: number; end: number }>(),
    );
  const root = useRef<View>(null),
    scroll = useRef<NativeScrollView>(null),
    rail = useRef<NativeScrollView>(null);
  const cards = useRef(new Map<string, View>()),
    railRoot = useRef<View>(null);
  const narrow = width < 920;
  const current = useRef(canvas);
  current.current = canvas;
  useEffect(
    () =>
      observeTextSelection(
        () => root.current,
        leaves.current,
        (range) => {
          setSelection({
            ...range,
            documentRevision: current.current.revision,
            kind: "text",
          });
        },
      ),
    [],
  );
  useEffect(() => {
    if (!recipient && recipients.data?.length === 1)
      setRecipient(recipients.data[0].id);
  }, [recipients.data, recipient]);
  useEffect(() => {
    setNavigate(null);
    setLineStart(null);
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
    const range = sourceRange(node);
    if (!range) return;
    setSelection({
      ...range,
      documentRevision: canvas.revision,
      kind: "block",
      selectedText:
        textContent(node).trim() ||
        String(
          node.properties.alt ??
            (node.children.some(
              (n) => n.type === "element" && n.tagName === "img",
            )
              ? "Image"
              : node.tagName),
        ),
    });
  }
  function activate(id: string, fromBody = false) {
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
      const projection = positions[id];
      if (projection?.start != null) {
        setNavigate(projection.start);
        setNavigationRequest((value) => value + 1);
        if (narrow) setOpen(false);
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
            p.start !== null &&
            p.end !== null &&
            map[i * 2] < p.end &&
            map[i * 2 + 1] > p.start &&
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
        ref={(node) => {
          const id = `${key}:${s.start}`;
          registerSelectionLeaf(
            leaves.current,
            id,
            node,
            map.slice(s.start * 2, s.end * 2),
          );
        }}
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
    const selectable = selecting && node.tagName !== "table";
    const ids = Object.entries(positions)
      .filter(
        ([id, p]) =>
          p.start !== null &&
          p.end !== null &&
          p.start < range.end &&
          p.end > range.start &&
          (showResolved || review!.state.threads[id].status !== "resolved"),
      )
      .map(([id]) => id);
    return (
      <View
        key={key}
        ref={(node) => {
          if (node) blocks.current.set(key, { node, ...range });
          else blocks.current.delete(key);
        }}
        onLayout={moveToTarget}
        style={{
          gap: 6,
          borderLeftWidth: ids.length || selecting ? 2 : 0,
          borderColor: ids.includes(active ?? "")
            ? colors.accent
            : colors.border,
          paddingLeft: ids.length || selecting ? 8 : 0,
        }}
      >
        {(selectable ||
          node.tagName === "pre" ||
          node.tagName === "img" ||
          node.children.some(
            (n) => n.type === "element" && n.tagName === "img",
          )) && (
          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            <ToolbarButton
              icon="MessageSquarePlus"
              label="Select target"
              onPress={() => selectBlock(node)}
            />
          </View>
        )}
        {selectable ? (
          <Pressable
            onPress={() => selectBlock(node)}
            accessibilityRole="button"
            accessibilityLabel={`Select ${node.tagName} for review`}
          >
            <View pointerEvents="none">{child}</View>
          </Pressable>
        ) : (
          child
        )}
        {!!ids.length && (
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
      (review?.projections[a.id]?.start ?? Infinity) -
        (review?.projections[b.id]?.start ?? Infinity) ||
      a.createdAt.localeCompare(b.createdAt),
  );
  const numbers = new Map(threads.map((t, i) => [t.id, i + 1]));
  const bindings: ReviewBindings = {
    enabled: selecting,
    navigate,
    navigationRequest,
    text: markedText,
    wrap,
    select: selectBlock,
    register: (key, node, range) => {
      if (node && range) blocks.current.set(key, { node, ...range });
      else blocks.current.delete(key);
    },
  };
  function selectLine(start: number, end: number) {
    if (lineStart === null) {
      setLineStart(start);
      setSelection(null);
      return;
    }
    const from = Math.min(lineStart, start);
    let to = end;
    if (lineStart > start) {
      const next = canvas.content.indexOf("\n", lineStart);
      to = next < 0 ? canvas.content.length : next + 1;
    }
    setSelection({
      documentRevision: canvas.revision,
      kind: "lines",
      start: from,
      end: to,
      selectedText: canvas.content.slice(from, to),
    });
    setLineStart(null);
  }
  let offset = 0;
  const source = () =>
    (canvas.content.match(/[^\n]*\n|[^\n]+$/g) ?? []).map((line, index) => {
      const start = offset,
        end = start + line.length;
      offset = end;
      const node: Element = {
        type: "element",
        tagName: "code-line",
        properties: { dataCanvasStart: start, dataCanvasEnd: end },
        children: [],
      };
      const value = line.replace(/\r?\n$/, "");
      const map = Array.from({ length: value.length }, (_, i) => [
        start + i,
        start + i + 1,
      ]).flat();
      return wrap(
        node,
        <View
          style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}
        >
          {Platform.OS !== "web" && (
            <ToolbarButton
              icon="Hash"
              label={String(index + 1)}
              accessibilityLabel={`Select line ${index + 1}`}
              onPress={() => selectLine(start, end)}
              style={{
                minWidth: 52,
                backgroundColor:
                  lineStart === start ? colors.surface2 : undefined,
              }}
            />
          )}
          <Text
            selectable={Platform.OS === "web"}
            style={{
              flex: 1,
              fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
              fontSize: 12,
              lineHeight: 22,
              color: colors.foreground,
              backgroundColor:
                selection && start < selection.end && end > selection.start
                  ? colors.surface2
                  : undefined,
            }}
          >
            {value ? markedText(value, map, `source:${index}`) : "\n"}
          </Text>
        </View>,
        `line:${index}`,
      );
    });
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
      {!!selection && (
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
          <Text
            selectable
            numberOfLines={5}
            style={{ ...metaText, color: colors.foregroundMuted }}
          >
            {selection.selectedText}
          </Text>
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
          Select text or a block in the canvas to add a comment.
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
              navigate={() => activate(t.id)}
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
      style={{ flex: 1, minHeight: 0 }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
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
        {Platform.OS !== "web" && mode === "preview" && (
          <ToolbarButton
            icon={selecting ? "Check" : "MousePointer2"}
            label={selecting ? "Finish selecting" : "Review"}
            onPress={() => {
              setSelecting(!selecting);
              if (!selecting) setOpen(false);
            }}
          />
        )}
        {!!selection && (
          <ToolbarButton
            icon="MessageSquarePlus"
            label={reattach ? "Reattach comment" : "Add comment"}
            onPress={() => setOpen(true)}
          />
        )}
        {Platform.OS !== "web" && mode === "source" && (
          <Text style={{ ...metaText, color: colors.foregroundMuted }}>
            {lineStart === null
              ? "Select the first and last line"
              : "Select the last line"}
          </Text>
        )}
        {selecting && (
          <Text style={{ ...metaText, color: colors.foregroundMuted }}>
            Select a paragraph, cell or diagram
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
      <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }}>
        <ScrollView
          ref={scroll}
          style={{ flex: 1, minWidth: 0 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
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
        {open && !narrow && (
          <View
            style={{
              width: 340,
              borderLeftWidth: 1,
              borderColor: colors.border,
            }}
          >
            <ScrollView ref={rail}>{commentPanel}</ScrollView>
          </View>
        )}
      </View>
      <Modal
        title="Canvas comments"
        open={open && narrow}
        onOpenChange={setOpen}
      >
        <Modal.Content>
          <ScrollView ref={rail} style={{ maxHeight: 650 }}>
            {commentPanel}
          </ScrollView>
        </Modal.Content>
      </Modal>
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
  navigate: () => void;
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
  const outdated = review.projections[thread.id]?.reason;
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
      <Text
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
        {anchor.selectedText}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <ToolbarButton
          icon="Locate"
          label="Go to target"
          onPress={navigate}
          disabled={!positionsReady || !!outdated}
        />
        {thread.status !== "resolved" && (
          <ToolbarButton
            icon="MousePointer2"
            label="Reattach"
            onPress={reattach}
          />
        )}
      </View>
      {outdated && (
        <Text style={{ ...metaText, color: colors.statusWarning }}>
          Outdated · {outdated}
        </Text>
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
