# Releasing

The plugin is published to npm as `paseo-canvas` ([ADR 14](adr/0014-distribute-the-plugin-on-npm-and-publish-merged-version-bumps-with-trusted-publishing.md)). Git installations keep following `main`.

## Release a version

1. Run the **Version Bump** workflow from `main` with patch, minor or major, or an explicit `MAJOR.MINOR.PATCH` version. It updates `package.json` and `package-lock.json` with `npm version`, opens a `release/v<version>` pull request and dispatches CI on it.
2. Merge the pull request after CI passes. The **Release** workflow tags `v<version>`, runs `npm publish` with npm trusted publishing (provenance included, no token) and creates a GitHub release with generated notes.

The Release workflow acts only when a push to `main` changes the version. If publishing fails after tagging, publish manually from the tag (`npm ci && npm publish`) or release the next patch version.

## Package contents

`npm pack` and `npm publish` run `prepack`, which generates `server/generated/` and removes `build` from the packed `paseo-plugin.json`. `postpack` restores the manifest. If a pack is interrupted, restore it with `mv paseo-plugin.json.git paseo-plugin.json`.

`server/generated/` contains the rasterizer assets and the MathJax bundle built from `renderer/math.ts`, with its type declarations and license notice. MathJax and esbuild are development dependencies; npm installations receive only the generated module.

`npm run test:package` packs the working tree, installs the tarball with the options of Paseo's npm acquisition, compiles it with Paseo's compiler and renders a formula with the server bundle. It needs access to the npm registry. CI runs it on every pull request.

## One-time setup

1. In the repository settings, under **Actions → General → Workflow permissions**, allow GitHub Actions to create pull requests. Version Bump opens the release pull request with `GITHUB_TOKEN`.
2. Publish the first version manually, because npm accepts a trusted publisher only for an existing package. From a clean checkout of `main`, run `npm ci && npm publish`, then create the tag and release with `gh release create v<version> --target main --generate-notes`.
3. Configure the trusted publisher with npm 11.15.0 or later, or in the package settings on npmjs.com:

   ```sh
   npm trust github paseo-canvas --file release.yml --repo supermomonga/paseo-plugin-canvas --allow-publish
   ```

   Afterwards, the package settings can require two-factor authentication and disallow tokens for publishing.
