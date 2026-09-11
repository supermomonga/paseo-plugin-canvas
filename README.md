# paseo-canvas

Paseoのワークスペース内で共有する、Markdown（GFM）専用のCanvasプラグインです。同じワークスペースの複数エージェントが、プロジェクト内に文書ファイルを作らずに実装プランや調査メモを共有できます。

UI・通知・エラー・アクセシビリティ用の文言は英語固定です。言語切り替えやPaseoの言語設定への追従は行いません。Canvasのタイトル・本文は任意の言語で記述できます。

## 利用条件

- Paseo Plugin SDK 0.8.0、Node.js 22.22以降、npm 11以降。
- **現行Paseo 0.8.0には、同梱の [セッションMCPパッチ](integrations/paseo-session-mcp.patch) が必要です。** `agent.session_open` にMCP設定の変更機能を追加します。バージョン指定だけでは、この未リリース拡張の有無を判定できません。
- パッチ未適用の場合、CanvasのMCP注入時に必要な拡張を示すエラーを返します。グローバル／プロジェクトのMCP設定へ代替登録する処理はありません。
- 使用するプロバイダーがMCP接続に対応している必要があります。直接実装のカスタムプロバイダーは `session.open.config.mcpServers` を接続先エージェントへ転送してください。

本体パッチの適用・検証手順は [integrations/README.md](integrations/README.md) を参照してください。実行中のデーモンの再起動は、そのデーモン上の作業に影響するため、このリポジトリのセットアップでは自動実行しません。

```sh
npm ci
npm run setup
npm run check
```

パッチを含むPaseoへ切り替えた後、このディレクトリをPaseoのプラグインとしてインストールしてください。プラグインのグローバル有効化はPaseoの設定に従います。インストール済みプラグインのコードを更新した場合はプラグインをリロードし、既存エージェントもセッションを再開／リロードして新しいMCP接続情報を受け取ります。

## 機能

- ワークスペースごとの複数Canvas、一覧、プレビュー／コード切り替え、本文コピー。
- CommonMark/GFMの見出し、表、タスクリスト、取り消し線、コード、引用、参照リンク。入れ子とリンク内の装飾を保持します。
- GitHub形式のアラート5種類、脚注と戻りリンク、日本語・重複見出しへの文書内リンク、絵文字ショートコード。
- Mermaidのフローチャート・シーケンス図の一部記法。React Nativeの部品で表示し、拡大・縮小・全体を収める操作・ドラッグ・2本指のピンチ操作に対応します。未対応の記法を含む図は、その理由と原文を表示します。
- 行内・ブロック数式。デーモン側のMathJaxとresvg WASMでPNG化します。ChromiumやWebViewは使用しません。
- Markdown内のHTMLは `details` / `summary` / `br` / `sub` / `sup` のみ表示に使用し、HTMLコメントは隠します。任意のHTMLやスクリプトは実行しません。HTML形式のCanvasは扱いません。
- HTTP・HTTPSの画像と、ワークスペースのルートを基準にした相対パスのPNG・JPEG・GIF・WebP画像を表示します。ローカル画像は5 MB以下、ワークスペース外へのパス・シンボリックリンクは拒否します。外部画像は閲覧クライアントから取得します。
- 外部リンクはHTTP・HTTPS・mailtoに対応。見出し・脚注リンクは文書内を移動し、移動先を含む折りたたみを開きます。GitHubのユーザー通知・Issue参照・コミット展開は対象外です。
- 編集者、取得日時、最終延長日時、有効期限を表示。所有者は認証済みセッションから決定します。
- ユーザー向けパネルは参照専用です。作成・編集・削除はMCPでエージェントが行います。
- パネルは2秒間隔で取得し、取得失敗時には最後に取得した内容であることを明示します。

## UI方針

Paseo本体の `docs/design.md` と標準パネルを基準にしています。広い画面は一覧と本文を左右に配置し、狭い画面は一覧から本文へ移動します。ヘッダーと操作列の高さ・文字の行高を揃え、操作ボタンには枠とアイコンを常時表示します。コピー結果はPaseoの通知、タイトル全文・ID・ロック時刻は標準Modalの詳細表示にまとめています。

適用した規則、参照箇所、SDKに公開されていない文字サイズ設定などの制約は [docs/ui.md](docs/ui.md) に記載しています。

## エージェント向けツール

| ツール          | 主な引数                                                         | 用途                               |
| --------------- | ---------------------------------------------------------------- | ---------------------------------- |
| `canvas.list`   | なし                                                             | 所属ワークスペースの一覧と編集状態 |
| `canvas.get`    | `canvasId`                                                       | 本文・revision・編集状態           |
| `canvas.create` | `title`, `content`                                               | GFM文書を作成                      |
| `lock.acquire`  | `canvasId`                                                       | 排他的な編集権を取得               |
| `lock.renew`    | `canvasId`, `lockToken`                                          | 編集権を延長                       |
| `canvas.update` | `canvasId`, `lockToken`, `expectedRevision`, `title` / `content` | 文書を更新                         |
| `lock.release`  | `canvasId`, `lockToken`                                          | 編集権を解放                       |
| `canvas.delete` | `canvasId`, `lockToken`, `expectedRevision`                      | 文書を明示削除                     |

