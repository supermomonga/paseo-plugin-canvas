import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CanvasStore } from "../server/store";
import { Modal as SdkModal } from "@getpaseo/plugin/client/react-native";
vi.mock("@getpaseo/plugin/client/ui", () => ({ SettingsSelect: () => null }));
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
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (contract: { name: string }) => async (input: unknown) =>
    reviewCalls(contract.name, input),
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
vi.mock("@getpaseo/plugin/client/react-native", () => ({
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
}));
const queries = vi.hoisted(() => ({
  review: undefined as import("../shared/review").ReviewResult | undefined,
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
}));
const mediaResult = vi.hoisted(() => ({
  data: undefined,
  error: new Error("描画または読み込みに失敗"),
  refetch: vi.fn(),
}));
vi.mock("paseo-plugin-helper/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("paseo-plugin-helper/client")>()),
  useRpcQuery: (contract: { name: string }, input: unknown) => {
    queries.inputs(contract.name, input);
    if (contract.name.startsWith("canvas.review."))
      return {
        data:
          contract.name === "canvas.review.get" ? queries.review : undefined,
        error: null,
        refetch: vi.fn(),
        isFetching: false,
      };
    return contract.name === "canvas.list"
      ? queries.list
      : contract.name === "canvas.get"
        ? queries.detail
        : mediaResult;
  },
}));
import {
  initClientHelpers,
  PluginThemeProvider,
  Button,
  Tabs,
  Badge,
  CodeBlock,
} from "paseo-plugin-helper/client";
initClientHelpers({
  Icon: () => null,
  Modal: Object.assign(() => null, { Content: () => null }),
  useRpc: (contract) => async (input) => reviewCalls(contract.name, input),
  useToast: () => ({ show: () => {}, copied: () => {}, error: () => {} }),
});
import { parseDocument } from "../server/document";
import { Markdown, safeLink } from "../client/markdown";
import { ReviewDocument } from "../client/review";
import { reviewTargets, sourceRange } from "../shared/review-targets";
import type { Canvas } from "../shared/contracts";
import { CanvasPanel } from "../client/panel";
import contribute from "../index.client";
import { startActivitySync } from "../client/activity";
import type { PluginClientContext } from "@getpaseo/plugin/client";
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
      <PluginThemeProvider theme={theme}>
        <Markdown
          document={parseDocument(content)}
          theme={theme}
          onError={() => {}}
        />
      </PluginThemeProvider>,
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
  canvasId: "canvas-a",
  title: "実装プラン",
  revision: 2,
  editState: {
    status: "locked",
    lock: {
      ownerAgentId: "agent-a",
      ownerAgentTitle: "Agent A",
      acquiredAt: "2026-09-11T09:00:00Z",
      renewedAt: "2026-09-11T09:01:00Z",
      expiresAt: "2026-09-11T09:05:00Z",
    },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  nativePlatform.OS = "web";
  queries.review = undefined;
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
function panel(compact: boolean) {
  return (
    <CanvasPanel
      context="workspace"
      workspaceId="workspace-a"
      host={{ id: "host", label: "Host" }}
      theme={theme}
      layout={{ compact, platform: "web" }}
    />
  );
}
function button(view: ReactTestRenderer, label: string) {
  return view.root
    .findAllByType(Button)
    .find(
      (item) =>
        item.props.label === label || item.props.accessibilityLabel === label,
    )!;
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
  "list/detail navigation uses helper controls and preserves source and metadata access (compact=%s)",
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
  const comments = view.root.findByProps({ testID: "review-comments" });
  await act(async () => layout(0));
  expect(view.root.findByType(ReviewDocument)).toBe(document);
  expect(view.root.findByProps({ testID: "review-comments" })).toBe(comments);
  await act(async () => layout(1200));
  expect(view.root.findByType(ReviewDocument)).toBe(document);
  expect(view.root.findByProps({ testID: "review-comments" })).toBe(comments);
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
  expect(button(view, "Move canvas list to left")).toBeDefined();
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

test("an empty workspace keeps list controls reachable while collapsed", async () => {
  queries.list.data = { items: [] };
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(panel(false));
  });
  await act(async () => button(view, "Hide canvas list").props.onPress());
  await act(async () =>
    button(view, "Move canvas list to right").props.onPress(),
  );
  await act(async () => button(view, "Show canvas list").props.onPress());
  expect(JSON.stringify(view.toJSON())).toContain("No canvases yet");
  await act(async () => view.unmount());
});

