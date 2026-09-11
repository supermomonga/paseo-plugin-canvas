import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { JSDOM } from "jsdom";
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
import {
  observeTextSelection,
  registerSelectionLeaf,
  type SelectionLeaf,
} from "../client/web";

const sentence =
  "朝の散歩は、一日の中でいちばん静かな時間だ。まだ街が眠っているうちに外へ出ると、空気は冷たく澄んでいて、遠くの音がやけに鮮明に聞こえる。";
let dom: JSDOM, document: Document, root: HTMLDivElement;
let leaves: Map<string, SelectionLeaf>, stop: () => void;
const changed =
  vi.fn<
    (selection: { start: number; end: number; selectedText: string }) => void
  >();
beforeEach(() => {
  dom = new JSDOM("<!doctype html><div id='canvas'></div>");
  document = dom.window.document;
  root = document.querySelector<HTMLDivElement>("#canvas")!;
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", document);
  leaves = new Map();
  changed.mockClear();
  stop = observeTextSelection(() => root, leaves, changed);
});
afterEach(() => {
  stop();
  dom.window.close();
  vi.unstubAllGlobals();
});
function leaf(parent: Element, text: string, offset: number, id: string) {
  const span = document.createElement("span");
  span.textContent = text;
  parent.append(span);
  registerSelectionLeaf(
    leaves,
    id,
    span,
    Array.from({ length: text.length }, (_, i) => [
      offset + i,
      offset + i + 1,
    ]).flat(),
  );
  return span.firstChild!;
}
function paragraph(text: string, offset: number, id: string) {
  const block = document.createElement("div");
  root.append(block);
  return { block, text: leaf(block, text, offset, id) };
}
function select(
  start: Node,
  startOffset: number,
  end: Node,
  endOffset: number,
  event = "mouseup",
) {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  const selection = dom.window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new dom.window.Event(event));
}

test.each(["block", "text"] as const)(
  "triple-click selection replaces the prior word when it ends at the next %s offset zero",
  (endpoint) => {
    const first = paragraph(sentence, 0, "first"),
      next = paragraph("次の段落。", sentence.length + 2, "next");
    const wordStart = sentence.indexOf("いちばん");
    select(first.text, wordStart, first.text, wordStart + 4);
    expect(changed).toHaveBeenLastCalledWith({
      start: wordStart,
      end: wordStart + 4,
      selectedText: "いちばん",
    });
    select(first.text, 0, endpoint === "block" ? next.block : next.text, 0);
    expect(changed).toHaveBeenLastCalledWith({
      start: 0,
      end: sentence.length,
      selectedText: sentence,
    });
  },
);

test("element child offsets select the whole paragraph, including the final document block", () => {
  const first = paragraph(sentence, 0, "first");
  select(first.block, 0, root, root.childNodes.length);
  expect(changed).toHaveBeenLastCalledWith({
    start: 0,
    end: sentence.length,
    selectedText: sentence,
  });
});

test("DOM order determines decorated text boundaries, excluding generated controls and adjacent unselected text", () => {
  const block = document.createElement("div");
  root.append(block);
  const before = leaf(block, "朝の", 0, "before");
  const button = document.createElement("button");
  button.textContent = "Add comment";
  block.append(button);
  leaf(block, "散歩", 5, "strong"); // source is 朝の **散歩**…
  const after = leaf(block, " 🚀", 9, "after");
  const next = paragraph("次の段落。", 20, "next");
  leaves = new Map([...leaves].reverse());
  stop();
  stop = observeTextSelection(() => root, leaves, changed);
  select(before, 0, next.block, 0);
  expect(changed).toHaveBeenLastCalledWith({
    start: 0,
    end: 12,
    selectedText: "朝の散歩 🚀",
  });
  select(after, 1, after, 3);
  expect(changed).toHaveBeenLastCalledWith({
    start: 10,
    end: 12,
    selectedText: "🚀",
  });
});

test("selectionchange observes OS selection updates and cleanup removes all listeners", () => {
  const first = paragraph(sentence, 0, "first"),
    next = paragraph("次。", sentence.length + 2, "next");
  select(first.text, 0, next.block, 0, "selectionchange");
  expect(changed).toHaveBeenLastCalledWith({
    start: 0,
    end: sentence.length,
    selectedText: sentence,
  });
  stop();
  changed.mockClear();
  for (const event of ["selectionchange", "mouseup", "keyup"])
    select(first.text, 0, first.text, 2, event);
  expect(changed).not.toHaveBeenCalled();
});

test("selection outside the canvas and collapsed focus do not replace a pending comment quote", () => {
  paragraph(sentence, 0, "first");
  const input = document.createElement("div");
  input.textContent = "Review text";
  document.body.append(input);
  select(input.firstChild!, 0, input.firstChild!, 6);
  select(root, 0, root, 0);
  expect(changed).not.toHaveBeenCalled();
});
