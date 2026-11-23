import React from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { beforeEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CanvasStore } from "../server/store";
import { Modal as SdkModal } from "@getpaseo/plugin/client/ui";
import { Linking } from "react-native";
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ setQueryData: () => {} }),
}));
vi.mock("../client/updates", () => ({ useCanvasUpdates: () => null }));
const reviewCalls = vi.hoisted(() =>
  vi.fn(async (_name: string, _input: unknown): Promise<unknown> => undefined),
);
const nativePlatform = vi.hoisted(() => ({ OS: "web" }));
const lifecycle = vi.hoisted(() => ({
  listener: undefined as ((state: string) => void) | undefined,
  remove: vi.fn(),
}));
const sdk = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  save: vi.fn(async (_values: unknown, _revision: string) => true),
  device: {} as Record<string, unknown>,
  saveDevice: vi.fn(async (_values: unknown, _revision: string) => true),
  openExternalUrl: vi.fn(async (_url: string) => {}),
  hosts: [] as { serverId: string; label: string; status: string }[],
  workspace: null as { name: string; title: string | null } | null,
}));
vi.mock("@getpaseo/plugin/client", async () => ({
  ...(await import("./support/i18n")).translationMocks,
  useTabState: (
    tab: { state: unknown; setState: (value: unknown) => void },
    schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown } },
    fallback: unknown,
  ) => {
    const parsed = schema.safeParse(tab.state);
    return [parsed.success ? parsed.data : fallback, tab.setState];
  },
  useSubscription: () => ({ status: "live" }),
  useRpc: (contract: { name: string }) => async (input: unknown) =>
    reviewCalls(contract.name, input),
  // Host and device documents are stored separately (ADR 18).
  useSettings: (definition: { scope: string }) => ({
    status: "ready",
    values: definition.scope === "device" ? sdk.device : sdk.settings,
    revision: definition.scope === "device" ? "device-1" : "revision-1",
    saving: false,
    saveError: null,
    save: definition.scope === "device" ? sdk.saveDevice : sdk.save,
    reset: async () => true,
    reload: async () => {},
  }),
  openExternalUrl: sdk.openExternalUrl,
  useHosts: () => sdk.hosts,
  useWorkspace: (
    _workspaceId: string,
    selector: (workspace: { name: string; title: string | null }) => unknown,
  ) => (sdk.workspace ? selector(sdk.workspace) : null),
}));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, listener: (state: string) => void) => {
      lifecycle.listener = listener;
      return { remove: lifecycle.remove };
    },
  },
  View: "View",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Keyboard: { addListener: () => ({ remove: () => {} }) },
  Modal: "NativeModal",
  SafeAreaView: "SafeAreaView",
  Image: Object.assign((props: object) => React.createElement("Image", props), {
    getSize: vi.fn(),
  }),
  useWindowDimensions: () => ({ width: 1000, height: 800 }),
  PanResponder: { create: (handlers: unknown) => ({ panHandlers: handlers }) },
  Text: "Text",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  ActivityIndicator: "ActivityIndicator",
  StyleSheet: { create: (styles: unknown) => styles },
  Appearance: { getColorScheme: () => "dark" },
  Platform: {
    get OS() {
      return nativePlatform.OS;
    },
    select: (options: Record<string, unknown>) =>
      options[nativePlatform.OS] ?? options.default,
  },
  Linking: { openURL: vi.fn(async () => {}) },
}));
const host = vi.hoisted(() => ({
  copy: vi.fn(async (_text: string) => {}),
  show: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@getpaseo/plugin/client/ui", () => {
  const element = (name: string) => (props: object) =>
    React.createElement(name, props);
  return {
    ...Object.fromEntries(
      [
        "SettingsSelect",
        "SettingsSwitch",
        "SettingsSection",
        "SettingsCard",
        "SettingsAction",
        "ExternalLink",
        "SidebarRow",
        "Markdown",
      ].map((name) => [name, element(name)]),
    ),
    ScrollView: "ScrollView",
    FlatList: "FlatList",
    TextInput: "TextInput",
    Icon: () => null,
    Modal: Object.assign(
      ({ open, children }: { open: boolean; children: React.ReactNode }) =>
        open ? children : null,
      { Content: ({ children }: { children: React.ReactNode }) => children },
    ),
    copyText: host.copy,
    useToast: () => ({ show: host.show, error: host.error }),
  };
});
const queries = vi.hoisted(() => ({
  review: undefined as import("../shared/review").ReviewResult | undefined,
  reviewRefetch: vi.fn(),
  recipients: {
    data: [] as
      | { id: string; title: string; running: boolean; blocked: boolean }[]
      | undefined,
    error: null as Error | null,
    isFetching: false,
    isLoading: false,
    refetch: vi.fn(),
  },
  inputs: vi.fn(),
  list: {
    data: { items: [] as unknown[] } as { items: unknown[] } | undefined,
    error: null as Error | null,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  detail: {
    data: null as unknown,
    error: null as Error | null,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  recent: {
    data: { items: [] as unknown[] } as { items: unknown[] } | undefined,
    error: null as Error | null,
    failureReason: null as Error | null,
  },
}));
const mediaResult = vi.hoisted(() => ({
  data: undefined,
  error: new Error("描画または読み込みに失敗"),
  refetch: vi.fn(),
}));
vi.mock("../client/rpc", () => ({
  useRpcQuery: (contract: { name: string }, input: unknown) => {
    queries.inputs(contract.name, input);
    if (contract.name === "canvas.review.recipients") return queries.recipients;
    if (contract.name.startsWith("canvas.review."))
      return {
        data:
          contract.name === "canvas.review.get" ? queries.review : undefined,
        error: null,
        refetch: queries.reviewRefetch,
        isFetching: false,
      };
    if (contract.name === "canvas.recent") return queries.recent;
    return contract.name === "canvas.list"
      ? queries.list
      : contract.name === "canvas.get"
        ? queries.detail
        : mediaResult;
  },
}));
import {
  CanvasThemeProvider,
  Button,
  Tabs,
  Badge,
  CodeBlock,
} from "../client/ui";
import { parseDocument } from "../server/document";
import { Markdown, safeLink } from "../client/markdown";
import { ReviewDocument } from "../client/review";
import { ReviewSendDialog } from "../client/review-send";
import { ReviewSurface } from "../client/review-input";
import type { ReviewDelivery, ReviewThread } from "../shared/review";
import { reviewTargets, sourceRange } from "../shared/review-targets";
import type { Canvas } from "../shared/contracts";
import { CanvasPanel } from "../client/panel";
import contribute from "../index.client";
import { appLocale, resolveText } from "./support/i18n";
import type { PluginClientContext, PluginTab } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
const colors = {
  surface0: "#111111",
  surface1: "#222222",
  surface2: "#333333",
  border: "#555555",
  foreground: "#eeeeee",
  foregroundMuted: "#aaaaaa",
  accent: "#88bbff",
  accentForeground: "#111111",
  statusSuccess: "#88ffaa",
  statusWarning: "#ffcc88",
  statusDanger: "#ff8888",
};
const theme: PluginTheme = { colors };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
test("GFM renders table, tasks, strikethrough and code as native text; HTML remains inert", async () => {
  const content =
    "# 見出し\n\n| A | B |\n|---|---|\n| 日本語 | test |\n\n- [x] 完了\n- [ ] 次\n\n~~削除~~ https://example.com\n\n```js\nconst a = 1\n```\n<script>alert(1)</script>";
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <CanvasThemeProvider theme={theme}>
        <Markdown
          document={parseDocument(content)}
          theme={theme}
          onError={() => {}}
        />
      </CanvasThemeProvider>,
    );
  });
  expect(view.root.findAllByType(CodeBlock)).toHaveLength(1);
  const output = JSON.stringify(view.toJSON());
  expect(output).toContain("☑");
  expect(output).not.toContain("[x]");
  expect(output).toContain("line-through");
  expect(output).toContain("<script>");
  expect(output).not.toContain('"type":"script"');
  expect(safeLink("javascript:alert(1)")).toBeNull();
  expect(safeLink("file:///etc/passwd")).toBeNull();
  expect(safeLink("https://example.com")).toBe("https://example.com");
  await act(async () => view.unmount());
});
const summary = {
  schemaVersion: 2,
  workspaceId: "workspace-a",
  createdAt: "2026-09-11T09:00:00Z",
  updatedAt: "2026-09-11T09:00:00Z",
  updatedBy: { role: "agent", agentId: "agent-a" },
  canvasId: "canvas-a",
  title: "実装プラン",
  revision: 2,
  editState: {
    status: "locked",
    lock: {
      owner: { role: "agent", agentId: "agent-a" },
      ownerTitle: "Agent A",
      acquiredAt: "2026-09-11T09:00:00Z",
      renewedAt: "2026-09-11T09:01:00Z",
      expiresAt: "2026-09-11T09:05:00Z",
    },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  nativePlatform.OS = "web";
  sdk.settings = { timelineNotifications: true };
  sdk.device = { openLinksIn: "workspace-browser" };
  appLocale.current = "en";
  sdk.hosts = [{ serverId: "host", label: "Host", status: "online" }];
  sdk.workspace = { name: "workspace-a", title: "Workspace A" };
  queries.recent.data = { items: [] };
  queries.recent.error = queries.recent.failureReason = null;
  queries.review = undefined;
  queries.recipients.data = [];
  queries.recipients.error = null;
  queries.recipients.isFetching = queries.recipients.isLoading = false;
  queries.list.data = {
    items: [summary, { ...summary, canvasId: "canvas-b", title: "メモ" }],
  };
  queries.detail.data = {
    canvas: { ...summary, content: "# 原文\n\n**共有**" },
    document: parseDocument("# 原文\n\n**共有**"),
  };
  queries.list.error = queries.detail.error = null;
  queries.list.isFetching = queries.detail.isFetching = false;
});
function panel(compact: boolean, tab?: PluginTab) {
  return (
    <CanvasPanel
      tab={tab}
      workspaceId="workspace-a"
      host={{ id: "host", label: "Host" }}
      theme={theme}
      layout={{ compact, platform: "web" }}
    />
  );
}
function button(view: ReactTestRenderer, label: string) {
  const buttons = view.root.findAllByType(Button);
  return (buttons.find(
    (item) => (item.props.accessibilityLabel ?? item.props.label) === label,
  ) ?? buttons.find((item) => item.props.label === label))!;
}
async function openCanvas(view: ReactTestRenderer) {
  await act(async () =>
    view.root
      .findAllByType("Pressable" as never)
      .find((item) => item.props.accessibilityLabel === "Open 実装プラン")!
      .props.onPress(),
  );
}

