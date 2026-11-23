import type { ReactNode } from "react";
import { Text, View } from "react-native";
import type { ZodType } from "zod";
import {
  useSettings,
  type PluginSurfaceProps,
  type SettingsState,
} from "@getpaseo/plugin/client";
import {
  ExternalLink,
  SettingsAction,
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import {
  canvasDeviceSettings,
  canvasSettings,
  type CanvasDeviceSettings,
  type CanvasSettings,
} from "../shared/settings";
import { useText } from "./i18n";
import { metaText } from "./controls";

export const SETTINGS_SCREEN = "canvas";
const DOCUMENTATION =
  "https://github.com/supermomonga/paseo-plugin-canvas#readme";
type Ready<Schema extends ZodType> = Extract<
  SettingsState<Schema>,
  { status: "ready" }
>;

export function CanvasSettingsScreen({ theme }: PluginSurfaceProps) {
  const { t } = useText();
  const host = useSettings(canvasSettings);
  const device = useSettings(canvasDeviceSettings);
  return (
    <View style={{ gap: 24 }}>
      <SettingsDocument
        settings={host}
        title={t("settings.timeline.title")}
        scope={t("settings.hostScope")}
        theme={theme}
      >
        {(ready) => <HostControls settings={ready} />}
      </SettingsDocument>
      <SettingsDocument
        settings={device}
        title={t("settings.links.title")}
        scope={t("settings.deviceScope")}
        theme={theme}
      >
        {(ready) => <DeviceControls settings={ready} />}
      </SettingsDocument>
      <ExternalLink href={DOCUMENTATION}>
        {t("settings.documentation")}
      </ExternalLink>
    </View>
  );
}

/** One settings document with its own loading and recovery states. */
function SettingsDocument<Schema extends ZodType>({
  settings,
  title,
  scope,
  theme,
  children,
}: {
  settings: SettingsState<Schema>;
  title: string;
  scope: string;
  theme: PluginSurfaceProps["theme"];
  children: (settings: Ready<Schema>) => ReactNode;
}) {
  const { t } = useText();
  const colors = theme.colors;
  return (
    <View style={{ gap: 8 }}>
      {settings.status === "loading" ? (
        <SettingsSection title={title}>
          <Text style={{ ...metaText, color: colors.foregroundMuted }}>
            {t("common.loading")}
          </Text>
        </SettingsSection>
      ) : settings.status === "ready" ? (
        <SettingsSection title={title}>
          <SettingsCard>{children(settings)}</SettingsCard>
        </SettingsSection>
      ) : (
        <SettingsSection title={title}>
          <SettingsCard>
            <SettingsAction
              label={t("settings.unavailable")}
              hint={settings.error}
              actionLabel={
                settings.status === "invalid"
                  ? t("settings.reset")
                  : t("common.retry")
              }
              disabled={settings.saving}
              error={settings.saveError}
              onPress={() =>
                void (settings.status === "invalid"
                  ? settings.reset()
                  : settings.reload())
              }
            />
          </SettingsCard>
        </SettingsSection>
      )}
      <Text style={{ ...metaText, color: colors.foregroundMuted }}>
        {scope}
      </Text>
    </View>
  );
}

function HostControls({
  settings,
}: {
  settings: Ready<typeof canvasSettings.schema>;
}) {
  const { t } = useText();
  // Each control saves immediately against the revision it displays.
  const save = (change: Partial<CanvasSettings>) =>
    void settings.save({ ...settings.values, ...change }, settings.revision);
  return (
    <SettingsSwitch
      label={t("settings.timeline.notifications")}
      hint={t("settings.timeline.notificationsHint")}
      value={settings.values.timelineNotifications}
      disabled={settings.saving}
      error={settings.saveError}
      onValueChange={(timelineNotifications) =>
        save({ timelineNotifications })
      }
    />
  );
}

function DeviceControls({
  settings,
}: {
  settings: Ready<typeof canvasDeviceSettings.schema>;
}) {
  const { t } = useText();
  const save = (change: Partial<CanvasDeviceSettings>) =>
    void settings.save({ ...settings.values, ...change }, settings.revision);
  return (
    <SettingsSelect
      label={t("settings.links.openIn")}
      hint={t("settings.links.openInHint")}
      value={settings.values.openLinksIn}
      options={[
        {
          label: t("settings.links.workspaceBrowser"),
          value: "workspace-browser",
        },
        { label: t("settings.links.systemBrowser"), value: "system" },
      ]}
      disabled={settings.saving}
      error={settings.saveError}
      onValueChange={(openLinksIn) => save({ openLinksIn })}
    />
  );
}
