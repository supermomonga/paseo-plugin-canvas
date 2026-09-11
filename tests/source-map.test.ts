import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import type { Root, RootContent } from "hast";
import { parseDocument } from "../server/document";
import { documentSchema, textContent } from "../shared/document";
function mapped(tree: Root) {
  const result: { text: string; map: number[] }[] = [];
  function walk(n: RootContent | Root) {
    if (n.type === "text" && n.data?.canvasMap)
      result.push({ text: n.value, map: n.data.canvasMap });
    if (n.type === "element" && Array.isArray(n.properties.dataCanvasMap))
      result.push({
        text: textContent(n),
        map: n.properties.dataCanvasMap.map(Number),
      });
    if ("children" in n) n.children.forEach(walk);
  }
  walk(tree);
  return result;
}
test("source maps survive sanitize and the RPC schema for entities, emoji, escapes and decorated text", () => {
  const source =
    "**日本語** [link](https://example.com) &amp; \\* :rocket: `&amp;`\nsecond";
  const spans = mapped(documentSchema.parse(parseDocument(source)));
  for (const span of spans) expect(span.map.length).toBe(span.text.length * 2);
  const mappedSource = (text: string) => {
    const span = spans.find((s) => s.text.includes(text))!;
    expect(span).toBeDefined();
    const start = span.text.indexOf(text);
    return source.slice(
      span.map[start * 2],
      span.map[(start + text.length) * 2 - 1],
    );
  };
  expect(mappedSource("日本語")).toBe("日本語");
  expect(mappedSource("🚀")).toBe(":rocket:");
  expect(mappedSource(" * ")).toBe(" \\* ");
  expect(mappedSource(" & ")).toBe(" &amp; ");
});
test("GFM fixture maps alerts, nested lists, tables, code and footnotes without generated controls", async () => {
  const source = await readFile("tests/fixtures/gfm.md", "utf8"),
    spans = mapped(documentSchema.parse(parseDocument(source)));
  for (const span of spans) {
    expect(span.map.length, span.text).toBe(span.text.length * 2);
    expect(span.map.every((n) => n >= 0 && n <= source.length)).toBe(true);
  }
  const alert = spans.find((s) => s.text.startsWith("読むとき"))!;
  expect(source.slice(alert.map[0], alert.map[alert.map.length - 1])).toBe(
    alert.text,
  );
  expect(spans.some((s) => s.text.includes("const content ="))).toBe(true);
  expect(spans.some((s) => s.text === "↩")).toBe(false);
});
test.each([
  "```js\nconst x = '&amp;';\n```",
  "> ```js\n> const x=1;\n> ```",
  "    indented code\n    second line\n",
  "a ` one\ntwo ` z",
  "a &lt; b and \\* c",
  '<span title="a &amp; b">x</span>',
  "| a | b |\n|---|---|\n| `a\\|b` | x |",
  "  ```\n\ttext\tmore\n  ```",
  "a\0b",
  "<https://example.com?find=\\*>",
  "foo \n baz",
])("mapped syntax: %s", (source) => {
  for (const span of mapped(parseDocument(source)))
    expect(span.map.length, span.text).toBe(span.text.length * 2);
});
