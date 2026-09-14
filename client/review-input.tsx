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
  scrollY,
  reveal,
}: {
  children: ReactNode;
  scroll: MutableRefObject<NativeScrollView | null>;
  scrollY: MutableRefObject<number>;
  reveal: number;
}) {
  const boundary = useRef<View>(null);
  const [offset, setOffset] = useState(0);
  const [height, setHeight] = useState(600);
  const entry = useRef<View | null>(null);
  const focused = useRef<View | null>(null);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousReveal = useRef(reveal);
  const ensureVisible = useCallback(() => {
    const node = focused.current ?? entry.current;
    const viewport = scroll.current;
    if (!pending.current || !node || !viewport) return;
    viewport.getNativeScrollRef()?.measureInWindow((_x, top, _w, available) => {
      if (available <= 0) return;
      setHeight(available);
      node.measureInWindow((_nx, y, _nw, h) => {
        if (h <= 0 || node !== (focused.current ?? entry.current)) return;
        pending.current = false;
        // Large discussions open at their beginning. A focused editor includes
        // its action row, so saving never requires a keyboard-dismissal tap.
        const delta =
          h + 16 > available || y < top + 8
            ? y - top - 8
            : y + h > top + available - 8
              ? y + h - top - available + 8
              : 0;
        if (delta) {
          scrollY.current = Math.max(0, scrollY.current + delta);
          viewport.scrollTo({ y: scrollY.current, animated: true });
        }
      });
    });
  }, [scroll, scrollY]);
  const request = useCallback(() => {
    pending.current = true;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(ensureVisible, 0);
  }, [ensureVisible]);
  const focus = useCallback(
    (node: View | null) => {
      focused.current = node;
      if (node) request();
    },
    [request],
  );
  const registerEntry = useCallback((node: View | null) => {
    entry.current = node;
  }, []);
  useEffect(() => {
    if (previousReveal.current !== reveal) {
      previousReveal.current = reveal;
      request();
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

export function ReviewEntry({ children }: { children: ReactNode }) {
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
      style={{ marginVertical: 12, gap: 8 }}
      onLayout={layout}
    >
      {children}
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
