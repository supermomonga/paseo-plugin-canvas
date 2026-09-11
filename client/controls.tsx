import { Button, usePluginTheme, type ButtonProps } from "paseo-plugin-helper/client";
import { Icon } from "@getpaseo/plugin/client/react-native";

// The same outer box is used for every toolbar action and the view-mode tabs.
// Explicit line boxes avoid platform font padding changing their alignment.
export const CONTROL_HEIGHT = 44;
export const HEADER_HEIGHT = 64;
export const titleText = {
  fontSize: 14,
  lineHeight: 20,
  fontWeight: "500",
  includeFontPadding: false,
} as const;
export const metaText = {
  fontSize: 12,
  lineHeight: 16,
  fontWeight: "400",
  includeFontPadding: false,
} as const;

export function ToolbarButton({
  icon,
  label,
  accessibilityLabel,
  ...props
}: Omit<ButtonProps, "variant" | "size" | "textStyle" | "icon"> & { icon: string }) {
  const { colors } = usePluginTheme();
  return (
    <Button
      {...props}
      label={label}
      accessibilityLabel={accessibilityLabel ?? label}
      icon={<Icon name={icon} size={16} color={colors.foreground} />}
      variant="secondary"
      size="sm"
      style={[
        {
          height: CONTROL_HEIGHT,
          minHeight: CONTROL_HEIGHT,
          paddingVertical: 0,
          paddingHorizontal: label ? 12 : 0,
          width: label ? undefined : CONTROL_HEIGHT,
          borderRadius: 6,
        },
        props.style,
      ]}
      textStyle={{ ...metaText, color: colors.foreground }}
    />
  );
}
