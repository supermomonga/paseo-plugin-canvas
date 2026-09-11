---
number: 4
title: Build one native-compatible UI with public Paseo components
status: accepted
date: 2026-09-11
links:
- target: 2
  kind: relatesto
- target: 5
  kind: relatesto
---

# Build one native-compatible UI with public Paseo components

## Context and Problem Statement

The canvas panel must serve Electron/Web and native mobile Paseo clients with consistent behavior. A plugin view is not automatically a WebView. React components are reusable only when their runtime dependencies are available in the host; wrapping an unavailable native module in a custom component does not make that module available. The user also requested adherence to Paseo's UI/UX and explicitly chose English-only product text.

## Decision Drivers

* One display architecture for desktop and mobile.
* Respect the plugin host's exported modules and native binary capabilities.
* Reuse helper components and host conventions rather than create unrelated controls.
* Keep plugin-owned copy consistent without an independent localization system.

## Considered Options

* Shared React Native views composed from public host primitives and helper components.
* DOM/iframe/WebView-based plugin views.
* Direct imports of Paseo's private components or unexposed native dependencies.

## Decision Outcome

Chosen option: "Shared React Native views composed from public host primitives and helper components", because it fits the released host runtime on desktop and mobile without requiring a new native module or host patch.

Use the public Paseo SDK, its exposed React Native primitives and host UI utilities, and `paseo-plugin-helper/client`. Pin the requested helper release `v0.4.0-beta.7` through the package lock rather than follow a moving branch. Reuse helper buttons, tabs, badges, code blocks, empty states and key/value displays. Helper components are compositions over available host modules, not a way to add missing native binaries.

Use host themes, icons, notifications and standard panel structure. Adapt the same list/detail views to the panel's available width: split view when space permits and navigation between list/detail on compact screens. Keep interactive controls recognizable without hover, align text/controls, and preserve usable touch targets. Isolate necessary Web-only input handling behind a platform check. Do not import private app components or override helper internals to mimic unavailable tokens.

Keep all plugin-provided labels, errors, notifications and accessibility copy in English, without locale dictionaries or following Paseo's language setting. Preserve user-authored content in its original language. This is a scope choice, not a claim that Paseo can never expose localization APIs.

### Consequences

* Good, because the same view code can execute within the existing Electron/Web/mobile hosts.
* Good, because standard controls and theme values reduce visual divergence from Paseo.
* Bad, because public exports expose fewer components and typography settings than the app itself; exact parity and automatic interface-size tracking are unavailable in the targeted SDK.
* Bad, because English-only product copy does not follow a user's selected app language.
* Bad, because simulated mobile rendering does not validate native gestures, safe areas or actual app integration.

### Confirmation

Use the release compiler to detect client/server import violations and test wide/compact views, controls and theme behavior in `tests/ui.test.tsx` and the visual fixture. Verify that product bundles do not depend on unexposed native modules. Existing Web and mocked native checks are not substitutes for physical iOS/Android validation, which remains outstanding.

## Pros and Cons of the Options

### Public primitives and helper components

* Good, because custom components can be bundled as ordinary JavaScript when all underlying runtime modules exist.
* Bad, because the plugin must implement some domain-specific display behavior itself.

### DOM, iframe or WebView views

* Good, because browser-oriented renderers can use their normal environment.
* Bad, because that environment is not the native plugin view contract; `react-native-webview` is not exposed by the targeted plugin SDK.

### Private host components or unexposed native dependencies

* Good, because they could offer richer built-in rendering.
* Bad, because their presence in Paseo or an npm package does not make them callable from a plugin, and private interfaces are not a supported integration boundary.

## More Information

The detailed, evolving visual rules belong in [UI guidance](../ui.md), including button sizes, icons, spacing and popup layout. See [client entry](../../index.client.tsx) and [locked dependencies](../../package-lock.json). Revisit component selection when the public SDK exposes appropriate controls/tokens; revisit localization only with an explicit product-scope change.
