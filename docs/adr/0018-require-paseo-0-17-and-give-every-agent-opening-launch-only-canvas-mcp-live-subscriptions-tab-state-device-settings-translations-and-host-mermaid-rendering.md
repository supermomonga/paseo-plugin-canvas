---
number: 18
title: Require Paseo 0.17 and give every agent opening launch-only Canvas MCP, live subscriptions, tab state, device settings, translations and host Mermaid rendering
status: accepted
date: 2026-11-23
links:
- target: 7
  kind: supersedes
- target: 3
  kind: amends
- target: 4
  kind: amends
- target: 6
  kind: amends
- target: 8
  kind: amends
- target: 13
  kind: amends
- target: 15
  kind: amends
- target: 19
  kind: amendedby
---

# Require Paseo 0.17 and give every agent opening launch-only Canvas MCP, live subscriptions, tab state, device settings, translations and host Mermaid rendering

## Context and Problem Statement

Canvas required Paseo 0.12 and its plugin SDK. The user asked to support the latest Paseo (0.17.3 at the time) and to redesign the feature set around the current plugin API: drop workarounds for 0.12 limits, resolve the compromises that earlier ADRs accepted, and adopt capabilities that newer releases added.

Comparing the released SDK and public documentation of 0.12.0 and 0.17.3 rechecked the revisit conditions of earlier decisions:

* ADR 3: `agent.open.before` (0.14) lets a plugin add launch-only MCP servers on every interactive opening, including resumes, imports and refreshes. Plugins can also attach agent tools with `defineAgentTool`.
* ADR 7: plugin subscriptions (`defineSubscription`, `useSubscription`, `client.subscribe`, 0.16) push events from a handler to a client and resubscribe after a reconnect.
* ADR 8: appending a plugin timeline row with an existing `id` replaces that row, so a retry cannot duplicate it. Hooks receive the same `paseo` API as handlers; it belongs to the plugin subprocess and closes when the plugin stops, so server code can deliver rows without a connected app. Appended rows are still held in the daemon's memory only.
* ADR 13: `tab.setModified` (0.13) shows an unsaved mark and asks before closing a workspace tab; `useTabState` persists per-tab state.
* ADR 15: settings documents can be `scope: "device"`; the workspace tab launcher lists plugin panels on phones too, so the native header button is no longer needed; navigation supports `focusHost` (0.17.1).
* ADR 4 and 6: plugin translations follow the app language (0.13, Japanese is an app language), and the public `Markdown` component renders Mermaid with Paseo's own diagram runtime on web, iOS and Android.

The hook registration names changed (`server.addHook("agent.open.before", …)` replaces `server.before("agent.session_open", …)`), and the 0.12 panel `context` prop and `/client/react-native` import path are deprecated.

The user chose English and Japanese for the interface, and chose to adopt full Mermaid display, a composer attachment source and a `/canvas` slash command. The user declined workspace row badges.

## Decision Drivers

* Every Canvas capability works with an unmodified, released Paseo and only public SDK APIs.
* Agents get Canvas without depending on optional Paseo settings, and Canvas never prevents an agent from opening.
* Agents created by Canvas 0.3 or earlier keep working without a second, duplicate server.
* Credentials are not stored in Paseo's agent records.
* Readers see other sessions' changes promptly and recover after reconnects and restarts.
* Tests compile and run against the SDK the manifest requires.

## Considered Options

* Require Paseo 0.17 and add a launch-only Canvas MCP server in `agent.open.before`.
* Require Paseo 0.17 and expose Canvas as plugin agent tools (`defineAgentTool`).
* Require Paseo 0.17 but keep saving the MCP descriptor in `agent.create.before`.

## Decision Outcome

Chosen option: "Require Paseo 0.17 and add a launch-only Canvas MCP server in `agent.open.before`", because it gives Canvas to every agent, including existing and imported ones, without storing credentials in agent records and without depending on whether Paseo's own tools reach the agent.

