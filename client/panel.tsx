import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import {
  Icon,
  Modal,
  ScrollView,
  copyText,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import {
  Badge,
  EmptyState,
  KeyValue,
  PluginThemeProvider,
  Tabs,
  useRpcQuery,
  usePluginTheme,
} from "paseo-plugin-helper/client";
import {
  editorLabel,
  getCanvas,
  listCanvases,
  type Canvas,
  type EditState,
} from "../shared/contracts";
import { useCanvasUpdates } from "./updates";
import { createCanvasSelection, type CanvasSelection } from "./selection";
import { useCanvasEditor, CanvasEditForm, EditConfirmation } from "./editor";
import { ReviewDocument } from "./review";
import { HEADER_HEIGHT, ToolbarButton, titleText, metaText } from "./controls";

// Paseo docs/design.md and styles/theme.ts: use the public theme colors and the
// authored interface scale. The SDK does not expose live typography/spacing tokens.
const labelStyle = {
  fontSize: 14,
  lineHeight: 20,
  fontWeight: "400",
  includeFontPadding: false,
} as const;
const sidebarWidth = 320;
const detailMinWidth = 400;

function lockLabel(state: EditState) {
  return state.status === "locked"
    ? `Being edited by ${editorLabel(state.lock.owner, state.lock.ownerTitle)}`
    : "Unlocked";
}

export function CanvasPanel(
  props: PluginWorkspacePanelProps & { selection?: CanvasSelection },
) {
  const [localSelection] = useState(createCanvasSelection);
  const [width, setWidth] = useState<number | null>(null);
  // A split workspace pane can be narrower than the host's form factor. Keep
  // the canonical 320 + 400 list/detail topology only where it actually fits.
  const singlePane =
    props.layout.compact ||
    (width !== null && width < sidebarWidth + detailMinWidth);
  return (
    <View
      style={{ flex: 1, minWidth: 0, minHeight: 0 }}
      onLayout={(event) => {
        const measuredWidth = event.nativeEvent.layout.width;
        // A hidden tab must not switch topology and unmount its document.
        if (measuredWidth > 0) setWidth(measuredWidth);
      }}
    >
      <PluginThemeProvider
        theme={props.theme}
        layout={{ ...props.layout, compact: singlePane }}
      >
        <WorkspaceCanvas
          key={props.workspaceId}
          {...props}
          selection={props.selection ?? localSelection}
          singlePane={singlePane}
        />
      </PluginThemeProvider>
    </View>
  );
}

function WorkspaceCanvas({
  workspaceId,
  theme,
  layout,
  singlePane,
  selection,
}: PluginWorkspacePanelProps & {
  singlePane: boolean;
  selection: CanvasSelection;
}) {
  const colors = theme.colors;
  const { editor, state: edit } = useCanvasEditor(workspaceId, selection);
  const updateError = useCanvasUpdates(workspaceId);
  const selected = useSyncExternalStore(
    (listener) => selection.subscribe(workspaceId, listener),
    () => selection.get(workspaceId),
  );
  const setSelected = (canvasId: string | null) =>
    selection.select(workspaceId, canvasId);
  const [listOpen, setListOpen] = useState(true);
  const [listSide, setListSide] = useState<"left" | "right">("left");
  const list = useRpcQuery(listCanvases, { workspaceId }, { retry: true });
  const listError = list.error ?? list.failureReason;
  const canvasId =
    selected ?? (!singlePane ? (list.data?.items[0]?.canvasId ?? null) : null);
  const selectionMissing =
    selected !== null &&
    !!list.data &&
    !list.data.items.some((item) => item.canvasId === selected);
  const showList = singlePane ? selected === null && !edit.draft : listOpen;
  const showDetail = !!edit.draft || !singlePane || selected !== null;
  const navigation = singlePane ? (
    <ToolbarButton
      icon="ArrowLeft"
      accessibilityLabel="Back to canvases"
      onPress={() => setSelected(null)}
    />
  ) : (
    <ToolbarButton
      icon={
        listSide === "left"
          ? listOpen
            ? "PanelLeftClose"
            : "PanelLeftOpen"
          : listOpen
            ? "PanelRightClose"
            : "PanelRightOpen"
      }
      accessibilityLabel={listOpen ? "Hide canvas list" : "Show canvas list"}
      onPress={() => setListOpen((open) => !open)}
    />
  );
  const navigationSide = singlePane ? "left" : listSide;
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      {edit.error && (
        <Text
          accessibilityRole="alert"
          style={{ ...metaText, color: colors.statusDanger, padding: 12 }}
        >
          {edit.error}
        </Text>
      )}
      <EditConfirmation editor={editor} state={edit} theme={theme} />
      {updateError && (
        <Text
          accessibilityRole="alert"
          style={{ ...metaText, color: colors.statusWarning, padding: 12 }}
        >
          Live updates interrupted. Reconnecting…
        </Text>
      )}
      <View
        style={{
          flex: 1,
          minHeight: 0,
          flexDirection: listSide === "left" ? "row" : "row-reverse",
          backgroundColor: colors.surface0,
        }}
      >
        {showList && (
          <View
            style={
              singlePane
                ? { flex: 1 }
                : {
                    width: sidebarWidth,
                    borderRightWidth: listSide === "left" ? 1 : 0,
                    borderLeftWidth: listSide === "right" ? 1 : 0,
                    borderColor: colors.border,
                  }
            }
          >
            <View
              style={{
                height: HEADER_HEIGHT,
                paddingHorizontal: 16,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                borderBottomWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Icon
                name="NotebookPen"
                size={20}
                color={colors.foregroundMuted}
              />
              <View style={{ flex: 1, gap: 4 }}>
                <Text
                  accessibilityRole="header"
                  style={{ ...titleText, color: colors.foreground }}
                >
                  Canvases
                </Text>
                <View style={{ height: 20, justifyContent: "center" }}>
                  <Text style={{ ...metaText, color: colors.foregroundMuted }}>
                    {list.data
                      ? `${list.data.items.length} ${list.data.items.length === 1 ? "canvas" : "canvases"}`
                      : "Loading…"}
                  </Text>
                </View>
              </View>
              <ToolbarButton
                icon="Plus"
                label="New canvas"
                disabled={edit.busy}
                onPress={() => editor.newCanvas()}
              />
              {!singlePane && (
                <ToolbarButton
                  icon={listSide === "left" ? "PanelRight" : "PanelLeft"}
                  accessibilityLabel={`Move canvas list to ${listSide === "left" ? "right" : "left"}`}
                  onPress={() =>
                    setListSide((side) => (side === "left" ? "right" : "left"))
                  }
                />
              )}
            </View>
            {listError && (
              <ReadError
                theme={theme}
                error={listError}
                stale={!!list.data}
                subject="canvases"
              />
            )}
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ flexGrow: 1, padding: 8, gap: 4 }}
            >
              {list.isLoading && !listError && (
                <CenteredText theme={theme}>Loading…</CenteredText>
              )}
              {list.data?.items.length === 0 && (
                <EmptyState
                  icon={null}
                  title="No canvases yet"
                  description="Create a canvas or ask an agent to create one"
                  style={{ flex: 1, padding: 16 }}
                />
              )}
              {list.data?.items.map((item) => (
                <CanvasRow
                  key={item.canvasId}
                  title={item.title}
                  state={item.editState}
                  active={!singlePane && item.canvasId === canvasId}
                  theme={theme}
                  onPress={() => setSelected(item.canvasId)}
                />
              ))}
            </ScrollView>
          </View>
        )}
        {showDetail && (
          <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            {edit.draft ? (
              <CanvasEditForm
                editor={editor}
                state={edit}
                theme={theme}
                workspaceId={workspaceId}
              />
            ) : canvasId ? (
              <CanvasDetail
                key={canvasId}
                workspaceId={workspaceId}
                canvasId={canvasId}
                missing={selectionMissing}
                busy={edit.busy}
                onEdit={() => void editor.begin(canvasId)}
                onDelete={(canvas) => editor.requestDelete(canvas)}
                theme={theme}
                platform={layout.platform}
                navigation={navigation}
                navigationSide={navigationSide}
              />
            ) : (
              <>
                <View
                  style={{
                    height: HEADER_HEIGHT,
                    paddingHorizontal: 16,
                    flexDirection: "row",
                    alignItems: "center",
                    borderBottomWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  {navigationSide === "left" && navigation}
                  <View style={{ flex: 1 }} />
                  {navigationSide === "right" && navigation}
                </View>
                <CenteredText theme={theme}>Select a canvas</CenteredText>
              </>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

function CanvasRow({
  title,
  state,
  active,
  theme,
  onPress,
}: {
  title: string;
  state: EditState;
  active: boolean;
  theme: PluginTheme;
  onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${title}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        // Include the focus border inside the 8px / 12px content insets.
        paddingHorizontal: 8 - 1,
        paddingVertical: 12 - 1,
        gap: 12,
        borderWidth: 1,
        borderColor: focused ? theme.colors.accent : "transparent",
        borderRadius: 8,
        backgroundColor:
          active || pressed
            ? theme.colors.surface2
            : hovered || focused
              ? theme.colors.surface1
              : "transparent",
      })}
    >
      <Icon name="FileText" size={20} color={theme.colors.foregroundMuted} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text
          numberOfLines={1}
          style={{
            color: theme.colors.foreground,
            ...labelStyle,
          }}
        >
          {title}
        </Text>
        <Text
          numberOfLines={1}
          style={{ ...metaText, color: theme.colors.foregroundMuted }}
        >
          {lockLabel(state)}
        </Text>
      </View>
      <Icon
        name="ChevronRight"
        size={16}
        color={theme.colors.foregroundMuted}
      />
    </Pressable>
  );
}

function CanvasDetail({
  workspaceId,
  canvasId,
  missing,
  theme,
  platform,
  navigation,
  navigationSide,
  onEdit,
  onDelete,
  busy,
}: {
  workspaceId: string;
  canvasId: string;
  missing: boolean;
  theme: PluginTheme;
  platform: PluginWorkspacePanelProps["layout"]["platform"];
  navigation: ReactNode;
  navigationSide: "left" | "right";
  onEdit: () => void;
  onDelete: (canvas: Canvas) => void;
  busy: boolean;
}) {
  const colors = theme.colors;
  const toast = useToast();

  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detail = useRpcQuery(
    getCanvas,
    { workspaceId, canvasId },
    { enabled: !missing, retry: true },
  );
  const detailError = detail.error ?? detail.failureReason;
  const canvas = missing ? undefined : detail.data?.canvas;
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View
        style={{
          height: HEADER_HEIGHT,
          paddingHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          borderBottomWidth: 1,
          borderColor: colors.border,
        }}
      >
        {navigationSide === "left" && navigation}
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={{ ...titleText, color: colors.foreground }}
          >
            {canvas?.title ?? "Canvas"}
          </Text>
          <View
            style={{
              height: 20,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            {canvas && (
              <>
                <Badge
                  label={
                    canvas.editState.status === "locked"
                      ? "Editing"
                      : "Unlocked"
                  }
                  variant="neutral"
                  styleVariant="outline"
                  style={{
                    height: 20,
                    alignSelf: "center",
                    paddingVertical: 1,
                    paddingHorizontal: 6,
                    borderColor: colors.border,
                    backgroundColor: colors.surface2,
                  }}
                  textStyle={{ ...metaText, color: colors.foregroundMuted }}
                />
                {canvas.editState.status === "locked" && (
                  <Text
                    numberOfLines={1}
                    style={{
                      ...metaText,
                      flex: 1,
                      color: colors.foregroundMuted,
                    }}
                  >
                    {editorLabel(
                      canvas.editState.lock.owner,
                      canvas.editState.lock.ownerTitle,
                    )}
                  </Text>
                )}
              </>
            )}
          </View>
        </View>
        <ToolbarButton
          icon="Info"
          label="Details"
          disabled={!canvas}
          onPress={() => setDetailsOpen(true)}
        />
        {navigationSide === "right" && navigation}
      </View>
      <View
        style={{
          minHeight: HEADER_HEIGHT,
          flexWrap: "wrap",
          paddingHorizontal: 16,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderBottomWidth: 1,
          borderColor: colors.border,
        }}
      >
        {canvas ? (
          <>
            <View style={{ flex: 1, maxWidth: 260, minWidth: 0 }}>
              <Tabs
                tabs={[
                  { id: "preview", label: "Preview", icon: "Eye" },
                  { id: "source", label: "Code", icon: "Code" },
                ]}
                activeTab={mode}
                onTabChange={(id) => setMode(id as "preview" | "source")}
                mode="fit"
                style={{ borderRadius: 6 }}
              />
            </View>
            <ToolbarButton
              icon="Pencil"
              label="Edit"
              disabled={busy || canvas.editState.status === "locked"}
              onPress={onEdit}
            />
            <ToolbarButton
              icon="Trash2"
              label="Delete"
              disabled={busy || canvas.editState.status === "locked"}
              onPress={() => onDelete(canvas)}
            />
            <ToolbarButton
              icon="Copy"
              label="Copy"
              size="md"
              accessibilityLabel="Copy content"
              onPress={async () => {
                try {
                  await copyText(canvas.content);
                  toast.show("Content copied");
                } catch {
                  toast.error("Unable to copy content");
                }
              }}
            />
          </>
        ) : null}
      </View>
      {missing ? (
        <CenteredText theme={theme}>This canvas has been deleted</CenteredText>
      ) : (
        <>
          {detailError && (
            <ReadError
              theme={theme}
              error={detailError}
              stale={!!canvas}
              subject="content"
            />
          )}
          {detail.isLoading && !detailError && (
            <CenteredText theme={theme}>Loading…</CenteredText>
          )}
          {canvas && (
            <ReviewDocument
              canvas={canvas}
              document={detail.data!.document}
              theme={theme}
              mode={mode}
              fontSize={platform === "ios" || platform === "android" ? 16 : 15}
            />
          )}
        </>
      )}
      {canvas && (
        <CanvasDetails
          canvas={canvas}
          theme={theme}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        />
      )}
    </View>
  );
}

function CanvasDetails({
  canvas,
  theme,
  open,
  onOpenChange,
}: {
  canvas: Canvas;
  theme: PluginTheme;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { isCompact } = usePluginTheme();
  const fields: [string, string | number][] = [
    ["Title", canvas.title],
    ["Canvas ID", canvas.canvasId],
    ["Revision", canvas.revision],
    ["Last saved by", editorLabel(canvas.updatedBy)],
  ];
  if (canvas.editState.status === "locked") {
    const lock = canvas.editState.lock;
    fields.push(
      ["Editor", editorLabel(lock.owner, lock.ownerTitle)],
      ["Lock acquired", lock.acquiredAt],
      ["Last renewed", lock.renewedAt],
      ["Expires", lock.expiresAt],
    );
  }
  return (
    <Modal title="Canvas details" open={open} onOpenChange={onOpenChange}>
      <Modal.Content>
        {fields.map(([label, value]) => (
          <KeyValue
            key={label}
            label={label}
            value={value}
            stackOnCompact
            labelStyle={{
              ...(isCompact ? metaText : labelStyle),
              color: theme.colors.foregroundMuted,
            }}
            valueStyle={{ ...labelStyle, color: theme.colors.foreground }}
            style={{ paddingVertical: 8 }}
          />
        ))}
      </Modal.Content>
    </Modal>
  );
}

function ReadError({
  theme,
  error,
  stale,
  subject,
}: {
  theme: PluginTheme;
  error: Error;
  stale: boolean;
  subject: string;
}) {
  return (
    <View
      accessibilityRole="alert"
      style={{
        padding: 12,
        borderBottomWidth: 1,
        borderColor: theme.colors.border,
        gap: 4,
      }}
    >
      <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
        Unable to load {subject}
      </Text>
      <Text style={{ ...metaText, color: theme.colors.foregroundMuted }}>
        {stale
          ? "Showing the last loaded content. Retrying automatically."
          : "Retrying automatically."}
      </Text>
      <Text
        selectable
        style={{ ...metaText, color: theme.colors.foregroundMuted }}
      >
        {error.message}
      </Text>
    </View>
  );
}
function CenteredText({
  theme,
  children,
}: {
  theme: PluginTheme;
  children: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>
        {children}
      </Text>
    </View>
  );
}
