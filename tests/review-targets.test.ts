import { expect, test } from "vitest";
import { parseDocument } from "../server/document";
import {
  reviewTargets,
  sourceRange,
  targetLabel,
} from "../shared/review-targets";

test("selection units include complete tables, diagrams and nested lists without overlapping children", () => {
  const source =
    "# Heading\n\nParagraph.\n\n| A | B |\n|---|---|\n| X | Y |\n\n```mermaid\nflowchart LR\nA-->B\n```\n\n- Outer\n  - Inner\n\n> Quote\n>\n> Another paragraph\n\n<details>\n<summary>More</summary>\n\nHidden paragraph.\n\n</details>\n";
  const targets = reviewTargets(parseDocument(source));
  expect(targets.map(targetLabel)).toEqual([
    "heading",
    "paragraph",
    "table",
    "diagram",
    "list",
    "quote",
    "details",
  ]);
  const ranges = targets.map((node) => sourceRange(node)!);
  expect(
    ranges.every((range, i) => i === 0 || ranges[i - 1].end <= range.start),
  ).toBe(true);
  expect(source.slice(ranges[2].start, ranges[2].end)).toContain("| X | Y |");
  expect(source.slice(ranges[3].start, ranges[3].end)).toContain("A-->B");
  expect(source.slice(ranges[4].start, ranges[4].end)).toContain("Inner");
  expect(source.slice(ranges[6].start, ranges[6].end)).toContain(
    "Hidden paragraph.",
  );
});
