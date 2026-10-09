---
number: 6
title: Render diagrams and mathematics without Chromium or WebView
status: accepted
date: 2026-09-11
links:
- target: 5
  kind: relatesto
- target: 8
  kind: RelatesTo
- target: 14
  kind: amendedby
---

# Render diagrams and mathematics without Chromium or WebView

## Context and Problem Statement

The user rejected Chromium as an excessive runtime dependency for diagram and math display and requested the same overall architecture for Electron and mobile. Paseo's own browser-backed Mermaid path and React DOM components cannot simply be imported into the targeted native plugin host. The selected upstream `paseo-plugin-mermaid` provides parser/layout/drawing code implemented with available React Native primitives, but is not an independently packaged, full Mermaid renderer.

## Decision Drivers

* No Chromium process, iframe, WebView or new native module required for product rendering.
* Diagram pan/zoom and source inspection must remain available on desktop and mobile.
* Mathematical text, including Japanese, must render without runtime asset downloads.
* Unsupported diagram syntax must not silently produce a misleading partial diagram.

## Considered Options

* Render diagrams and mathematics through local Chromium.
* Use browser Mermaid inside a WebView/iframe or a DOM-oriented React component.
* Use native-compatible Mermaid source with daemon-side math rasterization.

## Decision Outcome

Chosen option: "Native-compatible Mermaid source with daemon-side math rasterization", because it supplies both features within the existing host runtime without a browser dependency.

Vendor the MIT-licensed parser, layout and drawing portions of `dutchakdev/paseo-plugin-mermaid` at commit `8e983c8108521da23ae05070f896a0057f0982f3`, preserving attribution, license and local modifications. Do not install the upstream plugin's entry points or treat it as an npm Mermaid library. Draw the supported flowchart and sequence-diagram subset with React Native primitives. Detect unsupported syntax and reject the whole diagram with an explanation and its original code. Do not claim full official Mermaid compatibility.

Use shared native pan/pinch/zoom behavior, with platform-gated mouse-wheel handling on Electron/Web. Provide fit-to-view and near-fullscreen diagram/source popups with clear controls. Interaction details live in UI guidance rather than the architecture record.

Render mathematics on the daemon using MathJax and resvg WASM, then return PNG images to the client. Bundle required WASM and fonts, including Japanese text support, during setup. Isolate macro/numbering state per expression and bound input, expansion and image sizes. Do not fetch extra packages, fonts or a browser at render time. The client receives images and does not depend on MathJax, resvg, WebView or SVG native modules.

### Consequences

* Good, because diagram interaction and mathematical display run within the established desktop/mobile plugin contract.
* Good, because rendering does not depend on an external diagram service or local browser installation.
* Bad, because Mermaid support is a strict subset and the vendored code requires maintenance and attribution.
* Bad, because rasterized mathematics is not selectable vector text and consumes daemon CPU and transfer bandwidth.
* Bad, because browser/native component tests cannot establish real-device gesture behavior.

### Confirmation

`tests/mermaid/` checks parsing, layout, rejected syntax and interaction state. `tests/graphics.test.ts` verifies real PNG output and rendering limits. `tests/bundle.test.ts` checks that prohibited rendering dependencies do not enter the client bundle and exercises daemon math rendering. Actual mobile touch/popup behavior remains a separate device-level check.

## Pros and Cons of the Options

### Native diagram subset plus daemon math images

* Good, because available JavaScript/native primitives suffice and math assets are bundled.
* Bad, because diagrams lose unsupported official Mermaid features and math becomes raster output.

### Chromium rendering

* Good, because a browser can execute full browser-oriented renderers.
* Bad, because the user explicitly rejected the installation/runtime weight.

### Browser Mermaid through WebView, iframe or DOM components

* Good, because it can retain browser Mermaid rendering and existing browser zoom components.
* Bad, because browser APIs are not available in native plugin views and the necessary WebView module is not exposed by the target SDK.

## More Information

See [vendor provenance](../../third-party/paseo-plugin-mermaid/README.md), [vendor license](../../third-party/paseo-plugin-mermaid/LICENSE), [graphics renderer](../../server/graphics.ts), [bundled assets](../../server/assets/README.md) and [UI interaction rules](../ui.md#図の操作と両プラットフォーム対応). Revisit if Paseo exposes an appropriate cross-platform renderer publicly; do not add Chromium or hidden host dependencies as an automatic fallback.
