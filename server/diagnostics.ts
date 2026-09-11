import { visit } from "unist-util-visit";
import { diagramModel, isMermaidDiagnosticError } from "../shared/mermaid/model";
import { markdownParser } from "./document";

export function diagnoseMarkdown(content: string) {
  const diagnostics: {
    severity: "warning";
    code: "MERMAID_NOT_RENDERABLE";
    block: number;
    line: number;
    endLine: number;
    source: string;
    message: string;
    hint: string;
  }[] = [];
  let block = 0;
  let total = 0;
  visit(markdownParser.parse(content), "code", (node) => {
    if (node.lang !== "mermaid") return;
    block++;
    try {
      diagramModel(node.value.trim());
    } catch (error) {
      if (!isMermaidDiagnosticError(error)) throw error;
      const lines = node.value.split(/\r?\n/);
      const skipped = new Set(error.sourceLines);
      const badLines = lines.flatMap((source, index) =>
        skipped.has(source.trim()) ? [index] : [],
      );
      const locations = badLines.length ? badLines : [0];
      total += locations.length;
      for (const index of locations) {
        if (diagnostics.length >= 32) break;
        diagnostics.push({
          severity: "warning",
          code: "MERMAID_NOT_RENDERABLE",
          block,
          line: (node.position?.start.line ?? 1) + 1 + index,
          endLine: badLines.length
            ? (node.position?.start.line ?? 1) + 1 + index
            : (node.position?.start.line ?? 1) + lines.length,
          source: (badLines.length ? lines[index] : node.value).slice(0, 500),
          message: error.message,
          hint: error.hint,
        });
      }
    }
  });
  return {
    diagnostics,
    diagnosticCount: total,
    diagnosticsTruncated: total > diagnostics.length,
  };
}
