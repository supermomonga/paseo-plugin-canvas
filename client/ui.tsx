import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginHostProps } from "@getpaseo/plugin/client";

/*
 * Canvas's own controls (ADR 19). The SDK has no buttons, tabs, badges, code
 * blocks or empty states, so these compose public React Native views with the
 * host theme and icons. Sizes follow the controls Canvas used before.
 */

type Colors = PluginTheme["colors"];
type Layout = PluginHostProps["layout"];

interface CanvasThemeValue {
  colors: Colors;
  compact: boolean;
  /** Minimum touch target; larger on phones and compact panes. */
  touchTarget: number;
}

// Only reached by a control rendered outside every Canvas surface.
const fallback: CanvasThemeValue = {
  colors: {
    surface0: "#18181b",
    surface1: "#27272a",
    surface2: "#3f3f46",
    border: "#3f3f46",
    foreground: "#fafafa",
    foregroundMuted: "#a1a1aa",
    accent: "#3b82f6",
    accentForeground: "#ffffff",
    statusSuccess: "#22c55e",
    statusWarning: "#eab308",
    statusDanger: "#ef4444",
  },
  compact: false,
  touchTarget: 28,
};
const CanvasThemeContext = createContext<CanvasThemeValue>(fallback);

export function CanvasThemeProvider({
  theme,
  layout = { compact: false, platform: "web" },
  children,
}: {
  theme: PluginTheme;
  layout?: Layout;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      colors: theme.colors,
      compact: layout.compact,
      touchTarget:
        layout.compact ||
        layout.platform === "ios" ||
        layout.platform === "android"
          ? 44
          : 28,
    }),
    [theme, layout.compact, layout.platform],
  );
  return (
    <CanvasThemeContext.Provider value={value}>
      {children}
    </CanvasThemeContext.Provider>
  );
}

export function useCanvasTheme() {
  return useContext(CanvasThemeContext);
}

/** Applies an opacity to a hex or rgb() color; other forms pass unchanged. */
export function alpha(color: string, opacity: number) {
  const value = Math.max(0, Math.min(1, opacity));
  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length === 3 || hex.length === 4)
      hex = [...hex.slice(0, 3)].map((c) => c + c).join("");
    hex = hex.slice(0, 6);
    return `#${hex}${Math.round(value * 255)
      .toString(16)
      .padStart(2, "0")}`;
  }
  const parts = color.startsWith("rgb")
    ? color.replace(/[^\d,.]/g, "").split(",")
    : [];
  return parts.length >= 3
    ? `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${value})`
    : color;
}

export const monospace = Platform.OS === "ios" ? "Menlo" : "monospace";