test("tables use measured content widths, preserve column alignment, and scroll only below readable widths", async () => {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <PluginThemeProvider theme={theme}>
        <Markdown
          theme={theme}
          onError={() => {}}
          document={parseDocument(
            "| Character | Relationship |\n| :--- | ---: |\n| 鹿目まどか | 全ての中心。ほむらに執着され、さやかの親友、マミの後輩 |\n\n> | A | B | C |\n> | --- | --- | --- |\n> | 1 | 2 | 3 |",
          )}
        />
      </PluginThemeProvider>,
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
      <PluginThemeProvider theme={theme}>
        <Markdown
          theme={theme}
          onError={() => {}}
          document={parseDocument(
            "[**重要**と`code`](https://example.com)\n\n<details>\n<summary>補足</summary>\n\n非表示の本文\n\n</details>\n\n<details open>\n<summary>開いた補足</summary>\n\n初期表示の本文\n\n</details>",
          )}
        />
      </PluginThemeProvider>,
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
      <PluginThemeProvider theme={theme}>
        <Markdown
          theme={theme}
          onNavigate={navigate}
          onError={error}
          document={parseDocument(
            "[移動](#見出し) [不明](#unknown)\n\n<details>\n<summary>閉じた詳細</summary>\n\n## 見出し\n\n中身\n\n</details>",
          )}
        />
      </PluginThemeProvider>,
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
      <PluginThemeProvider theme={theme}>
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
      </PluginThemeProvider>,
    );
  });
  expect(JSON.stringify(view.toJSON())).toContain("Failed to render");
  expect(JSON.stringify(view.toJSON())).toContain("Unable to display image");
  await act(async () => button(view, "Retry").props.onPress());
  expect(mediaResult.refetch).toHaveBeenCalled();
  expect(button(view, "Show source")).toBeDefined();
  await act(async () => view.unmount());
});

test("Mermaid uses native views, supports zoom/reset and source inspection without an RPC", async () => {
  const { Mermaid } = await import("../client/mermaid/viewer");
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <PluginThemeProvider
        theme={theme}
        layout={{ compact: true, platform: "ios" }}
      >
        <Mermaid
          source={"flowchart LR\nA[計画] --> B[実装]"}
          theme={theme}
          width={280}
        />
      </PluginThemeProvider>,
    );
  });
  const buttons = () => tree.root.findAllByType(Button);
  const scale = () =>
    tree.root
      .findAllByType("Text" as any)
      .find((node) =>
        String(node.props.accessibilityLabel).startsWith("Zoom "),
      )!.props.children;
  const initial = scale().join("");
  await act(async () => {
    buttons()
      .find((node) => node.props.label === "Zoom in")!
      .props.onPress();
  });
  expect(scale().join("")).not.toBe(initial);
  await act(async () => {
    buttons()
      .find((node) => node.props.label === "Fit to view")!
      .props.onPress();
  });
  expect(scale().join("")).toBe(initial);
  await act(async () => {
    buttons()
      .find((node) => node.props.label === "Show code")!
      .props.onPress();
  });
  await act(async () =>
    tree.root
      .findByProps({ testID: "mermaid-popup-body" })
      .props.onLayout({ nativeEvent: { layout: { width: 950, height: 700 } } }),
  );
  expect(tree.root.findByType(CodeBlock).props.code).toContain("A[計画]");
  expect(JSON.stringify(tree.toJSON())).not.toContain("iframe");
  await act(async () => tree.unmount());
});

test("Mermaid exposes unsupported sequence blocks instead of showing an incomplete diagram", async () => {
  const { Mermaid } = await import("../client/mermaid/viewer");
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <PluginThemeProvider
        theme={theme}
        layout={{ compact: true, platform: "android" }}
      >
        <Mermaid
          source={"sequenceDiagram\nA->>B: hello\nloop retry\nend"}
          theme={theme}
          width={280}
        />
      </PluginThemeProvider>,
    );
  });
  expect(JSON.stringify(tree.toJSON())).toContain(
    "Unsupported or unrecognized syntax",
  );
  expect(
    tree.root.findAll((node) => node.props.testID === "mermaid-viewport"),
  ).toHaveLength(0);
  await act(async () => tree.unmount());
});