**Version.** The manifest requires `>=0.17.1`, the first 0.17 release in Paseo's changelog. Development dependencies, the bundle test and the package check use 0.17.3; between 0.17.1 and 0.17.3 the plugin SDK changed only provider, ACP and usage modules, which Canvas does not use. React and React Native development versions follow the 0.17.3 app (19.2.3 and 0.86.3).

**Agent access.** `agent.open.before` adds a server named `paseo_canvas` to every interactive opening that has a workspace, including background agents. Each opening receives a new random bearer token bound to that agent, workspace and a new edit-session ID; `mcp.json` (now version 2) stores only its SHA-256 hash, and reopening replaces the previous credential. History openings and agents without a workspace get nothing. `agent.create.before` no longer changes saved configuration, so a removed plugin leaves no descriptor behind.

Agents created by Canvas 0.3 or earlier have a `paseo-canvas` descriptor in their saved configuration. Version 1 bindings are migrated as saved bindings: while the endpoint keeps the saved port, such an agent is reactivated on each opening and gets no launch-only server, so it never sees duplicate tools. The port stays stable across plugin restarts so running sessions keep their address. A taken port no longer fails initialization: the endpoint moves to a free port, and agents whose saved descriptor points at the old port receive launch-only credentials instead.

The hook never fails an opening: when storage and the credential are not ready within 20 seconds (Paseo fails a hook after 30), or binding fails, the agent opens without Canvas and the reason is logged. Once Canvas is ready, such an agent is reloaded if it is idle; a busy agent is not interrupted and gets Canvas at its next opening. Providers that reject MCP servers fail the opening with Paseo's own error naming the plugin; every built-in provider of 0.17.3 accepts them.

Every visible, unarchived agent of the workspace is a review recipient: a session opened before the plugin started reopens before its next prompt, and that opening adds Canvas. Recipient discovery no longer consults Canvas registrations.

**Live updates.** The `canvas.watch` subscription replaces `canvas.wait_for_change`. Its handler sends the workspace's current cursor and then one cursor per committed or lock change; cursors still include a per-process epoch. The client reads once per new cursor, retries failed reads with bounded backoff, and Paseo resubscribes after reconnects. This supersedes ADR 7.

**Timeline notifications.** The plugin process has one daemon session, handed to every hook and handler. The activity queue keeps the session it last received, which an agent's own opening hook always provides, and delivers a save at once, while the agent is still working and with no app connected. Failed appends, such as for an agent that is not loaded, are retried with backoff and again when a turn ends. The durable queue stays; history reconciliation is removed because re-appending the same row ID replaces the row. Pending rows of archived agents, and rows older than seven days, are dropped. Delivered rows still disappear when the daemon restarts.

**Panels and settings.** The workspace panel registers without the deprecated `context`, stores the selected canvas and list layout with `useTabState`, and marks the tab modified while a draft differs from the saved canvas. The native header button is removed. Timeline notifications stay a host setting (version 2, migrated from version 1); the link target becomes the `canvas-device` settings document of each device, starting from its default. `/canvas [title]` opens the panel at the best title match; the composer attachment source `canvas` searches the host's canvases and attaches a complete text snapshot.

**Translations.** Interface text lives in `client/i18n/` with English and Japanese resources; registrations use `messages.message()`. Agent-facing text (MCP descriptions and results, review prompts, attachment snapshots) stays English.

**Mermaid.** Diagrams inside Canvas's subset keep the interactive renderer. Others are passed to the SDK `Markdown` component as a Mermaid fence, so Paseo's renderer displays them instead of an error. Saves report such blocks as `info` diagnostics (`MERMAID_STANDARD_RENDERER`) instead of warnings, because Canvas cannot validate that syntax. The canvas body still uses Canvas's own renderer, which provides block selection for reviews and mathematics.

### Consequences