export interface ButtonProps {
  label?: string;
  /** A Lucide icon name. */
  icon?: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function Button({
  label,
  icon,
  variant = "secondary",
  size = "md",
  onPress,
  disabled = false,
  accessibilityLabel,
  style,
  textStyle,
}: ButtonProps) {
  const { colors, compact, touchTarget } = useCanvasTheme();
  const small = size === "sm";
  const primary = variant === "primary";
  const background = primary ? colors.accent : colors.surface1;
  const color = primary ? colors.accentForeground : colors.foreground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      hitSlop={Math.max(0, (touchTarget - 32) / 2)}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          backgroundColor:
            pressed && !disabled ? alpha(background, 0.8) : background,
          borderColor: colors.border,
          borderWidth: primary ? 0 : 1,
          borderRadius: small ? 6 : 8,
          paddingVertical: small ? (compact ? 5 : 6) : compact ? 8 : 10,
          paddingHorizontal: small ? (compact ? 8 : 10) : compact ? 12 : 14,
          minHeight: Math.max(30, touchTarget - 4),
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      {icon && <Icon name={icon} size={small ? 12 : 14} color={color} />}
      {label ? (
        <Text
          style={[
            {
              color,
              fontSize: small ? 12 : 13,
              fontWeight: "600",
              textAlign: "center",
            },
            textStyle,
          ]}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Read-only code with an optional language caption. */
export function CodeBlock({
  code,
  language,
  textStyle,
}: {
  code: string;
  language?: string;
  textStyle?: StyleProp<TextStyle>;
}) {
  const { colors, compact } = useCanvasTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface0,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {language ? (
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderBottomWidth: 1,
            borderBottomColor: alpha(colors.border, 0.7),
          }}
        >
          <Text
            style={{
              color: colors.foregroundMuted,
              fontSize: 10,
              fontWeight: "700",
              letterSpacing: 0.5,
            }}
          >
            {language.toUpperCase()}
          </Text>
        </View>
      ) : null}
      <ScrollView
        nestedScrollEnabled
        style={{ maxHeight: 320 }}
        contentContainerStyle={{ padding: 10 }}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <Text
            selectable
            style={[
              {
                color: colors.foreground,
                fontFamily: monospace,
                fontSize: compact ? 11 : 12,
                lineHeight: 18,
              },
              textStyle,
            ]}
          >
            {code}
          </Text>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

export interface TabItem {
  id: string;
  label: string;
  /** A Lucide icon name. */
  icon?: string;
}

/** A segmented control whose tabs share the available width. */
export function Tabs({
  tabs,
  activeTab,
  onTabChange,
  style,
}: {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, compact, touchTarget } = useCanvasTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        {
          width: "100%",
          flexDirection: "row",
          alignItems: "center",
          padding: 3,
          gap: 2,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 6,
          backgroundColor: colors.surface1,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        const color = active ? colors.foreground : colors.foregroundMuted;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onTabChange(tab.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              borderRadius: 4,
              minHeight: Math.max(30, touchTarget - 8),
              paddingHorizontal: compact ? 6 : 12,
              paddingVertical: compact ? 5 : 7,
              backgroundColor: active
                ? colors.surface2
                : pressed
                  ? alpha(colors.surface2, 0.5)
                  : "transparent",
            })}
          >
            {tab.icon && (
              <Icon name={tab.icon} size={compact ? 11 : 13} color={color} />
            )}
            <Text
              numberOfLines={1}
              style={{
                color,
                fontSize: compact ? 11 : 12,
                fontWeight: active ? "600" : "500",
                textAlign: "center",
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A small outlined status label. */
export function Badge({
  label,
  style,
  textStyle,
}: {
  label: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const { colors } = useCanvasTheme();
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          borderWidth: 1,
          borderRadius: 9999,
          borderColor: colors.border,
          paddingVertical: 1,
          paddingHorizontal: 6,
        },
        style,
      ]}
    >
      <Text
        style={[
          { color: colors.foregroundMuted, fontSize: 11, fontWeight: "600" },
          textStyle,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

/** A label and its value: one row, or stacked in compact panes. */
export function KeyValue({
  label,
  value,
  style,
  labelStyle,
  valueStyle,
}: {
  label: string;
  value: string | number;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  valueStyle?: StyleProp<TextStyle>;
}) {
  const { colors, compact } = useCanvasTheme();
  return (
    <View
      style={[
        compact
          ? { flexDirection: "column", gap: 3, width: "100%" }
          : {
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            },
        { paddingVertical: 5 },
        style,
      ]}
    >
      <Text
        style={[
          {
            color: colors.foregroundMuted,
            fontSize: compact ? 11 : 12,
            fontWeight: "500",
          },
          labelStyle,
        ]}
      >
        {label}
      </Text>
      <Text
        selectable
        style={[
          {
            color: colors.foreground,
            fontSize: 13,
            fontWeight: "600",
            flexShrink: 1,
          },
          valueStyle,
        ]}
      >
        {String(value)}
      </Text>
    </View>
  );
}

/** A centered title and hint for an empty list. */
export function EmptyState({
  title,
  description,
  style,
}: {
  title: string;
  description?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, compact } = useCanvasTheme();
  return (
    <View
      style={[
        {
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: compact ? 20 : 32,
        },
        style,
      ]}
    >
      <Text
        style={{
          color: colors.foreground,
          fontSize: compact ? 14 : 16,
          fontWeight: "600",
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      {description ? (
        <Text
          style={{
            color: colors.foregroundMuted,
            fontSize: compact ? 12 : 13,
            lineHeight: 18,
            textAlign: "center",
            maxWidth: 280,
          }}
        >
          {description}
        </Text>
      ) : null}
    </View>
  );
}
