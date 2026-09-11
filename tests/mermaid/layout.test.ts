/*!
 * SPDX-License-Identifier: MIT
 *
 * Adapted from dutchakdev/paseo-plugin-mermaid.
 * Source: https://github.com/dutchakdev/paseo-plugin-mermaid/blob/8e983c8108521da23ae05070f896a0057f0982f3/tests/layout.test.ts
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
import { describe, expect, it } from "vitest";
import { parseFlowchart } from "../../shared/mermaid/flowchart";
import {
  assignLayers,
  layoutFlowchart,
  layoutSequence,
  measureNode,
} from "../../shared/mermaid/layout";

const chart = (source: string) => parseFlowchart(source)!;

describe("measureNode", () => {
  it("grows a node to fit its longest line", () => {
    const narrow = measureNode({ id: "A", label: "A", shape: "rect" });
    const wide = measureNode({
      id: "B",
      label: "a much longer label",
      shape: "rect",
    });
    expect(wide.width).toBeGreaterThan(narrow.width);
  });

  it("grows taller for a multi-line label", () => {
    const one = measureNode({ id: "A", label: "one", shape: "rect" });
    const two = measureNode({ id: "A", label: "one\ntwo", shape: "rect" });
    expect(two.height).toBeGreaterThan(one.height);
  });

  it("keeps a circle square so the label fits inside it", () => {
    const circle = measureNode({ id: "A", label: "hello", shape: "circle" });
    expect(circle.width).toBe(circle.height);
  });
});

describe("assignLayers", () => {
  it("puts a chain on successive layers", () => {
    const graph = chart("flowchart TD\n A --> B --> C");
    const layers = assignLayers(graph.nodes, graph.edges);
    expect([layers.get("A"), layers.get("B"), layers.get("C")]).toEqual([
      0, 1, 2,
    ]);
  });

  it("uses the longest path, not the first one found", () => {
    // A -> C directly, and A -> B -> C. C belongs below B.
    const graph = chart("flowchart TD\n A --> C\n A --> B\n B --> C");
    const layers = assignLayers(graph.nodes, graph.edges);
    expect(layers.get("C")).toBe(2);
  });

  it("terminates on a cycle instead of recursing forever", () => {
    const graph = chart("flowchart TD\n A --> B\n B --> C\n C --> A");
    const layers = assignLayers(graph.nodes, graph.edges);
    expect(layers.size).toBe(3);
    expect(Math.max(...layers.values())).toBeLessThan(3);
  });

  it("puts two independent roots on the same layer", () => {
    const graph = chart("flowchart TD\n A --> C\n B --> C");
    const layers = assignLayers(graph.nodes, graph.edges);
    expect(layers.get("A")).toBe(layers.get("B"));
  });
});

describe("layoutFlowchart", () => {
  it("stacks layers downward for TD", () => {
    const layout = layoutFlowchart(chart("flowchart TD\n A --> B"));
    const [a, b] = ["A", "B"].map((id) =>
      layout.nodes.find((node) => node.id === id)!,
    );
    expect(b.y).toBeGreaterThan(a.y);
    expect(Math.abs(a.x - b.x)).toBeLessThan(1);
  });

  it("stacks layers rightward for LR", () => {
    const layout = layoutFlowchart(chart("flowchart LR\n A --> B"));
    const [a, b] = ["A", "B"].map((id) =>
      layout.nodes.find((node) => node.id === id)!,
    );
    expect(b.x).toBeGreaterThan(a.x);
  });

  it("flips the flow for BT", () => {
    const layout = layoutFlowchart(chart("flowchart BT\n A --> B"));
    const [a, b] = ["A", "B"].map((id) =>
      layout.nodes.find((node) => node.id === id)!,
    );
    expect(b.y).toBeLessThan(a.y);
  });

  it("never overlaps two nodes on the same layer", () => {
    const layout = layoutFlowchart(
      chart("flowchart TD\n R --> A\n R --> B\n R --> C"),
    );
    const row = layout.nodes
      .filter((node) => node.layer === 1)
      .sort((left, right) => left.x - right.x);
    for (let index = 1; index < row.length; index += 1) {
      expect(row[index].x).toBeGreaterThanOrEqual(
        row[index - 1].x + row[index - 1].width,
      );
    }
  });

  it("reports a canvas large enough to hold every node", () => {
    const layout = layoutFlowchart(
      chart("flowchart TD\n R --> A\n R --> B\n A --> C"),
    );
    for (const node of layout.nodes) {
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width + 0.001);
      expect(node.y + node.height).toBeLessThanOrEqual(layout.height + 0.001);
    }
  });

  it("routes an edge with segments and points the arrow along the flow", () => {
    const layout = layoutFlowchart(chart("flowchart TD\n A --> B"));
    const edge = layout.edges[0];
    expect(edge.segments).toHaveLength(3);
    expect(edge.arrowAt?.direction).toBe("down");
  });

  it("gives a line no arrowhead", () => {
    expect(
      layoutFlowchart(chart("flowchart TD\n A --- B")).edges[0].arrowAt,
    ).toBeNull();
  });

  it("places an edge label between its endpoints", () => {
    const layout = layoutFlowchart(chart("flowchart TD\n A -->|yes| B"));
    const [a, b] = ["A", "B"].map((id) =>
      layout.nodes.find((node) => node.id === id)!,
    );
    const label = layout.edges[0].labelAt!;
    expect(label.y).toBeGreaterThan(a.y);
    expect(label.y).toBeLessThan(b.y + b.height);
  });

  it("survives an edge pointing at a node that was never defined", () => {
    const layout = layoutFlowchart({
      direction: "TD",
      nodes: [],
      edges: [{ from: "A", to: "B", label: null, style: "solid", arrow: true }],
      skipped: [],
    });
    expect(layout.edges[0].segments).toEqual([]);
  });
});

describe("layoutSequence", () => {
  const people = [
    { id: "U", label: "User", actor: false },
    { id: "S", label: "Payment gateway", actor: true },
  ];

  it("sizes each column to its own label", () => {
    const layout = layoutSequence(people, 2);
    expect(layout.columns[1].width).toBeGreaterThan(layout.columns[0].width);
  });

  it("never overlaps two columns", () => {
    const layout = layoutSequence(people, 1);
    const [first, second] = layout.columns;
    expect(second.centerX - second.width / 2).toBeGreaterThan(
      first.centerX + first.width / 2,
    );
  });

  it("stacks one row per event below the header", () => {
    const layout = layoutSequence(people, 3);
    expect(layout.rows).toHaveLength(3);
    expect(layout.rows[0].y).toBeGreaterThanOrEqual(layout.headerHeight);
    expect(layout.rows[2].y).toBeGreaterThan(layout.rows[1].y);
  });

  it("reports a canvas that contains the last column and row", () => {
    const layout = layoutSequence(people, 2);
    const last = layout.columns[layout.columns.length - 1];
    expect(last.centerX + last.width / 2).toBeLessThanOrEqual(
      layout.width + 0.001,
    );
    expect(layout.height).toBeGreaterThan(layout.rows[1].y);
  });

  it("handles a diagram with no events yet", () => {
    expect(layoutSequence(people, 0).rows).toEqual([]);
  });
});

describe("diamond geometry", () => {
  it("gives a diamond a square box, so its rotated corners reach the edges", () => {
    const box = measureNode({
      id: "A",
      label: "Has mermaid?",
      shape: "diamond",
    });
    expect(box.width).toBe(box.height);
  });

  it("keeps the box wide enough for the label across the diagonal", () => {
    const plain = measureNode({
      id: "A",
      label: "Has mermaid?",
      shape: "rect",
    });
    const diamond = measureNode({
      id: "A",
      label: "Has mermaid?",
      shape: "diamond",
    });
    expect(diamond.width).toBeGreaterThan(plain.width);
  });
});

describe("edges that skip a layer", () => {
  // Cached? --> Response jumps two layers past Query database and Write cache.
  const source = `flowchart LR
    Req([Request]) --> Auth{Authorized?}
    Auth --> Cache{Cached?}
    Cache -->|miss| Query[[Query database]]
    Cache -->|hit| Serve((Response))
    Query --> Store(Write cache)
    Store --> Serve`;

  const layout = layoutFlowchart(parseFlowchart(source)!);
  const long = layout.edges.find(
    (edge) => edge.from === "Cache" && edge.to === "Serve",
  )!;
  const boxes = layout.nodes.filter(
    (node) => node.id !== "Cache" && node.id !== "Serve",
  );

  it("routes the long edge with five segments rather than three", () => {
    expect(long.segments).toHaveLength(5);
    const direct = layout.edges.find(
      (edge) => edge.from === "Query" && edge.to === "Store",
    )!;
    expect(direct.segments).toHaveLength(3);
  });

  it("keeps every segment of the long edge out of the boxes it skips", () => {
    for (const segment of long.segments) {
      for (const box of boxes) {
        const overlaps =
          segment.x < box.x + box.width &&
          segment.x + segment.width > box.x &&
          segment.y < box.y + box.height &&
          segment.y + segment.height > box.y;
        expect(overlaps, `${long.from}->${long.to} crosses ${box.id}`).toBe(
          false,
        );
      }
    }
  });

  it("grows the canvas so the lane is inside it", () => {
    const lowest = Math.max(
      ...long.segments.map((segment) => segment.y + segment.height),
    );
    expect(lowest).toBeLessThanOrEqual(layout.height);
  });

  it("still points the arrow into the target", () => {
    const target = layout.nodes.find((node) => node.id === "Serve")!;
    expect(long.arrowAt?.direction).toBe("right");
    expect(long.arrowAt?.x).toBeCloseTo(target.x);
  });

  it("puts the label on the lane, clear of the nodes", () => {
    expect(long.label).toBe("hit");
    for (const box of boxes)
      expect(long.labelAt!.y).toBeGreaterThan(box.y + box.height);
  });
});
