import type { Element, Root, RootContent } from "hast";

export function sourceRange(node: Element) {
  const start = node.properties.dataCanvasStart;
  const end = node.properties.dataCanvasEnd;
  return typeof start === "number" && typeof end === "number" && end > start
    ? { start, end }
    : null;
}

// Select outer semantic units once: a table/list/quote is one target, never
// also its nested cells, items or paragraphs. Preview and Code share this set.
export function reviewTargets(document: Root): Element[] {
  const targets: Element[] = [];
  function visit(nodes: RootContent[]) {
    for (const node of nodes) {
      if (node.type !== "element") continue;
      if (
        /^(p|h[1-6]|pre|table|ul|ol|blockquote|aside|details)$/.test(
          node.tagName,
        ) &&
        sourceRange(node)
      )
        targets.push(node);
      else visit(node.children);
    }
  }
  visit(document.children);
  return targets.sort((a, b) => sourceRange(a)!.start - sourceRange(b)!.start);
}

export function targetLabel(node: Element) {
  if (node.tagName === "pre") {
    const code = node.children.find((child) => child.type === "element");
    const classes = code?.properties.className;
    if (Array.isArray(classes) && classes.includes("language-mermaid"))
      return "diagram";
    return "code block";
  }
  if (node.tagName === "p") {
    if (
      node.children.some(
        (child) => child.type === "element" && child.tagName === "img",
      )
    )
      return "image";
    return "paragraph";
  }
  if (/^h[1-6]$/.test(node.tagName)) return "heading";
  if (["ul", "ol"].includes(node.tagName)) return "list";
  if (node.tagName === "blockquote") return "quote";
  if (node.tagName === "aside") return "callout";
  return node.tagName;
}

export function targetQuote(node: Element) {
  function quote(child: RootContent): string {
    if (child.type === "text") return child.value;
    if (child.type !== "element") return "";
    if (child.tagName === "img") return String(child.properties.alt || "Image");
    return child.children.map(quote).join("");
  }
  return quote(node).trim() || targetLabel(node);
}
