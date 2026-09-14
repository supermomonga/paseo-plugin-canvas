import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Text,
  View,
  type ScrollView as NativeScrollView,
} from "react-native";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";

export type EditorDraft = {
  reply: string;
  editing: string | null;
  edits: Record<string, string>;
};
export const emptyEditorDraft: EditorDraft = {
  reply: "",
  editing: null,
  edits: {},
};
const InputContext = createContext({
  height: 600,
  focus: (_node: View | null) => {},
  entry: (_node: View | null) => {},
  layout: () => {},
});

/** One keyboard boundary for the document, including all inline editors. */
export function ReviewKeyboard({
  children,
  scroll,
  content,
  scrollY,
  reveal,
}: {
  children: ReactNode;
  scroll: MutableRefObject<NativeScrollView | null>;
  content: MutableRefObject<View | null>;
  scrollY: MutableRefObject<number>;
  reveal: number;
}) {
  const boundary = useRef<View>(null);
  const [offset, setOffset] = useState(0);
  const [height, setHeight] = useState(600);
  const entry = useRef<View | null>(null);
  const focused = useRef<View | null>(null);
  const pending = useRef<{ purpose: "entry" | "focus" } | null>(null);
  const measuring = useRef<typeof pending.current>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousReveal = useRef(reveal);
  const ensureVisible = useCallback(() => {
    const request = pending.current;
    const node = request?.purpose === "entry" ? entry.current : focused.current;
    const viewport = scroll.current;
    const relativeTo = content.current;
    const nativeViewport = viewport?.getNativeScrollRef();
    if (
      !request ||
      measuring.current === request ||
      !node ||
      !viewport ||
      !nativeViewport ||
      !relativeTo
    )
      return;
    measuring.current = request;
    const current = () =>
      pending.current === request &&
      viewport === scroll.current &&
      relativeTo === content.current &&
      node === (request.purpose === "entry" ? entry.current : focused.current);
    nativeViewport.measureInWindow((_x, _top, _w, available) => {
      if (!current()) return;
      if (available <= 0) {
        measuring.current = null;
        return;
      }
      setHeight(available);
      // Measure in scroll-content coordinates. Window coordinates plus a
      // predicted scroll offset can accumulate the same movement while an
      // earlier animated scroll or asynchronous measurement is still pending.
      node.measureLayout(
        relativeTo,
        (_nx, y, _nw, h) => {
          if (!current()) return;
          measuring.current = null;
          if (h <= 0) return;
          pending.current = null;
          const top = scrollY.current;
          const destination =
            h + 16 > available || y < top + 8
              ? y - 8
              : y + h > top + available - 8
                ? y + h - available + 8
                : top;
          if (destination !== top)
            viewport.scrollTo({
              y: Math.max(0, destination),
              animated: true,
            });
        },
        () => {
          if (current()) measuring.current = null;
        },
      );
    });
  }, [scroll, content, scrollY]);
  const request = useCallback(
    (purpose: "entry" | "focus" = "focus") => {
      pending.current = { purpose };
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(ensureVisible, 0);
    },
    [ensureVisible],
  );
  const focus = useCallback(
    (node: View | null) => {
      focused.current = node;
      if (node) request();
      else if (pending.current?.purpose === "focus") pending.current = null;
    },
    [request],
  );
  const registerEntry = useCallback((node: View | null) => {
    entry.current = node;
    if (!node && pending.current?.purpose === "entry") pending.current = null;
  }, []);
  useEffect(() => {
    if (previousReveal.current !== reveal) {
      previousReveal.current = reveal;
      request("entry");
    }
  }, [reveal, request]);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const show = Keyboard.addListener("keyboardDidShow", () => {
      if (focused.current) request();
    });
    const frame = Keyboard.addListener("keyboardDidChangeFrame", () => {
      if (focused.current) request();
    });
    return () => {
      show.remove();
      frame.remove();
    };
  }, [request]);
  useEffect(
    () => () => {
      pending.current = null;
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const value = useMemo(
    () => ({ height, focus, entry: registerEntry, layout: ensureVisible }),
    [height, focus, registerEntry, ensureVisible],
  );
  return (
    <View
      ref={boundary}
      testID="review-document"
      style={{ flex: 1, minHeight: 0 }}
      onLayout={() => {
        boundary.current?.measureInWindow((_x, y, width) => {
          if (width > 0) setOffset(y);
        });
      }}
    >
      <KeyboardAvoidingView
        testID="review-keyboard"
        enabled={Platform.OS !== "web"}
        behavior="padding"
        keyboardVerticalOffset={offset}
        style={{ flex: 1, minHeight: 0 }}
      >
        <View
          style={{ flex: 1, minHeight: 0 }}
          onLayout={(e) => {
            if (e.nativeEvent.layout.height > 0) {
              scroll.current
                ?.getNativeScrollRef()
                ?.measureInWindow((_x, _y, _w, available) => {
                  if (available > 0) setHeight(available);
                });
              if (focused.current) request();
              else ensureVisible();
            }
          }}
        >
          <InputContext.Provider value={value}>
            {children}
          </InputContext.Provider>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

export function ReviewEntry({
  theme,
  header,
  children,
}: {
  theme: PluginTheme;
  header: ReactNode;
  children: ReactNode;
}) {
  const node = useRef<View>(null);
  const { entry, layout } = useContext(InputContext);
  useEffect(() => {
    entry(node.current);
    return () => entry(null);
  }, [entry]);
  return (
    <View
      ref={node}
      testID="review-inline"
      collapsable={false}
      style={{ marginVertical: 20 }}
      onLayout={layout}
    >
      <ReviewSurface theme={theme} header={header}>
        {children}
      </ReviewSurface>
    </View>
  );
}

/** Shared framing for discussions in the document and the comments overview. */
export function ReviewSurface({
  theme,
  header,
  children,
}: {
  theme: PluginTheme;
  header: ReactNode;
  children: ReactNode;
}) {
  const colors = theme.colors;
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderLeftWidth: 3,
        borderLeftColor: colors.accent,
        borderRadius: 8,
        backgroundColor: colors.surface1,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          padding: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.surface2,
        }}
      >
        {header}
      </View>
      <View style={{ padding: 12 }}>{children}</View>
    </View>
  );
}