test.each(["web", "ios", "android"] as const)(
  "Mermaid on %s preserves document scrolling, handles pinch/pan and refits after resize",
  async (platform) => {
    nativePlatform.OS = platform;
    const { DiagramViewport } = await import("../client/mermaid/viewer");
    const { diagramModel } = await import("../shared/mermaid/model");
    const { fitted } = await import("../shared/mermaid/viewport");
    const model = diagramModel(
      "flowchart LR\nA[Planning] --> B[Review] --> C[Implementation] --> D[Verification]",
    );
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <PluginThemeProvider theme={theme} layout={{ compact: true, platform }}>
          <DiagramViewport
            model={model}
            theme={theme}
            width={280}
            height={220}
          />
        </PluginThemeProvider>,
      );
    });
    const viewport = () =>
      tree.root.findByProps({ testID: "mermaid-viewport" });
    const drawing = () =>
      viewport().findAllByType("View" as never)[1].props.style;
    const touch = (xs: number[]) => ({
      nativeEvent: {
        touches: xs.map((x) => ({
          pageX: x + 20,
          pageY: 150,
          locationX: x,
          locationY: 100,
        })),
      },
    });
    const gesture = (dx: number, dy = 0) => ({ dx, dy });
    expect(
      viewport().props.onMoveShouldSetPanResponder(
        touch([100]),
        gesture(0, 20),
      ),
    ).toBe(false);
    await act(async () => {
      for (let i = 0; i < 3; i++)
        tree.root
          .findAllByType(Button)
          .find((n) => n.props.label === "Zoom in")!
          .props.onPress();
    });
    expect(
      viewport().props.onMoveShouldSetPanResponder(touch([100]), gesture(20)),
    ).toBe(true);
    const before = drawing().left;
    await act(async () => {
      viewport().props.onPanResponderGrant(touch([100]), gesture(10));
      viewport().props.onPanResponderMove(touch([120]), gesture(30));
    });
    expect(drawing().left - before).toBeCloseTo(20);
    const scale = drawing().transform[0].scale;
    expect(
      viewport().props.onStartShouldSetPanResponder(touch([80, 180])),
    ).toBe(true);
    await act(async () => {
      viewport().props.onPanResponderGrant(touch([80, 180]), gesture(0));
      viewport().props.onPanResponderMove(touch([55, 205]), gesture(0));
    });
    expect(drawing().transform[0].scale).toBeCloseTo(scale * 1.5);
    const pinchedX = drawing().left;
    await act(async () => {
      viewport().props.onPanResponderMove(touch([100]), gesture(30));
      viewport().props.onPanResponderMove(touch([90]), gesture(20));
    });
    expect(drawing().left - pinchedX).toBeCloseTo(-10);
    await act(async () =>
      viewport().props.onLayout({
        nativeEvent: { layout: { width: 200, height: 220 } },
      }),
    );
    expect(drawing().transform[0].scale).toBeCloseTo(
      fitted(model, { width: 200, height: 220 }).scale,
    );
    await act(async () => tree.unmount());
  },
);

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
      <PluginThemeProvider theme={theme}>
        <DocumentImage src={src} alt="テスト画像" theme={theme} width={240} />
      </PluginThemeProvider>
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
    await act(async () => tree.root.findByType(Image).props.onError());
    expect(JSON.stringify(tree.toJSON())).toContain("Unable to display image");
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

test.each(["web", "ios", "android"] as const)(
  "Mermaid popup on %s fills measured space, switches to complete source and closes",
  async (platform) => {
    nativePlatform.OS = platform;
    const { Mermaid, DiagramViewport } = await import(
      "../client/mermaid/viewer"
    );
    const source = "sequenceDiagram\nA->>B: 共有";
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <PluginThemeProvider
          theme={theme}
          layout={{ compact: platform !== "web", platform }}
        >
          <Mermaid source={source} theme={theme} width={320} />
        </PluginThemeProvider>,
      );
    });
    await act(async () => button(tree, "Pop out").props.onPress());
    const popup = tree.root.findByProps({ testID: "mermaid-popup" });
    expect(popup.props.style).toMatchObject({ flex: 1, margin: 12 });
    await act(async () =>
      tree.root.findByProps({ testID: "mermaid-popup-body" }).props.onLayout({
        nativeEvent: { layout: { width: 950, height: 640 } },
      }),
    );
    const diagram = popup.findByType(DiagramViewport);
    expect(diagram.props.height).toBeUndefined();
    expect(diagram.props.width).toBe(950);
    const viewport = popup.findByProps({ testID: "mermaid-viewport" });
    expect(viewport.props.style.flex).toBe(1);
    await act(async () =>
      viewport.props.onLayout({
        nativeEvent: { layout: { width: 950, height: 550 } },
      }),
    );
    await act(async () =>
      diagram
        .findAllByType(Button)
        .find((n) => n.props.label === "Show code")!
        .props.onPress(),
    );
    expect(tree.root.findAllByType("NativeModal" as never)).toHaveLength(1);
    expect(popup.findByType(CodeBlock).props).toMatchObject({
      code: source,
      maxHeight: 640,
    });
    await act(async () =>
      tree.root.findByType("NativeModal" as never).props.onRequestClose(),
    );
    expect(tree.root.findAllByProps({ testID: "mermaid-popup" })).toHaveLength(
      0,
    );
    await act(async () => button(tree, "Show code").props.onPress());
    await act(async () => button(tree, "Close").props.onPress());
    expect(tree.root.findAllByProps({ testID: "mermaid-popup" })).toHaveLength(
      0,
    );
    await act(async () => tree.unmount());
  },
);

