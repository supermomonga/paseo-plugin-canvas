import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Text, View, type TextStyle } from "react-native";
import {
  Icon,
  Markdown as HostMarkdown,
  ScrollView,
} from "@getpaseo/plugin/client/ui";
import type { PluginTheme } from "@getpaseo/plugin";
import { Button, CodeBlock } from "./ui";
import type { Root, Element, ElementContent, RootContent } from "hast";
import { textContent, externalLink, type AlertType } from "../shared/document";
import { DocumentImage, Graphic } from "./media";
import { useLinkOpener } from "./links";
import { useText } from "./i18n";
import {
  type ReviewBindings,
  sourceRange,
  targetBorder,
  targetPadding,
} from "./review-bindings";
import { reviewTargets } from "../shared/review-targets";
import { tableColumnWidths } from "../shared/table";

export const safeLink = externalLink;

/** A Mermaid fence longer than any backtick run inside the diagram. */
export function mermaidFence(source: string) {
  const longest = Math.max(
    2,
    ...[...source.matchAll(/`+/g)].map((run) => run[0].length),
  );
  const fence = "`".repeat(longest + 1);
  return `${fence}mermaid\n${source}\n${fence}`;
}
const mono = Platform.OS === "ios" ? "Menlo" : "monospace";
const element = (node: RootContent): node is Element => node.type === "element";
const classes = (node: Element) =>
  (node.properties.className as string[] | undefined) ?? [];
const alertStyle = {
  NOTE: { label: "note", icon: "Info", color: "foreground" },
  TIP: { label: "tip", icon: "Lightbulb", color: "statusSuccess" },
  IMPORTANT: {
    label: "important",
    icon: "MessageSquareWarning",
    color: "foreground",
  },
  WARNING: { label: "warning", icon: "TriangleAlert", color: "statusWarning" },
  CAUTION: { label: "caution", icon: "OctagonAlert", color: "statusDanger" },
} as const;
export function Markdown({
  document: tree,
  theme,
  onError,
  contentFontSize = 15,
  workspaceId,
  onNavigate,
  review,
}: {
  document: Root;
  review?: ReviewBindings;
  theme: PluginTheme;
  onError: (message: string) => void;
  contentFontSize?: number;
  workspaceId?: string;
  onNavigate?: (offset: number) => void;
}) {
  const root = useRef<View>(null);
  const { t } = useText();
  const openExternal = useLinkOpener();
  const anchors = useRef(new Map<string, View | Text>());
  const [width, setWidth] = useState(600);
  // Review targets draw a border and padding around each top-level block.
  const contentWidth = review
    ? Math.max(0, width - 2 * (targetBorder + targetPadding))
    : width;
  const [expanded, setExpanded] = useState(new Map<Element, boolean>());
  const [pending, setPending] = useState<string>();
  const colors = theme.colors;
  const selectableNodes = new Set(reviewTargets(tree));
  const textStyle: TextStyle = {
    color: colors.foreground,
    fontSize: contentFontSize,
    lineHeight: 24,
  };
  useEffect(() => {
    setExpanded(new Map());
    setPending(undefined);
  }, [tree]);
  useEffect(() => {
    if (review?.navigate == null) return;
    const at = review.navigate;
    setExpanded((previous) => {
      const next = new Map(previous);
      function scan(nodes: RootContent[]) {
        for (const n of nodes)
          if (element(n)) {
            const range = sourceRange(n);
            if (
              n.tagName === "details" &&
              range &&
              range.start <= at &&
              range.end >= at
            )
              next.set(n, true);
            scan(n.children);
          }
      }
      scan(tree.children);
      return next;
    });
  }, [review?.navigate, review?.navigationRequest, tree]);
  function measure(id: string) {
    const target = anchors.current.get(id);
    if (!target || !root.current) return;
    target.measureLayout(
      root.current,
      (_x, y) => {
        onNavigate?.(y);
        setPending(undefined);
      },
      () => onError(t("content.links.notLocated")),
    );
  }
  useEffect(() => {
    if (pending) {
      const timer = setTimeout(() => measure(pending), 50);
      return () => clearTimeout(timer);
    }
  }, [pending, expanded]);
  function openLink(href: string) {
    if (href.startsWith("#")) {
      let id: string;
      try {
        id = decodeURIComponent(href.slice(1));
      } catch {
        onError(t("content.links.invalid"));
        return;
      }
      const parents: Element[] = [];
      function find(nodes: RootContent[], details: Element[]): boolean {
        for (const node of nodes)
          if (element(node)) {
            if (node.properties.id === id) {
              parents.push(...details);
              return true;
            }
            if (
              find(
                node.children,
                node.tagName === "details" ? [...details, node] : details,
              )
            )
              return true;
          }
        return false;
      }
      if (!find(tree.children, [])) {
        onError(t("content.links.notFound"));
        return;
      }
      setExpanded(
        (previous) =>
          new Map([
            ...previous,
            ...parents.map((node) => [node, true] as const),
          ]),
      );
      setPending(id);
    } else {
      const url = externalLink(href);
      if (url)
        void openExternal(url).catch(() =>
          onError(t("content.links.openFailed")),
        );
    }
  }
  function anchorProps(node: Element) {
    const id = node.properties.id;
    return typeof id === "string"
      ? {
          ref: (value: View | Text | null) => {
            if (value) anchors.current.set(id, value);
            else anchors.current.delete(id);
          },
          onLayout: () => {
            if (pending === id) measure(id);
          },
        }
      : {};
  }
  function graphic(node: Element, display: boolean, key: string) {
    const rendered = (
      <Graphic
        key={key}
        theme={theme}
        width={contentWidth}
        inline={!display}
        input={{
          kind: "math",
          source: textContent(node).trim(),
          display,
          foreground: colors.foreground,
          background: colors.surface0,
          fontSize: contentFontSize,
        }}
      />
    );
    return rendered;
  }

  function inline(
    nodes: RootContent[],
    prefix: string,
    measuring = false,
  ): ReactNode[] {
    return nodes.map((node, index) => {
      const key = `${prefix}.${index}`;
      if (node.type === "text") {
        const value = node.value.replace(/\r?\n/g, " ");
        return review && !measuring
          ? review.text(
              value,
              node.data?.canvasMap as number[] | undefined,
              key,
            )
          : value;
      }
      if (!element(node)) return null;
      const children = () => inline(node.children, key, measuring);
      switch (node.tagName) {
        case "br":
          return "\n";
        case "strong":
          return (
            <Text key={key} style={{ fontWeight: "700" }}>
              {children()}
            </Text>
          );
        case "em":
          return (
            <Text key={key} style={{ fontStyle: "italic" }}>
              {children()}
            </Text>
          );
        case "del":
          return (
            <Text key={key} style={{ textDecorationLine: "line-through" }}>
              {children()}
            </Text>
          );
        case "code":
          return classes(node).includes("math-inline") ? (
            graphic(node, false, key)
          ) : (
            <Text
              key={key}
              style={{ fontFamily: mono, backgroundColor: colors.surface2 }}
            >
              {review && !measuring
                ? review.text(
                    textContent(node),
                    node.properties.dataCanvasMap as number[] | undefined,
                    key,
                  )
                : textContent(node)}
            </Text>
          );
        case "sub":
        case "sup":
          return (
            <Text
              key={key}
              style={{
                fontSize: contentFontSize * 0.8,
                lineHeight: contentFontSize,
                verticalAlign: (Platform.OS === "web"
                  ? node.tagName === "sup"
                    ? "super"
                    : "sub"
                  : node.tagName === "sup"
                    ? "top"
                    : "bottom") as TextStyle["verticalAlign"],
              }}
            >
              {children()}
            </Text>
          );
        case "a": {
          const href = String(node.properties.href ?? "");
          const enabled = href.startsWith("#") || !!externalLink(href);
          return (
            <Text
              key={key}
              {...(measuring ? {} : anchorProps(node))}
              accessibilityRole={enabled ? "link" : undefined}
              accessibilityLabel={
                typeof node.properties.ariaLabel === "string"
                  ? node.properties.ariaLabel
                  : undefined
              }
              onPress={
                !measuring && enabled && !review?.enabled
                  ? () => openLink(href)
                  : undefined
              }
              style={{
                color: enabled ? colors.foreground : colors.foregroundMuted,
                textDecorationLine: enabled ? "underline" : "none",
              }}
            >
              {children()}
            </Text>
          );
        }
        case "img": {
          const image = (
            <DocumentImage
              key={`${key}:${node.properties.src}`}
              inline
              src={String(node.properties.src ?? "")}
              alt={String(node.properties.alt ?? "")}
              theme={theme}
              width={contentWidth}
              workspaceId={workspaceId}
            />
          );
          return image;
        }
        case "input":
          return null;
        default:
          return <Text key={key}>{children()}</Text>;
      }
    });
  }
  function flow(nodes: RootContent[], prefix: string): ReactNode[] {
    // HAST loose lists and raw HTML can mix blocks and inline siblings.
    const result: ReactNode[] = [];
    let run: RootContent[] = [];
    function flush() {
      if (run.some((n) => n.type !== "text" || n.value.trim()))
        result.push(
          <Text
            key={`${prefix}.run${result.length}`}
            selectable
            style={textStyle}
          >
            {inline(run, `${prefix}.run${result.length}`)}
          </Text>,
        );
      run = [];
    }
    nodes.forEach((node, index) => {
      if (
        element(node) &&
        /^(p|h[1-6]|blockquote|aside|ul|ol|li|pre|table|hr|details|section|div)$/.test(
          node.tagName,
        )
      ) {
        flush();
        result.push(block(node, `${prefix}.${index}`));
      } else run.push(node);
    });
    flush();
    return result;
  }
  function block(node: Element, key: string): ReactNode {
    const result = renderBlock(node, key);
    return review && selectableNodes.has(node)
      ? review.wrap(node, result, key)
      : result;
  }
  function renderBlock(node: Element, key: string): ReactNode {
    if (/^h[1-6]$/.test(node.tagName))
      return (
        <View key={key} {...anchorProps(node)}>
          <Text
            accessibilityRole="header"
            selectable
            style={{
              ...textStyle,
              fontSize: Math.max(16, 29 - Number(node.tagName[1]) * 2),
              lineHeight: 34,
              fontWeight: "700",
            }}
          >
            {inline(node.children, key)}
          </Text>
        </View>
      );
    switch (node.tagName) {
      case "p": {
        const only = node.children.filter(
          (n) => n.type !== "text" || n.value.trim(),
        );
        if (
          only.length === 1 &&
          element(only[0]) &&
          only[0].tagName === "img"
        ) {
          const img = only[0];
          return (
            <DocumentImage
              key={`${key}:${img.properties.src}`}
              src={String(img.properties.src ?? "")}
              alt={String(img.properties.alt ?? "")}
              theme={theme}
              width={contentWidth}
              workspaceId={workspaceId}
            />
          );
        }
        return (
          <Text key={key} selectable style={textStyle}>
            {inline(node.children, key)}
          </Text>
        );
      }
      case "pre": {
        const code = node.children.find(element);
        if (!code) return null;
        const language = classes(code)
          .find((c) => c.startsWith("language-"))
          ?.slice(9);
        // Paseo draws every diagram, with its own zoom and source view (ADR 19).
        if (language === "mermaid")
          return (
            <View key={key} testID="mermaid-diagram">
              <HostMarkdown>{mermaidFence(textContent(code).trim())}</HostMarkdown>
            </View>
          );
        if (language === "math" || classes(code).includes("math-display"))
          return graphic(code, true, key);
        if (language === "svg")
          return (
            <Graphic
              key={key}
              theme={theme}
              width={contentWidth}
              input={{ kind: "svg", source: textContent(code).trim() }}
            />
          );
        if (review)
          return (
            <View
              key={key}
              style={{
                padding: 12,
                backgroundColor: colors.surface1,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 6,
              }}
            >
              <Text
                selectable
                style={{
                  fontFamily: mono,
                  fontSize: 12,
                  lineHeight: 22,
                  color: colors.foreground,
                }}
              >
                {review.text(
                  textContent(code),
                  code.properties.dataCanvasMap as number[] | undefined,
                  key,
                )}
              </Text>
            </View>
          );
        return (
          <CodeBlock
            key={key}
            code={textContent(code).replace(/\n$/, "")}
            language={language}
            textStyle={{ fontSize: 12, lineHeight: 22 }}
          />
        );
      }
      case "aside": {
        const type = node.properties.dataAlert as AlertType;
        const alert = alertStyle[type];
        if (!alert) return null;
        const color = colors[alert.color];
        const alertLabel = t(`content.alerts.${alert.label}`);
        return (
          <View
            key={key}
            accessibilityLabel={t("content.alerts.label", {
              type: alertLabel,
            })}
            style={{
              borderLeftWidth: 3,
              borderColor: color,
              paddingLeft: 16,
              gap: 8,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                minHeight: 24,
              }}
            >
              <Icon name={alert.icon} size={16} color={color} />
              <Text style={{ ...textStyle, color, fontWeight: "600" }}>
                {alertLabel}
              </Text>
            </View>
            {flow(node.children, key)}
          </View>
        );
      }
      case "blockquote":
        return (
          <View
            key={key}
            style={{
              paddingLeft: 16,
              borderLeftWidth: 3,
              borderColor: colors.border,
              gap: 12,
            }}
          >
            {flow(node.children, key)}
          </View>
        );
      case "hr":
        return (
          <View
            key={key}
            style={{ height: 1, backgroundColor: colors.border }}
          />
        );
      case "ul":
      case "ol": {
        const items = node.children.filter(element);
        return (
          <View key={key} style={{ gap: 8 }}>
            {items.map((item, i) => {
              let checkbox: Element | undefined;
              const removeCheckbox = (
                children: ElementContent[],
              ): ElementContent[] =>
                children.flatMap<ElementContent>((child) => {
                  if (!element(child)) return [child];
                  if (
                    child.tagName === "input" &&
                    child.properties.type === "checkbox"
                  ) {
                    checkbox = child;
                    return [];
                  }
                  if (child.tagName === "p")
                    return [
                      { ...child, children: removeCheckbox(child.children) },
                    ];
                  return [child];
                });
              const children = removeCheckbox(item.children);
              const rendered = (
                <View
                  key={i}
                  {...anchorProps(item)}
                  style={{ flexDirection: "row", gap: 8 }}
                >
                  <Text
                    accessibilityLabel={
                      checkbox
                        ? checkbox.properties.checked
                          ? t("content.task.complete")
                          : t("content.task.incomplete")
                        : undefined
                    }
                    style={{
                      ...textStyle,
                      minWidth: node.tagName === "ol" ? 32 : 20,
                      textAlign: "right",
                    }}
                  >
                    {checkbox
                      ? checkbox.properties.checked
                        ? "☑"
                        : "☐"
                      : node.tagName === "ol"
                        ? `${Number(node.properties.start ?? 1) + i}.`
                        : "•"}
                  </Text>
                  <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
                    {flow(children, `${key}.${i}`)}
                  </View>
                </View>
              );
              return rendered;
            })}
          </View>
        );
      }
      case "table": {
        const rows: Element[] = [];
        for (const group of node.children.filter(element)) {
          if (group.tagName === "tr") rows.push(group);
          else
            rows.push(
              ...group.children
                .filter(element)
                .filter((n) => n.tagName === "tr"),
            );
        }
        return (
          <MarkdownTable
            key={key}
            rows={rows}
            theme={theme}
            textStyle={textStyle}
            review={review}
            renderCell={(cell, row, column, measuring) =>
              inline(cell.children, `${key}.${row}.${column}`, measuring)
            }
          />
        );
      }
      case "details": {
        const summary = node.children.find(
          (n) => element(n) && n.tagName === "summary",
        );
        const open = expanded.get(node) ?? node.properties.open === true;
        return (
          <View
            key={key}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 6,
              padding: 12,
              gap: 12,
            }}
          >
            <Button
              variant="secondary"
              size="sm"
              style={{ justifyContent: "flex-start" }}
              label={
                summary ? textContent(summary) : t("content.details.label")
              }
              icon={open ? "ChevronDown" : "ChevronRight"}
              accessibilityLabel={t(
                open ? "content.details.collapse" : "content.details.expand",
                {
                  name: summary
                    ? textContent(summary)
                    : t("content.details.name"),
                },
              )}
              onPress={() =>
                setExpanded((previous) => {
                  const next = new Map(previous);
                  next.set(node, !open);
                  return next;
                })
              }
            />
            {open &&
              flow(
                node.children.filter((n) => n !== summary),
                key,
              )}
          </View>
        );
      }
      default:
        return (
          <View key={key} {...anchorProps(node)} style={{ gap: 16 }}>
            {flow(node.children, key)}
          </View>
        );
    }
  }
  return (
    <View
      ref={root}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ gap: 16 }}
    >
      {flow(tree.children, "doc")}
    </View>
  );
}

