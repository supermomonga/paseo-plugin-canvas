import { test, expect } from "vitest";
import { mkdtemp, writeFile, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { workspaceImage } from "../server/images";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
test("workspace images resolve encoded paths and reject traversal, external symlinks and nonimages", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "canvas-images-"));
  try {
    const root = path.join(directory, "workspace");
    await mkdir(root);
    await writeFile(path.join(root, "画像.png"), png);
    await writeFile(path.join(directory, "outside.png"), png);
    await writeFile(path.join(root, "fake.png"), "not an image");
    await symlink(
      path.join(directory, "outside.png"),
      path.join(root, "link.png"),
    );
    const result = await workspaceImage(root, "%E7%94%BB%E5%83%8F.png");
    expect(result.uri).toBe(`data:image/png;base64,${png.toString("base64")}`);
    for (const src of [
      "../outside.png",
      "%2e%2e/outside.png",
      "link.png",
      "file:///tmp/image.png",
      "fake.png",
    ])
      await expect(workspaceImage(root, src)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
