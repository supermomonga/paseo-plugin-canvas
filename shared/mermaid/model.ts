import { parseFlowchart } from "./flowchart";
import { parseSequence } from "./sequence";
import { layoutFlowchart, layoutSequence } from "./layout";

const diagnosticErrors = new WeakSet<Error>();

// Error subclasses also fail in Hermes' source-evaluated plugin bundles.
// Track the errors we create so unexpected parser failures are still rethrown.
function mermaidDiagnosticError(
  message: string,
  hint = "Use flowchart/graph with supported node shapes and edges, or sequenceDiagram with participants, messages and notes. Expand unsupported control blocks into explicit steps.",
  sourceLines: string[] = [],
) {
  const error = Object.assign(new Error(message), {
    name: "MermaidDiagnosticError",
    hint,
    sourceLines,
  });
  diagnosticErrors.add(error);
  return error;
}

export function isMermaidDiagnosticError(
  error: unknown,
): error is ReturnType<typeof mermaidDiagnosticError> {
  return error instanceof Error && diagnosticErrors.has(error);
}

export function diagramModel(source: string) {
  if (source.length > 50_000)
    throw mermaidDiagnosticError(
      "Mermaid source must be no longer than 50,000 characters.",
    );
  // Do not discard front matter, init directives, or text preceding a header.
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^%%(?!\{)/.test(line));
  const first = lines[0] ?? "";
  if (lines.some((line) => /^%%\{/.test(line)))
    throw mermaidDiagnosticError(
      "Mermaid configuration directives are not supported.",
    );
  if (/^(flowchart|graph)(\s|$)/i.test(first)) {
    const chart = parseFlowchart(source);
    if (!chart || !chart.nodes.length)
      throw mermaidDiagnosticError(
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
      throw mermaidDiagnosticError(
        "This node shape is not supported. Use a rectangle, rounded rectangle, stadium, subroutine, circle, or diamond.",
      );
    if (chart.nodes.length > 200 || chart.edges.length > 300)
      throw mermaidDiagnosticError(
        "Diagrams are limited to 200 nodes and 300 edges.",
      );
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
      throw mermaidDiagnosticError(
        "A sequence diagram requires participants or messages.",
      );
    if (diagram.participants.length > 30 || diagram.events.length > 100)
      throw mermaidDiagnosticError(
        "Sequence diagrams are limited to 30 participants and 100 events.",
      );
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
  throw mermaidDiagnosticError(
    "Supported diagram types are flowchart, graph, and sequenceDiagram. Other types are not supported.",
  );
}
function unsupported(lines: string[]) {
  const sample = lines
    .slice(0, 3)
    .map((line) => line.slice(0, 100))
    .join("\n");
  return mermaidDiagnosticError(
    `Unsupported or unrecognized syntax on ${lines.length} ${lines.length === 1 ? "line" : "lines"}. Partial diagrams cannot be displayed.\n${sample}`,
    undefined,
    lines,
  );
}
function checkSize(size: { width: number; height: number }) {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width > 8000 ||
    size.height > 8000
  )
    throw mermaidDiagnosticError(
      "The diagram is too large. Split it into smaller diagrams.",
    );
}
export type DiagramModel = ReturnType<typeof diagramModel>;
