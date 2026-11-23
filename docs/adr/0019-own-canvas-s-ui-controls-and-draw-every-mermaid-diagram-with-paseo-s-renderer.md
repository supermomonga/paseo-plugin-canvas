---
number: 19
title: Own Canvas's UI controls and draw every Mermaid diagram with Paseo's renderer
status: accepted
date: 2026-11-23
links:
- target: 4
  kind: amends
- target: 6
  kind: amends
- target: 8
  kind: amends
- target: 14
  kind: amends
- target: 18
  kind: amends
---

# Own Canvas's UI controls and draw every Mermaid diagram with Paseo's renderer

## Context and Problem Statement

Canvas depended on two outside code bases. ADR 4 pinned `paseo-plugin-helper` `v0.4.0-beta.7` from the GitHub repository `xpufx/paseo-plugin-helper` for buttons, tabs, badges, code blocks, key/value rows, empty states, a theme provider, an RPC query hook, a host registration step (`initClientHelpers`) and a server logger. ADR 6 vendored the parser, layout and drawing code of `dutchakdev/paseo-plugin-mermaid` to draw a subset of flowcharts and sequence diagrams; ADR 18 sent every other diagram to Paseo's own Mermaid renderer through the SDK `Markdown` component, and save results reported those diagrams as information.

By 2026-11-23 the helper's repository was archived (2026-09-16) and its npm package unpublished (2026-10-13). Development moved into the `xpufx/paseo` monorepo, whose README marks the library deprecated. Its current release, `0.4.0-beta.12`, removed the `paseo-plugin-helper/client` subpath that Canvas imports and tells plugin authors to build such controls from host SDK primitives themselves. npm cannot install a package from a subdirectory of a Git repository. Every npm installation of Canvas still fetched the archived repository from GitHub.

The Paseo 0.17.3 plugin SDK still exports no button, tab, badge, code block, key/value or empty-state component. Its `Markdown` component, however, draws every Mermaid diagram type. Reading Paseo's source at tag `v0.17.3` (`packages/app/src/components/markdown/fence/mermaid/`) showed that this renderer has its own zoom and source view: on Electron and Web, zoom buttons, modifier-key wheel zoom and a full-screen view; on iOS and Android, a preview that opens full screen with pinch zoom up to 8x. It shows a diagram it cannot draw as code.

The user asked to remove the dependency on both libraries, after being told that Canvas would then stop checking Mermaid syntax when agents save.

## Decision Drivers

* Canvas must install and build without archived, unpublished or deprecated packages.
* Only public Paseo SDK and React Native APIs, as in ADR 4.
* Every Mermaid diagram should display, with zoom and source view, on desktop and mobile.
* Less vendored code and fewer attribution duties to maintain.
* Existing look, touch targets and React Query cache keys should not change.

## Considered Options

* Own the controls and draw every diagram with Paseo's renderer.
* Follow `paseo-plugin-helper` to its new location.
* Keep the pinned helper release and the vendored Mermaid subset.

## Decision Outcome

Chosen option: "Own the controls and draw every diagram with Paseo's renderer", because it is the only option that leaves no dependency on an archived or deprecated package. It also follows the guidance of the helper's own successor.

**Controls.** `client/ui.tsx` provides the controls Canvas uses: `Button` (primary and secondary, small and medium), a segmented `Tabs` control, `Badge`, a read-only `CodeBlock` with a language caption, `KeyValue` and `EmptyState`. They are built from React Native views, the SDK `Icon` and the host theme colors. `CanvasThemeProvider` passes the host colors and the compact flag to them and sets the minimum touch target, 44 px on compact panes and on iOS and Android and 28 px elsewhere, as before. Sizes and colors follow the helper controls they replace. Unused helper features, such as copy buttons and scrolling tabs, are not reproduced.

**RPC and logging.** Components call the SDK `useRpc` directly, so `initClientHelpers` is gone. `client/rpc.ts` provides `useRpcQuery` on the SDK `useRpc` and the host's React Query, with the same `[contract.name, input]` key that the update and review caches use. The server writes its start-up, failure and slow-start messages with `console` and the `[paseo-canvas]` prefix, like the rest of the server; the initialization failure now includes its error.

**Dependencies.** `paseo-plugin-helper` and `@tanstack/query-core` are removed. ADR 14 added `@tanstack/query-core` only so that the helper's type declarations resolved. `@tanstack/react-query` remains a module that Paseo provides to plugin clients.

