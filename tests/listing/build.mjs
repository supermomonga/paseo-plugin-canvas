import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const out = ".test-output/listing";
await build({
  entryPoints: ["tests/listing/entry.tsx"],
  bundle: true,
  outfile: `${out}/app.js`,
  jsx: "automatic",
  platform: "browser",
  resolveExtensions: [
    ".web.tsx",
    ".web.ts",
    ".web.jsx",
    ".web.js",
    ".tsx",
    ".ts",
    ".jsx",
    ".js",
    ".json",
  ],
  define: { "process.env.NODE_ENV": '"production"' },
  alias: {
    "react-native": "react-native-web",
    "@getpaseo/plugin/client": path.resolve("tests/visual/client.ts"),
    "@getpaseo/plugin/client/ui": path.resolve("tests/visual/host.tsx"),
    "@getpaseo/plugin/client/react-native": path.resolve(
      "tests/visual/host.tsx",
    ),
  },
});
// React Native Web's System stack starts with -apple-system. Map it to Inter,
// the closest open font to the macOS system font that Paseo uses.
await writeFile(
  `${out}/index.html`,
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Canvas listing</title>
<style>
@font-face{font-family:"-apple-system";src:url(inter.woff2) format("woff2");font-weight:100 900;font-display:block}
html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}
body{-webkit-font-smoothing:antialiased;font-feature-settings:"cv11","ss01"}
</style>
<div id="root"></div><script src="app.js"></script></html>`,
);
