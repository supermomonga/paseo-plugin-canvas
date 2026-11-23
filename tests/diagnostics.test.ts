import { expect, test } from "vitest";
import { diagnoseMarkdown } from "../server/diagnostics";
import { diagramModel, isMermaidDiagnosticError } from "../shared/mermaid/model";

test("reports precise document lines in multiple Mermaid fences, including nested CRLF content", () => {
  const source = [
    "# Plan",
    "",
    "```mermaid",
    "flowchart LR",
    "A-->B",
    "```",
    "",
    "> ```mermaid",
    "> sequenceDiagram",
    "> A->>B: hello",
    "> loop retry",
    "> end",
    "> ```",
  ].join("\r\n");
  const result = diagnoseMarkdown(source);
  // One note per diagram: Paseo's renderer shows it, and Canvas points at the
  // first line outside its own subset.
  expect(
    result.diagnostics.map(({ block, line, endLine, source, severity, code }) => ({
      block,
      line,
      endLine,
      source,
      severity,
      code,
    })),
  ).toEqual([
    {
      block: 2,
      line: 11,
      endLine: 12,
      source: "loop retry",
      severity: "info",
      code: "MERMAID_STANDARD_RENDERER",
    },
  ]);
  expect(result.diagnostics[0].message).toContain(
    "Paseo's standard Mermaid renderer",
  );
  expect(result.diagnostics[0].hint).toContain("No change is needed");
  expect(result.diagnostics[0].hint).toContain("explicit steps");
});

test.each([
  'pie\n"A": 1',
  "flowchart LR\nA{{Unsupported}}",
  "%%{init: {}}%%\nflowchart LR\nA-->B",
  "flowchart LR\nnot supported",
])("diagnostics agree with the preview: %s", (source) => {
  expect(() => diagramModel(source)).toThrow();
  expect(
    diagnoseMarkdown(`\`\`\`mermaid\n${source}\n\`\`\``).diagnostics.length,
  ).toBeGreaterThan(0);
});

test("ignores Mermaid-looking prose and other code languages; repaired diagrams have no warnings", () => {
  expect(
    diagnoseMarkdown(
      "loop retry\n\n```text\nsequenceDiagram\nloop retry\n```\n\n```mermaid\nsequenceDiagram\nA->>B: hello\n```",
    ),
  ).toEqual({
    diagnostics: [],
    diagnosticCount: 0,
    diagnosticsTruncated: false,
  });
});

test("many diagrams outside the subset produce bounded, explicitly truncated diagnostics", () => {
  const result = diagnoseMarkdown(
    "```mermaid\nsequenceDiagram\nA->>B: hello\nloop retry\nend\n```\n\n".repeat(
      40,
    ),
  );
  expect(result.diagnostics).toHaveLength(32);
  expect(result.diagnosticCount).toBe(40);
  expect(result.diagnosticsTruncated).toBe(true);
});

test("uses the preview's Markdown grammar inside details, math, and code fences", () => {
  const details =
    "<details>\n<summary>Diagram</summary>\n\n```mermaid\nsequenceDiagram\nloop retry\nend\n```\n\n</details>";
  expect(
    diagnoseMarkdown(details).diagnostics.map((entry) => [
      entry.line,
      entry.endLine,
    ]),
  ).toEqual([[6, 7]]);
  expect(diagnoseMarkdown("$$\n```mermaid\npie\n```\n$$").diagnostics).toEqual(
    [],
  );
  expect(
    diagnoseMarkdown("````markdown\n```mermaid\npie\n```\n````").diagnostics,
  ).toEqual([]);
});

test("only parser diagnostic errors are classified as unsupported Mermaid", () => {
  expect(isMermaidDiagnosticError(new TypeError("parser bug"))).toBe(false);
  expect(
    isMermaidDiagnosticError(
      Object.assign(new Error("unrelated"), {
        name: "MermaidDiagnosticError",
        hint: "",
        sourceLines: [],
      }),
    ),
  ).toBe(false);
  let error: unknown;
  try {
    diagramModel("sequenceDiagram\nA->>B: hello\nloop retry\nend");
  } catch (caught) {
    error = caught;
  }
  expect(isMermaidDiagnosticError(error)).toBe(true);
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({
    name: "MermaidDiagnosticError",
    sourceLines: ["loop retry", "end"],
    hint: expect.stringContaining("explicit steps"),
  });
});