test.each([false, true])(
  "list/detail navigation uses Canvas controls and preserves source and metadata access (compact=%s)",
  async (compact) => {
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(panel(compact));
    });
    if (compact) {
      expect(view.root.findAllByType(Tabs)).toHaveLength(0);
      await openCanvas(view);
      expect(JSON.stringify(view.toJSON())).not.toContain("メモ");
    }
    expect(
      view.root.findAllByProps({ accessibilityLabel: "Refresh content" }),
    ).toHaveLength(0);
    expect(
      view.root.findAllByProps({ accessibilityLabel: "Refresh canvases" }),
    ).toHaveLength(0);
    expect(view.root.findByType(Badge).props.label).toBe("Editing");
    expect(JSON.stringify(view.toJSON())).toContain("Agent A");
    expect(JSON.stringify(view.toJSON())).not.toContain(
      summary.editState.lock.expiresAt,
    );
    await act(async () => button(view, "Details").props.onPress());
    expect(JSON.stringify(view.toJSON())).toContain(
      summary.editState.lock.expiresAt,
    );
    const sourceTab = view.root
      .findAllByType("Pressable" as never)
      .find(
        (item) =>
          item.props.accessibilityRole === "tab" &&
          item
            .findAllByType("Text" as never)
            .some((text) => text.children.includes("Code")),
      )!;
    await act(async () => sourceTab.props.onPress());
    expect(JSON.stringify(view.toJSON())).toContain("# 原文");
    if (compact) {
      await act(async () => button(view, "Back to canvases").props.onPress());
      expect(JSON.stringify(view.toJSON())).toContain("メモ");
      expect(view.root.findAllByType(Tabs)).toHaveLength(0);
    }
    await act(async () => view.unmount());
  },
);

test("narrow desktop pane switches to list/detail navigation when the split cannot fit", async () => {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(panel(false));
  });
  await act(async () =>
    view.root
      .findAllByType("View" as never)
      .find((item) => item.props.onLayout)!
      .props.onLayout({ nativeEvent: { layout: { width: 600 } } }),
  );
  expect(view.root.findAllByType(Tabs)).toHaveLength(0);
  await openCanvas(view);
  expect(button(view, "Back to canvases")).toBeDefined();
  await act(async () => view.unmount());
});

test("a zero-width hidden tab preserves the automatically displayed document and open comments", async () => {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(panel(false));
  });
  const layout = (width: number) =>
    view.root
      .findAllByType("View" as never)
      .find((item) => item.props.onLayout)!
      .props.onLayout({ nativeEvent: { layout: { width } } });
  await act(async () => layout(1200));
  await act(async () => button(view, "Comments").props.onPress());
  const document = view.root.findByType(ReviewDocument);
  const comments = view.root.findByProps({ testID: "review-overview" });
  await act(async () => layout(0));
  expect(view.root.findByType(ReviewDocument)).toBe(document);
  expect(view.root.findByProps({ testID: "review-overview" })).toBe(comments);
  await act(async () => layout(1200));
  expect(view.root.findByType(ReviewDocument)).toBe(document);
  expect(view.root.findByProps({ testID: "review-overview" })).toBe(comments);
  await act(async () => view.unmount());
});

test("list visibility and placement preserve the selected document and code mode across layout changes", async () => {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(panel(false));
  });
  await openCanvas(view);
  await act(async () => view.root.findByType(Tabs).props.onTabChange("source"));
  const tabs = view.root.findByType(Tabs);
  const layout = (width: number) =>
    view.root
      .findAllByType("View" as never)
      .find((item) => item.props.onLayout)!
      .props.onLayout({ nativeEvent: { layout: { width } } });
  const listVisible = () =>
    view.root.findAllByProps({ accessibilityLabel: "Open メモ" }).length > 0;
  const split = () =>
    view.root
      .findAllByType("View" as never)
      .find(
        (item) =>
          item.props.style?.backgroundColor === colors.surface0 &&
          item.props.style?.flexDirection,
      )!;

  await act(async () =>
    button(view, "Move canvas list to right").props.onPress(),
  );
  expect(split().props.style.flexDirection).toBe("row-reverse");
  expect(view.root.findByType(Tabs)).toBe(tabs);
  expect(tabs.props.activeTab).toBe("source");
  await act(async () => button(view, "Hide canvas list").props.onPress());
  expect(listVisible()).toBe(false);
  expect(view.root.findByType(Tabs)).toBe(tabs);
  await act(async () => layout(600));
  expect(button(view, "Move canvas list to left")).toBeUndefined();
  expect(button(view, "Back to canvases")).toBeDefined();
  expect(view.root.findByType(Tabs)).toBe(tabs);
  await act(async () => layout(1000));
  expect(listVisible()).toBe(false);
  expect(button(view, "Move canvas list to left")).toBeUndefined();
  await act(async () => button(view, "Show canvas list").props.onPress());
  expect(listVisible()).toBe(true);
  expect(split().props.style.flexDirection).toBe("row-reverse");
  await act(async () =>
    button(view, "Move canvas list to left").props.onPress(),
  );
  expect(split().props.style.flexDirection).toBe("row");
  expect(view.root.findByType(Tabs)).toBe(tabs);
  expect(tabs.props.activeTab).toBe("source");
  await act(async () => view.unmount());
});

test("an empty workspace keeps the list toggle reachable while collapsed", async () => {
  queries.list.data = { items: [] };
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(panel(false));
  });
  await act(async () =>
    button(view, "Move canvas list to right").props.onPress(),
  );
  await act(async () => button(view, "Hide canvas list").props.onPress());
  expect(button(view, "Move canvas list to left")).toBeUndefined();
  await act(async () => button(view, "Show canvas list").props.onPress());
  expect(button(view, "Move canvas list to left")).toBeDefined();
  expect(JSON.stringify(view.toJSON())).toContain("No canvases yet");
  await act(async () => view.unmount());
});

test("tables use measured content widths, preserve column alignment, and scroll only below readable widths", async () => {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <CanvasThemeProvider theme={theme}>
        <Markdown
          theme={theme}
          onError={() => {}}
          document={parseDocument(
            "| Character | Relationship |\n| :--- | ---: |\n| 鹿目まどか | 全ての中心。ほむらに執着され、さやかの親友、マミの後輩 |\n\n> | A | B | C |\n> | --- | --- | --- |\n> | 1 | 2 | 3 |",
          )}
        />
      </CanvasThemeProvider>,
    );
  });
  const scrolls = view.root
    .findAllByType("ScrollView" as never)
    .filter((item) => item.props.horizontal && item.props.onLayout);
  const tables = () => view.root.findAllByProps({ role: "table" });
  const resize = (index: number, width: number) =>
    scrolls[index].props.onLayout({ nativeEvent: { layout: { width } } });
  const measurements = view.root
    .findAllByProps({ importantForAccessibility: "no-hide-descendants" })
    .flatMap((item) => item.findAllByType("Text" as never))
    .filter((item) => item.props.onLayout);
  await act(async () => {
    [120, 160, 80, 1000, 50, 60, 70, 600, 500, 400].forEach((width, index) =>
      measurements[index].props.onLayout({
        nativeEvent: { layout: { width } },
      }),
    );
    resize(0, 820);
    resize(1, 780);
  });
  expect(tables().map((item) => item.props.style.width)).toEqual([820, 780]);
  const firstCells = () =>
    tables()[0]
      .findAllByType("Text" as never)
      .filter((item) => item.props.role);
  expect(firstCells().map((item) => item.props.style.width)).toEqual([
    120, 698, 120, 698,
  ]);
  expect(firstCells().map((item) => item.props.style.textAlign)).toEqual([
    "left",
    "right",
    "left",
    "right",
  ]);
  await act(async () => {
    resize(0, 358);
    resize(1, 318);
  });
  expect(tables().map((item) => item.props.style.width)).toEqual([358, 542]);
  expect(firstCells().map((item) => item.props.style.width)).toEqual([
    120, 236, 120, 236,
  ]);
  await act(async () => resize(0, 260));
  expect(tables()[0].props.style.width).toBe(302);
  await act(async () => resize(0, 700));
  expect(tables()[0].props.style.width).toBe(700);
  // Shortening a long cell reallocates space; it must not keep a historical maximum.
  await act(async () =>
    measurements[3].props.onLayout({ nativeEvent: { layout: { width: 160 } } }),
  );
  expect(firstCells()[1].props.style.width).toBeLessThan(578);
  expect(tables()[0].props.style.width).toBe(700);
  await act(async () => view.unmount());
});

test("action controls are uniform sm buttons with the view toggle right-aligned", async () => {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(panel(false));
  });
  const labels = ["Edit", "Delete", "Copy content"];
  for (const label of labels)
    expect(button(view, label).props.size).toBe("sm");
  const tabs = view.root.findByType(Tabs);
  expect(tabs.parent!.props.style.marginLeft).toBe("auto");
  const row = tabs.parent!.parent!;
  const buttons = row
    .findAllByType(Button)
    .map((item) => item.props.accessibilityLabel ?? item.props.label);
  expect(buttons).toEqual(["Edit", "Delete", "Copy content"]);
  await act(async () => view.unmount());
});

test("copy success and failure use the host toast instead of inserting content into the panel", async () => {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(panel(false));
  });
  await act(async () => button(view, "Copy content").props.onPress());
  expect(host.copy).toHaveBeenCalledWith("# 原文\n\n**共有**");
  expect(host.show).toHaveBeenCalledWith("Content copied");
  expect(JSON.stringify(view.toJSON())).not.toContain("Content copied");
  host.copy.mockRejectedValueOnce(new Error("denied"));
  await act(async () => button(view, "Copy content").props.onPress());
  expect(host.error).toHaveBeenCalledWith("Unable to copy content");
  await act(async () => view.unmount());
});

test("fetch failure distinguishes an initial failure from cached content and explains automatic retry", async () => {
  queries.list.data = undefined;
  queries.list.error = new Error("offline");
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(panel(true));
  });
  expect(
    view.root
      .findAllByType("Text" as never)
      .some((item) => item.children.join("") === "Unable to load canvases"),
  ).toBe(true);
  expect(JSON.stringify(view.toJSON())).not.toContain("last loaded");
  expect(JSON.stringify(view.toJSON())).toContain("Retrying automatically.");
  expect(
    view.root.findAllByProps({ accessibilityLabel: "Refresh canvases" }),
  ).toHaveLength(0);
  queries.list.data = { items: [summary] };
  await act(async () => view.update(panel(true)));
  expect(JSON.stringify(view.toJSON())).toContain("last loaded");
  expect(JSON.stringify(view.toJSON())).toContain("実装プラン");
  await act(async () => view.unmount());
});

test("a remotely deleted selection is explicit and the compact list stays reachable", async () => {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(panel(true));
  });
  await openCanvas(view);
  queries.list.data = { items: [] };
  await act(async () => view.update(panel(true)));
  expect(JSON.stringify(view.toJSON())).toContain(
    "This canvas has been deleted",
  );
  expect(view.root.findAllByType(Tabs)).toHaveLength(0);
  await act(async () => button(view, "Back to canvases").props.onPress());
  expect(JSON.stringify(view.toJSON())).toContain("No canvases yet");
  await act(async () => view.unmount());
});

