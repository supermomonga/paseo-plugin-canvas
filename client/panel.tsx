import { useState, useRef } from "react";
import { Platform, Pressable, Text, View } from "react-native";
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
  getCanvas,
  listCanvases,
  type Canvas,
  type EditState,
} from "../shared/contracts";
import { Markdown } from "./markdown";
import {
  CONTROL_HEIGHT,
  HEADER_HEIGHT,
  ToolbarButton,
  titleText,
  metaText,
} from "./controls";

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
const readingWidth = 820;

function lockLabel(state: EditState) {
  return state.status === "locked"
    ? `${state.lock.ownerAgentTitle ?? state.lock.ownerAgentId} が編集中`
    : "編集ロックなし";
}

export function CanvasPanel(props: PluginWorkspacePanelProps) {
  const [width, setWidth] = useState<number | null>(null);
  // A split workspace pane can be narrower than the host's form factor. Keep
  // the canonical 320 + 400 list/detail topology only where it actually fits.
  const singlePane =
    props.layout.compact ||
    (width !== null && width < sidebarWidth + detailMinWidth);
  return (
    <View
      style={{ flex: 1, minWidth: 0, minHeight: 0 }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <PluginThemeProvider
        theme={props.theme}
        layout={{ ...props.layout, compact: singlePane }}
      >
        <WorkspaceCanvas
          key={props.workspaceId}
          {...props}
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
}: PluginWorkspacePanelProps & { singlePane: boolean }) {
  const colors = theme.colors;
  const [selected, setSelected] = useState<string | null>(null);
  const list = useRpcQuery(
    listCanvases,
    { workspaceId },
    { refetchInterval: 2000, retry: false },
  );
  const canvasId =
    selected ?? (!singlePane ? (list.data?.items[0]?.canvasId ?? null) : null);
  const selectionMissing =
    selected !== null &&
    !!list.data &&
    !list.data.items.some((item) => item.canvasId === selected);
  const showList = !singlePane || selected === null;
  const showDetail = !singlePane || selected !== null;
  return (
    <View
      style={{
        flex: 1,
        minHeight: 0,
        flexDirection: "row",
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
                  borderRightWidth: 1,
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
            <Icon name="NotebookPen" size={20} color={colors.foregroundMuted} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text
                accessibilityRole="header"
                style={{ ...titleText, color: colors.foreground }}
              >
                Canvas一覧
              </Text>
              <View style={{ height: 20, justifyContent: "center" }}>
                <Text style={{ ...metaText, color: colors.foregroundMuted }}>
                  {list.data
                    ? `${list.data.items.length}件のCanvas`
                    : "読み込み中..."}
                </Text>
              </View>
            </View>
            <RefreshButton
              accessibilityLabel="一覧を再取得"
              onRefresh={() => list.refetch()}
            />
          </View>
          {list.error && (
            <ReadError
              theme={theme}
              error={list.error}
              stale={!!list.data}
              subject="一覧"
            />
          )}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1, padding: 8, gap: 4 }}
          >
            {list.isLoading && (
              <CenteredText theme={theme}>読み込み中...</CenteredText>
            )}
            {list.data?.items.length === 0 && (
              <EmptyState
                icon={null}
                title="Canvasはまだありません"
                description="エージェントに作成を依頼してください"
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
          {canvasId ? (
            <CanvasDetail
              key={canvasId}
              workspaceId={workspaceId}
              canvasId={canvasId}
              missing={selectionMissing}
              theme={theme}
              platform={layout.platform}
              singlePane={singlePane}
              onBack={() => setSelected(null)}
            />
          ) : (
            <CenteredText theme={theme}>Canvasを選択</CenteredText>
          )}
        </View>
      )}
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
      accessibilityLabel={`${title}を開く`}
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
  singlePane,
  onBack,
}: {
  workspaceId: string;
  canvasId: string;
  missing: boolean;
  theme: PluginTheme;
  platform: PluginWorkspacePanelProps["layout"]["platform"];
  singlePane: boolean;
  onBack: () => void;
}) {
  const colors = theme.colors;
  const toast = useToast();
  const scroll = useRef<import("react-native").ScrollView>(null);
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detail = useRpcQuery(
    getCanvas,
    { workspaceId, canvasId },
    { enabled: !missing, refetchInterval: 2000, retry: false },
  );
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
        {singlePane && (
          <ToolbarButton
            icon="ArrowLeft"
            accessibilityLabel="Canvas一覧に戻る"
            onPress={onBack}
          />
        )}
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
                      ? "編集中"
                      : "ロックなし"
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
                    {canvas.editState.lock.ownerAgentTitle ??
                      canvas.editState.lock.ownerAgentId}
                  </Text>
                )}
              </>
            )}
          </View>
        </View>
        <ToolbarButton
          icon="Info"
          label="詳細"
          disabled={!canvas}
          onPress={() => setDetailsOpen(true)}
        />
        <RefreshButton
          accessibilityLabel="本文を再取得"
          disabled={missing}
          onRefresh={() => detail.refetch()}
        />
      </View>
      <View
        style={{
          minHeight: HEADER_HEIGHT,
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
                  { id: "preview", label: "プレビュー" },
                  { id: "source", label: "コード" },
                ]}
                activeTab={mode}
                onTabChange={(id) => setMode(id as "preview" | "source")}
                mode="fit"
                style={{ height: CONTROL_HEIGHT, borderRadius: 6 }}
              />
            </View>
            <ToolbarButton
              icon="Copy"
              label="コピー"
              accessibilityLabel="本文をコピー"
              onPress={async () => {
                try {
                  await copyText(canvas.content);
                  toast.show("本文をコピーしました");
                } catch {
                  toast.error("本文をコピーできませんでした");
                }
              }}
            />
          </>
        ) : (
          <View style={{ height: CONTROL_HEIGHT }} />
        )}
      </View>
      {missing ? (
        <CenteredText theme={theme}>このCanvasは削除されました</CenteredText>
      ) : (
        <>
          {detail.error && (
            <ReadError
              theme={theme}
              error={detail.error}
              stale={!!canvas}
              subject="本文"
            />
          )}
          {detail.isLoading && (
            <CenteredText theme={theme}>読み込み中...</CenteredText>
          )}
          {canvas && (
            <ScrollView
              ref={scroll}
              key={mode}
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingTop: 16,
                paddingBottom: 24,
              }}
            >
              <View
                style={{
                  width: "100%",
                  maxWidth: mode === "preview" ? readingWidth : undefined,
                  alignSelf: "center",
                }}
              >
                {mode === "source" ? (
                  <Text
                    selectable
                    style={{
                      color: colors.foreground,
                      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                      fontSize: 12,
                      lineHeight: 22,
                    }}
                  >
                    {canvas.content}
                  </Text>
                ) : (
                  <Markdown
                    document={detail.data!.document}
                    workspaceId={workspaceId}
                    onNavigate={(offset) =>
                      scroll.current?.scrollTo({
                        y: offset + 16,
                        animated: true,
                      })
                    }
                    theme={theme}
                    contentFontSize={
                      platform === "ios" || platform === "android" ? 16 : 15
                    }
                    onError={toast.error}
                  />
                )}
              </View>
            </ScrollView>
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
    ["タイトル", canvas.title],
    ["Canvas ID", canvas.canvasId],
    ["リビジョン", canvas.revision],
  ];
  if (canvas.editState.status === "locked") {
    const lock = canvas.editState.lock;
    fields.push(
      ["編集中のエージェント", lock.ownerAgentTitle ?? lock.ownerAgentId],
      ["エージェントID", lock.ownerAgentId],
      ["ロック取得", lock.acquiredAt],
      ["最終延長", lock.renewedAt],
      ["有効期限", lock.expiresAt],
    );
  }
  return (
    <Modal title="Canvasの詳細" open={open} onOpenChange={onOpenChange}>
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

function RefreshButton({
  onRefresh,
  disabled = false,
  accessibilityLabel,
}: {
  onRefresh: () => Promise<unknown>;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  const [refreshing, setRefreshing] = useState(false);
  return (
    <ToolbarButton
      icon="RefreshCw"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      loading={refreshing}
      onPress={async () => {
        setRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
        }
      }}
    />
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
        {subject}を取得できませんでした
      </Text>
      <Text style={{ ...metaText, color: theme.colors.foregroundMuted }}>
        {stale
          ? "表示は最後に取得した内容です。再取得してください"
          : "再取得してください"}
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