test("wheel zoom is local, follows the pointer, normalizes wheel units and cleans up", async () => {
  const { DiagramViewport } = await import("../client/mermaid/viewer");
  const { diagramModel } = await import("../shared/mermaid/model");
  let listener: ((event: any) => void) | undefined;
  const target = {
    addEventListener: vi.fn((_type, callback) => {
      listener = callback;
    }),
    removeEventListener: vi.fn((_type, callback) => {
      if (listener === callback) listener = undefined;
    }),
    getBoundingClientRect: () => ({
      left: 200,
      top: 100,
      width: 600,
      height: 440,
    }),
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <PluginThemeProvider theme={theme}>
        <DiagramViewport
          model={diagramModel(
            "flowchart LR\nA[Planning] --> B[Review] --> C[Implementation] --> D[Verification]",
          )}
          theme={theme}
          width={300}
          height={220}
        />
      </PluginThemeProvider>,
      {
        createNodeMock: (element) =>
          (element.props as { testID?: string }).testID === "mermaid-viewport"
            ? target
            : null,
      },
    );
  });
  expect(target.addEventListener).toHaveBeenCalledWith(
    "wheel",
    expect.any(Function),
    { passive: false },
  );
  const drawing = () =>
    tree.root
      .findByProps({ testID: "mermaid-viewport" })
      .findAllByType("View" as never)[1].props.style;
  await act(async () => {
    for (let n = 0; n < 3; n++) button(tree, "Zoom in").props.onPress();
  });
  const before = drawing();
  const event = (deltaY: number, deltaMode = 0) => ({
    deltaY,
    deltaMode,
    clientX: 500,
    clientY: 320,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  });
  const up = event(-120);
  await act(async () => listener!(up));
  expect(up.preventDefault).toHaveBeenCalledOnce();
  expect(up.stopPropagation).toHaveBeenCalledOnce();
  expect(drawing().transform[0].scale).toBeCloseTo(
    before.transform[0].scale * Math.exp(0.24),
  );
  expect((150 - drawing().left) / drawing().transform[0].scale).toBeCloseTo(
    (150 - before.left) / before.transform[0].scale,
  );
  await act(async () => listener!(event(120)));
  expect(drawing().transform[0].scale).toBeCloseTo(before.transform[0].scale);
  await act(async () => listener!(event(-3, 1)));
  expect(drawing().transform[0].scale).toBeCloseTo(
    before.transform[0].scale * Math.exp(3 * 16 * 0.002),
  );
  const horizontal = event(0);
  await act(async () => listener!(horizontal));
  expect(horizontal.preventDefault).not.toHaveBeenCalled();
  await act(async () => {
    for (let n = 0; n < 20; n++) listener!(event(-1, 2));
  });
  expect(drawing().transform[0].scale).toBe(4);
  const atLimit = event(-100);
  await act(async () => listener!(atLimit));
  expect(atLimit.preventDefault).toHaveBeenCalledOnce();
  const previous = listener;
  await act(async () =>
    tree.root
      .findByProps({ testID: "mermaid-viewport" })
      .props.onLayout({ nativeEvent: { layout: { width: 200, height: 220 } } }),
  );
  expect(target.removeEventListener).toHaveBeenCalledWith("wheel", previous);
  const current = listener;
  await act(async () => tree.unmount());
  expect(target.removeEventListener).toHaveBeenCalledWith("wheel", current);
  expect(listener).toBeUndefined();
});

