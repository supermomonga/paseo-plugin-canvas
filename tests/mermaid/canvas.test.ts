import { expect, test } from "vitest";
import { diagramModel } from "../../shared/mermaid/model";
import { bounded, fitted, zoomAt } from "../../shared/mermaid/viewport";

test("Canvas refuses partial drawings when either parser skips semantic content", () => {
  for (const source of [
    "flowchart LR\nsubgraph A\nB-->C\nend",
    "sequenceDiagram\nA->>B: hello\nloop retry\nB->>A: bye\nend",
    "flowchart TD\nA-->B\nclassDef warning fill:red",
    "gantt\ntitle Plan",
    "flowchart TD\nA{{hexagon}} --> B",
    "flowchart TD\nA[(database)] --> B",
    "arbitrary header\nsequenceDiagram\nA->>B: hi",
    "%%{init: {}}%%\nflowchart TD\nA-->B",
  ])
    expect(() => diagramModel(source)).toThrow();
  expect(
    diagramModel("%% comment\nflowchart LR\nA[計画] --> B[実装]").kind,
  ).toBe("flow");
  expect(
    diagramModel("sequenceDiagram\nA->>A: 自分を呼ぶ\nNote right of A: 確認")
      .kind,
  ).toBe("sequence");
});

test("large diagrams fail before unbounded native view allocation", () => {
  const source =
    "flowchart LR\n" +
    Array.from({ length: 201 }, (_, n) => `A${n}`).join("\n");
  expect(() => diagramModel(source)).toThrow("200 nodes");
  expect(() => diagramModel("x".repeat(50_001))).toThrow("50,000");
});

test("zoom preserves the focal point and pan keeps content recoverable", () => {
  const content = { width: 1000, height: 600 },
    viewport = { width: 300, height: 200 };
  const initial = fitted(content, viewport);
  expect(initial.scale).toBeLessThan(1);
  const point = { x: 150, y: 100 };
  const zoomed = zoomAt(initial, 1, point, content, viewport);
  expect((point.x - zoomed.x) / zoomed.scale).toBeCloseTo(
    (point.x - initial.x) / initial.scale,
  );
  expect((point.y - zoomed.y) / zoomed.scale).toBeCloseTo(
    (point.y - initial.y) / initial.scale,
  );
  const moved = bounded({ ...zoomed, x: -1e6, y: 1e6 }, content, viewport);
  expect(moved.x + content.width).toBeGreaterThanOrEqual(viewport.width - 16);
  expect(moved.y).toBeLessThanOrEqual(16);
  expect(zoomAt(initial, 100, point, content, viewport).scale).toBe(4);
  expect(fitted(content, { width: 200, height: 300 }).scale).toBeLessThan(
    initial.scale,
  );
});

test("flow labels and self/returning edges remain inside fitted bounds", async () => {
  const { measureEdgeLabel } = await import("../../shared/mermaid/layout");
  for (const direction of ["LR", "RL", "TD", "BT"]) {
    const model = diagramModel(
      `flowchart ${direction}\nA -->|日本語の長い接続ラベル| B\nB --> A\nB --> B`,
    );
    if (model.kind !== "flow") throw new Error("Expected flow");
    for (const edge of model.layout.edges) {
      for (const segment of edge.segments) {
        expect(segment.x).toBeGreaterThanOrEqual(0);
        expect(segment.y).toBeGreaterThanOrEqual(0);
        expect(segment.x + segment.width).toBeLessThanOrEqual(model.width);
        expect(segment.y + segment.height).toBeLessThanOrEqual(model.height);
      }
      if (edge.label && edge.labelAt) {
        const size = measureEdgeLabel(edge.label);
        expect(edge.labelAt.x - size.width / 2).toBeGreaterThanOrEqual(0);
        expect(edge.labelAt.x + size.width / 2).toBeLessThanOrEqual(
          model.width,
        );
      }
    }
    expect(model.layout.edges[2].segments).toHaveLength(5);
  }
});
