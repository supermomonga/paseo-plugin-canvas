---
number: 11
title: Place review discussions inside the document and separate the management overview
status: accepted
date: 2026-09-12
links:
- target: 10
  kind: amends
- target: 12
  kind: amendedby
---

# Place review discussions inside the document and separate the management overview

## Context and Problem Statement

A fixed half-height comment pane competes with the document on mobile. Opening the IME can hide both the input and its save action. Repeating long target quotations adds height without helping locate the selected content. The user approved replacing the split with inline discussions on desktop and mobile.

## Decision Drivers

* Keep each discussion next to the document element that opened it.
* Preserve drafts independently of where a discussion is rendered.
* Keep input and save actions reachable while the keyboard is visible.
* Retain the existing multi-target storage and explicit agent dispatch rules.

## Considered Options

* Inline discussions with a separate management overview.
* A keyboard-aware bottom composer.
* A dedicated full-screen editor.

## Decision Outcome

Choose inline discussions. A new editor follows the last selected element, even when selections are not in document order. A comment icon opens the same discussion after the clicked target. Render one editor or discussion at a time; own new-comment and per-thread reply/edit drafts at the document level so moving a discussion does not discard them. Inline creation does not duplicate target quotations.

Comments opens a management overview for thread selection, resolution and dispatch. Keep the document mounted while this overview is shown, preserve its scroll position, and return to the requested target when navigation is explicit. Outdated discussions can be read and reattached from the overview. There is no central modal or side/bottom review pane.

Use the public React Native keyboard boundary and native input, accounting for the document's screen offset. Measure the available scroll viewport and reveal the focused input together with its actions on focus or keyboard/viewport resizing. Do not keep pulling the viewport back while the user reads earlier content. Keep input nodes stable during ordinary renders and bound multiline input growth.

This amends ADR 10's review placement, retaining selection semantics, schema, persistence and dispatch behavior.

### Consequences

* Good, because document context and discussion share one scroll region across devices.
* Good, because long selected tables no longer become duplicated quotations above the editor.
* Good, because drafts remain independent of mounting and target location.
* Bad, because opening a discussion changes the document's visible height.
* Bad, because keyboard behavior still requires device testing beyond component geometry checks.

### Confirmation

Component tests cover placement, switching, drafts and keyboard-driven scroll requests. Browser checks exercise the real temporary store at desktop and narrow widths. Type checking, the existing test suite and Hermes verify integration; physical Android/iOS IME verification must be reported separately from simulated geometry.

## Pros and Cons of the Options

### Inline discussions

* Good, because the visible position identifies the target.
* Bad, because distant selected targets cannot all be visible together.

### Bottom composer

* Good, because its position is predictable.
* Bad, because it continuously takes space away from the document.

### Full-screen editor

* Good, because it maximizes input space.
* Bad, because it hides the document the user wants to consult.

## More Information

* [Review storage and dispatch](../review-storage.md)
* [Semantic selection](0010-select-semantic-elements-across-devices-and-store-one-review-with-multiple-targets.md)
