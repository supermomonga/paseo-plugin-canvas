---
number: 5
title: Parse and sanitize Markdown on the daemon
status: accepted
date: 2026-09-11
links:
- target: 4
  kind: relatesto
- target: 6
  kind: relatesto
---

# Parse and sanitize Markdown on the daemon

## Context and Problem Statement

A GFM preview needs more than basic headings and paragraphs. The requested surface includes tables, tasks, GitHub-style alerts, footnotes, anchors, emoji, images, diagrams and mathematics, while excluding features that require GitHub account/repository data. Rendering must work in the shared native-compatible UI without a browser HTML renderer. The original Markdown must remain intact for agents and code view.

## Decision Drivers

* Parse nested Markdown reliably instead of progressively approximating it with ad hoc string handling.
* Preserve source while allowing a validated, restricted preview representation.
* Keep parser dependencies and filesystem access on the daemon.
* Avoid arbitrary HTML/script execution and GitHub-data dependencies.

## Considered Options

* The unified/remark/rehype pipeline on the daemon with a native renderer for the resulting structure.
* A DOM-oriented React Markdown renderer in the client.
* A ready-made React Native Markdown component whose requirements may include unexposed host modules.

## Decision Outcome

Chosen option: "The unified/remark/rehype pipeline on the daemon with a native renderer", because parsing and native presentation have different runtime constraints.

Parse with `remark-parse`, `remark-gfm`, `remark-math` and `remark-emoji`, transform through `remark-rehype`, and sanitize the restricted structure with `rehype-raw` and `rehype-sanitize`. Handle GitHub-style alerts and stable/deduplicated heading anchors explicitly. Return a schema-validated document tree over plugin RPC for native rendering. Do not modify the stored Markdown to implement presentation features.

Support content-only Markdown features; do not implement notifications for `@users`, repository-dependent `#123` expansion or commit-data previews. Treat supported embedded `details`, `summary`, `br`, `sub` and `sup` as restricted Markdown extensions, not as support for standalone HTML canvases. Hide comments, render other unsupported raw HTML as text, and never execute scripts.

Restrict external navigation to HTTP, HTTPS and mailto. Resolve supported relative images against the workspace root on the daemon, enforce the size/type limits, and reject escaping paths and symlink-based redirection. External images are fetched by the viewing client; this can contact third-party hosts and is not an offline/private image proxy. Tasks remain read-only in the preview. Full-document code view preserves the source; advanced syntax highlighting was considered unnecessary for this iteration.

### Consequences

* Good, because grammar handling is delegated to established parsers while the client receives a controlled display structure.
* Good, because GFM plus selected extensions can render without changing native host binaries or losing source fidelity.
* Bad, because the plugin maintains rendering and extension behavior beyond what the parser alone supplies.
* Bad, because raw HTML compatibility is intentionally narrower than a general browser or GitHub page.
* Bad, because local and remote images have different access paths and validation responsibilities.

### Confirmation

`tests/document.test.ts` and `tests/fixtures/gfm.md` cover Markdown structure and extensions, including sanitization. `tests/images.test.ts` covers local path/type restrictions. UI tests cover the resulting native structure. Check both the parsed tree and actual rendering when adding syntax; parser support alone is insufficient evidence of display support.

## Pros and Cons of the Options

### Daemon parsing plus native rendering

* Good, because Node-dependent parsing and local image access stay out of the product client bundle.
* Bad, because a shared document schema and native renderer must evolve together.

### DOM-oriented React Markdown renderer

* Good, because it provides browser-friendly rendering from Markdown.
* Bad, because DOM output does not satisfy native mobile plugin rendering by itself.

### Ready-made native Markdown component

* Good, because it could reduce custom rendering code.
* Bad, because a library requiring a native module absent from the host cannot be adopted solely by adding an npm dependency; candidate libraries must also cover the required extensions.

## More Information

See [parser](../../server/document.ts), [shared tree contract](../../shared/document.ts), [image validation](../../server/images.ts) and [supported syntax](../../README.md#markdown-support). Revisit the renderer if a publicly exposed host component satisfies the feature and sanitization contract; a library name alone is not evidence of native compatibility.
