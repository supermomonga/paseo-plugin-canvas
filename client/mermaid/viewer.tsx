import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Platform, Text, View } from "react-native";
import type { GestureResponderEvent } from "react-native";
import { MermaidPopup } from "./popup";
import { Button, CodeBlock } from "paseo-plugin-helper/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { diagramModel, type DiagramModel } from "../../shared/mermaid/model";
import {
  bounded,
  fitted,
  zoomAt,
  type Transform,
} from "../../shared/mermaid/viewport";
import { FlowchartView, SequenceView } from "./drawing";

export function Mermaid({
  source,
  theme,
  width,
}: {
  source: string;
  theme: PluginTheme;
  width: number;
}) {
  const parsed = useMemo(() => {
    try {
      return { model: diagramModel(source), error: null };
    } catch (error) {
      return {
        model: null,
        error:
          error instanceof Error ? error.message : "図を解析できませんでした。",
      };
    }
  }, [source]);
  const [modal, setModal] = useState<"source" | "diagram" | null>(null);
  const showCode = () => setModal("source");
  return (
    <View>
      {parsed.model ? (
        <DiagramViewport
          key={source}
          model={parsed.model}
          theme={theme}
          width={width}
          height={Math.min(360, Math.max(220, parsed.model.height + 32))}
          onPopup={() => setModal("diagram")}
          onShowCode={showCode}
        />
      ) : (
        <View
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "flex-end",
              padding: 8,
              borderBottomWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Button
              label="コードを表示"
              icon="Code"
              size="sm"
              onPress={showCode}
            />
          </View>
          <View accessibilityRole="alert" style={{ padding: 12, gap: 6 }}>
            <Text
              style={{
                color: theme.colors.statusWarning,
                fontSize: 13,
                lineHeight: 20,
              }}
            >
              このMermaid図は表示できません
            </Text>
            <Text
              selectable
              style={{
                color: theme.colors.foregroundMuted,
                fontSize: 12,
                lineHeight: 18,
              }}
            >
              {parsed.error}
            </Text>
          </View>
        </View>
      )}
      {modal !== null && (
        <MermaidPopup
          title={modal === "diagram" ? "Mermaid図" : "Mermaidのコード"}
          theme={theme}
          onClose={() => setModal(null)}
        >
          {(size) =>
            modal === "diagram" && parsed.model ? (
              <DiagramViewport
                key={source}
                model={parsed.model}
                theme={theme}
                width={size.width}
                onShowCode={showCode}
              />
            ) : (
              <CodeBlock
                code={source}
                copyable={false}
                maxHeight={size.height}
                style={{ flex: 1, borderWidth: 0, borderRadius: 0 }}
              />
            )
          }
        </MermaidPopup>
      )}
    </View>
  );
}

function pinch(event: GestureResponderEvent) {
  const touches = event.nativeEvent.touches;
  if (touches.length !== 2) return null;
  const [a, b] = touches;
  // The viewport is the touch target; page-minus-location gives its screen origin.
  const originX = a.pageX - a.locationX;
  const originY = a.pageY - a.locationY;
  return {
    distance: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY),
    x: (a.pageX + b.pageX) / 2 - originX,
    y: (a.pageY + b.pageY) / 2 - originY,
  };
}