test.each(["ios", "android"] as const)(
  "%s does not access Web wheel APIs",
  async (platform) => {
    nativePlatform.OS = platform;
    const { DiagramViewport } = await import("../client/mermaid/viewer");
    const { diagramModel } = await import("../shared/mermaid/model");
    const add = vi.fn();
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <PluginThemeProvider theme={theme}>
          <DiagramViewport
            model={diagramModel("flowchart LR\nA-->B")}
            theme={theme}
            width={300}
            height={220}
          />
        </PluginThemeProvider>,
        { createNodeMock: () => ({ addEventListener: add }) },
      );
    });
    expect(add).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  },
);

test.each([false, true])(
  "timeline action selects an unmounted or mounted panel in its workspace (compact=%s)",
  async (compact) => {
    const renderers: any[] = [],
      panels: any[] = [];
    const removeRenderer = vi.fn(),
      removePanel = vi.fn(),
      removeCommand = vi.fn();
    const client = {
      rpc: vi.fn(() => new Promise(() => {})),
      openPanel: vi.fn(),
      addTimelineRenderer: (entry: any) => {
        renderers.push(entry);
        return removeRenderer;
      },
      addWorkspacePanel: (entry: any) => {
        panels.push(entry);
        return removePanel;
      },
      addCommandCenterItem: () => removeCommand,
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
          <Panel {...common} context="workspace" workspaceId="workspace-a" />,
        );
      });
      expect(queries.inputs).toHaveBeenCalledWith("canvas.get", {
        workspaceId: "workspace-a",
        canvasId: "canvas-b",
      });
      expect(view.root.findAllByType(Tabs)).toHaveLength(1);
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
    expect(removeRenderer).toHaveBeenCalledOnce();
    expect(removePanel).toHaveBeenCalledOnce();
    expect(removeCommand).toHaveBeenCalledOnce();
  },
);

test("activity delivery runs without a panel, pauses in background, retries, and stops on unload", async () => {
  vi.useFakeTimers();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  let resolve!: (result: { cursor: string }) => void;
  const rpc = vi.fn(
    () =>
      new Promise<{ cursor: string }>((next) => {
        resolve = next;
      }),
  );
  const stop = startActivitySync({ rpc } as unknown as PluginClientContext);
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(rpc).toHaveBeenCalledTimes(1);
    lifecycle.listener!("background");
    resolve({ cursor: "first" });
    await vi.advanceTimersByTimeAsync(100);
    expect(rpc).toHaveBeenCalledTimes(1);
    lifecycle.listener!("active");
    await vi.advanceTimersByTimeAsync(0);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1]).toEqual([
      expect.objectContaining({ name: "canvas.sync_activity" }),
      { cursor: "first" },
    ]);
    rpc.mockRejectedValueOnce(new Error("offline"));
    resolve({ cursor: "second" });
    await vi.advanceTimersByTimeAsync(0);
    expect(rpc).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(999);
    expect(rpc).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(rpc).toHaveBeenCalledTimes(4);
    stop();
    resolve({ cursor: "third" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(rpc).toHaveBeenCalledTimes(4);
    expect(lifecycle.remove).toHaveBeenCalledOnce();
  } finally {
    stop();
    vi.useRealTimers();
    warn.mockRestore();
  }
});

