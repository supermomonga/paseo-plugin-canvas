# CanvasのUI方針

Paseo本体の [docs/design.md](https://github.com/getpaseo/paseo/blob/f22a37e613e965c8ebc02e1f5565e21fd72eaf2f/docs/design.md) を基準にする（参照commit: `f22a37e613e965c8ebc02e1f5565e21fd72eaf2f`）。プラグインSDKの公開APIと `paseo-plugin-helper/client` を使い、本体の内部コンポーネントを直接importしたり、コピーして独自に保守したりしない。

## 本体に合わせる点

- **構成**: ワークスペースのタブ見出しはPaseoに任せる。パネル内に大きな製品見出しを重ねない。左右のヘッダーは64px高で統一し、操作列との境界線を揃える。操作列と本文も1本の境界線で分ける。
- **一覧と本文**: 幅が足りる場合は320pxの一覧と400px以上の本文を並べる。コンパクト画面や、その構成を置けない幅の分割パネルでは、同じ一覧・本文コンポーネントを切り替え、「戻る」で一覧に戻る。画面全体の幅ではなく、パネルに割り当てられた幅も確認する。
- **一覧行**: 個別の枠やアクセント色の縁取りを付けない。選択・hover・押下は公開テーマの `surface2` で示す。行全体を押せるようにし、先頭の文書アイコンと末尾のchevronで本文への移動を示す。タイトルは `foreground`、補足は `foregroundMuted`。フォーカスは色付きの輪郭で示す。長いタイトルは1行に省略し、アクセシビリティラベルには全文を残す。
- **文字と余白**: 見出しと一覧の文字は14px／行高20px、補足は12px／行高16px、操作ボタンは12px／行高16px、文書本文15px（iOS/Androidは16px）、コード12pxを基準にする。構造を示すラベルだけ500の太さにする。余白は本体の4・8・12・16・24pxの段階を使う。Markdown文書自体の見出しと強調は本文の意味を維持する。
- **文書の幅**: 本体のファイルプレビュー同様、Markdownの読み取り領域は最大820px。原文は作業領域の幅を使う。表とコード片は横スクロールできる。
- **操作部品**: ボタンはhelperの `Button`、表示切り替えは `Tabs`。再取得・戻る・コピー・詳細は `secondary` とし、通常状態から枠・背景・Lucideアイコンで操作可能と分かるようにする。状態説明を同じボタン形状にしない。ボタンは基本を `size="sm"`、本文コピーボタンのみ `size="md"` とし、高さ・余白・アイコンサイズはhelperの標準に任せる。タブにも固定高を設定しない。スマホ向けの最小タッチ領域はhelperのレスポンシブ設定に従う。ツールバーの文字の行高は `client/controls.tsx` に集約する。独自の主要アクションや警告色を増やさない。
- **状態**: 編集者は常に見える位置に置く。編集ロック自体は通常の状態なので、helperの中立色 `Badge` と補足文字で示す。省略していないタイトル・ID・リビジョン・各ロック時刻は「詳細」で開くPaseo標準の `Modal` にまとめ、`KeyValue` で表示する。標準Modalのシート表示・安全領域・キーボード処理はホストに任せる。
- **通知**: コピー成功・失敗、リンクを開けない場合はホストの `useToast`。通知のために本文を押し下げない。
- **読み込みとエラー**: 初回読み込みは短い文言。自動ポーリングではボタンを点滅させない。手動再取得時の待機表示は固定幅のボタン内に収める。取得失敗は一覧・本文それぞれの領域内に表示し、キャッシュ表示と初回失敗を区別する。選択中のCanvasが削除された場合はその状態を明示する。
- **空の状態**: helperの `EmptyState` を使い、装飾アイコンを無効化する。短い説明を中央に置く。

## 公開APIによる制約

確認したPlugin SDK 0.8.0の `PluginTheme` が公開するのは11色のみ。本体の文字サイズ・余白・フォント、`surfaceSidebar` / `surface3` / `interactionHighlight` は公開されていない。このため本体の「Interface size」「Code size」を動的に追従することはできない。色は公開テーマに追従し、寸法は本体の既定値を参照する。

本体の `Button`、`SegmentedControl`、`StatusBadge`、`LoadingSpinner`、`Alert`、`BackHeader`、`MarkdownRenderer` も公開されていない。一般操作はhelperで共通化し、標準SDKの `Icon` / `Modal` / `ScrollView` / `useToast` / `copyText` を利用する。helper beta.7のTabsやEmptyStateなど、公開propsで調整できない文字・形状・操作フィードバックの差は残る。SDKが将来これらを公開した時点で、公開された部品・トークンに移行する。非公開APIへの依存やhelper内部へのスタイル上書きは追加しない。

参照元:

- `getpaseo/paseo/docs/design.md`: 部品再利用、文字階層、ボタン、境界線、一覧と本文、状態表示。
- `packages/app/src/styles/theme.ts`: 文字・余白・角丸の基準値。
- `packages/app/src/constants/layout.ts`: 320pxの一覧、400pxの本文、820pxの文書幅。
- `packages/app/src/file-pane/markdown-preview/index.tsx`: 文書の余白と読み取り領域。
- `packages/app/src/plugins/theme.ts`: PluginThemeへ渡される公開色。
- `packages/plugin/src/client/react-native.ts` と `ui.ts`: ホストUIの公開範囲。

## 検証範囲

`npm run check` で一覧・本文の遷移、幅の制約、コード切り替え、メタデータの表示、コピー通知、再取得、別エージェントによる削除を検証する。`npm run visual:build` の開発用画面では実際のパネルとhelperを使い、明暗テーマ、デスクトップ・390px幅で確認する。

開発用画面のアイコンは本体と同じ `lucide-react-native`、配色は本体の標準明暗テーマを使う。Modal、通知、clipboard、RPCのホスト接続はfixtureであり、実際のPaseoのModal表示や通知、OS clipboard、iOS/Androidのジェスチャーの動作確認にはならない。本体パッチを導入したPaseo上での検証は別途必要。

## 整列の検証

目視に加えて、描画されたDOMの文字矩形を計測する。2026-09-11の1280×800の検証用Webビューでは、左右の見出し上端はどちらも59px、ロックの「編集中」とエージェント名はどちらも84.5px、プレビュー・コード・コピーはすべて137pxだった。同じ行でフォントが同じ要素の描画位置を比較した値であり、文字列を囲うコンテナーの中央だけを比較したものではない。

390px幅では画面外への横はみ出しがないこと、長いタイトルが操作ボタンを押し出さないことを確認する。helperのcompactタブ文字は11px固定で、ボタンの12pxとは差があるため、完全に同じフォント設定とは扱わない。Tabによるフォーカス移動とEnterによる一覧・本文の移動も実際のブラウザーで確認する。サンプルには通常の文書・ロックなしの文書・長いタイトルとエージェント名を含める。

## Markdownの表示

記法の解析はremark系のライブラリで行い、サーバーから検証済みの文書構造を受け取る。プラグインSDKはクライアント依存の型参照も検査するため、Nodeの型へ依存する解析プラグインをクライアントへ持ち込まない。元のMarkdownは保存・MCP・コード表示で保持する。

アラートは左罫線、16pxのホストIcon、種類名を使う。色は公開テーマの意味に合わせ、Note/Importantはforeground、TipはstatusSuccess、WarningはstatusWarning、CautionはstatusDangerを使用する。GitHub固有の青・紫を固定色で持ち込まない。

折りたたみには常時ボタンの外観と開閉アイコンを付ける。脚注・見出しリンクは下線で識別でき、閉じた領域への移動時は該当領域を開く。表と大きな数式は横スクロールし、画像は本文幅に収める。タスクは読み取り専用として表示する。

ライブラリ選定: react-native-markdown-displayは保守終了、後継enriched-markdownはホスト側へのネイティブモジュール導入が必要。react-markdownはDOM向けで、単独ではiOS/Androidの表示に使えない。このためremarkを解析に採用し、表示は公開SDK・helper・React Nativeで実装する。MermaidはMITライセンスの `paseo-plugin-mermaid` から取り込んだパーサーと配置処理を使い、React NativeのViewとTextで描画する。対応範囲はフローチャート・シーケンス図の一部に限り、未対応記法を含む図は理由と原文を表示する。数式はサーバー側のMathJaxとresvg WASMでPNG化する。描画にChromium・WebView・追加ネイティブモジュールは必要ない。

## 図の操作と両プラットフォーム対応

Mermaidの縮小・拡大・全体を収める・ポップアップ・コードを表示にはhelperのButtonとホストIconを使う。`size="sm"` を使い、狭い領域では操作列を折り返す。スマホ向けの押下領域はhelperに任せる。操作は図の上部に集め、「コードを表示」は右寄せにする。SDK Modalは外枠の幅を指定できないため、図とコードのポップアップはReact Native標準Modalを使い、安全領域の内側に12pxの余白を取る。iOS/Webは標準SafeAreaView、AndroidはModalのシステムバーを透過しない設定で表示領域を確保する。図は操作列を除く残りの高さを使い、コードも本文領域の高さまでスクロールできる。閉じるボタン・Androidの戻る・WebのEscで閉じる。

描画はReact NativeのView・Text、操作はPanResponderを使う。通常サイズで図が収まるときは1本指の移動を奪わず本文スクロールに任せ、図がはみ出す方向のドラッグを処理する。2本指で倍率と位置を変えられる。表示領域の幅・高さが変わると図全体を収め直す。図の文字は配置と線の関係を保つためOSの文字倍率では変えず、図のズームで拡大する。本文や操作ラベルはこの制限の対象外。

Electron向けとスマホ向けに異なる描画方式を持たない。製品クライアントはReact・React Native公開API・Paseo公開SDK・helperに依存する。開発用fixtureでのみ使う `react-native-svg` は製品クライアントには含まれない。自動検証ではweb・ios・android設定で描画とPanResponderの入力を確認するが、モック検証は実機のタッチ応答やPaseoのシート内ジェスチャーとの競合を保証しない。

Electron／Webの描画エリアでは、Viewの公開refから取得した要素だけにホイールリスナーを登録する。ReactのonWheelはpassiveで本文スクロールを抑止できないため、`passive: false` を指定し、ポインター位置を中心に拡大縮小する。リスナーはサイズ変更時・アンマウント時に解除する。Web固有の処理は `Platform.OS === "web"` に限定し、iOS／Androidでは実行しない。ツールバーや本文上の通常スクロールには介入しない。
