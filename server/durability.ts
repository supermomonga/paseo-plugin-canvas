import { open } from "node:fs/promises";

/**
 * Make a completed create, rename or unlink in `directory` durable.
 *
 * Windows has no directory fsync reachable from Node: libuv opens the
 * directory, but FlushFileBuffers needs write access and fails with EPERM.
 * There the commit relies on flushing the file before its atomic rename
 * (ADR 17).
 */
export async function syncDirectory(
  directory: string,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform === "win32") return;
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