function MarkdownTable({
  rows,
  theme,
  textStyle,
  renderCell,
  review,
}: {
  rows: Element[];
  review?: ReviewBindings;
  theme: PluginTheme;
  textStyle: TextStyle;
  renderCell: (
    cell: Element,
    row: number,
    column: number,
    measuring?: boolean,
  ) => ReactNode;
}) {
  const [width, setWidth] = useState(0);
  const [measured, setMeasured] = useState(new Map<string, number>());
  const cells = rows.map((row) => row.children.filter(element));
  const columns = Math.max(1, ...cells.map((row) => row.length));
  const preferred = Array.from({ length: columns }, (_, c) =>
    Math.max(
      0,
      ...cells.map((row, r) => (row[c] ? (measured.get(`${r}.${c}`) ?? 0) : 0)),
    ),
  );
  const widths = tableColumnWidths(preferred, Math.max(0, width - 2));
  const colors = theme.colors;
  function cellStyle(cell: Element): TextStyle {
    return {
      ...textStyle,
      padding: 8,
      borderWidth: 0.5,
      borderColor: colors.border,
      fontWeight: cell.tagName === "th" ? "700" : "400",
    };
  }
  return (
    <View>
      {/* A horizontal scroll content has unbounded width on web and native.
          Measure the same styled inline content without wrapping. Keep this
          sizing pass out of visual layout, accessibility, and interaction. */}
      <View
        aria-hidden
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          height: 0,
          opacity: 0,
          overflow: "hidden",
        }}
      >
        <ScrollView
          horizontal
          scrollEnabled={false}
          removeClippedSubviews={false}
        >
          <View style={{ alignItems: "flex-start" }}>
            {cells.map((row, r) =>
              row.map((cell, c) => (
                <Text
                  key={`${r}.${c}`}
                  style={{ ...cellStyle(cell), flexShrink: 0 }}
                  onLayout={(event) => {
                    const naturalWidth = Math.ceil(
                      event.nativeEvent.layout.width,
                    );
                    setMeasured((previous) => {
                      const id = `${r}.${c}`;
                      if (previous.get(id) === naturalWidth) return previous;
                      // Match React's positional cell keys: replacing content of
                      // the same rendered width need not emit another onLayout.
                      const next = new Map(previous);
                      next.set(id, naturalWidth);
                      return next;
                    });
                  }}
                >
                  {renderCell(cell, r, c, true)}
                </Text>
              )),
            )}
          </View>
        </ScrollView>
      </View>
      <ScrollView
        horizontal
        style={{ flexGrow: 0 }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        <View
          role="table"
          style={{
            width: widths.reduce((sum, column) => sum + column, 0) + 2,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          {cells.map((row, r) => (
            <View
              key={r}
              role="row"
              style={{
                flexDirection: "row",
                backgroundColor: r === 0 ? colors.surface1 : colors.surface0,
              }}
            >
              {row.map((cell, c) => (
                <Text
                  key={c}
                  ref={(node) =>
                    review?.register(
                      `cell:${r}.${c}:${sourceRange(cell)?.start}`,
                      node,
                      sourceRange(cell),
                    )
                  }
                  role={cell.tagName === "th" ? "columnheader" : "cell"}
                  selectable={!review?.enabled}
                  style={{
                    ...cellStyle(cell),
                    width: widths[c],
                    flexShrink: 0,
                    textAlign:
                      (cell.properties.align as "left" | "right" | "center") ??
                      "left",
                  }}
                >
                  {renderCell(cell, r, c)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
