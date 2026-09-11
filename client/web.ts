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
    function boundary(node: DomNode, offset: number, end: boolean) {
      for (const leaf of leaves.values()) {
        const element = leaf.node as DomNode;
        if (!element.contains(node)) continue;
        const prefix = document.createRange();
        prefix.setStart(element, 0);
        prefix.setEnd(node, offset);
        const index = prefix.toString().length;
        return end ? leaf.map[index * 2 - 1] : leaf.map[index * 2];
      }
      return undefined;
    }
    const start = boundary(range.startContainer, range.startOffset, false),
      end = boundary(range.endContainer, range.endOffset, true);
    if (start === undefined || end === undefined || end <= start) return;
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
  document.addEventListener("mouseup", capture);
  document.addEventListener("keyup", capture);
  return () => {
    document.removeEventListener("mouseup", capture);
    document.removeEventListener("keyup", capture);
  };
}
