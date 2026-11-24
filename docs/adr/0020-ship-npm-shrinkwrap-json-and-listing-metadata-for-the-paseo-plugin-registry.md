---
number: 20
title: Ship npm-shrinkwrap.json and listing metadata for the Paseo plugin registry
status: accepted
date: 2026-11-24
links:
- target: 14
  kind: amends
---

# Ship npm-shrinkwrap.json and listing metadata for the Paseo plugin registry

## Context and Problem Statement

The reviewed Paseo plugin registry ([getpaseo/plugins](https://github.com/getpaseo/plugins), [protocol v1](https://github.com/getpaseo/plugins/blob/main/PROTOCOL.md)) lists Canvas as `supermomonga/canvas`, pinned to the Git commit of `v0.1.0`. The registry supplies that listing's description, overview (`plugins/supermomonga/canvas.md`) and media (`listing` overrides pointing at `images/1.png` to `images/4.png` at that commit). Those texts and screenshots show the 0.1 interface: the vendored Mermaid renderer, Paseo 0.8 and agents that receive Canvas only when created.

Since ADR 14 the plugin is published on npm as `paseo-canvas`, and later releases can be submitted as npm pins. The registry's review policy (`REVIEW.md`, read on 2026-11-24) requires that "dependency installation must use a lockfile that fixes the dependency tree", and treats an installation that needs one but ships none as a packaging blocker. Paseo's npm acquisition installs the production dependencies of `paseo-canvas` (the MCP SDK, the unified/remark/rehype parser stack, resvg WASM and others) with `npm install`, which ignores a dependency's `package-lock.json`; npm does not even publish that file. The publishing guide (`public-docs/plugins/publishing.md` in getpaseo/paseo) says to publish `npm-shrinkwrap.json` instead.

The registry also reads listing metadata from the pinned artifact: `name`, `description`, `icon` (package-relative PNG), `media` (package-relative images or videos) and `translations` from `paseo-plugin.json`, `OVERVIEW.md` and `OVERVIEW.<locale>.md` beside it, and for npm pins the package `description`. Author-supplied metadata replaces the registry copies when a release ships it.

## Decision Drivers

* An npm pin must pass registry review without a packaging blocker.
* Users of an npm installation get the dependency tree that CI tested and the reviewer inspected.
* The listing describes the current release and changes with it, without registry pull requests for every interface change.
* Git installations keep working with `npm ci`.

## Considered Options

* Rename the lockfile to `npm-shrinkwrap.json` and publish it, and ship listing metadata in the package
* Bundle the runtime dependencies into the plugin so that the package declares none
* Keep `package-lock.json` in the repository only, and leave the listing to registry overrides

## Decision Outcome

Chosen option: "Rename the lockfile to `npm-shrinkwrap.json` and publish it, and ship listing metadata in the package", because it locks the installed tree with npm's own mechanism and needs no change to how the plugin is built or loaded.

**Lockfile.** `package-lock.json` becomes `npm-shrinkwrap.json` (the same lockfile version 3 content) and `files` lists it. `npm ci`, `npm version` and the Version Bump workflow use it the same way; the workflow now commits it. Development entries stay in the file marked `dev`, and npm skips them when Paseo installs with `--omit=dev`. This amends ADR 14's package contents and release flow, which named `package-lock.json`.

**Listing metadata.** `paseo-plugin.json` declares `description`, `icon` (`assets/icon.png`, 256 × 256), six `media` images (`assets/listing/*.webp`, 1920 × 1200) and a Simplified Chinese description under `translations`; the name stays "Canvas" in every language, as the product name is not translated. `OVERVIEW.zh-CN.md` translates `OVERVIEW.md`. The package `description` equals the manifest's, since the registry reads the former for npm pins and the latter for Git pins. `files` adds `assets/` and `OVERVIEW.*.md`. The old `images/` screenshots are removed; the existing listing keeps reading them from its pinned commit.

### Consequences

* Good, because installations from the npm registry get exactly the locked versions, including transitive dependencies, and the registry reviewer can inspect them.
* Good, because the listing's text and images come from the reviewed release, and a release that ships them makes the registry's overview and media overrides redundant.
* Bad, because a shrinkwrap prevents npm from deduplicating Canvas's dependencies with others in the same installation; Paseo installs each plugin in its own directory, so this costs nothing in practice.
* Bad, because the package check does not exercise the shrinkwrap (see Confirmation).
* Bad, because the overview now exists in two languages, and the listing images must be retaken when the interface changes.

### Confirmation

`npm run test:package` packs the plugin, installs it with Paseo's npm options, and checks that the package contains `npm-shrinkwrap.json`, both overviews and every file that the manifest's `icon` and `media` name. CI runs it on every pull request.

That check installs from a local tarball. npm (Arborist) applies a dependency's shrinkwrap only when the package metadata carries `_hasShrinkwrap`, which the npm registry adds and a `file:` tarball lacks, so the check resolves the dependency ranges afresh and can pass with newer versions than the shrinkwrap pins. Paseo installs `npm:<package>@<version>` from the registry, where the shrinkwrap applies. On 2026-11-24, installing the published `paseo-heartbeats@0.1.2`, which ships a shrinkwrap, with Paseo's `npm install` options produced exactly the 11 production packages of its shrinkwrap, and the installation lockfile marked the package `hasShrinkwrap`. Repeat that check against the first `paseo-canvas` release that ships `npm-shrinkwrap.json`.

## Pros and Cons of the Options

### Rename the lockfile to `npm-shrinkwrap.json` and publish it, and ship listing metadata in the package

* Good, because it is the method that the Paseo publishing guide prescribes.
* Good, because Git installations and CI keep their commands.
* Neutral, because the package grows by the shrinkwrap (about 400 KB) and the images (about 550 KB).

### Bundle the runtime dependencies into the plugin so that the package declares none

* Good, because nothing is resolved at installation time.
* Bad, because Paseo compiles the plugin's TypeScript entries itself; bundling the server side would replace that path with a separate build, and the reviewer would inspect generated code instead of the published dependencies.

### Keep `package-lock.json` in the repository only, and leave the listing to registry overrides

* Good, because nothing changes in the repository.
* Bad, because npm pins fail the lockfile requirement, and the listing stays outdated until a registry pull request changes it.

## More Information

The listing images combine the Canvas panel and timeline row, rendered from the plugin's own components by the visual test fixture with sample data, with headings in a 1920 × 1200 frame. The send dialog's header in the comment image stands in for Paseo's modal, which the fixture does not reproduce. `npm run listing` (`tests/listing/capture.sh`) retakes them and renders the icon from `tests/listing/icon.svg`; run it when the interface they show changes. The registry rejects `paseo plugin add`, `npm install` and `npm i` anywhere in an overview; installation instructions belong in the README.
