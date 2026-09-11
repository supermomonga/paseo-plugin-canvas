import { useState, type ReactNode } from "react";
import { Modal, SafeAreaView, Text, View } from "react-native";
import { Button } from "paseo-plugin-helper/client";
import type { PluginTheme } from "@getpaseo/plugin";
import type { Size } from "../../shared/mermaid/viewport";

/** SDK Modal fixes the desktop width; this viewer needs the entire window. */
export function MermaidPopup({
  title,
  theme,
  onClose,
  children,
}: {
  title: string;
  theme: PluginTheme;
  onClose: () => void;
  children: (size: Size) => ReactNode;
}) {
  const [size, setSize] = useState<Size | null>(null);
  return (
    <Modal
      visible
      transparent
      presentationStyle="overFullScreen"
      statusBarTranslucent={false}
      navigationBarTranslucent={false}
      supportedOrientations={[
        "portrait",
        "portrait-upside-down",
        "landscape",
        "landscape-left",
        "landscape-right",
      ]}
      onRequestClose={onClose}
    >
      {/* iOS/web insets come from SafeAreaView. Android Modal keeps system bars outside its content. */}
      <SafeAreaView style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }}>
        <View
          testID="mermaid-popup"
          accessibilityViewIsModal
          style={{
            flex: 1,
            minHeight: 0,
            margin: 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 8,
            overflow: "hidden",
            backgroundColor: theme.colors.surface0,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              padding: 12,
              borderBottomWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Text
              accessibilityRole="header"
              style={{
                flex: 1,
                minWidth: 0,
                color: theme.colors.foreground,
                fontSize: 14,
                lineHeight: 20,
                fontWeight: "500",
              }}
            >
              {title}
            </Text>
            <Button label="Close" icon="X" size="sm" onPress={onClose} />
          </View>
          <View
            testID="mermaid-popup-body"
            style={{ flex: 1, minHeight: 0 }}
            onLayout={(event) => {
              const { width, height } = event.nativeEvent.layout;
              if (width > 0 && height > 0) setSize({ width, height });
            }}
          >
            {size && children(size)}
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
