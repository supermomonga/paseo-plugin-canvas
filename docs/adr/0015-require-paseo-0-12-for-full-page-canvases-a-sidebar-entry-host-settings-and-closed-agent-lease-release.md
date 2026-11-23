---
number: 15
title: Require Paseo 0.12 for full-page canvases, a sidebar entry, host settings and closed-agent lease release
status: accepted
date: 2026-10-20
links:
- target: 2
  kind: amends
- target: 8
  kind: amends
- target: 4
  kind: relatesto
- target: 18
  kind: amendedby
---

# Require Paseo 0.12 for full-page canvases, a sidebar entry, host settings and closed-agent lease release

## Context and Problem Statement

Canvas targeted the Paseo 0.8.0 plugin SDK. Comparing the released `@getpaseo/plugin` type definitions from 0.8.0 to 0.12.0 showed new public APIs: screens opened with URL parameters, sidebar header and footer items with popovers and the `agent.closed` lifecycle event (0.11), and a server handle for host-scoped settings, `openExternalUrl` / `ExternalLink`, the Electron-only `navigation.openBrowser`, `useHosts` and `serverId` in navigation (0.9). The user asked to raise the minimum to Paseo 0.12 and adopt them.

The same comparison rechecked the revisit conditions of earlier decisions. Paseo 0.12.0 still has no plugin push API (ADR 7), no idempotent append or durable store for plugin timeline rows (ADR 8), no runtime MCP injection for existing agents (ADR 3), no panel-close veto or human identity (ADR 13), no compiler support for package `#imports` outside the plugin (ADR 14), and no public WebView or Markdown/Mermaid renderer (ADRs 4 and 6). Those decisions stay as they are.

## Decision Drivers

* Users can reach a canvas without first opening its workspace, and a reload or back navigation keeps the canvas.
* An agent whose runtime closed does not block other editors for the rest of its five-minute lease.
* Users choose whether agent saves notify the timeline and where document links open, without code changes.
* Only released, public SDK APIs; tests compile and run against the SDK version the manifest requires.

## Considered Options

* Require Paseo 0.12 and adopt the new APIs directly.
* Keep `>=0.8.0` and detect the new APIs at runtime.
* Keep `>=0.8.0` without the new APIs.

## Decision Outcome

Chosen option: "Require Paseo 0.12 and adopt the new APIs directly", because the user asked for 0.12 and every adopted API exists in it. Runtime detection would leave each capability untested on the older hosts it is meant to support.

**Version.** The manifest requires `>=0.12.0`. The SDK development dependencies, the bundle test and the npm package check use 0.12.0. The React 19.1 and React Native 0.81.5 peer requirements did not change.

**Closed agents.** On `agent.closed` and `agent.archived`, the server releases every lease held by that agent and publishes the change. Reopening an agent already assigns a new edit session (ADR 3), so its old lock tokens could never be used again; waiting for expiry only blocked others. User leases are unaffected. This amends ADR 2: a live but unresponsive agent still holds its lease until expiry.

**Full-page screen.** The `canvas` screen takes `{ workspaceId, canvasId? }` as parameters and reuses the panel's list and document views with its own selection and editor, so it never takes over the panel's draft confirmation. A bar names the workspace, opens it with `navigation.openWorkspace` and the screen's `serverId`, and shows a connection notice from `useHosts` while the host is not online. The workspace panel gets **Open in full screen**. The timeline row's **Open canvas** still opens the workspace panel (ADR 8).

**Sidebar.** One `Canvas` header item renders a `SidebarRow`. Its popover lists the ten most recently updated canvases across the host's active workspaces and opens one on the screen. The `canvas.recent` RPC lists workspaces through the handler's Paseo API, so archived workspaces are excluded, and merges the store's per-workspace listings. An unreadable workspace is skipped and logged; an unavailable store fails the request.

**Settings.** A host-scoped `canvas` settings document (version 1) holds `timelineNotifications` (default on) and `openLinksIn` (`workspace-browser` by default, or `system`). The server reads it and follows saves through the settings handle; invalid or unreadable documents fall back to the defaults. When notifications are off, MCP saves return `timeline: "disabled"` and enqueue nothing. This amends ADR 8. A settings screen uses the SDK settings components and an `ExternalLink` to the documentation, and a global Command Center item opens it.

**Links.** Document links go through a link opener supplied by the panel. HTTP(S) links open in a workspace browser tab when the preference allows it and `navigation.openBrowser` exists, otherwise through `openExternalUrl`. `mailto:` links keep using the operating system handler, which `openExternalUrl` ignores.

`getPaseoClient` is not used. Canvas data is reachable only through the plugin RPC of the host that stores it, the borrowed SDK cannot call plugin RPCs, and Paseo's host picker already selects the host for screens and sidebar items.

### Consequences

* Good, because canvases are reachable from the sidebar, and the screen address survives reloads and back navigation.
* Good, because another editor can take a closed agent's canvas immediately.
* Good, because timeline notifications and link handling are configurable for every client of a host.
* Bad, because Paseo 0.8 to 0.11 users must update both the daemon and the app before updating Canvas; earlier npm releases remain installable for them.
* Bad, because each popover opening reads the metadata of every canvas in all active workspaces.
* Bad, because the link preference is shared by every device connected to the host; the SDK offers no per-device settings.
* Neutral, because the default now opens document links in the desktop app's workspace browser instead of the system browser.

### Confirmation

`tests/bundle.test.ts` closes an agent through the stock 0.12.0 `AgentManager` and requires its lease to become unlocked; the test fails when the `agent.closed` handler is removed. `tests/store.test.ts`, `tests/mcp.test.ts`, `tests/recent.test.ts` and `tests/settings.test.ts` cover lease selection, disabled notifications, workspace merging and settings fallback. `tests/ui.test.tsx` covers registrations, the screen, the sidebar popover, the settings screen and link routing with mocked host modules. `npm run test:package` compiles the npm installation with the 0.12.0 compiler. The rendering of the sidebar popover, screen and settings inside the real Paseo app, the Electron workspace browser and mobile sheets remain manual checks.

## Pros and Cons of the Options

### Require Paseo 0.12 and adopt the new APIs directly

* Good, because each feature uses one tested code path.
* Bad, because users of older Paseo releases cannot update Canvas.

### Keep `>=0.8.0` and detect the new APIs at runtime

* Good, because older hosts keep receiving updates.
* Bad, because every capability needs a fallback path that the tests, compiled against one SDK, cannot exercise.

### Keep `>=0.8.0` without the new APIs

* Good, because nothing changes for existing users.
* Bad, because closed agents keep blocking edits and the requested capabilities are unavailable.

## More Information

See [server entry](../../index.server.ts), [client entry](../../index.client.tsx), [lease release](../../server/store.ts), [recent canvases](../../server/recent.ts), [settings watcher](../../server/settings.ts), [screen](../../client/screen.tsx), [sidebar](../../client/sidebar.tsx), [settings screen](../../client/settings.tsx), [link opener](../../client/links.ts) and [UI guidance](../ui.md#サイドバーと全画面表示). Revisit the link preference if Paseo adds per-device settings, and the recent list if listing all canvases becomes slow.
