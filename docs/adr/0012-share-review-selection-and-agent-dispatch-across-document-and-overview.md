---
number: 12
title: Share review selection and agent dispatch across document and overview
status: accepted
date: 2026-09-14
links:
- target: 11
  kind: amends
---

# Share review selection and agent dispatch across document and overview

## Context and Problem Statement

The comment overview did not share the visual framing of inline discussions. Thread checkboxes selected comments for agent dispatch, but the recipient picker and send button were only at the bottom of the overview. Their purpose was difficult to discover, especially from an inline discussion. The user requested the same cards and a floating send action in both views.

## Decision Drivers

* Make comment boundaries and the purpose of selecting threads visible.
* Keep the send action reachable without scrolling through every comment.
* Preserve selections and document drafts when opening or dismissing dispatch controls.
* Retain explicit sending, interruption consent and uncertain-delivery handling.

## Considered Options

* Share thread selection across views and open recipient selection from a floating action.
* Keep sending exclusive to the overview and move its controls to the top.

## Decision Outcome

Use a shared card surface for inline discussions and overview entries. Give the selection control a visible sending label. Keep selected thread IDs at document level and show a floating **Send to agent** action in both views when unresolved comments are selected. Opening or cancelling the send dialog does not send a request or discard the selection or drafts. While selecting document elements for a new comment, show the existing **Comment** action and retain the sending selection for later.

The floating action opens the public Paseo adaptive modal, where the user reviews comment numbers, chooses an eligible session and explicitly sends. This amends ADR 11's overview-only dispatch placement and permits a modal for dispatch configuration; editors and discussions remain inline. Successful sending clears only the dispatched selection and shows confirmation. Errors and failed or unknown delivery results remain visible in the dialog. Retrying uses the existing recorded request and warns when delivery is uncertain; it never happens automatically. Running and permission-blocked recipients retain the existing interruption and permission rules.

No changes are made to persistence, RPC contracts or server dispatch semantics.

### Consequences

* Good, because sending has the same discoverable entry point beside inline and overview comments.
* Good, because both comment presentations share their framing instead of drifting independently.
* Good, because the modal concentrates recipient selection and send errors without losing document context on dismissal.
* Bad, because dispatch temporarily covers the document and requires a separate explicit send step.

### Confirmation

Component tests cover shared selections, modal cancellation, preserved drafts, recipient availability, interruption consent, duplicate taps, errors and explicit retries on web, Android and iOS configurations. Browser checks cover narrow and desktop card layouts and simulated dispatch against the temporary review store. Native host validation is reported separately from physical mobile testing.

## Pros and Cons of the Options

### Shared selection and floating action

* Good, because the action remains available while reading any part of either view.
* Bad, because the action requires reserved scroll space to avoid covering the final controls.

### Overview-only controls at the top

* Good, because selection and sending could remain on one screen.
* Bad, because readers would still need to leave an inline discussion to send it.

## More Information

* [Inline discussions](0011-place-review-discussions-inside-the-document-and-separate-the-management-overview.md)
* [Review storage and dispatch](../review-storage.md)
