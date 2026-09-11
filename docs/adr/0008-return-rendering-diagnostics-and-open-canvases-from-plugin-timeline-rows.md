---
number: 8
title: Return rendering diagnostics and open canvases from plugin timeline rows
status: accepted
date: 2026-09-11
links:
- target: 4
  kind: RelatesTo
- target: 6
  kind: RelatesTo
---

# Return rendering diagnostics and open canvases from plugin timeline rows

## Context and Problem Statement

Agents need actionable feedback when saved Markdown uses Mermaid syntax that the native-compatible renderer cannot display. Users also need to open the exact saved canvas from the editing session's timeline without first navigating its workspace list. Both features must work through the released Paseo 0.8.0 plugin APIs, without modifying Paseo or installing native modules.

## Decision Drivers

* Match diagnostics to the actual preview and the exact saved revision.
* Keep successful writes distinct from rendering and notification failures.
* Open a canvas whether its panel is mounted or closed, on desktop and mobile.
* Work across HTTP-MCP-capable providers without parsing provider-specific tool names or message formats.
* Respect the public SDK's context lifetime and actual timeline durability limits.

## Considered Options

* Put custom deep links in ordinary assistant Markdown.
* Replace whole assistant/tool timeline entries through a transformer.
* Append dedicated plugin timeline rows and use public panel navigation.

## Decision Outcome

Chosen option: "Append dedicated plugin timeline rows and use public panel navigation", because the released SDK exposes both operations and the action can be implemented with public React Native primitives and helper controls. It does not expose registration of a custom link protocol for ordinary assistant Markdown.

After each successful MCP create/update, diagnose the saved snapshot returned by the serialized store operation. Share the preview's Markdown grammar and Mermaid model. Return warning entries with block and document line numbers, bounded source excerpts, error messages and repair hints. Keep the document saved when the renderer rejects a diagram. Unexpected diagnostic failures are explicit operational warnings, not empty successful diagnostics.

Persist a small pending activity record separately from the canvas, including the bound editing agent/workspace, canvas ID, title, revision and warning count. Return `saved: true` and the saved revision even if notification enqueue fails, so agents do not repeat an already committed creation. The queue is owned by the existing storage process lease and contains no canvas body or MCP credential.

The plugin server entry has no global `paseo` handle. Public RPC handler contexts do have one. A client-installation-level long poll invokes a server RPC that drains pending records with `context.paseo.agents.ref(agentId).timeline.append`. This works independently of the Canvas panel and after plugin reload, without retaining an old lifecycle callback context. Mobile background state suspends new requests; an active connected client resumes delivery. Idle requests expire before the SDK timeout and failures use bounded retry backoff.

Serialize delivery across clients. Before append, search canonical timeline pages for the plugin's deterministic canvas/revision ID. This reconciles a prior append whose response was lost: the stock API itself does not deduplicate IDs. Remove the queued record only after acknowledgment or a matching existing row. Failure for one agent must not prevent trying other pending rows.

Register a versioned, schema-validated timeline renderer with an Open canvas button. Share an in-memory selection store between that renderer and the workspace panel, isolated per plugin installation and workspace. Set the target selection before calling `openPanel`; subscribe to changes when the panel is already mounted. The button opens current saved content rather than a historical revision. Deleted targets use the existing deletion state.

### Consequences

* Good, because agents receive repair information for the same unsupported syntax users see, without losing saved content.
* Good, because navigation uses public APIs and native-compatible controls without rewriting assistant text.
* Good, because pending notifications survive plugin/daemon restarts and disconnected clients.
* Bad, because delivery requires an active client with the plugin loaded and access to the target agent timeline.
* Bad, because document commit and notification enqueue are separate durable operations. An abrupt crash between them can omit a notification for an otherwise saved canvas.
* Bad, because public append lacks an atomic idempotency contract. History reconciliation reduces duplicates but cannot promise exactly-once delivery under all timeout/race conditions.
* Bad, because stock Paseo 0.8.0 does not wire a durable store for appended plugin rows. Already acknowledged rows disappear when the daemon loses its in-memory timeline; they are not retained in the plugin queue for replay. Canvas documents themselves remain persistent.

### Confirmation

`tests/diagnostics.test.ts` checks line mapping, nested fences, Markdown grammar, renderer parity and bounded results. `tests/mcp.test.ts` exercises real HTTP saves, title-only edits, repaired content, lock/revision errors and enqueue failure without reporting a failed write. `tests/activity.test.ts` checks queue restart recovery, concurrent clients, failed delivery, canonical-history reconciliation and pagination. `tests/ui.test.tsx` checks registered renderer/panel navigation, mounted and unmounted selection, workspace isolation, deleted targets, background suspension and cleanup.

`tests/bundle.test.ts` compiles both entries with stock Paseo 0.8.0 and invokes the real AgentManager through a fixture RPC context, verifying pending notification delivery after restart and the host's loss of already delivered rows after daemon restart. The context adapter is a test double; this is not end-to-end verification of the installed app's RPC transport. Browser fixtures validate desktop and compact presentation; physical mobile devices remain unverified.

## Pros and Cons of the Options

### Dedicated plugin rows

* Good, because renderer registration and panel navigation are public desktop/mobile contracts.
* Good, because the plugin controls stable identity and schema without depending on a provider's output format.
* Bad, because delivery needs a handler context and the host owns the displayed timeline's lifecycle.

### Custom deep links in assistant Markdown

* Good, because the action could be embedded in normal prose.
* Bad, because the targeted SDK cannot register a plugin URL scheme/handler with the ordinary Markdown renderer. An external URL does not supply the required in-app behavior.

### Replace assistant/tool entries

* Good, because the action could occupy an existing timeline position.
* Bad, because a transformer replaces the whole entry and would make the plugin responsible for ordinary message rendering or provider-specific tool matching. Dedicated rows avoid that coupling.

## More Information

This extends the public-native-UI and Mermaid-subset decisions in ADRs 4 and 6. Revisit notification delivery if Paseo exposes a server-entry-level API context, atomic idempotent append, or durable plugin timeline history. Do not claim those capabilities based only on optional internal constructor arguments.
