import type { en } from "./en";
import type { Localized } from "./types";
import { contentJa } from "./content";
import { editingJa } from "./editing";
import { reviewJa } from "./review";


/** Japanese interface text. Missing keys fall back to English. */
export const ja = {
  common: {
    close: "閉じる",
    loading: "読み込み中…",
    retry: "再試行",
  },
  plugin: {
    title: "Canvas",
    openCanvas: "Canvas を開く",
    openSettings: "Canvas の設定",
    slashDescription: "Canvas パネルを開く（Canvas を指定することもできます）",
    slashHint: "[タイトル]",
    noMatch: "このワークスペースに「{{query}}」に一致する Canvas はありません",
    attachmentTitle: "Canvas",
    attachmentPicker: "Canvas を添付",
    attachmentSearch: "タイトルまたはワークスペースで Canvas を検索",
  },
  settings: {
    timeline: {
      title: "タイムライン",
      notifications: "Canvas の通知",
      notificationsHint:
        "エージェントが Canvas を作成・更新したとき、そのエージェントのタイムラインに「Canvas を開く」ボタン付きの行を追加します。",
    },
    links: {
      title: "リンク",
      openIn: "Web リンクを開く場所",
      openInHint:
        "ワークスペースのブラウザーはデスクトップアプリで使えます。ほかのクライアントでは常にシステムのブラウザーで開きます。",
      workspaceBrowser: "ワークスペースのブラウザー",
      systemBrowser: "システムのブラウザー",
    },
    hostScope: "このホストのすべてのクライアントに適用されます。",
    deviceScope: "この端末にだけ適用されます。",
    unavailable: "設定を利用できません",
    reset: "既定値に戻す",
    documentation: "Canvas のドキュメント",
  },
  activity: {
    created: "Canvas を作成 · リビジョン {{revision}}",
    updated: "Canvas を更新 · リビジョン {{revision}}",
    warnings: "Mermaid の描画に関する警告: {{count}} 件",
    open: "Canvas を開く",
    openLabel: "Canvas を開く: {{title}}",
    openFailed: "Canvas を開けませんでした",
  },
  panel: {
    user: "ユーザー",
    beingEdited: "{{name}} が編集中",
    unlocked: "ロックなし",
    editing: "編集中",
    back: "Canvas 一覧に戻る",
    hideList: "Canvas 一覧を隠す",
    showList: "Canvas 一覧を表示",
    moveListRight: "Canvas 一覧を右に移動",
    moveListLeft: "Canvas 一覧を左に移動",
    updatesInterrupted: "自動更新が中断しました。再接続しています…",
    canvases: "Canvas",
    count_other: "{{count}} 件",
    newCanvas: "新しい Canvas",
    empty: "Canvas はまだありません",
    emptyHint: "Canvas を作成するか、エージェントに作成を依頼してください",
    select: "Canvas を選択してください",
    openRow: "{{title}} を開く",
    fullScreen: "全画面で開く",
    details: "詳細",
    edit: "編集",
    delete: "削除",
    copy: "コピー",
    copyContent: "本文をコピー",
    copied: "本文をコピーしました",
    copyFailed: "本文をコピーできませんでした",
    preview: "プレビュー",
    code: "コード",
    deleted: "この Canvas は削除されました",
    loadListFailed: "Canvas 一覧を読み込めませんでした",
    loadContentFailed: "本文を読み込めませんでした",
    retrying: "自動で再試行しています。",
    retryingStale: "最後に読み込んだ内容を表示しています。自動で再試行しています。",
  },
  details: {
    heading: "Canvas の詳細",
    title: "タイトル",
    canvasId: "Canvas ID",
    revision: "リビジョン",
    updatedBy: "最終保存者",
    editor: "編集者",
    acquired: "ロック取得日時",
    renewed: "最終更新日時",
    expires: "有効期限",
  },
  content: contentJa,
  editing: editingJa,
  review: reviewJa,
  host: {
    connecting: "{{host}} に接続しています…",
    offline:
      "{{host}} はオフラインです。再接続すると Canvas の変更が反映されます。",
  },
  screen: {
    noWorkspace: "ワークスペースが選択されていません",
    noWorkspaceHint:
      "サイドバー、またはワークスペースの Canvas パネルから Canvas を開いてください",
    workspaceUnavailable: "ワークスペースを利用できません",
    openWorkspace: "ワークスペースを開く",
  },
  sidebar: {
    recent: "最近の Canvas",
    loadFailed: "Canvas を読み込めませんでした: {{message}}",
    empty: "Canvas はまだありません",
    emptyHint:
      "ワークスペースで Canvas を作成するか、エージェントに作成を依頼してください",
  },
} as const satisfies Localized<typeof en>;