function reviewCanvas(content: string): Canvas {
  return {
    schemaVersion: 1,
    workspaceId: "workspace-a",
    canvasId: "canvas-a",
    title: "Review",
    revision: 1,
    createdAt: "2026-09-12T00:00:00Z",
    updatedAt: "2026-09-12T00:00:00Z",
    updatedByAgentId: "agent-a",
    editState: { status: "unlocked" },
    content,
  };
}
function reviewView(canvas: Canvas, mode: "preview" | "source") {
  return (
    <PluginThemeProvider theme={theme}>
      <ReviewDocument
        canvas={canvas}
        document={parseDocument(canvas.content)}
        mode={mode}
        theme={theme}
        fontSize={14}
      />
    </PluginThemeProvider>
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
    expect(button(view, "Comment")).toBeUndefined();
    expect(button(view, "Select target")).toBeUndefined();
    await act(async () => button(view, "Select elements").props.onPress());
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
    expect(button(view, "Comment").props.icon).toBe("MessageSquare");
    expect(button(view, "Comment").props.label).toBe("Comment");
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
    await act(async () => button(view, "Comment").props.onPress());
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
    await act(async () => button(view, "Change selection").props.onPress());
    await act(async () => view.update(reviewView(canvas, "preview")));
    expect(target(3).props["aria-checked"]).toBe(true);
    await act(async () => button(view, "Comment").props.onPress());
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
  await act(async () => button(view, "Select elements").props.onPress());
  await act(async () => target().props.onPress());
  await act(async () => target().props.onPress());
  expect(button(view, "Comment")).toBeUndefined();
  await act(async () => target().props.onPress());
  await act(async () => button(view, "Cancel selection").props.onPress());
  expect(button(view, "Comment")).toBeUndefined();
  await act(async () => button(view, "Select elements").props.onPress());
  await act(async () => target().props.onPress());
  await act(async () => button(view, "Comment").props.onPress());
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
  await act(async () => button(view, "Change selection").props.onPress());
  expect(button(view, "Comment")).toBeUndefined();
  expect(target().props["aria-checked"]).toBe(false);
  await act(async () => target().props.onPress());
  await act(async () => button(view, "Comment").props.onPress());
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
      const panes = () => tree.root.findByProps({ testID: "review-panes" });
      const comments = () =>
        tree.root.findByProps({ testID: "review-comments" });
      // No measurement yet: open below the document without a modal.
      await act(async () => button(tree, "Comments (1)").props.onPress());
      expect(panes().props.style.flexDirection).toBe("column");
      expect(tree.root.findAllByType(SdkModal)).toHaveLength(0);
      await act(async () => button(tree, "Select elements").props.onPress());
      await act(async () =>
        tree.root.findByProps({ testID: "review-target-0-16" }).props.onPress(),
      );
      await act(async () => button(tree, "Comment").props.onPress());
      const input = (placeholder: string) =>
        tree.root
          .findAllByType("TextInput" as never)
          .find((node) => node.props.placeholder === placeholder)!;
      await act(async () =>
        input("Describe the change you want").props.onChangeText("New draft"),
      );
      await act(async () =>
        input("Reply or clarify the request").props.onChangeText("Reply draft"),
      );
      await act(async () => button(tree, "Edit").props.onPress());
      const editInput = tree.root
        .findAllByType("TextInput" as never)
        .find((node) => node.props.value === "Original comment")!;
      await act(async () => editInput.props.onChangeText("Edited draft"));
      const originalPanel = comments();
      const originalReply = input("Reply or clarify the request");
      for (const [width, direction] of [
        [1200, "row"],
        [0, "row"],
        [1200, "row"],
        [920, "row"],
        [919, "column"],
        [430, "column"],
        [0, "column"],
        [1200, "row"],
        [430, "column"],
      ] as const) {
        await resize(width);
        expect(panes().props.style.flexDirection).toBe(direction);
        expect(comments()).toBe(originalPanel);
        expect(input("Reply or clarify the request")).toBe(originalReply);
        expect(input("Reply or clarify the request").props.value).toBe(
          "Reply draft",
        );
        expect(input("Describe the change you want").props.value).toBe(
          "New draft",
        );
        expect(editInput.props.value).toBe("Edited draft");
        expect(tree.root.findAllByType(SdkModal)).toHaveLength(0);
      }
      await act(async () => button(tree, "Go to target").props.onPress());
      expect(comments()).toBe(originalPanel);
      expect(
        tree.root.findAllByType(Markdown).find((node) => node.props.review)!
          .props.review.navigate,
      ).toBe(0);
      await act(async () => button(tree, "Save reply").props.onPress());
      await act(async () => button(tree, "Save").props.onPress());
      await act(async () => button(tree, "Save comment").props.onPress());
      await act(async () => button(tree, "Resolve").props.onPress());
      const mutations = reviewCalls.mock.calls.map(
        ([, input]) => (input as { mutation: unknown }).mutation,
      );
      expect(mutations).toEqual([
        {
          action: "reply",
          threadId: thread.id,
          expectedRevision: thread.revision,
          body: "Reply draft",
        },
        {
          action: "edit",
          threadId: thread.id,
          expectedRevision: thread.revision,
          messageId: thread.messages[0].id,
          body: "Edited draft",
        },
        { action: "create", selection, body: "New draft" },
        {
          action: "status",
          threadId: thread.id,
          expectedRevision: thread.revision,
          resolved: true,
        },
      ]);
      await act(async () => button(tree, "Comments (1)").props.onPress());
      await resize(1200);
      await resize(0);
      await resize(430);
      expect(
        tree.root.findAllByProps({ testID: "review-comments" }),
      ).toHaveLength(0);
      expect(
        tree.root.findByProps({ testID: "review-body" }).props.style.flex,
      ).toBe(1);
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
    <PluginThemeProvider theme={theme}>
      <Markdown
        document={document}
        theme={theme}
        onError={() => {}}
        review={{ ...bindings, navigationRequest }}
      />
    </PluginThemeProvider>
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
