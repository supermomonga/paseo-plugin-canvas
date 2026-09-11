import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
await mkdir(".test-output/visual", { recursive: true });
await build({
  entryPoints: ["tests/visual/entry.tsx"],
  bundle: true,
  outfile: ".test-output/visual/app.js",
  jsx: "automatic",
  platform: "browser",
  // Match React Native Web resolution; otherwise SVG selects its native Fabric entry.
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
  define: { "process.env.NODE_ENV": '"development"' },
  alias: {
    "react-native": "react-native-web",
    "@getpaseo/plugin/client/react-native": path.resolve(
      "tests/visual/host.tsx",
    ),
  },
});
await writeFile(
  ".test-output/visual/index.html",
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Canvas UI verification</title><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style><div id="root"></div><script>window.addEventListener("error",event=>{const message=document.createElement("pre");message.textContent=event.message;document.body.append(message)})</script><script src="app.js"></script></html>',
);

// A deterministic 320 x 160 PNG verifies actual image layout, not a broken URL.
const { deflateSync } = await import("node:zlib");
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(320, 0);
header.writeUInt32BE(160, 4);
header[8] = 8;
header[9] = 2;
const pixels = Buffer.alloc(160 * (1 + 320 * 3));
for (let y = 0; y < 160; y++)
  for (let x = 0; x < 320; x++) {
    const pos = y * 961 + 1 + x * 3;
    const light = (Math.floor(x / 40) + Math.floor(y / 40)) % 2;
    pixels[pos] = light ? 220 : 70;
    pixels[pos + 1] = light ? 240 : 130;
    pixels[pos + 2] = light ? 225 : 100;
  }
await writeFile(
  ".test-output/visual/sample.png",
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);
