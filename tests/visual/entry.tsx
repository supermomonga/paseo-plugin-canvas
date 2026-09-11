import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { View, Text, Pressable, useWindowDimensions } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  initClientHelpers,
  PluginThemeProvider,
  Button,
} from "paseo-plugin-helper/client";
import { ScrollView } from "react-native";
import { Icon, Modal, useToast, FixtureToast } from "./host";

initClientHelpers({
  Icon,
  Modal,
  useRpc: (contract) =>
    useCallback(
      async (input) => {
        const response = await fetch(`/rpc/${contract.name}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        return data;
      },
      [contract],
    ),
  useToast,
  ScrollView: React.forwardRef<
    ScrollView,
    React.ComponentProps<typeof ScrollView>
  >((props, ref) => <ScrollView {...props} ref={ref} />),
});
const queryClient = new QueryClient();
import { CanvasPanel } from "../../client/panel";
import { CanvasActivityRow } from "../../client/activity";
import { createCanvasSelection } from "../../client/selection";
const light = {
  surface0: "#ffffff",
  surface1: "#fafafa",
  surface2: "#f4f4f5",
  border: "#e4e4e7",
  foreground: "#1a1a1e",
  foregroundMuted: "#71717a",
  accent: "#20744A",
  accentForeground: "#fff",
  statusSuccess: "#227744",
  statusWarning: "#885700",
  statusDanger: "#b42318",
};
const dark = {
  surface0: "#181B1A",
  surface1: "#1E2120",
  surface2: "#272A29",
  border: "#252B2A",
  foreground: "#fafafa",
  foregroundMuted: "#A1A5A4",
  accent: "#20744A",
  accentForeground: "#181B1A",
  statusSuccess: "#91d5a3",
  statusWarning: "#ecc186",
  statusDanger: "#f5a3a3",
};
function Preview() {
  const [darkMode, setDarkMode] = useState(true);
  const [timeline, setTimeline] = useState(false);
  const [selection] = useState(createCanvasSelection);
  const { width } = useWindowDimensions();
  useEffect(() => {
    document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
  }, [darkMode]);
  return (
    <PluginThemeProvider
      theme={{ colors: darkMode ? dark : light }}
      layout={{ compact: width < 500, platform: "web" }}
    >
      <View style={{ height: "100%", flex: 1 }}>
        <View
          style={{
            height: 48,
            paddingHorizontal: 12,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: darkMode ? dark.surface1 : light.surface1,
          }}
        >
          <Text
            style={{
              color: darkMode ? dark.foregroundMuted : light.foregroundMuted,
              fontSize: 12,
            }}
          >
            Canvas · UI preview
          </Text>
          <Button
            size="sm"
            variant="secondary"
            label={timeline ? "Canvas" : "Timeline"}
            onPress={() => setTimeline((value) => !value)}
          />
          <Button
            variant="secondary"
            size="sm"
            icon={darkMode ? "Sun" : "Moon"}
            label={darkMode ? "Light" : "Dark"}
            accessibilityLabel="Toggle theme"
            onPress={() => setDarkMode((value) => !value)}
          />
        </View>
        {timeline ? (
          <View
            style={{
              flex: 1,
              padding: 16,
              backgroundColor: darkMode ? dark.surface0 : light.surface0,
            }}
          >
            <CanvasActivityRow
              agentId="agent-a"
              timestamp={new Date()}
              host={{ id: "test", label: "Test" }}
              layout={{ compact: width < 500, platform: "web" }}
              theme={{ colors: darkMode ? dark : light }}
              item={{
                type: "plugin",
                kind: "canvas-activity",
                version: 1,
                data: {
                  workspaceId: "test",
                  canvasId: "example-canvas",
                  title: "Implementation plan",
                  revision: 3,
                  action: "updated",
                  warningCount: 2,
                  savedAt: "2026-09-12T00:00:00Z",
                },
              }}
              onOpen={(activity) => {
                selection.select(activity.workspaceId, activity.canvasId);
                setTimeline(false);
              }}
            />
          </View>
        ) : (
          <CanvasPanel
            selection={selection}
            context="workspace"
            workspaceId="test"
            host={{ id: "test", label: "Test" }}
            layout={{ compact: width < 500, platform: "web" }}
            theme={{ colors: darkMode ? dark : light }}
          />
        )}
        <FixtureToast />
      </View>
    </PluginThemeProvider>
  );
}
// Visual-test browser entry only; this file is never reachable from a plugin entry.
declare function fetch(
  url: string,
  options: unknown,
): Promise<{ ok: boolean; json(): Promise<any> }>;
declare const document: {
  getElementById(id: string): any;
  documentElement: { style: { colorScheme: string } };
};
createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={queryClient}>
    <Preview />
  </QueryClientProvider>,
);
