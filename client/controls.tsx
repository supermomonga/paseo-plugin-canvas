import { Button, type ButtonProps } from "paseo-plugin-helper/client";

// Keep text baselines explicit; let helper size the controls.
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
  size = "sm",
  ...props
}: Omit<ButtonProps, "variant" | "textStyle" | "icon"> & { icon: string }) {
  return (
    <Button
      {...props}
      label={label}
      accessibilityLabel={accessibilityLabel ?? label}
      icon={icon}
      variant="secondary"
      size={size}
      style={props.style}
      textStyle={{
        lineHeight: metaText.lineHeight,
        fontWeight: metaText.fontWeight,
        includeFontPadding: metaText.includeFontPadding,
      }}
    />
  );
}