// React Native Web exposes the rendered element through View's public ref.
// Structural types keep DOM libraries out of the native client type contract.
interface WheelInput {
  deltaY: number;
  deltaMode: number;
  clientX: number;
  clientY: number;
  preventDefault(): void;
  stopPropagation(): void;
}
interface WheelTarget {
  addEventListener(
    type: "wheel",
    listener: (event: WheelInput) => void,
    options: { passive: false },
  ): void;
  removeEventListener(
    type: "wheel",
    listener: (event: WheelInput) => void,
  ): void;
  getBoundingClientRect(): {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export function DiagramViewport({
  model,
  theme,
  width,
  height,
  onPopup,
  onShowCode,
}: {
  model: DiagramModel;
  theme: PluginTheme;
  width: number;
  height?: number;
  onPopup?: () => void;
  onShowCode?: () => void;
}) {
  const [measured, setMeasured] = useState({
    width: Math.max(1, width),
    height: height ?? 1,
  });
  const size = useMemo(
    () => ({ width: measured.width, height: height ?? measured.height }),
    [measured, height],
  );
  const content = useMemo(
    () => ({ width: model.width, height: model.height }),
    [model.width, model.height],
  );
  const viewportRef = useRef<View>(null);
  const [transform, setTransform] = useState(() => fitted(content, size));
  const current = useRef(transform);
  const start = useRef({
    transform,
    pinch: null as ReturnType<typeof pinch>,
    dx: 0,
    dy: 0,
  });
  function commit(next: Transform) {
    current.current = next;
    setTransform(next);
  }
  useEffect(() => {
    commit(fitted(content, size));
  }, [content, size]);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const target = viewportRef.current as unknown as WheelTarget | null;
    if (!target) return;
    const onWheel = (event: WheelInput) => {
      if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;
      const rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      // React's onWheel is passive; a local non-passive listener is needed to
      // prevent document scrolling (or browser pinch zoom) over the drawing.
      event.preventDefault();
      event.stopPropagation();
      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
      const delta = Math.max(-240, Math.min(240, event.deltaY * unit));
      const point = {
        x: ((event.clientX - rect.left) * size.width) / rect.width,
        y: ((event.clientY - rect.top) * size.height) / rect.height,
      };
      commit(
        zoomAt(
          current.current,
          current.current.scale * Math.exp(-delta * 0.002),
          point,
          content,
          size,
        ),
      );
    };
    target.addEventListener("wheel", onWheel, { passive: false });
    return () => target.removeEventListener("wheel", onWheel);
  }, [content, size]);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (event) =>
          event.nativeEvent.touches.length === 2,
        onMoveShouldSetPanResponder: (event, gesture) =>
          event.nativeEvent.touches.length === 2 ||
          (Math.abs(gesture.dx) > 5 &&
            content.width * current.current.scale > size.width - 32) ||
          (Math.abs(gesture.dy) > 5 &&
            content.height * current.current.scale > size.height - 32),
        onPanResponderGrant: (event, gesture) => {
          start.current = {
            transform: current.current,
            pinch: pinch(event),
            dx: gesture.dx,
            dy: gesture.dy,
          };
        },
        onPanResponderMove: (event, gesture) => {
          const fingers = pinch(event);
          if (fingers) {
            if (!start.current.pinch) {
              start.current = {
                transform: current.current,
                pinch: fingers,
                dx: gesture.dx,
                dy: gesture.dy,
              };
              return;
            }
            const initial = start.current.pinch;
            if (initial.distance < 1) return;
            const zoomed = zoomAt(
              start.current.transform,
              (start.current.transform.scale * fingers.distance) /
                initial.distance,
              initial,
              content,
              size,
            );
            commit(
              bounded(
                {
                  ...zoomed,
                  x: zoomed.x + fingers.x - initial.x,
                  y: zoomed.y + fingers.y - initial.y,
                },
                content,
                size,
              ),
            );
          } else if (start.current.pinch) {
            start.current = {
              transform: current.current,
              pinch: null,
              dx: gesture.dx,
              dy: gesture.dy,
            };
          } else {
            commit(
              bounded(
                {
                  ...start.current.transform,
                  x: start.current.transform.x + gesture.dx - start.current.dx,
                  y: start.current.transform.y + gesture.dy - start.current.dy,
                },
                content,
                size,
              ),
            );
          }
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [content, size],
  );
  const zoom = (factor: number) =>
    commit(
      zoomAt(
        current.current,
        current.current.scale * factor,
        { x: size.width / 2, y: size.height / 2 },
        content,
        size,
      ),
    );
  const minimum = Math.min(0.1, fitted(content, size).scale);
  return (
    <View
      style={{
        flex: height === undefined ? 1 : undefined,
        minHeight: 0,
        borderWidth: height === undefined ? 0 : 1,
        borderColor: theme.colors.border,
        borderRadius: height === undefined ? 0 : 8,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          padding: 8,
          borderBottomWidth: 1,
          borderColor: theme.colors.border,
        }}
      >
        <Button
          label="縮小"
          icon="ZoomOut"
          size="sm"
          disabled={transform.scale <= minimum + 0.0001}

          onPress={() => zoom(1 / 1.25)}
        />
        <Text
          accessibilityLabel={`倍率 ${Math.round(transform.scale * 100)}パーセント`}
          style={{
            color: theme.colors.foregroundMuted,
            minWidth: 42,
            textAlign: "center",
            fontSize: 12,
            fontVariant: ["tabular-nums"],
          }}
        >
          {Math.round(transform.scale * 100)}%
        </Text>
        <Button
          label="拡大"
          icon="ZoomIn"
          size="sm"
          disabled={transform.scale >= 4}

          onPress={() => zoom(1.25)}
        />
        <Button
          label="全体を収める"
          icon="Scan"
          size="sm"

          onPress={() => commit(fitted(content, size))}
        />
        {onPopup && (
          <Button
            label="ポップアップ"
            icon="Maximize2"
            size="sm"
            onPress={onPopup}
          />
        )}
        {onShowCode && (
          <View style={{ marginLeft: "auto" }}>
            <Button
              label="コードを表示"
              icon="Code"
              size="sm"
              onPress={onShowCode}
            />
          </View>
        )}
      </View>
      <View
        ref={viewportRef}
        testID="mermaid-viewport"
        accessibilityLabel={
          Platform.OS === "web"
            ? "Mermaid図。ホイールまたは2本指で拡大縮小し、拡大後はドラッグで移動できます。"
            : "Mermaid図。2本指で拡大縮小し、拡大後はドラッグで移動できます。"
        }
        pointerEvents="box-only"
        {...responder.panHandlers}
        onLayout={(event) => {
          const next = event.nativeEvent.layout;
          if (next.width > 0 && next.height > 0)
            setMeasured({ width: next.width, height: next.height });
        }}
        style={{
          height,
          flex: height === undefined ? 1 : undefined,
          minHeight: 0,
          overflow: "hidden",
          backgroundColor: theme.colors.surface0,
        }}
      >
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: transform.x,
            top: transform.y,
            width: content.width,
            height: content.height,
            transform: [{ scale: transform.scale }],
            transformOrigin: "top left",
          }}
        >
          {model.kind === "flow" ? (
            <FlowchartView layout={model.layout} theme={theme} />
          ) : (
            <SequenceView diagram={model.diagram} theme={theme} />
          )}
        </View>
      </View>
      <Text
        style={{
          color: theme.colors.foregroundMuted,
          fontSize: 11,
          lineHeight: 16,
          padding: 8,
        }}
      >
        {Platform.OS === "web"
          ? "ホイールまたは2本指で拡大縮小 · ドラッグで移動"
          : "2本指で拡大縮小 · 拡大後はドラッグで移動"}
      </Text>
    </View>
  );
}
