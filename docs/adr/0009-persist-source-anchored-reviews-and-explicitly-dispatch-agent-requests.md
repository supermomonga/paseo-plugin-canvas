---
number: 9
title: Persist source-anchored reviews and explicitly dispatch agent requests
status: accepted
date: 2026-09-11
links:
- target: 2
  kind: amends
- target: 5
  kind: amends
- target: 10
  kind: amendedby
---

# Persist source-anchored reviews and explicitly dispatch agent requests

## Context and Problem Statement

Users need to annotate Canvas content, collect comments, assign a batch to a session, discuss changes in the same threads, and resolve the result themselves. The experience should work with the released Paseo 0.8.0 plugin API without host changes. Browser selections and native mobile selections expose different information.

## Decision Drivers

* Keep reviews shared across sessions and devices, outside project directories.
* Preserve original quotations and reject ambiguous relocation after edits.
* Distinguish saving a comment, accepting a request, and applying a document change.
* Preserve user control over sending, interruption, and thread resolution.
* Use the existing storage ownership, native components and notifications.

## Considered Options

* A per-canvas JSON review state plus immutable Markdown snapshots.
* SQLite or an append-only event log.
* Browser-local comments or Paseo timeline entries as authoritative storage.
* Direct reuse of reviewable-html-workbench DOM manipulation and fuzzy anchor relocation.

## Decision Outcome

Chosen option: a per-canvas JSON state and immutable source snapshots, because the existing single-owner daemon and serialized canvas operations can commit review state with one atomic replacement. Save referenced source revisions before state that refers to them. Keep messages, anchor history and delivery records together. Validate source hashes and fail on corruption; never replace invalid state with an empty review.

Browser text selection maps through parser-produced UTF-16 source positions, including decoded references, emoji and inline formatting. The mobile preview explicitly selects semantic blocks; native code selects a line range. Render highlights through React rather than mutating the DOM owned by React. Only unchanged, uniquely located ranges follow document edits; modified or ambiguous ranges are Outdated and retain their quotation.

Saving and replying do not send prompts. Users explicitly choose threads and an eligible same-workspace session. Persist the request payload and sending state before SDK send; use a stable messageId. A lost response or restart leaves an unknown result, never automatic resending. SDK 0.8.0 may interrupt running turns, so require explicit interruption consent and prevent sends during pending permission requests. This remains a preflight check, not an atomic guarantee about the host's changing turn state.

Agents read reviews and reply through scoped MCP tools. Only the current assignee can reply to its current request; existing document edit leases still govern content changes. The user resolves/reopens threads. References to reviewable-html-workbench guide interaction behavior, not a code dependency; its edit gate and heuristic relocation are not adopted.

### Consequences

* Good, because durable review state and delivery records share one commit point, with immutable sources saved first.
* Good, because uncertain sends and positions remain visible instead of triggering guessed operations.
* Good, because native clients need no WebView or additional native modules.
* Bad, because JSON updates rewrite a canvas's review state and snapshot history consumes disk space; the state is limited to 32 MiB.
* Bad, because exactly-once delivery across daemon restart is unavailable in the public SDK.
* Bad, because mobile preview selection is block-based, and actual Android/iOS gesture behavior requires device validation.

### Confirmation

Storage, dispatch, source mapping, HTTP MCP and UI tests exercise the implementation. Production bundles are compiled through Paseo 0.8.0 and booted in the RN 0.81.5 Hermes CLI. The browser fixture uses the real review store for selection/save/resolve checks; it does not establish operation inside an installed Electron app or on a physical phone. See README for verification status.

## Pros and Cons of the Options

### JSON state and immutable snapshots

* Good, because this fits existing atomic-file persistence without a second database or event replay mechanism.
* Bad, because the complete state must be rewritten, and referenced snapshots must be retained.

### SQLite or event log

* Good, because they can support larger histories and indexed queries.
* Bad, because current requirements do not justify another persistence engine or replay model.

### Client-local or timeline storage

* Good, because it reduces dedicated server storage.
* Bad, because it fails shared durability or depends on timeline persistence not guaranteed by the released API.

### Direct reference implementation reuse

* Good, because it provides a proven review interaction model.
* Bad, because DOM wrappers cannot serve the native renderer, and ambiguous matching conflicts with the approved tracking policy.

## More Information

* [Review storage format and operations](../review-storage.md)
* [Reference review implementation](https://github.com/u-ichi/reviewable-html-workbench/tree/60bde37bf370aa78cb38383cb115d6e58c7cb0a7)
