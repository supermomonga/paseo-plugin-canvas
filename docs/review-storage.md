# Review storage and delivery

Reviews are stored on the Paseo daemon host, in the existing platform-specific Canvas data root. They are shared across viewing devices and sessions. They are not stored in the project, browser storage, or the session timeline.

```text
<data-root>/hosts/<sha256-of-canonical-PASEO_HOME>/<workspace-id>/
├── <canvas-id>.md
└── reviews/<canvas-id>/
    ├── state.json
    └── snapshots/<document-revision>.md
```

The current document keeps its existing YAML frontmatter plus Markdown format. A snapshot is the exact UTF-8 document body, without frontmatter or newline normalization. Only revisions referenced by a review are captured. Snapshots are immutable.

## State format (schemaVersion 1)

`state.json` is UTF-8 without BOM, formatted with two-space indentation and one trailing newline. It contains:

| Field | Value |
| --- | --- |
| `schemaVersion` | `1`; unknown versions are errors |
| `workspaceId`, `canvasId` | Identity, validated against the containing directories |
| `revision` | Review-state update counter, initially zero; independent of document revision |
| `createdAt`, `updatedAt` | UTC ISO 8601 timestamps |
| `snapshots` | Map from document revision to `{sha256, title}` |
| `threads` | Map from thread ID to its state |
| `deliveries` | Map from immutable request ID to its payload and send attempts |

Each thread contains `id`, `revision`, timestamps, `status`, `assignedAgentId`, `currentRequestId`, `currentAnchorId`, `anchors`, and `messages`. Status is `needs_agent_review`, `needs_user_review`, or `resolved`.

Each anchor contains `id`, `documentRevision`, `kind` (`text`, `block`, or `lines`), `start`, `end`, `selectedText`, `sourceText`, `prefix`, `suffix`, and `createdAt`. Offsets are UTF-16 positions in the body, with an exclusive end. `selectedText` is the visible quote, while `sourceText` is the exact Markdown slice. Context retains up to 48 Unicode code points on either side. Reattachment appends a new anchor and updates `currentAnchorId`; older anchors remain available as history. DOM IDs and rendering trees are not persisted.

Each message contains `id`, `revision`, `author`, `kind`, Markdown `body`, timestamps, `requestId`, and `documentRevision`. A user author is `{role: "user"}`; an agent author includes its authenticated agent ID and display name. Message kinds are `comment`, `question`, `explanation`, and `applied`. Request ID and document revision are nullable; applied reports require a saved document revision. User messages are editable/deletable only while no sending, unknown, or accepted attempt contains them. Messages are limited to 20,000 UTF-16 units and the complete state file to 32 MiB. Limit errors preserve the previous state.

Each delivery contains `id`, `agentId`, `createdAt`, the exact `prompt`, and `threads`: immutable copies of thread IDs, revisions, anchors and messages at send time. `attempts` records an ID, `sending | accepted | failed | unknown`, start/finish timestamps and an error for each attempt. The stable request ID is passed to Paseo as `messageId`; the attempt ID is internal. Editing a failed request's messages requires a new delivery; retrying the unchanged request retains its message ID. Authentication tokens are never included.

The executable schemas and RPC contracts live in [shared/review.ts](../shared/review.ts).

## Commit and recovery

Document and review operations share the existing per-canvas serialization and store ownership lease. Comments do not acquire the document edit lease or increment document revision. Thread revisions reject stale edits and resolutions.

The first mutation commits an empty state before creating snapshots. A snapshot is written and synchronized before any state referencing it. State commits use an exclusive temporary file in the destination directory, file synchronization, rename, and parent-directory synchronization. Files/directories use 0600/0700 permissions, consistent with existing storage. Only after the state commit is a workspace change published.

Reads validate the schema, identities, file types, snapshot hashes, and anchor source/context. Invalid data, missing referenced snapshots, symlinks, or unknown formats are errors; they do not become empty reviews. A failed synchronization after rename stops store operations because durability is uncertain.

Startup changes unfinished sends to `unknown`. It removes unreferenced snapshots and temporary files only after validating the relevant state. Resolved threads, anchor history and delivery records keep their snapshots. Missing state with committed snapshots is corruption. An interrupted initialization containing only empty directories/temporary files can be recovered.

Document deletion is committed before review cleanup. Startup removes review data whose document no longer exists, but treats a corrupt existing document as an error rather than a deletion.

## Source tracking

Parser-produced maps preserve source positions through entity/escape decoding, emoji, inline code and formatting. Tracking compares a saved snapshot with the current body using `diff` 7.0.0. It uses unchanged spans and unique quote/context identity, bounded to 100 ms and edit distance 10,000 per comparison. Modified, deleted, ambiguous or over-budget targets are Outdated. The original quote remains available; no guessed relocation occurs. Tracking projections and message rendering trees are derived, not stored.

## Explicit dispatch

Saving/replying only updates the review. The user chooses a same-workspace session with active Canvas MCP and explicitly sends selected threads. Pending permissions prevent dispatch; active turns require interruption consent. These checks use the released SDK snapshot and cannot atomically prevent a host status change between inspection and send.

Persist `sending` and the immutable payload before calling SDK `send`. Do not hold the document operation queue while waiting for the network. Record `accepted` only after the SDK resolves; it means accepted for processing, not applied or resolved. A pre-send check failure is `failed`. A rejected send with no reliable acceptance information is `unknown`.

Unknown outcomes are never automatically resent. Manual retry may duplicate a message across daemon restarts because the public API does not guarantee durable exactly-once delivery. Changing the assignee does not stop an older agent's turn. Only the current assignee and request may post an MCP reply; document writes continue to use normal Canvas locks.

## MCP review tools

- `canvas.review.list({canvasId})`: threads and their tracked source positions.
- `canvas.review.get({canvasId, threadId})`: current thread revision, request ID, history and target.
- `canvas.review.reply({canvasId, threadId, expectedRevision, requestId, kind, body, documentRevision?})`: an assigned agent's question, explanation or applied report. Applied requires `documentRevision` from a successful document save.

Workspace and author identity come from the authenticated MCP session. User resolution is available only through the UI RPC, not the agent tools. Normal chat replies are not automatically copied into the review.
