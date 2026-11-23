import { Text, View } from "react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { PluginThemeProvider } from "paseo-plugin-helper/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import type { CanvasActivity } from "../shared/activity";
import { ToolbarButton, titleText, metaText } from "./controls";
import { useText } from "./i18n";

export function CanvasActivityRow({
  item,
  theme,
  layout,
  onOpen,
}: PluginTimelineItemProps<CanvasActivity> & {
  onOpen: (activity: CanvasActivity) => void;
}) {
  const toast = useToast();
  const { t } = useText();
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
                ? t("activity.created", { revision: activity.revision })
                : t("activity.updated", { revision: activity.revision })}
            </Text>
            {activity.warningCount > 0 && (
              <Text style={{ ...metaText, color: theme.colors.statusWarning }}>
                {t("activity.warnings", { count: activity.warningCount })}
              </Text>
            )}
          </View>
          <ToolbarButton
            icon="NotebookPen"
            label={t("activity.open")}
            accessibilityLabel={t("activity.openLabel", {
              title: activity.title,
            })}
            onPress={() => {
              try {
                onOpen(activity);
              } catch {
                toast.error(t("activity.openFailed"));
              }
            }}
          />
        </View>
      </View>
    </PluginThemeProvider>
  );
}