* Good, because existing and imported agents receive Canvas, and no Canvas credential is saved in Paseo's agent records.
* Good, because Canvas cannot block an agent from opening, and a taken port no longer stops the plugin.
* Good, because changes arrive by push without outstanding RPCs, and notifications reach timelines as soon as an agent saves, without an open app.
* Good, because closing a tab with unsaved edits asks first, and the panel reopens where the reader left it.
* Good, because every Mermaid diagram is displayed, and the interface follows English or Japanese app settings.
* Bad, because Paseo 0.12 to 0.16 users must update both the daemon and the app; earlier npm releases remain installable.
* Bad, because a custom provider that rejects MCP servers fails to open while Canvas is enabled.
* Bad, because a running session keeps its old address after the port moves, until Paseo reopens it.
* Bad, because diagrams outside the subset lose Canvas's zoom controls and cannot be validated by Canvas.
* Bad, because each device starts with the default link target; the version 1 host value is not carried over.
* Bad, because `mcp.json` becomes version 2, which Canvas 0.3 refuses to read; downgrading requires removing that file, which disconnects agents created by Canvas 0.3.
* Bad, because translations must be maintained, and server texts without codes are matched by exact English wording.

### Confirmation

`tests/bundle.test.ts` compiles both entries with the 0.17.3 compiler and runs the server bundle inside the stock 0.17.3 `AgentManager` and `PluginHookHandlers`: the provider receives `paseo_canvas` while the saved configuration keeps only its own servers, history and detached openings get none, the watch subscription reports a save, the save's row reaches the timeline at once, a resumed agent gets a new credential while the old one returns 401, and closing the agent releases its lease. `tests/daemon.e2e.test.ts` installs this directory into a real 0.17.3 daemon (`createTestPaseoDaemon`) with plugins enabled: an agent created before installation gets Canvas when it reopens, a new agent gets it at launch without it being saved, and a save during a turn produces the timeline row with no app connected. `tests/server-entry.test.ts` checks that slow or failed storage lets agents open without Canvas, and that idle ones are reloaded once Canvas is ready. `tests/sessions.test.ts` covers rotation, hash-only persistence, version 1 migration, saved descriptors and the port move. `tests/activity.test.ts`, `tests/changes.test.ts`, `tests/updates.test.tsx`, `tests/attachments.test.ts`, `tests/diagnostics.test.ts`, `tests/settings.test.ts` and `tests/review-dispatch*.test.ts` cover the other changes, and `tests/ui.test.tsx` covers registrations, tab state, the close prompt, `/canvas`, the Mermaid fallback and Japanese text. The production client bundle compiles with `hermesc` from React Native 0.86.3; it was not run on a Hermes VM or a physical device, and the real Paseo app was not exercised.

## Pros and Cons of the Options

### Launch-only MCP server in `agent.open.before`

* Good, because it reaches every interactive opening regardless of Paseo's tool-injection setting.
* Good, because agents keep their tool names and MCP instructions.
* Bad, because Canvas still runs a loopback HTTP server and keeps a credential registry.

### Plugin agent tools

* Good, because Paseo would carry the tools and the agent identity, with no HTTP server or credentials.
* Bad, because Paseo delivers plugin tools only through its own tool transport, which reaches agents only when `daemon.mcp.injectIntoAgents` is on (off by default) and the provider's `paseoTools` policy allows them.

### Saved descriptor in `agent.create.before`

* Good, because it keeps the 0.3 behavior unchanged.
* Bad, because existing and imported agents still get no Canvas, credentials stay in agent records, and removing the plugin leaves dead descriptors.

## More Information

This supersedes ADR 7 and amends ADRs 3, 4, 6, 8, 13 and 15. See [server entry](../../index.server.ts), [credential registry](../../server/sessions.ts), [activity queue](../../server/activity.ts), [change coordinator](../../server/changes.ts), [client entry](../../index.client.tsx), [translations](../../client/i18n/index.ts) and [UI guidance](../ui.md). Revisit agent tools if Paseo delivers plugin tools independently of its own tool injection; revisit notification delivery if Paseo persists appended plugin rows or gives the server entry its own `paseo`.