ロックは5分間有効です。長時間の編集では期限前に `lock.renew` を呼び、作業後に解放してください。競合時は `canvas.get` で再取得します。自動マージ・無条件上書きはしません。編集中でも他セッションからの読み取りは可能です。

`canvas.list` と `canvas.get` の `editState` は次のどちらかです。`observedAt` は応答直下のサーバー判定時刻です。

```json
{ "status": "unlocked" }
```

```json
{
  "status": "locked",
  "lock": {
    "id": "public-lock-id",
    "ownerAgentId": "agent-id",
    "ownerAgentTitle": null,
    "acquiredAt": "2026-09-11T09:00:00.000Z",
    "renewedAt": "2026-09-11T09:01:00.000Z",
    "expiresAt": "2026-09-11T09:06:00.000Z"
  }
}
```

公開ロックIDと秘密の `lockToken` は別です。list/getにトークンは含めません。延長では取得日時を維持し、再取得ではIDと取得日時を更新します。ロック操作だけでは本文のrevisionを増やしません。

## 保存

Paseoデーモンが動くマシンに保存します。

| OS      | 保存ルート                                                                              |
| ------- | --------------------------------------------------------------------------------------- |
| Linux   | `$XDG_DATA_HOME/paseo-canvas`（未設定・空・相対パスなら `~/.local/share/paseo-canvas`） |
| macOS   | `~/Library/Application Support/paseo-canvas`                                            |
| Windows | `%LOCALAPPDATA%\paseo-canvas`                                                           |

```text
<保存ルート>/hosts/<hostKey>/<workspaceId>/<canvasId>.md
```

`hostKey` は実効 `PASEO_HOME`（既定 `~/.paseo`）の実パスのSHA-256です。Paseoホームを移動すると保存領域も変わるため、明示的にデータを移行してください。

文書のUTF-8 Markdownファイルには、先頭のYAML frontmatterとして `schemaVersion`, `workspaceId`, `canvasId`, `title`, `revision`, `createdAt`, `updatedAt`, `updatedByAgentId` を保存します。その後にGFM本文をそのまま保存し、APIと画面表示には管理用frontmatterを除いた本文を渡します。保存ファイルを外部から読むことはできますが、外部エディターとの同時書き込みには対応しません。

同じディレクトリへの一時ファイル書き込み、ファイル同期、置換、ディレクトリ同期を完了してから成功を応答します。解析・読み書きに失敗しても空の文書で上書きしません。置換後の同期失敗では保存結果が確定できないため、そのストアへの以降の書き込みを停止します。

文書は再起動やワークスペースのアーカイブ後も保持します。編集ロックとMCP認証情報はメモリだけで管理し、再起動で失効します。保存領域のプロセス間排他には `proper-lockfile` を使います。5秒ごとに更新し、強制終了後は30秒で期限切れと判定します。起動時は最大35回、1秒間隔で所有権取得を待ちます。排他の喪失を検出したプロセスは以降の操作を拒否します。ローカルディスクを前提とし、ネットワーク共有や外部プログラムによる同時更新は対象外です。

## MCP接続の範囲

MCPはループバックアドレスだけで待ち受けます。Paseoが開く対話セッションごとに別の認証情報を発行し、agentIdとworkspaceIdを関連付けます。無認証、失効した認証情報、ブラウザーOrigin付き要求を拒否します。履歴取得だけの起動には注入しません。Paseo外で通常起動したエージェントの設定は変更しません。

同じOSユーザー権限の任意コードからの隔離を提供するものではありません。認証情報をグローバル設定へ転記しないでください。

## 依存と検証

`paseo-plugin-helper` は指定タグ `v0.4.0-beta.7` を採用し、package-lock.jsonでcommitを固定しています。UIの `Button`・`Tabs`・`Badge`・`EmptyState`・`CodeBlock`・`KeyValue`、`PluginThemeProvider`、ホスト初期化・Query、RPC契約、ログに利用しています。Markdown原文全体はPaseo標準の `ScrollView` とReact Nativeの `Text` で表示し、コード片にはhelperの `CodeBlock` を使います。本文ストアには `PluginStorage` を使いません。

`npm run check` で型検査と次の検証を行います。

- 保存・復元・破損拒否・同時更新・期限切れ・ワークスペース分離。
- 強制終了後の復元、保存領域の排他、シンボリックリンクによる保存先変更の拒否。
- 実HTTP MCPクライアントでのA/B間共有、認証、競合、失効。
- Paseoの実コンパイラーによる両エントリーのビルド、隔離プロセスでのサーバーバンドル実行とMCP／RPC連携。
- GFM・編集状態・表示切り替え・コンパクトレイアウトのコンポーネント検証。
- Mermaidの解析・配置・未対応記法の拒否、拡大・移動・画面幅変更、数式の実PNG生成。

