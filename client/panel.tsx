import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";
import {
  Icon,
  Modal,
  ScrollView,
  copyText,
  useToast,
} from "@getpaseo/plugin/client/ui";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  useSettings,
  useTabState,
  type PluginTab,
  type PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import {
  Badge,
  CanvasThemeProvider,
  EmptyState,
  KeyValue,
  Tabs,
  useCanvasTheme,
} from "./ui";
import { useRpcQuery } from "./rpc";
import {
  getCanvas,
  idSchema,
  listCanvases,
  type Canvas,
  type EditState,
  type Editor,
} from "../shared/contracts";
import { useCanvasUpdates } from "./updates";
import { createCanvasSelection, type CanvasSelection } from "./selection";
import { useCanvasEditor, CanvasEditForm, EditConfirmation } from "./editor";
import { draftChanged } from "./editing-state";
import { ReviewDocument } from "./review";
import { HEADER_HEIGHT, ToolbarButton, titleText, metaText } from "./controls";
import { createLinkOpener, LinkOpenerProvider } from "./links";
import {
  canvasDeviceSettings,
  defaultCanvasDeviceSettings,
} from "../shared/settings";
import { useText } from "./i18n";

type Translate = ReturnType<typeof useText>["t"];

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

/** Who holds or last held a canvas, in the reader's language. */
export function editorName(
  t: Translate,
  editor: Editor,
  title?: string | null,
) {
  return editor.role === "user" ? t("panel.user") : (title ?? editor.agentId);
}

function lockLabel(t: Translate, state: EditState) {
  return state.status === "locked"
    ? t("panel.beingEdited", {
        name: editorName(t, state.lock.owner, state.lock.ownerTitle),
      })
    : t("panel.unlocked");
}

/** Survives tab restoration and app reloads (Paseo 0.13 tab state). */
const panelStateSchema = z.object({
  canvasId: idSchema.nullable().default(null),
  listOpen: z.boolean().default(true),
  listSide: z.enum(["left", "right"]).default("left"),
});
type PanelState = z.output<typeof panelStateSchema>;
const defaultPanelState: PanelState = panelStateSchema.parse({});

/** Screens have no workspace tab; they keep the same state in memory. */
function useLocalTab(): PluginTab {
  const [state, setState] = useState<unknown>(undefined);
  return useMemo(
    () => ({ state, setState, setModified: () => {} }),
    [state],
  );
}

export type CanvasPanelProps = Pick<
  PluginWorkspacePanelProps,
  "workspaceId" | "theme" | "host" | "layout" | "navigation"
> & {
  /** The workspace tab; a screen omits it. */
  tab?: PluginTab;
  selection?: CanvasSelection;
  /** Opens the canvas in the full-page screen; omitted inside that screen. */
  onOpenScreen?: (canvasId: string) => void;
};

export function CanvasPanel(props: CanvasPanelProps) {
  const [localSelection] = useState(createCanvasSelection);
  const localTab = useLocalTab();
  // The link target is a preference of the viewing device (ADR 18).
  const settings = useSettings(canvasDeviceSettings);
  const preference =
    settings.status === "ready"
      ? settings.values.openLinksIn
      : defaultCanvasDeviceSettings.openLinksIn;
  const openBrowser = props.navigation?.openBrowser;
  const openLink = useMemo(
    () =>
      createLinkOpener({
        preference,
        openBrowser,
        workspaceId: props.workspaceId,
        serverId: props.host.id,
      }),
    [preference, openBrowser, props.workspaceId, props.host.id],
  );
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
      <CanvasThemeProvider
        theme={props.theme}
        layout={{ ...props.layout, compact: singlePane }}
      >
        <LinkOpenerProvider value={openLink}>
          <WorkspaceCanvas
            key={props.workspaceId}
            {...props}
            tab={props.tab ?? localTab}
            selection={props.selection ?? localSelection}
            singlePane={singlePane}
          />
        </LinkOpenerProvider>
      </CanvasThemeProvider>
    </View>
  );
}

