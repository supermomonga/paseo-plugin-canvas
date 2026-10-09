---
number: 14
title: Distribute the plugin on npm and publish merged version bumps with trusted publishing
status: accepted
date: 2026-10-09
links:
- target: 6
  kind: amends
---

# Distribute the plugin on npm and publish merged version bumps with trusted publishing

## Context and Problem Statement

Canvas was installable only from its Git repository, so users always received the latest `main` commit and had no release versions. Paseo 0.9.0-beta.1 and later install plugins from npm packages (`npm:<name>[@<version>]`). The maintainer publishes `paseo-plugin-zcode-provider` from merged version-bump pull requests with npm trusted publishing (its ADR 16), and asked for the same flow here.

Paseo's npm acquisition (`packages/server/src/server/plugins/managed-source/npm.ts`, checked at 0.11.0-beta.5) runs `npm install --ignore-scripts --legacy-peer-deps --omit=dev` in an isolated directory, then runs the manifest's `build` commands. The package carries no lockfile, so the Git preparation `npm ci` fails. Dependencies are hoisted beside the plugin directory instead of inside it.

Paseo's compiler (unchanged from 0.8.0 to 0.10.3; 0.11.0-beta.5 differs only in unrelated options) checks every import, including type-only imports, and resolves each file outside the plugin directory to a package named by the import specifier. Installing a pack of this repository that way failed three checks that a Git checkout passes, because its `node_modules` lies inside the plugin directory:

* `@mathjax/src` reaches `@mathjax/mathjax-newcm-font` through its package.json `imports` (`#default-font/*`), which matches no package name.
* `paseo-plugin-helper`'s client declarations import types from `@tanstack/query-core`, which only the development dependency `@tanstack/react-query` installed.
* Two server modules imported types from the development dependency `@getpaseo/client`.

## Decision Drivers

* Each published version passes CI and review, and its tag, GitHub release and npm version come from the same commit.
* No long-lived npm token in the repository.
* The npm package installs and compiles on released Paseo versions without host changes.
* Git installation keeps working and following `main`.
* Redistributed third-party code keeps its license notice.

## Considered Options

* Publish to npm from merged version-bump pull requests, bundling MathJax ahead of time
* Publish to npm with MathJax and its dependencies as npm bundled dependencies
* Publish only tags and GitHub releases until Paseo resolves package-internal imports of hoisted dependencies

## Decision Outcome

Chosen option: "Publish to npm from merged version-bump pull requests, bundling MathJax ahead of time", because it makes the npm package work on released Paseo while keeping the package small.

**Release flow.** The Version Bump workflow (`workflow_dispatch` on `main`, patch / minor / major or an explicit `MAJOR.MINOR.PATCH`) updates `package.json` and `package-lock.json` with `npm version`, opens a `release/v<version>` pull request and dispatches CI on it, because pull requests opened with `GITHUB_TOKEN` do not trigger `pull_request` workflows. The Release workflow runs on every push to `main`. When the version changed from the previous commit, `salsify/action-detect-and-tag-new-version` tags `v<version>`, `npm publish` publishes with trusted publishing (OIDC, provenance) and `gh release create` adds generated notes. The first version is published manually, because npm configures a trusted publisher only for an existing package. CI runs typecheck, unit tests and the package check below on Node 22.

**Package.** The package is no longer private. `files` publishes the manifest, entries, `client/`, `server/` and `shared/`, and the license notices in `server/assets/` and `third-party/`. It omits the Noto Sans JP source font, which the generated rasterizer module already embeds. `prepack` runs the renderer build and removes `build` from the packed manifest; `postpack` restores it. Git installations keep `build`, now `npm ci --include=dev` followed by `npm run setup`.

**MathJax.** `renderer/math.ts` holds the MathJax renderer. The renderer build bundles it with esbuild into `server/generated/math.js`, with a declaration file and a license notice listing the bundled packages under the Apache License 2.0; the build fails if a bundled package has another license. `server/math.ts` re-exports the generated module, so the plugin source no longer imports MathJax. MathJax packages become development dependencies. This amends ADR 6 by moving MathJax, like the WASM and fonts, into the renderer build output.

**Type imports.** The server derives the agent and timeline types from the host SDK's `PluginHandlerContext` instead of importing `@getpaseo/client`. `@tanstack/query-core` becomes a runtime dependency so that the helper's declarations resolve; the client bundle does not include it.

### Consequences

* Good, because publishing needs no npm token or local login, and each version has provenance.
* Good, because the tag, GitHub release and npm version come from one reviewed commit, and users can install a released version.
* Good, because npm installations no longer download about 120 MB of MathJax packages.
* Bad, because a failed publish after tagging needs a manual `npm publish` from the tag or a new patch version; the workflow acts only on version changes.
* Bad, because the published manifest differs from the repository's, and an interrupted `npm pack` leaves the rewritten manifest and `paseo-plugin.json.git` in the working tree.
* Bad, because Git installations now need development dependencies for the renderer build, and MathJax upgrades require rebuilding and checking the generated notice.
* Bad, because the workflows depend on two third-party actions, pinned by commit SHA.
* Neutral, because pushes to `main` that do not change the version run a short no-op release job.

### Confirmation

`npm run test:package` packs the working tree, installs the tarball with Paseo's npm acquisition options, asserts that the published manifest has no `build` and development dependencies are absent, compiles both entries with Paseo's compiler and renders a formula to PNG with the server bundle. Before these changes, the check failed in turn on the three imports above with the 0.8.0 compiler, and the 0.11.0-beta.5 compiler from Paseo's source rejected the MathJax import; afterwards the installation compiles with both. `tests/bundle.test.ts` keeps covering the Git layout, including math rendering. CI runs both on every pull request.

## Pros and Cons of the Options

### Publish to npm from merged version-bump pull requests, bundling MathJax ahead of time

* Good, because it works on Paseo 0.9.0-beta.1 and later without host changes.
* Bad, because math rendering depends on a generated module and its build step.

### Publish to npm with MathJax and its dependencies as npm bundled dependencies

Bundled dependencies would install MathJax inside the plugin directory, which the compiler does not check.

* Good, because the source and build stay unchanged.
* Bad, because the package would grow by more than 100 MB unpacked.

### Publish only tags and GitHub releases until Paseo resolves package-internal imports of hoisted dependencies

* Good, because no runtime code changes.
* Bad, because users still have no versioned installation, and the timing depends on an upstream change.

## More Information

The release steps and one-time setup are in [releasing](../releasing.md). Configure the trusted publisher on npmjs.com or with `npm trust github paseo-canvas --file release.yml --repo supermomonga/paseo-plugin-canvas --allow-publish` (npm 11.15.0 or later). Version Bump requires the repository setting that allows GitHub Actions to create pull requests.

If Paseo's compiler starts resolving package-internal imports of dependencies outside the plugin directory, reconsider whether MathJax still needs bundling ahead of time.
