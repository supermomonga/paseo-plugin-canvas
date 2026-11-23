import type { Localized } from "./types";

/** English text of rendered document content (Markdown, images, graphics); nested under `content`. */
export const contentEn = {
  math: {
    failed: "Failed to render math (retry)",
    failedLabel: "Failed to render math. Retry: {{source}}",
    rendering: "Rendering math…",
    label: "Math: {{source}}",
    source: "Math source",
  },
  svg: {
    label: "SVG image",
    source: "SVG source",
  },
  graphic: {
    failed: "Failed to render: {{message}}",
    rendering: "Rendering…",
    showSource: "Show source",
  },
  image: {
    failed: "Unable to display image: {{name}} (retry)",
    loading: "Loading image…",
    label: "Image",
  },
  alerts: {
    note: "Note",
    tip: "Tip",
    important: "Important",
    warning: "Warning",
    caution: "Caution",
    label: "{{type}} alert",
  },
  links: {
    notLocated: "Unable to locate the link target",
    invalid: "Invalid link format",
    notFound: "The linked heading or footnote was not found",
    openFailed: "Unable to open the link",
  },
  task: {
    complete: "Complete",
    incomplete: "Incomplete",
  },
  details: {
    label: "Details",
    name: "details",
    expand: "Expand {{name}}",
    collapse: "Collapse {{name}}",
  },
} as const;

/** Japanese text of rendered document content. */
export const contentJa = {
  math: {
    failed: "数式を描画できませんでした（再試行）",
    failedLabel: "数式を描画できませんでした。再試行: {{source}}",
    rendering: "数式を描画中…",
    label: "数式: {{source}}",
    source: "数式のソース",
  },
  svg: {
    label: "SVG 画像",
    source: "SVG のソース",
  },
  graphic: {
    failed: "描画できませんでした: {{message}}",
    rendering: "描画中…",
    showSource: "ソースを表示",
  },
  image: {
    failed: "画像を表示できません: {{name}}（再試行）",
    loading: "画像を読み込み中…",
    label: "画像",
  },
  alerts: {
    note: "メモ",
    tip: "ヒント",
    important: "重要",
    warning: "警告",
    caution: "注意",
    label: "{{type}}",
  },
  links: {
    notLocated: "リンク先の位置を特定できませんでした",
    invalid: "リンクの形式が正しくありません",
    notFound: "リンク先の見出しまたは脚注が見つかりません",
    openFailed: "リンクを開けませんでした",
  },
  task: {
    complete: "完了",
    incomplete: "未完了",
  },
  details: {
    label: "詳細",
    name: "詳細",
    expand: "{{name}} を展開",
    collapse: "{{name}} を折りたたむ",
  },
} as const satisfies Localized<typeof contentEn>;
