import type { Localized } from "./types";

/** English text of the editing interface; nested under `editing`. */
export const editingEn = {
  heading: {
    edit: "Edit canvas",
    new: "New canvas",
  },
  working: "Working…",
  save: "Save",
  cancel: "Cancel",
  preview: "Preview",
  markdown: "Markdown",
  lockUnavailable: "Edit lock unavailable",
  editingRevision: "Editing revision {{revision}}",
  reacquire: "Reacquire lock",
  checkLatest: "Check latest canvases",
  titleLabel: "Title",
  titleInput: "Canvas title",
  titleTooLong: "Title must be at most 240 characters.",
  contentLabel: "Markdown content",
  contentInput: "Canvas Markdown content",
  contentTooLong: "Content must be at most 1,000,000 characters.",
  loadingPreview: "Loading preview…",
  previewFailed: "Unable to preview this draft",
  confirm: {
    deleteTitle: "Delete canvas?",
    discardTitle: "Discard changes?",
    deleteBody:
      "Permanently delete “{{title}}” and all its reviews? This cannot be undone.",
    discardBody:
      "Your unsaved changes will be discarded and the edit lock will be released.",
    cancel: "Cancel",
    keepEditing: "Keep editing",
    deletePermanently: "Delete permanently",
    discard: "Discard changes",
  },
  errors: {
    refreshFailed:
      "Unable to refresh canvases. Your last operation will not be repeated automatically.",
    changedWhileUnavailable:
      "This canvas changed while your lock was unavailable. Copy your draft, then cancel to read the latest version. Your draft has not been saved.",
    paused: "Editing paused: {{reason}}. Your draft is retained.",
    saveUncertain:
      "Save could not be confirmed. Check the latest canvases before creating or saving again. Copy your draft before cancelling.",
  },
  /**
   * Daemon errors by code. English shows the daemon's own, more specific
   * message; these apply only where a language translates them.
   */
  server: {
    LOCKED: "Canvas is already being edited",
    CONFLICT:
      "The canvas or your edit lock changed. Read the latest canvas before trying again.",
    NOT_FOUND: "Canvas does not exist",
    INVALID_INPUT: "Enter canvas content",
    STORE_UNAVAILABLE:
      "Canvas storage is unavailable. Check the plugin logs on the host.",
    CORRUPT_DOCUMENT: "The canvas file cannot be read",
    INVALID_STORAGE: "Workspace storage must be a real directory",
    UNKNOWN:
      "The operation could not be confirmed. Check the latest canvas before trying again.",
  },
} as const;

/** Japanese text of the editing interface. */
export const editingJa = {
  heading: {
    edit: "Canvas を編集",
    new: "新しい Canvas",
  },
  working: "処理中…",
  save: "保存",
  cancel: "キャンセル",
  preview: "プレビュー",
  markdown: "Markdown",
  lockUnavailable: "編集ロックを利用できません",
  editingRevision: "リビジョン {{revision}} を編集中",
  reacquire: "ロックを再取得",
  checkLatest: "最新の Canvas を確認",
  titleLabel: "タイトル",
  titleInput: "Canvas のタイトル",
  titleTooLong: "タイトルは 240 文字以内で入力してください。",
  contentLabel: "Markdown の本文",
  contentInput: "Canvas の Markdown の本文",
  contentTooLong: "本文は 1,000,000 文字以内にしてください。",
  loadingPreview: "プレビューを読み込み中…",
  previewFailed: "この下書きをプレビューできませんでした",
  confirm: {
    deleteTitle: "Canvas を削除しますか？",
    discardTitle: "変更を破棄しますか？",
    deleteBody:
      "「{{title}}」とそのすべてのレビューを完全に削除しますか？この操作は元に戻せません。",
    discardBody: "保存していない変更を破棄し、編集ロックを解除します。",
    cancel: "キャンセル",
    keepEditing: "編集を続ける",
    deletePermanently: "完全に削除",
    discard: "変更を破棄",
  },
  errors: {
    refreshFailed:
      "Canvas を更新できませんでした。直前の操作は自動ではやり直しません。",
    changedWhileUnavailable:
      "ロックを利用できない間にこの Canvas が変更されました。下書きをコピーしてから、キャンセルして最新の版を読み込んでください。下書きは保存されていません。",
    paused: "編集を一時停止しました: {{reason}}。下書きは保持しています。",
    saveUncertain:
      "保存できたかどうかを確認できませんでした。もう一度作成・保存する前に最新の Canvas を確認してください。キャンセルする前に下書きをコピーしてください。",
  },
  server: {
    LOCKED: "この Canvas はすでに編集中です",
    CONFLICT:
      "Canvas または編集ロックの状態が変わりました。最新の Canvas を読み込んでからやり直してください。",
    NOT_FOUND: "Canvas が見つかりません",
    INVALID_INPUT: "Canvas の本文を入力してください",
    STORE_UNAVAILABLE:
      "Canvas の保存先を利用できません。ホストでプラグインのログを確認してください。",
    CORRUPT_DOCUMENT: "Canvas のファイルを読み取れません",
    INVALID_STORAGE: "ワークスペースの保存先が通常のディレクトリではありません",
    UNKNOWN:
      "操作の結果を確認できませんでした。最新の Canvas を確認してからやり直してください。",
  },
} as const satisfies Localized<typeof editingEn>;