test("Markdown keeps link styling and both closed and initially open details toggle", async () => {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <CanvasThemeProvider theme={theme}>
        <Markdown
          theme={theme}
          onError={() => {}}
          document={parseDocument(
            "[**重要**と`code`](https://example.com)\n\n<details>\n<summary>補足</summary>\n\n非表示の本文\n\n</details>\n\n<details open>\n<summary>開いた補足</summary>\n\n初期表示の本文\n\n</details>",
          )}
        />
      </CanvasThemeProvider>,
    );
  });
  const link = view.root
    .findAllByType("Text" as never)
    .find((n) => n.props.accessibilityRole === "link")!;
  expect(
    link
      .findAllByType("Text" as never)
      .some((n) => n.props.style?.fontWeight === "700"),
  ).toBe(true);
  expect(
    link
      .findAllByType("Text" as never)
      .some((n) => n.props.style?.fontFamily === "monospace"),
  ).toBe(true);
  expect(JSON.stringify(view.toJSON())).not.toContain("非表示の本文");
  expect(JSON.stringify(view.toJSON())).toContain("初期表示の本文");
  await act(async () => button(view, "補足").props.onPress());
  expect(JSON.stringify(view.toJSON())).toContain("非表示の本文");
  await act(async () => button(view, "開いた補足").props.onPress());
  expect(JSON.stringify(view.toJSON())).not.toContain("初期表示の本文");
  await act(async () => view.unmount());
});
test("a heading link expands its enclosing details before scrolling, and missing targets report errors", async () => {
  const navigate = vi.fn(),
    error = vi.fn();
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <CanvasThemeProvider theme={theme}>
        <Markdown
          theme={theme}
          onNavigate={navigate}
          onError={error}
          document={parseDocument(
            "[移動](#見出し) [不明](#unknown)\n\n<details>\n<summary>閉じた詳細</summary>\n\n## 見出し\n\n中身\n\n</details>",
          )}
        />
      </CanvasThemeProvider>,
      {
        createNodeMock: () => ({
          measureLayout: (_root: unknown, success: Function) => success(0, 320),
        }),
      },
    );
  });
  const links = view.root
    .findAllByType("Text" as never)
    .filter((n) => n.props.accessibilityRole === "link");
  await act(async () => links[0].props.onPress());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 70)));
  expect(JSON.stringify(view.toJSON())).toContain("中身");
  expect(navigate).toHaveBeenCalledWith(320);
  await act(async () => links[1].props.onPress());
  expect(error).toHaveBeenCalledWith(
    "The linked heading or footnote was not found",
  );
  await act(async () => view.unmount());
});

test("media errors remain visible and offer retry without hiding source access", async () => {
  const { Graphic, DocumentImage } = await import("../client/media");
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <CanvasThemeProvider theme={theme}>
        <Graphic
          input={{
            kind: "math",
            source: "invalid diagram",
            display: true,
            foreground: "#eeeeee",
            background: "#111111",
            fontSize: 15,
          }}
          theme={theme}
          width={320}
        />
        <DocumentImage
          src="missing.png"
          alt="参照画像"
          theme={theme}
          width={320}
          workspaceId="workspace-a"
        />
      </CanvasThemeProvider>,
    );
  });
  expect(JSON.stringify(view.toJSON())).toContain("Failed to render");
  expect(JSON.stringify(view.toJSON())).toContain("Unable to display image");
  await act(async () => button(view, "Retry").props.onPress());
  expect(mediaResult.refetch).toHaveBeenCalled();
  expect(button(view, "Show source")).toBeDefined();
  await act(async () => view.unmount());
});

test("Mermaid blocks are drawn by Paseo's renderer, including syntax Canvas used to reject", async () => {
  const content =
    "```mermaid\nflowchart LR\nA[計画] --> B[実装]\n```\n\n```mermaid\nsequenceDiagram\nA->>B: hello\nloop retry\nend\n```";
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <CanvasThemeProvider
        theme={theme}
        layout={{ compact: true, platform: "ios" }}
      >
        <Markdown
          document={parseDocument(content)}
          theme={theme}
          onError={() => {}}
        />
      </CanvasThemeProvider>,
    );
  });
  const diagrams = tree.root.findAll(
    (node) => node.props.testID === "mermaid-diagram",
  );
  expect(diagrams).toHaveLength(2);
  expect(
    diagrams.map(
      (diagram) => diagram.findByType("Markdown" as never).props.children,
    ),
  ).toEqual([
    "```mermaid\nflowchart LR\nA[計画] --> B[実装]\n```",
    "```mermaid\nsequenceDiagram\nA->>B: hello\nloop retry\nend\n```",
  ]);
  // Paseo's renderer owns zoom and source view; Canvas adds no controls.
  expect(tree.root.findAllByType(Button)).toHaveLength(0);
  expect(tree.root.findAllByType(CodeBlock)).toHaveLength(0);
  await act(async () => tree.unmount());
});

test("the Mermaid fence outlasts backtick runs inside the diagram", async () => {
  const { mermaidFence } = await import("../client/markdown");
  expect(mermaidFence("graph TD\nA[\"````\"]-->B")).toBe(
    "`````mermaid\ngraph TD\nA[\"````\"]-->B\n`````",
  );
});

test.each(["web", "ios", "android"] as const)(
  "document images on %s use shared size API and ignore stale loads",
  async (platform) => {
    nativePlatform.OS = platform;
    const { Image } = await import("react-native");
    const { DocumentImage } = await import("../client/media");
    const loads: Array<(width: number, height: number) => void> = [];
    vi.mocked(Image.getSize).mockImplementation((_uri, success) => {
      loads.push(success);
    });
    const render = (src: string) => (
      <CanvasThemeProvider theme={theme}>
        <DocumentImage src={src} alt="テスト画像" theme={theme} width={240} />
      </CanvasThemeProvider>
    );
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(render("https://example.com/one.png"));
    });
    expect(JSON.stringify(tree.toJSON())).toContain("Loading image");
    await act(async () => {
      tree.update(render("https://example.com/two.png"));
    });
    await act(async () => loads[0](800, 600));
    expect(JSON.stringify(tree.toJSON())).toContain("Loading image");
    await act(async () => loads[1](400, 200));
    expect(tree.root.findByType(Image).props.style).toEqual({
      width: 240,
      height: 120,
    });
    expect(tree.root.findByType(Image).props.onLoad).toBeUndefined();
    // A failed remote image is retried as SVG before the error is shown.
    const fetch = vi.fn(async (_url: string) => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetch);
    try {
      await act(async () => tree.root.findByType(Image).props.onError());
      await act(async () => {});
      expect(fetch).toHaveBeenCalledWith(
        "https://example.com/two.png",
        expect.anything(),
      );
      expect(JSON.stringify(tree.toJSON())).toContain(
        "Unable to display image",
      );
    } finally {
      vi.unstubAllGlobals();
    }
    await act(async () =>
      tree.root.findByProps({ accessibilityRole: "button" }).props.onPress(),
    );
    expect(loads).toHaveLength(3);
    await act(async () => loads[2](400, 200));
    expect(tree.root.findByType(Image).props.source.uri).toBe(
      "https://example.com/two.png",
    );
    await act(async () => tree.unmount());
  },
);

test.each(["ios", "android", "web"] as const)(
  "remote SVG on %s that the image view cannot draw is fetched by the device and rasterized by the daemon",
  async (platform) => {
    nativePlatform.OS = platform;
    const { Image } = await import("react-native");
    const { DocumentImage } = await import("../client/media");
    vi.mocked(Image.getSize).mockImplementation((_uri, _success, failure) =>
      failure?.(new Error("unsupported image")),
    );
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"/>';
    const fetch = vi.fn(async (url: string) =>
      url.endsWith("badge.svg")
        ? new Response(source, { headers: { "content-type": "text/plain" } })
        : url.endsWith("photo.png")
          ? new Response(source, { headers: { "content-type": "image/png" } })
          : new Response("<html></html>"),
    );
    vi.stubGlobal("fetch", fetch);
    reviewCalls.mockImplementation(async (name, input) =>
      name === "canvas.render_graphic"
        ? { uri: "data:image/png;base64,UE5H", width: 480, height: 240 }
        : undefined,
    );
    const render = (src: string) => (
      <CanvasThemeProvider theme={theme}>
        <DocumentImage src={src} alt="バッジ" theme={theme} width={240} />
      </CanvasThemeProvider>
    );
    let tree!: ReactTestRenderer;
    try {
      await act(async () => {
        tree = create(render("https://example.com/badge.svg"));
      });
      await act(async () => {});
      expect(reviewCalls).toHaveBeenCalledWith("canvas.render_graphic", {
        kind: "svg",
        source,
      });
      const image = tree.root.findByType(Image);
      expect(image.props.source.uri).toBe("data:image/png;base64,UE5H");
      expect(image.props.style).toEqual({ width: 240, height: 120 });
      // The rasterized size is known, so the PNG is not measured again.
      expect(Image.getSize).toHaveBeenCalledTimes(1);

      for (const src of [
        "https://example.com/page",
        "https://example.com/photo.png",
      ]) {
        await act(async () => {
          tree.update(render(src));
        });
        await act(async () => {});
        expect(JSON.stringify(tree.toJSON())).toContain(
          "Unable to display image",
        );
      }
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(
        reviewCalls.mock.calls.filter(
          ([name]) => name === "canvas.render_graphic",
        ),
      ).toHaveLength(1);
    } finally {
      reviewCalls.mockImplementation(async () => undefined);
      vi.unstubAllGlobals();
      await act(async () => tree?.unmount());
    }
  },
);

test("workspace SVGs and SVG fences use the daemon's rasterized size and keep their source", async () => {
  const { Image } = await import("react-native");
  const { DocumentImage } = await import("../client/media");
  const saved = { ...mediaResult };
  Object.assign(mediaResult, {
    data: { uri: "data:image/png;base64,UE5H", width: 1200, height: 300 },
    error: null,
  });
  let tree!: ReactTestRenderer;
  try {
    await act(async () => {
      tree = create(
        <CanvasThemeProvider theme={theme}>
          <DocumentImage
            src="docs/diagram.svg"
            alt="構成図"
            theme={theme}
            width={240}
            workspaceId="workspace-a"
          />
        </CanvasThemeProvider>,
      );
    });
    expect(Image.getSize).not.toHaveBeenCalled();
    expect(tree.root.findByType(Image).props.style).toEqual({
      width: 240,
      height: 60,
    });
    await act(async () => tree.unmount());

    const fence =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300"/>';
    await act(async () => {
      tree = create(
        <CanvasThemeProvider theme={theme}>
          <Markdown
            document={parseDocument(`\`\`\`svg\n${fence}\n\`\`\`\n`)}
            theme={theme}
            onError={() => {}}
          />
        </CanvasThemeProvider>,
      );
    });
    expect(queries.inputs).toHaveBeenCalledWith("canvas.render_graphic", {
      kind: "svg",
      source: fence,
    });
    expect(tree.root.findAllByType(CodeBlock)).toHaveLength(0);
    const image = tree.root.findByProps({ accessibilityLabel: "SVG image" });
    expect(image.props.style).toEqual({ width: 600, height: 150 });
    await act(async () => button(tree, "Show source").props.onPress());
    expect(tree.root.findByType(CodeBlock).props).toMatchObject({
      code: fence,
      language: "xml",
    });
    await act(async () => tree.unmount());

    // Review targets add a 2px border and 8px padding on each side.
    await act(async () => {
      tree = create(
        <CanvasThemeProvider theme={theme}>
          <Markdown
            document={parseDocument(`\`\`\`svg\n${fence}\n\`\`\`\n`)}
            theme={theme}
            onError={() => {}}
            review={{
              enabled: true,
              register: () => {},
              navigate: null,
              navigationRequest: 0,
              text: (value) => value,
              wrap: (_node, child) => child,
            }}
          />
        </CanvasThemeProvider>,
      );
    });
    expect(
      tree.root.findByProps({ accessibilityLabel: "SVG image" }).props.style,
    ).toEqual({ width: 580, height: 145 });
  } finally {
    Object.assign(mediaResult, saved);
    await act(async () => tree?.unmount());
  }
});

