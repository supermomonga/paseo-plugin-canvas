import { useEffect, useRef, useState, type ReactNode } from "react";
import { Linking, Platform, Text, View, type TextStyle } from "react-native";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Button, CodeBlock } from "paseo-plugin-helper/client";
import type { Root, Element, ElementContent, RootContent } from "hast";
import { textContent, externalLink, type AlertType } from "../shared/document";
import { DocumentImage, Graphic } from "./media";
import { Mermaid } from "./mermaid/viewer";
import { tableColumnWidths } from "../shared/table";

export const safeLink = externalLink;
const mono = Platform.OS === "ios" ? "Menlo" : "monospace";
const element = (node: RootContent): node is Element => node.type === "element";
const classes = (node: Element) =>
  (node.properties.className as string[] | undefined) ?? [];
const alertStyle = {
  NOTE: { label: "Note", icon: "Info", color: "foreground" },
  TIP: { label: "Tip", icon: "Lightbulb", color: "statusSuccess" },
  IMPORTANT: {
    label: "Important",
    icon: "MessageSquareWarning",
    color: "foreground",
  },
  WARNING: { label: "Warning", icon: "TriangleAlert", color: "statusWarning" },
  CAUTION: { label: "Caution", icon: "OctagonAlert", color: "statusDanger" },
} as const;
export function Markdown({
  document: tree,
  theme,
  onError,
  contentFontSize = 15,
  workspaceId,
  onNavigate,
}: {
  document: Root;
  theme: PluginTheme;
  onError: (message: string) => void;
  contentFontSize?: number;
  workspaceId?: string;
  onNavigate?: (offset: number) => void;
}) {
  const root = useRef<View>(null);
  const anchors = useRef(new Map<string, View | Text>());
  const [width, setWidth] = useState(600);
  const [expanded, setExpanded] = useState(new Map<Element, boolean>());
  const [pending, setPending] = useState<string>();
  const colors = theme.colors;
  const textStyle: TextStyle = {
    color: colors.foreground,
    fontSize: contentFontSize,
    lineHeight: 24,
  };
  useEffect(() => {
    setExpanded(new Map());
    setPending(undefined);
  }, [tree]);
  function measure(id: string) {
    const target = anchors.current.get(id);
    if (!target || !root.current) return;
    target.measureLayout(
      root.current,
      (_x, y) => {
        onNavigate?.(y);
        setPending(undefined);
      },
      () => onError("Unable to locate the link target"),
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
        onError("Invalid link format");
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
        onError("The linked heading or footnote was not found");
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
        void Linking.openURL(url).catch(() =>
          onError("Unable to open the link"),
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
    return (
      <Graphic
        key={key}
        theme={theme}
        width={width}
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
  }
  function inline(
    nodes: RootContent[],
    prefix: string,
    measuring = false,
  ): ReactNode[] {
    return nodes.map((node, index) => {
      const key = `${prefix}.${index}`;
      if (node.type === "text") return node.value.replace(/\r?\n/g, " ");
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
              {textContent(node)}
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
              onPress={!measuring && enabled ? () => openLink(href) : undefined}
              style={{
                color: enabled ? colors.foreground : colors.foregroundMuted,
                textDecorationLine: enabled ? "underline" : "none",
              }}
            >
              {children()}
            </Text>
          );
        }
        case "img":
          return (
            <DocumentImage
              key={`${key}:${node.properties.src}`}
              inline
              src={String(node.properties.src ?? "")}
              alt={String(node.properties.alt ?? "")}
              theme={theme}
              width={width}
              workspaceId={workspaceId}
            />
          );
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
              width={width}
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
        if (language === "mermaid")
          return (
            <Mermaid
              key={key}
              source={textContent(code).trim()}
              theme={theme}
              width={width}
            />
          );
        if (language === "math" || classes(code).includes("math-display"))
          return graphic(code, true, key);
        return (
          <CodeBlock
            key={key}
            code={textContent(code).replace(/\n$/, "")}
            language={language}
            copyable={false}
            textStyle={{ fontSize: 12, lineHeight: 22 }}
          />
        );
      }
      case "aside": {
        const type = node.properties.dataAlert as AlertType;
        const alert = alertStyle[type];
        if (!alert) return null;
        const color = colors[alert.color];
        return (
          <View
            key={key}
            accessibilityLabel={`${alert.label} alert`}
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
                {alert.label}
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
              return (
                <View
                  key={i}
                  {...anchorProps(item)}
                  style={{ flexDirection: "row", gap: 8 }}
                >
                  <Text
                    accessibilityLabel={
                      checkbox
                        ? checkbox.properties.checked
                          ? "Complete"
                          : "Incomplete"
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
              label={summary ? textContent(summary) : "Details"}
              icon={open ? "ChevronDown" : "ChevronRight"}
              accessibilityLabel={`${open ? "Collapse" : "Expand"} ${summary ? textContent(summary) : "details"}`}
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
}: {
  rows: Element[];
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
                  role={cell.tagName === "th" ? "columnheader" : "cell"}
                  selectable
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
