import { expect, test } from "vitest";
import { parseDocument } from "../server/document";
import { documentSchema, textContent } from "../shared/document";
import { visit } from "unist-util-visit";
import type { Element } from "hast";
function elements(markdown: string, tag: string) {
  const nodes: Element[] = [];
  visit(parseDocument(markdown), "element", (node) => {
    if (node.tagName === tag) nodes.push(node);
  });
  return nodes;
}
test.each(["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"])(
  "%s alert preserves nested Markdown and multiple paragraphs",
  (type) => {
    const [alert] = elements(
      `> [!${type}]\n> **要点**\n>\n> - 項目\n> - [x] 完了`,
      "aside",
    );
    expect(alert.properties.dataAlert).toBe(type);
    expect(textContent(alert)).toContain("要点");
    expect(textContent(alert)).not.toContain(`[!${type}]`);
    expect(
      alert.children.filter((x) => x.type === "element").map((x) => x.tagName),
    ).toEqual(["p", "ul"]);
  },
);
test("nested, escaped and unknown alert markers remain ordinary content", () => {
  for (const content of [
    "> [!CUSTOM]\n> a",
    "> \\[!NOTE]\n> a",
    "> > [!NOTE]\n> > a",
    "- > [!NOTE]\n  > a",
  ]) {
    expect(elements(content, "aside")).toHaveLength(0);
  }
});
test("footnotes keep all paragraphs and every reference has a return target", () => {
  const tree = parseDocument("本文[^a] 再度[^a]\n\n[^a]: 注釈\n\n    追加段落");
  const ids = new Set<string>();
  const links: string[] = [];
  visit(tree, "element", (n) => {
    if (n.properties.id) ids.add(String(n.properties.id));
    if (String(n.properties.href).startsWith("#"))
      links.push(String(n.properties.href).slice(1));
  });
  expect(links).toHaveLength(4);
  for (const target of links) expect(ids.has(target)).toBe(true);
  expect(textContent(tree)).toContain("追加段落");
});
test("Japanese duplicate headings use GitHub slugs and inline link structure survives", () => {
  expect(
    elements("# 同じ見出し\n\n# 同じ見出し\n\n# 同じ見出し", "h1").map(
      (n) => n.properties.id,
    ),
  ).toEqual(["同じ見出し", "同じ見出し-1", "同じ見出し-2"]);
  const [link] = elements("[**重要**と`code`](https://example.com)", "a");
  expect(
    link.children.filter((n) => n.type === "element").map((n) => n.tagName),
  ).toEqual(["strong", "code"]);
});
test("limited HTML, comments, math and emoji pass through the complete validated pipeline", () => {
  const tree = parseDocument(
    "<details open>\n<summary>補足</summary>\n\nH<sub>2</sub>O x<sup>2</sup><br> :rocket: $a^2$\n\n</details>\n\n<!-- hidden -->\n\n$$\n\\frac{1}{2}\n$$",
  );
  expect(documentSchema.parse(tree)).toEqual(tree);
  expect(textContent(tree)).toContain("🚀");
  expect(textContent(tree)).not.toContain("hidden");
  const tags: string[] = [];
  visit(tree, "element", (n) => {
    tags.push(n.tagName);
  });
  expect(tags).toEqual(
    expect.arrayContaining([
      "details",
      "summary",
      "sub",
      "sup",
      "br",
      "code",
      "pre",
    ]),
  );
});
test("raw code is literal and hostile HTML never becomes executable structure", () => {
  const tree = parseDocument(
    '`&amp; <sub> :rocket:`\n\n<script>alert(1)</script>\n\n[bad](javascript:alert%281%29)\n\n<details onclick="steal()">\n<summary>safe</summary>\n<script>steal()</script>\n</details>',
  );
  const code = elements("`&amp; <sub> :rocket:`", "code")[0];
  expect(textContent(code)).toBe("&amp; <sub> :rocket:");
  visit(tree, "element", (n) => {
    expect(n.tagName).not.toBe("script");
    expect(Object.keys(n.properties).some((k) => /^on/i.test(k))).toBe(false);
    expect(String(n.properties.href)).not.toMatch(/^javascript:/);
  });
});
test("tables, reference links, nested tasks, hard breaks and escaped pipes retain structure", () => {
  const source =
    "| 左 | 右 |\n|:---|---:|\n| a\\|b | [**参照**][ref] |\n\n[ref]: https://example.com\n\n9. item\n   - [x] done\n   - [ ] next\n\nfirst  \nsecond\\\nthird";
  expect(elements(source, "th").map((n) => n.properties.align)).toEqual([
    "left",
    "right",
  ]);
  expect(elements(source, "td").map(textContent)).toEqual(["a|b", "参照"]);
  expect(elements(source, "input").map((n) => !!n.properties.checked)).toEqual([
    true,
    false,
  ]);
  expect(elements(source, "ol")[0].properties.start).toBe(9);
  expect(elements(source, "br")).toHaveLength(2);
});
