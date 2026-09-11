import { AppState, Text, View } from "react-native";
import type {
  PluginClientContext,
  PluginTimelineItemProps,
} from "@getpaseo/plugin/client";
import { PluginThemeProvider } from "paseo-plugin-helper/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { syncCanvasActivity, type CanvasActivity } from "../shared/activity";
import { ToolbarButton, titleText, metaText } from "./controls";

export function CanvasActivityRow({
  item,
  theme,
  layout,
  onOpen,
}: PluginTimelineItemProps<CanvasActivity> & {
  onOpen: (activity: CanvasActivity) => void;
}) {
  const toast = useToast();
  const activity = item.data;
  return (
    <PluginThemeProvider theme={theme} layout={layout}>
      <View
        style={{
          padding: 12,
          gap: 8,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 8,
        }}
      >
        <Text style={{ ...titleText, color: theme.colors.foreground }}>
          {activity.title}
        </Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <View style={{ flex: 1, minWidth: 120, gap: 4 }}>
            <Text style={{ ...metaText, color: theme.colors.foregroundMuted }}>
              {activity.action === "created"
                ? "Canvas created"
                : "Canvas updated"}{" "}
              · Revision {activity.revision}
            </Text>
            {activity.warningCount > 0 && (
              <Text style={{ ...metaText, color: theme.colors.statusWarning }}>
                Mermaid rendering warnings: {activity.warningCount}
              </Text>
            )}
          </View>
          <ToolbarButton
            icon="NotebookPen"
            label="Open canvas"
            accessibilityLabel={`Open canvas: ${activity.title}`}
            onPress={() => {
              try {
                onOpen(activity);
              } catch {
                toast.error("Unable to open canvas");
              }
            }}
          />
        </View>
      </View>
    </PluginThemeProvider>
  );
}

/** Runs while the installation is loaded, independently of the Canvas panel. */
export function startActivitySync(client: Pick<PluginClientContext, "rpc">) {
  let stopped = false;
  let running = false;
  let cursor: string | null = null;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active =
    AppState.currentState !== "background" &&
    AppState.currentState !== "inactive";
  function schedule(delay: number) {
    clearTimeout(timer);
    if (!stopped && active) timer = setTimeout(() => void tick(), delay);
  }
  async function tick() {
    if (stopped || !active || running) return;
    running = true;
    let delay = 0;
    try {
      const result = await client.rpc(syncCanvasActivity, { cursor });
      cursor = result.cursor;
      failures = 0;
    } catch (error) {
      if (!stopped)
        console.warn(
          "[paseo-canvas] Timeline delivery interrupted; retrying",
          error,
        );
      delay = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
    } finally {
      running = false;
      schedule(delay);
    }
  }
  const subscription = AppState.addEventListener("change", (state) => {
    active = state === "active";
    if (active) schedule(0);
    else clearTimeout(timer);
  });
  schedule(0);
  return () => {
    stopped = true;
    clearTimeout(timer);
    subscription.remove();
  };
}
