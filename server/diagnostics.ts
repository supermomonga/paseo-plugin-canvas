import { visit } from "unist-util-visit";
import { diagramModel, isMermaidDiagnosticError } from "../shared/mermaid/model";
import { markdownParser } from "./document";

const MAX_DIAGNOSTICS = 32;

/**
 * Reports Mermaid blocks that Canvas's interactive renderer cannot draw. Paseo's
 * standard Mermaid renderer displays them instead (ADR 18), so they are
 * information for the author rather than failures: Canvas cannot validate that
 * syntax, and those diagrams lose Canvas's zoom, pan and expanded view.
 */
export function diagnoseMarkdown(content: string) {
  const diagnostics: {
    severity: "info";
    code: "MERMAID_STANDARD_RENDERER";
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
      total++;
      if (diagnostics.length >= MAX_DIAGNOSTICS) return;
      const lines = node.value.split(/\r?\n/);
      const skipped = new Set(error.sourceLines);
      const first = lines.findIndex((source) => skipped.has(source.trim()));
      const start = (node.position?.start.line ?? 1) + 1;
      diagnostics.push({
        severity: "info",
        code: "MERMAID_STANDARD_RENDERER",
        block,
        line: start + Math.max(first, 0),
        endLine: start + lines.length - 1,
        source: (first >= 0 ? lines[first] : node.value).slice(0, 500),
        message: `Shown with Paseo's standard Mermaid renderer: ${error.message}`,
        hint: `No change is needed if this is valid Mermaid; Canvas cannot check that syntax. To keep Canvas's zoom, pan and expanded view, stay within its subset. ${error.hint}`,
      });
    }
  });
  return {
    diagnostics,
    diagnosticCount: total,
    diagnosticsTruncated: total > diagnostics.length,
  };
}
