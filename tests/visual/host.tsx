// Browser-only stand-ins for the SDK's host primitives. Product code always
// receives the actual Paseo icons, adaptive modal and toast implementations.
import React, { useEffect, useState } from "react";
import {
  Eye,
  PanelLeft,
  PanelRight,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  ZoomIn,
  ZoomOut,
  Scan,
  Maximize2,
  ArrowLeft,
  Lightbulb,
  MessageSquareWarning,
  TriangleAlert,
  OctagonAlert,
  ChevronDown,
  Code,
  ChevronRight,
  NotebookPen,
  FileText,
  Copy,
  Info,
  RefreshCw,
  Sun,
  Moon,
  X,
} from "lucide-react-native";
import { usePluginTheme } from "paseo-plugin-helper/client";
import {
  Modal as NativeModal,
  ScrollView,
  Text,
  View,
  Pressable,
} from "react-native";
import type {
  ModalProps,
  ModalContentProps,
  ToastApi,
} from "@getpaseo/plugin/client/react-native";
import type { PluginIconProps } from "@getpaseo/plugin/client";
export { ScrollView };
const icons = {
  Eye,
  PanelLeft,
  PanelRight,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  ZoomIn,
  ZoomOut,
  Scan,
  Maximize2,
  ArrowLeft,
  Lightbulb,
  MessageSquareWarning,
  TriangleAlert,
  OctagonAlert,
  ChevronDown,
  Code,
  ChevronRight,
  NotebookPen,
  FileText,
  Copy,
  Info,
  RefreshCw,
  Sun,
  Moon,
  X,
};
export function Icon({ name, size, color }: PluginIconProps) {
  const Component = icons[name as keyof typeof icons];
  if (!Component) throw new Error(`Missing fixture icon: ${name}`);
  return <Component size={size} color={color} />;
}
export const Modal = Object.assign(
  function FixtureModal({ open, onOpenChange, title, children }: ModalProps) {
    const { colors } = usePluginTheme();
    return (
      <NativeModal
        visible={open}
        transparent
        onRequestClose={() => onOpenChange(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "#0008",
            justifyContent: "center",
            alignItems: "center",
            padding: 16,
          }}
        >
          <View
            style={{
              backgroundColor: colors.surface0,
              width: "100%",
              maxWidth: 480,
              maxHeight: "90%",
              borderRadius: 8,
            }}
          >
            <View
              style={{
                padding: 16,
                flexDirection: "row",
                justifyContent: "space-between",
              }}
            >
              <Text
                style={{
                  color: colors.foreground,
                  fontSize: 14,
                  lineHeight: 20,
                }}
              >
                {title}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => onOpenChange(false)}
              >
                <Text
                  style={{
                    color: colors.foreground,
                    padding: 8,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 6,
                  }}
                >
                  Close
                </Text>
              </Pressable>
            </View>
            {children}
          </View>
        </View>
      </NativeModal>
    );
  },
  {
    Content: ({
      children,
      style,
      contentContainerStyle,
    }: ModalContentProps) => (
      <ScrollView
        style={style}
        contentContainerStyle={[
          { padding: 24, gap: 16 },
          contentContainerStyle,
        ]}
      >
        {children}
      </ScrollView>
    ),
  },
);
let notify: ((message: string) => void) | undefined;
const toast: ToastApi = {
  show: (message) => notify?.(message),
  error: (message) => notify?.(message),
};
export const useToast = () => toast;
export const copyText = async (_text: string) => {};
export function FixtureToast() {
  const [message, setMessage] = useState("");
  useEffect(() => {
    notify = setMessage;
    return () => {
      notify = undefined;
    };
  }, []);
  return message ? (
    <Text
      accessibilityRole="alert"
      style={{
        position: "absolute",
        bottom: 16,
        alignSelf: "center",
        padding: 12,
        color: "#fff",
        backgroundColor: "#222",
        borderRadius: 8,
      }}
    >
      {message}
    </Text>
  ) : null;
}
