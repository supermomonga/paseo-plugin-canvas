/*!
 * SPDX-License-Identifier: MIT
 *
 * Adapted from dutchakdev/paseo-plugin-mermaid.
 * Source: https://github.com/dutchakdev/paseo-plugin-mermaid/blob/8e983c8108521da23ae05070f896a0057f0982f3/client/diagram.tsx
 * Local modifications: see third-party/paseo-plugin-mermaid/README.md.
 *
 * MIT License
 *
 * Copyright (c) 2026 dutchakdev
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import React from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { NodeShape } from "../../shared/mermaid/flowchart";
import {
  layoutFlowchart,
  layoutSequence,
  measureEdgeLabel,
  type LaidOutNode,
  type LaidOutEdge,
} from "../../shared/mermaid/layout";
import { parseSequence, type SeqEvent } from "../../shared/mermaid/sequence";
const ARROW = 5;
function radiusFor(shape: NodeShape, node: LaidOutNode): number {
  if (shape === "circle") return node.width / 2;
  if (shape === "stadium") return node.height / 2;
  if (shape === "round") return 12;
  return 4;
}

export function FlowchartView({
  layout,
  theme,
}: {
  layout: ReturnType<typeof layoutFlowchart>;
  theme: PluginTheme;
}) {
  return (
    <View
      style={{ width: layout.width, height: layout.height, paddingBottom: 4 }}
    >
      {layout.edges.map((edge, index) => (
        <EdgeView key={index} edge={edge} theme={theme} />
      ))}
      {layout.nodes.map((node) => (
        <NodeView key={node.id} node={node} theme={theme} />
      ))}
    </View>
  );
}

function NodeView({ node, theme }: { node: LaidOutNode; theme: PluginTheme }) {
  const common = {
    position: "absolute" as const,
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
  };

  if (node.shape === "diamond") {
    // A square turned 45 degrees is the diamond. Its side is the box divided by
    // root two, so the rotated corners reach the box edges and an arrow routed to
    // the box touches the shape. The label sits upright on top, which avoids
    // counter-rotating text and the clipping that brings.
    const side = Math.min(node.width, node.height) / Math.SQRT2;
    return (
      <View
        style={[common, { alignItems: "center", justifyContent: "center" }]}
      >
        <View
          style={{
            position: "absolute",
            width: side,
            height: side,
            transform: [{ rotate: "45deg" }],
            borderWidth: 1,
            borderColor: theme.colors.accent,
            backgroundColor: theme.colors.surface0,
          }}
        />
        <Text
          allowFontScaling={false}
          style={{
            color: theme.colors.foreground,
            fontSize: 12,
            lineHeight: 17,
            textAlign: "center",
          }}
        >
          {node.label}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        common,
        {
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 8,
          borderWidth: 1,
          borderColor: theme.colors.accent,
          borderRadius: radiusFor(node.shape, node),
          backgroundColor: theme.colors.surface0,
        },
      ]}
    >
      {node.shape === "subroutine" ? (
        <View
          style={{
            position: "absolute",
            left: 5,
            right: 5,
            top: 0,
            bottom: 0,
            borderLeftWidth: 1,
            borderRightWidth: 1,
            borderColor: theme.colors.accent,
          }}
        />
      ) : null}
      <Text
        allowFontScaling={false}
        style={{
          color: theme.colors.foreground,
          fontSize: 12,
          lineHeight: 17,
          textAlign: "center",
        }}
      >
        {node.label}
      </Text>
    </View>
  );
}

function EdgeView({ edge, theme }: { edge: LaidOutEdge; theme: PluginTheme }) {
  const color = theme.colors.foregroundMuted;
  return (
    <>
      {edge.segments.map((segment, index) => (
        <Line
          key={index}
          x={segment.x}
          y={segment.y}
          width={segment.width}
          height={segment.height}
          color={color}
          dashed={edge.style === "dotted"}
          thick={edge.style === "thick"}
        />
      ))}
      {edge.arrowAt ? <Arrow at={edge.arrowAt} color={color} /> : null}
      {edge.label && edge.labelAt ? (
        <Text
          allowFontScaling={false}
          style={{
            position: "absolute",
            left: edge.labelAt.x - measureEdgeLabel(edge.label).width / 2,
            top: edge.labelAt.y - measureEdgeLabel(edge.label).height / 2,
            width: measureEdgeLabel(edge.label).width,
            lineHeight: 14,
            paddingVertical: 2,
            textAlign: "center",
            fontSize: 10,
            color: theme.colors.foregroundMuted,
            backgroundColor: theme.colors.surface0,
          }}
        >
          {edge.label}
        </Text>
      ) : null}
    </>
  );
}

/** Three transparent borders and one solid one make a triangle. */
function Arrow({
  at,
  color,
}: {
  at: NonNullable<LaidOutEdge["arrowAt"]>;
  color: string;
}) {
  const vertical = at.direction === "down" || at.direction === "up";
  const side = {
    borderLeftWidth: ARROW,
    borderRightWidth: ARROW,
    borderTopWidth: ARROW,
    borderBottomWidth: ARROW,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
  };
  const filled =
    at.direction === "down"
      ? { borderTopColor: color, borderBottomWidth: 0 }
      : at.direction === "up"
        ? { borderBottomColor: color, borderTopWidth: 0 }
        : at.direction === "right"
          ? { borderLeftColor: color, borderRightWidth: 0 }
          : { borderRightColor: color, borderLeftWidth: 0 };

  return (
    <View
      style={[
        {
          position: "absolute",
          width: 0,
          height: 0,
          left:
            at.x - (vertical ? ARROW : at.direction === "right" ? ARROW : 0),
          top:
            at.y - (vertical ? (at.direction === "down" ? ARROW : 0) : ARROW),
        },
        side,
        filled,
      ]}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Sequence                                                                     */
/* -------------------------------------------------------------------------- */

export function SequenceView({
  diagram,
  theme,
}: {
  diagram: NonNullable<ReturnType<typeof parseSequence>>;
  theme: PluginTheme;
}) {
  const layout = layoutSequence(
    diagram.participants,
    diagram.events.length,
    diagram.events,
  );
  const centers = new Map(
    layout.columns.map((column) => [column.id, column.centerX]),
  );

  return (
    <View
      style={{ width: layout.width, height: layout.height, paddingBottom: 4 }}
    >
      {layout.columns.map((column) => (
        <React.Fragment key={column.id}>
          <View
            style={{
              position: "absolute",
              left: column.centerX - 0.75,
              top: layout.headerHeight,
              width: 1.5,
              height: layout.height - layout.headerHeight,
              backgroundColor: theme.colors.foregroundMuted,
              opacity: 0.4,
            }}
          />
          <View
            style={{
              position: "absolute",
              left: column.centerX - column.width / 2,
              top: 0,
              width: column.width,
              height: 28,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: theme.colors.accent,
              borderRadius: column.actor ? 14 : 4,
              backgroundColor: theme.colors.surface0,
            }}
          >
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              style={{ color: theme.colors.foreground, fontSize: 12 }}
            >
              {column.label}
            </Text>
          </View>
        </React.Fragment>
      ))}

      {diagram.events.map((event, index) => (
        <EventView
          key={index}
          event={event}
          y={layout.rows[index].y}
          height={layout.rows[index].height}
          centers={centers}
          theme={theme}
        />
      ))}
    </View>
  );
}

function EventView({
  event,
  y,
  height,
  centers,
  theme,
}: {
  event: SeqEvent;
  y: number;
  height: number;
  centers: Map<string, number>;
  theme: PluginTheme;
}) {
  const color = theme.colors.foregroundMuted;
  if (event.kind === "note") {
    const xs = event.over.map((id) => centers.get(id)!);
    const low = Math.min(...xs),
      high = Math.max(...xs);
    const width =
      event.placement === "over" ? Math.max(120, high - low + 80) : 120;
    const left =
      event.placement === "left"
        ? low - width - 8
        : event.placement === "right"
          ? high + 8
          : (low + high - width) / 2;
    return (
      <View
        style={{
          position: "absolute",
          left,
          top: y + 4,
          width,
          padding: 8,
          borderWidth: 1,
          borderColor: color,
          borderRadius: 4,
          backgroundColor: theme.colors.surface0,
        }}
      >
        <Text
          allowFontScaling={false}
          style={{ color, fontSize: 11, lineHeight: 17, textAlign: "center" }}
        >
          {event.text}
        </Text>
      </View>
    );
  }
  const from = centers.get(event.from)!;
  const to = centers.get(event.to)!;
  const self = event.from === event.to;
  const forward = to >= from;
  const left = Math.min(from, to);
  const width = self ? 120 : Math.abs(to - from);
  const lineY = y + height - (self ? 22 : 12);
  const dashed = event.style === "dashed";
  const arrowY = self ? lineY + 14 : lineY;
  return (
    <>
      <Text
        allowFontScaling={false}
        style={{
          position: "absolute",
          left: left + 4,
          top: y + 2,
          width: width - 8,
          fontSize: 11,
          lineHeight: 17,
          textAlign: "center",
          color: theme.colors.foreground,
        }}
      >
        {event.text}
      </Text>
      <Line
        x={left}
        y={lineY}
        width={width}
        height={1.5}
        dashed={dashed}
        color={color}
      />
      {self && (
        <>
          <Line
            x={left + width}
            y={lineY}
            width={1.5}
            height={14}
            dashed={dashed}
            color={color}
          />
          <Line
            x={left}
            y={lineY + 14}
            width={width}
            height={1.5}
            dashed={dashed}
            color={color}
          />
        </>
      )}
      {event.arrow === "filled" && (
        <Arrow
          at={{
            x: to,
            y: arrowY + 0.75,
            direction: self || !forward ? "left" : "right",
          }}
          color={color}
        />
      )}
      {event.arrow === "open" && (
        <>
          <View
            style={{
              position: "absolute",
              left: to - 4,
              top: arrowY,
              width: 8,
              height: 1.5,
              backgroundColor: color,
              transform: [{ rotate: "45deg" }],
            }}
          />
          <View
            style={{
              position: "absolute",
              left: to - 4,
              top: arrowY,
              width: 8,
              height: 1.5,
              backgroundColor: color,
              transform: [{ rotate: "-45deg" }],
            }}
          />
        </>
      )}
      {event.arrow === "async" && (
        <View
          style={{
            position: "absolute",
            left: self || !forward ? to : to - 7,
            top: arrowY - 2,
            width: 8,
            height: 1.5,
            backgroundColor: color,
            transform: [{ rotate: self || !forward ? "-45deg" : "45deg" }],
          }}
        />
      )}
    </>
  );
}

function Line({
  x,
  y,
  width,
  height,
  color,
  dashed = false,
  thick = false,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  dashed?: boolean;
  thick?: boolean;
}) {
  const horizontal = width >= height;
  const length = horizontal ? width : height;
  const thickness = thick ? 3 : 1.5;
  const segments = dashed ? Math.ceil(length / 8) : 1;
  return (
    <>
      {Array.from({ length: segments }, (_, index) => {
        const start = dashed ? index * 8 : 0;
        const span = dashed ? Math.min(4, length - start) : length;
        return (
          <View
            key={index}
            style={{
              position: "absolute",
              left: x + (horizontal ? start : 0),
              top: y + (horizontal ? 0 : start),
              width: horizontal ? span : thickness,
              height: horizontal ? thickness : span,
              backgroundColor: color,
            }}
          />
        );
      })}
    </>
  );
}
