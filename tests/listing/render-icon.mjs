// Renders the listing icon with the repository's resvg WASM:
//   node tests/listing/render-icon.mjs <input.svg> <output.png> <width>
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { initWasm, Resvg } = require("@resvg/resvg-wasm");
await initWasm(
  readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")),
);
const [input, output, width] = process.argv.slice(2);
const png = new Resvg(readFileSync(input, "utf8"), {
  fitTo: { mode: "width", value: Number(width) },
})
  .render()
  .asPng();
writeFileSync(output, png);
