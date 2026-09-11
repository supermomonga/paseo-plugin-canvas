import { parseFlowchart } from "./flowchart";
import { parseSequence } from "./sequence";
import { layoutFlowchart, layoutSequence } from "./layout";

export function diagramModel(source: string) {
  if (source.length > 50_000)
    throw new Error("Mermaidは50,000文字以内にしてください。");
  // Do not discard front matter, init directives, or text preceding a header.
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^%%(?!\{)/.test(line));
  const first = lines[0] ?? "";
  if (lines.some((line) => /^%%\{/.test(line)))
    throw new Error("Mermaidの設定ディレクティブには対応していません。");
  if (/^(flowchart|graph)(\s|$)/i.test(first)) {
    const chart = parseFlowchart(source);
    if (!chart || !chart.nodes.length)
      throw new Error(
        "フローチャートの記法を確認してください。宣言と図の内容は改行で区切ります。",
      );
    if (chart.skipped.length) throw unsupported(chart.skipped);
    if (
      chart.nodes.some(
        (node) =>
          node.shape === "asymmetric" ||
          node.shape === "hexagon" ||
          node.shape === "unsupported",
      )
    )
      throw new Error(
        "このノード形状には対応していません。矩形・角丸・スタジアム形・サブルーチン・円・ひし形を使用してください。",
      );
    if (chart.nodes.length > 200 || chart.edges.length > 300)
      throw new Error("図の上限は200ノード・300本の線です。");
    const layout = layoutFlowchart(chart);
    checkSize(layout);
    return {
      kind: "flow" as const,
      layout,
      width: layout.width,
      height: layout.height,
    };
  }
  if (/^sequenceDiagram$/i.test(first)) {
    const diagram = parseSequence(source)!;
    if (diagram.skipped.length) throw unsupported(diagram.skipped);
    if (!diagram.participants.length)
      throw new Error("シーケンス図に参加者またはメッセージが必要です。");
    if (diagram.participants.length > 30 || diagram.events.length > 100)
      throw new Error("シーケンス図の上限は30参加者・100イベントです。");
    const layout = layoutSequence(
      diagram.participants,
      diagram.events.length,
      diagram.events,
    );
    checkSize(layout);
    return {
      kind: "sequence" as const,
      diagram,
      width: layout.width,
      height: layout.height,
    };
  }
  throw new Error(
    "対応する図はflowchart／graphとsequenceDiagramです。他の図種には対応していません。",
  );
}
function unsupported(lines: string[]) {
  const sample = lines
    .slice(0, 3)
    .map((line) => line.slice(0, 100))
    .join("\n");
  return new Error(
    `未対応または解析できない記法が${lines.length}行あります。図の一部だけを表示することはできません。\n${sample}`,
  );
}
function checkSize(size: { width: number; height: number }) {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width > 8000 ||
    size.height > 8000
  )
    throw new Error("図が大きすぎます。複数の図に分割してください。");
}
export type DiagramModel = ReturnType<typeof diagramModel>;
