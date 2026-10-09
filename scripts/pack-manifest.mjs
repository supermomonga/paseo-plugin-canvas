import { readFile, rename, writeFile } from "node:fs/promises";

// Paseo runs the manifest's build commands after npm installation too, where
// the package has no lockfile and npm has already installed the production
// dependencies. The package ships the generated renderer assets, so npm pack
// and publish drop the build commands that prepare a Git checkout and restore
// the manifest afterwards (ADR 14).
const manifest = new URL("../paseo-plugin.json", import.meta.url);
const backup = new URL("../paseo-plugin.json.git", import.meta.url);

switch (process.argv[2]) {
  case "prepack": {
    const text = await readFile(manifest, "utf8");
    try {
      await writeFile(backup, text, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      throw new Error(
        "paseo-plugin.json.git remains from an interrupted pack. Restore it with `mv paseo-plugin.json.git paseo-plugin.json` and pack again.",
      );
    }
    const { build: _build, ...published } = JSON.parse(text);
    await writeFile(manifest, `${JSON.stringify(published, null, 2)}\n`);
    break;
  }
  case "postpack":
    await rename(backup, manifest);
    break;
  default:
    throw new Error("Usage: node scripts/pack-manifest.mjs prepack|postpack");
}