**Mermaid.** Every ` ```mermaid ` block is passed to the SDK `Markdown` component as a fence longer than any backtick run inside the diagram. Canvas adds no header, controls or notes around it. The vendored parser, layout, drawing and viewer code, its tests and `third-party/paseo-plugin-mermaid` are deleted. No code derived from that project remains, so the package no longer publishes `third-party/`. Diagram blocks stay review targets. While a reader selects targets, the block's content does not respond to touches or clicks, so Paseo's diagram controls do not activate.

**Save results.** Canvas no longer parses Mermaid, so `canvas.create` and `canvas.update` no longer return `diagnosticsStatus`, `diagnostics`, `diagnosticCount`, `diagnosticsTruncated` or the `DIAGNOSTICS_FAILED` warning. The MCP instructions tell agents that Canvas does not validate diagrams and that they should check the syntax themselves. Timeline rows keep the version 1 schema with `warningCount: 0`, and the client still shows a count for older rows.

### Consequences

* Good, because installing Canvas no longer fetches an archived GitHub repository, and the packages that came in only through the helper's peer dependencies are now development-only in the lockfile.
* Good, because every Mermaid diagram type is drawn the same way, with Paseo's zoom, full-screen and source views.
* Good, because about 3,200 lines of vendored code, tests and attribution are removed.
* Bad, because Canvas maintains its own controls. They can drift from Paseo's look, and fixes in a shared library no longer arrive.
* Bad, because agents no longer learn about Mermaid syntax errors when they save; readers see a broken diagram as code.
* Bad, because on iOS and Android a diagram can no longer be zoomed inside the document; the reader opens it full screen.
* Bad, because diagram rendering now depends entirely on Paseo's renderer (an iframe on Electron and Web, a WebView on iOS and Android), which Canvas cannot test or adjust.
* Bad, because agents or scripts that read the removed save-result fields no longer get them.

### Confirmation

`tests/ui.test.tsx` renders the panels, review views and media with the new controls. It checks that Mermaid blocks, including syntax the old subset rejected, reach the SDK `Markdown` component as fences without Canvas controls, and that the fence outlasts backtick runs. `tests/mcp.test.ts` and `tests/bundle.test.ts` check save results without diagnostics. `npm run test:package` installs the packed plugin with production dependencies only and compiles both entries with Paseo 0.17.3's compiler.

The visual fixture was checked at 1280 px in the dark theme and 420 px in the light theme: header and toolbar buttons, tabs, the lock badge, details rows, compact touch targets and a LaTeX source block. The fixture's `Markdown` is a stand-in, so Paseo's Mermaid rendering was confirmed only by reading its source at `v0.17.3`, not in the app. `tests/native-smoke.mjs` was updated but not run, because it needs a Hermes executable.

## Pros and Cons of the Options

### Own the controls and draw every diagram with Paseo's renderer

* Good, because Canvas depends only on the Paseo SDK, React Native and React Query, which the host provides.
* Good, because it needs no Mermaid code in Canvas.
* Bad, because the controls and their look become Canvas's to maintain.
* Bad, because save-time Mermaid feedback and inline zoom on phones are lost.

### Follow `paseo-plugin-helper` to its new location

* Good, because the logger, the query hook and the host registration step still exist there.
* Bad, because the release that moved removed `paseo-plugin-helper/client`, so Canvas would have to build the same controls anyway.
* Bad, because the package is marked deprecated, is not on npm, and npm cannot install it from the monorepo's subdirectory.

### Keep the pinned helper release and the vendored Mermaid subset

* Good, because nothing changes for readers or agents.
* Bad, because installation keeps depending on an archived repository that its owner may delete, and on a release that will receive no fixes.
* Bad, because the vendored subset still needs maintenance and attribution, while Paseo's renderer already draws every diagram.

## More Information

This amends ADR 4 (controls), ADR 6 (Mermaid drawing), ADR 8 (save diagnostics), ADR 14 (`@tanstack/query-core` and `third-party/` in the package) and ADR 18 (Mermaid subset and `MERMAID_STANDARD_RENDERER`). See [controls](../../client/ui.tsx), [query hook](../../client/rpc.ts), [Markdown rendering](../../client/markdown.tsx), [MCP server](../../server/mcp.ts) and [UI guidance](../ui.md#図の操作). Revisit the controls when the SDK exports buttons, tabs or other controls. Revisit save diagnostics if Paseo exposes a way to validate Mermaid without Canvas parsing it.