test.each([false, true])(
  "timeline action selects an unmounted or mounted panel in its workspace (compact=%s)",
  async (compact) => {
    const renderers: any[] = [],
      panels: any[] = [],
      screens: any[] = [],
      sidebarItems: any[] = [],
      settingsScreens: any[] = [],
      commands: any[] = [],
      slashCommands: any[] = [],
      attachmentSources: any[] = [];
    const removeRenderer = vi.fn(),
      removePanel = vi.fn(),
      removeCommand = vi.fn(),
      removeScreen = vi.fn(),
      removeSidebarItem = vi.fn(),
      removeSettings = vi.fn(),
      removeSlashCommand = vi.fn(),
      removeAttachmentSource = vi.fn();
    const client = {
      rpc: vi.fn(() => new Promise(() => {})),
      openPanel: vi.fn(),
      openScreen: vi.fn(),
      i18n: { t: () => "No match", locale: "en" },
      addSlashCommand: (entry: any) => {
        slashCommands.push(entry);
        return removeSlashCommand;
      },
      addAttachmentSource: (entry: any) => {
        attachmentSources.push(entry);
        return removeAttachmentSource;
      },
      addTimelineRenderer: (entry: any) => {
        renderers.push(entry);
        return removeRenderer;
      },
      addWorkspacePanel: (entry: any) => {
        panels.push(entry);
        return removePanel;
      },
      addCommandCenterItem: (entry: any) => {
        commands.push(entry);
        return removeCommand;
      },
      addScreen: (entry: any) => {
        screens.push(entry);
        return removeScreen;
      },
      addSidebarHeaderItem: (entry: any) => {
        sidebarItems.push(entry);
        return removeSidebarItem;
      },
      addSettingsScreen: (entry: any) => {
        settingsScreens.push(entry);
        return removeSettings;
      },
    };
    const cleanup = contribute(client as unknown as PluginClientContext);
    const Row = renderers[0].Component,
      Panel = panels[0].Component;
    const common = {
      host: { id: "host", label: "Host" },
      theme,
      layout: { compact, platform: "web" },
    };
    const row = (workspaceId: string, canvasId: string) => (
      <Row
        {...common}
        agentId="agent-a"
        timestamp={new Date()}
        item={{
          type: "plugin",
          kind: "canvas-activity",
          version: 1,
          data: {
            workspaceId,
            canvasId,
            title: "Implementation plan",
            revision: 2,
            action: "updated",
            warningCount: 2,
            savedAt: "2026-09-12T00:00:00Z",
          },
        }}
      />
    );
    const tab = { state: undefined, setState: vi.fn(), setModified: vi.fn() };
    let timeline!: ReactTestRenderer, view!: ReactTestRenderer;
    try {
      await act(async () => {
        timeline = create(row("workspace-a", "canvas-b"));
      });
      expect(JSON.stringify(timeline.toJSON())).toContain(
        "Mermaid rendering warnings: ",
      );
      await act(async () => button(timeline, "Open canvas").props.onPress());
      expect(client.openPanel).toHaveBeenLastCalledWith("canvas", {
        workspaceId: "workspace-a",
      });
      await act(async () => {
        view = create(
          <Panel {...common} tab={tab} workspaceId="workspace-a" />,
        );
      });
      expect(queries.inputs).toHaveBeenCalledWith("canvas.get", {
        workspaceId: "workspace-a",
        canvasId: "canvas-b",
      });
      expect(view.root.findAllByType(Tabs)).toHaveLength(1);
      await act(async () =>
        button(view, "Open in full screen").props.onPress(),
      );
      expect(client.openScreen).toHaveBeenLastCalledWith({
        screenId: "canvas",
        params: { workspaceId: "workspace-a", canvasId: "canvas-b" },
      });
      await act(async () => timeline.update(row("workspace-a", "canvas-a")));
      queries.inputs.mockClear();
      await act(async () => button(timeline, "Open canvas").props.onPress());
      expect(queries.inputs).toHaveBeenCalledWith("canvas.get", {
        workspaceId: "workspace-a",
        canvasId: "canvas-a",
      });
      await act(async () => timeline.update(row("workspace-b", "canvas-b")));
      queries.inputs.mockClear();
      await act(async () => button(timeline, "Open canvas").props.onPress());
      expect(queries.inputs).not.toHaveBeenCalled();
      expect(client.openPanel).toHaveBeenLastCalledWith("canvas", {
        workspaceId: "workspace-b",
      });
      await act(async () => timeline.update(row("workspace-a", "deleted")));
      await act(async () => button(timeline, "Open canvas").props.onPress());
      expect(JSON.stringify(view.toJSON())).toContain(
        "This canvas has been deleted",
      );
      if (compact) {
        await act(async () => button(view, "Back to canvases").props.onPress());
        expect(view.root.findAllByType(Tabs)).toHaveLength(0);
      }
    } finally {
      await act(async () => {
        timeline?.unmount();
        view?.unmount();
        cleanup();
      });
    }
    // The selection is kept in the tab, so a reload reopens the same canvas.
    expect(tab.setState).toHaveBeenCalledWith(
      expect.objectContaining({ canvasId: "deleted" }),
    );
    for (const registered of [screens, sidebarItems, settingsScreens]) {
      expect(registered).toHaveLength(1);
      expect(registered[0].id).toBe("canvas");
      expect(resolveText(registered[0].title)).toBe("Canvas");
    }
    expect(resolveText(panels[0].title)).toBe("Canvas");
    expect(panels[0]).not.toHaveProperty("context");
    expect(slashCommands).toMatchObject([
      { name: "canvas", context: "workspace" },
    ]);
    expect(attachmentSources).toMatchObject([
      {
        id: "canvas",
        icon: "NotebookPen",
        search: { name: "canvas.attachments.search" },
      },
    ]);
    expect(removeSlashCommand).toHaveBeenCalledOnce();
    expect(removeAttachmentSource).toHaveBeenCalledOnce();
    const openSettings = vi.fn();
    commands
      .find((command) => command.id === "canvas-settings")
      .onSelect({ openSettings });
    expect(openSettings).toHaveBeenCalledWith("canvas");
    expect(removeRenderer).toHaveBeenCalledOnce();
    expect(removePanel).toHaveBeenCalledOnce();
    expect(removeCommand).toHaveBeenCalledTimes(commands.length);
    expect(removeScreen).toHaveBeenCalledOnce();
    expect(removeSidebarItem).toHaveBeenCalledOnce();
    expect(removeSettings).toHaveBeenCalledOnce();
  },
);

function reviewCanvas(content: string): Canvas {
  return {
    schemaVersion: 2,
    workspaceId: "workspace-a",
    canvasId: "canvas-a",
    title: "Review",
    revision: 1,
    createdAt: "2026-09-12T00:00:00Z",
    updatedAt: "2026-09-12T00:00:00Z",
    updatedBy: { role: "agent", agentId: "agent-a" },
    editState: { status: "unlocked" },
    content,
  };
}
function reviewView(canvas: Canvas, mode: "preview" | "source") {
  return (
    <CanvasThemeProvider theme={theme}>
      <ReviewDocument
        canvas={canvas}
        document={parseDocument(canvas.content)}
        mode={mode}
        theme={theme}
        fontSize={14}
      />
    </CanvasThemeProvider>
  );
}

test.each(["web", "android", "ios"])(
  "%s selects multiple whole elements and writes one comment with the same targets in Preview and Code",
  async (platform) => {
    nativePlatform.OS = platform;
    const canvas = reviewCanvas(
      "# Title\n\nFirst paragraph.\n\nBetween.\n\n| A | B |\n|---|---|\n| X | Y |\n\n```mermaid\nflowchart LR\nA-->B\n```\n\n- one\n- two\n",
    );
    const targets = reviewTargets(parseDocument(canvas.content));
    const id = (index: number) => {
      const range = sourceRange(targets[index])!;
      return `review-target-${range.start}-${range.end}`;
    };
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(reviewView(canvas, "preview"));
    });
    const target = (index: number) =>
      view.root.findByProps({ testID: id(index) });
    expect(target(1).props.onPress).toBeUndefined();
    expect(target(1).props.accessible).toBe(false);
    expect(button(view, "Add comment")).toBeUndefined();
    expect(button(view, "Select target")).toBeUndefined();
    await act(async () => button(view, "Comment mode").props.onPress());
    expect(
      view.root.findAllByProps({ accessibilityRole: "checkbox" }),
    ).toHaveLength(6);
    for (const index of [4, 1, 3])
      await act(async () => target(index).props.onPress());
    expect(target(1).props["aria-checked"]).toBe(true);
    expect(target(1).props.style.backgroundColor).toBe(colors.surface2);
    expect(target(1).props.style.borderColor).toBe(colors.accent);
    expect(target(2).props["aria-checked"]).toBe(false);
    expect(
      target(4).findAllByProps({
        pointerEvents: "none",
        importantForAccessibility: "no-hide-descendants",
      }),
    ).toHaveLength(1);
    expect(button(view, "Add comment").props.icon).toBe("MessageSquare");
    expect(button(view, "Add comment").props.label).toBe("Add comment");
    expect(
      view.root.findByProps({ testID: "review-comment-action" }).props.style,
    ).toMatchObject({ position: "absolute", right: 16, bottom: 16 });
    await act(async () => target(3).props.onPress());
    expect(target(3).props["aria-checked"]).toBe(false);
    await act(async () => view.update(reviewView(canvas, "source")));
    expect(target(1).props["aria-checked"]).toBe(true);
    expect(target(4).props["aria-checked"]).toBe(true);
    expect(
      view.root.findAllByProps({ accessibilityRole: "checkbox" }),
    ).toHaveLength(6);
    await act(async () => target(3).props.onPress());
    await act(async () => button(view, "Add comment").props.onPress());
    expect(
      target(3).parent!.findAllByProps({ testID: "review-inline" }),
    ).toHaveLength(1);
    expect(
      target(4).parent!.findAllByProps({ testID: "review-inline" }),
    ).toHaveLength(0);
    expect(
      view.root.findAllByProps({ testID: "review-comment-action" }),
    ).toHaveLength(0);
    const input = view.root
      .findAllByType("TextInput" as never)
      .find(
        (node) => node.props.placeholder === "Describe the change you want",
      )!;
    await act(async () =>
      input.props.onChangeText("One comment for all selected elements"),
    );
    // Switching views and resuming selection retains the unsaved comment.
    await act(async () => button(view, "Close comment").props.onPress());
    await act(async () => view.update(reviewView(canvas, "preview")));
    expect(target(3).props["aria-checked"]).toBe(true);
    await act(async () => button(view, "Add comment").props.onPress());
    reviewCalls.mockResolvedValueOnce({});
    await act(async () => button(view, "Save comment").props.onPress());
    expect(reviewCalls).toHaveBeenCalledTimes(1);
    const mutation = (
      reviewCalls.mock.calls[0][1] as {
        mutation: {
          selection: { ranges: { start: number; end: number }[] };
          body: string;
        };
      }
    ).mutation;
    expect(mutation.body).toBe("One comment for all selected elements");
    expect(
      mutation.selection.ranges.map(({ start, end }) => ({ start, end })),
    ).toEqual([1, 3, 4].map((index) => sourceRange(targets[index])));
    expect(button(view, "Save comment")).toBeUndefined();
    await act(async () => view.unmount());
  },
);

