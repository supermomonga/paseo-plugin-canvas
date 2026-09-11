import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Text, View, useWindowDimensions } from "react-native";
import type { GestureResponderEvent } from "react-native";
import { Modal } from "@getpaseo/plugin/client/react-native";
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
  const window = useWindowDimensions();
  return (
    <View style={{ gap: 8 }}>
      {parsed.model ? (
        <DiagramViewport
          key={source}
          model={parsed.model}
          theme={theme}
          width={width}
          height={Math.min(360, Math.max(220, parsed.model.height + 32))}
        />
      ) : (
        <View
          accessibilityRole="alert"
          style={{
            padding: 12,
            gap: 6,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 6,
          }}
        >
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
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {parsed.model && (
          <Button
            label="図を開く"
            icon="Maximize2"
            size="sm"

            onPress={() => setModal("diagram")}
          />
        )}
        <Button
          label="記法を表示"
          icon="Code"
          size="sm"

          onPress={() => setModal("source")}
        />
      </View>
      <Modal
        title={modal === "diagram" ? "Mermaid図" : "Mermaidの記法"}
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
      >
        <Modal.Content scrollable>
          {modal === "diagram" && parsed.model ? (
            <DiagramViewport
              key={source}
              model={parsed.model}
              theme={theme}
              width={Math.min(window.width - 80, 800)}
              height={Math.max(100, Math.min(window.height - 400, 360))}
            />
          ) : (
            <CodeBlock code={source} language="mermaid" copyable={false} />
          )}
        </Modal.Content>
      </Modal>
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

export function DiagramViewport({
  model,
  theme,
  width,
  height,
}: {
  model: DiagramModel;
  theme: PluginTheme;
  width: number;
  height: number;
}) {
  const [measured, setMeasured] = useState(Math.max(1, width));
  const size = useMemo(() => ({ width: measured, height }), [measured, height]);
  const content = useMemo(
    () => ({ width: model.width, height: model.height }),
    [model.width, model.height],
  );
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
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
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
          label="全体表示"
          icon="Scan"
          size="sm"

          onPress={() => commit(fitted(content, size))}
        />
      </View>
      <View
        testID="mermaid-viewport"
        accessibilityLabel="Mermaid図。拡大後はドラッグ、または2本指で拡大縮小・移動できます。"
        pointerEvents="box-only"
        {...responder.panHandlers}
        onLayout={(event) => {
          const next = event.nativeEvent.layout.width;
          if (next > 0) setMeasured(next);
        }}
        style={{
          height,
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
        拡大後はドラッグで移動 · タッチ操作は2本指で拡大縮小
      </Text>
    </View>
  );
}
