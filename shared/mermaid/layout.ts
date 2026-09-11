// Adapted from dutchakdev/paseo-plugin-mermaid, commit 8e983c8108521da23ae05070f896a0057f0982f3.
// MIT; see third-party/paseo-plugin-mermaid/LICENSE.
import type { SeqEvent } from "./sequence";
import type { Direction, Flowchart, FlowEdge, FlowNode } from "./flowchart";

/**
 * Layered layout for a flowchart, computed here rather than in the renderer so
 * the geometry can be tested without mounting anything. React Native has no SVG,
 * so the renderer places plain Views at these coordinates and draws edges as
 * orthogonal segments.
 */

export interface LaidOutNode extends FlowNode {
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Segment {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutEdge extends FlowEdge {
  segments: Segment[];
  /** Where the arrowhead sits and which way it points. */
  arrowAt: {
    x: number;
    y: number;
    direction: "up" | "down" | "left" | "right";
  } | null;
  labelAt: { x: number; y: number } | null;
}

export interface FlowLayout {
  direction: Direction;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

const CHAR_WIDTH = 7.1;
const LINE_HEIGHT = 17;
const PADDING_X = 14;
const PADDING_Y = 10;
const MIN_WIDTH = 56;
const LAYER_GAP = 56;
const NODE_GAP = 22;
const LINE = 1.5;
/** Breadth reserved for each lane an edge that skips a layer runs through. */
const LANE_GAP = 26;

export function measureNode(node: FlowNode): { width: number; height: number } {
  const lines = node.label.split("\n");
  const longest = Math.max(...lines.map(textUnits), 1);
  const width = Math.max(
    MIN_WIDTH,
    Math.round(longest * CHAR_WIDTH) + PADDING_X * 2,
  );
  const height = lines.length * LINE_HEIGHT + PADDING_Y * 2;
  // A diamond is a square rotated 45 degrees, so its box has to be square too:
  // the rendered corners then touch the box edges exactly, and an edge routed to
  // the box lands on the shape instead of stopping short of it.
  if (node.shape === "diamond") {
    const side = width + height;
    return { width: side, height: side };
  }
  if (node.shape === "circle") {
    const side = Math.max(width, height);
    return { width: side, height: side };
  }
  return { width, height };
}

/**
 * Longest-path layering. Back edges are found first and left out of the ranking,
 * so a cycle produces a readable graph instead of an infinite descent.
 */
export function assignLayers(
  nodes: FlowNode[],
  edges: FlowEdge[],
): Map<string, number> {
  const ids = new Set(nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }

  const back = new Set<FlowEdge>();
  const state = new Map<string, "open" | "done">();
  const walk = (id: string) => {
    state.set(id, "open");
    for (const next of outgoing.get(id) ?? []) {
      const seen = state.get(next);
      if (seen === "open") {
        for (const edge of edges)
          if (edge.from === id && edge.to === next) back.add(edge);
        continue;
      }
      if (seen === undefined) walk(next);
    }
    state.set(id, "done");
  };
  for (const node of nodes) if (!state.has(node.id)) walk(node.id);

  const forward = edges.filter(
    (edge) => !back.has(edge) && ids.has(edge.from) && ids.has(edge.to),
  );
  const layer = new Map<string, number>(nodes.map((node) => [node.id, 0]));

  // Relax until stable; the graph is a DAG now, so this settles in at most |V| rounds.
  for (let round = 0; round < nodes.length; round += 1) {
    let moved = false;
    for (const edge of forward) {
      const candidate = (layer.get(edge.from) ?? 0) + 1;
      if (candidate > (layer.get(edge.to) ?? 0)) {
        layer.set(edge.to, candidate);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return layer;
}

/** One barycentre pass: each node drifts toward the average position of its parents. */
export function orderLayers(
  nodes: FlowNode[],
  edges: FlowEdge[],
  layers: Map<string, number>,
): string[][] {
  const depth = Math.max(...[...layers.values()], 0) + 1;
  const rows: string[][] = Array.from({ length: depth }, () => []);
  for (const node of nodes) rows[layers.get(node.id) ?? 0].push(node.id);

  for (let index = 1; index < rows.length; index += 1) {
    const previous = new Map(
      rows[index - 1].map((id, position) => [id, position]),
    );
    const score = new Map<string, number>();
    for (const id of rows[index]) {
      const parents = edges
        .filter((edge) => edge.to === id && previous.has(edge.from))
        .map((edge) => previous.get(edge.from) as number);
      score.set(
        id,
        parents.length > 0
          ? parents.reduce((a, b) => a + b, 0) / parents.length
          : Number.MAX_SAFE_INTEGER,
      );
    }
    const original = new Map(rows[index].map((id, position) => [id, position]));
    rows[index] = [...rows[index]].sort(
      (left, right) =>
        (score.get(left) as number) - (score.get(right) as number) ||
        (original.get(left) as number) - (original.get(right) as number),
    );
  }
  return rows;
}

const horizontal = (direction: Direction) =>
  direction === "LR" || direction === "RL";

export function layoutFlowchart(chart: Flowchart): FlowLayout {
  const layers = assignLayers(chart.nodes, chart.edges);
  const rows = orderLayers(chart.nodes, chart.edges, layers);
  const sizes = new Map(
    chart.nodes.map((node) => [node.id, measureNode(node)]),
  );
  const byId = new Map(chart.nodes.map((node) => [node.id, node]));
  const across = horizontal(chart.direction);
  const labels = chart.edges.map((edge) => measureEdgeLabel(edge.label ?? ""));
  const layerGap = Math.max(
    LAYER_GAP,
    ...labels.map((size) => (across ? size.width : size.height) + 16),
  );

  // "Depth" runs along the flow, "breadth" across it; transposing at the end is
  // what makes LR fall out of the same maths as TD.
  const depthOffsets: number[] = [];
  let depthCursor = 0;
  const rowBreadth = rows.map((row) => {
    const total = row.reduce((sum, id) => {
      const size = sizes.get(id) as { width: number; height: number };
      return sum + (across ? size.height : size.width);
    }, 0);
    return total + Math.max(0, row.length - 1) * NODE_GAP;
  });
  const widestRow = Math.max(...rowBreadth, 0);

  for (const row of rows) {
    depthOffsets.push(depthCursor);
    const deepest = Math.max(
      ...row.map((id) => {
        const size = sizes.get(id) as { width: number; height: number };
        return across ? size.width : size.height;
      }),
      0,
    );
    depthCursor += deepest + layerGap;
  }
  const totalDepth = Math.max(0, depthCursor - layerGap);

  const placed = new Map<string, LaidOutNode>();
  rows.forEach((row, rowIndex) => {
    let breadthCursor = (widestRow - rowBreadth[rowIndex]) / 2;
    for (const id of row) {
      const size = sizes.get(id) as { width: number; height: number };
      const node = byId.get(id) as FlowNode;
      const breadthSpan = across ? size.height : size.width;
      const depthStart = depthOffsets[rowIndex];

      placed.set(id, {
        ...node,
        layer: rowIndex,
        width: size.width,
        height: size.height,
        x: across ? depthStart : breadthCursor,
        y: across ? breadthCursor : depthStart,
      });
      breadthCursor += breadthSpan + NODE_GAP;
    }
  });

  const flip = chart.direction === "BT" || chart.direction === "RL";
  const nodes = [...placed.values()].map((node) =>
    flip
      ? across
        ? { ...node, x: totalDepth - node.x - node.width }
        : { ...node, y: totalDepth - node.y - node.height }
      : node,
  );
  const finals = new Map(nodes.map((node) => [node.id, node]));

  // An edge that skips a layer cannot be routed between its endpoints: the
  // straight path crosses whatever sits in the layers between them. Those edges
  // get a lane outside the node band instead, one per edge so they do not stack.
  const spans = (edge: FlowEdge): boolean => {
    const from = finals.get(edge.from);
    const to = finals.get(edge.to);
    return (
      !!from && !!to && (to.layer <= from.layer || to.layer - from.layer > 1)
    );
  };
  const longEdges = chart.edges.filter(spans);
  const laneBand =
    longEdges.length * LANE_GAP + (longEdges.length > 0 ? LANE_GAP : 0);

  const contentBreadth = widestRow;
  const lanes = new Map(
    longEdges.map((edge, index) => [
      edge,
      contentBreadth + LANE_GAP * (index + 1),
    ]),
  );

  const edges = chart.edges.map((edge) =>
    route(
      edge,
      finals.get(edge.from),
      finals.get(edge.to),
      across,
      lanes.get(edge),
    ),
  );

  // Include labels and returning/self edges in the fitted bounds, not just nodes.
  const boxes = [
    ...nodes,
    ...edges.flatMap((edge) => [
      ...edge.segments,
      ...(edge.label && edge.labelAt
        ? [
            {
              x: edge.labelAt.x - measureEdgeLabel(edge.label).width / 2,
              y: edge.labelAt.y - measureEdgeLabel(edge.label).height / 2,
              ...measureEdgeLabel(edge.label),
            },
          ]
        : []),
    ]),
  ];
  const minX = Math.min(0, ...boxes.map((box) => box.x));
  const minY = Math.min(0, ...boxes.map((box) => box.y));
  const width =
    Math.max(
      across ? totalDepth : widestRow + laneBand,
      ...boxes.map((box) => box.x + box.width),
    ) - minX;
  const height =
    Math.max(
      across ? widestRow + laneBand : totalDepth,
      ...boxes.map((box) => box.y + box.height),
    ) - minY;
  return {
    direction: chart.direction,
    nodes: nodes.map((node) => ({
      ...node,
      x: node.x - minX,
      y: node.y - minY,
    })),
    edges: edges.map((edge) => ({
      ...edge,
      segments: edge.segments.map((segment) => ({
        ...segment,
        x: segment.x - minX,
        y: segment.y - minY,
      })),
      arrowAt: edge.arrowAt && {
        ...edge.arrowAt,
        x: edge.arrowAt.x - minX,
        y: edge.arrowAt.y - minY,
      },
      labelAt: edge.labelAt && {
        ...edge.labelAt,
        x: edge.labelAt.x - minX,
        y: edge.labelAt.y - minY,
      },
    })),
    width,
    height,
  };
}

/** Three orthogonal segments between neighbours; five through a lane when not. */
function route(
  edge: FlowEdge,
  from: LaidOutNode | undefined,
  to: LaidOutNode | undefined,
  across: boolean,
  lane?: number,
): LaidOutEdge {
  if (!from || !to)
    return { ...edge, segments: [], arrowAt: null, labelAt: null };
  if (lane !== undefined) return routeThroughLane(edge, from, to, across, lane);

  if (across) {
    const forward = to.x >= from.x;
    const startX = forward ? from.x + from.width : from.x;
    const endX = forward ? to.x : to.x + to.width;
    const startY = from.y + from.height / 2;
    const endY = to.y + to.height / 2;
    const midX = (startX + endX) / 2;

    return {
      ...edge,
      segments: [
        span(Math.min(startX, midX), startY, Math.abs(midX - startX), LINE),
        span(
          midX - LINE / 2,
          Math.min(startY, endY),
          LINE,
          Math.abs(endY - startY),
        ),
        span(Math.min(midX, endX), endY, Math.abs(endX - midX), LINE),
      ],
      arrowAt: edge.arrow
        ? { x: endX, y: endY, direction: forward ? "right" : "left" }
        : null,
      labelAt: { x: midX, y: (startY + endY) / 2 },
    };
  }

  const forward = to.y >= from.y;
  const startY = forward ? from.y + from.height : from.y;
  const endY = forward ? to.y : to.y + to.height;
  const startX = from.x + from.width / 2;
  const endX = to.x + to.width / 2;
  const midY = (startY + endY) / 2;

  return {
    ...edge,
    segments: [
      span(
        startX - LINE / 2,
        Math.min(startY, midY),
        LINE,
        Math.abs(midY - startY),
      ),
      span(Math.min(startX, endX), midY, Math.abs(endX - startX), LINE),
      span(endX - LINE / 2, Math.min(midY, endY), LINE, Math.abs(endY - midY)),
    ],
    arrowAt: edge.arrow
      ? { x: endX, y: endY, direction: forward ? "down" : "up" }
      : null,
    labelAt: { x: (startX + endX) / 2, y: midY },
  };
}

/**
 * Out of the source, down to a lane clear of every node, across, and back up
 * into the target. Longer than a direct route, and the only one that is honest
 * about not passing through the boxes in between.
 */
function routeThroughLane(
  edge: FlowEdge,
  from: LaidOutNode,
  to: LaidOutNode,
  across: boolean,
  lane: number,
): LaidOutEdge {
  if (across) {
    const startX = from.x + from.width;
    const endX = to.x;
    const startY = from.y + from.height / 2;
    const endY = to.y + to.height / 2;
    const outX = startX + LANE_GAP / 2;
    const inX = endX - LANE_GAP / 2;

    return {
      ...edge,
      segments: [
        span(startX, startY, outX - startX, LINE),
        span(
          outX - LINE / 2,
          Math.min(startY, lane),
          LINE,
          Math.abs(lane - startY),
        ),
        span(Math.min(outX, inX), lane, Math.abs(inX - outX), LINE),
        span(inX - LINE / 2, Math.min(endY, lane), LINE, Math.abs(lane - endY)),
        span(inX, endY, endX - inX, LINE),
      ],
      arrowAt: edge.arrow ? { x: endX, y: endY, direction: "right" } : null,
      labelAt: { x: (outX + inX) / 2, y: lane },
    };
  }

  const startY = from.y + from.height;
  const endY = to.y;
  const startX = from.x + from.width / 2;
  const endX = to.x + to.width / 2;
  const outY = startY + LANE_GAP / 2;
  const inY = endY - LANE_GAP / 2;

  return {
    ...edge,
    segments: [
      span(startX - LINE / 2, startY, LINE, outY - startY),
      span(Math.min(startX, lane), outY, Math.abs(lane - startX), LINE),
      span(lane - LINE / 2, Math.min(outY, inY), LINE, Math.abs(inY - outY)),
      span(Math.min(lane, endX), inY, Math.abs(endX - lane), LINE),
      span(endX - LINE / 2, inY, LINE, endY - inY),
    ],
    arrowAt: edge.arrow ? { x: endX, y: endY, direction: "down" } : null,
    labelAt: { x: lane, y: (outY + inY) / 2 },
  };
}

const span = (
  x: number,
  y: number,
  width: number,
  height: number,
): Segment => ({
  x,
  y,
  width: Math.max(width, LINE),
  height: Math.max(height, LINE),
});

/* -------------------------------------------------------------------------- */
/* Sequence diagrams                                                            */
/* -------------------------------------------------------------------------- */

export interface SequenceColumn {
  id: string;
  label: string;
  actor: boolean;
  centerX: number;
  width: number;
}

export interface SequenceRow {
  y: number;
  height: number;
}

export interface SequenceLayout {
  columns: SequenceColumn[];
  rows: SequenceRow[];
  headerHeight: number;
  width: number;
  height: number;
}

const SEQ_ROW = 44;
const SEQ_HEADER = 40;
const SEQ_GAP = 40;
const SEQ_MIN_COLUMN = 96;

/**
 * Columns are sized to their own label, not to a shared width: one participant
 * called "Payment gateway" should not push every other column that wide.
 */
export function layoutSequence(
  participants: { id: string; label: string; actor: boolean }[],
  eventCount: number,
  events?: SeqEvent[],
): SequenceLayout {
  const columns: SequenceColumn[] = [];
  let cursor = 128;

  for (const participant of participants) {
    const width = Math.max(
      SEQ_MIN_COLUMN,
      Math.round(textUnits(participant.label) * CHAR_WIDTH) + PADDING_X * 2,
    );
    columns.push({ ...participant, width, centerX: cursor + width / 2 });
    cursor += width + SEQ_GAP;
  }

  let rowY = SEQ_HEADER;
  const centers = new Map(columns.map((column) => [column.id, column.centerX]));
  const rows = Array.from({ length: eventCount }, (_, index) => {
    const event = events?.[index];
    const span =
      event?.kind === "message" && event.from !== event.to
        ? Math.abs(centers.get(event.to)! - centers.get(event.from)!)
        : 120;
    const lines = event
      ? Math.max(
          1,
          Math.ceil(
            (textUnits(event.text) * CHAR_WIDTH) / Math.max(60, span - 16),
          ),
        )
      : 1;
    const height = Math.max(SEQ_ROW, lines * 17 + 36);
    const row = { y: rowY, height };
    rowY += height;
    return row;
  });

  return {
    columns,
    rows,
    headerHeight: SEQ_HEADER,
    width: Math.max(0, cursor - SEQ_GAP + 128),
    height: rowY + 12,
  };
}

/** Conservative text sizing for the renderer's 12px labels, including CJK. */
function textUnits(text: string): number {
  return Array.from(text).reduce(
    (sum, char) => sum + (char.codePointAt(0)! > 0xff ? 2 : 1),
    0,
  );
}

export function measureEdgeLabel(label: string): {
  width: number;
  height: number;
} {
  const lines = label.split("\n");
  return {
    width: Math.max(24, ...lines.map((line) => textUnits(line) * 6)) + 12,
    height: lines.length * 14 + 4,
  };
}
