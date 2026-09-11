import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, expect, test, vi } from "vitest";
const nativePlatform = vi.hoisted(() => ({ OS: "web" }));
vi.mock("react-native", () => ({
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
  useRpcQuery: (contract: { name: string }) =>
    contract.name === "canvas.list"
      ? queries.list
      : contract.name === "canvas.get"
        ? queries.detail
        : mediaResult,
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
  useRpc: () => async () => undefined,
  useToast: () => ({ show: () => {}, copied: () => {}, error: () => {} }),
});
import { parseDocument } from "../server/document";
import { Markdown, safeLink } from "../client/markdown";
import { CanvasPanel } from "../client/panel";
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
      .find((item) => item.props.accessibilityLabel === "実装プランを開く")!
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
    expect(view.root.findByType(Badge).props.label).toBe("編集中");
    expect(JSON.stringify(view.toJSON())).toContain("Agent A");
    expect(JSON.stringify(view.toJSON())).not.toContain(
      summary.editState.lock.expiresAt,
    );
    await act(async () => button(view, "詳細").props.onPress());
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
            .some((text) => text.children.includes("コード")),
      )!;
    await act(async () => sourceTab.props.onPress());
    expect(JSON.stringify(view.toJSON())).toContain("# 原文");
    if (compact) {
      await act(async () => button(view, "Canvas一覧に戻る").props.onPress());
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
  expect(button(view, "Canvas一覧に戻る")).toBeDefined();
  await act(async () => view.unmount());
});

test("copy success and failure use the host toast instead of inserting content into the panel", async () => {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(panel(false));
  });
  await act(async () => button(view, "本文をコピー").props.onPress());
  expect(host.copy).toHaveBeenCalledWith("# 原文\n\n**共有**");
  expect(host.show).toHaveBeenCalledWith("本文をコピーしました");
  expect(JSON.stringify(view.toJSON())).not.toContain("本文をコピーしました");
  host.copy.mockRejectedValueOnce(new Error("denied"));
  await act(async () => button(view, "本文をコピー").props.onPress());
  expect(host.error).toHaveBeenCalledWith("本文をコピーできませんでした");
  await act(async () => view.unmount());
});

test("fetch failure distinguishes an initial failure from cached content and offers retry", async () => {
  queries.list.data = undefined;
  queries.list.error = new Error("offline");
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(panel(true));
  });
  expect(
    view.root
      .findAllByType("Text" as never)
      .some((item) => item.children.join("") === "一覧を取得できませんでした"),
  ).toBe(true);
  expect(JSON.stringify(view.toJSON())).not.toContain("最後に取得した");
  await act(async () => button(view, "一覧を再取得").props.onPress());
  expect(queries.list.refetch).toHaveBeenCalled();
  queries.list.data = { items: [summary] };
  await act(async () => view.update(panel(true)));
  expect(JSON.stringify(view.toJSON())).toContain("最後に取得した");
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
  expect(JSON.stringify(view.toJSON())).toContain("このCanvasは削除されました");
  expect(view.root.findAllByType(Tabs)).toHaveLength(0);
  await act(async () => button(view, "Canvas一覧に戻る").props.onPress());
  expect(JSON.stringify(view.toJSON())).toContain("Canvasはまだありません");
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
    "リンク先の見出しまたは脚注が見つかりません",
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
  expect(JSON.stringify(view.toJSON())).toContain("描画できませんでした");
  expect(JSON.stringify(view.toJSON())).toContain("画像を表示できません");
  await act(async () => button(view, "再試行").props.onPress());
  expect(mediaResult.refetch).toHaveBeenCalled();
  expect(button(view, "記法を表示")).toBeDefined();
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
        String(node.props.accessibilityLabel).startsWith("倍率 "),
      )!.props.children;
  const initial = scale().join("");
  await act(async () => {
    buttons()
      .find((node) => node.props.label === "拡大")!
      .props.onPress();
  });
  expect(scale().join("")).not.toBe(initial);
  await act(async () => {
    buttons()
      .find((node) => node.props.label === "全体を収める")!
      .props.onPress();
  });
  expect(scale().join("")).toBe(initial);
  await act(async () => {
    buttons()
      .find((node) => node.props.label === "コードを表示")!
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
    "未対応または解析できない記法",
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
          .find((n) => n.props.label === "拡大")!
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
    expect(JSON.stringify(tree.toJSON())).toContain("読み込み中");
    await act(async () => {
      tree.update(render("https://example.com/two.png"));
    });
    await act(async () => loads[0](800, 600));
    expect(JSON.stringify(tree.toJSON())).toContain("読み込み中");
    await act(async () => loads[1](400, 200));
    expect(tree.root.findByType(Image).props.style).toEqual({
      width: 240,
      height: 120,
    });
    expect(tree.root.findByType(Image).props.onLoad).toBeUndefined();
    await act(async () => tree.root.findByType(Image).props.onError());
    expect(JSON.stringify(tree.toJSON())).toContain("画像を表示できません");
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
    const { Mermaid, DiagramViewport } =
      await import("../client/mermaid/viewer");
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
    await act(async () => button(tree, "ポップアップ").props.onPress());
    const popup = tree.root.findByProps({ testID: "mermaid-popup" });
    expect(popup.props.style).toMatchObject({ flex: 1, margin: 12 });
    await act(async () =>
      tree.root
        .findByProps({ testID: "mermaid-popup-body" })
        .props.onLayout({
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
        .find((n) => n.props.label === "コードを表示")!
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
    await act(async () => button(tree, "コードを表示").props.onPress());
    await act(async () => button(tree, "閉じる").props.onPress());
    expect(tree.root.findAllByProps({ testID: "mermaid-popup" })).toHaveLength(
      0,
    );
    await act(async () => tree.unmount());
  },
);
