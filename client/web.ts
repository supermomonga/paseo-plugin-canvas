import { Platform } from "react-native";
// Only these DOM operations are needed. Native never accesses these globals.
interface DomNode {
  contains(node: DomNode): boolean;
  parentNode: DomNode | null;
  nodeType: number;
  nodeValue: string | null;
  childNodes: ArrayLike<DomNode>;
  tagName?: string;
  getAttribute?(name: string): string | null;
  setAttribute?(name: string, value: string): void;
}
interface DomRange {
  commonAncestorContainer: DomNode;
  startContainer: DomNode;
  endContainer: DomNode;
  startOffset: number;
  endOffset: number;
  toString(): string;
  cloneContents(): DomNode;
  selectNodeContents(node: DomNode): void;
  comparePoint(node: DomNode, offset: number): number;
  compareBoundaryPoints(how: number, range: DomRange): number;
  setStart(node: DomNode, offset: number): void;
  setEnd(node: DomNode, offset: number): void;
}
declare const document: {
  addEventListener(name: string, fn: () => void): void;
  removeEventListener(name: string, fn: () => void): void;
  createRange(): DomRange;
};
declare const window: {
  getSelection(): {
    isCollapsed: boolean;
    rangeCount: number;
    getRangeAt(index: number): DomRange;
    toString(): string;
  } | null;
};
export type SelectionLeaf = { node: unknown; map: number[] };
export function registerSelectionLeaf(
  leaves: Map<string, SelectionLeaf>,
  id: string,
  node: unknown,
  map: number[],
) {
  if (!node) {
    leaves.delete(id);
    return;
  }
  if (Platform.OS === "web")
    (node as DomNode).setAttribute?.("data-canvas-review-text", "true");
  leaves.set(id, { node, map });
}
function selectedQuote(node: DomNode, mapped = false): string {
  mapped ||= node.getAttribute?.("data-canvas-review-text") === "true";
  if (node.nodeType === 3) return mapped ? (node.nodeValue ?? "") : "";
  const children = Array.from(node.childNodes, (child) =>
    selectedQuote(child, mapped),
  );
  const text = children.join("");
  // Native-web Views become divs. Keep paragraph/line boundaries while excluding
  // generated controls, footnote buttons and diagram toolbars from the quote.
  return text && /^(DIV|P|LI|TR|PRE|H[1-6])$/.test(node.tagName ?? "")
    ? text + "\n"
    : text;
}
export function observeTextSelection(
  root: () => unknown,
  leaves: Map<string, SelectionLeaf>,
  callback: (range: {
    start: number;
    end: number;
    selectedText: string;
  }) => void,
) {
  if (Platform.OS !== "web") return () => {};
  const capture = () => {
    const selection = window.getSelection(),
      container = root() as DomNode | null;
    if (
      !selection ||
      selection.isCollapsed ||
      !selection.rangeCount ||
      !container
    )
      return;
    const range = selection.getRangeAt(0);
    if (
      !container.contains(range.startContainer) ||
      !container.contains(range.endContainer)
    )
      return;
    let first: { range: DomRange; offset: number } | undefined;
    let last: { range: DomRange; offset: number } | undefined;
    for (const leaf of leaves.values()) {
      const element = leaf.node as DomNode;
      if (!container.contains(element) || !leaf.map.length) continue;
      // Whole-line selections can end at the next block's child offset zero,
      // rather than inside the last selected text node. Intersect the selection
      // with each mapped leaf instead of requiring both endpoints inside leaves.
      const startSide = range.comparePoint(element, 0);
      const endSide = range.comparePoint(element, element.childNodes.length);
      if (startSide > 0 || endSide < 0) continue;
      const part = document.createRange();
      part.selectNodeContents(element);
      if (startSide < 0) part.setStart(range.startContainer, range.startOffset);
      if (endSide > 0) part.setEnd(range.endContainer, range.endOffset);
      const length = part.toString().length;
      if (!length) continue; // Touching a boundary does not select its text.
      const prefix = document.createRange();
      prefix.setStart(element, 0);
      prefix.setEnd(part.startContainer, part.startOffset);
      const index = prefix.toString().length;
      const start = leaf.map[index * 2];
      const end = leaf.map[(index + length) * 2 - 1];
      if (start === undefined || end === undefined) continue;
      // Refs need not be registered in document order after a highlight update.
      if (!first || part.compareBoundaryPoints(0, first.range) < 0)
        first = { range: part, offset: start };
      if (!last || part.compareBoundaryPoints(2, last.range) > 0)
        last = { range: part, offset: end };
    }
    if (!first || !last || last.offset <= first.offset) return;
    const start = first.offset,
      end = last.offset;
    const quote = selectedQuote(
      range.cloneContents(),
      [...leaves.values()].some((leaf) =>
        (leaf.node as DomNode).contains(range.commonAncestorContainer),
      ),
    )
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\n+$/, "");
    if (quote) callback({ start, end, selectedText: quote });
  };
  document.addEventListener("selectionchange", capture);
  document.addEventListener("mouseup", capture);
  document.addEventListener("keyup", capture);
  return () => {
    document.removeEventListener("selectionchange", capture);
    document.removeEventListener("mouseup", capture);
    document.removeEventListener("keyup", capture);
  };
}
