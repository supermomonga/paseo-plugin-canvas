# paseo-canvas

**Shared Markdown documents for agents in the same Paseo workspace.**

Let one agent write an implementation plan and another read it in a separate session. Keep multiple canvases per workspace, preview them in Paseo, and persist them outside your project directory.

[Get started](#get-started) · [Usage](#usage) · [Markdown support](#markdown-support) · [MCP tools](#mcp-tools) · [Development](#development)

## Features

- **Workspace sharing:** multiple documents shared by agents in the same workspace.
- **Preview and source views:** GFM, alerts, footnotes, images, selected Mermaid diagrams, and mathematics.
- **Visible editing ownership:** renewable locks and revision checks prevent conflicting writes while other agents continue reading.
- **Automatic updates:** list, document, and lock state refresh when changes occur, without reload buttons.
- **Agent feedback:** create/update results report unsupported Mermaid syntax with document line numbers and repair hints.
- **Timeline actions:** canvas saves add a dedicated activity row with an **Open canvas** button.
- **Persistent storage:** documents survive restarts without creating files in the project tree.
- **Paseo integration:** a shared React Native UI built with public SDK components and `paseo-plugin-helper`, adapting to wide and compact panels.

Document content is **read-only** in the panel; agents create and edit canvases through MCP. Users can select content and write review comments. Plugin UI, notifications, and errors are in English. Document content can use any language.

## Get started

### Requirements

- Paseo **0.8.0 or later**, with plugins enabled on the target daemon. No core patch is required.
- Node.js **22.22+** and npm **11+** on the daemon host.
- An agent provider supporting **HTTP MCP**. Custom providers must forward `session.open.config.mcpServers`, including its URL and headers, to the underlying agent.

### Install from a local checkout

From the repository directory on the daemon host:

```sh
npm ci
npm run setup
npm run check
paseo plugin add .
```

Setup embeds rendering WASM and fonts; it does not download or launch Chromium. The plugin manifest also declares dependency installation and setup as build steps for Git-based installation and updates.

> [!IMPORTANT]
> Create a **new agent after installing or enabling the plugin**. MCP registration happens during agent creation and is retained for subsequent resumes. Existing agents and sessions imported directly from another agent product are not retrofitted.

After updating an installed local checkout:

```sh
npm ci
npm run setup
paseo plugin reload paseo-canvas
```

If upgrading from the earlier implementation that required a core patch, create a new agent afterward. Existing canvas documents are retained. Loading plugin changes does not require a daemon restart.

## Usage

1. Open a Paseo workspace and choose **Open Canvas** from the Command Center.
2. In a newly created agent session, ask: “Create a Markdown canvas named Implementation plan with the proposed steps and verification checklist.”
3. Read the result in **Preview**, or switch to **Code** to inspect and copy the original Markdown.
4. Start another agent in the **same workspace** and ask it to read the canvas and implement the plan.

Both agents see the same documents. Editing ownership remains visible, and changes appear automatically. Wide panels show a list/detail split; compact panels navigate between those views.

On Android and iOS, use the notebook icon in the workspace header to open Canvas. Paseo 0.8.0 does not list plugin panels in its mobile Workspace actions menu; the header button provides a direct entry point.

Creating or editing a canvas adds a row to the editing agent's timeline. **Open canvas** opens its workspace panel and selects that document, including when the panel is closed. It opens the latest saved content; the revision in the row describes the save that produced the notification. Deleted documents show a deletion message.

Timeline delivery runs while a Paseo client has the plugin loaded and the app is active, independently of the Canvas panel. Pending notifications are stored on the daemon and retried after reconnecting. **Paseo 0.8.0 does not preserve appended plugin rows across daemon restarts.** Already delivered rows are not replayed; canvases remain available from the workspace panel. This uses public timeline/panel APIs, without custom URL handlers or a core patch.

## Markdown support

| Content | Supported behavior |
| --- | --- |
| CommonMark and GFM | Headings, nested lists, quotes, links, tables, task lists, strikethrough, and code blocks. Tasks are read-only. |
| GitHub-style extensions | Five alert types (`NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`), footnotes with return links, emoji shortcodes, and heading anchors including Japanese and duplicate headings. |
| Embedded HTML | Only `details`, `summary`, `br`, `sub`, and `sup` participate in rendering. Comments are hidden; other raw HTML appears as text. Scripts are never executed. |
| Images | HTTP/HTTPS images and workspace-relative PNG, JPEG, GIF, and WebP files. Local images are limited to 5 MB; escaping paths and symlinks are rejected. |
| Mathematics | Inline and block TeX rendered as PNG by MathJax and resvg WASM on the daemon, with bundled Japanese fonts. |
| Mermaid | A subset of flowcharts and sequence diagrams, with zoom, pan, fit-to-view, and diagram/source popups. |

Standalone HTML canvases, GitHub mention notifications, issue-reference expansion, and commit-data previews are outside scope. Source view preserves the original Markdown and does not provide syntax highlighting. External images are fetched by the viewing client and can contact third-party hosts.

### Mermaid limitations

Flowcharts support TD/TB/BT/LR/RL directions, selected node shapes, labeled connections, and solid/dashed/thick lines. Sequence diagrams support participants, actors, messages, self-messages, and selected notes. Write one declaration or connection per line.

**Full Mermaid syntax is not supported.** Unsupported constructs include `subgraph`, `style`, `classDef`, `click`, configuration directives, and sequence blocks such as `loop`, `alt`, and `activate`. Unsupported syntax produces an explanation and the original source instead of a partial diagram.

Zoom up to 400%, drag to pan, or pinch with two fingers. Electron/Web also supports mouse-wheel zoom inside the drawing area. Input and layout limits bound rendering work; see the [diagram model](shared/mermaid/model.ts) and [UI guidance](docs/ui.md).

## MCP tools

The server derives agent/workspace identity from the credential. Tools cannot select another workspace or impersonate an editor through their arguments.

| Tool | Main arguments | Purpose |
| --- | --- | --- |
| `canvas.list` | None | List canvases and editing state. |
| `canvas.get` | `canvasId` | Read content, revision, and editing state. |
| `canvas.create` | `title`, `content` | Create a persistent GFM document. |
| `lock.acquire` | `canvasId` | Acquire an exclusive five-minute edit lease. |
| `lock.renew` | `canvasId`, `lockToken` | Extend the current lease. |
| `canvas.update` | `canvasId`, `lockToken`, `expectedRevision`, `title` and/or `content` | Save changes. |
| `lock.release` | `canvasId`, `lockToken` | Release the current lease. |
| `canvas.delete` | `canvasId`, `lockToken`, `expectedRevision` | Permanently delete a canvas and its reviews. |
| `canvas.review.list` | `canvasId` | List review threads and tracked targets. |
| `canvas.review.get` | `canvasId`, `threadId` | Read a thread, its current revision and request. |
| `canvas.review.reply` | `canvasId`, `threadId`, `expectedRevision`, `requestId`, `kind`, `body`, `documentRevision?` | Post a question, explanation or applied report as the assigned agent. |

For an edit, read the canvas, acquire its lock, update using the current revision and returned `lockToken`, then release the lock. Renew before the five-minute lease expires. On a conflict, read the current state again; there is no automatic merge or unconditional overwrite.

The public lock ID differs from the secret `lockToken`. List/get expose the owner and lease timestamps but never the secret. Lock changes do not increment the document revision. Reads remain available during editing.

### Save results and Mermaid diagnostics

`canvas.create` and `canvas.update` return `canvasId`, `revision`, and `saved: true` after a successful write. Rendering diagnostics are advisory: unsupported Mermaid is saved so the agent can fix it with a subsequent locked update using the returned revision.

- `diagnosticsStatus`: `complete` or `failed`. A completed check uses the same Markdown grammar and Mermaid model as the preview, including its input/layout limits.
- `diagnostics`: entries with `code: "MERMAID_NOT_RENDERABLE"`, `severity: "warning"`, a one-based Mermaid `block` number, one-based document `line`/`endLine`, a `source` excerpt, `message`, and `hint`.
- `diagnosticCount` and `diagnosticsTruncated`: total count and whether the response omits entries. At most 32 entries and 500 source characters per entry are returned. These fields accompany completed diagnostics.
- `timeline`: `queued` or `failed`, describing notification scheduling rather than delivery confirmation.
- `warnings`: operational failures such as `DIAGNOSTICS_FAILED` or `TIMELINE_QUEUE_FAILED`. These do not undo the saved document. Do not repeat `canvas.create` to retry a notification.

Title-only updates diagnose the retained content. Failed authorization, locking, revision checks, or writes do not produce successful-save notifications. Ordinary assistant Markdown messages are not rewritten.

## Reviews

On desktop and mobile, choose **Comment mode**, then click or tap paragraphs, headings, whole tables, diagrams, lists or other document blocks. Selected elements show a background, border and checkmark; clicking or tapping again deselects them. With one or more elements selected, use the floating speech-bubble **Add comment** button at the bottom right to write **one comment for the selected set**. The button has no count. Preview and Code use the same selection units. **Cancel selection** leaves selection mode. Links and diagram controls retain their normal behavior outside selection mode. The editor opens immediately after the last selected element and scrolls together with the document. A speech-bubble header, tinted background, accent border and surrounding space distinguish the comment card from the document. It does not repeat the selected quotations. Toggle a thread open or closed using its comment icon beside a target; replies and edits appear there too. Closing keeps reply and edit drafts. Only one editor or discussion is open at a time. Closing a new comment with **×** returns to **Comment mode**, keeping the selected elements and draft; **Add comment** opens it again. Closing an existing discussion keeps its reply and edit drafts. **Resume comment** restores an unfinished new comment when browsing other discussions. Explicit **Cancel** discards the current draft.

**Comments** switches to a management overview with the same speech-bubble headers, tinted cards and accent borders as inline discussions, for thread selection and resolution. **Back to document** restores the reading position; **Go to target** returns to the document and opens the discussion at that target. Outdated threads remain readable in the overview and can be reattached. Comment creation, reading, replies and edits stay inline, without a side rail or bottom split. Drafts survive switching discussions, the overview, Preview/Code and window sizes.

On mobile, the document accounts for the keyboard's position. Focusing an editor scrolls its input and save actions into view. Input height grows from three to six lines (less in a short landscape viewport), then scrolls internally. Manual document scrolling is not repeatedly overridden while typing.

Save comments first, then use **Select for sending** on their cards in either the document or **Comments** overview. The selection is shared across both views. To send just one comment, use **Send** beside **Select for sending** on that card; other selected comments are not included. While comments are selected, a floating **Send to agent** button stays at the bottom right. It opens a modal showing the selected comment numbers and an **Agent session** picker; choose the recipient and press **Send**. Dismissing the modal keeps the selection and drafts. Successful sending clears the sent selection and shows a confirmation. Errors stay in the modal; failed or uncertain requests can be retried there explicitly. During **Comment mode** target selection, the floating action is **Add comment**; the sending selection is retained when leaving that mode. Saving a comment or reply does not send a prompt. Only sessions in the same workspace with active Canvas MCP are offered. Choices show the current Paseo tab title followed by the provider and model display names, including custom providers. Use the refresh icon beside **Agent session** to pick up renamed sessions or model changes. Sending to a running agent can interrupt it; pending permissions must be handled in Paseo first.

Agents ask questions and report changes with `canvas.review.reply`; users **Resolve** or **Reopen** threads. Unsent messages can be edited or deleted. Once a request is sending, accepted or has an unknown result, corrections are made as new replies. Existing document locks continue to govern edits.

Unchanged selections follow document edits only when their location is unambiguous. Otherwise the thread shows **Outdated** and retains the original quote. Use **Reattach** to choose a new target. An unknown send outcome is never retried automatically; a manual retry can send twice if Paseo restarted.

Reviews use schemaVersion 2. This unreleased change does not read or migrate version 1 review data; invalid review JSON or schemas are ignored without changing files on read; saving a new comment replaces the state with version 2.

See [review storage and delivery](docs/review-storage.md) for the JSON schema, immutable Markdown snapshots, recovery rules and MCP tools.

## Storage

Data lives on the **Paseo daemon host**, outside the project directory.

| Host OS | Data root |
| --- | --- |
| Linux | `$XDG_DATA_HOME/paseo-canvas` when `XDG_DATA_HOME` is absolute; otherwise `~/.local/share/paseo-canvas`. |
| macOS | `~/Library/Application Support/paseo-canvas`. |
| Windows | `%LOCALAPPDATA%\paseo-canvas`. See [validation status](#validation-status). |

```text
<data-root>/hosts/<host-key>/
├── mcp.json
├── activity/
│   └── <canvas-id>-<revision>.json
└── <workspace-id>/
    ├── <canvas-id>.md
    └── reviews/<canvas-id>/
        ├── state.json
        └── snapshots/<revision>.md
```

The host key is a SHA-256 hash of the canonical `PASEO_HOME` path, defaulting to `~/.paseo`. Moving that home requires migrating the associated documents and `mcp.json` together.

Markdown files store identity, revision, timestamps, and attribution in YAML frontmatter; APIs and source view expose the body without this metadata. Writes require a temporary file, synchronization, atomic replacement, and directory synchronization. Corrupt data and uncertain durable writes produce errors instead of empty replacement documents.

A `proper-lockfile` lease gives one plugin process ownership of the storage area. After a crash, the owner lease becomes stale after 30 seconds; startup waits for recovery. Local disks are the storage model. Concurrent external editing and network shares are unsupported.

Documents survive plugin/daemon restarts and workspace archival. **Edit leases are memory-only and expire on restart.** MCP bindings are persisted separately.

`activity/` contains undelivered timeline notifications with canvas identity, title, revision, warning count and agent identity, but no Markdown body or credentials. Files use mode `0600` and are removed after Paseo acknowledges the append or the row is found in canonical history. This reconciliation avoids replaying a row after a lost response, but the API does not provide an atomic, exactly-once append. Canvas commit and notification enqueue are separate writes; a crash between them can leave a saved canvas without a timeline notification.

## MCP connection and access

The public `agent.create` hook adds Canvas to Paseo's per-agent MCP configuration. The first interactive `agent.session_open` binds the registration to authoritative agent/workspace IDs and removes the temporary registration environment variable before provider launch. Global and project-level agent configuration files are not changed.

MCP listens only on `127.0.0.1`. Its initially allocated port is saved and reused after restart. Paseo's agent configuration stores the raw bearer token; the plugin's `mcp.json` stores its hash, identity binding, and active state with mode `0600`. Authorization writes are synchronized; persistence failures make access unavailable.

Archiving disables the binding. Resuming a registered interactive agent reactivates it with a new edit-session ID. History-only openings do not issue or reactivate credentials, although Paseo may still pass the saved descriptor to the history provider. Unauthenticated, inactive, and browser-Origin requests are rejected.

Normal launches outside Paseo receive no automatic Canvas registration. This is not isolation from code running as the same OS user that deliberately copies credentials.

### Troubleshooting

| Symptom | What to check |
| --- | --- |
| Canvas tools are missing | Create a new agent after installation, confirm plugins are enabled, and check provider support for HTTP MCP. |
| Saved MCP port is occupied | Resolve the conflict on the daemon host. The plugin fails instead of changing the URL stored in existing agents. |
| MCP is unavailable after plugin removal/disable | Existing agents retain their descriptors. Re-enable the plugin, or create an agent while it is disabled. |
| Storage or authorization fails | Inspect `paseo plugin logs paseo-canvas`. Check ownership, disk access, and file integrity; corrupt state is not silently reset. |
| A diagram cannot be displayed | Read the unsupported-syntax explanation and inspect the source; only a Mermaid subset is supported. |

## Development

| Area | Responsibility |
| --- | --- |
| `index.client.tsx`, `client/` | Workspace panel, native-compatible views, interactions, and query invalidation. |
| `index.server.ts`, `server/` | Lifecycle hooks, MCP, persistence, Markdown parsing, and math/image processing. |
| `shared/` | Validated contracts, document structures, and Mermaid parsing/layout. |
| `tests/` | Storage, protocol, UI/rendering, recovery, and host-integration checks. |
| `tests/visual/` | Sample-data browser fixture with replacement host services. |

The UI uses public Paseo components and `paseo-plugin-helper` pinned to **v0.4.0-beta.7**. Markdown is parsed and sanitized on the daemon with unified/remark/rehype and sent to the client as a validated structure. Mermaid code is vendored from `paseo-plugin-mermaid`; see its [provenance and modifications](third-party/paseo-plugin-mermaid/README.md). MathJax, resvg, and [bundled fonts](server/assets/README.md) remain on the daemon. Product rendering requires no Chromium, WebView, or additional native module.

```sh
npm run check          # Generate assets, typecheck, and run tests
npm run visual:build   # Build the sample-data browser fixture
npm run visual:serve   # Serve it at http://127.0.0.1:49618
```

The visual fixture replaces host RPC, modal, toast, and clipboard integration. It is not a running Paseo installation.

For native JavaScript execution, use the Hermes executable distributed with React Native **0.81.5** (the version used by Paseo 0.8.0):

```sh
npm run test:native -- /absolute/path/to/hermes
```

This check compiles the production client with Paseo's release compiler and evaluates it in Hermes. It covers startup, registration, selection, Mermaid layouts and diagnostics, and cleanup. Host UI/RPC/schema services are stubbed; it does not verify native rendering. The runtime is a development-only prerequisite, not a plugin dependency. Keep client/shared code compatible with Hermes source evaluation: Paseo's compiler leaves classes in the bundle, and constructing them through this path fails.

### Validation status

Checks performed on macOS with Node.js 22 include:

- Automated storage, corruption, locking, workspace isolation, HTTP MCP, rendering, and automatic-update tests.
- Review tests cover durable snapshots, source tracking, stale edits, assignment, explicit dispatch and unknown send results. Web, Android and iOS component tests cover semantic multi-selection, last-selected placement, one inline discussion, overview navigation, zero-width hidden tabs, badge toggling, independent single-comment dispatch and draft retention across view changes. Keyboard geometry tests cover revealing both the input and actions without overriding later manual scrolling, overlapping asynchronous measurements and cancellation of stale results.
- The browser fixture uses temporary storage for desktop/430px selection, inline creation, overview navigation, replies and edits. The installed Paseo plugin was reloaded successfully and inline editor placement was checked in Electron. Browser height reduction verified that a focused editor and its save action remain visible; this does not replace native IME verification. Physical Android/iOS IME and gesture checks remain unverified.
- Unmodified Paseo 0.8.0 compilation, hook validation, `AgentManager`, and a custom provider fixture exercising stored-agent resume after normal exit and forced process termination.
- Before review tools were added, the production bundle with real Codex 0.154.0: eight-tool discovery in two agents, HTTP sharing/lock conflicts, plugin-restart recovery, and no Canvas registration in a separate launch using the same isolated home. No LLM prompt was sent.
- Hermes from React Native 0.81.5 executing the release-compiled client and shared-code probes with stubbed host services.
- Desktop/390px browser layouts and light/dark themes. Mocked native checks do not establish real-device behavior.

> [!NOTE]
> Physical iOS/Android devices, Claude/OpenCode runtime connections, external native resume of the same conversation, and end-to-end operation in the user's installed Paseo app remain unverified. Linux/Windows storage durability is also unverified; Windows environments without directory synchronization support fail rather than silently weaken durability.

See the [architecture decisions](docs/adr/README.md) for design rationale and [UI guidance](docs/ui.md) for detailed visual rules. The ADRs are in English; UI guidance is currently in Japanese.

## Acknowledgments

Thank you to the authors and contributors of these projects:

- [paseo-plugin-helper](https://github.com/xpufx/paseo-plugin-helper) provides the reusable UI components and plugin utilities used throughout paseo-canvas.
- [paseo-plugin-mermaid](https://github.com/dutchakdev/paseo-plugin-mermaid) provides the foundation for our native-compatible Mermaid rendering. Its parser, layout, and drawing code has been adapted for Canvas; see the [source attribution and modifications](third-party/paseo-plugin-mermaid/README.md).
