import { expect, test } from "vitest";
import { diagnoseMarkdown } from "../server/diagnostics";
import { diagramModel } from "../shared/mermaid/model";

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
  expect(
    result.diagnostics.map(({ block, line, source }) => ({
      block,
      line,
      source,
    })),
  ).toEqual([
    { block: 2, line: 11, source: "loop retry" },
    { block: 2, line: 12, source: "end" },
  ]);
  expect(
    result.diagnostics.every((d) => d.hint.includes("explicit steps")),
  ).toBe(true);
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

test("large numbers of unsupported lines produce bounded, explicitly truncated diagnostics", () => {
  const result = diagnoseMarkdown(
    "```mermaid\nsequenceDiagram\nA->>B: hello\n" +
      "loop retry\n".repeat(100) +
      "```",
  );
  expect(result.diagnostics).toHaveLength(32);
  expect(result.diagnosticCount).toBe(100);
  expect(result.diagnosticsTruncated).toBe(true);
});

test("uses the preview's Markdown grammar inside details, math, and code fences", () => {
  const details =
    "<details>\n<summary>Diagram</summary>\n\n```mermaid\nsequenceDiagram\nloop retry\nend\n```\n\n</details>";
  expect(
    diagnoseMarkdown(details).diagnostics.map((entry) => entry.line),
  ).toEqual([6, 7]);
  expect(diagnoseMarkdown("$$\n```mermaid\npie\n```\n$$").diagnostics).toEqual(
    [],
  );
  expect(
    diagnoseMarkdown("````markdown\n```mermaid\npie\n```\n````").diagnostics,
  ).toEqual([]);
});