test("deselecting all or cancelling removes the floating action; updates require fresh targets and preserve the draft", async () => {
  const canvas = reviewCanvas("First.\n\nSecond.\n");
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(reviewView(canvas, "preview"));
  });
  const target = () => view.root.findByProps({ testID: "review-target-0-6" });
  await act(async () => button(view, "Comment mode").props.onPress());
  await act(async () => target().props.onPress());
  await act(async () => target().props.onPress());
  expect(button(view, "Add comment")).toBeUndefined();
  await act(async () => target().props.onPress());
  await act(async () => button(view, "Cancel selection").props.onPress());
  expect(button(view, "Add comment")).toBeUndefined();
  await act(async () => button(view, "Comment mode").props.onPress());
  await act(async () => target().props.onPress());
  await act(async () => button(view, "Add comment").props.onPress());
  const input = () =>
    view.root
      .findAllByType("TextInput" as never)
      .find(
        (node) => node.props.placeholder === "Describe the change you want",
      )!;
  await act(async () => input().props.onChangeText("Keep my draft"));
  await act(async () =>
    view.update(reviewView({ ...canvas, revision: 2 }, "preview")),
  );
  expect(button(view, "Save comment").props.disabled).toBe(true);
  await act(async () => button(view, "Close comment").props.onPress());
  expect(button(view, "Add comment")).toBeUndefined();
  expect(target().props["aria-checked"]).toBe(false);
  await act(async () => target().props.onPress());
  await act(async () => button(view, "Add comment").props.onPress());
  expect(input().props.value).toBe("Keep my draft");
  expect(button(view, "Save comment").props.disabled).toBe(false);
  await act(async () => view.unmount());
});
test.each(["web", "android", "ios"])(
  "%s comments stay inline and retain drafts, edits and targets across resize and hidden tabs",
  async (platform) => {
    nativePlatform.OS = platform;
    const directory = await mkdtemp(
      path.join(tmpdir(), "canvas-review-layout-"),
    );
    const store = await CanvasStore.open(directory);
    let view: ReactTestRenderer | undefined;
    try {
      const actor = {
        workspaceId: "workspace-a",
        agentId: "agent-a",
        sessionId: "session-a",
        title: "Test agent",
      };
      const created = await store.create(actor, "Review", "First paragraph.\n");
      const { canvas } = await store.get(actor.workspaceId, created.canvasId);
      const selection = {
        documentRevision: canvas.revision,
        ranges: [
          {
            kind: "block" as const,
            start: 0,
            end: 16,
            selectedText: "First paragraph.",
          },
        ],
      };
      queries.review = await store.reviews.mutate(
        actor.workspaceId,
        canvas.canvasId,
        {
          action: "create",
          selection,
          body: "Original comment",
        },
      );
      const originalThread = Object.values(queries.review.state.threads)[0];
      queries.review = await store.reviews.mutate(
        actor.workspaceId,
        canvas.canvasId,
        {
          action: "reply",
          threadId: originalThread.id,
          expectedRevision: originalThread.revision,
          body: "Another message",
        },
      );
      const thread = Object.values(queries.review.state.threads)[0];
      await act(async () => {
        view = create(reviewView(canvas, "preview"));
      });
      const tree = view!;
      const resize = async (width: number) =>
        act(async () => {
          tree.root.findByProps({ testID: "review-document" }).props.onLayout({
            nativeEvent: { layout: { width } },
          });
        });
      const input = (label: string) =>
        tree.root
          .findAllByType("TextInput" as never)
          .find((node) => node.props.accessibilityLabel === label)!;
      const bodyView = tree.root.findByProps({ testID: "review-body" });
      await act(async () => button(tree, "Comment mode").props.onPress());
      await act(async () =>
        tree.root.findByProps({ testID: "review-target-0-16" }).props.onPress(),
      );
      await act(async () => button(tree, "Add comment").props.onPress());
      await act(async () => input("Comment").props.onChangeText("New draft"));
      const originalInput = input("Comment");
      for (const width of [1200, 0, 920, 919, 430, 0, 1200]) {
        await resize(width);
        expect(input("Comment")).toBe(originalInput);
        expect(
          tree.root.findAllByProps({ testID: "review-inline" }),
        ).toHaveLength(1);
        expect(
          tree.root.findAllByProps({ testID: "review-panes" }),
        ).toHaveLength(0);
        expect(tree.root.findAllByType(SdkModal)).toHaveLength(0);
      }
      await act(async () => button(tree, "Comments (1)").props.onPress());
      expect(bodyView.props.style.display).toBe("none");
      expect(tree.root.findAllByType("TextInput" as never)).toHaveLength(0);
      await act(async () => button(tree, "Go to target").props.onPress());
      expect(bodyView.props.style.display).toBe("flex");
      expect(tree.root.findByProps({ testID: "review-body" })).toBe(bodyView);
      expect(
        tree.root.findAllByProps({ testID: "review-inline" }),
      ).toHaveLength(1);
      await act(async () => input("Reply").props.onChangeText("Reply draft"));
      await act(async () => button(tree, "Edit").props.onPress());
      await act(async () =>
        input("Edit comment").props.onChangeText("Edited draft"),
      );
      const editButtons = () =>
        tree.root
          .findAllByType(Button)
          .filter((node) => node.props.label === "Edit");
      await act(async () => editButtons()[1].props.onPress());
      await act(async () =>
        input("Edit comment").props.onChangeText("Other edited draft"),
      );
      await act(async () => editButtons()[0].props.onPress());
      expect(input("Edit comment").props.value).toBe("Edited draft");
      await act(async () => button(tree, "Close comment 1").props.onPress());
      expect(
        tree.root.findAllByProps({ testID: "review-inline" }),
      ).toHaveLength(0);
      await act(async () => button(tree, "Open comment 1").props.onPress());
      expect(input("Edit comment").props.value).toBe("Edited draft");
      expect(input("Reply")).toBeUndefined();
      await act(async () => button(tree, "Resume comment").props.onPress());
      expect(input("Comment").props.value).toBe("New draft");
      await act(async () => tree.update(reviewView(canvas, "source")));
      expect(input("Comment").props.value).toBe("New draft");
      await act(async () => button(tree, "Save comment").props.onPress());
      expect(reviewCalls.mock.calls.at(-1)?.[1]).toMatchObject({
        mutation: { action: "create", selection, body: "New draft" },
      });
      // Failed saves preserve the form and the draft.
      expect(input("Comment").props.value).toBe("New draft");
      await act(async () => button(tree, "Comments (1)").props.onPress());
      await act(async () => button(tree, "Go to target").props.onPress());
      expect(input("Edit comment").props.value).toBe("Edited draft");
      await act(async () => button(tree, "Save").props.onPress());
      expect(reviewCalls.mock.calls.at(-1)?.[1]).toMatchObject({
        mutation: {
          action: "edit",
          messageId: thread.messages[0].id,
          body: "Edited draft",
        },
      });
      await act(async () => button(tree, "Cancel").props.onPress());
      await act(async () => editButtons()[1].props.onPress());
      expect(input("Edit comment").props.value).toBe("Other edited draft");
      await act(async () => button(tree, "Cancel").props.onPress());
      expect(input("Reply").props.value).toBe("Reply draft");
      await act(async () => button(tree, "Save reply").props.onPress());
      expect(reviewCalls.mock.calls.at(-1)?.[1]).toMatchObject({
        mutation: { action: "reply", body: "Reply draft" },
      });
      await act(async () => button(tree, "Resolve").props.onPress());
      expect(reviewCalls.mock.calls.at(-1)?.[1]).toMatchObject({
        mutation: { action: "status", resolved: true },
      });
      await act(async () => button(tree, "Close comment").props.onPress());
      expect(
        tree.root.findAllByProps({ testID: "review-inline" }),
      ).toHaveLength(0);
      expect(bodyView.props.style.flex).toBe(1);
      expect(button(tree, "Cancel selection")).toBeUndefined();
      expect(button(tree, "Comment mode")).toBeDefined();
    } finally {
      if (view) await act(async () => view!.unmount());
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
test("repeated Go to target opens a details ancestor that the user closed", async () => {
  const source =
    "<details>\n<summary>More</summary>\n\n# Inner\n\nBody\n\n</details>";
  const document = parseDocument(source);
  const bindings = {
    enabled: false,
    navigate: source.indexOf("Inner"),
    navigationRequest: 1,
    register: () => {},
    text: (value: string) => value,
    wrap: (_node: unknown, child: React.ReactNode) => child,
    select: () => {},
  };
  const render = (navigationRequest: number) => (
    <CanvasThemeProvider theme={theme}>
      <Markdown
        document={document}
        theme={theme}
        onError={() => {}}
        review={{ ...bindings, navigationRequest }}
      />
    </CanvasThemeProvider>
  );
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(render(1));
  });
  expect(button(view, "Collapse More")).toBeDefined();
  await act(async () => button(view, "Collapse More").props.onPress());
  expect(button(view, "Expand More")).toBeDefined();
  await act(async () => view.update(render(2)));
  expect(button(view, "Collapse More")).toBeDefined();
  await act(async () => view.unmount());
});

async function reviewSendFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "canvas-send-ui-"));
  const store = await CanvasStore.open(directory);
  const actor = {
    workspaceId: "workspace-a",
    agentId: "agent-a",
    sessionId: "session-a",
    title: "Test agent",
  };
  const created = await store.create(
    actor,
    "Review",
    "First paragraph.\n\nSecond paragraph.",
  );
  const { canvas } = await store.get(actor.workspaceId, created.canvasId);
  for (const [start, body] of [
    [0, "First request"],
    [18, "Second request"],
  ] as const) {
    queries.review = await store.reviews.mutate(
      actor.workspaceId,
      canvas.canvasId,
      {
        action: "create",
        selection: {
          documentRevision: 1,
          ranges: [
            {
              kind: "block",
              start,
              end: start + (start ? 17 : 16),
              selectedText: canvas.content.slice(
                start,
                start + (start ? 17 : 16),
              ),
            },
          ],
        },
        body,
      },
    );
  }
  return {
    canvas,
    store,
    threads: Object.values(queries.review!.state.threads),
    close: async () => {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
const sendRecipients = [
  { id: "agent-a", title: "First agent", running: false, blocked: false },
  { id: "agent-b", title: "Second agent", running: false, blocked: false },
];
function sentDelivery(
  threads: ReviewThread[],
  status: ReviewDelivery["attempts"][number]["status"] = "accepted",
): ReviewDelivery {
  return {
    id: "request-a",
    agentId: "agent-b",
    createdAt: threads[0].createdAt,
    prompt: "Review request",
    threads: threads.map((thread) => ({
      threadId: thread.id,
      threadRevision: thread.revision,
      anchor: thread.anchors[0],
      messages: thread.messages,
    })),
    attempts: [
      {
        id: "attempt-a",
        status,
        startedAt: threads[0].createdAt,
        finishedAt: threads[0].createdAt,
        error: status === "failed" ? "Agent unavailable" : null,
      },
    ],
  };
}

test.each(["web", "android", "ios"])(
  "%s sends a shared selection from the overview and document without losing drafts",
  async (platform) => {
    nativePlatform.OS = platform;
    const fixture = await reviewSendFixture();
    queries.recipients.data = sendRecipients;
    let view!: ReactTestRenderer;
    try {
      await act(async () => {
        view = create(reviewView(fixture.canvas, "preview"));
      });
      expect(button(view, "Send to agent")).toBeUndefined();
      await act(async () => button(view, "Comment mode").props.onPress());
      await act(async () =>
        view.root.findByProps({ testID: "review-target-0-16" }).props.onPress(),
      );
      await act(async () => button(view, "Add comment").props.onPress());
      const input = () =>
        view.root
          .findAllByType("TextInput" as never)
          .find((node) => node.props.accessibilityLabel === "Comment")!;
      await act(async () => input().props.onChangeText("Keep this draft"));
      await act(async () => button(view, "Comments (2)").props.onPress());
      expect(
        view.root
          .findByProps({ testID: "review-overview" })
          .findAllByType(ReviewSurface),
      ).toHaveLength(2);
      expect(view.root.findAllByType("SettingsSelect" as never)).toHaveLength(
        0,
      );
      await act(async () =>
        button(view, "Select comment 1 for sending").props.onPress(),
      );
      await act(async () =>
        button(view, "Select comment 2 for sending").props.onPress(),
      );
      expect(
        view.root.findByProps({ testID: "review-send-action" }),
      ).toBeDefined();
      await act(async () => button(view, "Send to agent").props.onPress());
      expect(view.root.findByType(SdkModal).props.title).toBe("Send to agent");
      expect(JSON.stringify(view.toJSON())).toContain("Selected comments");
      expect(button(view, "Send").props.disabled).toBeTruthy();
      expect(reviewCalls).not.toHaveBeenCalled();
      await act(async () =>
        view.root.findByType(SdkModal).props.onOpenChange(false),
      );
      expect(button(view, "Select comment 1 for sending").props.icon).toBe(
        "CheckSquare",
      );
      await act(async () => button(view, "Back to document").props.onPress());
      expect(input().props.value).toBe("Keep this draft");
      // Reading another discussion must not replace the sending selection.
      await act(async () =>
        view.root
          .findAllByType("Text" as never)
          .find(
            (node) =>
              node.props.onPress && node.props.children === "First paragraph.",
          )!
          .props.onPress(),
      );
      await act(async () => button(view, "Resume comment").props.onPress());
      expect(input().props.value).toBe("Keep this draft");
      await act(async () => button(view, "Send to agent").props.onPress());
      await act(async () =>
        view.root
          .findByType("SettingsSelect" as never)
          .props.onValueChange("agent-b"),
      );
      expect(button(view, "Send").props.disabled).toBeFalsy();
      reviewCalls.mockResolvedValueOnce(sentDelivery(fixture.threads));
      await act(async () => button(view, "Send").props.onPress());
      expect(reviewCalls).toHaveBeenCalledExactlyOnceWith(
        "canvas.review.send",
        {
          workspaceId: fixture.canvas.workspaceId,
          canvasId: fixture.canvas.canvasId,
          agentId: "agent-b",
          threads: fixture.threads.map((thread) => ({
            threadId: thread.id,
            expectedRevision: thread.revision,
          })),
          allowInterrupt: false,
        },
      );
      expect(view.root.findAllByType(SdkModal)).toHaveLength(0);
      expect(button(view, "Send to agent")).toBeUndefined();
      expect(input().props.value).toBe("Keep this draft");
      expect(host.show).toHaveBeenCalledWith("Comments sent to agent", {
        variant: "success",
      });
      expect(queries.reviewRefetch).toHaveBeenCalledOnce();
      await act(async () => button(view, "Open comment 1").props.onPress());
      await act(async () =>
        button(view, "Select comment 1 for sending").props.onPress(),
      );
      expect(button(view, "Send to agent")).toBeDefined();
      await act(async () =>
        button(view, "Select comment 1 for sending").props.onPress(),
      );
      expect(button(view, "Send to agent")).toBeUndefined();
    } finally {
      await act(async () => view?.unmount());
      await fixture.close();
    }
  },
);

test("send dialog handles unavailable recipients, interruption consent, errors, and duplicate taps", async () => {
  const fixture = await reviewSendFixture();
  const onClose = vi.fn(),
    onSent = vi.fn(),
    onRecorded = vi.fn();
  let view!: ReactTestRenderer;
  const render = () => (
    <CanvasThemeProvider theme={theme}>
      <ReviewSendDialog
        workspaceId={fixture.canvas.workspaceId}
        canvasId={fixture.canvas.canvasId}
        theme={theme}
        threads={fixture.threads}
        numbers={new Map(fixture.threads.map((t, i) => [t.id, i + 1]))}
        onClose={onClose}
        onSent={onSent}
        onRecorded={onRecorded}
      />
    </CanvasThemeProvider>
  );
  try {
    await act(async () => {
      view = create(render());
    });
    expect(JSON.stringify(view.toJSON())).toContain(
      "No agent sessions are available in this workspace.",
    );
    expect(button(view, "Send").props.disabled).toBeTruthy();
    queries.recipients.error = new Error("Recipients offline");
    await act(async () => view.update(render()));
    expect(JSON.stringify(view.toJSON())).toContain("Recipients offline");
    await act(async () => button(view, "Refresh sessions").props.onPress());
    expect(queries.recipients.refetch).toHaveBeenCalledOnce();
    queries.recipients.error = null;
    queries.recipients.data = [
      { ...sendRecipients[0], running: true },
      { ...sendRecipients[1], blocked: true },
    ];
    await act(async () => view.update(render()));
    const select = () => view.root.findByType("SettingsSelect" as never);
    await act(async () => select().props.onValueChange("agent-a"));
    expect(button(view, "Send").props.disabled).toBeTruthy();
    await act(async () => button(view, "Allow interruption").props.onPress());
    expect(button(view, "Send").props.disabled).toBeFalsy();
    await act(async () => select().props.onValueChange("agent-b"));
    expect(button(view, "Send").props.disabled).toBeTruthy();
    expect(JSON.stringify(view.toJSON())).toContain("pending permission");
    await act(async () => select().props.onValueChange("agent-a"));
    expect(button(view, "Send").props.disabled).toBeTruthy();
    await act(async () => button(view, "Allow interruption").props.onPress());
    reviewCalls.mockRejectedValueOnce(new Error("Session state changed"));
    await act(async () => button(view, "Send").props.onPress());
    expect(JSON.stringify(view.toJSON())).toContain("Session state changed");
    expect(onClose).not.toHaveBeenCalled();
    let finish!: (result: ReviewDelivery) => void;
    reviewCalls.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const submit = button(view, "Send").props.onPress;
    await act(async () => {
      submit();
      submit();
    });
    expect(reviewCalls).toHaveBeenCalledTimes(2);
    expect(button(view, "Sending…").props.disabled).toBeTruthy();
    expect(select().props.disabled).toBe(true);
    await act(async () =>
      view.root.findByType(SdkModal).props.onOpenChange(false),
    );
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish(sentDelivery(fixture.threads)));
    expect(reviewCalls.mock.calls.at(-1)?.[1]).toMatchObject({
      agentId: "agent-a",
      allowInterrupt: true,
    });
    expect(onSent).toHaveBeenCalledWith(fixture.threads.map((t) => t.id));
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    await act(async () => view?.unmount());
    await fixture.close();
  }
});

test.each(["failed", "unknown"] as const)(
  "%s send result stays in the dialog and retries the recorded request explicitly",
  async (status) => {
    const fixture = await reviewSendFixture();
    queries.recipients.data = [sendRecipients[1]];
    const onClose = vi.fn(),
      onSent = vi.fn(),
      onRecorded = vi.fn();
    let view!: ReactTestRenderer;
    try {
      await act(async () => {
        view = create(
          <CanvasThemeProvider theme={theme}>
            <ReviewSendDialog
              workspaceId={fixture.canvas.workspaceId}
              canvasId={fixture.canvas.canvasId}
              theme={theme}
              threads={fixture.threads}
              numbers={new Map(fixture.threads.map((t, i) => [t.id, i + 1]))}
              onClose={onClose}
              onSent={onSent}
              onRecorded={onRecorded}
            />
          </CanvasThemeProvider>,
        );
      });
      reviewCalls.mockResolvedValueOnce(sentDelivery(fixture.threads, status));
      await act(async () => button(view, "Send").props.onPress());
      expect(onClose).not.toHaveBeenCalled();
      expect(onSent).not.toHaveBeenCalled();
      expect(
        view.root.findByType("SettingsSelect" as never).props.disabled,
      ).toBe(true);
      const label =
        status === "unknown" ? "Retry (may send twice)" : "Retry request";
      expect(button(view, label)).toBeDefined();
      expect(reviewCalls).toHaveBeenCalledOnce();
      reviewCalls.mockResolvedValueOnce(sentDelivery(fixture.threads));
      await act(async () => button(view, label).props.onPress());
      expect(reviewCalls.mock.calls.at(-1)).toEqual([
        "canvas.review.retry",
        {
          workspaceId: fixture.canvas.workspaceId,
          canvasId: fixture.canvas.canvasId,
          requestId: "request-a",
          allowInterrupt: false,
        },
      ]);
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      await act(async () => view?.unmount());
      await fixture.close();
    }
  },
);

test.each(["web", "android", "ios"])(
  "%s sends one comment from either view without including other checked comments",
  async (platform) => {
    nativePlatform.OS = platform;
    const fixture = await reviewSendFixture();
    queries.recipients.data = [sendRecipients[1]];
    let view!: ReactTestRenderer;
    try {
      await act(async () => {
        view = create(reviewView(fixture.canvas, "preview"));
      });
      await act(async () => button(view, "Comments (2)").props.onPress());
      await act(async () =>
        button(view, "Select comment 1 for sending").props.onPress(),
      );
      for (const location of ["overview", "document"]) {
        if (location === "document") {
          await act(async () =>
            button(view, "Back to document").props.onPress(),
          );
          await act(async () => button(view, "Open comment 2").props.onPress());
        }
        await act(async () =>
          button(view, "Send comment 2 to agent").props.onPress(),
        );
        const dialog = view.root.findByType(ReviewSendDialog);
        expect(dialog.props.threads.map((t: ReviewThread) => t.id)).toEqual([
          fixture.threads[1].id,
        ]);
        expect(reviewCalls).not.toHaveBeenCalled();
        await act(async () =>
          view.root.findByType(SdkModal).props.onOpenChange(false),
        );
        expect(view.root.findAllByType(SdkModal)).toHaveLength(0);
      }
      await act(async () =>
        button(view, "Send comment 2 to agent").props.onPress(),
      );
      reviewCalls.mockResolvedValueOnce(sentDelivery([fixture.threads[1]]));
      await act(async () => button(view, "Send").props.onPress());
      expect(reviewCalls).toHaveBeenCalledExactlyOnceWith(
        "canvas.review.send",
        {
          workspaceId: fixture.canvas.workspaceId,
          canvasId: fixture.canvas.canvasId,
          agentId: "agent-b",
          threads: [
            {
              threadId: fixture.threads[1].id,
              expectedRevision: fixture.threads[1].revision,
            },
          ],
          allowInterrupt: false,
        },
      );
      expect(view.root.findAllByType(SdkModal)).toHaveLength(0);
      await act(async () => button(view, "Send to agent").props.onPress());
      expect(
        view.root
          .findByType(ReviewSendDialog)
          .props.threads.map((t: ReviewThread) => t.id),
      ).toEqual([fixture.threads[0].id]);
    } finally {
      await act(async () => view?.unmount());
      await fixture.close();
    }
  },
);

test("comment badges toggle at their own target and move a shared thread to another target", async () => {
  const fixture = await reviewSendFixture();
  const thread = fixture.threads[0];
  queries.review = await fixture.store.reviews.mutate(
    fixture.canvas.workspaceId,
    fixture.canvas.canvasId,
    {
      action: "reattach",
      threadId: thread.id,
      expectedRevision: thread.revision,
      selection: {
        documentRevision: fixture.canvas.revision,
        ranges: fixture.threads.flatMap((t) =>
          t.anchors[0].ranges.map(({ kind, start, end, selectedText }) => ({
            kind,
            start,
            end,
            selectedText,
          })),
        ),
      },
    },
  );
  let view!: ReactTestRenderer;
  try {
    await act(async () => {
      view = create(reviewView(fixture.canvas, "preview"));
    });
    const target = (id: string) =>
      view.root.findByProps({ testID: id }).parent!;
    const first = () => target("review-target-0-16");
    const second = () => target("review-target-18-35");
    await act(async () => button(view, "Open comment 1").props.onPress());
    expect(first().findAllByProps({ testID: "review-inline" })).toHaveLength(1);
    const reply = () =>
      view.root
        .findAllByType("TextInput" as never)
        .find((node) => node.props.accessibilityLabel === "Reply")!;
    await act(async () => reply().props.onChangeText("返信の下書き"));
    await act(async () => button(view, "Open comment 1").props.onPress());
    expect(first().findAllByProps({ testID: "review-inline" })).toHaveLength(0);
    expect(second().findAllByProps({ testID: "review-inline" })).toHaveLength(
      1,
    );
    expect(reply().props.value).toBe("返信の下書き");
    await act(async () => button(view, "Close comment 1").props.onPress());
    expect(view.root.findAllByProps({ testID: "review-inline" })).toHaveLength(
      0,
    );
    await act(async () => button(view, "Open comment 1").props.onPress());
    expect(first().findAllByProps({ testID: "review-inline" })).toHaveLength(1);
    expect(reply().props.value).toBe("返信の下書き");
  } finally {
    await act(async () => view?.unmount());
    await fixture.close();
  }
});

test.each(["web", "android", "ios"])(
  "%s closing a new comment returns to comment mode with editable selections and the draft intact",
  async (platform) => {
    nativePlatform.OS = platform;
    const canvas = reviewCanvas("# Heading\n\nFirst paragraph.\n");
    for (const mode of ["preview", "source"] as const) {
      let view!: ReactTestRenderer;
      try {
        await act(async () => {
          view = create(reviewView(canvas, mode));
        });
        const target = (index: number) => {
          const range = sourceRange(
            reviewTargets(parseDocument(canvas.content))[index],
          )!;
          return view.root.findByProps({
            testID: `review-target-${range.start}-${range.end}`,
          });
        };
        await act(async () => button(view, "Comment mode").props.onPress());
        await act(async () => target(0).props.onPress());
        await act(async () => target(1).props.onPress());
        await act(async () => button(view, "Add comment").props.onPress());
        const input = () =>
          view.root
            .findAllByType("TextInput" as never)
            .find((node) => node.props.accessibilityLabel === "Comment")!;
        await act(async () => input().props.onChangeText("コメントの下書き"));
        await act(async () => button(view, "Close comment").props.onPress());
        expect(
          view.root.findAllByProps({ testID: "review-inline" }),
        ).toHaveLength(0);
        expect(button(view, "Cancel selection")).toBeDefined();
        expect(button(view, "Comment mode")).toBeUndefined();
        expect(button(view, "Resume comment")).toBeUndefined();
        expect(button(view, "Add comment")).toBeDefined();
        expect(target(0).props["aria-checked"]).toBe(true);
        expect(target(1).props["aria-checked"]).toBe(true);
        await act(async () => target(0).props.onPress());
        expect(target(0).props["aria-checked"]).toBe(false);
        expect(target(1).props["aria-checked"]).toBe(true);
        await act(async () => button(view, "Add comment").props.onPress());
        expect(input().props.value).toBe("コメントの下書き");
        await act(async () => button(view, "Close comment").props.onPress());
        await act(async () => button(view, "Cancel selection").props.onPress());
        expect(button(view, "Comment mode")).toBeDefined();
        expect(button(view, "Add comment")).toBeUndefined();
        expect(target(1).props.onPress).toBeUndefined();
        expect(reviewCalls).not.toHaveBeenCalled();
      } finally {
        await act(async () => view?.unmount());
      }
    }
  },
);

test.each(["web", "ios", "android"])("canvas creation keeps title and Markdown across preview and layout changes (%s)", async (platform) => {
  nativePlatform.OS = platform;
  let view!: ReactTestRenderer;
  reviewCalls.mockImplementation(async (name, input) => {
    if (name === "canvas.user.preview") return { document: parseDocument((input as { content: string }).content) };
    return undefined;
  });
  await act(async () => { view = create(panel(false)); });
  await act(async () => button(view, "New canvas").props.onPress());
  expect(button(view, "Save").props.disabled).toBe(true);
  const input = (label: string) => view.root.findAllByType("TextInput" as never).find((node) => node.props.accessibilityLabel === label)!;
  await act(async () => {
    input("Canvas title").props.onChangeText("My canvas");
    input("Canvas Markdown content").props.onChangeText("# My draft");
  });
  expect(button(view, "Save").props.disabled).toBe(false);
  await act(async () => button(view, "Preview").props.onPress());
  expect(JSON.stringify(view.toJSON())).toContain("My draft");
  await act(async () => { view.update(panel(true)); });
  await act(async () => button(view, "Markdown").props.onPress());
  expect(input("Canvas title").props.value).toBe("My canvas");
  expect(input("Canvas Markdown content").props.value).toBe("# My draft");
  expect(reviewCalls.mock.calls.some(([name]) => name === "canvas.user.create")).toBe(false);
  await act(async () => button(view, "Cancel").props.onPress());
  expect(view.root.findAllByType(SdkModal).some((node) => node.props.open && node.props.title === "Discard changes?")).toBe(true);
  await act(async () => button(view, "Keep editing").props.onPress());
  expect(input("Canvas Markdown content").props.value).toBe("# My draft");
  await act(async () => view.unmount());
});

test("canvas editing refreshes a lease on foreground and releases it on unmount", async () => {
  const canvas = { ...summary, editState: { status: "unlocked" }, content: "Original" };
  queries.detail.data = { canvas, document: parseDocument("Original") };
  const acquired = { ...canvas, editState: { status: "locked", lock: { id: "user-lock", owner: { role: "user" }, ownerTitle: null, acquiredAt: new Date().toISOString(), renewedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300_000).toISOString() } } };
  reviewCalls.mockImplementation(async (name) => {
    if (name === "canvas.user.begin") return { ok: true, value: { canvas: acquired, lockToken: "secret" } };
    if (name === "canvas.user.renew") return { ok: true, value: { editState: acquired.editState } };
    if (name === "canvas.user.cancel") return { ok: true, value: { editState: { status: "unlocked" } } };
    return undefined;
  });
  let view!: ReactTestRenderer;
  await act(async () => { view = create(panel(false)); });
  await act(async () => button(view, "Edit").props.onPress());
  expect(JSON.stringify(view.toJSON())).toContain("Edit canvas");
  expect(button(view, "Save").props.disabled).toBe(true);
  await act(async () => lifecycle.listener?.("background"));
  await act(async () => lifecycle.listener?.("active"));
  expect(reviewCalls.mock.calls.some(([name]) => name === "canvas.user.renew")).toBe(true);
  await act(async () => view.unmount());
  expect(reviewCalls.mock.calls.some(([name, input]) => name === "canvas.user.cancel" && (input as { lockToken: string }).lockToken === "secret")).toBe(true);
});

