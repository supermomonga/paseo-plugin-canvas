/*!
 * SPDX-License-Identifier: MIT
 *
 * Adapted from dutchakdev/paseo-plugin-mermaid.
 * Source: https://github.com/dutchakdev/paseo-plugin-mermaid/blob/8e983c8108521da23ae05070f896a0057f0982f3/tests/flowchart.test.ts
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
import {
  normalizeEdgeLabels,
  parseFlowchart,
  parseNodeExpression,
  splitChain,
} from "../../shared/mermaid/flowchart";

describe("parseNodeExpression", () => {
  it("reads every bracket shape Mermaid defines", () => {
    expect(parseNodeExpression("A[Rect]")).toMatchObject({
      id: "A",
      label: "Rect",
      shape: "rect",
    });
    expect(parseNodeExpression("B(Round)")).toMatchObject({ shape: "round" });
    expect(parseNodeExpression("C([Stadium])")).toMatchObject({
      shape: "stadium",
    });
    expect(parseNodeExpression("D[[Sub]]")).toMatchObject({
      shape: "subroutine",
    });
    expect(parseNodeExpression("E{Decision}")).toMatchObject({
      shape: "diamond",
    });
    expect(parseNodeExpression("F((Circle))")).toMatchObject({
      shape: "circle",
    });
  });

  it("falls back to the id when a node carries no label", () => {
    expect(parseNodeExpression("start")).toMatchObject({
      id: "start",
      label: "start",
      shape: "rect",
    });
  });

  it("strips quotes, which Mermaid needs for labels containing punctuation", () => {
    expect(parseNodeExpression('A["a, b and c"]')?.label).toBe("a, b and c");
  });

  it("turns <br/> into a real line break", () => {
    expect(parseNodeExpression("A[first<br/>second]")?.label).toBe(
      "first\nsecond",
    );
  });

  it("rejects something that is not a node", () => {
    expect(parseNodeExpression("")).toBeNull();
    expect(parseNodeExpression("has spaces in id")).toBeNull();
  });
});

describe("splitChain", () => {
  it("reads a chain of three nodes as two edges", () => {
    const chain = splitChain("A --> B --> C");
    expect(chain?.parts).toHaveLength(3);
    expect(chain?.operators).toHaveLength(2);
  });

  it("picks the longer operator when two start at the same place", () => {
    // "-.->" must not be read as "-.-" followed by a stray ">".
    expect(splitChain("A -.-> B")?.operators[0]).toMatchObject({
      style: "dotted",
      arrow: true,
    });
  });

  it("reads the pipe label form", () => {
    expect(splitChain("A -->|yes| B")?.operators[0].label).toBe("yes");
  });

  it("distinguishes a line from an arrow", () => {
    expect(splitChain("A --- B")?.operators[0].arrow).toBe(false);
    expect(splitChain("A --> B")?.operators[0].arrow).toBe(true);
  });

  it("returns null when there is no edge at all", () => {
    expect(splitChain("A[Just a node]")).toBeNull();
  });
});

describe("normalizeEdgeLabels", () => {
  it("rewrites the inline label form into the pipe form", () => {
    expect(normalizeEdgeLabels("A -- yes --> B")).toBe("A -->|yes| B");
    expect(normalizeEdgeLabels("A == thick ==> B")).toBe("A ==>|thick| B");
  });

  it("leaves a plain arrow alone", () => {
    expect(normalizeEdgeLabels("A --> B")).toBe("A --> B");
  });
});

describe("parseFlowchart", () => {
  /** The diagram in this repo's own README, subgraphs and all. */
  const README = `flowchart LR
  subgraph client["Paseo app"]
    S["status · cleanup · processes"]
  end
  subgraph server["Daemon subprocess"]
    M["metrics"]
  end
  OS["vm_stat · df · ps"]

  S -- "useRpc(contract, input)" --> M
  M --> OS`;

  it("reads direction from the header", () => {
    expect(parseFlowchart("flowchart LR\n A --> B")?.direction).toBe("LR");
    expect(parseFlowchart("graph TD\n A --> B")?.direction).toBe("TD");
  });

  it("defaults to top-down when the header omits a direction", () => {
    expect(parseFlowchart("flowchart\n A --> B")?.direction).toBe("TD");
  });

  it("returns null for something that is not a flowchart", () => {
    expect(parseFlowchart("sequenceDiagram\n A->>B: hi")).toBeNull();
  });

  it("parses the README diagram's nodes and edges", () => {
    const chart = parseFlowchart(README);
    expect(chart?.nodes.map((node) => node.id).sort()).toEqual([
      "M",
      "OS",
      "S",
    ]);
    expect(chart?.edges).toHaveLength(2);
    expect(chart?.edges[0].label).toBe("useRpc(contract, input)");
  });

  it("reports subgraph lines as skipped instead of dropping them silently", () => {
    const chart = parseFlowchart(README);
    expect(chart?.skipped.some((line) => line.startsWith("subgraph"))).toBe(
      true,
    );
  });

  it("keeps the labelled definition when a node is also mentioned bare", () => {
    const chart = parseFlowchart(
      "flowchart TD\n A --> B\n A[Real label] --> C",
    );
    expect(chart?.nodes.find((node) => node.id === "A")?.label).toBe(
      "Real label",
    );
  });

  it("ignores comments", () => {
    const chart = parseFlowchart("flowchart TD\n %% a note\n A --> B");
    expect(chart?.edges).toHaveLength(1);
    expect(chart?.skipped).toHaveLength(0);
  });

  it("skips styling directives rather than treating them as nodes", () => {
    const chart = parseFlowchart("flowchart TD\n A --> B\n style A fill:#f9f");
    expect(chart?.nodes).toHaveLength(2);
    expect(chart?.skipped).toEqual(["style A fill:#f9f"]);
  });
});
