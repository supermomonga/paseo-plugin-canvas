// Listing screenshot page (ADR 20): the visual-test fixtures without the
// preview toolbar. `?view=activity` shows timeline rows instead of the panel.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { View } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CanvasThemeProvider } from "../../client/ui";
import { FixtureToast } from "../../tests/visual/host";
import { CanvasPanel } from "../../client/panel";
import { CanvasActivityRow } from "../../client/activity";
import { createCanvasSelection } from "../../client/selection";

declare const window: { location: { search: string } };
declare const document: {
  getElementById(id: string): any;
  documentElement: { style: { colorScheme: string } };
};

const params = new URLSearchParams(window.location.search);
const darkMode = params.get("theme") !== "light";
const view = params.get("view") ?? "panel";
const queryClient = new QueryClient();

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
const colors = darkMode ? dark : light;
const layout = { compact: false, platform: "web" as const };

function Page() {
  const [selection] = useState(() => {
    const value = createCanvasSelection();
    const canvasId = params.get("canvas");
    if (canvasId) value.restore("test", canvasId);
    return value;
  });
  useEffect(() => {
    document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
  }, []);
  if (view === "activity")
    return (
      <View style={{ padding: 16, gap: 12, backgroundColor: colors.surface0 }}>
        {(["created", "updated"] as const).map((action, index) => (
          <View key={action} testID={`activity-${action}`}>
            <CanvasActivityRow
              agentId="agent-a"
              timestamp={new Date()}
              host={{ id: "test", label: "Test" }}
              layout={layout}
              theme={{ colors }}
              item={{
                type: "plugin",
                kind: "canvas-activity",
                version: 1,
                data: {
                  workspaceId: "test",
                  canvasId: "example-canvas",
                  title: params.get("title") ?? "Search indexing plan",
                  revision: index === 0 ? 1 : 2,
                  action,
                  warningCount: 0,
                  savedAt: "2026-11-24T09:00:00Z",
                },
              }}
              onOpen={() => {}}
            />
          </View>
        ))}
      </View>
    );
  return (
    <View style={{ height: "100%", flex: 1 }}>
      <CanvasPanel
        selection={selection}
        workspaceId="test"
        host={{ id: "test", label: "Test" }}
        layout={layout}
        theme={{ colors }}
      />
      <FixtureToast />
    </View>
  );
}

createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={queryClient}>
    <CanvasThemeProvider theme={{ colors }} layout={layout}>
      <Page />
    </CanvasThemeProvider>
  </QueryClientProvider>,
);