const textOf = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
const hostCommon = {
  theme,
  host: { id: "host", label: "Host" },
  layout: { compact: false, platform: "web" as const },
};

test("document links follow the link setting and the client's browser support", async () => {
  const content =
    "[Docs](https://example.com/docs) and [Mail](mailto:team@example.com)";
  queries.detail.data = {
    canvas: { ...summary, content },
    document: parseDocument(content),
  };
  const openBrowser = vi.fn();
  const render = (navigation?: object) => (
    <CanvasPanel
      {...hostCommon}
      workspaceId="workspace-a"
      navigation={navigation as never}
    />
  );
  const link = (label: string) =>
    view.root.findAll(
      (node) =>
        node.type === ("Text" as never) &&
        node.props.accessibilityRole === "link" &&
        textOf(node) === label,
    )[0];
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(render({ openBrowser, openAgent: vi.fn() }));
  });
  await act(async () => link("Docs").props.onPress());
  expect(openBrowser).toHaveBeenCalledWith({
    url: "https://example.com/docs",
    workspaceId: "workspace-a",
    serverId: "host",
  });
  await act(async () => link("Mail").props.onPress());
  expect(Linking.openURL).toHaveBeenCalledWith("mailto:team@example.com");
  expect(sdk.openExternalUrl).not.toHaveBeenCalled();

  sdk.device = { ...sdk.device, openLinksIn: "system" };
  await act(async () => view.update(render({ openBrowser })));
  await act(async () => link("Docs").props.onPress());
  expect(sdk.openExternalUrl).toHaveBeenCalledWith("https://example.com/docs");
  expect(openBrowser).toHaveBeenCalledOnce();

  // Browser web and mobile clients have no workspace browser.
  sdk.device = { ...sdk.device, openLinksIn: "workspace-browser" };
  await act(async () => view.update(render(undefined)));
  await act(async () => link("Docs").props.onPress());
  expect(sdk.openExternalUrl).toHaveBeenCalledTimes(2);

  openBrowser.mockImplementation(() => {
    throw new Error("Workspace is unavailable on the requested host.");
  });
  await act(async () => view.update(render({ openBrowser })));
  await act(async () => link("Docs").props.onPress());
  expect(JSON.stringify(view.toJSON())).toContain("Unable to open the link");
  await act(async () => view.unmount());
});

