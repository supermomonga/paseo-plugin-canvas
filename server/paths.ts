import { homedir } from "node:os";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
export function dataRoot(
  platform = process.platform,
  env = process.env,
  home = homedir(),
): string {
  switch (platform) {
    case "linux": {
      const base = env.XDG_DATA_HOME;
      return path.join(
        base && path.isAbsolute(base)
          ? base
          : path.join(home, ".local", "share"),
        "paseo-canvas",
      );
    }
    case "darwin":
      return path.join(home, "Library", "Application Support", "paseo-canvas");
    case "win32": {
      if (!env.LOCALAPPDATA || !path.win32.isAbsolute(env.LOCALAPPDATA))
        throw new Error("LOCALAPPDATA must be an absolute directory");
      return path.win32.join(env.LOCALAPPDATA, "paseo-canvas");
    }
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}
export async function storageDirectory(): Promise<string> {
  const home = homedir();
  const configured = process.env.PASEO_HOME ?? "~/.paseo";
  const expanded =
    configured === "~"
      ? home
      : configured.startsWith("~/")
        ? path.join(home, configured.slice(2))
        : configured;
  const canonical = await realpath(path.resolve(expanded));
  return path.join(
    dataRoot(),
    "hosts",
    createHash("sha256").update(canonical).digest("hex"),
  );
}