function WorkspaceCanvas({
  workspaceId,
  theme,
  layout,
  singlePane,
  selection,
  tab,
  onOpenScreen,
}: CanvasPanelProps & {
  singlePane: boolean;
  selection: CanvasSelection;
  tab: PluginTab;
}) {
  const colors = theme.colors;
  const { t } = useText();
  const [panelState, setPanelState] = useTabState(
    tab,
    panelStateSchema,
    defaultPanelState,
  );
  useState(() => {
    // A canvas opened from a timeline row wins over the restored one.
    if (panelState.canvasId) selection.restore(workspaceId, panelState.canvasId);
  });
  const { editor, state: edit } = useCanvasEditor(workspaceId, selection);
  const updateError = useCanvasUpdates(workspaceId);
  const selected = useSyncExternalStore(
    (listener) => selection.subscribe(workspaceId, listener),
    () => selection.get(workspaceId),
  );
  const setSelected = (canvasId: string | null) =>
    selection.select(workspaceId, canvasId);
  const { listOpen, listSide } = panelState;
  const updatePanel = (change: Partial<PanelState>) =>
    setPanelState({ ...panelState, ...change });
  useEffect(() => {
    if (selected !== panelState.canvasId)
      setPanelState({ ...panelState, canvasId: selected });
  }, [selected, panelState, setPanelState]);
  // Paseo asks before closing a tab with unsaved changes.
  const modified = !!edit.draft && draftChanged(edit.draft);
  useEffect(() => {
    tab.setModified(modified);
  }, [tab, modified]);
  useEffect(() => () => tab.setModified(false), [tab]);
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
      accessibilityLabel={t("panel.back")}
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
      accessibilityLabel={listOpen ? t("panel.hideList") : t("panel.showList")}
      onPress={() => updatePanel({ listOpen: !listOpen })}
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
          {t("panel.updatesInterrupted")}
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
                  {t("panel.canvases")}
                </Text>
                <View style={{ height: 20, justifyContent: "center" }}>
                  <Text style={{ ...metaText, color: colors.foregroundMuted }}>
                    {list.data
                      ? t("panel.count", { count: list.data.items.length })
                      : t("common.loading")}
                  </Text>
                </View>
              </View>
              <ToolbarButton
                icon="Plus"
                label={t("panel.newCanvas")}
                disabled={edit.busy}
                onPress={() => editor.newCanvas()}
              />
              {!singlePane && (
                <ToolbarButton
                  icon={listSide === "left" ? "PanelRight" : "PanelLeft"}
                  accessibilityLabel={
                    listSide === "left"
                      ? t("panel.moveListRight")
                      : t("panel.moveListLeft")
                  }
                  onPress={() =>
                    updatePanel({
                      listSide: listSide === "left" ? "right" : "left",
                    })
                  }
                />
              )}
            </View>
            {listError && (
              <ReadError
                theme={theme}
                error={listError}
                stale={!!list.data}
                subject={t("panel.loadListFailed")}
              />
            )}
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ flexGrow: 1, padding: 8, gap: 4 }}
            >
              {list.isLoading && !listError && (
                <CenteredText theme={theme}>{t("common.loading")}</CenteredText>
              )}
              {list.data?.items.length === 0 && (
                <EmptyState
                  title={t("panel.empty")}
                  description={t("panel.emptyHint")}
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
                onOpenScreen={onOpenScreen}
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
                <CenteredText theme={theme}>{t("panel.select")}</CenteredText>
              </>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

export function CanvasRow({
  title,
  state,
  active,
  theme,
  onPress,
  workspaceName,
}: {
  title: string;
  state: EditState;
  active: boolean;
  theme: PluginTheme;
  onPress: () => void;
  /** Shown where a list spans several workspaces. */
  workspaceName?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const { t } = useText();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("panel.openRow", { title })}
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
          {workspaceName
            ? `${workspaceName} · ${lockLabel(t, state)}`
            : lockLabel(t, state)}
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
  onOpenScreen,
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
  onOpenScreen?: (canvasId: string) => void;
  busy: boolean;
}) {
  const colors = theme.colors;
  const toast = useToast();
  const { t } = useText();
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
            {canvas?.title ?? t("plugin.title")}
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
                      ? t("panel.editing")
                      : t("panel.unlocked")
                  }
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
                    {editorName(
                      t,
                      canvas.editState.lock.owner,
                      canvas.editState.lock.ownerTitle,
                    )}
                  </Text>
                )}
              </>
            )}
          </View>
        </View>
        {onOpenScreen && (
          <ToolbarButton
            icon="Maximize2"
            accessibilityLabel={t("panel.fullScreen")}
            onPress={() => onOpenScreen(canvasId)}
          />
        )}
        <ToolbarButton
          icon="Info"
          label={t("panel.details")}
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
            <ToolbarButton
              icon="Pencil"
              label={t("panel.edit")}
              disabled={busy || canvas.editState.status === "locked"}
              onPress={onEdit}
            />
            <ToolbarButton
              icon="Trash2"
              label={t("panel.delete")}
              disabled={busy || canvas.editState.status === "locked"}
              onPress={() => onDelete(canvas)}
            />
            <ToolbarButton
              icon="Copy"
              label={t("panel.copy")}
              accessibilityLabel={t("panel.copyContent")}
              onPress={async () => {
                try {
                  await copyText(canvas.content);
                  toast.show(t("panel.copied"));
                } catch {
                  toast.error(t("panel.copyFailed"));
                }
              }}
            />
            <View
              style={{
                marginLeft: "auto",
                width: 260,
                maxWidth: "100%",
                minWidth: 0,
              }}
            >
              <Tabs
                tabs={[
                  { id: "preview", label: t("panel.preview"), icon: "Eye" },
                  { id: "source", label: t("panel.code"), icon: "Code" },
                ]}
                activeTab={mode}
                onTabChange={(id) => setMode(id as "preview" | "source")}
                style={{ borderRadius: 6 }}
              />
            </View>
          </>
        ) : null}
      </View>
      {missing ? (
        <CenteredText theme={theme}>{t("panel.deleted")}</CenteredText>
      ) : (
        <>
          {detailError && (
            <ReadError
              theme={theme}
              error={detailError}
              stale={!!canvas}
              subject={t("panel.loadContentFailed")}
            />
          )}
          {detail.isLoading && !detailError && (
            <CenteredText theme={theme}>{t("common.loading")}</CenteredText>
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
  const { compact: isCompact } = useCanvasTheme();
  const { t } = useText();
  const fields: [string, string | number][] = [
    [t("details.title"), canvas.title],
    [t("details.canvasId"), canvas.canvasId],
    [t("details.revision"), canvas.revision],
    [t("details.updatedBy"), editorName(t, canvas.updatedBy)],
  ];
  if (canvas.editState.status === "locked") {
    const lock = canvas.editState.lock;
    fields.push(
      [t("details.editor"), editorName(t, lock.owner, lock.ownerTitle)],
      [t("details.acquired"), lock.acquiredAt],
      [t("details.renewed"), lock.renewedAt],
      [t("details.expires"), lock.expiresAt],
    );
  }
  return (
    <Modal
      title={t("details.heading")}
      open={open}
      onOpenChange={onOpenChange}
    >
      <Modal.Content>
        {fields.map(([label, value]) => (
          <KeyValue
            key={label}
            label={label}
            value={value}
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
  /** The translated failure headline. */
  subject: string;
}) {
  const { t } = useText();
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
        {subject}
      </Text>
      <Text style={{ ...metaText, color: theme.colors.foregroundMuted }}>
        {stale ? t("panel.retryingStale") : t("panel.retrying")}
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