test("the full-page screen opens its params' canvas with workspace and host context", async () => {
  const { CanvasScreen } = await import("../client/screen");
  const openWorkspace = vi.fn();
  const render = (params: Record<string, string>) => (
    <CanvasScreen
      {...hostCommon}
      params={params}
      navigation={{ openWorkspace, openAgent: vi.fn() }}
    />
  );
  const output = () => JSON.stringify(view.toJSON());
  const labels = () =>
    view.root
      .findAllByType(Button)
      .map((item) => item.props.accessibilityLabel ?? item.props.label);
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(render({ workspaceId: "workspace-a", canvasId: "canvas-b" }));
  });
  expect(queries.inputs).toHaveBeenCalledWith("canvas.get", {
    workspaceId: "workspace-a",
    canvasId: "canvas-b",
  });
  expect(output()).toContain("Workspace A");
  expect(labels()).not.toContain("Open in full screen");
  await act(async () => button(view, "Open workspace").props.onPress());
  expect(openWorkspace).toHaveBeenCalledWith({
    workspaceId: "workspace-a",
    serverId: "host",
  });

  queries.inputs.mockClear();
  await act(async () =>
    view.update(render({ workspaceId: "workspace-a", canvasId: "canvas-a" })),
  );
  expect(queries.inputs).toHaveBeenCalledWith("canvas.get", {
    workspaceId: "workspace-a",
    canvasId: "canvas-a",
  });

  sdk.hosts = [{ serverId: "host", label: "Host", status: "offline" }];
  sdk.workspace = null;
  await act(async () =>
    view.update(render({ workspaceId: "workspace-a", canvasId: "canvas-a" })),
  );
  expect(output()).toContain(
    "Host is offline. Canvas changes appear after it reconnects.",
  );
  expect(output()).toContain("Workspace unavailable");
  expect(labels()).not.toContain("Open workspace");

  await act(async () => view.update(render({ workspaceId: "../escape" })));
  expect(output()).toContain("No workspace selected");
  await act(async () => view.unmount());
});