export function CommentEditor({
  theme,
  label,
  value,
  onChangeText,
  placeholder,
  actions,
  hideInput = false,
}: {
  theme: PluginTheme;
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  actions: ReactNode;
  hideInput?: boolean;
}) {
  const context = useContext(InputContext);
  const form = useRef<View>(null);
  const focus = context.focus;
  useEffect(() => () => focus(null), [focus]);
  const [contentHeight, setContentHeight] = useState(66);
  // Three to six lines, with a smaller input for short landscape viewports.
  const maximum = Math.max(38, Math.min(148, context.height - 92));
  const height = Math.min(maximum, Math.max(82, contentHeight));
  const colors = theme.colors;
  return (
    <View
      ref={form}
      testID="review-editor"
      collapsable={false}
      style={{ gap: 8 }}
      onLayout={context.layout}
    >
      {!hideInput && (
        <>
          <Text
            style={{
              color: colors.foreground,
              fontSize: 14,
              fontWeight: "600",
            }}
          >
            {label}
          </Text>
          <TextInput
            accessibilityLabel={label}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.foregroundMuted}
            multiline
            scrollEnabled
            onFocus={() => context.focus(form.current)}
            onBlur={() => context.focus(null)}
            onContentSizeChange={(e) =>
              setContentHeight(e.nativeEvent.contentSize.height)
            }
            style={{
              height,
              padding: 8,
              textAlignVertical: "top",
              fontSize: 16,
              lineHeight: 22,
              color: colors.foreground,
              backgroundColor: colors.surface0,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 6,
            }}
          />
        </>
      )}
      {actions}
    </View>
  );
}
