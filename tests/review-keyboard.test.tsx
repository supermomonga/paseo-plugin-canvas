import React, { createRef } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import type { View, ScrollView as NativeScrollView } from "react-native";
const keyboard = vi.hoisted(() => ({
  listeners: new Map<string, () => void>(),
  OS: "android",
}));
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: {
    get OS() {
      return keyboard.OS;
    },
  },
  Keyboard: {
    addListener: (event: string, listener: () => void) => {
      keyboard.listeners.set(event, listener);
      return { remove: () => keyboard.listeners.delete(event) };
    },
  },
}));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  TextInput: "TextInput",
  ScrollView: "ScrollView",
}));
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import {
  ReviewKeyboard,
  ReviewEntry,
  CommentEditor,
} from "../client/review-input";
import type { PluginTheme } from "@getpaseo/plugin";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const theme = {
  colors: {
    foreground: "#fff",
    foregroundMuted: "#aaa",
    surface0: "#111",
    border: "#777",
  },
} as PluginTheme;

test.each(["android", "ios"])(
  "%s reveals the input and actions once for focus and keyboard resize, preserving manual scrolling",
  async (platform) => {
    keyboard.OS = platform;
    vi.useFakeTimers();
    const scroll = createRef<NativeScrollView>();
    const content = { current: {} as View };
    const scrollY = { current: 400 };
    let available = 500;
    const scrollTo = vi.fn(({ y }) => {
      scrollY.current = y;
    });
    const viewport = {
      getNativeScrollRef: () => ({
        measureInWindow: (cb: Function) => cb(0, 200, 430, available),
      }),
      scrollTo,
    };
    const form = {
      measureLayout: (_relativeTo: View, cb: Function) => cb(0, 840, 400, 166),
    };
    const render = (value = "") => (
      <ReviewKeyboard
        scroll={scroll}
        content={content}
        scrollY={scrollY}
        reveal={0}
      >
        <ScrollView ref={scroll}>
          <ReviewEntry theme={theme} header="New comment">
            <CommentEditor
              theme={theme}
              label="Comment"
              value={value}
              onChangeText={() => {}}
              actions={<span>Save comment</span>}
            />
          </ReviewEntry>
        </ScrollView>
      </ReviewKeyboard>
    );
    let view!: ReactTestRenderer;
    try {
      await act(async () => {
        view = create(render(), {
          createNodeMock: (element) => {
            const props = element.props as { testID?: string };
            if (element.type === "ScrollView") return viewport;
            if (props.testID === "review-document")
              return {
                measureInWindow: (cb: Function) => cb(0, 100, 430, 800),
              };
            if (["review-editor", "review-inline"].includes(props.testID ?? ""))
              return form;
            return null;
          },
        });
      });
      await act(async () =>
        view.root.findByProps({ testID: "review-document" }).props.onLayout(),
      );
      expect(
        view.root.findByProps({ testID: "review-keyboard" }).props
          .keyboardVerticalOffset,
      ).toBe(100);
      const input = () => view.root.findByType("TextInput" as never);
      const originalInput = input();
      await act(async () => {
        input().props.onFocus();
        await vi.runOnlyPendingTimersAsync();
      });
      expect(scrollTo).toHaveBeenLastCalledWith({ y: 514, animated: true });
      available = 240;
      await act(async () => {
        keyboard.listeners.get("keyboardDidShow")!();
        await vi.runOnlyPendingTimersAsync();
      });
      expect(scrollTo).toHaveBeenLastCalledWith({ y: 774, animated: true });
      expect(1040 - scrollY.current + 166).toBe(200 + available - 8);
      // Typing and re-rendering keep the actual input node and do not pull the
      // document back after the user scrolls up to consult an earlier target.
      scrollY.current = 600;
      scrollTo.mockClear();
      await act(async () => {
        view.update(render("日本語の変換中"));
        await vi.runOnlyPendingTimersAsync();
      });
      expect(input()).toBe(originalInput);
      expect(scrollTo).not.toHaveBeenCalled();
      expect(input().props.style.height).toBeGreaterThanOrEqual(66);
      await act(async () => input().props.onBlur());
      await act(async () => {
        keyboard.listeners.get("keyboardDidChangeFrame")!();
        await vi.runOnlyPendingTimersAsync();
      });
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      await act(async () => view?.unmount());
      expect(keyboard.listeners.size).toBe(0);
      vi.useRealTimers();
    }
  },
);

test("overlapping asynchronous layout measurements reveal a new comment only once", async () => {
  vi.useFakeTimers();
  const scroll = createRef<NativeScrollView>();
  const content = { current: {} as View };
  const scrollY = { current: 400 };
  const measured: (() => void)[] = [];
  const scrollTo = vi.fn();
  const viewport = {
    getNativeScrollRef: () => ({
      measureInWindow: (cb: Function) => cb(0, 200, 430, 500),
    }),
    scrollTo,
  };
  const node = {
    measureLayout: (_relativeTo: View, cb: Function) =>
      measured.push(() => cb(0, 1200, 400, 250)),
  };
  const render = (reveal: number) => (
    <ReviewKeyboard
      scroll={scroll}
      content={content}
      scrollY={scrollY}
      reveal={reveal}
    >
      <ScrollView ref={scroll}>
        <ReviewEntry theme={theme} header="New comment">
          Editor after heading
        </ReviewEntry>
      </ScrollView>
    </ReviewKeyboard>
  );
  let view!: ReactTestRenderer;
  try {
    await act(async () => {
      view = create(render(0), {
        createNodeMock: (element) =>
          element.type === "ScrollView" ? viewport : node,
      });
    });
    await act(async () => view.update(render(1)));
    await act(async () => {
      const inline = view.root.findByProps({ testID: "review-inline" });
      inline.props.onLayout();
      inline.props.onLayout();
      await vi.runOnlyPendingTimersAsync();
    });
    await act(async () => measured.splice(0).forEach((deliver) => deliver()));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 958, animated: true });
    // Scroll events own the actual offset; an animated command is not a measurement.
    expect(scrollY.current).toBe(400);
    await act(async () =>
      view.root.findByProps({ testID: "review-inline" }).props.onLayout(),
    );
    expect(scrollTo).toHaveBeenCalledTimes(1);

    // A newer reveal supersedes a measurement which has not returned yet.
    await act(async () => view.update(render(2)));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    await act(async () => view.update(render(3)));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(measured).toHaveLength(2);
    await act(async () => measured.shift()!());
    expect(scrollTo).toHaveBeenCalledTimes(1);
    await act(async () => measured.shift()!());
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 958, animated: true });

    // Closing an editor also cancels any measurement already in flight.
    await act(async () => view.update(render(4)));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    await act(async () => view.unmount());
    await act(async () => measured.splice(0).forEach((deliver) => deliver()));
    expect(scrollTo).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => view?.unmount());
    vi.useRealTimers();
  }
});
