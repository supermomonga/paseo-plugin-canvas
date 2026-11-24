# Releasing

The plugin is published to npm as `paseo-canvas` ([ADR 14](adr/0014-distribute-the-plugin-on-npm-and-publish-merged-version-bumps-with-trusted-publishing.md)). Git installations keep following `main`.

## Release a version

1. Run the **Version Bump** workflow from `main` with patch, minor or major, or an explicit `MAJOR.MINOR.PATCH` version. It updates `package.json` and `npm-shrinkwrap.json` with `npm version`, opens a `release/v<version>` pull request and dispatches CI on it.
2. Merge the pull request after CI passes. The **Release** workflow tags `v<version>`, runs `npm publish` with npm trusted publishing (provenance included, no token) and creates a GitHub release with generated notes.

The Release workflow acts only when a push to `main` changes the version. If publishing fails after tagging, publish manually from the tag (`npm ci && npm publish`) or release the next patch version.

## Package contents

`npm pack` and `npm publish` run `prepack`, which generates `server/generated/` and removes `build` from the packed `paseo-plugin.json`. `postpack` restores the manifest. If a pack is interrupted, restore it with `mv paseo-plugin.json.git paseo-plugin.json`.

`server/generated/` contains the rasterizer assets and the MathJax bundle built from `renderer/math.ts`, with its type declarations and license notice. MathJax and esbuild are development dependencies; npm installations receive only the generated module.

The package also carries `npm-shrinkwrap.json`, the lockfile of this repository, so that installations from the npm registry get exactly the locked dependency tree. Keep no `package-lock.json`; `npm install` updates the shrinkwrap ([ADR 20](adr/0020-ship-npm-shrinkwrap-json-and-listing-metadata-for-the-paseo-plugin-registry.md)).

`npm run test:package` packs the working tree, installs the tarball with the options of Paseo's npm acquisition, checks that the shrinkwrap, both overviews and the listing assets named by the manifest are in the package, compiles it with Paseo's compiler and renders a formula with the server bundle. It needs access to the npm registry. CI runs it on every pull request.

## Plugin registry listing

Canvas is listed in the [Paseo plugin registry](https://github.com/getpaseo/plugins) as `supermomonga/canvas`. The registry reads these files from the pinned release ([ADR 20](adr/0020-ship-npm-shrinkwrap-json-and-listing-metadata-for-the-paseo-plugin-registry.md)):

| File | Shown as |
| --- | --- |
| `package.json` `description` (npm pins), `paseo-plugin.json` `description` (Git pins) | One-sentence description. Keep both the same. |
| `paseo-plugin.json` `translations` | Simplified Chinese description. The name "Canvas" is not translated. |
| `OVERVIEW.md`, `OVERVIEW.zh-CN.md` | Listing page in English and Simplified Chinese. Change both together. |
| `assets/icon.png` | Icon, a 256 × 256 PNG. |
| `assets/listing/*.webp` | Listing images, 1920 × 1200, in the order of `media`. The first one is the card thumbnail. |

Overviews follow the registry's rules: plain sentence-case text without em dashes, no badges or changelog, and no installation commands. The registry rejects `paseo plugin add`, `npm install` and `npm i` anywhere in an overview; installation belongs in the README. Retake the listing images when the interface they show changes: `npm run listing` renders the panel with sample canvases through the fixture server in `tests/listing/`, screenshots it with [agent-browser](https://github.com/vercel-labs/agent-browser), frames the screenshots with `tests/listing/slides.html` and writes `assets/icon.png` and `assets/listing/*.webp`. It also needs ffmpeg with WebP support, and network access for the Inter font.

The registry pins one reviewed release and does not follow npm or Git on its own. npm pins receive automatic update pull requests; for a Git pin, or to move the listing from its Git pin to the npm package, open a new submission with the [submission form](https://github.com/getpaseo/plugins/issues/new?template=submit-plugin.yml). Once a release ships its own overview and media, the registry's overview copy and `listing` overrides become redundant.

## One-time setup

1. In the repository settings, under **Actions → General → Workflow permissions**, allow GitHub Actions to create pull requests. Version Bump opens the release pull request with `GITHUB_TOKEN`.
2. Publish the first version manually, because npm accepts a trusted publisher only for an existing package. From a clean checkout of `main`, run `npm ci && npm publish`, then create the tag and release with `gh release create v<version> --target main --generate-notes`.
3. Configure the trusted publisher with npm 11.15.0 or later, or in the package settings on npmjs.com:

   ```sh
   npm trust github paseo-canvas --file release.yml --repo supermomonga/paseo-plugin-canvas --allow-publish
   ```

   Afterwards, the package settings can require two-factor authentication and disallow tokens for publishing.