test("the sidebar row lists recent canvases across workspaces and opens one full page", async () => {
  const { CanvasSidebarItem, RecentCanvasesPopover } = await import(
    "../client/sidebar"
  );
  const openPopover = vi.fn();
  const item = (screenId: string | null) => (
    <CanvasSidebarItem
      {...hostCommon}
      currentScreen={screenId ? { screenId, params: {} } : null}
      openScreen={vi.fn()}
      openPopover={openPopover}
    />
  );
  let sidebar!: ReactTestRenderer;
  await act(async () => {
    sidebar = create(item(null));
  });
  const row = () => sidebar.root.findByType("SidebarRow" as never);
  expect(row().props).toMatchObject({ icon: "NotebookPen", active: false });
  row().props.onPress();
  expect(openPopover).toHaveBeenCalledWith(RecentCanvasesPopover);
  await act(async () => sidebar.update(item("canvas")));
  expect(row().props.active).toBe(true);

  queries.recent.data = {
    items: [
      { ...summary, workspaceName: "Workspace A" },
      {
        ...summary,
        workspaceId: "workspace-b",
        canvasId: "canvas-c",
        title: "Notes",
        editState: { status: "unlocked" },
        workspaceName: "Workspace B",
      },
    ],
  };
  const openScreen = vi.fn();
  const popover = () => (
    <RecentCanvasesPopover
      {...hostCommon}
      close={vi.fn()}
      openScreen={openScreen}
    />
  );
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(popover());
  });
  expect(queries.inputs).toHaveBeenCalledWith("canvas.recent", { limit: 10 });
  expect(JSON.stringify(view.toJSON())).toContain(
    "Workspace A · Being edited by Agent A",
  );
  expect(JSON.stringify(view.toJSON())).toContain("Workspace B · Unlocked");
  await act(async () =>
    view.root
      .findAll(
        (node) =>
          node.type === ("Pressable" as never) &&
          node.props.accessibilityLabel === "Open Notes",
      )[0]
      .props.onPress(),
  );
  expect(openScreen).toHaveBeenCalledWith({
    screenId: "canvas",
    params: { workspaceId: "workspace-b", canvasId: "canvas-c" },
  });

  queries.recent.data = { items: [] };
  await act(async () => view.update(popover()));
  expect(JSON.stringify(view.toJSON())).toContain("No canvases yet");
  queries.recent.data = undefined;
  queries.recent.error = new Error("Canvas store is closed");
  await act(async () => view.update(popover()));
  expect(JSON.stringify(view.toJSON())).toContain(
    "Unable to load canvases: Canvas store is closed",
  );
  sdk.hosts = [{ serverId: "host", label: "Host", status: "connecting" }];
  await act(async () => view.update(popover()));
  expect(JSON.stringify(view.toJSON())).toContain("Connecting to Host…");
  await act(async () => {
    view.unmount();
    sidebar.unmount();
  });
});

test("the settings screen saves each preference immediately and links to the documentation", async () => {
  const { CanvasSettingsScreen } = await import("../client/settings");
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<CanvasSettingsScreen {...hostCommon} />);
  });
  const toggle = view.root.findByType("SettingsSwitch" as never);
  expect(toggle.props.value).toBe(true);
  await act(async () => toggle.props.onValueChange(false));
  // Notifications belong to the host; the link target to this device.
  expect(sdk.save).toHaveBeenLastCalledWith(
    { timelineNotifications: false },
    "revision-1",
  );
  const select = view.root.findByType("SettingsSelect" as never);
  expect(select.props.value).toBe("workspace-browser");
  await act(async () => select.props.onValueChange("system"));
  expect(sdk.saveDevice).toHaveBeenLastCalledWith(
    { openLinksIn: "system" },
    "device-1",
  );
  expect(sdk.save).toHaveBeenCalledOnce();
  const text = JSON.stringify(view.toJSON());
  expect(text).toContain("Applies to every client of this host.");
  expect(text).toContain("Applies only to this device.");
  expect(view.root.findByType("ExternalLink" as never).props.href).toBe(
    "https://github.com/supermomonga/paseo-plugin-canvas#readme",
  );
  await act(async () => view.unmount());
});

test("the panel restores its tab's canvas and list layout, and marks the tab modified while a draft differs", async () => {
  const tab = {
    state: { canvasId: "canvas-b", listOpen: false, listSide: "right" },
    setState: vi.fn(),
    setModified: vi.fn(),
  };
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(panel(false, tab));
  });
  expect(queries.inputs).toHaveBeenCalledWith("canvas.get", {
    workspaceId: "workspace-a",
    canvasId: "canvas-b",
  });
  // The restored layout keeps the list closed until the reader opens it.
  expect(button(view, "New canvas")).toBeUndefined();
  await act(async () => button(view, "Show canvas list").props.onPress());
  expect(tab.setState).toHaveBeenLastCalledWith({
    canvasId: "canvas-b",
    listOpen: true,
    listSide: "right",
  });
  tab.state = tab.setState.mock.lastCall![0];
  await act(async () => view.update(panel(false, { ...tab })));
  expect(tab.setModified).not.toHaveBeenCalledWith(true);
  await act(async () => button(view, "New canvas").props.onPress());
  const input = (label: string) =>
    view.root
      .findAllByType("TextInput" as never)
      .find((node) => node.props.accessibilityLabel === label)!;
  await act(async () => input("Canvas title").props.onChangeText("Draft"));
  // Paseo asks before closing a tab with unsaved changes.
  expect(tab.setModified).toHaveBeenLastCalledWith(true);
  await act(async () => input("Canvas title").props.onChangeText(""));
  expect(tab.setModified).toHaveBeenLastCalledWith(false);
  await act(async () => input("Canvas title").props.onChangeText("Draft"));
  await act(async () => view.unmount());
  expect(tab.setModified).toHaveBeenLastCalledWith(false);
});

test("/canvas opens the panel at the best title match and reports a miss", async () => {
  const { default: contribute } = await import("../index.client");
  const registered = {
    slash: [] as any[],
    panels: [] as any[],
  };
  const client = {
    openPanel: vi.fn(),
    openScreen: vi.fn(),
    i18n: {
      t: (_messages: unknown, key: string, options: { query: string }) =>
        `${key}:${options.query}`,
      locale: "en",
    },
    addSlashCommand: (entry: any) => (registered.slash.push(entry), () => {}),
    addWorkspacePanel: (entry: any) => (registered.panels.push(entry), () => {}),
  } as Record<string, unknown>;
  for (const name of [
    "addTimelineRenderer",
    "addScreen",
    "addSidebarHeaderItem",
    "addSettingsScreen",
    "addCommandCenterItem",
    "addAttachmentSource",
  ])
    client[name] = () => () => {};
  const cleanup = contribute(client as unknown as PluginClientContext);
  const [command] = registered.slash;
  const Panel = registered.panels[0].Component;
  const items = [
    { ...summary, canvasId: "older", title: "Plan notes", updatedAt: "2026-09-01T00:00:00Z" },
    { ...summary, canvasId: "newer", title: "Release plan", updatedAt: "2026-09-02T00:00:00Z" },
    { ...summary, canvasId: "exact", title: "Plan", updatedAt: "2026-08-01T00:00:00Z" },
  ];
  const rpc = vi.fn(async () => ({ items }));
  const openPanel = vi.fn();
  const context = (args: string) => ({
    args,
    rpc,
    openPanel,
    workspace: { id: "workspace-a" },
  });
  const tab = { state: undefined, setState: vi.fn(), setModified: vi.fn() };
  let view!: ReactTestRenderer;
  try {
    await act(async () => {
      view = create(
        <Panel {...hostCommon} tab={tab} workspaceId="workspace-a" />,
      );
    });
    queries.inputs.mockClear();
    // An exact title wins over newer partial matches.
    await act(async () => command.onSubmit(context("  plan ")));
    expect(openPanel).toHaveBeenCalledWith("canvas");
    expect(rpc).toHaveBeenCalledWith(
      expect.objectContaining({ name: "canvas.list" }),
      { workspaceId: "workspace-a" },
    );
    expect(queries.inputs).toHaveBeenCalledWith("canvas.get", {
      workspaceId: "workspace-a",
      canvasId: "exact",
    });
    await expect(command.onSubmit(context("nothing"))).rejects.toThrow(
      "plugin.noMatch:nothing",
    );
    // Without arguments the command only opens the panel.
    rpc.mockClear();
    await command.onSubmit(context(""));
    expect(rpc).not.toHaveBeenCalled();
    expect(openPanel).toHaveBeenCalledTimes(3);
  } finally {
    await act(async () => {
      view?.unmount();
      cleanup();
    });
  }
});

test("findCanvas prefers an exact title, then a prefix, then a contained title, newest first", async () => {
  const { findCanvas } = await import("../client/commands");
  const items = [
    { title: "Roadmap", updatedAt: "2026-09-03T00:00:00Z" },
    { title: "Ｐｌａｎ　ｒｅｖｉｅｗ", updatedAt: "2026-09-01T00:00:00Z" },
    { title: "Plan notes", updatedAt: "2026-09-02T00:00:00Z" },
    { title: "Release plan", updatedAt: "2026-09-04T00:00:00Z" },
  ];
  expect(findCanvas(items, "plan")?.title).toBe("Plan notes");
  // Full-width text and repeated spaces normalize like the typed query.
  expect(findCanvas(items, "plan  review")?.title).toBe("Ｐｌａｎ　ｒｅｖｉｅｗ");
  expect(findCanvas(items, "lease")?.title).toBe("Release plan");
  expect(findCanvas(items, "roadmap")?.title).toBe("Roadmap");
  expect(findCanvas(items, "missing")).toBeNull();
  expect(findCanvas(items, "   ")).toBeNull();
});

test("interface text follows the app language, with English for missing keys", async () => {
  appLocale.current = "ja";
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(panel(false));
  });
  const text = JSON.stringify(view.toJSON());
  expect(text).toContain("2 件");
  expect(button(view, "新しい Canvas")).toBeDefined();
  expect(button(view, "詳細")).toBeDefined();
  await act(async () => view.unmount());
  const { CanvasActivityRow } = await import("../client/activity");
  let row!: ReactTestRenderer;
  await act(async () => {
    row = create(
      <CanvasActivityRow
        {...hostCommon}
        agentId="agent-a"
        timestamp={new Date()}
        item={{
          type: "plugin",
          kind: "canvas-activity",
          version: 1,
          data: {
            workspaceId: "workspace-a",
            canvasId: "canvas-a",
            title: "実装プラン",
            revision: 2,
            action: "updated",
            warningCount: 0,
            savedAt: "2026-09-12T00:00:00Z",
          },
        }}
        onOpen={() => {}}
      />,
    );
  });
  expect(JSON.stringify(row.toJSON())).toContain(
    "Canvas を更新 · リビジョン 2",
  );
  expect(button(row, "Canvas を開く: 実装プラン")).toBeDefined();
  await act(async () => row.unmount());
});