画面検証用のfixtureは `npm run visual:build` で `.test-output/visual` に生成できます。これはサンプルデータを使う開発用画面で、プラグインにバンドルされません。

検証環境はmacOS・Node.js 22です。React Native Webのデスクトップ／390px幅、明暗テーマ、コード切り替えをブラウザーで確認しています。iOS／Androidの実機、Linux／Windows上の保存耐久性、パッチ適用後の実デーモンと実エージェントによる一連の動作は未検証です。特にWindowsのディレクトリ同期は未対応環境でエラーとなるため、対応済みとは扱いません。

### Markdown表示の依存関係

`remark-parse` / `remark-gfm` / `remark-math` / `remark-emoji` で解析し、`remark-rehype` / `rehype-raw` / `rehype-sanitize` で許可した文書構造へ変換します。解析はサーバーで行い、検証済みの構造をRPCで送り、クライアントはPaseoのテーマとReact Nativeの部品で表示します。ソース表示とMCPの本文は原文を保持します。

`npm run setup` はresvgのWASMと日本語フォントをサーバーバンドルに埋め込むファイルを生成します。ブラウザーの取得・起動や、描画時の外部サービスへの接続はありません。数式の描画はPaseoデーモン側、図の描画は閲覧クライアント側で行います。クライアントにMathJax・resvgや追加ネイティブモジュールは渡しません。コードのシンタックスハイライトは追加していません。

### Mermaidの対応範囲

[`dutchakdev/paseo-plugin-mermaid`](https://github.com/dutchakdev/paseo-plugin-mermaid) のMITライセンスのパーサー・配置処理・React Native描画部分を固定commitから取り込んでいます。独立したライブラリとして配布されたものではないため、必要なソースを同梱しました。[出典と変更点](third-party/paseo-plugin-mermaid/README.md) と [ライセンス](third-party/paseo-plugin-mermaid/LICENSE) を保持しています。

公式Mermaidの全記法には対応しません。宣言と内容は改行で区切り、1行に1つの定義または接続を書きます。

- `flowchart` / `graph`: TD・TB・BT・LR・RL方向、矩形・角丸・スタジアム形・サブルーチン・円・ひし形、実線・破線・太線、接続ラベル、連続した接続。
- `sequenceDiagram`: participant・actor、メッセージ、実線・破線、矢印・交差線・非同期メッセージ、自己呼び出し、over・left of・right ofの注記。actorは角の丸い参加者枠で区別します。
- subgraph・style・classDef・click・設定ディレクティブ、六角形・非対称形、loop・alt・activate等のブロックや他の図種は未対応です。パーサーが扱えない行を検出したら、図全体を表示せずにエラーと記法の確認操作を出します。

図は自動で表示領域に収め、最大400%まで拡大できます。Electron／Webでは描画エリア内のホイール操作でポインター位置を中心に拡大縮小します。このエリア内では本文をスクロールせず、上限・下限に達してもページへスクロールを流しません。拡大後はマウスまたは1本指で移動、2本指で拡大縮小・移動できます。「全体を収める」で位置と倍率を戻せます。上部の「ポップアップ」と右寄せの「コードを表示」は、図・コードを画面全体から12pxの余白を取ったポップアップに表示します。React Native標準Modalを使い、閉じるボタン・Androidの戻る・WebのEscに対応します。図のラベルは配置計算に合わせて固定サイズとし、文字も図の拡大率に従って大きくなります。入力50,000文字、フローチャート200ノード・300接続、シーケンス図30参加者・100イベント、配置サイズ各辺8,000pxを上限とします。

### 数式の対応範囲

MathJax 4.1.3のTeX入力（base・ams・newcommand・boldsymbol・mathtools・cancel）と同版のTeXフォントを使用します。数式ごとにマクロと番号の状態を分離し、追加パッケージの自動取得はしません。日本語テキストには同梱のNoto Sans JPを使います。[フォントの出典とライセンス](server/assets/README.md) を参照してください。

数式は50,000文字以内、マクロ展開1,000回、PNG各辺8,192px・合計1,600万画素、転送用データ8 MBに制限します。2倍の密度で画像化し、表示にはその半分の寸法を使います。描画エラーは明示し、記法の確認と再試行を用意します。

表示確認: `npm run visual:build` と `npm run visual:serve` を実行し、`http://127.0.0.1:49618` を開きます。サンプル文書とホストUIの代替実装を使用しますが、Markdown解析・図と数式の描画・画像読み込みには製品と同じコードを使います。Paseo本体へのインストール検証とは別です。

MathJaxの間接依存が参照するXMLパーサーの既知の脆弱性を避けるため、`overrides` で `@xmldom/xmldom@0.9.12` を指定しています。上流の指定が更新された時点で見直します。
