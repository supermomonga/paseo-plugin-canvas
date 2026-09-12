---
number: 10
title: Select semantic elements across devices and store one review with multiple targets
status: accepted
date: 2026-09-12
links:
- target: 9
  kind: amends
---

# Select semantic elements across devices and store one review with multiple targets

## Context and Problem Statement

The separate Select target and Add comment actions did not make the target or next step clear. Desktop text selection and mobile block selection also required different gestures. Users need one comment to refer to several distinct elements without accidentally including the content between them.

## Decision Drivers

* Use the same selection interaction on desktop and mobile, in Preview and Code.
* Make selected elements visible and prevent selection from activating links or diagram controls.
* Keep one discussion for the complete selected set while tracking each target independently.
* Avoid compatibility code in this unreleased plugin, as explicitly requested by the user.

## Considered Options

* One explicit selection mode and a comment with ordered, separate source ranges.
* A Comment button on every element with one target per discussion.
* One contiguous source span covering all selected elements.

## Decision Outcome

Chosen option: explicit semantic-element selection and multiple source ranges in one anchor. A paragraph, heading, table, fenced block (including Mermaid), list, quote, callout or details block is one selectable unit. Outer units exclude their nested children from selection. Preview and Code derive their units from the same parsed document. During selection, click/tap toggles an element and its background, border and checkmark; native scrolling remains available while descendant controls are inactive. Outside selection, normal content interactions remain available.

Show a floating speech-bubble Comment button at the bottom right only when a current selection exists. It has no count: it opens one editor for one comment about all selected elements. Quote each target separately. Keep the existing inline side/bottom comment panel; do not use a central modal. Users can change the selected set without losing the draft. Document revision changes require a fresh selection before saving.

Review schemaVersion 2 stores an ordered, nonempty array of nonoverlapping ranges in each anchor. Each range has its own source quote and context. Track each range using the existing exact, bounded diff policy, sharing one diff per anchor. A changed target becomes Outdated without hiding the remaining valid targets. Reattachment replaces the target set and retains anchor history. Delivery snapshots and MCP responses expose the whole set in one thread. Explicit send, assignment and immutable delivery rules from ADR 9 remain in effect.

Do not add a schemaVersion 1 reader or migration. Per the user's explicit replacement policy, invalid JSON or schema-invalid comment state is ignored so Canvas still loads. Reads and startup do not rewrite or clean up that state or its snapshots. Saving a new comment replaces the state with schemaVersion 2. File access, identity and snapshot integrity failures remain errors. This amends ADR 9's invalid-state policy for JSON/schema validation only.

### Consequences

* Good, because the selected elements and the single-comment action are consistent across input devices.
* Good, because nonselected content between targets is never represented as a selected range.
* Good, because independently invalid targets retain their original quotations and do not force guessed relocation.
* Bad, because a selection mode is required before commenting and fine-grained character/cell selection is no longer offered.
* Bad, because unreleased version 1 review data cannot be opened with this version.

### Confirmation

Shared-unit tests cover whole tables, diagrams and nested structures. UI tests cover desktop/mobile selection, toggle/cancel, Preview/Code continuity, floating action visibility, draft retention and stale revisions. Storage tests cover noncontiguous targets, independent tracking, restart persistence, immutable delivery snapshots and reattachment. Type checking, production bundle tests and browser interaction checks validate integration. Physical mobile gesture validation remains a separate verification step.

## Pros and Cons of the Options

### Explicit mode and separate ranges

* Good, because normal viewing gestures and comment selection have distinct meanings.
* Good, because the data model preserves exactly the selected set in one discussion.
* Bad, because the schema and source-tracking result must represent multiple ranges.

### Per-element Comment buttons

* Good, because each button is near its target.
* Bad, because it adds persistent controls and does not express a multi-element discussion.

### One contiguous span

* Good, because it reuses the original single-range schema.
* Bad, because it silently includes intervening elements the user did not select.

## More Information

* [Review storage and delivery](../review-storage.md)
* This decision amends the interaction and anchor representation in ADR 9, while retaining its ownership and explicit dispatch rules and its persistence rules except for the explicitly authorized invalid-schema replacement policy.
