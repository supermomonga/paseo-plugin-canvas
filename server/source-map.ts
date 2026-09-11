import type { Root, Text, InlineCode } from "mdast";
import type { VFile } from "vfile";
import { visit } from "unist-util-visit";
import { decodeString } from "micromark-util-decode-string";
import { get as emoji } from "node-emoji";

type Unit = { value: string; start: number; end: number };
function decode(raw: string, offset: number): Unit[] {
  const result: Unit[] = [];
  const tokens =
    /\\[!-/:-@\[-`{-~]|&(?:#(?:\d{1,7}|[xX][\da-fA-F]{1,6})|[\da-zA-Z]{1,31});|\r\n|[\s\S]/gu;
  for (const token of raw.matchAll(tokens))
    result.push({
      value: decodeString(token[0])
        .replace(/\r\n|\r/g, "\n")
        .replace(/\0/g, "�"),
      start: offset + token.index!,
      end: offset + token.index! + token[0].length,
    });
  return result;
}
function flatten(units: Unit[]) {
  return units.flatMap((u) =>
    Array.from({ length: u.value.length }, (_, i) => ({
      value: u.value[i],
      start: u.start,
      end: u.end,
    })),
  );
}
export function textUnits(
  raw: string,
  value: string,
  offset: number,
): Unit[] | null {
  const decoded = flatten(decode(raw, offset));
  // Remark positions bound this exact text node. Continuation lines may contain
  // container prefixes (> / list indentation) outside its rendered text.
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const output: Unit[] = [];
  let at = 0;
  for (let i = 0; i < lines.length; i++) {
    const end = decoded.findIndex((u, j) => j >= at && u.value === "\n"),
      stop = end < 0 ? decoded.length : end;
    let segment = decoded.slice(at, stop);
    if (i < lines.length - 1) {
      while (segment.length && /[ \t]/.test(segment.at(-1)!.value))
        segment.pop();
    }
    const text = segment.map((u) => u.value).join("");
    if (!text.endsWith(lines[i])) return null;
    const extra = text.slice(0, text.length - lines[i].length);
    if (i === 0 ? extra.length !== 0 : !/^[\s>]*$/.test(extra)) return null;
    output.push(...segment.slice(extra.length));
    if (i < lines.length - 1) {
      if (end < 0) return null;
      output.push(decoded[end]);
      at = end + 1;
    }
  }
  return output;
}
function codeUnits(
  raw: string,
  value: string,
  offset: number,
  inTable: boolean,
): Unit[] | null {
  const fence = raw.match(/^`+/)?.[0];
  if (!fence) return null;
  let units: Unit[] = [];
  // Build UTF-16 positions without assuming one unit per Unicode code point.
  for (let at = fence.length; at < raw.length - fence.length; ) {
    const token = raw
      .slice(at)
      .match(inTable ? /^\\\||^\r\n|^[\s\S]/u : /^\r\n|^[\s\S]/u)![0];
    units.push(
      ...flatten([
        {
          value: /^[\r\n]/.test(token)
            ? " "
            : token === "\\|" && inTable
              ? "|"
              : token.replace(/\0/g, "�"),
          start: offset + at,
          end: offset + at + token.length,
        },
      ]),
    );
    at += token.length;
  }
  if (
    units[0]?.value === " " &&
    units.at(-1)?.value === " " &&
    units.some((u) => u.value !== " ")
  )
    units = units.slice(1, -1);
  return units.map((u) => u.value).join("") === value.replace(/\r?\n/g, " ")
    ? units
    : null;
}
export function sourceText() {
  return (tree: Root, file: VFile) => {
    const source = String(file.value);
    const tables: { start: number; end: number }[] = [];
    visit(tree, "tableCell", (node) => {
      if (
        node.position?.start.offset !== undefined &&
        node.position.end.offset !== undefined
      )
        tables.push({
          start: node.position.start.offset,
          end: node.position.end.offset,
        });
    });
    visit(tree, (node, _index, parent) => {
      if (node.type !== "text" && node.type !== "inlineCode") return;
      const leaf = node as Text | InlineCode,
        start = leaf.position?.start.offset,
        end = leaf.position?.end.offset;
      if (start === undefined || end === undefined) return;
      let units =
        leaf.type === "text"
          ? leaf.data?.hProperties?.dataCanvasLiteral ||
            (parent?.type === "link" &&
              source[parent.position?.start.offset ?? -1] === "<")
            ? Array.from({ length: leaf.value.length }, (_, i) => ({
                value: leaf.value[i],
                start: start + i,
                end: start + i + 1,
              }))
            : textUnits(source.slice(start, end), leaf.value, start)
          : codeUnits(
              source.slice(start, end),
              leaf.value,
              start,
              tables.some((range) => range.start <= start && range.end >= end),
            );
      if (!units) throw new Error(`Unable to map Markdown text at ${start}`);
      if (leaf.type === "text") {
        const input = units.map((u) => u.value).join("");
        const result: Unit[] = [];
        let at = 0;
        for (const match of input.matchAll(/:\+1:|:-1:|:[\w-]+:/g)) {
          const icon = emoji(match[0]);
          if (!icon) continue;
          result.push(...units.slice(at, match.index));
          result.push(
            ...flatten([
              {
                value: icon,
                start: units[match.index!].start,
                end: units[match.index! + match[0].length - 1].end,
              },
            ]),
          );
          at = match.index! + match[0].length;
        }
        result.push(...units.slice(at));
        units = result;
      }
      const value = units
        .map((u) => (u.value === "\n" ? " " : u.value))
        .join("");
      leaf.data = {
        ...leaf.data,
        hName: leaf.type === "text" ? "span" : "code",
        hProperties: {
          ...leaf.data?.hProperties,
          dataCanvasMap: units.flatMap((u) => [u.start, u.end]),
        },
        hChildren: [{ type: "text", value }],
      };
    });
  };
}

export function blockCodeMap(
  source: string,
  start: number,
  end: number,
  value: string,
): number[] {
  let raw = source.slice(start, end),
    at = start;
  if (/^(`{3,}|~{3,})/.test(raw)) {
    const first = raw.indexOf("\n");
    if (first < 0) return [];
    at += first + 1;
    raw = raw.slice(first + 1);
  }
  const map: number[] = [];
  const contentLines = value.split("\n");
  if (contentLines.at(-1) === "") contentLines.pop();
  let offset = 0;
  for (const line of contentLines) {
    let newline = raw.indexOf("\n", offset);
    if (newline < 0) newline = raw.length;
    const rawLine = raw.slice(offset, newline).replace(/\r$/, "");
    const expanded: Unit[] = [];
    for (let i = 0, column = 0; i < rawLine.length; i++) {
      const indentation = /^[\s>]*$/.test(rawLine.slice(0, i));
      const expandTab = rawLine[i] === "\t" && indentation;
      const width = expandTab ? 4 - (column % 4) : 1;
      expanded.push(
        ...Array.from({ length: width }, () => ({
          value: expandTab ? " " : rawLine[i].replace(/\0/g, "�"),
          start: at + offset + i,
          end: at + offset + i + 1,
        })),
      );
      column += width;
    }
    // Tabs remaining inside the code are literal. Expand only when parsing
    // removed indentation from part of a tab, as required by CommonMark.
    const exact = rawLine.endsWith(line);
    const units = exact
      ? Array.from({ length: rawLine.length }, (_, i) => ({
          value: rawLine[i],
          start: at + offset + i,
          end: at + offset + i + 1,
        }))
      : expanded;
    const text = units.map((unit) => unit.value).join("");
    if (!text.endsWith(line))
      throw new Error(`Unable to map code at ${at + offset}`);
    const prefix = text.slice(0, text.length - line.length);
    if (!/^[\s>]*$/.test(prefix))
      throw new Error(`Unexpected code prefix at ${at + offset}`);
    for (const unit of units.slice(prefix.length))
      map.push(unit.start, unit.end);
    if (map.length < value.length * 2)
      map.push(
        at + offset + rawLine.length,
        at + Math.min(raw.length, newline + 1),
      );
    offset = newline + 1;
  }
  return map;
}
