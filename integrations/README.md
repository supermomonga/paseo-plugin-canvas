# Paseo本体との連携

`paseo-session-mcp.patch` はPaseo commit `772ff8d6f37571aa2f3e0016827f026fefbde2ac` に対するパッチです。元のチェックアウトには変更を加えず、独立したチェックアウトで作成・検証しました。

## 変更

- `PluginSessionOpenRequest.mcpServers` と、フック結果の検証を追加。
- 作成・再開・更新・取り込みで、フックへ起動用MCP設定を渡す。
- フックの変更はプロバイダー起動用設定だけへ適用し、保存用設定へ混ぜない。
- 内蔵Paseo MCPの既存ポリシーを維持し、追加MCP非対応のプロバイダーを拒否。
- カスタムプロバイダーのimportが起動用設定を保存用として返していた箇所を修正。
- フック、エージェント管理、カスタムプロバイダーの回帰テストと公式リファレンスを更新。

適用先のPaseoチェックアウトで、先に差分を確認してください。

```sh
git apply --check /absolute/path/to/paseo-plugin-canvas/integrations/paseo-session-mcp.patch
git apply /absolute/path/to/paseo-plugin-canvas/integrations/paseo-session-mcp.patch
```

Paseo側の依存を導入し、Plugin SDKとサーバーをそのチェックアウトの手順でビルドします。変更を含むデーモンへの切り替えが必要です。現在のデーモンをこのプラグインから再起動することはありません。

検証に使った対象テスト:

```sh
npx vitest run \
  packages/server/src/server/plugins/lifecycle/handlers.test.ts \
  packages/server/src/server/agent/agent-manager.test.ts \
  packages/server/src/server/agent/plugin-provider.test.ts \
  --config packages/server/vitest.config.ts
```

パッチの導入だけで、MCP非対応のエージェント製品が対応するわけではありません。カスタムプロバイダーの `session.open.config.mcpServers` まではPaseoが転送します。その先はプロバイダーの責務です。

対象3ファイルの197テスト、Plugin SDKの型宣言ビルド、指定commitへの `git apply --check` は成功しています。サーバー全体の型検査は、検証用に導入したnpm依存とこのPaseoソースのACP SDK・protocol型の差異、および不足している型定義により完走していません。変更対象のサーバーファイルには型エラーは出ていませんが、本体全体のビルド成功や実デーモンでの動作を確認したものではありません。
