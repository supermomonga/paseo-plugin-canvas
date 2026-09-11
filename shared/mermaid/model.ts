import { parseFlowchart } from "./flowchart";
import { parseSequence } from "./sequence";
import { layoutFlowchart, layoutSequence } from "./layout";

export function diagramModel(source: string) {
  if (source.length > 50_000)
    throw new Error("Mermaid source must be no longer than 50,000 characters.");
  // Do not discard front matter, init directives, or text preceding a header.
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^%%(?!\{)/.test(line));
  const first = lines[0] ?? "";
  if (lines.some((line) => /^%%\{/.test(line)))
    throw new Error("Mermaid configuration directives are not supported.");
  if (/^(flowchart|graph)(\s|$)/i.test(first)) {
    const chart = parseFlowchart(source);
    if (!chart || !chart.nodes.length)
      throw new Error(
        "Check the flowchart syntax. Place the declaration and diagram content on separate lines.",
      );
    if (chart.skipped.length) throw unsupported(chart.skipped);
    if (
      chart.nodes.some(
        (node) =>
          node.shape === "asymmetric" ||
          node.shape === "hexagon" ||
          node.shape === "unsupported",
      )
    )
      throw new Error(
        "This node shape is not supported. Use a rectangle, rounded rectangle, stadium, subroutine, circle, or diamond.",
      );
    if (chart.nodes.length > 200 || chart.edges.length > 300)
      throw new Error("Diagrams are limited to 200 nodes and 300 edges.");
    const layout = layoutFlowchart(chart);
    checkSize(layout);
    return {
      kind: "flow" as const,
      layout,
      width: layout.width,
      height: layout.height,
    };
  }
  if (/^sequenceDiagram$/i.test(first)) {
    const diagram = parseSequence(source)!;
    if (diagram.skipped.length) throw unsupported(diagram.skipped);
    if (!diagram.participants.length)
      throw new Error("A sequence diagram requires participants or messages.");
    if (diagram.participants.length > 30 || diagram.events.length > 100)
      throw new Error("Sequence diagrams are limited to 30 participants and 100 events.");
    const layout = layoutSequence(
      diagram.participants,
      diagram.events.length,
      diagram.events,
    );
    checkSize(layout);
    return {
      kind: "sequence" as const,
      diagram,
      width: layout.width,
      height: layout.height,
    };
  }
  throw new Error(
    "Supported diagram types are flowchart, graph, and sequenceDiagram. Other types are not supported.",
  );
}
function unsupported(lines: string[]) {
  const sample = lines
    .slice(0, 3)
    .map((line) => line.slice(0, 100))
    .join("\n");
  return new Error(
    `Unsupported or unrecognized syntax on ${lines.length} ${lines.length === 1 ? "line" : "lines"}. Partial diagrams cannot be displayed.\n${sample}`,
  );
}
function checkSize(size: { width: number; height: number }) {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width > 8000 ||
    size.height > 8000
  )
    throw new Error("The diagram is too large. Split it into smaller diagrams.");
}
export type DiagramModel = ReturnType<typeof diagramModel>;
