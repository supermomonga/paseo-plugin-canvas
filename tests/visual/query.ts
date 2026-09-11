const state = {
  status: "locked",
  lock: {
    ownerAgentId: "agent-a",
    ownerAgentTitle: "Agent A",
    acquiredAt: "2026-09-11T09:00:00Z",
    renewedAt: "2026-09-11T09:01:00Z",
    expiresAt: "2026-09-11T09:05:00Z",
  },
};
const canvas = {
  canvasId: "example-canvas",
  title: "実装プラン",
  revision: 3,
  editState: state,
  content:
    "# 実装プラン\n\n同じワークスペースの **Agent B** が参照できます。\n\n| 機能 | 状態 |\n|---|---|\n| Markdown保存 | 実装済み |\n| 編集ロック | 実装済み |\n\n- [x] プロジェクト外へ保存\n- [ ] 実装内容をレビュー\n\n~~旧案~~ と https://example.com\n\n```ts\nconst canvas = await readCanvas(id);\n```",
};
const memo = {
  ...canvas,
  canvasId: "memo",
  title: "調査メモ",
  editState: { status: "unlocked" },
  content:
    "# 調査メモ\n\nセッションをまたいで参照するメモです。\n\n- 設計上の制約を確認\n- 実装プランへ反映",
};
const longTitle = {
  ...canvas,
  canvasId: "long",
  title: "エージェント間で共有する長いタイトルの実装計画と調査結果のまとめ",
  editState: {
    ...state,
    lock: {
      ...state.lock,
      ownerAgentTitle: "長い名前のエージェント・実装と検証を担当するセッション",
    },
  },
};
export function getFixtureQuery(contract: { name: string }, input?: { canvasId?: string }) {
  const items = [canvas, memo, longTitle];
  const selected = items.find((item) => item.canvasId === input?.canvasId);
  if (contract.name !== "canvas.list" && !selected) throw new Error("Canvas not found");
  return { data: contract.name === "canvas.list" ? { items } : { canvas: selected } };
}
